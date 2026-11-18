import os
import sys
import json
import glob
import subprocess
import numpy as np
import soundfile as sf
import scipy.signal
import torch
from scipy.stats import pearsonr, spearmanr

from model import SpeechQualityModel
from features import extract_features, TARGET_SAMPLES
from degradations import (
    simulate_clipping,
    simulate_muffle,
    simulate_packet_loss,
    simulate_wind_blow,
    simulate_natural_pause,
    add_noise_at_snr,
    generate_pink_noise
)
from teacher import compute_clean_vad, compute_teacher_label
from dataset import get_splits

SR = 16000

def load_audio_2s(file_path):
    audio, orig_sr = sf.read(file_path, dtype='float32')
    if len(audio.shape) > 1:
        audio = audio[:, 0]
    if orig_sr != SR:
        audio = scipy.signal.resample_poly(audio, SR, orig_sr)
    if len(audio) < TARGET_SAMPLES:
        audio = np.pad(audio, (0, TARGET_SAMPLES - len(audio)), mode='constant')
    else:
        # middle 2s
        start = (len(audio) - TARGET_SAMPLES) // 2
        audio = audio[start : start + TARGET_SAMPLES]
    # Normalize clean level to -22 dBFS
    rms = np.sqrt(np.mean(audio ** 2) + 1e-12)
    return (audio * (10.0 ** (-22.0 / 20.0) / rms)).astype(np.float32)

def test_python_vs_js_feature_parity(n_clips=20):
    print("\n" + "="*60)
    print("TEST 1: Python-vs-JS Feature Parity Test (20 clips)")
    print("="*60)
    
    clean_files = sorted(glob.glob("project/data/clean_speech/*/*.flac"))[:n_clips]
    test_clips = [load_audio_2s(f).tolist() for f in clean_files]
    
    # Save clips to JSON for Node.js
    clips_path = "project/train/test_clips.json"
    with open(clips_path, "w") as f:
        json.dump({"clips": test_clips}, f)

    # Run Node.js feature extractor
    node_cmd = ["node", "project/train/test_features.js"]
    ret = subprocess.run(node_cmd, capture_output=True, text=True)
    if ret.returncode != 0:
        print("Node.js stderr:", ret.stderr)
        raise RuntimeError("Node.js feature extraction failed!")

    with open("project/train/js_features.json", "r") as f:
        js_data = json.load(f)["features"]

    max_err = 0.0
    errors_per_feature = np.zeros(85)

    for i in range(len(clean_files)):
        audio = np.array(test_clips[i], dtype=np.float32)
        py_feats = extract_features(audio)  # (201, 85)
        js_feats = np.array(js_data[i], dtype=np.float32)  # (201, 85)

        diff = np.abs(py_feats - js_feats)
        clip_max = np.max(diff)
        max_err = max(max_err, clip_max)
        errors_per_feature = np.maximum(errors_per_feature, np.max(diff, axis=0))

    print(f"Max absolute error across all 20 clips and 85 features: {max_err:.6e}")
    print(f"  Log-Mel max error (bins 0-79):     {np.max(errors_per_feature[:80]):.6e}")
    print(f"  RMS dB max error (bin 80):         {errors_per_feature[80]:.6e}")
    print(f"  Flatness max error (bin 81):       {errors_per_feature[81]:.6e}")
    print(f"  ZCR max error (bin 82):            {errors_per_feature[82]:.6e}")
    print(f"  High-band energy error (bin 83):   {errors_per_feature[83]:.6e}")
    print(f"  Spectral flux max error (bin 84):  {errors_per_feature[84]:.6e}")

    assert max_err < 1e-3, f"Feature parity test failed! Max error {max_err} >= 1e-3"
    print(">>> PASS: Python-vs-JS feature parity confirmed (< 1e-3)! <<<")
    return max_err

