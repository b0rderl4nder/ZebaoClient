import { operatorRequest } from './operator'
import type { SettingsResource } from '../hooks/useSettingsDocument'

export interface Permission { id: string; name: string; description: string }
export type Preferences = Record<string, string | number | boolean | string[]>
export interface PersonValues {
  display_name: string; salutation: string; role: string; preferred_language: string; response_style: string
  permissions: string[]; furniture_preferences: Preferences; office_preferences: Preferences
  proactive_greeting_enabled: boolean; greeting_scene_ids: string[]; greeting_cooldown_seconds: number; privacy: Record<string, boolean>
}
export interface Person extends PersonValues {
  person_id: string; identity_ready: boolean
  voiceprint: { registered: boolean; sample_count: number; embedding_valid: boolean; voiceprint_id?: number }
  face: { linked: boolean; enabled: boolean; label: string }
}
export interface PersonDocument { values: PersonValues; person: Person; permissions: Permission[] }
export interface ImportCandidate { provider_subject: string; suggested_name: string; linked: boolean; person_id?: string }
export const peopleRequest = <T>(path: string, init: RequestInit = {}, timeout = 8000) => operatorRequest<T>(`/api/v1/${path}`, init, true, timeout)
const send = <T>(path: string, method: string, body?: unknown, timeout?: number) => peopleRequest<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, timeout)
export const readPeople = async (signal?: AbortSignal) => {
  const data = await peopleRequest<{ people: Person[] }>('people', { signal })
  if (!Array.isArray(data.people)) throw new Error('人员列表暂不可用。')
  return data.people
}
export const readPerson = async (id: string, signal?: AbortSignal): Promise<PersonDocument> => {
  const data = await peopleRequest<{ person: Person; permission_catalog: Permission[] }>(`people/${encodeURIComponent(id)}`, { signal })
  const p = data.person
  if (!p || p.person_id !== id || !p.privacy || !Array.isArray(p.permissions) || !Array.isArray(p.greeting_scene_ids) || !p.voiceprint || !p.face) throw new Error('人员档案不完整，请重新读取。')
  const { display_name, salutation, role, preferred_language, response_style, furniture_preferences, office_preferences, proactive_greeting_enabled, greeting_scene_ids, greeting_cooldown_seconds, privacy } = p
  return { person: p, permissions: data.permission_catalog || [], values: { display_name, salutation, role, preferred_language, response_style, furniture_preferences, office_preferences, proactive_greeting_enabled, greeting_scene_ids, greeting_cooldown_seconds, privacy, permissions: [...p.permissions].sort() } }
}
export function preferencesError(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '偏好数据必须是对象。'
  const rows = Object.entries(value)
  if (rows.length > 20) return '每组最多 20 项偏好。'
  if (JSON.stringify(value).length > 2000) return '这组偏好内容过长，请精简。'
  for (const [key, item] of rows) {
    if (!key.trim() || key.length > 40 || /[\x00-\x1f\x7f]/.test(key)) return '偏好名称需为 1–40 字的单行文字。'
    if (typeof item === 'string' && item.length <= 120) continue
    if (typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) continue
    if (Array.isArray(item) && item.length <= 8 && item.every(entry => typeof entry === 'string' && entry.trim() && entry.length <= 60)) continue
    return '偏好值只支持文字（120 字内）、数字、开关或最多 8 项文字列表。'
  }
  return ''
}
export const personResource = (id: string): SettingsResource<PersonValues, PersonDocument> => ({
  read: signal => readPerson(id, signal),
  write: (next, previous) => send(`people/${encodeURIComponent(id)}`, 'PATCH', Object.fromEntries(Object.entries(next).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(previous[key as keyof PersonValues])))),
  validate: (next, document) => {
    if (!next.display_name.trim() || next.display_name.length > 40) return '请填写 1–40 字的姓名。'
    if (!Number.isFinite(next.greeting_cooldown_seconds) || next.greeting_cooldown_seconds < 60 || next.greeting_cooldown_seconds > 86400) return '问候冷却时间应在 1–1440 分钟之间。'
    const original = new Set(document.values.permissions), allowed = new Set(document.permissions.map(item => item.id))
    if (next.permissions.some(id => !original.has(id) && !allowed.has(id))) return '授权项已不在能力清单中，请重新读取。'
    return preferencesError(next.furniture_preferences) || preferencesError(next.office_preferences)
  },
})
export const createPerson = async (name: string) => {
  const result = await send<{ person: Person }>('people', 'POST', { display_name: name.trim() })
  if (!result.person?.person_id) throw new Error('创建结果未确认，请刷新列表，不要重复创建。')
  await readPerson(result.person.person_id)
  return result.person.person_id
}
export const removePerson = async (id: string) => {
  await send(`people/${encodeURIComponent(id)}`, 'DELETE')
  if ((await readPeople()).some(person => person.person_id === id)) throw new Error('删除结果尚未确认，请刷新列表。')
}
export const readImportCandidates = async (signal?: AbortSignal) => {
  const data = await peopleRequest<{ candidates?: ImportCandidate[]; reason?: string }>('people/import-candidates?provider=compreface', { signal }, 16000)
  if (!Array.isArray(data.candidates)) throw new Error('人脸库暂不可用，请检查连接。')
  if (data.reason && !data.candidates.length) throw new Error('人脸库暂未返回候选，请检查服务连接。')
  return data.candidates
}
export const importPerson = async (candidate: ImportCandidate, name: string, personId?: string) => {
  const result = await send<{ person: Person }>('people/import', 'POST', { provider: 'compreface', provider_subject: candidate.provider_subject, display_name: name.trim(), ...(personId ? { person_id: personId } : {}) }, 16000)
  if (!result.person?.person_id || personId && result.person.person_id !== personId) throw new Error('人脸关联结果未确认，请重新读取人员。')
  const confirmed = await readPerson(result.person.person_id)
  if (!confirmed.person.face.linked) throw new Error('本地人脸关联尚未生效。')
  return result.person.person_id
}
export const unlinkFace = async (person: Person) => {
  await send(`face-identities/mappings/${encodeURIComponent(person.display_name)}`, 'DELETE', undefined, 16000)
  if ((await readPerson(person.person_id)).person.face.linked) throw new Error('本地关联移除尚未确认。')
}
