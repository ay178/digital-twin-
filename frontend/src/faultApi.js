// Same base URL logic as your api.js. If your api.js uses a different
// fallback URL (e.g. a deployed backend), change API_BASE below to match.
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export async function fetchSim({ cycles, seed, fault = '', severity = 0.6, faultStart = 60, mitigate = 0, mitigateAt = -1 }) {
  const q = new URLSearchParams({
    cycles, seed, fault, severity, fault_start: faultStart, mitigate, mitigate_at: mitigateAt,
  })
  const res = await fetch(`${API_BASE}/api/simulate?${q}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchFaults() {
  const res = await fetch(`${API_BASE}/api/faults`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}