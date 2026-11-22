import numpy as np
import torch
import torchaudio.functional as AF
import json
import os
from paths import P

SR = 16000
N_FFT = 512
HOP_LENGTH = 160
WIN_LENGTH = 512
N_MELS = 80
FMIN = 20.0
FMAX = 8000.0
TARGET_SAMPLES = 32000
TARGET_FRAMES = 201

# Symmetric Hann window
HANN_WINDOW = (0.5 * (1.0 - np.cos(2.0 * np.pi * np.arange(WIN_LENGTH) / (WIN_LENGTH - 1)))).astype(np.float32)

# Mel Basis (80, 257) from torchaudio
_fb = AF.melscale_fbanks(
    n_freqs=N_FFT // 2 + 1,
    f_min=FMIN,
    f_max=FMAX,
    n_mels=N_MELS,
    sample_rate=SR,
    norm="slaney",
    mel_scale="htk"
)
MEL_BASIS = _fb.numpy().T.astype(np.float32)  # (80, 257)

def export_mel_basis_json(output_path=P("web/mel_basis.json")):
    """Exports mel basis to JSON for exact JavaScript execution."""
    data = {
        "sr": SR,
        "n_fft": N_FFT,
        "n_mels": N_MELS,
        "fmin": FMIN,
        "fmax": FMAX,
        "mel_basis": MEL_BASIS.tolist()
    }
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(data, f)
    print(f"Exported mel basis to {output_path}")

def extract_features(audio):
    """
    Vectorized extraction of fixed (201, 85) feature matrix from 32,000 samples.
    Features:
      0..79: log-mel spectrogram (80 bins)
      80: RMS (dBFS)
      81: Spectral Flatness
      82: Zero-Crossing Rate
      83: High-band energy ratio (>= 4000 Hz)
      84: Spectral Flux
    """
    if len(audio) < TARGET_SAMPLES:
        audio = np.pad(audio, (0, TARGET_SAMPLES - len(audio)), mode='constant')
    elif len(audio) > TARGET_SAMPLES:
        audio = audio[:TARGET_SAMPLES]

    # Explicit reflect padding: 256 on left and right -> total 32512 samples
    pad_left = audio[1:257][::-1]
    pad_right = audio[-257:-1][::-1]
    padded = np.concatenate([pad_left, audio, pad_right])
    
    # Vectorized sliding window: (201, 512)
    windows = np.lib.stride_tricks.sliding_window_view(padded, WIN_LENGTH)[::HOP_LENGTH]
    assert windows.shape == (TARGET_FRAMES, WIN_LENGTH), f"Expected shape ({TARGET_FRAMES}, {WIN_LENGTH}), got {windows.shape}"

    # 1. RMS dB (from unwindowed raw frame)
    rms = np.sqrt(np.mean(windows ** 2, axis=-1, keepdims=True))
    rms_db = 20.0 * np.log10(np.maximum(rms, 1e-5))

    # 2. Zero-crossing rate
    signs = (windows >= 0).astype(np.int8)
    zcr = np.mean(np.abs(signs[:, 1:] - signs[:, :-1]), axis=-1, keepdims=True).astype(np.float32)

    # 3. FFT with Hann window
    windowed = windows * HANN_WINDOW
    fft_vals = np.fft.rfft(windowed, n=N_FFT, axis=-1)
    mag = np.abs(fft_vals).astype(np.float32)  # (201, 257)
    power = mag ** 2

    # 4. Spectral Flatness
    mean_power = np.mean(power, axis=-1, keepdims=True) + 1e-10
    geom_power = np.exp(np.mean(np.log(power + 1e-10), axis=-1, keepdims=True))
    flatness = (geom_power / mean_power).astype(np.float32)

    # 5. High-band energy ratio (>= 4000 Hz, bins 128 to 256)
    high_power = np.sum(power[:, 128:], axis=-1, keepdims=True)
    total_power = np.sum(power, axis=-1, keepdims=True) + 1e-10
    high_band = (high_power / total_power).astype(np.float32)

    # 6. Spectral flux (L1 norm of normalized magnitude difference)
    mag_sum = np.sum(mag, axis=-1, keepdims=True) + 1e-5
    mag_norm = mag / mag_sum
    flux = np.zeros((TARGET_FRAMES, 1), dtype=np.float32)
    flux[1:] = np.sum(np.abs(mag_norm[1:] - mag_norm[:-1]), axis=-1, keepdims=True)

    # 7. Mel spectrum (201, 80)
    mel = np.dot(mag, MEL_BASIS.T)
    log_mel = np.log(np.maximum(mel, 1e-5))

    features = np.concatenate([log_mel, rms_db, flatness, zcr, high_band, flux], axis=-1)
    return features.astype(np.float32)

if __name__ == '__main__':
    import time
    dummy = np.random.randn(32000).astype(np.float32) * 0.1
    t0 = time.time()
    for _ in range(50):
        f = extract_features(dummy)
    t1 = time.time()
    print(f"Vectorized feature extraction: {f.shape}, dtype={f.dtype}, time per 2s clip: {(t1 - t0)/50*1000:.2f} ms")
    export_mel_basis_json()
