import { operatorRequest } from './operator'

export interface MountOption { id: string; name: string; requires_capability?: string }
export interface SceneConfig {
  id: string; name: string; description: string; active: boolean; built_in: boolean
  capabilities: string[]; settings: Record<string, unknown>; flow_id: string; interaction_policy_id: string
  provider_mounts: { voice_profile_id?: string; interaction_profile_id?: string; knowledge_source_ids?: string[]; display_target_ids?: string[] }
}
export interface SceneDetail {
  ok: boolean; scene: SceneConfig; voice_pipeline_provider?: string
  catalog: (MountOption & { scope: string; product_layer?: string; description?: string })[]
  interaction_policies: MountOption[]
  provider_mount_catalog?: { voice_profiles?: MountOption[]; knowledge_sources?: MountOption[]; display_targets?: MountOption[] }
}
const scenePath = (id: string) => `/api/v1/scenes/${encodeURIComponent(id)}`
export const fetchSceneDetail = (id: string, signal?: AbortSignal) => operatorRequest<SceneDetail>(`/api/v1/ui/scenes/${encodeURIComponent(id)}`, { signal }, true)

// Use the same save/publish protocol as App; no Client-owned configuration store.
export async function saveSceneConfig(scene: SceneConfig) {
  const { name, description, capabilities, settings, flow_id, interaction_policy_id, provider_mounts } = scene
  await operatorRequest(scenePath(scene.id), { method: 'PUT', body: JSON.stringify({ name, description, capabilities, settings, flow_id, interaction_policy_id, provider_mounts }) }, true)
  await operatorRequest(`${scenePath(scene.id)}/publish`, { method: 'POST' }, true)
  return fetchSceneDetail(scene.id)
}
export const createSceneConfig = (name: string, sourceId?: string) => operatorRequest<{ scene_id: string }>('/api/v1/ui/scenes', {
  method: 'POST', body: JSON.stringify({ scene_id: `scene_${Array.from(crypto.getRandomValues(new Uint32Array(3)), value => value.toString(36)).join('')}`, name, mode: sourceId ? 'copy' : 'blank', ...(sourceId ? { source_scene_id: sourceId } : {}) }),
}, true)
export const deleteSceneConfig = (id: string, replacement: string) => operatorRequest(`${scenePath(id)}${replacement ? `?replacement_scene_id=${encodeURIComponent(replacement)}` : ''}`, { method: 'DELETE' }, true)
