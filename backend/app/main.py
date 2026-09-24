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

from . import model_utils_v2 as model_utils
from .explain import build_explanations
from .faults import FAULTS, inject


def rul_band(rul_preds, k=1.5, w=10):
    """Heuristic uncertainty band: rolling variance of predictions + 8% of value."""
    r = np.asarray(rul_preds, dtype=float)
    sd = np.array([r[max(0, i - w):i + 1].std() for i in range(len(r))])
    m = k * sd + 0.08 * r
    return np.maximum(r - m, 0), r + m

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


@app.get("/api/faults")
def faults():
    return [{"key": k, "label": v["label"]} for k, v in FAULTS.items()]


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
    fault: str = Query("", description="Fault key from /api/faults (empty = none)"),
    severity: float = Query(0.6, ge=0.0, le=2.0),
    fault_start: int = Query(60, ge=0),
    mitigate: float = Query(0.0, ge=0.0, le=1.0, description="What-if: fraction the fault growth is slowed"),
    mitigate_at: int = Query(-1, description="What-if: cycle where mitigation starts"),
):
    config = _artifacts["config"]
    n_features = len(config["feature_cols"])
    window_size = config["window_size"]
    threshold = config["anomaly_threshold"]
    rul_cap = config["rul_cap"]

    data, true_rul, sensitive_idx, degradation_start = model_utils.simulate_engine_run(
        _artifacts["rul_model"], _artifacts["ae_model"], cycles, n_features, window_size, seed, rul_cap
    )
    if fault:
        data = inject(data, fault, min(fault_start, cycles - 1), severity,
                      mitigate, mitigate_at if mitigate_at >= 0 else None)
    # Ground-truth RUL now depends on the injected fault
    fs = min(fault_start, cycles - 1)
    true_rul = model_utils.true_rul(cycles, n_features, fault, severity, fs, rul_cap,
                                    mitigate, mitigate_at if mitigate_at >= 0 else None)
    if fault:
        degradation_start = max(fs, 10)
        sensitive_idx = model_utils.fault_channel_indices(fault)
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
            "fault": fault or None,
        },
        "true_rul": true_rul.tolist(),
        "predicted_rul": rul_preds.tolist(),
        "anomaly_scores": anomaly_scores.tolist(),
        "status_per_cycle": status_per_cycle,
        "sensor_data": data.tolist(),
        "feature_errors": feature_errors.tolist(),
        "physics": physics,
        "rul_low": rul_band(rul_preds)[0].tolist(),
        "rul_high": rul_band(rul_preds)[1].tolist(),
        "explanations": explanations,
    }