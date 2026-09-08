import { useEffect, useMemo, useRef, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { fetchHealth, fetchSimulation } from './api'

const STATUS_META = {
  normal: { label: 'Normal', color: 'var(--status-normal)' },
  watch: { label: 'Watch', color: 'var(--status-watch)' },
  critical: { label: 'Critical', color: 'var(--status-critical)' },
}

// The trained models were built on the NASA CMAPSS dataset (turbofan proxy data,
// since no public UAV piston-engine dataset exists), whose channels are named
// generically (sensor_2, setting_1, etc). These labels map each channel to a
// representative piston-engine parameter from the problem statement, purely so
// the dashboard reads meaningfully -- the underlying trained numbers are unchanged.
const FRIENDLY_NAMES = {
  sensor_2: 'Cylinder Head Temp (CHT)',
  sensor_3: 'Exhaust Gas Temp (EGT)',
  sensor_4: 'Oil Pressure',
  sensor_7: 'Oil Temperature',
  sensor_8: 'Fuel Flow Rate',
  sensor_9: 'Engine RPM',
  sensor_11: 'Vibration Amplitude',
  sensor_12: 'Battery / Alternator Voltage',
  sensor_13: 'Injection Timing',
  sensor_14: 'Coolant Temperature',
  sensor_15: 'Manifold Pressure',
  sensor_17: 'Turbo Boost Pressure',
  sensor_20: 'Throttle Position',
  sensor_21: 'Ambient Air Temperature',
  setting_1: 'Altitude',
  setting_2: 'Airspeed',
  setting_3: 'Ambient Pressure',
}
const friendlyName = (raw) => FRIENDLY_NAMES[raw] || raw

const FLEET = [
  { id: 1, name: 'TAPAS-BH201 · Engine A', seed: 11 },
  { id: 2, name: 'TAPAS-BH201 · Engine B', seed: 27 },
  { id: 3, name: 'Archer-NG · Engine A', seed: 38 },
  { id: 4, name: 'Archer-NG · Engine B', seed: 53 },
]

export default function App() {
  const [health, setHealth] = useState(null)
  const [cycles, setCycles] = useState(200)
  const [seed, setSeed] = useState(42)
  const [sim, setSim] = useState(null)
  const [currentCycle, setCurrentCycle] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [savedRuns, setSavedRuns] = useState([])
  const [compareIds, setCompareIds] = useState([])
  const [view, setView] = useState('single')
  const [alerts, setAlerts] = useState([])
  const [fleetData, setFleetData] = useState(null)
  const [fleetLoading, setFleetLoading] = useState(false)
  const playRef = useRef(null)
  const runCounter = useRef(0)
  const prevStatusRef = useRef(null)

  useEffect(() => {
    fetchHealth().then(setHealth).catch(() => setHealth(null))
  }, [])

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchSimulation(cycles, seed)
      .then((data) => {
        setSim(data)
        setCurrentCycle(cycles - 1)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [cycles, seed])

  useEffect(() => {
    if (!playing || !sim) return
    const start = sim.meta.first_valid_cycle
    setCurrentCycle(start)
    playRef.current = setInterval(() => {
      setCurrentCycle((c) => {
        if (c >= cycles - 1) {
          clearInterval(playRef.current)
          setPlaying(false)
          return c
        }
        return c + 1
      })
    }, 60)
    return () => clearInterval(playRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  const chartData = useMemo(() => {
    if (!sim || currentCycle === null) return []
    const first = sim.meta.first_valid_cycle
    const rows = []
    for (let c = first; c <= currentCycle; c++) {
      rows.push({
        cycle: c,
        predictedRul: sim.predicted_rul[c - first],
        trueRul: sim.true_rul[c],
        anomalyScore: sim.anomaly_scores[c],
      })
    }
    return rows
  }, [sim, currentCycle])

  const sensorSeriesData = useMemo(() => {
    if (!sim || currentCycle === null) return []
    const rows = []
    for (let c = 0; c <= currentCycle; c++) {
      const row = { cycle: c }
      sim.meta.feature_names.forEach((name, i) => {
        row[name] = sim.sensor_data[c][i]
      })
      rows.push(row)
    }
    return rows
  }, [sim, currentCycle])

  const topContributors = useMemo(() => {
    if (!sim || currentCycle === null) return []
    const errors = sim.feature_errors[currentCycle]
    const total = errors.reduce((a, b) => a + b, 0) || 1
    return sim.meta.feature_names
      .map((name, i) => ({ name, error: errors[i], pct: (errors[i] / total) * 100 }))
      .sort((a, b) => b.error - a.error)
      .slice(0, 5)
  }, [sim, currentCycle])

  const plainSummary = useMemo(() => {
    if (!sim || currentCycle === null || topContributors.length === 0) return ''
    const first = sim.meta.first_valid_cycle
    const idx = currentCycle - first
    const rul = sim.predicted_rul[idx]
    const stat = sim.status_per_cycle[idx]
    const top = topContributors[0]

    if (stat === 'critical') {
      return `Critical: at cycle ${currentCycle}, the engine's sensor readings have moved well outside what a healthy engine looks like. ` +
        `This is mainly driven by ${friendlyName(top.name)}, which accounts for about ${top.pct.toFixed(0)}% of the unusual reading. ` +
        `Estimated remaining useful life has fallen to about ${rul.toFixed(0)} cycles. ` +
        `Recommended action: ground the engine for inspection before continuing the mission.`
    }
    if (stat === 'watch') {
      return `Watch: at cycle ${currentCycle}, estimated remaining useful life is about ${rul.toFixed(0)} cycles, ` +
        `which is below the safe planning margin. Sensor readings are still within the normal range, ` +
        `with ${friendlyName(top.name)} showing the largest (though not alarming) deviation. ` +
        `Recommended action: plan maintenance in the near term rather than waiting for a hard failure.`
    }
    return `Normal: at cycle ${currentCycle}, the engine is behaving as expected for a healthy unit. ` +
      `Estimated remaining useful life is about ${rul.toFixed(0)} cycles, and no sensor is showing unusual deviation ` +
      `(largest contributor is ${friendlyName(top.name)} at ${top.pct.toFixed(0)}% of a very small overall error). ` +
      `Recommended action: continue normal operation, no intervention needed.`
  }, [sim, currentCycle, topContributors])

  const handleSaveRun = () => {
    if (!sim) return
    runCounter.current += 1
    const worstStatus = sim.status_per_cycle.includes('critical')
      ? 'critical'
      : sim.status_per_cycle.includes('watch') ? 'watch' : 'normal'
    const finalRul = sim.predicted_rul[sim.predicted_rul.length - 1]
    setSavedRuns((runs) => [
      ...runs,
      {
        id: runCounter.current,
        label: `Run ${runCounter.current} (seed ${seed}, ${cycles}c)`,
        sim,
        finalRul,
        worstStatus,
      },
    ])
  }

  const toggleCompare = (id) => {
    setCompareIds((ids) => {
      if (ids.includes(id)) return ids.filter((x) => x !== id)
      if (ids.length >= 2) return [ids[1], id]
      return [...ids, id]
    })
  }

  const loadRun = (run) => {
    setPlaying(false)
    setCycles(run.sim.meta.cycles)
    setSeed(run.sim.meta.seed)
    setSim(run.sim)
    setCurrentCycle(run.sim.meta.cycles - 1)
  }

  const compareRuns = compareIds
    .map((id) => savedRuns.find((r) => r.id === id))
    .filter(Boolean)

  const compareChartData = useMemo(() => {
    if (compareRuns.length !== 2) return []
    const [a, b] = compareRuns
    const maxCycles = Math.max(a.sim.meta.cycles, b.sim.meta.cycles)
    const rows = []
    for (let c = 0; c < maxCycles; c++) {
      const row = { cycle: c }
      const aIdx = c - a.sim.meta.first_valid_cycle
      const bIdx = c - b.sim.meta.first_valid_cycle
      if (aIdx >= 0 && aIdx < a.sim.predicted_rul.length) row[a.label] = a.sim.predicted_rul[aIdx]
      if (bIdx >= 0 && bIdx < b.sim.predicted_rul.length) row[b.label] = b.sim.predicted_rul[bIdx]
      if (c < a.sim.anomaly_scores.length) row[`${a.label} (anomaly)`] = a.sim.anomaly_scores[c]
      if (c < b.sim.anomaly_scores.length) row[`${b.label} (anomaly)`] = b.sim.anomaly_scores[c]
      rows.push(row)
    }
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareIds, savedRuns])

  const currentStatus = useMemo(() => {
    if (!sim || currentCycle === null) return null
    const idx = currentCycle - sim.meta.first_valid_cycle
    return sim.status_per_cycle[idx]
  }, [sim, currentCycle])

  const riskScore = useMemo(() => {
    if (!sim || currentCycle === null) return 0
    const idx = currentCycle - sim.meta.first_valid_cycle
    const rul = sim.predicted_rul[idx]
    const anomaly = sim.anomaly_scores[currentCycle]
    const threshold = sim.meta.anomaly_threshold
    const rulCap = sim.meta.rul_cap
    const base = 100 * (1 - Math.min(Math.max(rul, 0), rulCap) / rulCap)
    const anomalyBoost = anomaly > threshold ? Math.min(40, (anomaly / threshold) * 10) : 0
    return Math.min(100, Math.max(0, base + anomalyBoost))
  }, [sim, currentCycle])

  const needlePos = useMemo(() => {
    const angleDeg = 180 - (riskScore / 100) * 180
    const angleRad = (angleDeg * Math.PI) / 180
    return { x: 100 + 65 * Math.cos(angleRad), y: 100 - 65 * Math.sin(angleRad) }
  }, [riskScore])

  const riskLabel = riskScore < 40 ? 'Low' : riskScore < 70 ? 'Moderate' : 'High'

  const missionImpact = useMemo(() => {
    if (!sim) return null
    const first = sim.meta.first_valid_cycle
    const warnIdx = sim.status_per_cycle.findIndex((s) => s !== 'normal')
    if (warnIdx === -1) return { warned: false }
    const warningCycle = first + warnIdx
    const leadCycles = (sim.meta.cycles - 1) - warningCycle
    return { warned: true, warningCycle, leadCycles }
  }, [sim])

  // Reset the alert log whenever a different mission is loaded (new fetch or replay).
  useEffect(() => {
    setAlerts([])
    prevStatusRef.current = null
  }, [sim])

  // Log a new alert whenever status worsens to watch/critical for the first time at this cycle.
  useEffect(() => {
    if (currentStatus === null) return
    if (currentStatus !== 'normal' && currentStatus !== prevStatusRef.current) {
      setAlerts((prev) => [
        { id: `${Date.now()}-${Math.random()}`, cycle: currentCycle, status: currentStatus, time: new Date().toLocaleTimeString() },
        ...prev,
      ].slice(0, 20))
    }
    prevStatusRef.current = currentStatus
  }, [currentStatus, currentCycle])

  useEffect(() => {
    if (view !== 'fleet' || fleetData) return
    setFleetLoading(true)
    Promise.all(FLEET.map((e) => fetchSimulation(200, e.seed)))
      .then((results) => setFleetData(results))
      .catch(() => setFleetData(null))
      .finally(() => setFleetLoading(false))
  }, [view, fleetData])

  const viewEngineInDetail = (fleetSeed) => {
    setSeed(fleetSeed)
    setCycles(200)
    setView('single')
  }

  if (loading && !sim) {
    return <div className="shell"><div className="loading">Loading digital twin...</div></div>
  }
  if (error) {
    return <div className="shell"><div className="loading error">Could not reach backend: {error}</div></div>
  }
  if (!sim || currentCycle === null) return null

  const first = sim.meta.first_valid_cycle
  const idx = currentCycle - first
  const predictedRul = sim.predicted_rul[idx]
  const anomalyScore = sim.anomaly_scores[currentCycle]
  const status = sim.status_per_cycle[idx]
  const statusMeta = STATUS_META[status]

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">Digital twin / piston engine</div>
          <h1>TAPAS-class engine health monitor</h1>
        </div>
        <div className="header-right">
          <div className="view-tabs">
            <button className={view === 'single' ? 'tab active' : 'tab'} onClick={() => setView('single')}>
              Single engine
            </button>
            <button className={view === 'fleet' ? 'tab active' : 'tab'} onClick={() => setView('fleet')}>
              Fleet overview
            </button>
          </div>
          <div className="model-badge" data-real={health?.using_real_models ? 'true' : 'false'}>
            {health?.using_real_models ? 'Trained models loaded' : 'Placeholder models (no trained files yet)'}
          </div>
        </div>
      </header>

      {currentStatus && currentStatus !== 'normal' && view === 'single' && (
        <div className={`alert-banner alert-${currentStatus}`}>
          {currentStatus === 'critical'
            ? `Critical — anomaly threshold exceeded at cycle ${currentCycle}.`
            : `Watch — predicted RUL is below 30 cycles at cycle ${currentCycle}.`}
        </div>
      )}

      {view === 'fleet' ? (
        <section className="fleet-section">
          <h2 className="section-title">Fleet overview</h2>
          <p className="section-hint">
            Simulated status snapshot (200-cycle mission) across a small fleet of engines. Click any card to open its full dashboard.
          </p>
          {fleetLoading && <p className="section-hint">Loading fleet status...</p>}
          {fleetData && (
            <div className="fleet-grid">
              {FLEET.map((engine, i) => {
                const result = fleetData[i]
                const lastIdx = result.predicted_rul.length - 1
                const finalRul = result.predicted_rul[lastIdx]
                const finalStatus = result.status_per_cycle[lastIdx]
                const meta = STATUS_META[finalStatus]
                return (
                  <div
                    key={engine.id}
                    className="fleet-card"
                    style={{ '--pill-color': meta.color }}
                    onClick={() => viewEngineInDetail(engine.seed)}
                  >
                    <div className="fleet-card-name">{engine.name}</div>
                    <div className="fleet-card-status" style={{ color: meta.color }}>{meta.label}</div>
                    <div className="fleet-card-rul mono">RUL {finalRul.toFixed(1)} cycles</div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      ) : (
      <>
      <section className="risk-section">
        <div className="gauge-card">
          <svg viewBox="0 0 200 120" className="risk-gauge">
            <path d="M20,100 A80,80 0 0,1 60,30.72" className="gauge-arc gauge-green" />
            <path d="M60,30.72 A80,80 0 0,1 140,30.72" className="gauge-arc gauge-amber" />
            <path d="M140,30.72 A80,80 0 0,1 180,100" className="gauge-arc gauge-red" />
            <line x1="100" y1="100" x2={needlePos.x} y2={needlePos.y} className="gauge-needle" />
            <circle cx="100" cy="100" r="5" className="gauge-pivot" />
          </svg>
          <div className="gauge-readout">
            <div className="gauge-label">{riskLabel} risk</div>
            <div className="gauge-score mono">{riskScore.toFixed(0)} / 100</div>
          </div>
        </div>
        <div className="impact-card">
          <h3 className="impact-title">Early-warning impact</h3>
          {missionImpact?.warned ? (
            <p className="impact-text">
              This system flagged early signs of degradation at cycle <strong className="mono">{missionImpact.warningCycle}</strong> —{' '}
              <strong className="mono">{missionImpact.leadCycles} cycles</strong> of advance notice before the end of this mission.
              In a real deployment, that lead time is what turns an in-flight failure or aborted mission into a scheduled maintenance visit.
            </p>
          ) : (
            <p className="impact-text">
              No early-warning signs were raised across this simulated mission — the engine operated within healthy limits throughout.
            </p>
          )}
        </div>
      </section>

      <section className="controls">
        <label>
          Mission length
          <input
            type="range" min={60} max={300} step={10} value={cycles}
            onChange={(e) => setCycles(Number(e.target.value))}
          />
          <span className="mono">{cycles} cycles</span>
        </label>
        <label>
          Seed
          <input
            type="number" value={seed}
            onChange={(e) => setSeed(Number(e.target.value))}
          />
        </label>
        <button className="play-btn" onClick={() => setPlaying((p) => !p)}>
          {playing ? 'Pause' : 'Play mission'}
        </button>
        <button className="save-btn" onClick={handleSaveRun}>
          Save this run
        </button>
        <label className="scrub">
          Cycle
          <input
            type="range" min={first} max={cycles - 1} value={currentCycle}
            onChange={(e) => { setPlaying(false); setCurrentCycle(Number(e.target.value)) }}
          />
          <span className="mono">{currentCycle}</span>
        </label>
      </section>

      <section className="hero">
        <div className="hero-metric">
          <div className="hero-label">Predicted RUL</div>
          <div className="hero-value mono">{predictedRul.toFixed(1)}<span className="unit">cycles</span></div>
        </div>
        <div className="hero-metric">
          <div className="hero-label">Anomaly score</div>
          <div className="hero-value mono">{anomalyScore.toFixed(5)}</div>
          <div className="hero-sub mono">threshold {sim.meta.anomaly_threshold.toFixed(5)}</div>
        </div>
        <div className="status-pill" style={{ '--pill-color': statusMeta.color }}>
          {statusMeta.label}
        </div>
      </section>

      <section className="summary-section">
        <h2 className="section-title">What's happening — in plain language</h2>
        <p className="summary-text">{plainSummary}</p>
      </section>

      {alerts.length > 0 && (
        <section className="alert-log">
          <h2 className="section-title">Alert log</h2>
          <div className="alert-log-list">
            {alerts.map((a) => (
              <div key={a.id} className={`alert-log-row alert-${a.status}`}>
                <span className="alert-dot" />
                <span>Cycle {a.cycle} — {STATUS_META[a.status].label}</span>
                <span className="alert-time mono">{a.time}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="explain-section">
        <h2 className="section-title">Why this status — top contributing sensors</h2>
        <p className="section-hint">
          Each sensor's share of the autoencoder's total reconstruction error at the current cycle
          — the higher the share, the more that sensor's reading deviates from what a healthy engine looks like.
        </p>
        <div className="contrib-list">
          {topContributors.map((c) => (
            <div key={c.name} className="contrib-row">
              <div className="contrib-row-top">
                <span className="contrib-name">
                  {friendlyName(c.name)}
                  <span className="contrib-raw"> ({c.name})</span>
                </span>
                <span className="contrib-pct mono">{c.pct.toFixed(1)}%</span>
              </div>
              <div className="contrib-bar-track">
                <div
                  className="contrib-bar-fill"
                  style={{
                    width: `${Math.min(c.pct, 100)}%`,
                    background: status === 'normal' ? 'var(--accent-cyan)' : 'var(--status-watch)',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="charts">
        <div className="chart-panel">
          <h2>RUL prediction over time</h2>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="cycle" stroke="var(--text-secondary)" fontSize={12} />
              <YAxis stroke="var(--text-secondary)" fontSize={12} />
              <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)' }} />
              <Line type="monotone" dataKey="predictedRul" stroke="var(--accent-cyan)" dot={false} strokeWidth={2} name="Predicted RUL" />
              <Line type="monotone" dataKey="trueRul" stroke="var(--text-secondary)" dot={false} strokeWidth={1.5} strokeDasharray="4 4" name="Simulated true RUL" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-panel">
          <h2>Anomaly score over time</h2>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="cycle" stroke="var(--text-secondary)" fontSize={12} />
              <YAxis stroke="var(--text-secondary)" fontSize={12} />
              <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)' }} />
              <ReferenceLine y={sim.meta.anomaly_threshold} stroke="var(--status-critical)" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="anomalyScore" stroke="var(--status-watch)" dot={false} strokeWidth={2} name="Reconstruction error" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="sensor-section">
        <h2 className="section-title">Individual sensor telemetry</h2>
        <p className="section-hint">
          Values are normalized (0–1 scale) sensor readings from the training pipeline. Channel names are mapped to
          representative piston-engine parameters for readability — amber-highlighted ones are drifting as this
          simulated engine approaches end-of-life.
        </p>
        <div className="sensor-grid">
          {sim.meta.feature_names.map((name, i) => {
            const isSensitive = sim.meta.sensitive_sensor_indices.includes(i)
            const currentValue = sim.sensor_data[currentCycle][i]
            return (
              <div key={name} className={`sensor-card${isSensitive ? ' sensitive' : ''}`}>
                <div className="sensor-card-head">
                  <span className="sensor-name">{friendlyName(name)}</span>
                  <span className="sensor-value mono">{currentValue.toFixed(3)}</span>
                </div>
                <div className="sensor-raw">{name}</div>
                <ResponsiveContainer width="100%" height={70}>
                  <LineChart data={sensorSeriesData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                    <Line
                      type="monotone" dataKey={name} dot={false} strokeWidth={1.5}
                      isAnimationActive={false}
                      stroke={isSensitive ? 'var(--status-watch)' : 'var(--accent-cyan)'}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )
          })}
        </div>
      </section>

      <section className="history-section">
        <div className="history-header">
          <h2 className="section-title">Mission history — replay &amp; compare</h2>
          <span className="section-hint">Save a mission, then replay it or pick two to compare.</span>
        </div>

        {savedRuns.length === 0 ? (
          <p className="section-hint">No saved runs yet. Click "Save this run" above to add the current mission here.</p>
        ) : (
          <div className="history-list">
            {savedRuns.map((run) => (
              <div key={run.id} className={`history-row${compareIds.includes(run.id) ? ' selected' : ''}`}>
                <span className="history-label">{run.label}</span>
                <span className="history-stat mono">final RUL {run.finalRul.toFixed(1)}</span>
                <span className={`history-status status-${run.worstStatus}`}>{run.worstStatus}</span>
                <button className="mini-btn" onClick={() => loadRun(run)}>Replay</button>
                <label className="compare-check">
                  <input
                    type="checkbox"
                    checked={compareIds.includes(run.id)}
                    onChange={() => toggleCompare(run.id)}
                  />
                  Compare
                </label>
              </div>
            ))}
          </div>
        )}

        {compareRuns.length === 2 && (
          <div className="compare-charts">
            <div className="chart-panel">
              <h2>Comparison — predicted RUL</h2>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={compareChartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="cycle" stroke="var(--text-secondary)" fontSize={12} />
                  <YAxis stroke="var(--text-secondary)" fontSize={12} />
                  <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)' }} />
                  <Line type="monotone" dataKey={compareRuns[0].label} stroke="var(--accent-cyan)" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey={compareRuns[1].label} stroke="var(--status-watch)" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-panel">
              <h2>Comparison — anomaly score</h2>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={compareChartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="cycle" stroke="var(--text-secondary)" fontSize={12} />
                  <YAxis stroke="var(--text-secondary)" fontSize={12} />
                  <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)' }} />
                  <ReferenceLine y={sim.meta.anomaly_threshold} stroke="var(--status-critical)" strokeDasharray="4 4" />
                  <Line type="monotone" dataKey={`${compareRuns[0].label} (anomaly)`} stroke="var(--accent-cyan)" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey={`${compareRuns[1].label} (anomaly)`} stroke="var(--status-watch)" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </section>
      </>
      )}

      <footer className="footnote">
        Simulated mission data stands in for live CAN bus telemetry. The RUL and anomaly-detection
        models are the trained artifacts from the Colab pipeline (or placeholders if not yet added).
      </footer>
    </div>
  )
}