"""Fault injection: adds a growing drift to the channels of a chosen failure mode."""
import numpy as np
from .spacecraft_channels import SPACECRAFT_CHANNELS

# channel name -> direction of drift (+1 up, -1 down)
FAULTS = {
    "battery_degradation": {"label": "Battery degradation",
        "channels": {"Battery Bus Voltage": -1, "Battery State of Charge": -1, "Battery Temperature": 1}},
    "propellant_leak": {"label": "Propellant leak",
        "channels": {"Propellant Tank Pressure": -1, "Propellant Level": -1, "Thruster Valve Current": 1}},
    "thermal_runaway": {"label": "Thermal runaway",
        "channels": {"Battery Temperature": 1, "Avionics Temperature": 1, "Radiator Panel Temperature": 1}},
    "wheel_failure": {"label": "Reaction wheel failure",
        "channels": {"Reaction Wheel Current": 1, "Reaction Wheel Speed": -1}},
    "comms_degradation": {"label": "Transmitter degradation",
        "channels": {"Radio Signal-to-Noise": -1, "Transmitter Power": -1}},
}

_IDX = {c[0]: i for i, c in enumerate(SPACECRAFT_CHANNELS)}


def inject(data, fault, start, severity, mitigate=0.0, mitigate_at=None):
    """
    Drift grows ~linearly from `start` (reaches `severity` after ~100 cycles).
    Mitigation (0..1) slows the growth from `mitigate_at` onward (what-if).
    """
    data = np.array(data, dtype=float, copy=True)
    spec = FAULTS.get(fault)
    if not spec:
        return data
    n = data.shape[0]
    rate = np.zeros(n)
    rate[start:] = 1.0
    if mitigate_at is not None and mitigate > 0:
        rate[mitigate_at:] *= (1.0 - mitigate)
    ramp = np.cumsum(rate) / 100.0
    for name, sign in spec["channels"].items():
        i = _IDX.get(name)
        if i is not None and i < data.shape[1]:
            data[:, i] += sign * severity * ramp
    return data