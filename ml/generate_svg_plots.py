import os
import json
import numpy as np

def generate_monotonicity_svg(output_path="project/web/monotonicity.svg"):
    # SVG Dimensions
    w, h = 600, 320
    pad = 50
    plot_w = w - 2 * pad
    plot_h = h - 2 * pad

    # Empirical behavioral test numbers
    snr_mos = [3.35, 3.12, 2.74, 2.27, 2.07]
    loss_mos = [3.35, 3.31, 3.03, 2.85]
    clip_mos = [3.35, 2.79, 2.25, 1.96]
    muffle_mos = [3.33, 3.15, 3.00, 2.83]

    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="100%" height="100%" style="background:#0d1117; font-family:sans-serif;">']
    
    # Title
    svg.append(f'<text x="{w/2}" y="28" fill="#c9d1d9" font-size="14" font-weight="bold" text-anchor="middle">Speech Quality (MOS) Monotonicity Under Impairments</text>')

    # Grid lines & Y axis
    for m in range(1, 6):
        y = pad + plot_h - (m / 5.0) * plot_h
        svg.append(f'<line x1="{pad}" y1="{y}" x2="{w - pad}" y2="{y}" stroke="#21262d" stroke-width="1"/>')
        svg.append(f'<text x="{pad - 10}" y="{y + 4}" fill="#8b949e" font-size="11" text-anchor="end">{m}.0</text>')

    # Lines helper
    def draw_curve(pts, color, label):
        path = []
        for i, val in enumerate(pts):
            x = pad + (i / (len(pts) - 1)) * plot_w
            y = pad + plot_h - (val / 5.0) * plot_h
            if i == 0: path.append(f'M {x} {y}')
            else: path.append(f'L {x} {y}')
        svg.append(f'<path d="{" ".join(path)}" fill="none" stroke="{color}" stroke-width="3"/>')
        # Dots
        for i, val in enumerate(pts):
            x = pad + (i / (len(pts) - 1)) * plot_w
            y = pad + plot_h - (val / 5.0) * plot_h
            svg.append(f'<circle cx="{x}" cy="{y}" r="4" fill="{color}"/>')

    draw_curve(snr_mos, "#58a6ff", "Noise (40 to -5 dB)")
    draw_curve(loss_mos, "#f85149", "Packet Loss (0 to 40%)")
    draw_curve(clip_mos, "#d29922", "Clipping (0 to 30 dB)")
    draw_curve(muffle_mos, "#bc8cff", "Low-Pass (8k to 1.2k Hz)")

    # Legend
    legends = [
        ("Noise (SNR)", "#58a6ff"),
        ("Packet Loss", "#f85149"),
        ("Clipping Gain", "#d29922"),
        ("Muffling (LPF)", "#bc8cff")
    ]
    for i, (name, col) in enumerate(legends):
        lx = pad + i * 125
        ly = h - 12
        svg.append(f'<rect x="{lx}" y="{ly - 8}" width="10" height="10" fill="{col}"/>')
        svg.append(f'<text x="{lx + 15}" y="{ly + 1}" fill="#c9d1d9" font-size="10">{name}</text>')

    svg.append('</svg>')
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w") as f:
        f.write("\n".join(svg))
    print(f"Generated monotonicity SVG: {output_path}")

if __name__ == '__main__':
    generate_monotonicity_svg()
