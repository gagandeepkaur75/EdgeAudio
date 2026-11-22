import os
import glob
import soundfile as sf
import numpy as np
import scipy.signal

from paths import P
from degradations import (
    simulate_clipping,
    simulate_muffle,
    simulate_packet_loss,
    simulate_wind_blow,
    simulate_natural_pause,
    add_noise_at_snr,
    generate_pink_noise
)

SR = 16000
SAMPLE_DIR = P("web/samples")
os.makedirs(SAMPLE_DIR, exist_ok=True)

def create_demo_samples():
    print("Generating pre-bundled demo WAV samples...")
    # Find clean speech file from test set
    clean_files = sorted(glob.glob(P("data/clean_speech/*/*.flac")))
    if not clean_files:
        print("Error: clean speech files not found.")
        return

    # Select clean speech file with clear speech (around 5 seconds long)
    chosen_file = None
    for f in clean_files:
        info = sf.info(f)
        if 4.0 <= info.duration <= 8.0:
            chosen_file = f
            break
    if not chosen_file:
        chosen_file = clean_files[0]
        
    audio, orig_sr = sf.read(chosen_file, dtype='float32')
    if len(audio.shape) > 1:
        audio = audio[:, 0]
    if orig_sr != SR:
        audio = scipy.signal.resample_poly(audio, SR, orig_sr)
        
    # Trim to 4.0s (64,000 samples)
    n_samples = 64000
    if len(audio) < n_samples:
        audio = np.tile(audio, int(np.ceil(n_samples / len(audio))))
    audio = audio[:n_samples]
    
    # Normalize clean audio to -20 dBFS
    rms = np.sqrt(np.mean(audio ** 2) + 1e-12)
    target_rms = 10.0 ** (-20.0 / 20.0)
    audio = audio * (target_rms / rms)

    # 1. Clean speech
    clean = audio.copy()
    sf.write(os.path.join(SAMPLE_DIR, "clean.wav"), clean, SR)
    print("  Created clean.wav")

    # 2. Noisy speech (SNR 8 dB with babble/pink noise)
    noise = generate_pink_noise(len(audio))
    noisy = add_noise_at_snr(audio, noise, snr_db=8.0)
    sf.write(os.path.join(SAMPLE_DIR, "noisy.wav"), noisy, SR)
    print("  Created noisy.wav")

    # 3. Clipped speech (+18 dB overdrive hard clipping)
    clipped = simulate_clipping(audio, gain_db=18.0, clip_type='hard')
    sf.write(os.path.join(SAMPLE_DIR, "clipped.wav"), clipped, SR)
    print("  Created clipped.wav")

    # 4. Muffled speech (1500 Hz low-pass filter, hand over mic)
    muffled = simulate_muffle(audio, cutoff=1500, order=3, hand_over_mic=True)
    sf.write(os.path.join(SAMPLE_DIR, "muffled.wav"), muffled, SR)
    print("  Created muffled.wav")

    # 5. Packet loss / dropouts (25% bursty loss, 20ms frames, digital zeros)
    lossy = simulate_packet_loss(audio, loss_rate=0.25, frame_ms=20, burstiness=0.75, plc_type='zero')
    sf.write(os.path.join(SAMPLE_DIR, "lossy.wav"), lossy, SR)
    print("  Created lossy.wav")

    # 6. Natural conversational pauses (smooth decay, room tone continuous)
    # Pause in middle (1.0s)
    pauses = simulate_natural_pause(audio, pause_duration_s=1.0)
    sf.write(os.path.join(SAMPLE_DIR, "pauses.wav"), pauses, SR)
    print("  Created pauses.wav")

    # 7. Blow only (heavy wind breath blast, no speech)
    blow = simulate_wind_blow(np.zeros_like(audio), intensity=0.9, duration_s=1.5, blow_only=True)
    sf.write(os.path.join(SAMPLE_DIR, "blow_only.wav"), blow, SR)
    print("  Created blow_only.wav")

    # 8. Room tone / silence
    silence = np.random.randn(len(audio)).astype(np.float32) * (10.0 ** (-58.0 / 20.0))
    sf.write(os.path.join(SAMPLE_DIR, "silence.wav"), silence, SR)
    print("  Created silence.wav")

    print("All demo samples generated successfully!")

if __name__ == '__main__':
    create_demo_samples()
