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

/**
 * The active scene's executable Skill contract.  This is a read-only
 * projection of the App registry; the Client never invokes a Skill directly.
 */
export interface SkillManifest {
  skill_id: string
  tool_name: string
  title: string
  description?: string
  version?: string
  scope?: string
  provider?: string
  requires_scene_capabilities?: string[]
  requires_identity_authorization?: boolean
  authorization_permission?: string
  input_schema?: Record<string, unknown>
  idempotency?: string
  result_contract?: string
  readback_required?: string
  execution_contract?: string
}

export interface SkillRegistrySnapshot {
  ok: boolean
  contract_version?: string
  scene?: { id?: string; name?: string; generation?: string }
  generation?: string
  count?: number
  skills?: SkillManifest[]
  execution_boundary?: string
}

export async function fetchSceneRuntime(signal?: AbortSignal): Promise<SceneRuntimeSnapshot> {
  return operatorRequest('/api/v1/ui/runtime', { signal })
}

export async function fetchSkillRegistry(signal?: AbortSignal): Promise<SkillRegistrySnapshot> {
  return operatorRequest('/api/v1/ecosystem/skills', { signal })
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
