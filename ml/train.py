import os
import sys
import copy
import json
import time
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader
from scipy.stats import pearsonr, spearmanr

from model import SpeechQualityModel
from dataset import get_splits, SpeechQualityDataset, compute_and_save_norm_stats
from export_onnx import export_onnx
from paths import P

def compute_metrics(y_true, y_pred):
    y_true = np.array(y_true)
    y_pred = np.array(y_pred)
    if len(y_true) < 2 or np.std(y_true) < 1e-4 or np.std(y_pred) < 1e-4:
        return 0.0, 0.0, 1.0
    plcc, _ = pearsonr(y_true, y_pred)
    srcc, _ = spearmanr(y_true, y_pred)
    rmse = np.sqrt(np.mean((y_true - y_pred) ** 2))
    return float(plcc), float(srcc), float(rmse)

class EMA:
    def __init__(self, model, decay=0.995):
        self.model = model
        self.decay = decay
        self.shadow = copy.deepcopy(model)
        for p in self.shadow.parameters():
            p.requires_grad = False

    def update(self):
        with torch.no_grad():
            for s_param, param in zip(self.shadow.parameters(), self.model.parameters()):
                s_param.data.mul_(self.decay).add_(param.data, alpha=1.0 - self.decay)

    def apply_shadow(self):
        for s_param, param in zip(self.shadow.parameters(), self.model.parameters()):
            param.data.copy_(s_param.data)

