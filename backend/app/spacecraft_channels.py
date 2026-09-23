"""
Maps the model's feature columns (by index) to spacecraft telemetry channels.

The trained models don't care what the columns are *called*, only that the
order stays the same. So we relabel column i -> a spacecraft channel.
Edit the order/names here to change how the dashboard presents the data.
"""

# (channel name, subsystem, unit)
SPACECRAFT_CHANNELS = [
    ("Battery Bus Voltage",        "Power (EPS)",       "V"),
    ("Battery State of Charge",    "Power (EPS)",       "%"),
    ("Solar Array Current",        "Power (EPS)",       "A"),
    ("Battery Temperature",        "Thermal",           "C"),
    ("Avionics Temperature",       "Thermal",           "C"),
    ("Radiator Panel Temperature", "Thermal",           "C"),
    ("Propellant Tank Pressure",   "Propulsion",        "kPa"),
    ("Propellant Level",           "Propulsion",        "%"),
    ("Thruster Valve Current",     "Propulsion",        "A"),
    ("Reaction Wheel Speed",       "Attitude (ADCS)",   "rpm"),
    ("Reaction Wheel Current",     "Attitude (ADCS)",   "A"),
    ("Radio Signal-to-Noise",      "Communications",    "dB"),
    ("Transmitter Power",          "Communications",    "W"),
    ("Onboard Computer Load",      "Command & Data",    "%"),
]

# Likely cause + recommended action per subsystem
SUBSYSTEM_KB = {
    "Power (EPS)": {
        "cause": "battery cell degradation or solar array output loss",
        "action": "shed non-essential loads, switch to safe power mode, re-point arrays toward the sun",
    },
    "Thermal": {
        "cause": "radiator/heater malfunction or excess internal heat dissipation",
        "action": "reduce payload duty cycle, adjust attitude to change sun exposure, enable backup heater/cooling loop",
    },
    "Propulsion": {
        "cause": "propellant leak, pressurant loss or valve wear",
        "action": "isolate the affected line, postpone burns, re-plan the manoeuvre budget with remaining propellant",
    },
    "Attitude (ADCS)": {
        "cause": "reaction wheel bearing friction or motor wear",
        "action": "lower wheel speed, plan momentum dumping, switch to a backup wheel or thruster control",
    },
    "Communications": {
        "cause": "transmitter degradation or antenna pointing error",
        "action": "verify antenna pointing, switch to the redundant transmitter, lower the data rate",
    },
    "Command & Data": {
        "cause": "processor overload or memory fault",
        "action": "reboot to safe mode, offload tasks, check for a software fault",
    },
}


def channel_names(n_features: int):
    """Return spacecraft channel names for n_features columns (with fallback)."""
    names = []
    for i in range(n_features):
        if i < len(SPACECRAFT_CHANNELS):
            names.append(SPACECRAFT_CHANNELS[i][0])
        else:
            names.append(f"Auxiliary Channel {i + 1}")
    return names


def channel_info(i: int):
    if i < len(SPACECRAFT_CHANNELS):
        return SPACECRAFT_CHANNELS[i]
    return (f"Auxiliary Channel {i + 1}", "Command & Data", "")
