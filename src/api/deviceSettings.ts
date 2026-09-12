import { operatorRequest } from './operator'
import type { SettingsResource } from '../hooks/useSettingsDocument'

const get = <T>(path: string, signal?: AbortSignal) => operatorRequest<T>(`/api/v1/${path}`, { signal }, true)
const send = (path: string, method: string, body?: unknown) => operatorRequest<Record<string, unknown>>(`/api/v1/${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, true)
function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}未返回有效数值，请重新读取。`)
  return value
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}状态暂不可确认。`)
  return value
}
export interface NumberField { key: string; label: string; help_text: string; minimum: number; maximum: number; step: number; default?: number }
export function numericError(value: number, field: Pick<NumberField, 'label' | 'minimum' | 'maximum' | 'step'>): string {
  if (!Number.isFinite(value) || value < field.minimum || value > field.maximum) return `${field.label}应在 ${field.minimum}–${field.maximum} 之间。`
  if (Math.abs((value - field.minimum) / field.step - Math.round((value - field.minimum) / field.step)) > 0.00001) return `${field.label}请按 ${field.step} 的步长调整。`
  return ''
}
type VolumeValues = { value: number }
export interface VolumeDocument { values: VolumeValues; minimum: number; maximum: number; step: number; label: string; unit: string }
function volumeResource(path: string, label: string, gain = false): SettingsResource<VolumeValues, VolumeDocument> {
  return {
    read: async signal => {
      const data = await get<Record<string, unknown>>(path, signal)
      const value = finite(gain ? data.gain : data.volume ?? data.value ?? data.current, label)
      const minimum = gain ? finite(data.minimum, '增益下限') : 0
      const maximum = gain ? finite(data.maximum, '增益上限') : 100
      if (minimum >= maximum || value < minimum || value > maximum) throw new Error('设备返回的范围无效，请检查设备。')
      return { values: { value }, minimum, maximum, step: 1, label, unit: gain ? '' : '%' }
    },
    // Legacy API uses "volume" for XVF gain too; its returned value is NOT a percent.
    write: (next) => send(path, 'POST', { volume: next.value }),
    validate: (next, document) => numericError(next.value, document),
  }
}
export const speakerResource = volumeResource('daemon/volume', '扬声器音量')
export const microphoneResource = volumeResource('daemon/volume/microphone', '麦克风音量')
export const gainResource = volumeResource('daemon/audio/xvf_microphone_gain', '麦克风前级增益', true)

type IdleValues = { enabled: boolean }
interface IdleDocument { values: IdleValues; active: boolean; available: boolean; suppressed: boolean }
export const idleResource: SettingsResource<IdleValues, IdleDocument> = {
  read: async signal => {
    const data = await get<Record<string, unknown>>('idle_breathing', signal)
    return { values: { enabled: boolean(data.configured_enabled ?? data.enabled, '待机呼吸') }, active: boolean(data.active, '运行'), available: boolean(data.available, '动作可用'), suppressed: Boolean(data.suppressed_by) }
  },
  write: next => send('idle_breathing', 'POST', next),
}
export interface TuningValues { enabled: boolean; respond_to_detected_speech: boolean; parameters: Record<string, number> }
export interface TuningDocument { values: TuningValues; fields: NumberField[]; reason: string }
export const tuningResource: SettingsResource<TuningValues, TuningDocument> = {
  read: async signal => {
    const data = await get<{ enabled: boolean; respond_to_detected_speech: boolean; values: Record<string, number>; fields: NumberField[]; runtime?: { last_decision?: { reason?: string } } }>('sound-localization/settings', signal)
    if (!Array.isArray(data.fields) || !data.fields.length || !data.values) throw new Error('设备未提供可编辑的转向参数。')
    for (const field of data.fields) {
      finite(data.values[field.key], field.label)
      if (!(Number.isFinite(field.minimum) && Number.isFinite(field.maximum) && field.minimum < field.maximum && Number.isFinite(field.step) && field.step > 0)) throw new Error('设备参数范围无效。')
    }
    return { values: { enabled: boolean(data.enabled, '听声转向'), respond_to_detected_speech: boolean(data.respond_to_detected_speech, '未唤醒转向'), parameters: data.values }, fields: data.fields, reason: data.runtime?.last_decision?.reason || '' }
  },
  write: (next, previous) => {
    const body: Record<string, unknown> = {}
    if (next.enabled !== previous.enabled) body.enabled = next.enabled
    if (next.respond_to_detected_speech !== previous.respond_to_detected_speech) body.respond_to_detected_speech = next.respond_to_detected_speech
    const changed = Object.fromEntries(Object.entries(next.parameters).filter(([key, value]) => value !== previous.parameters[key]))
    if (Object.keys(changed).length) body.values = changed
    return send('sound-localization/settings', 'PATCH', body)
  },
  validate: (next, document) => document.fields.map(field => numericError(next.parameters[field.key], field)).find(Boolean) || '',
  reset: () => send('sound-localization/settings', 'DELETE'),
  validateReset: document => document.fields.every(field => typeof field.default === 'number' && document.values.parameters[field.key] === field.default) ? '' : '设备参数尚未恢复为推荐值。',
}

export interface VisionValues { enabled: boolean; proactive_enabled: boolean; adaptive_cloud_enabled: boolean; occupied_cloud_interval_s: number; empty_cloud_interval_s: number; max_cloud_calls_per_10m: number }
interface VisionDocument { values: VisionValues; phase: string; calls: number | null }
export const visionFields: NumberField[] = [
  { key: 'occupied_cloud_interval_s', label: '有人时复查间隔（秒）', help_text: '稳定场景会在自适应模式下继续延长间隔。', minimum: 15, maximum: 600, step: 1 },
  { key: 'empty_cloud_interval_s', label: '无人时复查间隔（秒）', help_text: '无人且画面稳定时，以本地观察为主。', minimum: 30, maximum: 900, step: 1 },
  { key: 'max_cloud_calls_per_10m', label: '每十分钟调用上限', help_text: '实际调用还受其他全局频率上限约束。', minimum: 2, maximum: 60, step: 1 },
]
export const visionResource: SettingsResource<VisionValues, VisionDocument> = {
  read: async signal => {
    const result = await get<{ office?: { ambient_vision?: Record<string, unknown> } }>('status', signal)
    const data = result.office?.ambient_vision
    if (!data) throw new Error('环境观察状态暂不可用。')
    return { values: {
      enabled: boolean(data.enabled, '环境观察'), proactive_enabled: boolean(data.proactive_enabled, '主动开口'), adaptive_cloud_enabled: boolean(data.adaptive_cloud_enabled, '自适应调用'),
      occupied_cloud_interval_s: finite(data.occupied_cloud_interval_seconds, '有人时复查间隔'), empty_cloud_interval_s: finite(data.empty_cloud_interval_seconds, '无人时复查间隔'), max_cloud_calls_per_10m: finite(data.max_cloud_calls_per_10m, '调用上限'),
    }, phase: String(data.adaptive_phase || ''), calls: typeof data.cloud_calls_last_10m === 'number' ? data.cloud_calls_last_10m : null }
  },
  write: (next, previous) => send('ambient-vision/settings', 'PATCH', Object.fromEntries(Object.entries(next).filter(([key, value]) => value !== previous[key as keyof VisionValues]))),
  validate: next => visionFields.map(field => numericError(next[field.key as keyof VisionValues] as number, field)).find(Boolean) || '',
}
export interface Observation { sequence: number; summary: string; expires_in_ms: number }
export const readObservations = async (signal?: AbortSignal): Promise<Observation[]> => {
  const data = await get<{ observations?: Observation[] }>('ambient-vision/observations', signal)
  if (!Array.isArray(data.observations)) throw new Error('无法读取最近观察。')
  return data.observations.filter(item => typeof item.summary === 'string' && item.expires_in_ms > 0).slice(0, 3)
}
export const clearObservations = () => send('ambient-vision/observations', 'DELETE')
