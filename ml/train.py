"""
Training pipeline for EdgeAudioNet on synthetic VoIP degradation dataset.
Optimizes multi-task loss for MOS estimation, SNR estimation, and artifact detection.
Calculates Pearson Correlation Coefficient (PCC) and Root Mean Squared Error (RMSE).
"""

import os
import time
import numpy as np
import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader

from model import EdgeAudioNet
from dataset_generator import AudioQualityDataset


def calculate_pcc(preds, targets):
    """Pearson Correlation Coefficient."""
    preds_mean = preds - np.mean(preds)
    targets_mean = targets - np.mean(targets)
    denom = np.sqrt(np.sum(preds_mean ** 2) * np.sum(targets_mean ** 2)) + 1e-8
    return float(np.sum(preds_mean * targets_mean) / denom)


def train():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"--> Using device for training: {device}")

    # Create checkpoints folder
    checkpoint_dir = os.path.join(os.path.dirname(__file__), "checkpoints")
    os.makedirs(checkpoint_dir, exist_ok=True)
    best_model_path = os.path.join(checkpoint_dir, "best_model.pth")

    # Hyperparameters
    batch_size = 32
    num_epochs = 10
    learning_rate = 1e-3
    train_size = 1200
    val_size = 300

    print("--> Preparing datasets in memory...", flush=True)
    train_dataset = AudioQualityDataset(size=train_size, seed=101)
    val_dataset = AudioQualityDataset(size=val_size, seed=202)

    # Use num_workers=0 for seamless Windows execution
    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_dataset, batch_size=batch_size, shuffle=False, num_workers=0)

    # Initialize model
    model = EdgeAudioNet().to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=num_epochs, eta_min=5e-5)

    best_val_rmse = float("inf")
    best_pcc = 0.0

    print(f"--> Starting training for {num_epochs} epochs ({len(train_loader)} batches/epoch)...")
    start_time = time.time()

    for epoch in range(1, num_epochs + 1):
        model.train()
        train_loss = 0.0

        for audio, targets in train_loader:
            audio = audio.to(device)
            mos_target = targets["mos"].to(device)
            snr_target = targets["snr"].to(device)
            drop_target = targets["dropout_prob"].to(device)
            clip_target = targets["clip_prob"].to(device)

            optimizer.zero_grad()
            preds = model(audio)

            # Multi-task loss
            loss_mos = F.mse_loss(preds["mos"], mos_target)
            loss_snr = 0.02 * F.mse_loss(preds["snr"], snr_target)
            loss_drop = 0.3 * F.binary_cross_entropy(preds["dropout_prob"], drop_target)
            loss_clip = 0.3 * F.binary_cross_entropy(preds["clip_prob"], clip_target)

            total_loss = loss_mos + loss_snr + loss_drop + loss_clip
            total_loss.backward()

            # Gradient clipping for training stability
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=5.0)
            optimizer.step()

            train_loss += total_loss.item()

        scheduler.step()
        train_loss /= len(train_loader)

        # Validation
        model.eval()
        all_mos_preds = []
        all_mos_targets = []
        val_loss = 0.0

        with torch.no_grad():
            for audio, targets in val_loader:
                audio = audio.to(device)
                mos_target = targets["mos"].to(device)
                snr_target = targets["snr"].to(device)
                drop_target = targets["dropout_prob"].to(device)
                clip_target = targets["clip_prob"].to(device)

                preds = model(audio)

                loss_mos = F.mse_loss(preds["mos"], mos_target)
                loss_snr = 0.02 * F.mse_loss(preds["snr"], snr_target)
                loss_drop = 0.3 * F.binary_cross_entropy(preds["dropout_prob"], drop_target)
                loss_clip = 0.3 * F.binary_cross_entropy(preds["clip_prob"], clip_target)

                val_loss += (loss_mos + loss_snr + loss_drop + loss_clip).item()

                all_mos_preds.extend(preds["mos"].cpu().numpy().flatten())
                all_mos_targets.extend(mos_target.cpu().numpy().flatten())

        val_loss /= len(val_loader)
        all_mos_preds = np.array(all_mos_preds)
        all_mos_targets = np.array(all_mos_targets)

        val_rmse = float(np.sqrt(np.mean((all_mos_preds - all_mos_targets) ** 2)))
        pcc = calculate_pcc(all_mos_preds, all_mos_targets)

        print(
            f"Epoch [{epoch:02d}/{num_epochs:02d}] "
            f"Train Loss: {train_loss:.4f} | "
            f"Val Loss: {val_loss:.4f} | "
            f"MOS RMSE: {val_rmse:.3f} | "
            f"MOS PCC: {pcc:.3f} | "
            f"LR: {scheduler.get_last_lr()[0]:.2e}",
            flush=True
        )

        if val_rmse < best_val_rmse:
            best_val_rmse = val_rmse
            best_pcc = pcc
            torch.save(
                {
                    "epoch": epoch,
                    "model_state_dict": model.state_dict(),
                    "val_rmse": best_val_rmse,
                    "val_pcc": best_pcc,
                },
                best_model_path,
            )
            print(f"  * Saved new best checkpoint -> RMSE: {best_val_rmse:.3f}, PCC: {best_pcc:.3f}", flush=True)

    total_time = time.time() - start_time
    print(f"\n--> Training Complete in {total_time:.1f}s.", flush=True)
    print(f"--> Best Model Saved at: {best_model_path}", flush=True)
    print(f"    Final Best MOS RMSE: {best_val_rmse:.3f}, PCC: {best_pcc:.3f}", flush=True)


if __name__ == "__main__":
    train()
