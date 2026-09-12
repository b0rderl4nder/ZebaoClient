import { operatorRequest } from './operator'
import type { CapabilityOption } from './sceneConfig'

export interface CatalogItem extends CapabilityOption {
  category?: string; locked: boolean; deletable: boolean; global_enabled?: boolean
  settings_route?: string; runtime_control?: string
  runtime_state?: { configured_enabled?: boolean; enabled?: boolean; active?: boolean; available?: boolean } | null
}
export interface CapabilityCatalog {
  catalog: CatalogItem[]; deleted_catalog: CatalogItem[]; global_enabled: string[]
  scenes: { id: string; name: string; capabilities: string[] }[]
}
export const catalogRequest = <T>(path: string, init: RequestInit = {}) => operatorRequest<T>(`/api/v1${path}`, init, true)
export async function readCapabilityCatalog(signal?: AbortSignal): Promise<CapabilityCatalog> {
  const data = await catalogRequest<CapabilityCatalog>('/ui/scenes', { signal })
  if (![data.catalog, data.deleted_catalog, data.global_enabled, data.scenes].every(Array.isArray)) throw new Error('能力目录暂不完整，请重新读取。')
  return data
}
export const sameIds = (left: string[], right: string[]) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
export async function setCapabilityEnabled(id: string, enabled: boolean, baseline: CapabilityCatalog) {
  const latest = await readCapabilityCatalog()
  const item = latest.catalog.find(item => item.id === id)
  if (!item || item.locked || item.product_layer === 'foundation' || item.runtime_control) throw new Error('此项由设备设置控制，请重新读取。')
  if (!sameIds(latest.global_enabled, baseline.global_enabled)) throw new Error('总开关已在其他页面修改，请重新读取。')
  const next = enabled ? [...new Set([...latest.global_enabled, id])] : latest.global_enabled.filter(value => value !== id)
  await catalogRequest('/scenes/global', { method: 'PATCH', body: JSON.stringify({ capabilities: next }) })
  const confirmed = await readCapabilityCatalog()
  if (!sameIds(confirmed.global_enabled, next)) throw new Error('总开关未回读一致，请重新读取，勿重复提交。')
  return confirmed
}
export async function archiveCapability(id: string, restore: boolean) {
  await catalogRequest(`/capabilities/${encodeURIComponent(id)}${restore ? '/restore' : ''}`, { method: restore ? 'POST' : 'DELETE' })
  const confirmed = await readCapabilityCatalog()
  if (restore ? !confirmed.catalog.some(item => item.id === id) || confirmed.deleted_catalog.some(item => item.id === id) : confirmed.catalog.some(item => item.id === id) || !confirmed.deleted_catalog.some(item => item.id === id)) throw new Error('能力目录尚未确认更新，请重新读取。')
  return confirmed
}

/** Routing only; neither capability availability nor business logic is invented here. */
export function nativeCapabilitySettings(id: string): string | undefined {
  return ({ voiceprint_identity: 'people', ambient_vision: 'vision', speaker_tracking: 'motion', living_idle: 'motion', quiet_mode: 'quiet', explicit_memory: 'memory' } as Record<string, string>)[id]
}
