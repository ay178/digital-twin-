"""
model_utils_v2 - models trained on real NASA SMAP telemetry (see Colab notebook).

Same public interface as the old model_utils, so main.py only swaps the import:
    load_artifacts(), simulate_engine_run(...), run_predictions(...)
plus true_rul() and fault_channel_indices() used after fault injection.
Uses scikit-learn + joblib only (no TensorFlow needed).
"""
import json
import os

import numpy as np

from .faults import FAULTS, inject
from .spacecraft_channels import SPACECRAFT_CHANNELS

MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
FAIL_LEVEL = 1.0                      # drift magnitude that counts as "failed"
FEATURES = [c[0] for c in SPACECRAFT_CHANNELS]
_BASE = None                          # real-telemetry baseline (cycles x features)


def window_stack(data, W):
    """(n, F) -> (n-W+1, W, F) sliding windows."""
    return np.stack([data[i - W + 1:i + 1] for i in range(W - 1, len(data))])


def rul_features(win, feat_err):
    """Features for the RUL model: window stats + AE per-channel error."""
    return np.concatenate([win.mean(0), win[-1] - win[0], win.std(0), feat_err])


def ae_errors(ae, wins):
    """Per-window, per-channel reconstruction error -> (n_windows, F)."""
    n, W, F = wins.shape
    X = wins.reshape(n, -1)
    err = (X - ae.predict(X)) ** 2
    return err.reshape(n, W, F).mean(axis=1)


def true_rul(cycles, n_features, fault, severity, start, cap, mitigate=0.0, mitigate_at=None):
    """Cycles until injected drift reaches FAIL_LEVEL (capped)."""
    if not fault or fault not in FAULTS:
        return np.full(cycles, float(cap))
    probe = inject(np.zeros((cycles, n_features)), fault, min(start, cycles - 1), 1.0, mitigate, mitigate_at)
    mag = np.abs(probe).max(axis=1) * severity
    hit = np.where(mag >= FAIL_LEVEL)[0]
    if len(hit):
        tf = float(hit[0])
    else:
        slope = mag[-1] - mag[-2] if cycles > 1 else 0.0
        tf = (cycles - 1) + (FAIL_LEVEL - mag[-1]) / slope if slope > 1e-9 else 1e9
    return np.clip(tf - np.arange(cycles), 0, cap)


def fault_channel_indices(fault):
    spec = FAULTS.get(fault)
    if not spec:
        return []
    names = {n: i for i, n in enumerate(FEATURES)}
    return [names[n] for n in spec["channels"] if n in names]


def load_artifacts():
    import joblib
    global _BASE
    need = ["ae_v2.joblib", "rul_v2.joblib", "config_v2.json", "baseline_v2.npy"]
    missing = [f for f in need if not os.path.exists(os.path.join(MODEL_DIR, f))]
    if missing:
        raise FileNotFoundError(f"Missing model files in {MODEL_DIR}: {missing}. Train with the Colab notebook first.")
    with open(os.path.join(MODEL_DIR, "config_v2.json")) as f:
        config = json.load(f)
    _BASE = np.load(os.path.join(MODEL_DIR, "baseline_v2.npy")).astype(float)
    return {
        "ae_model": joblib.load(os.path.join(MODEL_DIR, "ae_v2.joblib")),
        "rul_model": joblib.load(os.path.join(MODEL_DIR, "rul_v2.joblib")),
        "config": config,
        "using_real_models": True,
        "using_real_config": True,
    }


def simulate_engine_run(rul_model, ae_model, cycles, n_features, window_size, seed, rul_cap):
    """Replay a slice of real SMAP telemetry. Faults are injected afterwards in main.py."""
    rng = np.random.default_rng(seed)
    off = int(rng.integers(0, len(_BASE)))
    data = np.take(_BASE, np.arange(off, off + cycles), axis=0, mode="wrap")[:, :n_features]
    return data, np.full(cycles, float(rul_cap)), [], cycles


def run_predictions(rul_model, ae_model, data, window_size):
    data = np.asarray(data, dtype=float)
    W = window_size
    wins = window_stack(data, W)
    fe = ae_errors(ae_model, wins)                       # (n_windows, F)
    X = np.stack([rul_features(w, e) for w, e in zip(wins, fe)])
    rul = np.clip(rul_model.predict(X), 0, None)
    score = fe.mean(axis=1)
    pad = W - 1                                           # align to per-cycle arrays
    anomaly = np.concatenate([np.repeat(score[0], pad), score])
    feat_err = np.vstack([np.repeat(fe[:1], pad, axis=0), fe])
    return rul, anomaly, feat_err