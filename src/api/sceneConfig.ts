import { operatorRequest } from './operator'
import { readVoiceDefault } from './voiceSettings'

export interface MountOption { id: string; name: string; requires_capability?: string; provider?: string }
export interface CapabilitySetting {
  key: string; label: string; kind: string; default: string | number | boolean
  help_text?: string; minimum?: number | null; maximum?: number | null
  options?: { value: string; label: string }[]
}
export interface CapabilityOption extends MountOption {
  scope: string; product_layer?: string; description?: string; detail?: string
  examples?: string[]; settings_schema?: CapabilitySetting[]
}
export interface SceneConfig {
  id: string; name: string; description: string; active: boolean; built_in: boolean
  capabilities: string[]; settings: Record<string, unknown>; flow_id: string; interaction_policy_id: string
  provider_mounts: { voice_profile_id?: string; interaction_profile_id?: string; knowledge_source_ids?: string[]; display_target_ids?: string[] }
}
export interface SceneDetail {
  ok: boolean; scene: SceneConfig; voice_pipeline_provider?: string; shared_voice_pipeline_provider?: string
  catalog: CapabilityOption[]
  interaction_policies: MountOption[]
  provider_mount_catalog?: { voice_profiles?: MountOption[]; knowledge_sources?: MountOption[]; display_targets?: MountOption[] }
}
const scenePath = (id: string) => `/api/v1/scenes/${encodeURIComponent(id)}`
export const fetchSceneDetail = async (id: string, signal?: AbortSignal): Promise<SceneDetail> => {
  const detail = await operatorRequest<SceneDetail>(`/api/v1/ui/scenes/${encodeURIComponent(id)}`, { signal }, true)
  if (detail.scene?.id !== id || !Array.isArray(detail.catalog) || !Array.isArray(detail.interaction_policies)) throw new Error('这个场景的配置未能确认，请重新读取或选择其他场景。')
  // Older UI projections omit this field. Never substitute the effective engine.
  if (!detail.shared_voice_pipeline_provider) {
    const defaults = await readVoiceDefault(signal).catch(() => null)
    return { ...detail, shared_voice_pipeline_provider: defaults?.shared_voice_pipeline_provider }
  }
  return detail
}

// Use the same save/publish protocol as App; no Client-owned configuration store.
export async function saveSceneConfig(scene: SceneConfig) {
  const { name, description, capabilities, settings, flow_id, interaction_policy_id, provider_mounts } = scene
  await operatorRequest(scenePath(scene.id), { method: 'PUT', body: JSON.stringify({ name, description, capabilities, settings, flow_id, interaction_policy_id, provider_mounts }) }, true)
  await operatorRequest(`${scenePath(scene.id)}/publish`, { method: 'POST' }, true)
  return fetchSceneDetail(scene.id)
}
export interface SceneTemplate { id: string; name: string; description: string; mode: 'blank' | 'copy' | 'template'; source_scene_id: string }
export interface SceneFlowDefinition {
  id: string; name: string; description: string
  stages: { id: string; name: string; goal: string; suggested_capabilities: string[] }[]
}
export async function fetchSceneFlows(signal?: AbortSignal): Promise<SceneFlowDefinition[]> {
  const result = await operatorRequest<{ flows: SceneFlowDefinition[] }>('/api/v1/ui/scene-flows', { signal }, true)
  if (!Array.isArray(result.flows) || result.flows.some(flow => !flow.id || !flow.name || !Array.isArray(flow.stages) || flow.stages.some(stage => !stage.name || !Array.isArray(stage.suggested_capabilities)))) throw new Error('流程目录暂不完整，请检查 App 版本后重试。')
  return result.flows
}
export async function fetchSceneTemplates(signal?: AbortSignal) {
  const result = await operatorRequest<{ templates: SceneTemplate[] }>('/api/v1/ui/scene-templates', { signal }, true)
  if (!Array.isArray(result.templates) || result.templates.some(item => !item.id || !item.name || !['blank', 'copy', 'template'].includes(item.mode))) throw new Error('创建来源暂不完整，请重新读取。')
  return result.templates
}
export const createSceneConfig = (name: string, sourceId?: string, mode: SceneTemplate['mode'] = sourceId ? 'copy' : 'blank') => operatorRequest<{ scene_id: string }>('/api/v1/ui/scenes', {
  method: 'POST', body: JSON.stringify({ scene_id: `scene_${Array.from(crypto.getRandomValues(new Uint32Array(3)), value => value.toString(36)).join('')}`, name, mode, ...(sourceId ? { source_scene_id: sourceId } : {}) }),
}, true)
export const deleteSceneConfig = (id: string, replacement: string) => operatorRequest(`${scenePath(id)}${replacement ? `?replacement_scene_id=${encodeURIComponent(replacement)}` : ''}`, { method: 'DELETE' }, true)

export interface SceneRevision { revision_id: string; reason: string; name: string; flow_id: string; capability_count: number }
export async function fetchSceneRevisions(id: string, signal?: AbortSignal) {
  const result = await operatorRequest<{ scene_id: string; revisions: SceneRevision[] }>(`${scenePath(id)}/revisions`, { signal }, true)
  if (result.scene_id !== id || !Array.isArray(result.revisions)) throw new Error('历史版本暂不可用，请重新读取。')
  return result.revisions
}
export async function restoreSceneRevision(id: string, revision: SceneRevision) {
  const result = await operatorRequest<{ scene_restore?: { scene_id: string; revision_id: string; restored: boolean } }>(`${scenePath(id)}/revisions/${encodeURIComponent(revision.revision_id)}/restore`, { method: 'POST' }, true)
  const receipt = result.scene_restore
  if (!receipt?.restored || receipt.scene_id !== id || receipt.revision_id !== revision.revision_id) throw new Error('恢复结果未确认，请重新读取；不要重复提交。')
  const detail = await fetchSceneDetail(id)
  if (detail.scene.name !== revision.name || detail.scene.flow_id !== revision.flow_id || detail.scene.capabilities.length !== revision.capability_count) throw new Error('恢复后的配置与历史摘要不一致，请重新读取。')
  return detail
}
