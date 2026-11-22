import os
import sys
import json
import time
import random
import torch
import numpy as np
import soundfile as sf
import scipy.signal

from features import extract_features, TARGET_SAMPLES
from degradations import (
    simulate_reverb,
    simulate_muffle,
    simulate_clipping,
    simulate_packet_loss,
    simulate_wind_blow,
    simulate_natural_pause,
    add_noise_at_snr,
    generate_pink_noise
)
from teacher import compute_clean_vad, compute_teacher_label
from dataset import get_splits
from paths import P

SR = 16000

def load_audio_window(file_path):
    audio, orig_sr = sf.read(file_path, dtype='float32')
    if len(audio.shape) > 1:
        audio = audio[:, 0]
    if orig_sr != SR:
        audio = scipy.signal.resample_poly(audio, SR, orig_sr)
    if len(audio) < TARGET_SAMPLES:
        audio = np.pad(audio, (0, TARGET_SAMPLES - len(audio)), mode='constant')
    elif len(audio) > TARGET_SAMPLES:
        max_start = len(audio) - TARGET_SAMPLES
        start = random.randint(0, max_start)
        audio = audio[start : start + TARGET_SAMPLES]
    # Normalize speech level to standard conversation (-26 to -18 dBFS)
    target_rms = 10.0 ** (random.uniform(-26.0, -18.0) / 20.0)
    rms = np.sqrt(np.mean(audio ** 2) + 1e-12)
    return (audio * (target_rms / rms)).astype(np.float32)