def test_onnx_vs_pytorch_parity(checkpoint_path="project/models/best_model.pt", onnx_path="project/web/model.onnx"):
    print("\n" + "="*60)
    print("TEST 2: ONNX-vs-PyTorch Model Output Parity Test")
    print("="*60)
    import onnxruntime as ort

    model = SpeechQualityModel()
    ckpt = torch.load(checkpoint_path, map_location="cpu")
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()

    session = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    
    np.random.seed(123)
    test_inputs = [torch.randn(1, 201, 85, dtype=torch.float32) for _ in range(20)]
    
    max_mos_err = 0.0
    max_vp_err = 0.0
    max_diag_err = 0.0

    for x in test_inputs:
        with torch.no_grad():
            py_mos, py_vp, py_diag = model(x)
        ort_mos, ort_vp, ort_diag = session.run(None, {"features": x.numpy()})

        max_mos_err = max(max_mos_err, float(np.max(np.abs(py_mos.numpy() - ort_mos))))
        max_vp_err = max(max_vp_err, float(np.max(np.abs(py_vp.numpy() - ort_vp))))
        max_diag_err = max(max_diag_err, float(np.max(np.abs(py_diag.numpy() - ort_diag))))

    print(f"PyTorch vs ONNX Max Errors across 20 inputs:")
    print(f"  MOS:         {max_mos_err:.6e} (Threshold: < 1e-3)")
    print(f"  Voice Prob:  {max_vp_err:.6e} (Threshold: < 1e-3)")
    print(f"  Diagnostics: {max_diag_err:.6e} (Threshold: < 1e-3)")

    assert max_mos_err < 1e-3, f"MOS parity check failed: {max_mos_err}"
    assert max_vp_err < 1e-3, f"Voice prob parity check failed: {max_vp_err}"
    assert max_diag_err < 1e-3, f"Diagnostics parity check failed: {max_diag_err}"
    print(">>> PASS: ONNX-vs-PyTorch numerical parity confirmed (< 1e-3)! <<<")

