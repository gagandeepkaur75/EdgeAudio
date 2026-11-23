"""
Builds the three demo voices used on the Live Test page from real studio
recordings in the CMU ARCTIC corpus (Carnegie Mellon University, free to use
with attribution: http://festvox.org/cmu_arctic/).

    Voice 1  public/audio/demo_male.wav            speaker "bdl" (US male)
    Voice 2  public/audio/demo_female.wav          speaker "slt" (US female)
    Voice 3  public/audio/demo_conversational.wav  bdl and slt taking turns

Each sentence is trimmed of leading/trailing silence, faded in/out (no clicks),
loudness-matched, and joined with natural pauses. Clips are 16 kHz mono and
end with a pause so they loop smoothly.

Usage (from the repo root):
    python ml/make_demo_voices.py                      # downloads sources into ml/data/cmu_arctic if missing
    python ml/make_demo_voices.py --src <folder>       # folder containing bdl/ and slt/ sub-folders
"""
import argparse
import os
import urllib.request

import numpy as np
import soundfile as sf

from paths import P, REPO_DIR

SR = 16000
BASE_URL = "http://festvox.org/cmu_arctic/cmu_arctic/cmu_us_{spk}_arctic/wav/arctic_a{num:04d}.wav"
TARGET_RMS_DBFS = -20.0
PEAK_LIMIT = 0.89  # about -1 dBFS

# Sentence numbers (arctic_aNNNN) used for each clip
MALE_SENTENCES = [1, 2, 3, 4, 5, 6, 7]
FEMALE_SENTENCES = [8, 9, 10, 11, 12, 13, 14, 15]
DIALOGUE_TURNS = [("bdl", 8), ("slt", 1), ("bdl", 9), ("slt", 2), ("bdl", 10), ("slt", 3)]


def ensure_sources(src):
    needed = {("bdl", n) for n in MALE_SENTENCES} | {("slt", n) for n in FEMALE_SENTENCES} | set(DIALOGUE_TURNS)
    for spk, num in sorted(needed):
        path = os.path.join(src, spk, f"arctic_a{num:04d}.wav")
        if os.path.exists(path):
            continue
        os.makedirs(os.path.dirname(path), exist_ok=True)
        url = BASE_URL.format(spk=spk, num=num)
        print(f"Downloading {url}")
        urllib.request.urlretrieve(url, path)


def load_sentence(src, spk, num):
    audio, sr = sf.read(os.path.join(src, spk, f"arctic_a{num:04d}.wav"), dtype="float32")
    if sr != SR:
        raise ValueError(f"Expected {SR} Hz, got {sr} Hz for {spk} {num}")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    audio = audio - np.mean(audio)  # remove DC offset

    # Trim silence: keep from 60 ms before the first to 120 ms after the last
    # 20 ms frame within 40 dB of the loudest frame.
    frame = 320
    n = len(audio) // frame
    rms = np.sqrt(np.mean(audio[: n * frame].reshape(n, frame) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms)
    active = np.where(db > db.max() - 40)[0]
    start = max(0, active[0] * frame - int(0.06 * SR))
    end = min(len(audio), (active[-1] + 1) * frame + int(0.12 * SR))
    audio = audio[start:end]

    # 10 ms fades so joins never click
    fade = int(0.01 * SR)
    ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
    audio[:fade] *= ramp
    audio[-fade:] *= ramp[::-1]

    # Loudness-match on active speech
    gain = 10 ** (TARGET_RMS_DBFS / 20) / (np.sqrt(np.mean(audio**2)) + 1e-9)
    return audio * gain


def silence(seconds):
    return np.zeros(int(seconds * SR), dtype=np.float32)


def build(parts):
    out = np.concatenate(parts + [silence(0.6)])
    peak = np.max(np.abs(out))
    if peak > PEAK_LIMIT:
        out *= PEAK_LIMIT / peak
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", default=P("data/cmu_arctic"), help="folder with bdl/ and slt/ sub-folders")
    ap.add_argument("--out", default=os.path.join(REPO_DIR, "public", "audio"))
    args = ap.parse_args()

    ensure_sources(args.src)
    clips = {}

    parts = []
    for num in MALE_SENTENCES:
        parts += [load_sentence(args.src, "bdl", num), silence(0.45)]
    clips["demo_male.wav"] = build(parts)

    parts = []
    for num in FEMALE_SENTENCES:
        parts += [load_sentence(args.src, "slt", num), silence(0.45)]
    clips["demo_female.wav"] = build(parts)

    parts = []
    for spk, num in DIALOGUE_TURNS:
        parts += [load_sentence(args.src, spk, num), silence(0.55)]
    clips["demo_conversational.wav"] = build(parts)

    os.makedirs(args.out, exist_ok=True)
    for name, audio in clips.items():
        path = os.path.join(args.out, name)
        sf.write(path, audio, SR, subtype="PCM_16")
        print(f"Wrote {path}  ({len(audio) / SR:.1f} s)")


if __name__ == "__main__":
    main()
