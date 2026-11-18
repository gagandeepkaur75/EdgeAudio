import torch
import torch.nn as nn
import torch.nn.functional as F

class ConvBlock(nn.Module):
    def __init__(self, in_channels, out_channels, kernel_size=5, stride=1, dilation=1):
        super().__init__()
        # Depthwise separable convolution
        padding = ((kernel_size - 1) * dilation) // 2
        self.depthwise = nn.Conv1d(
            in_channels, in_channels,
            kernel_size=kernel_size,
            stride=stride,
            padding=padding,
            dilation=dilation,
            groups=in_channels,
            bias=False
        )
        self.pointwise = nn.Conv1d(in_channels, out_channels, kernel_size=1, bias=False)
        self.bn = nn.BatchNorm1d(out_channels)
        self.act = nn.GELU()

    def forward(self, x):
        # Inverted residual skip connection
        return x + self.act(self.bn(self.pointwise(self.depthwise(x))))

class SpeechQualityModel(nn.Module):
    """
    Tiny in-browser Speech Quality Estimator.
    Input: [B, T=201, F=85]
    Outputs:
      1. mos in [0.0, 5.0]
      2. voice_prob in [0.0, 1.0]
      3. diagnostics in [0.0, 1.0] x 5 (noise, clipping, muffled, dropouts, wind)
    Budget: ~584k parameters (~2.23 MB FP32), <25ms CPU inference.
    """
    def __init__(self, n_features=85, conv_dim=160, gru_dim=160, n_gru_layers=2):
        super().__init__()
        self.n_features = n_features
        self.conv_dim = conv_dim
        self.gru_dim = gru_dim

        # Input feature projection
        self.in_proj = nn.Conv1d(n_features, conv_dim, kernel_size=1, bias=False)
        self.in_bn = nn.BatchNorm1d(conv_dim)
        self.act = nn.GELU()

        # Depthwise separable CNN front end with residual connections
        self.conv_blocks = nn.ModuleList([
            ConvBlock(conv_dim, conv_dim, kernel_size=5, dilation=1),
            ConvBlock(conv_dim, conv_dim, kernel_size=5, dilation=2),
            ConvBlock(conv_dim, conv_dim, kernel_size=5, dilation=4),
            ConvBlock(conv_dim, conv_dim, kernel_size=5, dilation=1),
        ])

        # Sequence modeling: 2-layer GRU
        self.gru = nn.GRU(
            input_size=conv_dim,
            hidden_size=gru_dim,
            num_layers=n_gru_layers,
            batch_first=True,
            bidirectional=False
        )

        # Statistical multi-resolution pooling (Mean + Std + Min + Max)
        # Directly captures temporal dropouts, clipping saturation, and speech continuity
        # without softmax attention blind spots
        pooled_dim = gru_dim * 4  # 160 * 4 = 640

        # Dedicated Task Heads
        self.mos_head = nn.Sequential(
            nn.Linear(pooled_dim, 96),
            nn.GELU(),
            nn.Dropout(0.15),
            nn.Linear(96, 1)
        )
        nn.init.constant_(self.mos_head[-1].bias, 3.5)

        self.voice_head = nn.Sequential(
            nn.Linear(pooled_dim, 48),
            nn.GELU(),
            nn.Dropout(0.15),
            nn.Linear(48, 1)
        )
        nn.init.constant_(self.voice_head[-1].bias, 0.0)

        self.diag_head = nn.Sequential(
            nn.Linear(pooled_dim, 96),
            nn.GELU(),
            nn.Dropout(0.15),
            nn.Linear(96, 5)
        )
        nn.init.constant_(self.diag_head[-1].bias, -1.5)

    def forward(self, x):
        # x: (B, T, F)
        # Permute to (B, F, T) for 1D conv
        h = x.transpose(1, 2)
        h = self.act(self.in_bn(self.in_proj(h)))
        
        for block in self.conv_blocks:
            h = block(h)

        # Back to (B, T, C) for GRU
        h = h.transpose(1, 2)
        gru_out, _ = self.gru(h)  # (B, T, gru_dim)

        # Multi-resolution statistical pooling
        mean_stat = torch.mean(gru_out, dim=1)
        std_stat = torch.std(gru_out, dim=1, unbiased=False)
        min_stat = torch.min(gru_out, dim=1).values
        max_stat = torch.max(gru_out, dim=1).values
        pooled = torch.cat([mean_stat, std_stat, min_stat, max_stat], dim=-1)  # (B, 640)

        # Heads
        mos = torch.clamp(self.mos_head(pooled), 0.0, 5.0)
        voice_prob = torch.sigmoid(self.voice_head(pooled))
        diagnostics = torch.sigmoid(self.diag_head(pooled))

        return mos, voice_prob, diagnostics

def get_model():
    model = SpeechQualityModel()
    n_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"SpeechQualityModel parameters: {n_params:,} (~{n_params * 4 / (1024*1024):.2f} MB fp32)")
    return model

if __name__ == '__main__':
    model = get_model()
    dummy = torch.randn(2, 201, 85)
    mos, vp, diag = model(dummy)
    print("MOS shape:", mos.shape, "range:", mos.min().item(), mos.max().item())
    print("Voice prob shape:", vp.shape, "range:", vp.min().item(), vp.max().item())
    print("Diagnostics shape:", diag.shape, "range:", diag.min().item(), diag.max().item())
