import { operatorRequest } from './operator'
import type { SceneRuntimeSnapshot } from './sceneRuntime'

// Display names only; available profiles and the effective selection come from App.
export function voiceName(provider?: string, fallback?: string): string {
  const names: Record<string, string> = { aliyun_native_omni: '云端 Omni', cloud_omni: '云端 Omni（兼容）', platform_ws: '平台链路', local_omni: '本地 Omni' }
  return (provider && names[provider]) || (fallback && fallback !== '共享语音配置' ? fallback : '') || '待确认'
}
export function voiceMountName(id: string, name: string, system?: string): string {
  return id === 'shared' ? system ? `跟随系统 · ${voiceName(system)}` : '跟随系统默认' : voiceName(id, name)
}
export interface VoiceProfile { id: string; name: string; provider?: string; description?: string }
export interface VoiceCatalog {
  voice_pipeline_provider: string
  shared_voice_pipeline_provider: string
  provider_mount_catalog?: { voice_profiles?: VoiceProfile[] }
  aliyun_native_omni?: { configured: boolean; model?: string; voice?: string }
  cloud_omni?: { configured: boolean; model?: string; voice?: string }
}
export interface VoiceActivation {
  enabled: boolean; fixed_wake_word: string
  activation: { active: boolean; state: string }
  local_kws: { ready: boolean; settings_persisted?: boolean; last_latency_ms?: number | null }
  diagnostics?: { bare_wake_local_audio_ready?: boolean; session_exit_feedback?: { state?: string } }
}
const request = <T>(path: string, init: RequestInit = {}) => operatorRequest<T>(`/api/v1${path}`, init, true)
export const readVoiceDefault = (signal?: AbortSignal) => request<{ shared_voice_pipeline_provider?: string }>('/scenes', { signal })
export const readVoiceCatalog = async (signal?: AbortSignal): Promise<VoiceCatalog> => {
  const [catalog, defaults] = await Promise.all([request<VoiceCatalog>('/ui/scenes', { signal }), readVoiceDefault(signal)])
  if (!defaults.shared_voice_pipeline_provider) throw new Error('服务未返回系统默认链路，无法安全编辑。')
  return { ...catalog, shared_voice_pipeline_provider: defaults.shared_voice_pipeline_provider }
}
export const readVoiceRuntime = (signal?: AbortSignal) => request<SceneRuntimeSnapshot>('/ui/runtime', { signal })
export const readVoiceActivation = (signal?: AbortSignal) => request<VoiceActivation>('/settings/voice-activation', { signal })
export const saveVoiceDefault = (provider: string) => request('/scenes/voice-pipeline', { method: 'PATCH', body: JSON.stringify({ provider }) })
export const updateVoiceActivation = (body: { enabled: boolean } | { action: 'retire' }) => request('/settings/voice-activation', { method: 'PATCH', body: JSON.stringify(body) })
export const saveNativeConnection = (fields: Record<string, string>) => request('/backend_config', { method: 'POST', body: JSON.stringify({ backend: 'aliyun_native_omni', ...fields }) })