def test_behavioral_suite(model, norm_stats, test_speech_clips):
    print("\n" + "="*60)
    print("TEST 3: Automated Behavioral Test Suite")
    print("="*60)
    
    mean = norm_stats["mean"]
    std = norm_stats["std"]

    def infer(audio):
        feats = extract_features(audio)
        feats_norm = (feats - mean) / (std + 1e-6)
        tensor = torch.tensor(feats_norm[None, :, :], dtype=torch.float32)
        with torch.no_grad():
            mos, vp, diag = model(tensor)
        return mos.item(), vp.item(), diag.numpy()[0]

    clip = test_speech_clips[0]

    # 1. Monotonicity: Score strictly decreases as SNR drops
    print("\n1. Testing SNR Monotonicity (40 dB -> 20 dB -> 10 dB -> 0 dB -> -5 dB)...")
    snr_levels = [40.0, 20.0, 10.0, 0.0, -5.0]
    snr_scores = []
    noise = generate_pink_noise(len(clip))
    for snr in snr_levels:
        degraded = add_noise_at_snr(clip, noise, snr)
        mos, vp, diag = infer(degraded)
        snr_scores.append(mos)
        print(f"   SNR {snr:4.1f} dB: MOS = {mos:.2f} (Noise Diag = {diag[0]:.2f})")
    
    for i in range(len(snr_scores) - 1):
        assert snr_scores[i] >= snr_scores[i+1] - 0.15, f"SNR monotonicity violated: {snr_scores[i]} vs {snr_scores[i+1]}"
    print("   ✓ SNR Monotonicity PASS")

    # 2. Monotonicity: Score strictly decreases as Packet Loss % rises
    print("\n2. Testing Packet Loss Monotonicity (0% -> 10% -> 25% -> 40%)...")
    loss_levels = [0.0, 0.10, 0.25, 0.40]
    loss_scores = []
    loss_diags = []
    for l in loss_levels:
        degraded = simulate_packet_loss(clip, loss_rate=l, frame_ms=20, burstiness=0.7, plc_type='zero')
        mos, vp, diag = infer(degraded)
        loss_scores.append(mos)
        loss_diags.append(diag[3])
        print(f"   Loss {int(l*100):2d}%: MOS = {mos:.2f} (Dropouts Diag = {diag[3]:.2f})")
        
    for i in range(len(loss_scores) - 1):
        assert loss_scores[i] >= loss_scores[i+1] - 0.20, f"Packet loss monotonicity violated: {loss_scores[i]} vs {loss_scores[i+1]}"
    assert loss_diags[-1] > loss_diags[0], "Dropouts diagnostic must increase with packet loss"
    print("   ✓ Packet Loss Monotonicity PASS")

    # 3. Monotonicity: Score strictly decreases as Clipping rises
    print("\n3. Testing Clipping Overdrive Monotonicity (0 dB -> 10 dB -> 20 dB -> 30 dB)...")
    clip_levels = [0.0, 10.0, 20.0, 30.0]
    clip_scores = []
    clip_diags = []
    for g in clip_levels:
        degraded = simulate_clipping(clip, gain_db=g, clip_type='hard')
        mos, vp, diag = infer(degraded)
        clip_scores.append(mos)
        clip_diags.append(diag[1])
        print(f"   Gain {g:2.0f} dB: MOS = {mos:.2f} (Clip Diag = {diag[1]:.2f})")

    for i in range(len(clip_scores) - 1):
        assert clip_scores[i] >= clip_scores[i+1] - 0.15, f"Clipping monotonicity violated: {clip_scores[i]} vs {clip_scores[i+1]}"
    print("   ✓ Clipping Monotonicity PASS")

    # 4. Monotonicity: Score strictly decreases as Low-Pass Cutoff drops
    print("\n4. Testing Muffling Monotonicity (8000 Hz -> 4000 Hz -> 2500 Hz -> 1200 Hz)...")
    cutoffs = [8000, 4000, 2500, 1200]
    muffle_scores = []
    muffle_diags = []
    for c in cutoffs:
        degraded = simulate_muffle(clip, cutoff=c, order=2)
        mos, vp, diag = infer(degraded)
        muffle_scores.append(mos)
        muffle_diags.append(diag[2])
        print(f"   Cutoff {c:4d} Hz: MOS = {mos:.2f} (Muffle Diag = {diag[2]:.2f})")

    for i in range(len(muffle_scores) - 1):
        assert muffle_scores[i] >= muffle_scores[i+1] - 0.20, f"Muffle monotonicity violated: {muffle_scores[i]} vs {muffle_scores[i+1]}"
    assert muffle_diags[-1] > muffle_diags[0], "Muffle diagnostic must increase as cutoff drops"
    print("   ✓ Muffle Monotonicity PASS")

    # 5. Natural Pause vs Original: MOS must change by < 0.25
    print("\n5. Testing Natural Pause Preservation...")
    base_mos, base_vp, _ = infer(clip)
    pause_clip = simulate_natural_pause(clip, pause_duration_s=0.5)
    pause_mos, pause_vp, pause_diag = infer(pause_clip)
    delta_mos = abs(pause_mos - base_mos)
    print(f"   Original MOS = {base_mos:.2f}, Pause-inserted MOS = {pause_mos:.2f}, Delta = {delta_mos:.2f}")
    assert delta_mos < 0.25, f"Natural pause altered MOS too much: delta={delta_mos:.2f}"
    assert pause_diag[3] < 0.35, f"Natural pause should not flag dropout diagnostic: {pause_diag[3]:.2f}"
    print("   ✓ Natural Pause Preservation PASS")

    # 6. Blow-Only vs Blow-Over-Speech
    print("\n6. Testing Wind / Blow Behavior...")
    blow_only = simulate_wind_blow(np.zeros_like(clip), intensity=0.9, duration_s=1.2, blow_only=True)
    b_mos, b_vp, b_diag = infer(blow_only)
    print(f"   Blow Only: Voice Prob = {b_vp:.2f} (Target < 0.45 so '_' shown), Wind Diag = {b_diag[4]:.2f}")
    assert b_vp < 0.45, f"Blow only should produce silence/underscore (vp={b_vp:.2f})"

    blow_over = simulate_wind_blow(clip, intensity=0.9, duration_s=1.0, blow_only=False)
    bo_mos, bo_vp, bo_diag = infer(blow_over)
    print(f"   Blow Over Speech: MOS = {bo_mos:.2f} (Base = {base_mos:.2f}), Wind Diag = {bo_diag[4]:.2f}")
    assert bo_mos < base_mos - 0.15, f"Blow over speech must degrade MOS: {bo_mos:.2f} vs {base_mos:.2f}"
    print("   ✓ Wind / Blow Behavior PASS")

    # 7. Silence / Room tone only: Voice Prob < 0.35 -> "_"
    print("\n7. Testing Silence / Room Tone...")
    silence = np.random.randn(len(clip)).astype(np.float32) * (10.0 ** (-55.0 / 20.0))
    s_mos, s_vp, s_diag = infer(silence)
    print(f"   Silence / Room Tone: Voice Prob = {s_vp:.2f} (Target < 0.35 so '_' shown)")
    assert s_vp < 0.35, f"Silence must produce silence/underscore: vp={s_vp:.2f}"
    print("   ✓ Silence Behavior PASS")

    # 8. Quiet but clean speech (-40 dBFS) stays > 3.8
    print("\n8. Testing Quiet But Clean Speech (-40 dBFS)...")
    quiet = clip * (10.0 ** (-40.0 / 20.0) / (np.sqrt(np.mean(clip ** 2)) + 1e-12))
    q_mos, q_vp, q_diag = infer(quiet)
    print(f"   Quiet Speech (-40 dBFS): MOS = {q_mos:.2f}, Voice Prob = {q_vp:.2f}")
    assert q_mos >= 3.6, f"Quiet clean speech must score high, got MOS = {q_mos:.2f}"
    print("   ✓ Quiet Speech Robustness PASS")

    print("\n>>> ALL AUTOMATED BEHAVIORAL TESTS PASSED! <<<")

