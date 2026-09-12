import { operatorRequest } from './operator'

export type PolicyValue = string | number | boolean
export interface InteractionPolicy { id: string; name: string; built_in: boolean; [key: string]: unknown }
export interface PolicyField {
  key: string; label: string; kind: 'text' | 'select' | 'boolean' | 'number'; advanced?: boolean
  max_length?: number; minimum?: number; maximum?: number; options?: { value: string; label: string }[]
}
export interface PolicyCatalog { policies: InteractionPolicy[]; fields: PolicyField[]; defaults: InteractionPolicy; preserved_fields: string[] }
export async function readPolicyCatalog(signal?: AbortSignal): Promise<PolicyCatalog> {
  const data = await operatorRequest<PolicyCatalog>('/api/v1/ui/interaction-policies', { signal }, true)
  if (!Array.isArray(data.policies) || !data.policies.every(item => item.id && item.name && typeof item.built_in === 'boolean') || !Array.isArray(data.fields) || !data.fields.length || !data.fields.every(field => field.key && field.label && ['text', 'select', 'boolean', 'number'].includes(field.kind) && (field.kind !== 'select' || Array.isArray(field.options))) || !data.defaults || !Array.isArray(data.preserved_fields)) throw new Error('设备未提供完整的策略编辑目录，请更新 App 后重试；已有选择未改动。')
  return data
}
export function policyValues(policy: InteractionPolicy, catalog: PolicyCatalog): Record<string, PolicyValue> {
  const values: Record<string, PolicyValue> = {}
  for (const key of [...catalog.fields.map(field => field.key), ...catalog.preserved_fields]) {
    const value = policy[key]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') values[key] = value
  }
  return values
}
export function policyError(values: Record<string, PolicyValue>, catalog: PolicyCatalog): string {
  for (const field of catalog.fields) {
    const value = values[field.key]
    if (field.kind === 'text' && (typeof value !== 'string' || field.max_length !== undefined && value.length > field.max_length)) return `${field.label}长度或格式不正确。`
    if (field.key === 'name' && !String(value || '').trim()) return '请填写策略名称。'
    if (field.kind === 'select' && !field.options?.some(option => option.value === value)) return `请选择${field.label}。`
    if (field.kind === 'boolean' && typeof value !== 'boolean') return `请确认${field.label}。`
    if (field.kind === 'number' && (typeof value !== 'number' || !Number.isInteger(value) || field.minimum !== undefined && value < field.minimum || field.maximum !== undefined && value > field.maximum)) return `${field.label}必须在 ${field.minimum}–${field.maximum} 范围内。`
  }
  return ''
}
const same = (left: Record<string, PolicyValue>, right: Record<string, PolicyValue>) => JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort())
const path = (id: string) => `/api/v1/interaction-policies/${encodeURIComponent(id)}`
export async function saveInteractionPolicy(id: string, values: Record<string, PolicyValue>, baseline: InteractionPolicy | null): Promise<PolicyCatalog> {
  const latest = await readPolicyCatalog()
  const current = latest.policies.find(item => item.id === id)
  if (baseline ? !current || current.built_in || !same(policyValues(current, latest), policyValues(baseline, latest)) : Boolean(current)) throw new Error('策略已在别处修改或可能已创建，请重新读取，勿重复提交。')
  const normalized = { ...values, name: String(values.name ?? '').trim().replace(/\s+/g, ' '), description: String(values.description ?? '').trim().replace(/\s+/g, ' ') }
  const invalid = policyError(normalized, latest)
  if (invalid) throw new Error(invalid)
  const cleaned = Object.fromEntries(Object.entries(normalized).filter(([key]) => latest.fields.some(field => field.key === key) || latest.preserved_fields.includes(key)))
  await operatorRequest(path(id), { method: 'PUT', body: JSON.stringify(cleaned) }, true)
  const confirmed = await readPolicyCatalog(), result = confirmed.policies.find(item => item.id === id)
  if (!result || !same(policyValues(result, confirmed), cleaned)) throw new Error('策略已提交，但回读未确认；请重新读取，勿重复创建。')
  return confirmed
}
export async function deleteInteractionPolicy(baseline: InteractionPolicy): Promise<PolicyCatalog> {
  const latest = await readPolicyCatalog(), current = latest.policies.find(item => item.id === baseline.id)
  if (!current || current.built_in || !same(policyValues(current, latest), policyValues(baseline, latest))) throw new Error('策略已变化或不可删除，请重新读取。')
  await operatorRequest(path(baseline.id), { method: 'DELETE' }, true)
  const confirmed = await readPolicyCatalog()
  if (confirmed.policies.some(item => item.id === baseline.id)) throw new Error('策略删除未回读确认，请重新读取。')
  return confirmed
}
