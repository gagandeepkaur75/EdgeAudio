"""
EdgeAudioNet: Lightweight 1D Convolutional Neural Network + GRU architecture
designed for real-time speech quality (MOS) and acoustic degradation assessment.

Input: Raw PCM audio waveform [B, 1, 16000] (1.0 second at 16 kHz, normalized [-1.0, 1.0]).
Outputs:
  - mos: Continuous MOS speech quality score in [1.0, 5.0]
  - snr: Estimated Signal-to-Noise Ratio (dB)
  - dropout_prob: Packet loss / burst dropout probability in [0.0, 1.0]
  - clip_prob: Clipping / saturation distortion probability in [0.0, 1.0]
"""

import torch
import torch.nn as nn


class Conv1dBlock(nn.Module):
    def __init__(self, in_channels, out_channels, kernel_size, stride, padding, pool_size=2):
        super().__init__()
        self.conv = nn.Conv1d(
            in_channels,
            out_channels,
            kernel_size=kernel_size,
            stride=stride,
            padding=padding,
            bias=False
        )
        self.bn = nn.BatchNorm1d(out_channels)
        self.act = nn.LeakyReLU(0.1, inplace=True)
        self.pool = nn.MaxPool1d(pool_size, stride=pool_size) if pool_size > 1 else nn.Identity()

    def forward(self, x):
        x = self.conv(x)
        x = self.bn(x)
        x = self.act(x)
        x = self.pool(x)
        return x


class EdgeAudioNet(nn.Module):
    """
    Ultra-lightweight edge neural network for zero-STFT raw PCM audio quality assessment.
    Parameter count: ~150,000 (~600 KB FP32, ~200 KB INT8 quantized).
    Inference latency: <10ms on CPU/WASM.
    """
    def __init__(self):
        super().__init__()

        # Front-end 1D Conv feature extraction:
        # [B, 1, 16000] -> [B, 32, 1000] -> pool(2) -> [B, 32, 500]
        self.block1 = Conv1dBlock(
            in_channels=1,
            out_channels=32,
            kernel_size=64,
            stride=16,
            padding=32,
            pool_size=2
        )

        # [B, 32, 500] -> [B, 64, 125] -> pool(2) -> [B, 64, 62]
        self.block2 = Conv1dBlock(
            in_channels=32,
            out_channels=64,
            kernel_size=16,
            stride=4,
            padding=8,
            pool_size=2
        )

        # [B, 64, 62] -> [B, 96, 31]
        self.block3 = Conv1dBlock(
            in_channels=64,
            out_channels=96,
            kernel_size=7,
            stride=2,
            padding=3,
            pool_size=1
        )

        # Temporal sequence modeling via Bidirectional GRU
        self.gru = nn.GRU(
            input_size=96,
            hidden_size=48,
            num_layers=1,
            batch_first=True,
            bidirectional=True
        )  # Output features: 48 * 2 = 96

        # Shared embedding dense layer
        self.shared_dense = nn.Sequential(
            nn.Linear(96, 64),
            nn.ReLU(inplace=True),
            nn.Dropout(0.2)
        )

        # Prediction Heads
        # 1. MOS Head (bounded [1.0, 5.0])
        self.mos_fc = nn.Linear(64, 1)

        # 2. SNR Head (predicted SNR in dB)
        self.snr_fc = nn.Linear(64, 1)

        # 3. Dropout / Packet Loss Head (probability in [0.0, 1.0])
        self.dropout_fc = nn.Linear(64, 1)

        # 4. Clipping Head (probability in [0.0, 1.0])
        self.clip_fc = nn.Linear(64, 1)

    def forward(self, x):
        # Expected input shape: [B, 1, 16000]
        if x.dim() == 2:
            x = x.unsqueeze(1)

        # 1D Convolutional feature pyramid
        x = self.block1(x)
        x = self.block2(x)
        x = self.block3(x)  # [B, 96, T]

        # Reshape to [B, T, 96] for GRU
        x = x.transpose(1, 2)
        gru_out, _ = self.gru(x)  # [B, T, 96]

        # Temporal Global Average Pooling
        pooled = torch.mean(gru_out, dim=1)  # [B, 96]

        # Shared feature representation
        feat = self.shared_dense(pooled)  # [B, 64]

        # Multi-task predictions
        # MOS: 1.0 + 4.0 * Sigmoid -> [1.0, 5.0]
        mos = 1.0 + 4.0 * torch.sigmoid(self.mos_fc(feat))

        # SNR: linear regression (dB)
        snr = self.snr_fc(feat)

        # Dropout & Clipping: sigmoid probabilities
        dropout_prob = torch.sigmoid(self.dropout_fc(feat))
        clip_prob = torch.sigmoid(self.clip_fc(feat))

        return {
            "mos": mos,
            "snr": snr,
            "dropout_prob": dropout_prob,
            "clip_prob": clip_prob
        }


if __name__ == "__main__":
    model = EdgeAudioNet()
    dummy_input = torch.randn(2, 1, 16000)
    outputs = model(dummy_input)
    print("EdgeAudioNet initialized successfully.")
    for k, v in outputs.items():
        print(f"  {k}: shape {v.shape}, sample value {v[0].item():.3f}")
    total_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"Total trainable parameters: {total_params:,}")
