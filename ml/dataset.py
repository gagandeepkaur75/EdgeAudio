import os
import glob
import random
import json
import numpy as np
import soundfile as sf
import torch
from torch.utils.data import Dataset, DataLoader
from features import extract_features, TARGET_SAMPLES
from degradations import apply_random_degradation_chain
from teacher import compute_clean_vad, compute_teacher_label
from paths import P

SR = 16000

class SpeechQualityDataset(Dataset):
    """
    On-the-fly augmented speech quality dataset with speaker-disjoint splits,
    known degradation simulation, and calibrated teacher labeling.
    """
    def __init__(self, clean_files, noise_files, norm_stats=None, is_train=True, pairs=True):
        self.clean_files = clean_files
        self.noise_files = noise_files
        self.norm_stats = norm_stats
        self.is_train = is_train
        self.pairs = pairs

    def __len__(self):
        return len(self.clean_files)

    def _load_audio_window(self, file_path):
        audio, orig_sr = sf.read(file_path, dtype='float32')
        if len(audio.shape) > 1:
            audio = audio[:, 0]
        if orig_sr != SR:
            import scipy.signal
            audio = scipy.signal.resample_poly(audio, SR, orig_sr)
            
        # Select 2.0s (32,000 samples) window
        if len(audio) < TARGET_SAMPLES:
            audio = np.pad(audio, (0, TARGET_SAMPLES - len(audio)), mode='constant')
        elif len(audio) > TARGET_SAMPLES:
            if self.is_train:
                start = random.randint(0, len(audio) - TARGET_SAMPLES)
            else:
                start = (len(audio) - TARGET_SAMPLES) // 2
            audio = audio[start : start + TARGET_SAMPLES]
        return audio.astype(np.float32)

    def __getitem__(self, idx):
        file_path = self.clean_files[idx]
        clean_audio = self._load_audio_window(file_path)
        
        # Clean VAD
        vad_mask, speech_frac = compute_clean_vad(clean_audio)
        
        # Apply degradation chain
        deg_audio, meta = apply_random_degradation_chain(clean_audio, self.noise_files)
        
        # Teacher labels
        mos, voice_prob, diag, mos_mask = compute_teacher_label(
            clean_audio, deg_audio, meta, vad_mask, speech_frac
        )
        
        # Extract features (201, 85)
        feats = extract_features(deg_audio)
        if self.norm_stats is not None:
            mean = self.norm_stats["mean"]
            std = self.norm_stats["std"]
            feats = (feats - mean) / (std + 1e-6)

        item = {
            "features": torch.tensor(feats, dtype=torch.float32),
            "mos": torch.tensor([mos], dtype=torch.float32),
            "voice_prob": torch.tensor([voice_prob], dtype=torch.float32),
            "diagnostics": torch.tensor(diag, dtype=torch.float32),
            "mos_mask": torch.tensor([mos_mask], dtype=torch.float32)
        }

        # If pairs is requested for training pairwise monotonicity
        if self.is_train and self.pairs and random.random() < 0.5:
            # Create a more degraded version of the same clip
            deg2_audio, meta2 = apply_random_degradation_chain(deg_audio, self.noise_files)
            mos2, vp2, diag2, mask2 = compute_teacher_label(clean_audio, deg2_audio, meta2, vad_mask, speech_frac)
            # Ensure mos2 <= mos
            mos2 = min(mos2, max(0.1, mos - random.uniform(0.3, 1.2)))
            feats2 = extract_features(deg2_audio)
            if self.norm_stats is not None:
                feats2 = (feats2 - mean) / (std + 1e-6)
            item["pair_features"] = torch.tensor(feats2, dtype=torch.float32)
            item["pair_mos"] = torch.tensor([mos2], dtype=torch.float32)
            item["has_pair"] = torch.tensor([1.0], dtype=torch.float32)
        else:
            item["pair_features"] = torch.zeros_like(item["features"])
            item["pair_mos"] = torch.zeros(1, dtype=torch.float32)
            item["has_pair"] = torch.tensor([0.0], dtype=torch.float32)

        return item

