import { operatorRequest } from './operator'

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
  return operatorRequest('/api/v1/ui/runtime', { signal })
}

export interface SceneSummary {
  id: string
  name: string
  active: boolean
  capability_count: number
}

export function fetchScenes(signal?: AbortSignal) {
  return operatorRequest<{ scenes: SceneSummary[] }>('/api/v1/ui/scenes', { signal })
}

export function activateScene(id: string) {
  return operatorRequest(`/api/v1/scenes/${encodeURIComponent(id)}/activate`, { method: 'POST' })
}
