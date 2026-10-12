"""
Export EdgeAudioNet to ONNX and perform Dynamic INT8 Quantization.
Saves models directly to the React frontend public assets directory:
  - EdgeAudio/public/models/edgeaudio_model.onnx (FP32)
  - EdgeAudio/public/models/edgeaudio_model_int8.onnx (INT8 Quantized, ultra-compact < 500 KB)

Includes verification testing comparing PyTorch output with ONNX Runtime WASM-compatible runtime.
"""

import os
import sys
import time

# Ensure UTF-8 output encoding on Windows consoles
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import numpy as np
import torch
import torch.nn as nn
import onnx
import onnxruntime as ort
from onnxruntime.quantization import quantize_dynamic, QuantType

from model import EdgeAudioNet


class EdgeAudioNetExportWrapper(nn.Module):
    """
    Export wrapper that unwraps dict outputs into a tuple of tensors for clean ONNX graph compilation.
    """
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, x):
        out = self.model(x)
        return out["mos"], out["snr"], out["dropout_prob"], out["clip_prob"]


def export_and_quantize():
    base_dir = os.path.dirname(__file__)
    checkpoint_path = os.path.join(base_dir, "checkpoints", "best_model.pth")
    if not os.path.exists(checkpoint_path):
        raise FileNotFoundError(f"Checkpoint not found at: {checkpoint_path}. Run train.py first.")

    # Target output directory in React frontend
    public_models_dir = os.path.abspath(
        os.path.join(base_dir, "..", "EdgeAudio", "public", "models")
    )
    os.makedirs(public_models_dir, exist_ok=True)

    fp32_onnx_path = os.path.join(public_models_dir, "edgeaudio_model.onnx")
    int8_onnx_path = os.path.join(public_models_dir, "edgeaudio_model_int8.onnx")

    print(f"--> Loading trained model weights from: {checkpoint_path}")
    model = EdgeAudioNet()
    checkpoint = torch.load(checkpoint_path, map_location="cpu")
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()

    export_wrapper = EdgeAudioNetExportWrapper(model)
    export_wrapper.eval()

    # Dummy input: 1-second audio at 16 kHz: [Batch=1, Channel=1, Samples=16000]
    dummy_input = torch.randn(1, 1, 16000, dtype=torch.float32)

    # 1. Export FP32 ONNX using classic TorchScript exporter (dynamo=False)
    print(f"--> Exporting PyTorch model to ONNX: {fp32_onnx_path} ...")
    torch.onnx.export(
        export_wrapper,
        dummy_input,
        fp32_onnx_path,
        export_params=True,
        opset_version=14,
        do_constant_folding=True,
        input_names=["input_audio"],
        output_names=["mos", "snr", "dropout_prob", "clip_prob"],
        dynamic_axes={
            "input_audio": {0: "batch_size"},
            "mos": {0: "batch_size"},
            "snr": {0: "batch_size"},
            "dropout_prob": {0: "batch_size"},
            "clip_prob": {0: "batch_size"},
        },
        dynamo=False,
    )

    # Verify ONNX model validity
    onnx_model = onnx.load(fp32_onnx_path)
    onnx.checker.check_model(onnx_model)
    fp32_size_kb = os.path.getsize(fp32_onnx_path) / 1024.0
    print(f"    [OK] FP32 ONNX Model verified! Size: {fp32_size_kb:.1f} KB")

    # 2. Dynamic INT8 Quantization
    print(f"--> Applying INT8 Dynamic Quantization: {int8_onnx_path} ...")
    quantize_dynamic(
        model_input=fp32_onnx_path,
        model_output=int8_onnx_path,
        weight_type=QuantType.QUInt8,
    )
    int8_size_kb = os.path.getsize(int8_onnx_path) / 1024.0
    print(f"    [OK] Quantized INT8 Model saved! Size: {int8_size_kb:.1f} KB")
    print(f"    Model compression factor: {fp32_size_kb / int8_size_kb:.2f}x reduction")

    # 3. Verification & Benchmark
    print("\n--> Verifying ONNX Runtime numerical fidelity and latency...")
    test_input = np.random.randn(1, 1, 16000).astype(np.float32)

    # PyTorch reference prediction
    with torch.no_grad():
        pt_mos, pt_snr, pt_drop, pt_clip = export_wrapper(torch.from_numpy(test_input))
        pt_mos = pt_mos.numpy().item()
        pt_snr = pt_snr.numpy().item()

    # ONNX Runtime FP32
    session_fp32 = ort.InferenceSession(fp32_onnx_path, providers=["CPUExecutionProvider"])
    onnx_fp32_out = session_fp32.run(None, {"input_audio": test_input})
    ort_fp32_mos = onnx_fp32_out[0].item()

    # ONNX Runtime INT8
    session_int8 = ort.InferenceSession(int8_onnx_path, providers=["CPUExecutionProvider"])
    onnx_int8_out = session_int8.run(None, {"input_audio": test_input})
    ort_int8_mos = onnx_int8_out[0].item()
    ort_int8_snr = onnx_int8_out[1].item()
    ort_int8_drop = onnx_int8_out[2].item()
    ort_int8_clip = onnx_int8_out[3].item()

    # Latency test (100 iterations)
    times = []
    for _ in range(100):
        t0 = time.perf_counter()
        session_int8.run(None, {"input_audio": test_input})
        times.append((time.perf_counter() - t0) * 1000.0)
    avg_latency = np.mean(times)
    p95_latency = np.percentile(times, 95)

    print("--> Verification Results:")
    print(f"    PyTorch reference MOS:  {pt_mos:.4f}")
    print(f"    ONNX FP32 MOS:          {ort_fp32_mos:.4f} (diff: {abs(pt_mos - ort_fp32_mos):.5f})")
    print(f"    ONNX INT8 MOS:          {ort_int8_mos:.4f} (diff: {abs(pt_mos - ort_int8_mos):.5f})")
    print(f"    ONNX INT8 Est SNR:      {ort_int8_snr:.2f} dB")
    print(f"    ONNX INT8 Dropout Prob: {ort_int8_drop:.3f}")
    print(f"    ONNX INT8 Clip Prob:    {ort_int8_clip:.3f}")
    print(f"    INT8 CPU Latency:       avg {avg_latency:.2f} ms | p95 {p95_latency:.2f} ms")
    print("\n--> Model successfully packaged for client-side WebAssembly deployment!")


if __name__ == "__main__":
    export_and_quantize()