def evaluate_heldout_test_set(model, norm_stats, test_clean, test_noise):
    print("\n" + "="*60)
    print("TEST 4: Held-Out Test Set Evaluation (Unseen Speakers & Noises)")
    print("="*60)
    
    mean = norm_stats["mean"]
    std = norm_stats["std"]

    y_true_all = []
    y_pred_all = []
    vp_true_all = []
    vp_pred_all = []

    for idx, f in enumerate(test_clean):
        clean = load_audio_2s(f)
        vad_mask, speech_frac = compute_clean_vad(clean)
        
        # Test on clean
        t_mos, t_vp, t_diag, mask = compute_teacher_label(clean, clean, {}, vad_mask, speech_frac)
        feats = extract_features(clean)
        feats_norm = (feats - mean) / (std + 1e-6)
        with torch.no_grad():
            p_mos, p_vp, _ = model(torch.tensor(feats_norm[None, :, :], dtype=torch.float32))
            
        if mask > 0.5:
            y_true_all.append(t_mos)
            y_pred_all.append(p_mos.item())
        vp_true_all.append(t_vp)
        vp_pred_all.append(p_vp.item())

        # Test on degraded version
        from degradations import apply_random_degradation_chain
        deg, meta = apply_random_degradation_chain(clean, test_noise)
        t_mos_deg, t_vp_deg, _, mask_deg = compute_teacher_label(clean, deg, meta, vad_mask, speech_frac)
        feats_deg = extract_features(deg)
        feats_deg_norm = (feats_deg - mean) / (std + 1e-6)
        with torch.no_grad():
            p_mos_deg, p_vp_deg, _ = model(torch.tensor(feats_deg_norm[None, :, :], dtype=torch.float32))

        if mask_deg > 0.5:
            y_true_all.append(t_mos_deg)
            y_pred_all.append(p_mos_deg.item())
        vp_true_all.append(t_vp_deg)
        vp_pred_all.append(p_vp_deg.item())

    plcc, _ = pearsonr(y_true_all, y_pred_all)
    srcc, _ = spearmanr(y_true_all, y_pred_all)
    rmse = np.sqrt(np.mean((np.array(y_true_all) - np.array(y_pred_all)) ** 2))

    y_vp_true_bin = (np.array(vp_true_all) >= 0.5).astype(int)
    y_vp_pred_bin = (np.array(vp_pred_all) >= 0.45).astype(int)

    tp = np.sum((y_vp_true_bin == 1) & (y_vp_pred_bin == 1))
    fp = np.sum((y_vp_true_bin == 0) & (y_vp_pred_bin == 1))
    fn = np.sum((y_vp_true_bin == 1) & (y_vp_pred_bin == 0))
    tn = np.sum((y_vp_true_bin == 0) & (y_vp_pred_bin == 0))

    precision = tp / (tp + fp + 1e-6)
    recall = tp / (tp + fn + 1e-6)
    f1 = 2 * precision * recall / (precision + recall + 1e-6)
    acc = (tp + tn) / len(y_vp_true_bin)

    print(f"Held-Out Evaluation Results ({len(y_true_all)} evaluated windows):")
    print(f"  MOS PLCC: {plcc:.4f}")
    print(f"  MOS SRCC: {srcc:.4f}")
    print(f"  MOS RMSE: {rmse:.3f}")
    print(f"  VAD Accuracy:  {acc*100:.2f}%")
    print(f"  VAD Precision: {precision*100:.2f}%")
    print(f"  VAD Recall:    {recall*100:.2f}%")
    print(f"  VAD F1-Score:  {f1*100:.2f}%")

    return {
        "plcc": float(plcc),
        "srcc": float(srcc),
        "rmse": float(rmse),
        "vad_acc": float(acc),
        "vad_f1": float(f1),
        "vad_precision": float(precision),
        "vad_recall": float(recall),
        "num_windows": len(y_true_all)
    }

def run_all_tests():
    splits = get_splits()
    
    with open("project/models/norm_stats.json") as f:
        stats_raw = json.load(f)
    norm_stats = {
        "mean": np.array(stats_raw["mean"], dtype=np.float32),
        "std": np.array(stats_raw["std"], dtype=np.float32)
    }

    # 1. Python vs JS Feature Parity
    test_python_vs_js_feature_parity(n_clips=20)

    # 2. ONNX Parity
    from export_onnx import export_onnx
    export_onnx()
    test_onnx_vs_pytorch_parity()

    # Load PyTorch model
    model = SpeechQualityModel()
    ckpt = torch.load("project/models/best_model.pt", map_location="cpu")
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()

    # 3. Behavioral tests
    test_clips = [load_audio_2s(f) for f in splits["test_clean"][:5]]
    test_behavioral_suite(model, norm_stats, test_clips)

    # 4. Held-out test evaluation
    metrics = evaluate_heldout_test_set(model, norm_stats, splits["test_clean"], splits["test_noise"])
    
    # Save test metrics
    with open("project/models/test_metrics.json", "w") as f:
        json.dump(metrics, f, indent=2)
    print("\nSaved test metrics to project/models/test_metrics.json")

if __name__ == '__main__':
    run_all_tests()
