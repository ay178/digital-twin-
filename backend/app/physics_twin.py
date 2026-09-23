"""
Spacecraft lumped-parameter thermal model (physics baseline).

    m * cp * dT/dt = Q_solar + Q_internal - eps * sigma * A * (T^4 - T_space^4)

Used as the physics half of the hybrid twin:
    residual = normalised(sensor) - normalised(physics_expected)
A big residual means reality disagrees with physics -> anomaly evidence
in addition to the ML model's reconstruction error.
"""

import numpy as np

PARAMS = {
    "mass": 40.0,          # kg, thermal mass of the avionics/battery bay
    "cp": 900.0,           # J/(kg*K), aluminium structure
    "emissivity": 0.85,
    "area": 0.8,           # m^2, radiating area
    "sigma": 5.67e-8,
    "T_space": 3.0,        # K, deep space background
    "q_solar_sun": 60.0,   # W absorbed in sunlight
    "q_internal": 35.0,    # W avionics dissipation
    "orbit_period": 90,    # cycles per orbit (sun/eclipse alternation)
    "eclipse_fraction": 0.35,
    "dt": 30.0,            # s per cycle
}


def expected_temperature(cycles: int, p: dict = PARAMS) -> np.ndarray:
    """Physics-predicted temperature (Celsius) for each cycle."""
    T = 293.15
    out = np.empty(cycles)
    for k in range(cycles):
        phase = (k % p["orbit_period"]) / p["orbit_period"]
        in_eclipse = phase > (1 - p["eclipse_fraction"])
        q_solar = 0.0 if in_eclipse else p["q_solar_sun"]
        q_rad = p["emissivity"] * p["sigma"] * p["area"] * (T**4 - p["T_space"] ** 4)
        dT = (q_solar + p["q_internal"] - q_rad) / (p["mass"] * p["cp"])
        T += dT * p["dt"] * 10  # x10: compress time so the trend is visible in ~200 cycles
        out[k] = T - 273.15
    return out


def _z(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x, dtype=float)
    s = x.std()
    return (x - x.mean()) / (s if s > 1e-9 else 1.0)


def physics_residual(sensor_channel: np.ndarray, cycles: int) -> dict:
    """
    Compare a (possibly scaled) sensor channel with the physics curve.
    Both are z-normalised so units/scaling don't matter; only shape does.
    """
    expected = expected_temperature(cycles)
    residual = _z(sensor_channel) - _z(expected)
    # Flag cycles whose residual is far outside the healthy first third
    base = residual[: max(cycles // 3, 10)]
    limit = float(abs(base.mean()) + 3 * base.std())
    return {
        "expected": expected.tolist(),
        "residual": residual.tolist(),
        "limit": limit,
        "flagged_cycles": [int(i) for i in np.where(np.abs(residual) > limit)[0]],
    }