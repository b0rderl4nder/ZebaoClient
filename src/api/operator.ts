import { appUrl } from './client'

export const OPERATOR_APP_PORT = 7862

/** One connection boundary for the scene-owned App, separate from daemon APIs. */
export function operatorPage(route: string) {
  return appUrl(OPERATOR_APP_PORT, `/#/${route.replace(/^[/#]+/, '')}`)
}

export async function operatorRequest<T>(path: string, init: RequestInit = {}, sceneConfig = false): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (init.signal?.aborted) abort()
  init.signal?.addEventListener('abort', abort, { once: true })
  const timeout = window.setTimeout(abort, 8000)
  try {
    const response = await fetch(sceneConfig ? appUrl(5173, `/operator-api${path}`) : appUrl(OPERATOR_APP_PORT, path), {
      ...init,
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload || payload.ok === false) throw new Error('机器人未能完成请求，请检查应用状态后重试。')
    return payload as T
  } catch (error) {
    if (init.signal?.aborted) throw error
    if (controller.signal.aborted) throw new Error('连接超时，请重试。')
    if (error instanceof TypeError) throw new Error('无法连接机器人应用，请检查设备连接。')
    throw error
  } finally {
    window.clearTimeout(timeout)
    init.signal?.removeEventListener('abort', abort)
  }
}
