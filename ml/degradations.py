import numpy as np
import scipy.signal
import random

SR = 16000

def generate_pink_noise(n_samples):
    white = np.random.randn(n_samples)
    X = np.fft.rfft(white)
    freqs = np.fft.rfftfreq(n_samples, d=1.0/SR)
    freqs[0] = freqs[1]
    S = 1.0 / np.sqrt(freqs)
    S /= np.sqrt(np.mean(S**2))
    pink = np.fft.irfft(X * S, n=n_samples)
    return pink.astype(np.float32)

def generate_brown_noise(n_samples):
    white = np.random.randn(n_samples)
    brown = np.cumsum(white)
    brown -= np.mean(brown)
    rms = np.sqrt(np.mean(brown**2)) + 1e-8
    return (brown / rms).astype(np.float32)

def generate_synthetic_rir(sr=16000, rt60=0.3):
    n_samples = int(sr * max(rt60, 0.05))
    t = np.arange(n_samples) / sr
    decay_rate = 3.0 * np.log(10.0) / max(rt60, 0.05)
    decay = np.exp(-decay_rate * t)
    tail = np.random.randn(n_samples) * decay
    ir = np.zeros(n_samples, dtype=np.float32)
    ir[0] = 1.0
    for _ in range(random.randint(3, 7)):
        delay = int(sr * random.uniform(0.005, 0.040))
        if delay < n_samples:
            ir[delay] += random.choice([-1, 1]) * random.uniform(0.2, 0.5) * np.exp(-decay_rate * (delay / sr))
    ir += tail * 0.35
    ir /= np.sqrt(np.sum(ir**2) + 1e-8)
    return ir.astype(np.float32)

def simulate_reverb(audio, rt60=0.3):
    rir = generate_synthetic_rir(SR, rt60=rt60)
    rev = scipy.signal.fftconvolve(audio, rir, mode='full')[:len(audio)]
    drr = random.uniform(0.35, 0.85)
    return (drr * audio + (1.0 - drr) * rev).astype(np.float32)

def simulate_muffle(audio, cutoff=2500, order=2, hand_over_mic=False):
    cutoff = min(max(cutoff, 800), 7500)
    sos = scipy.signal.butter(order, cutoff, btype='lowpass', fs=SR, output='sos')
    muffled = scipy.signal.sosfilt(sos, audio)
    if hand_over_mic:
        sos_shelf = scipy.signal.butter(1, 1400, btype='lowpass', fs=SR, output='sos')
        shelf = scipy.signal.sosfilt(sos_shelf, audio)
        muffled = 0.65 * muffled + 0.35 * shelf
    return muffled.astype(np.float32)

def simulate_clipping(audio, gain_db=12.0, clip_type='hard'):
    gain = 10.0 ** (gain_db / 20.0)
    boosted = audio * gain
    if clip_type == 'hard':
        clipped = np.clip(boosted, -1.0, 1.0)
    elif clip_type == 'soft':
        clipped = np.tanh(boosted)
    elif clip_type == 'asymmetric':
        clipped = np.clip(boosted, -0.85, 0.65)
    else:
        clipped = np.clip(boosted, -1.0, 1.0)
    return clipped.astype(np.float32)

def simulate_packet_loss(audio, loss_rate=0.15, frame_ms=20, burstiness=0.6, plc_type='zero'):
    frame_len = int(SR * (frame_ms / 1000.0))
    n_frames = len(audio) // frame_len
    if n_frames == 0 or loss_rate <= 0.001:
        return audio.copy()
        
    q = max(0.05, 1.0 - burstiness)
    p = loss_rate * q / (1.0 - loss_rate + 1e-8)
    state = 0
    out = audio.copy()
    last_frame = np.zeros(frame_len, dtype=np.float32)
    
    for i in range(n_frames):
        start = i * frame_len
        end = start + frame_len
        if state == 0:
            if random.random() < p: state = 1
        else:
            if random.random() < q: state = 0
                
        if state == 1:
            if plc_type == 'zero':
                out[start:end] = 0.0
            elif plc_type == 'repeat':
                out[start:end] = last_frame * 0.85
            elif plc_type == 'fade':
                fade = np.linspace(1.0, 0.0, frame_len, endpoint=False)
                out[start:end] = last_frame * fade
        else:
            last_frame = audio[start:end].copy()
            
    return out.astype(np.float32)

def simulate_wind_blow(audio, intensity=0.7, duration_s=0.7, blow_only=False):
    n_samples = len(audio)
    noise = generate_pink_noise(n_samples)
    sos = scipy.signal.butter(3, [40, 350], btype='bandpass', fs=SR, output='sos')
    low_wind = scipy.signal.sosfilt(sos, noise)
    
    burst_len = int(SR * duration_s)
    burst_start = random.randint(0, max(0, n_samples - burst_len))
    env = np.zeros(n_samples, dtype=np.float32)
    attack = int(SR * 0.03)
    decay = burst_len - attack
    if decay > 0:
        puff = np.concatenate([np.linspace(0, 1, attack), np.exp(-3.0 * np.arange(decay) / decay)])
        env[burst_start : burst_start + len(puff)] = puff
        
    wind_sig = low_wind * env * intensity
    if blow_only:
        return wind_sig.astype(np.float32)
    return (audio + wind_sig).astype(np.float32)

