export const DEFAULT_DAEMON_PORT = 8000
export const OFFICIAL_CONVERSATION_APP_PORT = 7860
export const EXHIBITION_CONVERSATION_APP_PORT = 7861
export const CONVERSATION_APP_PORT = EXHIBITION_CONVERSATION_APP_PORT

let baseUrl = ''
export function setBaseUrl(url: string) { baseUrl = url.replace(/\/$/, '') }
export function getBaseUrl() { return baseUrl }

function ensureBaseUrl() {
  if (baseUrl) return
  try {
    const stored = JSON.parse(localStorage.getItem('zebao_current_robot') || 'null')
    if (stored?.host) {
      const port = !stored.port || stored.port === 15347 ? DEFAULT_DAEMON_PORT : stored.port
      setBaseUrl(`http://${stored.host}:${port}`)
      return
    }
  } catch {
    // Keep baseUrl empty; the request helper will report a useful error.
  }
  const host = window.location.hostname || '127.0.0.1'
  setBaseUrl(`http://${host}:${DEFAULT_DAEMON_PORT}`)
}

async function parseResponse(r: Response, method: string, path: string): Promise<unknown> {
  const text = await r.text()
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status}`)
  if (!text) return null
  const contentType = r.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw new Error(`${method} ${path}: expected JSON, got ${contentType || 'unknown content-type'}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${method} ${path}: invalid JSON response`)
  }
}

export async function get(path: string): Promise<unknown> {
  ensureBaseUrl()
  const r = await fetch(`${baseUrl}${path}`)
  return parseResponse(r, 'GET', path)
}
export async function post(path: string, body?: unknown): Promise<unknown> {
  ensureBaseUrl()
  const r = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  return parseResponse(r, 'POST', path)
}
export function wsUrl(path: string): string {
  ensureBaseUrl()
  return baseUrl.replace(/^http/, 'ws') + path
}

export function getConnectedHost(): string {
  ensureBaseUrl()
  try {
    return new URL(baseUrl).hostname
  } catch {
    return window.location.hostname
  }
}

export function appUrl(port: number, path: string): string {
  return `http://${getConnectedHost()}:${port}${path}`
}
