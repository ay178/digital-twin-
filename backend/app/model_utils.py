"""
Model loading + simulation utilities for the Engine Digital Twin backend.

Loading strategy (in order of preference):
1. Weights-only files (rul_lstm.weights.h5, autoencoder.weights.h5) loaded
   into an architecture defined here in code. This is the RECOMMENDED path
   -- weights are far more portable across TensorFlow/Keras versions than
   full model files, which embed a version-specific layer config that can
   break when the training environment (e.g. Google Colab) and the
   deployment environment have different Keras versions.
2. Full model files (rul_lstm_model.h5, anomaly_autoencoder.h5) via
   load_model(), kept as a fallback for convenience.
3. Small untrained dummy models with matching shapes, so the API still runs
   end-to-end even before any trained files are added.
"""

import os
import pickle

import numpy as np
from tensorflow.keras.models import Sequential, Model, load_model
from tensorflow.keras.layers import LSTM, Dense, Dropout, Input

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")

# Default config, used only if config.pkl is missing.
# feature_cols mirrors the 21-sensor CMAPSS set with the near-zero-variance
# sensors dropped, same as the training notebook.
DEFAULT_CONFIG = {
    "feature_cols": [
        "sensor_2", "sensor_3", "sensor_4", "sensor_7", "sensor_8", "sensor_9",
        "sensor_11", "sensor_12", "sensor_13", "sensor_14", "sensor_15",
        "sensor_17", "sensor_20", "sensor_21",
        "setting_1", "setting_2", "setting_3",
    ],
    "window_size": 30,
    "anomaly_threshold": 0.005,
    "rul_cap": 125,
}


def _build_rul_architecture(window_size: int, n_features: int):
    """Must exactly match the architecture trained in the Colab notebook."""
    return Sequential([
        LSTM(64, return_sequences=True, input_shape=(window_size, n_features)),
        Dropout(0.2),
        LSTM(32, return_sequences=False),
        Dropout(0.2),
        Dense(16, activation="relu"),
        Dense(1),
    ])


def _build_autoencoder_architecture(n_features: int):
    """Must exactly match the architecture trained in the Colab notebook."""
    input_layer = Input(shape=(n_features,))
    encoded = Dense(16, activation="relu")(input_layer)
    encoded = Dense(8, activation="relu")(encoded)
    decoded = Dense(16, activation="relu")(encoded)
    decoded = Dense(n_features, activation="sigmoid")(decoded)
    return Model(inputs=input_layer, outputs=decoded)


def _load_models(window_size: int, n_features: int):
    """Try weights-only first, then full h5, then fall back to untrained dummies."""
    rul_weights_path = os.path.join(MODELS_DIR, "rul_lstm.weights.h5")
    ae_weights_path = os.path.join(MODELS_DIR, "autoencoder.weights.h5")
    rul_full_path = os.path.join(MODELS_DIR, "rul_lstm_model.h5")
    ae_full_path = os.path.join(MODELS_DIR, "anomaly_autoencoder.h5")

    # Preferred path: weights-only (robust across Keras versions)
    if os.path.exists(rul_weights_path) and os.path.exists(ae_weights_path):
        rul_model = _build_rul_architecture(window_size, n_features)
        rul_model.load_weights(rul_weights_path)
        ae_model = _build_autoencoder_architecture(n_features)
        ae_model.load_weights(ae_weights_path)
        return rul_model, ae_model, True

    # Fallback: full model files (works only if Keras versions match closely)
    if os.path.exists(rul_full_path) and os.path.exists(ae_full_path):
        try:
            rul_model = load_model(rul_full_path, compile=False)
            ae_model = load_model(ae_full_path, compile=False)
            return rul_model, ae_model, True
        except Exception as e:
            print(
                "WARNING: could not load full .h5 model files (likely a "
                f"Keras version mismatch with Colab): {e}\n"
                "Falling back to untrained placeholder models."
            )

    # Last resort: untrained placeholders so the API still runs
    rul_model = _build_rul_architecture(window_size, n_features)
    ae_model = _build_autoencoder_architecture(n_features)
    return rul_model, ae_model, False


