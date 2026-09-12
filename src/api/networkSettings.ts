import { operatorRequest } from './operator'
export const networkRequest = <T>(path: string, init: RequestInit = {}, timeout = 12000) => operatorRequest<T>(`/api/v1/${path}`, init, true, timeout)
export const networkWrite = <T>(path: string, method: string, body?: unknown) => networkRequest<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, 30000)
export interface WifiState { wifi: { mode: string; connected_network: string; known_networks: string[] }; field_network: Record<string, unknown> }
export async function readWifi(signal?: AbortSignal) {
  const data = await networkRequest<WifiState>('network/wifi', { signal })
  if (!data.wifi || !Array.isArray(data.wifi.known_networks)) throw new Error('网络状态不完整，不能确认当前连接。')
  return data
}
export function wifiValidation(ssid: string, password: string, hotspot = false) {
  if (!ssid.trim() || new TextEncoder().encode(ssid).length > 32 || /[\x00-\x1f\x7f]/.test(ssid)) return '网络名称不能为空，最多 32 字节。'
  if (password.length > 63 || /[\x00-\x1f\x7f]/.test(password) || hotspot && password.length < 8) return hotspot ? '热点密码需要 8–63 位。' : '网络密码格式不正确。'
  return ''
}
export interface InspectionZone { zone_id: string; name: string; aliases: string[]; entity_ids: string[] }
export interface HaValues { enabled: boolean; base_url: string; inspection_zones: InspectionZone[] }
export interface HaEntity { entity_id: string; friendly_name: string; domain: string; available: boolean }
export interface HaDocument { values: HaValues; status: { connected: boolean; token_present: boolean; configured: boolean }; entities: HaEntity[] }
export async function readHa(signal?: AbortSignal): Promise<HaDocument> {
  const data = await networkRequest<{ home_assistant: HaValues & HaDocument['status']; entities: HaEntity[] }>('home-assistant', { signal })
  const h = data.home_assistant
  if (!h || typeof h.enabled !== 'boolean' || typeof h.base_url !== 'string' || !Array.isArray(h.inspection_zones) || !Array.isArray(data.entities)) throw new Error('物联网配置暂不完整，请重新读取。')
  return { values: { enabled: h.enabled, base_url: h.base_url, inspection_zones: h.inspection_zones }, status: { connected: h.connected, token_present: h.token_present, configured: h.configured }, entities: data.entities }
}
export function normalizeZones(zones: InspectionZone[]) {
  return zones.map(zone => ({ ...zone, name: zone.name.trim().replace(/\s+/g, ' '), aliases: [...new Set(zone.aliases.map(alias => alias.trim().replace(/\s+/g, ' ')).filter(alias => alias && alias !== zone.name.trim()))], entity_ids: [...new Set(zone.entity_ids)] }))
}
export function haValidation(values: HaValues, token: string, previous: HaDocument) {
  if (values.enabled || values.base_url) { try { const url = new URL(values.base_url); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return '请填写不含账号、密码或查询参数的 HTTP 服务地址。' } catch { return '请填写有效的 Home Assistant 服务地址。' } }
  if (values.enabled && !previous.status.token_present && !token.trim()) return '首次启用需要访问令牌。'
  if (values.inspection_zones.length > 12) return '最多配置 12 个巡查区域。'
  for (const zone of values.inspection_zones) {
    if (!zone.name.trim() || zone.name.length > 60) return '每个区域需要 1–60 字的名称。'
    if (zone.aliases.length > 12 || zone.aliases.some(alias => alias.length > 40)) return '每个区域最多 12 个别名，每项 40 字以内。'
    if (!zone.entity_ids.length || zone.entity_ids.length > 32) return '每个区域请选择 1–32 台巡查设备。'
  }
  return ''
}
export const equalHa = (a: HaValues, b: HaValues) => JSON.stringify(a) === JSON.stringify(b)
