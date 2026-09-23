"""
Spacecraft Digital Twin - FastAPI backend

Endpoints:
    GET  /api/health          -> service + model status check
    GET  /api/simulate        -> simulate a mission and return telemetry,
                                 anomaly scores, RUL predictions, physics
                                 residuals and explainable recommendations

Run locally:
    uvicorn app.main:app --reload --port 8000
"""

import numpy as np
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from . import model_utils
from .explain import build_explanations
from .physics_twin import physics_residual
from .spacecraft_channels import channel_names, channel_info

app = FastAPI(title="Spacecraft Digital Twin API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten to your deployed frontend URL in production
    allow_methods=["*"],
    allow_headers=["*"],
)

_artifacts = model_utils.load_artifacts()

# Which channel the thermal physics model is compared against.
# Index 3 = "Battery Temperature" in spacecraft_channels.py
THERMAL_CHANNEL_INDEX = 3


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "using_real_models": _artifacts["using_real_models"],
        "using_real_config": _artifacts["using_real_config"],
        "window_size": _artifacts["config"]["window_size"],
        "n_features": len(_artifacts["config"]["feature_cols"]),
        "anomaly_threshold": _artifacts["config"]["anomaly_threshold"],
    }


@app.get("/api/simulate")
def simulate(
    cycles: int = Query(200, ge=60, le=500, description="Length of the simulated mission"),
    seed: int = Query(42, description="Random seed for a different simulated run"),
):
    config = _artifacts["config"]
    n_features = len(config["feature_cols"])
    window_size = config["window_size"]
    threshold = config["anomaly_threshold"]
    rul_cap = config["rul_cap"]

    data, true_rul, sensitive_idx, degradation_start = model_utils.simulate_engine_run(
        _artifacts["rul_model"], _artifacts["ae_model"], cycles, n_features, window_size, seed, rul_cap
    )
    rul_preds, anomaly_scores, feature_errors = model_utils.run_predictions(
        _artifacts["rul_model"], _artifacts["ae_model"], data, window_size
    )

    # Calibrate the critical cutoff against this mission's healthy phase
    healthy_errors = anomaly_scores[:degradation_start]
    calibrated_threshold = (
        float(healthy_errors.mean() + 4 * healthy_errors.std()) if len(healthy_errors) else threshold
    )
    threshold = max(threshold, calibrated_threshold)

    first_valid_cycle = window_size - 1
    status_per_cycle = []
    for i, cyc in enumerate(range(first_valid_cycle, cycles)):
        pred_rul = float(rul_preds[i])
        mse = float(anomaly_scores[cyc])
        if mse > threshold:
            status = "critical"
        elif pred_rul < 30:
            status = "watch"
        else:
            status = "normal"
        status_per_cycle.append(status)

    # --- Physics half of the hybrid twin -----------------------------------
    thermal_idx = min(THERMAL_CHANNEL_INDEX, n_features - 1)
    physics = physics_residual(np.asarray(data)[:, thermal_idx], cycles)

    # --- Explainable recommendations ---------------------------------------
    explanations = build_explanations(
        first_valid_cycle, status_per_cycle, rul_preds, feature_errors
    )

    return {
        "meta": {
            "cycles": cycles,
            "seed": seed,
            "window_size": window_size,
            "anomaly_threshold": threshold,
            "rul_cap": rul_cap,
            "first_valid_cycle": first_valid_cycle,
            "using_real_models": _artifacts["using_real_models"],
            "sensitive_sensor_indices": sensitive_idx,
            "feature_names": channel_names(n_features),
            "feature_subsystems": [channel_info(i)[1] for i in range(n_features)],
            "feature_units": [channel_info(i)[2] for i in range(n_features)],
            "thermal_channel_index": thermal_idx,
        },
        "true_rul": true_rul.tolist(),
        "predicted_rul": rul_preds.tolist(),
        "anomaly_scores": anomaly_scores.tolist(),
        "status_per_cycle": status_per_cycle,
        "sensor_data": data.tolist(),
        "feature_errors": feature_errors.tolist(),
        "physics": physics,
        "explanations": explanations,
    }