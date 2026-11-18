import numpy as np
import scipy.signal

SR = 16000

def compute_clean_vad(clean_audio, sr=16000, frame_len=320, hop_len=160):
    """
    Computes frame-level VAD on clean reference audio.
    Uses speech-band (200-4000 Hz) energy and spectral centroid.
    Returns: vad_frames (binary 0/1 array for each 10 ms hop), speech_fraction
    """
    # Bandpass filter speech band: 200 - 4000 Hz
    sos = scipy.signal.butter(2, [200, 3800], btype='bandpass', fs=sr, output='sos')
    speech_band = scipy.signal.sosfilt(sos, clean_audio)
    
    n_frames = (len(clean_audio) - frame_len) // hop_len + 1
    energies = []
    
    for i in range(n_frames):
        start = i * hop_len
        frame = speech_band[start : start + frame_len]
        rms = np.sqrt(np.mean(frame ** 2) + 1e-12)
        energies.append(rms)
        
    energies = np.array(energies)
    # Energy in dB
    db = 20.0 * np.log10(np.maximum(energies, 1e-6))
    
    # Adaptive threshold: 18 dB above lowest 10th percentile energy, with min -48 dBFS
    noise_floor = np.percentile(db, 10)
    thresh = max(noise_floor + 18.0, -48.0)
    
    vad_frames = (db > thresh).astype(np.float32)
    # Hangover smoothing: hold active for 150 ms (15 frames)
    smoothed = vad_frames.copy()
    for i in range(len(vad_frames)):
        if vad_frames[i] > 0.5:
            smoothed[i : min(len(smoothed), i + 15)] = 1.0
            
    speech_fraction = float(np.mean(smoothed))
    return smoothed, speech_fraction

def compute_intrusive_distortion(clean, degraded, vad_mask=None):
    """
    Computes perceptual spectral distance and segmental SNR on speech-active frames.
    """
    # Align lengths
    min_len = min(len(clean), len(degraded))
    clean = clean[:min_len]
    degraded = degraded[:min_len]
    
    # Short-time frames (20 ms, 50% overlap)
    win_len = 320
    hop = 160
    n_frames = (min_len - win_len) // hop + 1
    if n_frames <= 0:
        return 0.0, 30.0
        
    snr_list = []
    spec_dist_list = []
    
    hann = 0.5 * (1.0 - np.cos(2.0 * np.pi * np.arange(win_len) / (win_len - 1)))
    
    for i in range(n_frames):
        start = i * hop
        c_frame = clean[start : start + win_len]
        d_frame = degraded[start : start + win_len]
        
        # Check VAD
        c_power = np.mean(c_frame ** 2)
        if c_power < 1e-6:
            continue
            
        noise_power = np.mean((c_frame - d_frame) ** 2) + 1e-12
        frame_snr = 10.0 * np.log10(c_power / noise_power)
        frame_snr = max(-10.0, min(35.0, frame_snr))
        snr_list.append(frame_snr)
        
        # FFT magnitude
        C_mag = np.abs(np.fft.rfft(c_frame * hann))
        D_mag = np.abs(np.fft.rfft(d_frame * hann))
        
        # Log spectral distance
        diff = np.mean(np.abs(np.log(C_mag + 1e-5) - np.log(D_mag + 1e-5)))
        spec_dist_list.append(diff)
        
    avg_snr = np.mean(snr_list) if len(snr_list) > 0 else 0.0
    avg_dist = np.mean(spec_dist_list) if len(spec_dist_list) > 0 else 5.0
    return avg_dist, avg_snr

def compute_teacher_label(clean, degraded, metadata, vad_mask=None, speech_frac=1.0):
    """
    Computes calibrated continuous pseudo-MOS in [0.0, 5.0], voice_prob in [0, 1],
    and diagnostic targets in [0, 1].
    Follows ITU P.808 / P.835 scale calibration and anchors.
    """
    # 1. Voice probability target
    if metadata.get("is_silence", False) or metadata.get("is_blow_only", False):
        voice_prob = 0.0
        mos_mask = 0.0
        base_mos = 0.0  # masked
    else:
        # Window speech presence
        voice_prob = 1.0 if speech_frac >= 0.15 else float(speech_frac / 0.15)
        voice_prob = min(1.0, max(0.0, voice_prob))
        mos_mask = 1.0 if voice_prob >= 0.5 else 0.0

    # 2. Diagnostics
    diag_targets = np.array([
        metadata.get("noise", 0.0),
        metadata.get("clipping", 0.0),
        metadata.get("muffled", 0.0),
        metadata.get("dropouts", 0.0),
        metadata.get("wind", 0.0)
    ], dtype=np.float32)

    if mos_mask <= 0.0:
        return 0.0, voice_prob, diag_targets, mos_mask

    # 3. MOS calculation on speech-active segments
    # Hard negative check: natural pause must NOT reduce MOS!
    if metadata.get("is_natural_pause", False):
        # Anchor high quality: 4.55 - 4.80
        mos = 4.68
        return mos, voice_prob, diag_targets, mos_mask

    # Clean anchor
    if metadata.get("is_clean", False):
        return 4.78, 1.0, np.zeros(5, dtype=np.float32), 1.0

    base_anchor = 4.78
    
    # Intrusive distortion metric
    spec_dist, seg_snr = compute_intrusive_distortion(clean, degraded, vad_mask)
    # Map intrusive to 1-5 scale
    intrusive_mos = 1.0 + 3.8 / (1.0 + np.exp((spec_dist - 1.2) * 2.2))
    
    # Parametric penalty floor based on known physical degradation chain
    penalties = 0.0
    
    # Noise penalty
    snr = metadata.get("snr_db", 50.0)
    if snr < 40.0:
        pen_snr = 3.6 / (1.0 + np.exp((snr - 7.0) / 6.0))
        penalties += pen_snr
        
    # Packet loss penalty
    loss = metadata.get("packet_loss_rate", 0.0)
    if loss > 0.001:
        pen_loss = 3.8 * min(1.0, (loss / 0.35) ** 0.85)
        penalties += pen_loss
        
    # Clipping penalty
    clip_gain = metadata.get("clip_gain_db", 0.0)
    if clip_gain > 3.0:
        pen_clip = 3.2 * min(1.0, ((clip_gain - 3.0) / 18.0) ** 1.1)
        penalties += pen_clip
        
    # Muffling penalty
    cutoff = metadata.get("cutoff_hz", 8000.0)
    if cutoff < 6000.0:
        pen_muffle = 3.2 * min(1.0, ((6000.0 - cutoff) / 4500.0) ** 1.2)
        penalties += pen_muffle
        
    # Reverb penalty
    rt60 = metadata.get("reverb_rt60", 0.0)
    if rt60 > 0.15:
        pen_reverb = 1.8 * min(1.0, ((rt60 - 0.15) / 1.0) ** 0.9)
        penalties += pen_reverb
        
    # Wind penalty
    wind = metadata.get("wind", 0.0)
    if wind > 0.05:
        pen_wind = 2.4 * wind
        penalties += pen_wind

    param_mos = max(0.1, base_anchor - penalties)
    
    # Combined & calibrated teacher score
    combined = 0.55 * param_mos + 0.45 * intrusive_mos
    
    # Anchors clamping & smoothing
    # Clean speech anchor: >= 4.5
    # Extreme degradation penalty floor: <= 0.6
    if penalties >= 3.6 or snr <= -2.0 or loss >= 0.35:
        combined = min(combined, 0.7)
        
    final_mos = float(np.clip(combined, 0.1, 4.95))
    return final_mos, voice_prob, diag_targets, mos_mask
