import os
import sys
import json
import time
import math
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import TensorDataset, DataLoader
import numpy as np
from scipy.stats import pearsonr, spearmanr

from model import SpeechQualityModel
from export_onnx import export_onnx
from paths import P

class EMA:
    def __init__(self, model, decay=0.995):
        self.model = model
        self.decay = decay
        self.shadow = SpeechQualityModel()
        self.shadow.load_state_dict(model.state_dict())
        for p in self.shadow.parameters():
            p.requires_grad = False

    def update(self):
        with torch.no_grad():
            for p_shadow, p_model in zip(self.shadow.parameters(), self.model.parameters()):
                p_shadow.data.mul_(self.decay).add_(p_model.data, alpha=1.0 - self.decay)

def compute_metrics(y_true, y_pred):
    y_true = np.array(y_true)
    y_pred = np.array(y_pred)
    if len(y_true) < 2 or np.std(y_true) < 1e-6 or np.std(y_pred) < 1e-6:
        return 0.0, 0.0, 0.0
    plcc, _ = pearsonr(y_true, y_pred)
    srcc, _ = spearmanr(y_true, y_pred)
    rmse = np.sqrt(np.mean((y_true - y_pred) ** 2))
    return float(plcc), float(srcc), float(rmse)

def train(epochs=12, batch_size=64, lr=1.0e-3, cache_path=P("models/dataset_cache.pt")):
    torch.set_num_threads(4)
    device = torch.device("cpu")
    print(f"Loading cached dataset from {cache_path}...")
    data = torch.load(cache_path, map_location="cpu")
    train_data = data["train"]
    val_data = data["val"]

    train_ds = TensorDataset(
        train_data["features"],
        train_data["mos"],
        train_data["voice_prob"],
        train_data["diagnostics"],
        train_data["mos_mask"],
        train_data["pair_features"],
        train_data["pair_mos"],
        train_data["pair_voice_prob"],
        train_data["pair_diagnostics"],
        train_data["pair_mask"],
        train_data["has_pair"]
    )

    val_ds = TensorDataset(
        val_data["features"],
        val_data["mos"],
        val_data["voice_prob"],
        val_data["diagnostics"],
        val_data["mos_mask"]
    )

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=batch_size, shuffle=False)

    print(f"Dataset in RAM: {len(train_ds)} train samples ({len(train_loader)} batches), {len(val_ds)} val samples ({len(val_loader)} batches)")

    model = SpeechQualityModel().to(device)
    ema = EMA(model, decay=0.99)
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-3)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs, eta_min=1e-5)

    best_val_plcc = -1.0
    best_val_rmse = 999.0
    best_val_loss = 999.0
    best_path = P("models/best_model.pt")

    print(f"\nStarting in-memory training for {epochs} epochs...")
    t_start = time.time()

    for epoch in range(1, epochs + 1):
        t0 = time.time()
        model.train()
        train_loss = 0.0

        for feats, t_mos, t_vp, t_diag, mos_mask, p_feats, p_t_mos, p_t_vp, p_t_diag, p_mask, has_p in train_loader:
            optimizer.zero_grad()
            pred_mos, pred_vp, pred_diag = model(feats)

            # 1. Primary sample loss
            err_sq = (pred_mos - t_mos) ** 2
            loss_mos = (err_sq * mos_mask).sum() / (mos_mask.sum() + 1e-6)
            loss_vp = F.binary_cross_entropy(pred_vp, t_vp)
            loss_diag = F.binary_cross_entropy(pred_diag, t_diag)

            # 2. Paired sample supervision + monotonicity ranking
            if has_p.sum() > 0:
                p_mos, p_vp, p_diag = model(p_feats)
                # Supervise pair targets
                p_err_sq = (p_mos - p_t_mos) ** 2
                loss_pair_mos = (p_err_sq * p_mask).sum() / (p_mask.sum() + 1e-6)
                loss_pair_diag = (F.binary_cross_entropy(p_diag, p_t_diag, reduction='none') * p_mask).sum() / (p_mask.sum() * 5 + 1e-6)
                
                # Pairwise ranking: pred_mos must be higher than p_mos
                rank_err = F.relu(p_mos - pred_mos + 0.25)
                loss_rank = (rank_err * has_p).sum() / (has_p.sum() + 1e-6)
            else:
                loss_pair_mos = torch.tensor(0.0)
                loss_pair_diag = torch.tensor(0.0)
                loss_rank = torch.tensor(0.0)

            total_loss = (
                2.0 * loss_mos + 1.6 * loss_vp + 1.2 * loss_diag +
                1.0 * loss_pair_mos + 0.8 * loss_pair_diag + 1.2 * loss_rank
            )

            total_loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()
            ema.update()

            train_loss += total_loss.item()

        scheduler.step()
        train_loss /= len(train_loader)

        # Validation
        eval_model = ema.shadow
        eval_model.eval()
        val_y_true = []
        val_y_pred = []
        val_vp_true = []
        val_vp_pred = []
        val_loss = 0.0

        with torch.no_grad():
            for v_feats, v_mos, v_vp, v_diag, v_mask in val_loader:
                p_mos, p_vp, p_diag = eval_model(v_feats)
                v_err_sq = (((p_mos - v_mos) ** 2) * v_mask).sum() / (v_mask.sum() + 1e-6)
                v_vp_err = F.binary_cross_entropy(p_vp, v_vp)
                v_diag_err = F.binary_cross_entropy(p_diag, v_diag)
                batch_val_loss = v_err_sq.item() + 0.8 * v_vp_err.item() + 0.8 * v_diag_err.item()
                val_loss += batch_val_loss

                for i in range(len(v_mask)):
                    if v_mask[i].item() > 0.5:
                        val_y_true.append(v_mos[i].item())
                        val_y_pred.append(p_mos[i].item())
                val_vp_true.extend(v_vp.numpy().flatten().tolist())
                val_vp_pred.extend(p_vp.numpy().flatten().tolist())

        val_loss /= len(val_loader)
        plcc, srcc, rmse = compute_metrics(val_y_true, val_y_pred)
        vp_acc = np.mean((np.array(val_vp_pred) >= 0.45) == (np.array(val_vp_true) >= 0.5))
        elapsed = time.time() - t0

        print(f"Epoch {epoch:02d}/{epochs:02d} ({elapsed:.1f}s) | Train Loss: {train_loss:.4f} | Val Loss: {val_loss:.4f} | PLCC={plcc:.4f}, SRCC={srcc:.4f}, RMSE={rmse:.3f} | VAD Acc={vp_acc*100:.1f}%", flush=True)

        if val_loss < best_val_loss or (epoch >= 3 and plcc > best_val_plcc):
            best_val_loss = min(best_val_loss, val_loss)
            best_val_plcc = max(best_val_plcc, plcc)
            best_val_rmse = rmse
            torch.save({
                "model_state_dict": ema.shadow.state_dict(),
                "val_loss": val_loss,
                "val_plcc": plcc,
                "val_srcc": srcc,
                "val_rmse": rmse,
                "epoch": epoch
            }, best_path)
            print(f"  --> Saved new best checkpoint to {best_path} (Val Loss: {val_loss:.4f}, PLCC: {plcc:.4f})", flush=True)

    total_time = time.time() - t_start
    print(f"\nTraining completed in {total_time:.1f}s! Best Val PLCC: {best_val_plcc:.4f}, RMSE: {best_val_rmse:.3f}")
    print("Exporting best model to ONNX...")
    export_onnx(checkpoint_path=best_path, output_onnx=P("web/model.onnx"))

if __name__ == '__main__':
    train(epochs=12, batch_size=64, lr=1.0e-3)