def train_model(epochs=8, batch_size=32, lr=1e-3, seed=42):
    torch.manual_seed(seed)
    np.random.seed(seed)
    
    device = torch.device("cpu")
    print(f"Training on device: {device} (CPU mode)", flush=True)
    
    splits = get_splits(seed=seed)
    
    norm_path = P("models/norm_stats.json")
    if os.path.exists(norm_path):
        print(f"Loading existing norm stats from {norm_path}...", flush=True)
        with open(norm_path, "r") as f:
            stats_raw = json.load(f)
        norm_stats = {
            "mean": np.array(stats_raw["mean"], dtype=np.float32),
            "std": np.array(stats_raw["std"], dtype=np.float32)
        }
    else:
        norm_stats = compute_and_save_norm_stats(
            splits["train_clean"], splits["train_noise"], save_path=norm_path, n_samples=250
        )
    
    with open(P("web/norm_stats.json"), "w") as fp:
        json.dump({
            "mean": norm_stats["mean"].tolist(),
            "std": norm_stats["std"].tolist()
        }, fp, indent=2)
    print(f"Saved norm_stats.json to {P('web/norm_stats.json')}", flush=True)

    # 1280 samples per epoch = 40 batches of 32
    train_clean_subset = splits["train_clean"][:1280]
    train_ds = SpeechQualityDataset(
        train_clean_subset, splits["train_noise"], norm_stats=norm_stats, is_train=True, pairs=True
    )
    val_clean_subset = splits["val_clean"][:200]
    val_ds = SpeechQualityDataset(
        val_clean_subset, splits["val_noise"], norm_stats=norm_stats, is_train=False, pairs=False
    )

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True, drop_last=True)
    val_loader = DataLoader(val_ds, batch_size=batch_size, shuffle=False)

    model = SpeechQualityModel().to(device)
    # Initialize MOS head bias to 3.5 (sigmoid ~0.7) so training starts centered
    with torch.no_grad():
        model.mos_head.bias.fill_(0.85)

    ema = EMA(model, decay=0.995)
    
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs, eta_min=1e-5)
    huber_fn = nn.HuberLoss(delta=0.5, reduction='none')

    best_val_plcc = -1.0
    best_val_rmse = 999.0
    
    os.makedirs(P("models"), exist_ok=True)
    best_path = P("models/best_model.pt")

    print(f"\nStarting balanced training: {epochs} epochs, {len(train_loader)} batches/epoch (batch_size={batch_size})", flush=True)

    for epoch in range(1, epochs + 1):
        model.train()
        t0 = time.time()
        train_loss = 0.0
        n_batches = 0
        
        for batch in train_loader:
            feats = batch["features"].to(device)
            target_mos = batch["mos"].to(device)
            target_vp = batch["voice_prob"].to(device)
            target_diag = batch["diagnostics"].to(device)
            mos_mask = batch["mos_mask"].to(device)
            
            optimizer.zero_grad()
            
            pred_mos, pred_vp, pred_diag = model(feats)
            
            # 1. Huber loss on MOS (masked for silence/non-speech)
            huber_mos = huber_fn(pred_mos, target_mos)
            loss_mos = (huber_mos * mos_mask).sum() / (mos_mask.sum() + 1e-6)
            
            # 2. BCE loss on voice prob
            loss_vp = F.binary_cross_entropy(pred_vp, target_vp)
            
            # 3. BCE loss on diagnostics (strong gradients for 0/1 probabilities)
            loss_diag = F.binary_cross_entropy(pred_diag, target_diag)
            
            # 4. Pairwise ranking loss
            has_pair = batch["has_pair"].to(device)
            if has_pair.sum() > 0:
                pair_feats = batch["pair_features"].to(device)
                pair_mos_pred, _, _ = model(pair_feats)
                # Sample 1 is milder than Sample 2, so pred_mos > pair_mos_pred
                rank_err = F.relu(pair_mos_pred - pred_mos + 0.30)
                loss_rank = (rank_err * has_pair).sum() / (has_pair.sum() + 1e-6)
            else:
                loss_rank = torch.tensor(0.0, device=device)

            total_loss = loss_mos + 0.8 * loss_vp + 0.8 * loss_diag + 0.4 * loss_rank
            
            total_loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()
            ema.update()
            
            train_loss += total_loss.item()
            n_batches += 1

        scheduler.step()
        train_loss /= max(1, n_batches)
        
        # Validation with EMA model
        val_model = ema.shadow
        val_model.eval()
        
        val_y_true = []
        val_y_pred = []
        val_vp_true = []
        val_vp_pred = []
        
        with torch.no_grad():
            for batch in val_loader:
                feats = batch["features"].to(device)
                target_mos = batch["mos"].to(device)
                target_vp = batch["voice_prob"].to(device)
                mos_mask = batch["mos_mask"].to(device)
                
                p_mos, p_vp, _ = val_model(feats)
                
                mask_np = mos_mask.cpu().numpy().flatten() > 0.5
                if mask_np.sum() > 0:
                    val_y_true.extend(target_mos.cpu().numpy().flatten()[mask_np].tolist())
                    val_y_pred.extend(p_mos.cpu().numpy().flatten()[mask_np].tolist())
                    
                val_vp_true.extend(target_vp.cpu().numpy().flatten().tolist())
                val_vp_pred.extend(p_vp.cpu().numpy().flatten().tolist())

        plcc, srcc, rmse = compute_metrics(val_y_true, val_y_pred)
        vp_acc = np.mean((np.array(val_vp_pred) >= 0.45) == (np.array(val_vp_true) >= 0.5))
        
        elapsed = time.time() - t0
        print(f"Epoch {epoch:02d}/{epochs:02d} ({elapsed:.1f}s) | Loss: {train_loss:.4f} | Val MOS: PLCC={plcc:.4f}, SRCC={srcc:.4f}, RMSE={rmse:.3f} | VAD Acc={vp_acc*100:.1f}%", flush=True)

        if plcc > best_val_plcc or epoch == epochs:
            best_val_plcc = plcc
            best_val_rmse = rmse
            torch.save({
                "model_state_dict": ema.shadow.state_dict(),
                "val_plcc": plcc,
                "val_srcc": srcc,
                "val_rmse": rmse,
                "epoch": epoch
            }, best_path)
            print(f"  --> Saved new best checkpoint to {best_path} (PLCC: {plcc:.4f})", flush=True)

    print(f"\nTraining completed! Best Val PLCC: {best_val_plcc:.4f}, RMSE: {best_val_rmse:.3f}", flush=True)
    print("Exporting ONNX model...", flush=True)
    export_onnx(checkpoint_path=best_path)

if __name__ == '__main__':
    train_model(epochs=8, batch_size=32, lr=1e-3)
