"""
Central place for every file path the ML scripts read or write.

All paths are resolved relative to the EdgeAudio repo, so the scripts work no
matter which directory you run them from.

    data/     -> ml/data           (downloaded speech/noise corpora, git-ignored)
    models/   -> ml/checkpoints    (checkpoints, norm stats, dataset cache, metrics)
    web/      -> public/models     (files the browser app loads: model.onnx, mel_basis.json, ...)
    train/    -> ml                (JS feature-parity test files)
"""
import os

ML_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(ML_DIR)

_ROOTS = {
    "data": os.path.join(ML_DIR, "data"),
    "models": os.path.join(ML_DIR, "checkpoints"),
    "web": os.path.join(REPO_DIR, "public", "models"),
    "train": ML_DIR,
}


def P(rel):
    """Map a logical path like "models/best_model.pt" to its real location."""
    head, _, tail = rel.partition("/")
    if head not in _ROOTS:
        raise ValueError(f"Unknown path root '{head}' in '{rel}'")
    return os.path.join(_ROOTS[head], *tail.split("/")) if tail else _ROOTS[head]