def simulate_natural_pause(audio, pause_duration_s=0.5, noise_floor_rms=0.002):
    """HARD NEGATIVE: Smooth conversational pause with persistent room tone."""
    n_samples = len(audio)
    pause_len = int(SR * min(pause_duration_s, 1.1))
    if pause_len >= n_samples - 2000:
        pause_len = n_samples // 2
        
    start = random.randint(1000, n_samples - pause_len - 1000)
    out = audio.copy()
    
    fade_len = int(SR * 0.035)
    fade_out = 0.5 * (1.0 + np.cos(np.pi * np.arange(fade_len) / fade_len))
    fade_in = 0.5 * (1.0 - np.cos(np.pi * np.arange(fade_len) / fade_len))
    
    room = np.random.randn(pause_len) * noise_floor_rms
    sos = scipy.signal.butter(1, 900, btype='lowpass', fs=SR, output='sos')
    room = scipy.signal.sosfilt(sos, room)
    
    out[start : start + fade_len] = out[start : start + fade_len] * fade_out + room[:fade_len] * (1.0 - fade_out)
    out[start + fade_len : start + pause_len - fade_len] = room[fade_len : pause_len - fade_len]
    out[start + pause_len - fade_len : start + pause_len] = out[start + pause_len - fade_len : start + pause_len] * fade_in + room[pause_len - fade_len : pause_len] * (1.0 - fade_in)
    return out.astype(np.float32)

def add_noise_at_snr(speech, noise, snr_db):
    sp = np.mean(speech ** 2) + 1e-12
    np_p = np.mean(noise ** 2) + 1e-12
    target_p = sp / (10.0 ** (snr_db / 10.0))
    scale = np.sqrt(target_p / np_p)
    return (speech + noise * scale).astype(np.float32)

