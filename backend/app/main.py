"""
Engine Digital Twin — FastAPI backend

Endpoints:
    GET  /api/health          -> service + model status check
    GET  /api/simulate        -> run a full simulated mission through the
                                  trained models and return everything the
                                  frontend needs to render the dashboard

Run locally:
    uvicorn app.main:app --reload --port 8000
"""

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from . import model_utils

app = FastAPI(title="Engine Digital Twin API", version="1.0.0")

# Allow the frontend (any origin, tighten this to your deployed frontend URL
# in production) to call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_artifacts = model_utils.load_artifacts()


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
    seed: int = Query(42, description="Random seed - change for a different simulated run"),
):
    config = _artifacts["config"]
    n_features = len(config["feature_cols"])
    window_size = config["window_size"]
    threshold = config["anomaly_threshold"]
    rul_cap = config["rul_cap"]

    data, true_rul, sensitive_idx = model_utils.simulate_engine_run(
        cycles, n_features, seed, rul_cap
    )
    rul_preds, anomaly_scores, feature_errors = model_utils.run_predictions(
        _artifacts["rul_model"], _artifacts["ae_model"], data, window_size
    )

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
            "feature_names": config["feature_cols"],
        },
        "true_rul": true_rul.tolist(),
        "predicted_rul": rul_preds.tolist(),
        "anomaly_scores": anomaly_scores.tolist(),
        "status_per_cycle": status_per_cycle,
        "sensor_data": data.tolist(),
        "feature_errors": feature_errors.tolist(),
    }