def load_artifacts():
    """Load real trained artifacts if present, else build safe dummy stand-ins."""
    config_path = os.path.join(MODELS_DIR, "config.pkl")
    scaler_path = os.path.join(MODELS_DIR, "scaler.pkl")

    if os.path.exists(config_path):
        with open(config_path, "rb") as f:
            config = pickle.load(f)
        using_real_config = True
    else:
        config = DEFAULT_CONFIG
        using_real_config = False

    scaler = None
    if os.path.exists(scaler_path):
        with open(scaler_path, "rb") as f:
            scaler = pickle.load(f)

    n_features = len(config["feature_cols"])
    window_size = config["window_size"]

    rul_model, ae_model, using_real_models = _load_models(window_size, n_features)

    return {
        "rul_model": rul_model,
        "ae_model": ae_model,
        "scaler": scaler,
        "config": config,
        "using_real_models": using_real_models,
        "using_real_config": using_real_config,
    }


def _healthy_baseline(rul_model, ae_model, n_features: int, window_size: int, seed: int = 0):
    """Find a per-feature vector that both models agree looks like a
    healthy, early-life engine.

    Two things need to line up for the synthetic mission to make sense:
    1. The autoencoder should reconstruct the "healthy" vector with low
       error (otherwise every mission starts already flagged critical --
       see the module docstring above `simulate_engine_run`).
    2. The RUL model, shown a window of that same vector repeated across
       time, should predict a *high* remaining-useful-life (otherwise every
       mission starts already flagged "watch", regardless of how healthy it
       actually is).

    Neither model ships with the real training data to sample a genuine
    "cycle 1" vector from, so instead we search a handful of candidate
    baselines: converge each to a fixed point of the autoencoder (a vector
    it reconstructs near-perfectly, by construction -- satisfies #1), then
    ask the RUL model which of those candidates it considers the healthiest
    (satisfies #2). Both passes are batched into a couple of model calls
    total, not one per candidate, to keep this fast.
    """
    rng = np.random.default_rng(seed)
    n_candidates = 6
    x = rng.uniform(0.2, 0.8, size=(n_candidates, n_features)).astype(np.float32)
    for _ in range(15):
        x = ae_model.predict(x, verbose=0)

    windows = np.repeat(x[:, np.newaxis, :], window_size, axis=1)  # (n_candidates, window_size, n_features)
    rul_estimates = rul_model.predict(windows, verbose=0).flatten()
    best = int(np.argmax(rul_estimates))
    return x[best]


def simulate_engine_run(rul_model, ae_model, total_cycles: int, n_features: int, window_size: int, seed: int, rul_cap: int):
    """Generate a synthetic run-to-failure mission in normalized [0,1] feature space."""
    rng = np.random.default_rng(seed)
    baseline = _healthy_baseline(rul_model, ae_model, n_features, window_size, seed)

    data = np.zeros((total_cycles, n_features))
    sensitive_idx = rng.choice(n_features, size=max(3, n_features // 3), replace=False)
    degradation_start = int(total_cycles * 0.6)

    for i in range(total_cycles):
        row = baseline + 0.02 * rng.standard_normal(n_features)
        if i > degradation_start:
            progress = (i - degradation_start) / (total_cycles - degradation_start)
            row[sensitive_idx] += 0.5 * (progress ** 2)
        data[i] = np.clip(row, 0.0, 1.0)

    true_rul = np.clip(total_cycles - 1 - np.arange(total_cycles), 0, rul_cap).astype(float)
    return data, true_rul, sensitive_idx.tolist(), degradation_start


def run_predictions(rul_model, ae_model, data: np.ndarray, window_size: int):
    """Batched prediction over the whole mission: RUL per valid cycle, overall
    anomaly score per cycle, and the per-sensor squared error per cycle (used
    for explainability -- which sensor is driving a given anomaly score)."""
    total = data.shape[0]
    windows = np.stack([data[i - window_size + 1:i + 1] for i in range(window_size - 1, total)])
    rul_preds = rul_model.predict(windows, verbose=0).flatten()

    recon = ae_model.predict(data, verbose=0)
    sq_err = (data - recon) ** 2          # shape: (cycles, n_features)
    mse = np.mean(sq_err, axis=1)          # shape: (cycles,)
    return rul_preds, mse, sq_err