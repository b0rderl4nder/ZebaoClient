import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PromptSettings from '../features/foundation/PromptSettings'
import Foundation from '../features/foundation/Foundation'
import { changePrompt, type PromptDocument, type PromptSlot } from '../api/prompts'
import { setBaseUrl } from '../api/client'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
function backend() {
  setBaseUrl('http://robot.test:8000')
  const slot: PromptSlot = { id: 'conversation.aliyun_native_omni', name: '云端原生对话', category: '对话', description: '用于原生链路，不改变场景。', editable: true, max_chars: 800, apply_mode: 'hot_reconnect', variables: ['context'], used_by: ['原生会话'], default_text: '默认内容 {context}', effective_text: '默认内容 {context}', active_variant_id: 'default', variants: [{ id: 'custom-old', name: '保留版', text: '保留内容 {context}' }] }
  const data: PromptDocument = { persistent: true, slots: [slot, { ...structuredClone(slot), id: 'platform.dialogue', name: '平台托管', category: '平台', editable: false }] }
  let apply = true, failure = false, returnedError = ''
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.replace('/operator-api/api/v1/prompts', ''), method = init?.method || 'GET'
    if (failure || method !== 'GET' && returnedError) return Response.json({ ok: false, error: returnedError }, { status: 400 })
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    if (method === 'GET') return Response.json({ ok: true, ...data })
    let variant
    if (method === 'POST' && path.endsWith('/variants')) {
      variant = { id: 'custom-new', name: body.name, text: body.text }
      if (apply) { slot.variants.push(variant); if (body.activate) slot.active_variant_id = variant.id }
    } else if (method === 'PUT') {
      const id = path.split('/').slice(-1)[0]
      variant = { id, name: body.name, text: body.text }
      if (apply) slot.variants = slot.variants.map(item => item.id === id ? variant! : item)
    } else if (apply && method === 'POST' && path.endsWith('/activate')) slot.active_variant_id = body.variant_id
    else if (apply && method === 'DELETE') { const id = path.split('/').slice(-1)[0]; slot.variants = slot.variants.filter(item => item.id !== id); if (slot.active_variant_id === id) slot.active_variant_id = 'default' }
    slot.effective_text = slot.active_variant_id === 'default' ? slot.default_text : slot.variants.find(item => item.id === slot.active_variant_id)!.text
    return Response.json({ ok: true, variant, prompts: data })
  })
  vi.stubGlobal('fetch', fetch)
  return { fetch, data, slot, noApply: () => { apply = false }, offline: () => { failure = true }, reject: (code: string) => { returnedError = code } }
}
const show = (query = '') => render(<MemoryRouter initialEntries={[`/dashboard/foundation/prompts${query}`]}><PromptSettings/></MemoryRouter>)
const writes = (api: ReturnType<typeof backend>) => api.fetch.mock.calls.filter(call => call[1]?.method)
const choose = async () => { fireEvent.click(await screen.findByRole('button', { name: '云端原生对话 默认' })) }
describe('原 Client 提示词版本管理', () => {
  it('工程提示词入口留在 Client，进入只读，按用途筛选', async () => {
    const api = backend(); const foundation = render(<MemoryRouter><Foundation/></MemoryRouter>)
    expect(screen.getByRole('link', { name: /提示词/ })).toHaveAttribute('href', '/dashboard/foundation/prompts')
    foundation.unmount(); show(); await choose()
    expect(screen.getByText('默认内容 {context}')).toBeInTheDocument()
    expect(writes(api)).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('提示词分类'), { target: { value: '平台' } })
    expect(screen.queryByRole('button', { name: '云端原生对话 默认' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '平台托管 只读' }))
    expect(screen.queryByRole('button', { name: '新增版本' })).not.toBeInTheDocument()
  })
  it('链路深链接定位对应用途，不自行推断活动链路', async () => {
    backend(); show('?slot=conversation.aliyun_native_omni')
    expect(await screen.findByRole('heading', { name: '云端原生对话' })).toBeInTheDocument()
    expect(screen.getByLabelText('查看版本')).toHaveValue('default')
  })
  it('复制为新版本不自动启用，不改场景、能力或其他用途', async () => {
    const api = backend(); show(); await choose()
    fireEvent.click(screen.getByRole('button', { name: '复制此版本' }))
    fireEvent.change(screen.getByLabelText('版本名称'), { target: { value: '销售版' } })
    fireEvent.click(screen.getByRole('button', { name: '保存版本' }))
    expect(await screen.findByText('新版本已保存，尚未启用。')).toBeInTheDocument()
    expect(JSON.parse(String(writes(api)[0][1]?.body))).toEqual({ name: '销售版', text: '默认内容 {context}', activate: false })
    expect(writes(api)).toHaveLength(1); expect(api.slot.active_variant_id).toBe('default')
    expect(api.data.slots[1].variants).toHaveLength(1)
  })
  it('启用和恢复默认均确认并回读有效内容', async () => {
    const api = backend(); show(); await choose()
    fireEvent.change(screen.getByLabelText('查看版本'), { target: { value: 'custom-old' } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: '启用此版本' })); expect(writes(api)).toHaveLength(0)
    confirm.mockReturnValue(true); fireEvent.click(screen.getByRole('button', { name: '启用此版本' }))
    await screen.findByText('配置已回读；连接刷新后使用。')
    expect(api.slot.active_variant_id).toBe('custom-old')
    fireEvent.change(screen.getByLabelText('查看版本'), { target: { value: 'default' } })
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }))
    await waitFor(() => expect(api.slot.active_variant_id).toBe('default'))
  })
  it('编辑启用版本需要确认，默认不可覆盖或删除', async () => {
    const api = backend(); show(); await choose()
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除版本' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('查看版本'), { target: { value: 'custom-old' } })
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByLabelText('提示词内容'), { target: { value: '新内容 {context}' } })
    fireEvent.click(screen.getByRole('button', { name: '保存版本' }))
    await screen.findByText('版本变更已回读确认。')
    expect(writes(api)[0][1]?.method).toBe('PUT')
    expect(api.slot.variants[0].text).toBe('新内容 {context}')
  })
  it('删除启用版本恢复默认，取消删除不发请求', async () => {
    const api = backend(); api.slot.active_variant_id = 'custom-old'; api.slot.effective_text = api.slot.variants[0].text
    show('?slot=conversation.aliyun_native_omni'); await screen.findByRole('button', { name: '删除版本' })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: '删除版本' })); expect(writes(api)).toHaveLength(0)
    confirm.mockReturnValue(true); fireEvent.click(screen.getByRole('button', { name: '删除版本' }))
    await screen.findByText('版本变更已回读确认。')
    expect(api.slot.active_variant_id).toBe('default'); expect(api.slot.variants).toHaveLength(0)
  })
  it('编辑当前启用版取消不写入，确认后更新有效正文', async () => {
    const api = backend(); api.slot.active_variant_id = 'custom-old'; api.slot.effective_text = api.slot.variants[0].text
    show('?slot=conversation.aliyun_native_omni'); fireEvent.click(await screen.findByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByLabelText('提示词内容'), { target: { value: '已编辑内容 {context}' } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: '保存版本' })); expect(writes(api)).toHaveLength(0)
    confirm.mockReturnValue(true); fireEvent.click(screen.getByRole('button', { name: '保存版本' }))
    await screen.findByText('配置已回读；连接刷新后使用。')
    expect(api.slot.effective_text).toBe('已编辑内容 {context}'); expect(api.slot.active_variant_id).toBe('custom-old')
  })
  it('外部修改被检出，不覆盖新状态，保留用户草稿', async () => {
    const api = backend(); show(); await choose()
    fireEvent.click(screen.getByRole('button', { name: '复制此版本' }))
    api.slot.default_text = '外部已修改'
    fireEvent.click(screen.getByRole('button', { name: '保存版本' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('已在其他页面修改')
    expect(screen.getByLabelText('提示词内容')).toHaveValue('默认内容 {context}')
    expect(writes(api)).toHaveLength(0)
  })
  it('服务成功但无真实变更不伪报保存', async () => {
    const api = backend(); api.noApply(); show(); await choose()
    fireEvent.click(screen.getByRole('button', { name: '复制此版本' }))
    fireEvent.click(screen.getByRole('button', { name: '保存版本' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('尚未回读一致')
    expect(screen.queryByText('新版本已保存，尚未启用。')).not.toBeInTheDocument()
  })
  it('缺失变量显示中文原因；无持久存储不声称永久保存', async () => {
    const api = backend(); api.reject('prompt_variable_missing'); show(); await choose()
    fireEvent.click(screen.getByRole('button', { name: '复制此版本' })); fireEvent.click(screen.getByRole('button', { name: '保存版本' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('缺少必要模板变量')
    api.reject(''); api.data.persistent = false
    fireEvent.click(screen.getByRole('button', { name: '保存版本' }))
    expect(await screen.findByText(/重启可能丢失/)).toBeInTheDocument()
  })
  it('脏草稿切换用途可取消；不缓存提示词正文', async () => {
    backend(); const storage = vi.spyOn(Storage.prototype, 'setItem'); show(); await choose()
    fireEvent.click(screen.getByRole('button', { name: '复制此版本' }))
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: '平台托管 只读' }))
    expect(screen.getByLabelText('提示词内容')).toBeInTheDocument(); expect(storage).not.toHaveBeenCalled()
  })
  it('只读用途 API 保护与空内容校验，不发写入', async () => {
    const api = backend()
    await expect(changePrompt(structuredClone(api.data.slots[1]), { kind: 'activate', id: 'default' })).rejects.toThrow('只能查看')
    await expect(changePrompt(structuredClone(api.slot), { kind: 'create', name: '草稿', text: '' })).rejects.toThrow('不能为空')
    expect(writes(api)).toHaveLength(0)
  })
  it('离线可重试；模拟模式不请求真实设备', async () => {
    const api = backend(); api.offline(); const view = show(); expect(await screen.findByRole('alert')).toHaveTextContent('无法读取')
    expect(screen.getByRole('button', { name: '重试读取' })).toBeEnabled()
    view.unmount(); api.fetch.mockClear(); render(<MemoryRouter><PromptSettings simulated/></MemoryRouter>); expect(api.fetch).not.toHaveBeenCalled()
  })
})
