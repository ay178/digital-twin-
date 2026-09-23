import { useEffect, useMemo, useRef, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { fetchHealth, fetchSimulation } from './api'
import { fetchSim, fetchFaults } from './faultApi'
import AgentChat from './components/AgentChat'
import SpacecraftVisual3D from './SpacecraftVisual3D'
import WarRoomBackground from './WarRoomBackground'
import RecommendationPanel from './components/RecommendationPanel'
import PhysicsChart from './components/PhysicsChart'
import './recommendation.css'

const STATUS_META = {
  normal: { label: 'Nominal', color: 'var(--status-normal)' },
  watch: { label: 'Watch', color: 'var(--status-watch)' },
  critical: { label: 'Critical', color: 'var(--status-critical)' },
}

const FLEET = [
  { id: 1, name: 'SAT-01 · Earth Observation', seed: 11 },
  { id: 2, name: 'SAT-02 · Communications', seed: 27 },
  { id: 3, name: 'SAT-03 · Navigation', seed: 38 },
  { id: 4, name: 'SAT-04 · Science', seed: 53 },
]

const tip = { background: 'var(--panel-solid)', border: '1px solid var(--border)' }

export default function App() {
  const [health, setHealth] = useState(null)
  const [cycles, setCycles] = useState(200)
  const [seed, setSeed] = useState(42)
  const [sim, setSim] = useState(null)
  const [currentCycle, setCurrentCycle] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [view, setView] = useState('single')
  const [alerts, setAlerts] = useState([])
  const [fleetData, setFleetData] = useState(null)
  const [fleetLoading, setFleetLoading] = useState(false)
  const [faults, setFaults] = useState([])
  const [fault, setFault] = useState('')
  const [severity, setSeverity] = useState(0.6)
  const [faultStart, setFaultStart] = useState(60)
  const [mitigate, setMitigate] = useState(0.5)
  const [whatIf, setWhatIf] = useState(null)
  const playRef = useRef(null)
  const prevStatusRef = useRef(null)

  useEffect(() => { fetchHealth().then(setHealth).catch(() => setHealth(null)) }, [])
  useEffect(() => { fetchFaults().then(setFaults).catch(() => setFaults([])) }, [])

  useEffect(() => {
    setLoading(true)
    setError(null)
    setWhatIf(null)
    fetchSim({ cycles, seed, fault, severity, faultStart })
      .then((d) => { setSim(d); setCurrentCycle(cycles - 1) })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [cycles, seed, fault, severity, faultStart])

  const runWhatIf = () =>
    fetchSim({ cycles, seed, fault, severity, faultStart, mitigate, mitigateAt: currentCycle })
      .then(setWhatIf).catch((e) => setError(e.message))

  useEffect(() => {
    if (!playing || !sim) return
    setCurrentCycle(sim.meta.first_valid_cycle)
    playRef.current = setInterval(() => {
      setCurrentCycle((c) => {
        if (c >= cycles - 1) { clearInterval(playRef.current); setPlaying(false); return c }
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
        rulLow: sim.rul_low?.[c - first],
        rulHigh: sim.rul_high?.[c - first],
        whatIfRul: whatIf ? whatIf.predicted_rul[c - first] : undefined,
      })
    }
    return rows
  }, [sim, currentCycle, whatIf])

  const sensorSeriesData = useMemo(() => {
    if (!sim || currentCycle === null) return []
    const rows = []
    for (let c = 0; c <= currentCycle; c++) {
      const row = { cycle: c }
      sim.meta.feature_names.forEach((n, i) => { row[n] = sim.sensor_data[c][i] })
      rows.push(row)
    }
    return rows
  }, [sim, currentCycle])

  // Share of total deviation per SUBSYSTEM at the current cycle
  const subsystemHealth = useMemo(() => {
    if (!sim || currentCycle === null) return []
    const errs = sim.feature_errors[currentCycle]
    const total = errs.reduce((a, b) => a + b, 0) || 1
    const acc = {}
    sim.meta.feature_subsystems.forEach((s, i) => { acc[s] = (acc[s] || 0) + errs[i] })
    return Object.entries(acc)
      .map(([name, e]) => ({ name, pct: (e / total) * 100 }))
      .sort((a, b) => b.pct - a.pct)
  }, [sim, currentCycle])

  const currentStatus = useMemo(() => {
    if (!sim || currentCycle === null) return null
    return sim.status_per_cycle[currentCycle - sim.meta.first_valid_cycle]
  }, [sim, currentCycle])

  const riskScore = useMemo(() => {
    if (!sim || currentCycle === null) return 0
    const idx = currentCycle - sim.meta.first_valid_cycle
    const rul = sim.predicted_rul[idx]
    const anomaly = sim.anomaly_scores[currentCycle]
    const { anomaly_threshold: th, rul_cap: cap } = sim.meta
    const base = 100 * (1 - Math.min(Math.max(rul, 0), cap) / cap)
    const boost = anomaly > th ? Math.min(40, (anomaly / th) * 10) : 0
    return Math.min(100, Math.max(0, base + boost))
  }, [sim, currentCycle])

  const needlePos = useMemo(() => {
    const a = ((180 - (riskScore / 100) * 180) * Math.PI) / 180
    return { x: 100 + 65 * Math.cos(a), y: 100 - 65 * Math.sin(a) }
  }, [riskScore])
  const riskLabel = riskScore < 40 ? 'Low' : riskScore < 70 ? 'Moderate' : 'High'

  const missionImpact = useMemo(() => {
    if (!sim) return null
    const i = sim.status_per_cycle.findIndex((s) => s !== 'normal')
    if (i === -1) return { warned: false }
    const warningCycle = sim.meta.first_valid_cycle + i
    return { warned: true, warningCycle, leadCycles: sim.meta.cycles - 1 - warningCycle }
  }, [sim])

  useEffect(() => { setAlerts([]); prevStatusRef.current = null }, [sim])
  useEffect(() => {
    if (currentStatus === null) return
    if (currentStatus !== 'normal' && currentStatus !== prevStatusRef.current) {
      setAlerts((p) => [
        { id: `${Date.now()}-${Math.random()}`, cycle: currentCycle, status: currentStatus, time: new Date().toLocaleTimeString() },
        ...p,
      ].slice(0, 20))
    }
    prevStatusRef.current = currentStatus
  }, [currentStatus, currentCycle])

  useEffect(() => {
    if (view !== 'fleet' || fleetData) return
    setFleetLoading(true)
    Promise.all(FLEET.map((e) => fetchSimulation(200, e.seed)))
      .then(setFleetData).catch(() => setFleetData(null)).finally(() => setFleetLoading(false))
  }, [view, fleetData])

  const openSat = (s) => { setSeed(s); setCycles(200); setView('single') }

  if (loading && !sim) {
    return (<><WarRoomBackground /><div className="shell"><div className="loading">Establishing link with spacecraft...</div></div></>)
  }
  if (error) {
    return (<><WarRoomBackground /><div className="shell"><div className="loading error">Link lost — backend unreachable: {error}</div></div></>)
  }
  if (!sim || currentCycle === null) return null

  const first = sim.meta.first_valid_cycle
  const idx = currentCycle - first
  const predictedRul = sim.predicted_rul[idx]
  const anomalyScore = sim.anomaly_scores[currentCycle]
  const status = sim.status_per_cycle[idx]
  const statusMeta = STATUS_META[status]
  const satId = `SAT-${String(seed).padStart(3, '0')}`
  const tIdx = sim.meta.thermal_channel_index

  return (
    <>
      <WarRoomBackground />
      <div className="shell">
        <header className="topbar hud-frame">
          <div>
            <div className="eyebrow">
              <span className="live-dot" style={{ '--pill-color': statusMeta.color }} />
              MISSION CONTROL · SPACECRAFT DIGITAL TWIN
            </div>
            <h1>Spacecraft health &amp; failure prediction</h1>
          </div>
          <div className="header-right">
            <div className="view-tabs">
              {[['single', 'Spacecraft'], ['drone', 'Live orbit'], ['fleet', 'Fleet overview']].map(([k, l]) => (
                <button key={k} className={view === k ? 'tab active' : 'tab'} onClick={() => setView(k)}>{l}</button>
              ))}
            </div>
            <div className="model-badge" data-real={health?.using_real_models ? 'true' : 'false'}>
              {health?.using_real_models ? 'Trained models loaded' : 'Placeholder models'}
            </div>
          </div>
        </header>

        {status !== 'normal' && view === 'single' && (
          <div className={`alert-banner alert-${status}`}>
            {status === 'critical'
              ? `Critical — anomaly threshold exceeded at cycle ${currentCycle}.`
              : `Watch — predicted remaining life below 30 cycles at cycle ${currentCycle}.`}
          </div>
        )}

        {view === 'fleet' ? (
          <section className="fleet-section">
            <h2 className="section-title">Fleet overview</h2>
            <p className="section-hint">Status snapshot across the constellation. Click a spacecraft to open its dashboard.</p>
            {fleetLoading && <p className="section-hint">Loading fleet status...</p>}
            {fleetData && (
              <div className="fleet-grid">
                {FLEET.map((sat, i) => {
                  const r = fleetData[i]
                  const last = r.predicted_rul.length - 1
                  const m = STATUS_META[r.status_per_cycle[last]]
                  return (
                    <div key={sat.id} className="fleet-card" style={{ '--pill-color': m.color }} onClick={() => openSat(sat.seed)}>
                      <div className="fleet-card-name">{sat.name}</div>
                      <div className="fleet-card-status" style={{ color: m.color }}>{m.label}</div>
                      <div className="fleet-card-rul mono">RUL {r.predicted_rul[last].toFixed(1)} cycles</div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        ) : view === 'drone' ? (
          <section className="drone-page">
            <div className="drone-page-main hud-frame">
              <div className="drone-3d-tag mono">{satId} · LIVE ORBIT · CYCLE {currentCycle}</div>
              <SpacecraftVisual3D status={status} riskScore={riskScore} />
            </div>
            <div className="drone-page-side">
              <div className="status-pill" style={{ '--pill-color': statusMeta.color }}>{statusMeta.label}</div>
              <div className="drone-page-stats">
                <div className="hero-metric"><div className="hero-label">Risk score</div><div className="hero-value">{riskScore.toFixed(0)}<span className="unit">/ 100</span></div></div>
                <div className="hero-metric"><div className="hero-label">Predicted RUL</div><div className="hero-value">{predictedRul.toFixed(1)}<span className="unit">cycles</span></div></div>
                <div className="hero-metric"><div className="hero-label">Anomaly score</div><div className="hero-value">{anomalyScore.toFixed(5)}</div></div>
              </div>
              <p className="summary-text">Tumble rate and orbit speed rise with risk: a steady spacecraft is healthy, an erratic one needs intervention.</p>
            </div>
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
              <div className="drone-3d-card hud-frame">
                <div className="drone-3d-tag mono">{satId} · LIVE ORBIT</div>
                <SpacecraftVisual3D status={status} riskScore={riskScore} />
                <div className="engine-3d-caption">Thruster &amp; antenna glow follow spacecraft status</div>
              </div>
              <div className="engine-3d-card hud-frame">
                <div className="drone-3d-tag mono">SUBSYSTEM DEVIATION</div>
                <div className="contrib-list" style={{ width: '100%', background: 'none', border: 'none', boxShadow: 'none', padding: 6 }}>
                  {subsystemHealth.map((s) => (
                    <div key={s.name} className="contrib-row">
                      <div className="contrib-row-top">
                        <span className="contrib-name" style={{ fontSize: 12 }}>{s.name}</span>
                        <span className="contrib-pct mono">{s.pct.toFixed(0)}%</span>
                      </div>
                      <div className="contrib-bar-track" style={{ height: 6 }}>
                        <div className="contrib-bar-fill" style={{ width: `${Math.min(s.pct, 100)}%`, background: status === 'normal' ? 'var(--accent-cyan)' : 'var(--status-watch)' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="impact-card">
                <h3 className="impact-title">Early-warning impact</h3>
                {missionImpact?.warned ? (
                  <p className="impact-text">
                    Degradation flagged at cycle <strong className="mono">{missionImpact.warningCycle}</strong> —{' '}
                    <strong className="mono">{missionImpact.leadCycles} cycles</strong> of advance notice. Ground teams can act before a critical failure, since the spacecraft can't be repaired in orbit.
                  </p>
                ) : (
                  <p className="impact-text">No early-warning signs across this mission — all subsystems stayed within healthy limits.</p>
                )}
              </div>
            </section>

            <section className="controls">
              <label>Mission length
                <input type="range" min={60} max={300} step={10} value={cycles} onChange={(e) => setCycles(Number(e.target.value))} />
                <span className="mono">{cycles} cycles</span>
              </label>
              <label>Seed
                <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
              </label>
              <button className="play-btn" onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : 'Play mission'}</button>
              <label className="scrub">Cycle
                <input type="range" min={first} max={cycles - 1} value={currentCycle}
                  onChange={(e) => { setPlaying(false); setCurrentCycle(Number(e.target.value)) }} />
                <span className="mono">{currentCycle}</span>
              </label>
            </section>

            <section className="fault-panel">
              <label>Inject fault
                <select value={fault} onChange={(e) => setFault(e.target.value)}>
                  <option value="">None (healthy)</option>
                  {faults.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </label>
              <label>Severity {severity.toFixed(1)}
                <input type="range" min={0.2} max={1.5} step={0.1} value={severity} disabled={!fault}
                  onChange={(e) => setSeverity(Number(e.target.value))} />
              </label>
              <label>Starts at cycle {faultStart}
                <input type="range" min={20} max={cycles - 20} step={5} value={faultStart} disabled={!fault}
                  onChange={(e) => setFaultStart(Number(e.target.value))} />
              </label>
              <label>What-if: cut load/stress {Math.round(mitigate * 100)}%
                <input type="range" min={0.1} max={0.9} step={0.1} value={mitigate} disabled={!fault}
                  onChange={(e) => setMitigate(Number(e.target.value))} />
              </label>
              <button className="save-btn" disabled={!fault} onClick={runWhatIf}>Apply at cycle {currentCycle}</button>
              {whatIf && (
                <span className="whatif-result">
                  Mitigation at cycle {currentCycle} changes final RUL by{' '}
                  {(whatIf.predicted_rul.at(-1) - sim.predicted_rul.at(-1)).toFixed(1)} cycles (green line)
                </span>
              )}
            </section>

            <section className="hero">
              <div className="hero-metric">
                <div className="hero-label">Predicted RUL</div>
                <div className="hero-value mono">{predictedRul.toFixed(1)}<span className="unit">cycles</span></div>
                {sim.rul_low && <div className="hero-sub mono">likely {sim.rul_low[idx].toFixed(0)}–{sim.rul_high[idx].toFixed(0)}</div>}
              </div>
              <div className="hero-metric">
                <div className="hero-label">Anomaly score</div>
                <div className="hero-value mono">{anomalyScore.toFixed(5)}</div>
                <div className="hero-sub mono">threshold {sim.meta.anomaly_threshold.toFixed(5)}</div>
              </div>
              <div className="status-pill" style={{ '--pill-color': statusMeta.color }}>{statusMeta.label}</div>
            </section>

            <RecommendationPanel explanations={sim.explanations} currentCycle={currentCycle} />
            <AgentChat sim={sim} cycle={currentCycle} status={status} />

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

            <section className="charts">
              <div className="chart-panel">
                <h2>Remaining useful life</h2>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis dataKey="cycle" stroke="var(--text-secondary)" fontSize={12} />
                    <YAxis stroke="var(--text-secondary)" fontSize={12} />
                    <Tooltip contentStyle={tip} />
                    <Line type="monotone" dataKey="predictedRul" stroke="var(--accent-cyan)" dot={false} strokeWidth={2} name="Predicted RUL" />
                    <Line type="monotone" dataKey="trueRul" stroke="var(--text-secondary)" dot={false} strokeWidth={1.5} strokeDasharray="4 4" name="Simulated true RUL" />
                    <Line type="monotone" dataKey="rulLow" stroke="var(--accent-cyan)" dot={false} strokeWidth={1} strokeOpacity={0.4} strokeDasharray="2 3" name="RUL low" />
                    <Line type="monotone" dataKey="rulHigh" stroke="var(--accent-cyan)" dot={false} strokeWidth={1} strokeOpacity={0.4} strokeDasharray="2 3" name="RUL high" />
                    <Line type="monotone" dataKey="whatIfRul" stroke="var(--status-normal)" dot={false} strokeWidth={2} name="With mitigation" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="chart-panel">
                <h2>Anomaly score</h2>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis dataKey="cycle" stroke="var(--text-secondary)" fontSize={12} />
                    <YAxis stroke="var(--text-secondary)" fontSize={12} />
                    <Tooltip contentStyle={tip} />
                    <ReferenceLine y={sim.meta.anomaly_threshold} stroke="var(--status-critical)" strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="anomalyScore" stroke="var(--status-watch)" dot={false} strokeWidth={2} name="Reconstruction error" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="charts">
              <PhysicsChart
                physics={sim.physics}
                sensorData={sim.sensor_data}
                channelIndex={tIdx}
                channelName={sim.meta.feature_names[tIdx]}
                currentCycle={currentCycle}
              />
            </section>

            <section className="sensor-section">
              <h2 className="section-title">Spacecraft telemetry</h2>
              <p className="section-hint">Normalised channel readings by subsystem. Amber cards are drifting as the spacecraft degrades.</p>
              <div className="sensor-grid">
                {sim.meta.feature_names.map((name, i) => {
                  const sens = sim.meta.sensitive_sensor_indices.includes(i)
                  return (
                    <div key={name} className={`sensor-card${sens ? ' sensitive' : ''}`}>
                      <div className="sensor-card-head">
                        <span className="sensor-name">{name}</span>
                        <span className="sensor-value mono">{sim.sensor_data[currentCycle][i].toFixed(3)}</span>
                      </div>
                      <div className="sensor-raw">{sim.meta.feature_subsystems[i]}</div>
                      <ResponsiveContainer width="100%" height={70}>
                        <LineChart data={sensorSeriesData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                          <Line type="monotone" dataKey={name} dot={false} strokeWidth={1.5} isAnimationActive={false}
                            stroke={sens ? 'var(--status-watch)' : 'var(--accent-cyan)'} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )
                })}
              </div>
            </section>
          </>
        )}

        <footer className="footnote">
          Simulated telemetry stands in for live spacecraft downlink. Hybrid twin: physics-based thermal model + ML anomaly detection and RUL prediction.
        </footer>
      </div>
    </>
  )
}