def generate_sample(clean_files, noise_files, sample_type='auto'):
    clean_audio = load_audio_window(random.choice(clean_files))
    vad_mask, speech_frac = compute_clean_vad(clean_audio)
    
    if sample_type == 'auto':
        r = random.random()
        if r < 0.20:
            sample_type = 'clean'
        elif r < 0.42:
            sample_type = 'non_speech'
        elif r < 0.52:
            sample_type = 'natural_pause'
        elif r < 0.76:
            sample_type = 'single_impairment'
        else:
            sample_type = 'compound'

    diag = {"noise": 0.0, "clipping": 0.0, "muffled": 0.0, "dropouts": 0.0, "wind": 0.0}

    # 1. Clean anchor
    if sample_type == 'clean':
        room_noise = np.random.randn(len(clean_audio)).astype(np.float32) * (10.0 ** (random.uniform(-55.0, -45.0) / 20.0))
        audio = clean_audio + room_noise
        meta = {"is_clean": True}
        meta.update(diag)

    # 2. Non-speech hard negatives (silence, room tone, blow only, typing/noise)
    elif sample_type == 'non_speech':
        sub = random.choice(['silence', 'room_tone', 'blow_only', 'blow_only', 'noise_only'])
        if sub == 'silence':
            audio = np.random.randn(len(clean_audio)).astype(np.float32) * (10.0 ** (random.uniform(-65.0, -50.0) / 20.0))
            meta = {"is_silence": True}
        elif sub == 'room_tone':
            audio = np.random.randn(len(clean_audio)).astype(np.float32) * (10.0 ** (random.uniform(-45.0, -38.0) / 20.0))
            sos = scipy.signal.butter(2, 600, btype='lowpass', fs=SR, output='sos')
            audio = scipy.signal.sosfilt(sos, audio)
            meta = {"is_silence": True}
        elif sub == 'blow_only':
            intensity = random.uniform(0.5, 1.3)
            audio = simulate_wind_blow(np.zeros_like(clean_audio), intensity=intensity, blow_only=True)
            meta = {"is_blow_only": True}
            diag["wind"] = float(np.clip(intensity / 1.0, 0.0, 1.0))
        else:
            n_file = random.choice(noise_files)
            n_audio, orig_sr = sf.read(n_file, dtype='float32')
            if len(n_audio.shape) > 1: n_audio = n_audio[:, 0]
            if orig_sr != SR: n_audio = scipy.signal.resample_poly(n_audio, SR, orig_sr)
            if len(n_audio) < TARGET_SAMPLES: n_audio = np.pad(n_audio, (0, TARGET_SAMPLES - len(n_audio)))
            else: n_audio = n_audio[:TARGET_SAMPLES]
            audio = n_audio * (10.0 ** (random.uniform(-30.0, -18.0) / 20.0) / (np.sqrt(np.mean(n_audio**2)) + 1e-12))
            meta = {"is_silence": True}
        meta.update(diag)

    # 3. Natural pauses (hard negative: speech pauses must keep high MOS)
    elif sample_type == 'natural_pause':
        audio = simulate_natural_pause(clean_audio, pause_duration_s=random.uniform(0.2, 0.8))
        meta = {"is_natural_pause": True}
        meta.update(diag)

    # 4. Single impairments (pure signal for each diagnostic head)
    elif sample_type == 'single_impairment':
        impair = random.choice(['noise', 'clip', 'muffle', 'dropouts', 'wind'])
        if impair == 'noise':
            snr = random.uniform(-2.0, 30.0)
            n_file = random.choice(noise_files)
            n_audio, orig_sr = sf.read(n_file, dtype='float32')
            if len(n_audio.shape) > 1: n_audio = n_audio[:, 0]
            if orig_sr != SR: n_audio = scipy.signal.resample_poly(n_audio, SR, orig_sr)
            if len(n_audio) < TARGET_SAMPLES: n_audio = np.pad(n_audio, (0, TARGET_SAMPLES - len(n_audio)))
            else: n_audio = n_audio[:TARGET_SAMPLES]
            audio = add_noise_at_snr(clean_audio, n_audio, snr_db=snr)
            diag["noise"] = float(np.clip((32.0 - snr) / 32.0, 0.0, 1.0))
            meta = {"snr_db": snr}
        elif impair == 'clip':
            gain = random.uniform(6.0, 26.0)
            audio = simulate_clipping(clean_audio, gain_db=gain, clip_type='hard')
            diag["clipping"] = float(np.clip((gain - 4.0) / 20.0, 0.0, 1.0))
            meta = {"clip_gain_db": gain}
        elif impair == 'muffle':
            cutoff = random.uniform(1000, 3800)
            audio = simulate_muffle(clean_audio, cutoff=cutoff, order=2)
            diag["muffled"] = float(np.clip((4500.0 - cutoff) / 3300.0, 0.0, 1.0))
            meta = {"cutoff_hz": cutoff}
        elif impair == 'dropouts':
            loss = random.uniform(0.08, 0.40)
            audio = simulate_packet_loss(clean_audio, loss_rate=loss, frame_ms=20, burstiness=0.7, plc_type=random.choice(['zero', 'repeat']))
            diag["dropouts"] = float(np.clip(loss / 0.35, 0.0, 1.0))
            meta = {"packet_loss_rate": loss}
        else: # wind
            intensity = random.uniform(0.5, 1.2)
            audio = simulate_wind_blow(clean_audio, intensity=intensity, duration_s=random.uniform(0.5, 1.2), blow_only=False)
            diag["wind"] = float(np.clip(intensity / 1.0, 0.0, 1.0))
            meta = {"wind_intensity": intensity}
        meta.update(diag)

    # 5. Compound impairments
    else:
        audio = clean_audio.copy()
        chosen = random.sample(['noise', 'clip', 'muffle', 'dropouts', 'wind'], k=random.randint(2, 3))
        meta = {}
        if 'muffle' in chosen:
            cutoff = random.uniform(1400, 4200)
            audio = simulate_muffle(audio, cutoff=cutoff, order=2)
            diag["muffled"] = float(np.clip((4500.0 - cutoff) / 3300.0, 0.0, 1.0))
            meta["cutoff_hz"] = cutoff
        if 'clip' in chosen:
            gain = random.uniform(6.0, 20.0)
            audio = simulate_clipping(audio, gain_db=gain, clip_type='hard')
            diag["clipping"] = float(np.clip((gain - 4.0) / 20.0, 0.0, 1.0))
            meta["clip_gain_db"] = gain
        if 'dropouts' in chosen:
            loss = random.uniform(0.08, 0.32)
            audio = simulate_packet_loss(audio, loss_rate=loss, frame_ms=20, burstiness=0.7, plc_type='zero')
            diag["dropouts"] = float(np.clip(loss / 0.35, 0.0, 1.0))
            meta["packet_loss_rate"] = loss
        if 'wind' in chosen:
            intensity = random.uniform(0.4, 0.9)
            audio = simulate_wind_blow(audio, intensity=intensity, duration_s=0.7, blow_only=False)
            diag["wind"] = float(np.clip(intensity / 1.0, 0.0, 1.0))
            meta["wind_intensity"] = intensity
        if 'noise' in chosen:
            snr = random.uniform(2.0, 25.0)
            n_file = random.choice(noise_files)
            n_audio, orig_sr = sf.read(n_file, dtype='float32')
            if len(n_audio.shape) > 1: n_audio = n_audio[:, 0]
            if orig_sr != SR: n_audio = scipy.signal.resample_poly(n_audio, SR, orig_sr)
            if len(n_audio) < TARGET_SAMPLES: n_audio = np.pad(n_audio, (0, TARGET_SAMPLES - len(n_audio)))
            else: n_audio = n_audio[:TARGET_SAMPLES]
            audio = add_noise_at_snr(audio, n_audio, snr_db=snr)
            diag["noise"] = float(np.clip((32.0 - snr) / 32.0, 0.0, 1.0))
            meta["snr_db"] = snr
        meta.update(diag)

    mos, voice_prob, diag_arr, mos_mask = compute_teacher_label(
        clean_audio, audio, meta, vad_mask, speech_frac
    )
    return clean_audio, audio, mos, voice_prob, diag_arr, mos_mask, vad_mask, speech_frac

