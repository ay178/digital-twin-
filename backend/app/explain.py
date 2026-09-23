"""
Explainable recommendations.

For a given cycle we look at which telemetry channels contribute most to the
autoencoder's reconstruction error, group them by subsystem, and turn that
into a human-readable diagnosis with a recommended action and time-to-failure.
"""

from collections import defaultdict

import numpy as np

from .spacecraft_channels import SUBSYSTEM_KB, channel_info


def explain_cycle(cycle, status, feature_err_row, predicted_rul, top_k=3):
    """Build one explanation dict for a single cycle."""
    feature_err_row = np.asarray(feature_err_row, dtype=float)
    total = float(feature_err_row.sum()) or 1.0

    top_idx = np.argsort(feature_err_row)[::-1][:top_k]

    # Contribution per subsystem, so the diagnosis names the *subsystem*
    per_subsystem = defaultdict(float)
    evidence = []
    for i in top_idx:
        name, subsystem, unit = channel_info(int(i))
        share = float(feature_err_row[i] / total)
        per_subsystem[subsystem] += share
        evidence.append({
            "channel": name,
            "subsystem": subsystem,
            "contribution_pct": round(share * 100, 1),
        })

    primary = max(per_subsystem, key=per_subsystem.get)
    kb = SUBSYSTEM_KB[primary]
    channels_txt = ", ".join(e["channel"] for e in evidence)

    if status == "critical":
        severity = "CRITICAL"
        headline = f"Abnormal behaviour detected in {primary}"
    else:
        severity = "WARNING"
        headline = f"Early degradation signs in {primary}"

    rul = max(float(predicted_rul), 0.0)
    summary = (
        f"{headline}. Most deviating channels: {channels_txt}. "
        f"Likely cause: {kb['cause']}. "
        f"Estimated {rul:.0f} cycles before this subsystem needs intervention. "
        f"Recommended action: {kb['action']}."
    )

    return {
        "cycle": int(cycle),
        "severity": severity,
        "subsystem": primary,
        "evidence": evidence,
        "likely_cause": kb["cause"],
        "recommended_action": kb["action"],
        "estimated_cycles_to_failure": round(rul, 1),
        "summary": summary,
    }


def build_explanations(first_valid_cycle, status_per_cycle, predicted_rul,
                       feature_errors, max_items=8):
    """
    Explain only the interesting moments so the payload stays small:
    every status change (normal->watch, watch->critical, ...) plus the
    latest non-normal cycle.
    """
    feature_errors = np.asarray(feature_errors)
    n_rows = feature_errors.shape[0]
    n_cycles = first_valid_cycle + len(status_per_cycle)

    def row_for(i, cyc):
        # feature_errors may be per-window or per-cycle; handle both
        return feature_errors[cyc] if n_rows == n_cycles else feature_errors[i]

    out = []
    prev = "normal"
    last_bad = None
    for i, status in enumerate(status_per_cycle):
        cyc = first_valid_cycle + i
        if status != "normal":
            last_bad = (i, cyc, status)
        if status != prev and status != "normal":
            out.append(explain_cycle(cyc, status, row_for(i, cyc), predicted_rul[i]))
        prev = status

    if last_bad and (not out or out[-1]["cycle"] != last_bad[1]):
        i, cyc, status = last_bad
        out.append(explain_cycle(cyc, status, row_for(i, cyc), predicted_rul[i]))

    return out[-max_items:]