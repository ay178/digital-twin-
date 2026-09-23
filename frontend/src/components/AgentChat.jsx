import { useState } from 'react'

// Offline, rule-based "mission agent". It answers from the live twin state
// (status, RUL, uncertainty, latest diagnosis). Understands English + Hinglish.
function answer(q, { sim, cycle, status }) {
  const t = q.toLowerCase()
  const first = sim.meta.first_valid_cycle
  const i = Math.max(0, cycle - first)
  const rul = sim.predicted_rul[i]
  const lo = sim.rul_low?.[i], hi = sim.rul_high?.[i]
  const ex = [...sim.explanations].filter((e) => e.cycle <= cycle).pop()
  const has = (...w) => w.some((x) => t.includes(x))

  if (has('why', 'kyun', 'kyu', 'reason', 'cause', 'wajah')) {
    return ex ? ex.summary : 'All subsystems are nominal right now, so there is nothing abnormal to explain.'
  }
  if (has('do', 'action', 'karu', 'kare', 'recommend', 'fix', 'burn', 'safe')) {
    if (!ex) return 'No action needed. Continue the mission as planned.'
    const burn = /burn|manoeuv|maneuv/.test(t)
    const ok = status === 'normal'
    return (burn ? (ok ? 'Burn looks safe on current telemetry. ' : `I would postpone the burn: ${ex.subsystem} is ${ex.severity.toLowerCase()}. `) : '') +
      `Recommended action: ${ex.recommended_action}.`
  }
  if (has('rul', 'time', 'kitna', 'how long', 'left', 'life', 'bacha')) {
    return `Estimated remaining useful life is ~${rul.toFixed(0)} cycles` +
      (lo != null ? ` (likely range ${lo.toFixed(0)}–${hi.toFixed(0)}).` : '.')
  }
  if (has('fault', 'inject')) {
    return sim.meta.fault ? `Active injected fault: ${sim.meta.fault.replace('_', ' ')}.` : 'No fault is injected; this is a healthy-baseline run.'
  }
  if (has('status', 'health', 'sab', 'ok', 'how is')) {
    return `Status at cycle ${cycle}: ${status.toUpperCase()}. RUL ~${rul.toFixed(0)} cycles.` + (ex ? ` Main concern: ${ex.subsystem}.` : ' All subsystems nominal.')
  }
  return 'Try: "why is it failing?", "what should I do?", "can I do a burn?", "how long is left?", or "status".'
}

export default function AgentChat({ sim, cycle, status }) {
  const [log, setLog] = useState([{ who: 'agent', text: 'Mission agent online. Ask about health, causes, actions or remaining life.' }])
  const [input, setInput] = useState('')

  const send = (text) => {
    const q = (text ?? input).trim()
    if (!q) return
    setLog((l) => [...l, { who: 'you', text: q }, { who: 'agent', text: answer(q, { sim, cycle, status }) }])
    setInput('')
  }

  return (
    <section className="explain-section">
      <h2 className="section-title">Mission agent</h2>
      <p className="section-hint">Ask the twin in plain language. Answers use the live telemetry at the selected cycle.</p>
      <div className="agent-box">
        <div className="agent-log">
          {log.map((m, k) => (
            <div key={k} className={`agent-msg ${m.who}`}><b>{m.who === 'you' ? 'You' : 'Agent'}:</b> {m.text}</div>
          ))}
        </div>
        <div className="agent-quick">
          {['Why is it failing?', 'What should I do?', 'Can I do a burn?', 'How long is left?'].map((q) => (
            <button key={q} className="mini-btn" onClick={() => send(q)}>{q}</button>
          ))}
        </div>
        <div className="agent-input">
          <input value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Ask the spacecraft twin..." />
          <button className="play-btn" onClick={() => send()}>Ask</button>
        </div>
      </div>
    </section>
  )
}