def get_splits(data_root=P("data"), seed=42):
    random.seed(seed)
    clean_dir = os.path.join(data_root, "clean_speech")
    noise_dir = os.path.join(data_root, "noise")
    
    # Speakers
    speakers = sorted([d for d in os.listdir(clean_dir) if os.path.isdir(os.path.join(clean_dir, d))])
    random.shuffle(speakers)
    
    n_spk = len(speakers)
    n_train_spk = int(0.8 * n_spk)
    n_val_spk = int(0.1 * n_spk)
    
    train_speakers = set(speakers[:n_train_spk])
    val_speakers = set(speakers[n_train_spk : n_train_spk + n_val_spk])
    test_speakers = set(speakers[n_train_spk + n_val_spk :])
    
    train_clean = []
    val_clean = []
    test_clean = []
    
    for spk in speakers:
        files = glob.glob(os.path.join(clean_dir, spk, "*.flac"))
        if spk in train_speakers:
            train_clean.extend(files)
        elif spk in val_speakers:
            val_clean.extend(files)
        else:
            test_clean.extend(files)
            
    # Noise files
    all_noise = sorted(glob.glob(os.path.join(noise_dir, "*.wav")))
    random.shuffle(all_noise)
    n_noise = len(all_noise)
    n_train_noise = int(0.8 * n_noise)
    n_val_noise = int(0.1 * n_noise)
    
    train_noise = all_noise[:n_train_noise]
    val_noise = all_noise[n_train_noise : n_train_noise + n_val_noise]
    test_noise = all_noise[n_train_noise + n_val_noise :]
    
    print(f"Data splits by SPEAKER (no leakage):")
    print(f"  Train: {len(train_speakers)} speakers ({len(train_clean)} files), {len(train_noise)} noise files")
    print(f"  Val:   {len(val_speakers)} speakers ({len(val_clean)} files), {len(val_noise)} noise files")
    print(f"  Test:  {len(test_speakers)} speakers ({len(test_clean)} files), {len(test_noise)} noise files")
    
    return {
        "train_clean": train_clean,
        "val_clean": val_clean,
        "test_clean": test_clean,
        "train_noise": train_noise,
        "val_noise": val_noise,
        "test_noise": test_noise
    }

def compute_and_save_norm_stats(train_clean, train_noise, save_path=P("models/norm_stats.json"), n_samples=300):
    """Computes global feature mean and std across training set."""
    print(f"Computing global normalization constants from {n_samples} training samples...")
    sample_files = random.sample(train_clean, min(n_samples, len(train_clean)))
    all_feats = []
    
    for f in sample_files:
        audio, orig_sr = sf.read(f, dtype='float32')
        if len(audio.shape) > 1:
            audio = audio[:, 0]
        if orig_sr != SR:
            import scipy.signal
            audio = scipy.signal.resample_poly(audio, SR, orig_sr)
        if len(audio) < TARGET_SAMPLES:
            audio = np.pad(audio, (0, TARGET_SAMPLES - len(audio)), mode='constant')
        else:
            audio = audio[:TARGET_SAMPLES]
            
        deg, _ = apply_random_degradation_chain(audio, train_noise)
        feat = extract_features(deg)  # (201, 85)
        all_feats.append(feat)
        
    stacked = np.concatenate(all_feats, axis=0)  # (N*201, 85)
    mean = np.mean(stacked, axis=0)
    std = np.std(stacked, axis=0)
    # Clamp std to avoid division by zero
    std = np.maximum(std, 0.05)
    
    stats = {
        "mean": mean.tolist(),
        "std": std.tolist()
    }
    os.makedirs(os.path.dirname(save_path), exist_ok=True)
    with open(save_path, "w") as fp:
        json.dump(stats, fp, indent=2)
    print(f"Saved global normalization constants to {save_path}")
    return {"mean": mean, "std": std}

if __name__ == '__main__':
    splits = get_splits()
    stats = compute_and_save_norm_stats(splits["train_clean"], splits["train_noise"], n_samples=50)
    ds = SpeechQualityDataset(splits["train_clean"][:10], splits["train_noise"], norm_stats=stats)
    batch = ds[0]
    print("Dataset item keys:", batch.keys())
    print("Features shape:", batch["features"].shape)
    print("MOS:", batch["mos"].item(), "Voice:", batch["voice_prob"].item(), "Mask:", batch["mos_mask"].item())
