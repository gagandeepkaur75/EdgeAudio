import os
import torch
import numpy as np
import onnx
import onnxruntime as ort

from model import SpeechQualityModel
from paths import P

def export_onnx(
    checkpoint_path=P("models/best_model.pt"),
    output_onnx=P("web/model.onnx"),
    opset_version=17
):
    print("Loading PyTorch model checkpoint...")
    model = SpeechQualityModel()
    
    if os.path.exists(checkpoint_path):
        ckpt = torch.load(checkpoint_path, map_location="cpu")
        model.load_state_dict(ckpt["model_state_dict"])
        print(f"Loaded checkpoint from {checkpoint_path} (epoch {ckpt.get('epoch')}, PLCC {ckpt.get('val_plcc', 0.0):.4f})")
    else:
        print(f"Warning: {checkpoint_path} not found, exporting initialized model architecture...")

    model.eval()
    
    # Fixed input shape [1, T=201, F=85]
    dummy_input = torch.randn(1, 201, 85, dtype=torch.float32)

    os.makedirs(os.path.dirname(output_onnx), exist_ok=True)
    temp_raw_onnx = output_onnx + ".raw"

    print(f"Exporting ONNX model to {temp_raw_onnx} (opset {opset_version})...")
    torch.onnx.export(
        model,
        dummy_input,
        temp_raw_onnx,
        export_params=True,
        opset_version=opset_version,
        do_constant_folding=True,
        input_names=["features"],
        output_names=["mos", "voice_prob", "diagnostics"],
        dynamic_axes=None  # Fixed shape [1, 201, 85] as requested
    )
    
    # Load and save with save_as_external_data=False to guarantee single self-contained file
    print("Packing all weights into a single standalone ONNX file...")
    loaded_model = onnx.load(temp_raw_onnx, load_external_data=True)
    onnx.save_model(loaded_model, output_onnx, save_as_external_data=False)
    
    # Clean up temp raw files
    try:
        if os.path.exists(temp_raw_onnx):
            os.remove(temp_raw_onnx)
        if os.path.exists(temp_raw_onnx + ".data"):
            os.remove(temp_raw_onnx + ".data")
        if os.path.exists(output_onnx + ".data"):
            os.remove(output_onnx + ".data")
    except Exception as e:
        pass

    onnx_size_mb = os.path.getsize(output_onnx) / (1024 * 1024)
    print(f"Final Single-File ONNX model size: {onnx_size_mb:.2f} MB")
    
    # Check ONNX model validity
    onnx_model = onnx.load(output_onnx)
    onnx.checker.check_model(onnx_model)
    print("ONNX model checker passed successfully!")

    # Verify PyTorch vs ONNX output parity
    session = ort.InferenceSession(output_onnx, providers=["CPUExecutionProvider"])
    
    test_inputs = [torch.randn(1, 201, 85, dtype=torch.float32) for _ in range(10)]
    max_mos_diff = 0.0
    max_vp_diff = 0.0
    max_diag_diff = 0.0

    for x in test_inputs:
        with torch.no_grad():
            py_mos, py_vp, py_diag = model(x)
            
        ort_outs = session.run(
            None,
            {"features": x.numpy()}
        )
        ort_mos, ort_vp, ort_diag = ort_outs
        
        max_mos_diff = max(max_mos_diff, float(np.max(np.abs(py_mos.numpy() - ort_mos))))
        max_vp_diff = max(max_vp_diff, float(np.max(np.abs(py_vp.numpy() - ort_vp))))
        max_diag_diff = max(max_diag_diff, float(np.max(np.abs(py_diag.numpy() - ort_diag))))

    print(f"PyTorch vs ONNX Parity Test:")
    print(f"  Max MOS abs error:         {max_mos_diff:.6e} (Threshold: <1e-3)")
    print(f"  Max Voice Prob abs error:  {max_vp_diff:.6e} (Threshold: <1e-3)")
    print(f"  Max Diagnostics abs error: {max_diag_diff:.6e} (Threshold: <1e-3)")
    assert max_mos_diff < 1e-3, f"MOS parity failed: {max_mos_diff}"
    assert max_vp_diff < 1e-3, f"Voice prob parity failed: {max_vp_diff}"
    assert max_diag_diff < 1e-3, f"Diagnostics parity failed: {max_diag_diff}"
    print(">>> All PyTorch vs ONNX parity checks PASSED! <<<")

    # Also keep a copy next to the checkpoints (ml/checkpoints/model.onnx)
    import shutil
    shutil.copyfile(output_onnx, P("models/model.onnx"))
    print(f"Saved standalone model to {P('models/model.onnx')} and {output_onnx}")

if __name__ == '__main__':
    export_onnx()
