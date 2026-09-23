// Shows the explainable recommendations returned by /api/simulate
// Props:
//   explanations: array from API `explanations`
//   currentCycle: (optional) only show diagnoses up to this cycle (works with the scrubber)
export default function RecommendationPanel({ explanations = [], currentCycle = Infinity }) {
  const visible = explanations.filter((e) => e.cycle <= currentCycle);

  return (
    <section className="explain-section">
      <h2 className="section-title">AI Diagnosis &amp; Recommendations</h2>
      <p className="section-hint">
        Which subsystem is deviating, why, and what to do before it fails.
      </p>

      {visible.length === 0 ? (
        <div className="summary-text mono">All subsystems nominal. No action required.</div>
      ) : (
        <div className="history-list">
          {[...visible].reverse().map((e, i) => {
            const cls = e.severity === "CRITICAL" ? "status-critical" : "status-watch";
            return (
              <div key={i} className="rec-card" data-sev={e.severity}>
                <div className="rec-head">
                  <span className={`history-status ${cls}`}>{e.severity}</span>
                  <strong>{e.subsystem}</strong>
                  <span className="mono rec-cycle">cycle {e.cycle}</span>
                  <span className="mono rec-eta">
                    ~{Math.round(e.estimated_cycles_to_failure)} cycles left
                  </span>
                </div>

                <p className="rec-line"><b>Likely cause:</b> {e.likely_cause}</p>
                <p className="rec-line"><b>Recommended action:</b> {e.recommended_action}</p>

                <div className="contrib-list rec-evidence">
                  {e.evidence.map((ev, j) => (
                    <div className="contrib-row" key={j}>
                      <div className="contrib-row-top">
                        <span className="contrib-name">{ev.channel}</span>
                        <span className="contrib-pct mono">{ev.contribution_pct}%</span>
                      </div>
                      <div className="contrib-bar-track">
                        <div
                          className="contrib-bar-fill"
                          style={{
                            width: `${Math.min(ev.contribution_pct, 100)}%`,
                            background: "var(--accent-cyan)",
                            color: "var(--accent-cyan)",
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}