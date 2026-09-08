const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export async function fetchHealth() {
  const res = await fetch(`${API_URL}/api/health`)
  if (!res.ok) throw new Error('Backend health check failed')
  return res.json()
}

export async function fetchSimulation(cycles, seed) {
  const res = await fetch(`${API_URL}/api/simulate?cycles=${cycles}&seed=${seed}`)
  if (!res.ok) throw new Error('Simulation request failed')
  return res.json()
}
