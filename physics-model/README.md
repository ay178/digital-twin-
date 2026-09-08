# Physics-Based Baseline Model

Standalone script (not yet wired into the backend). Run it directly:

```bash
pip install numpy scipy matplotlib
python physics_engine_thermal_model.py
```

It solves a lumped-parameter energy balance equation to predict expected
cylinder head temperature over a mission, given RPM/fuel-flow/altitude
inputs. See the comments at the top of the file for how this is meant to
feed into the AI/ML anomaly model as a "residual" feature (see the main
project README, section 6).
