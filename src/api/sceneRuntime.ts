import { appUrl } from './client'
import { OPERATOR_APP_PORT } from './embodied'

export interface SceneRuntimeItem {
  id: string
  name?: string
  label?: string
}

/**
 * The browser-facing projection of SceneManager's frozen runtime snapshot.
 *
 * It intentionally omits scene settings, provider URLs, credentials, identity
 * and device-control details. A Client view renders this contract rather than
 * reconstructing a scene or capability catalogue.
 */
export interface SceneRuntimeSnapshot {
  ok: boolean
  state: 'ready' | 'scene_runtime_unavailable' | string
  scene?: {
    id?: string
    name?: string
    generation?: string
    description?: string
  }
  capabilities?: SceneRuntimeItem[]
  capability_count?: number
  voice?: {
    provider?: string
    label?: string
  }
  interaction?: {
    id?: string
    name?: string
    entry_mode?: string
  }
  knowledge?: SceneRuntimeItem[]
  displays?: SceneRuntimeItem[]
}

export async function fetchSceneRuntime(signal?: AbortSignal): Promise<SceneRuntimeSnapshot> {
  const response = await fetch(appUrl(OPERATOR_APP_PORT, '/api/v1/ui/runtime'), {
    headers: { Accept: 'application/json' },
    signal,
  })
  const payload = await response.json().catch(() => ({})) as SceneRuntimeSnapshot
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.state || 'HTTP ' + response.status)
  }
  return payload
}
