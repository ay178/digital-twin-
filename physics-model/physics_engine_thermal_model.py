"""
Physics-Based Engine Thermal Model (Lumped-Parameter Energy Balance)
----------------------------------------------------------------------
Purpose: Given RPM, fuel flow, and ambient/altitude conditions, predict the
"expected" cylinder head temperature (CHT) over time. This is the physics
baseline that runs ALONGSIDE the AI/ML model in the Digital Twin core.

How it's used in the Digital Twin:
    residual = actual_sensor_CHT - physics_model_predicted_CHT
    -> a large residual (physics vs reality mismatch) is itself a strong
       anomaly signal, in addition to the AI model's own anomaly score.

This is intentionally a SIMPLIFIED model (not full CFD/ANSYS) because the
Digital Twin needs to run in real time, not take minutes per timestep.
"""

import numpy as np
from scipy.integrate import solve_ivp
import matplotlib.pyplot as plt

# -------------------------------------------------------------------
# STEP 1: Engine & thermal parameters
# Replace these with actual datasheet values for your target engine
# (e.g. Rotax 914 or the indigenous CRDi engine) once available.
# -------------------------------------------------------------------
params = {
    "m_c": 15.0,          # kg, thermal mass of engine block/head (lumped)
    "c_p": 500.0,         # J/(kg*K), specific heat of engine material (steel/aluminum mix)
    "LHV": 43_000_000.0,  # J/kg, lower heating value of fuel (typical aviation gasoline/diesel)
    "eta_thermal": 0.30,  # fraction of fuel energy that ends up as heat into the block (not useful work)
    "h_conv": 45.0,       # W/(m^2*K), convective heat transfer coefficient (airflow cooling)
    "A_surface": 0.6,     # m^2, effective heat-dissipating surface area of engine
    "emissivity": 0.85,   # radiative emissivity of engine surface
    "sigma": 5.67e-8,     # Stefan-Boltzmann constant
}

# -------------------------------------------------------------------
# STEP 2: Operating condition profile (this is what changes per mission)
# In the real Digital Twin, these come from live CAN bus data instead
# of being hardcoded like this.
# -------------------------------------------------------------------
def fuel_flow_rate(t):
    """kg/s of fuel burned, as a function of time. Replace with real RPM->fuel map."""
    # Example: engine idles, then climbs to cruise RPM
    if t < 60:
        return 0.0008          # idle
    elif t < 300:
        return 0.0015          # climb / higher power
    else:
        return 0.0011          # cruise

def ambient_temperature(t, altitude_m=4500):
    """Ambient air temp (K) - drops with altitude (standard lapse rate ~6.5 K/km)."""
    T_sea_level = 288.15  # K (15 C)
    lapse_rate = 0.0065   # K/m
    return T_sea_level - lapse_rate * altitude_m

# -------------------------------------------------------------------
# STEP 3: The energy balance ODE
#   m_c * c_p * dT/dt = Q_in (combustion) - Q_out (convection + radiation)
# -------------------------------------------------------------------
def engine_thermal_ode(t, T, params):
    T_engine = T[0]
    T_ambient = ambient_temperature(t)

    # Heat generated from combustion that ends up heating the engine block
    m_fuel = fuel_flow_rate(t)
    Q_in = params["eta_thermal"] * m_fuel * params["LHV"]  # Watts

    # Heat lost via convection (airflow over engine)
    Q_conv = params["h_conv"] * params["A_surface"] * (T_engine - T_ambient)

    # Heat lost via radiation
    Q_rad = params["emissivity"] * params["sigma"] * params["A_surface"] * (T_engine**4 - T_ambient**4)

    dTdt = (Q_in - Q_conv - Q_rad) / (params["m_c"] * params["c_p"])
    return [dTdt]

# -------------------------------------------------------------------
# STEP 4: Solve the ODE over a simulated flight/mission duration
# -------------------------------------------------------------------
T_initial = [288.15]  # engine starts at ambient temp (K)
t_span = (0, 600)     # simulate 600 seconds (10 minutes) of a mission
t_eval = np.linspace(*t_span, 300)

solution = solve_ivp(
    engine_thermal_ode, t_span, T_initial,
    args=(params,), t_eval=t_eval, method='RK45'
)

T_predicted_C = solution.y[0] - 273.15  # convert Kelvin to Celsius for readability

# -------------------------------------------------------------------
# STEP 5: Plot the physics-model baseline
# -------------------------------------------------------------------
plt.figure(figsize=(9, 4))
plt.plot(solution.t, T_predicted_C, label="Physics model: expected CHT")
plt.xlabel("Time (s)")
plt.ylabel("Cylinder Head Temperature (°C)")
plt.title("Physics-Based Baseline Engine Temperature")
plt.legend()
plt.grid(alpha=0.3)
plt.savefig("physics_model_baseline.png", dpi=150, bbox_inches="tight")
plt.show()

print("Physics model predicted final CHT:", round(T_predicted_C[-1], 1), "°C")
print("\nNext step: compare this curve against REAL/simulated sensor CHT data.")
print("Large gaps between the two = residual = feed this into the AI anomaly model.")