def build_cache(n_train=3000, n_val=350):
    splits = get_splits()
    train_clean = splits["train_clean"]
    train_noise = splits["train_noise"]
    val_clean = splits["val_clean"]
    val_noise = splits["val_noise"]

    with open(P("models/norm_stats.json")) as f:
        stats = json.load(f)
    mean = np.array(stats["mean"], dtype=np.float32)
    std = np.array(stats["std"], dtype=np.float32)

    print(f"Generating {n_train} training samples into memory cache...")
    t0 = time.time()
    
    train_feats = []
    train_mos = []
    train_vp = []
    train_diag = []
    train_mask = []
    
    train_pair_feats = []
    train_pair_mos = []
    train_pair_vp = []
    train_pair_diag = []
    train_pair_mask = []
    train_has_pair = []

    for i in range(n_train):
        clean, deg, mos, vp, diag, mask, vad_mask, speech_frac = generate_sample(train_clean, train_noise)
        f = (extract_features(deg) - mean) / (std + 1e-6)
        train_feats.append(f)
        train_mos.append([mos])
        train_vp.append([vp])
        train_diag.append(diag)
        train_mask.append([mask])
        
        # 50% pairs: create more degraded version of same sample
        if mask > 0.5 and random.random() < 0.50:
            deg_type = random.choice(['noise', 'packet_loss', 'clip', 'muffle'])
            diag_extra = {"noise": 0.0, "clipping": 0.0, "muffled": 0.0, "dropouts": 0.0, "wind": 0.0}
            meta_extra = {}
            if deg_type == 'noise':
                snr = random.uniform(0.0, 15.0)
                extra = add_noise_at_snr(deg, generate_pink_noise(len(deg)), snr_db=snr)
                diag_extra["noise"] = float(np.clip((32.0 - snr) / 32.0, 0.0, 1.0))
                meta_extra["snr_db"] = snr
            elif deg_type == 'packet_loss':
                loss = random.uniform(0.12, 0.40)
                extra = simulate_packet_loss(deg, loss_rate=loss, frame_ms=20, burstiness=0.7, plc_type='zero')
                diag_extra["dropouts"] = float(np.clip(loss / 0.35, 0.0, 1.0))
                meta_extra["packet_loss_rate"] = loss
            elif deg_type == 'clip':
                gain = random.uniform(8.0, 22.0)
                extra = simulate_clipping(deg, gain_db=gain, clip_type='hard')
                diag_extra["clipping"] = float(np.clip((gain - 4.0) / 20.0, 0.0, 1.0))
                meta_extra["clip_gain_db"] = gain
            else:
                cutoff = random.uniform(1000, 2500)
                extra = simulate_muffle(deg, cutoff=cutoff, order=2)
                diag_extra["muffled"] = float(np.clip((4500.0 - cutoff) / 3300.0, 0.0, 1.0))
                meta_extra["cutoff_hz"] = cutoff

            meta_extra.update(diag_extra)
            mos2, vp2, diag_arr2, mask2 = compute_teacher_label(clean, extra, meta_extra, vad_mask, speech_frac)
            # Ensure mos2 strictly <= mos
            mos2 = min(mos2, max(0.1, mos - random.uniform(0.2, 0.8)))

            f2 = (extract_features(extra) - mean) / (std + 1e-6)
            train_pair_feats.append(f2)
            train_pair_mos.append([mos2])
            train_pair_vp.append([vp2])
            train_pair_diag.append(diag_arr2)
            train_pair_mask.append([mask2])
            train_has_pair.append([1.0])
        else:
            train_pair_feats.append(np.zeros_like(f))
            train_pair_mos.append([0.0])
            train_pair_vp.append([0.0])
            train_pair_diag.append(np.zeros(5, dtype=np.float32))
            train_pair_mask.append([0.0])
            train_has_pair.append([0.0])

        if (i + 1) % 500 == 0:
            print(f"  Processed {i+1}/{n_train} in {time.time()-t0:.1f}s")

    print(f"Generating {n_val} validation samples...")
    val_feats = []
    val_mos = []
    val_vp = []
    val_diag = []
    val_mask = []

    for i in range(n_val):
        clean, deg, mos, vp, diag, mask, _, _ = generate_sample(val_clean, val_noise)
        f = (extract_features(deg) - mean) / (std + 1e-6)
        val_feats.append(f)
        val_mos.append([mos])
        val_vp.append([vp])
        val_diag.append(diag)
        val_mask.append([mask])

    train_data = {
        "features": torch.tensor(np.array(train_feats, dtype=np.float32)),
        "mos": torch.tensor(np.array(train_mos, dtype=np.float32)),
        "voice_prob": torch.tensor(np.array(train_vp, dtype=np.float32)),
        "diagnostics": torch.tensor(np.array(train_diag, dtype=np.float32)),
        "mos_mask": torch.tensor(np.array(train_mask, dtype=np.float32)),
        "pair_features": torch.tensor(np.array(train_pair_feats, dtype=np.float32)),
        "pair_mos": torch.tensor(np.array(train_pair_mos, dtype=np.float32)),
        "pair_voice_prob": torch.tensor(np.array(train_pair_vp, dtype=np.float32)),
        "pair_diagnostics": torch.tensor(np.array(train_pair_diag, dtype=np.float32)),
        "pair_mask": torch.tensor(np.array(train_pair_mask, dtype=np.float32)),
        "has_pair": torch.tensor(np.array(train_has_pair, dtype=np.float32)),
    }

    val_data = {
        "features": torch.tensor(np.array(val_feats, dtype=np.float32)),
        "mos": torch.tensor(np.array(val_mos, dtype=np.float32)),
        "voice_prob": torch.tensor(np.array(val_vp, dtype=np.float32)),
        "diagnostics": torch.tensor(np.array(val_diag, dtype=np.float32)),
        "mos_mask": torch.tensor(np.array(val_mask, dtype=np.float32)),
    }

    cache_path = P("models/dataset_cache.pt")
    torch.save({"train": train_data, "val": val_data}, cache_path)
    print(f"Cache generated successfully in {time.time()-t0:.1f}s: {cache_path}")
    print(f"Train size: {train_data['features'].shape}, Val size: {val_data['features'].shape}")

if __name__ == '__main__':
    build_cache(n_train=2500, n_val=300)
