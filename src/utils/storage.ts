const KEY = 'zebao_current_robot'
const RECENT_KEY = 'zebao_recent_robots'
const LEGACY_DAEMON_PORT = 15347
const DEFAULT_DAEMON_PORT = 8000

function normalizePort(port: number | undefined): number {
  if (!port || port === LEGACY_DAEMON_PORT) return DEFAULT_DAEMON_PORT
  return port
}

export function getStoredRobot(): { host: string; port: number } | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || 'null')
    return value ? { ...value, port: normalizePort(value.port) } : null
  } catch {
    return null
  }
}
export function setStoredRobot(host: string, port: number) { localStorage.setItem(KEY, JSON.stringify({ host, port })) }
export function clearStoredRobot() { localStorage.removeItem(KEY) }

export function loadRecentRobots(): { host: string; port: number; name?: string }[] {
  try {
    const values = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(values) ? values.map(value => ({ ...value, port: normalizePort(value.port) })) : []
  } catch {
    return []
  }
}
export function saveRecentRobot(host: string, port: number) {
  const recent = loadRecentRobots().filter(r => r.host !== host)
  recent.unshift({ host, port })
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, 10)))
}
