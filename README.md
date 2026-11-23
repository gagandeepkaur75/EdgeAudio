# EdgeAudio-QC

Privacy-preserving speech quality estimation in the browser (UCS503 Software Project).

A small neural model runs **on the user's device** (ONNX Runtime Web / WebAssembly) and estimates
perceived speech quality (a MOS-style 1–5 score) plus diagnostics (noise, clipping, muffling,
dropouts, wind) from rolling 2-second audio windows. Raw audio never leaves the browser.

## Repository layout

| Path | What it is |
|------|-----------|
| `src/` | React 19 + Vite frontend (project site, live test page, admin/publishing UI) |
| `src/utils/mlAudioAnalyzer.js` | In-browser pipeline: 16 kHz resampling, feature extraction (80 log-mel + 5 spectral features), ONNX inference, smoothing |
| `src/pages/LiveCommunication.jsx` | Live test page: mic / demo voice / PC audio capture, condition simulator, 2-person WebRTC call |
| `public/models/` | Model and feature files the browser loads (`model.onnx`, `mel_basis.json`, `norm_stats.json`) |
| `public/audio/` | Demo voice clips |
| `backend/` | Express API: admin auth, uploads, versioned deliverable publishing, WebRTC signaling — see `backend/README.md` |
| `ml/` | Python training pipeline (dataset generation, teacher labels, model, training, ONNX export, tests). Paths are defined in `ml/paths.py` |

## Running locally

Requires Node.js 22.12+ (see `.nvmrc`).

```bash
npm install
npm run dev          # frontend on http://localhost:5173
```

In another terminal, for the admin, deliverables and call features:

```bash
cd backend
npm install
cp .env.example .env # then fill it in
npm run dev          # API on http://localhost:3000
```

The frontend reads the API address from `VITE_API_URL` (`.env.development` / `.env.production`).

Other scripts: `npm run build`, `npm run preview`, `npm run lint`.

## ML pipeline

From the repo root, with the Python dependencies installed (PyTorch, torchaudio, onnx, onnxruntime, numpy, scipy, soundfile):

```bash
python ml/download_data.py         # speech + noise corpora into ml/data/
python ml/train.py                 # trains, writes ml/checkpoints/ and public/models/norm_stats.json
python ml/export_onnx.py           # exports public/models/model.onnx and checks PyTorch/ONNX parity
python ml/test_suite.py            # evaluation + JS/Python feature-parity check
```

Note: training labels come from `ml/teacher.py`, a heuristic quality score computed from the
known degradations applied to clean speech, not from human listening tests.