def apply_random_degradation_chain(clean_speech, noise_clips=None):
    """
    Balanced degradation sampler guaranteeing equal representation across:
      1. Clean Speech Anchors (25%)
      2. Isolated Single Impairments (25%)
      3. Compound Impairments (35%)
      4. Non-Speech Hard Negatives (15%)
    """
    audio = clean_speech.copy()
    diag = {
        "noise": 0.0, "clipping": 0.0, "muffled": 0.0, "dropouts": 0.0, "wind": 0.0,
        "reverb_rt60": 0.0, "snr_db": 50.0, "packet_loss_rate": 0.0, "clip_gain_db": 0.0,
        "cutoff_hz": 8000.0, "is_natural_pause": False, "is_blow_only": False, "is_silence": False
    }

    mode_rnd = random.random()

    # -------------------------------------------------------------
    # 1. CLEAN SPEECH ANCHORS (25%) -> MOS 4.6 - 4.9
    # -------------------------------------------------------------
    if mode_rnd < 0.25:
        sub = random.random()
        if sub < 0.40:
            # Studio clean (-24 to -18 dBFS)
            gain = 10.0 ** (random.uniform(-24.0, -18.0) / 20.0)
            audio = audio / (np.sqrt(np.mean(audio**2)) + 1e-8) * gain
        elif sub < 0.70:
            # Quiet but clean speech (-42 to -30 dBFS)
            gain = 10.0 ** (random.uniform(-42.0, -30.0) / 20.0)
            audio = audio / (np.sqrt(np.mean(audio**2)) + 1e-8) * gain
            room = np.random.randn(len(audio)) * (10.0 ** (-58.0 / 20.0))
            audio = audio + room
        else:
            # Natural conversational pause inserted
            diag["is_natural_pause"] = True
            audio = simulate_natural_pause(audio, pause_duration_s=random.uniform(0.3, 0.8))
        return audio.astype(np.float32), diag

    # -------------------------------------------------------------
    # 2. NON-SPEECH HARD NEGATIVES (15%) -> voice_prob ~ 0, target "_"
    # -------------------------------------------------------------
    elif mode_rnd < 0.40:
        sub = random.random()
        if sub < 0.40:
            # Room silence / quiet tone
            diag["is_silence"] = True
            diag["noise"] = random.uniform(0.0, 0.15)
            level = random.uniform(-65.0, -48.0)
            audio = np.random.randn(len(audio)) * (10.0 ** (level / 20.0))
        elif sub < 0.75:
            # Wind / breath puff only (no speech)
            diag["is_blow_only"] = True
            diag["wind"] = random.uniform(0.6, 1.0)
            audio = simulate_wind_blow(audio, intensity=random.uniform(0.6, 1.2), blow_only=True)
        else:
            # Background noise only (typing, fan, cafe, rain from ESC-50)
            diag["is_silence"] = True
            diag["noise"] = random.uniform(0.3, 0.8)
            if noise_clips and len(noise_clips) > 0:
                import soundfile as sf
                n_file = random.choice(noise_clips)
                n_audio, n_sr = sf.read(n_file, dtype='float32')
                if len(n_audio.shape) > 1: n_audio = n_audio[:, 0]
                if n_sr != SR: n_audio = scipy.signal.resample_poly(n_audio, SR, n_sr)
                if len(n_audio) < len(audio): n_audio = np.tile(n_audio, int(np.ceil(len(audio)/len(n_audio))))
                start_n = random.randint(0, len(n_audio) - len(audio))
                audio = n_audio[start_n : start_n + len(audio)] * 0.2
            else:
                audio = generate_pink_noise(len(audio)) * 0.05
        return audio.astype(np.float32), diag

    # -------------------------------------------------------------
    # 3. ISOLATED SINGLE IMPAIRMENTS (25%) -> Explicit Diagnostic Supervision
    # -------------------------------------------------------------
    elif mode_rnd < 0.65:
        target_impairment = random.choice(['noise', 'clip', 'muffle', 'packet_loss', 'wind'])
        
        if target_impairment == 'noise':
            snr = random.uniform(0.0, 28.0)
            n = generate_pink_noise(len(audio))
            audio = add_noise_at_snr(audio, n, snr)
            diag["snr_db"] = snr
            diag["noise"] = float(np.clip((30.0 - snr) / 30.0, 0.0, 1.0))

        elif target_impairment == 'clip':
            gain_db = random.uniform(6.0, 24.0)
            audio = simulate_clipping(audio, gain_db=gain_db, clip_type='hard')
            diag["clip_gain_db"] = gain_db
            diag["clipping"] = float(np.clip((gain_db - 4.0) / 20.0, 0.0, 1.0))

        elif target_impairment == 'muffle':
            cutoff = random.uniform(1100, 4200)
            audio = simulate_muffle(audio, cutoff=cutoff, order=2)
            diag["cutoff_hz"] = cutoff
            diag["muffled"] = float(np.clip((5000.0 - cutoff) / 3800.0, 0.0, 1.0))

        elif target_impairment == 'packet_loss':
            loss = random.uniform(0.08, 0.38)
            audio = simulate_packet_loss(audio, loss_rate=loss, frame_ms=20, burstiness=0.7, plc_type='zero')
            diag["packet_loss_rate"] = loss
            diag["dropouts"] = float(np.clip(loss / 0.35, 0.0, 1.0))

        elif target_impairment == 'wind':
            intensity = random.uniform(0.4, 1.1)
            audio = simulate_wind_blow(audio, intensity=intensity, duration_s=random.uniform(0.4, 1.0), blow_only=False)
            diag["wind"] = float(np.clip(intensity / 1.0, 0.0, 1.0))

        return audio.astype(np.float32), diag

    # -------------------------------------------------------------
    # 4. COMPOUND IMPAIRMENTS (35%) -> Mixed Realistic Networks & Environments
    # -------------------------------------------------------------
    else:
        chosen = random.sample(['reverb', 'muffle', 'clip', 'packet_loss', 'noise', 'wind'], k=random.randint(2, 3))
        
        if 'reverb' in chosen:
            rt60 = random.uniform(0.2, 0.9)
            audio = simulate_reverb(audio, rt60=rt60)
            diag["reverb_rt60"] = rt60

        if 'muffle' in chosen:
            cutoff = random.uniform(1400, 4800)
            audio = simulate_muffle(audio, cutoff=cutoff, order=2)
            diag["cutoff_hz"] = cutoff
            diag["muffled"] = float(np.clip((5000.0 - cutoff) / 3800.0, 0.0, 1.0))

        if 'clip' in chosen:
            gain_db = random.uniform(5.0, 20.0)
            audio = simulate_clipping(audio, gain_db=gain_db, clip_type='hard')
            diag["clip_gain_db"] = gain_db
            diag["clipping"] = float(np.clip((gain_db - 4.0) / 20.0, 0.0, 1.0))

        if 'packet_loss' in chosen:
            loss = random.uniform(0.06, 0.32)
            audio = simulate_packet_loss(audio, loss_rate=loss, frame_ms=20, burstiness=0.7, plc_type='zero')
            diag["packet_loss_rate"] = loss
            diag["dropouts"] = float(np.clip(loss / 0.35, 0.0, 1.0))

        if 'wind' in chosen:
            intensity = random.uniform(0.3, 0.8)
            audio = simulate_wind_blow(audio, intensity=intensity, duration_s=0.6, blow_only=False)
            diag["wind"] = float(np.clip(intensity / 1.0, 0.0, 1.0))

        if 'noise' in chosen:
            snr = random.uniform(-2.0, 28.0)
            n = generate_pink_noise(len(audio))
            audio = add_noise_at_snr(audio, n, snr)
            diag["snr_db"] = snr
            diag["noise"] = float(np.clip((30.0 - snr) / 30.0, 0.0, 1.0))

        return audio.astype(np.float32), diag
