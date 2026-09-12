import { operatorRequest } from './operator'

export interface PromptVariant { id: string; name: string; text: string; updated_at?: number }
export interface PromptSlot {
  id: string; name: string; category: string; description: string; editable: boolean
  used_by: string[]; variables: string[]; max_chars: number; apply_mode: string
  default_text: string; active_variant_id: string; effective_text: string; variants: PromptVariant[]
}
export interface PromptDocument { persistent: boolean; slots: PromptSlot[] }
const request = <T>(path = '', init: RequestInit = {}) => operatorRequest<T>(`/api/v1/prompts${path}`, init, true)
export async function readPrompts(signal?: AbortSignal): Promise<PromptDocument> {
  const data = await request<PromptDocument>('', { signal })
  if (typeof data.persistent !== 'boolean' || !Array.isArray(data.slots) || data.slots.some(slot =>
    typeof slot.id !== 'string' || typeof slot.name !== 'string' || typeof slot.editable !== 'boolean' ||
    typeof slot.default_text !== 'string' || typeof slot.effective_text !== 'string' || typeof slot.active_variant_id !== 'string' ||
    !Number.isInteger(slot.max_chars) || slot.max_chars < 1 || !Array.isArray(slot.variants) || !Array.isArray(slot.variables) || !Array.isArray(slot.used_by) ||
    slot.variants.some(item => typeof item.id !== 'string' || typeof item.text !== 'string' || typeof item.name !== 'string')
  )) throw new Error('提示词目录不完整，请重新读取。')
  return data
}
export type PromptChange = { kind: 'create' | 'update'; id?: string; name: string; text: string } | { kind: 'activate' | 'delete'; id: string }
const fingerprint = (slot: PromptSlot) => JSON.stringify([slot.editable, slot.max_chars, slot.variables, slot.default_text, slot.active_variant_id, slot.effective_text, slot.variants])
const normalizedName = (name: string) => name.trim().replace(/\s+/g, ' ')
/** Preflight detects observed conflicts; server has no atomic compare-and-swap contract. */
export async function changePrompt(baseline: PromptSlot, change: PromptChange): Promise<PromptDocument> {
  const before = await readPrompts()
  const current = before.slots.find(slot => slot.id === baseline.id)
  if (!current || fingerprint(current) !== fingerprint(baseline)) throw new Error('此用途的提示词已在其他页面修改，请重新读取后再操作。')
  if (!current.editable) throw new Error('此提示词由外部服务管理，只能查看。')
  const base = `/${encodeURIComponent(current.id)}`
  let createdId = ''
  if (change.kind === 'create' || change.kind === 'update') {
    const text = change.text.trim(), name = normalizedName(change.name)
    if (!name || name.length > 48) throw new Error('版本名称请填写 1–48 个字符。')
    if (!text || [...text].length > current.max_chars) throw new Error(`内容不能为空，最多 ${current.max_chars} 字。`)
    if (change.kind === 'update' && (!change.id || change.id === 'default' || !current.variants.some(item => item.id === change.id))) throw new Error('默认版本不能覆盖，请先复制为新版本。')
    const result = await request<{ variant?: { id?: string } }>(`${base}/variants${change.kind === 'update' ? `/${encodeURIComponent(change.id!)}` : ''}`, {
      method: change.kind === 'create' ? 'POST' : 'PUT', body: JSON.stringify({ name, text, activate: false }),
    })
    createdId = result.variant?.id || ''
    if (!createdId) throw new Error('请求已提交，但未取得版本凭据。请重新读取，勿重复新增。')
  } else {
    if (change.id !== 'default' && !current.variants.some(item => item.id === change.id)) throw new Error('此版本已不存在，请重新读取。')
    if (change.kind === 'delete' && change.id === 'default') throw new Error('默认版本不能删除。')
    await request(change.kind === 'delete' ? `${base}/variants/${encodeURIComponent(change.id)}` : `${base}/activate`, change.kind === 'delete' ? { method: 'DELETE' } : { method: 'POST', body: JSON.stringify({ variant_id: change.id }) })
  }
  const after = await readPrompts(), confirmed = after.slots.find(slot => slot.id === current.id)
  if (!confirmed) throw new Error('保存后未能确认提示词，请重新读取。')
  if (change.kind === 'create' || change.kind === 'update') {
    const variant = confirmed.variants.find(item => item.id === createdId)
    const expectedActive = current.active_variant_id
    if (!variant || variant.name !== normalizedName(change.name) || variant.text !== change.text.trim() || confirmed.active_variant_id !== expectedActive || (change.kind === 'update' && createdId !== change.id)) throw new Error('版本内容或启用状态尚未回读一致，请重新读取，勿重复提交。')
  } else if (change.kind === 'activate') {
    const expected = change.id === 'default' ? confirmed.default_text : confirmed.variants.find(item => item.id === change.id)?.text
    if (confirmed.active_variant_id !== change.id || confirmed.effective_text !== expected) throw new Error('启用状态尚未回读一致，请重新读取。')
  } else if (confirmed.variants.some(item => item.id === change.id) || confirmed.active_variant_id !== (current.active_variant_id === change.id ? 'default' : current.active_variant_id)) throw new Error('删除状态尚未回读一致，请重新读取。')
  const effective = confirmed.active_variant_id === 'default' ? confirmed.default_text : confirmed.variants.find(item => item.id === confirmed.active_variant_id)?.text
  if (confirmed.effective_text !== effective) throw new Error('有效提示词尚未回读一致，请重新读取。')
  return after
}
export function promptApplyLabel(mode: string): string {
  return ({ next_request: '下次请求使用', hot_reconnect: '连接刷新后使用', next_startup: '下次启动使用', next_connection: '下次连接使用', platform_managed: '由平台管理' } as Record<string, string>)[mode] || '生效时机由服务决定'
}
