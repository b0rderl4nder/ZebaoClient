import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Scenes from '../features/scenes/Scenes'
import Foundation from '../features/foundation/Foundation'
import { setBaseUrl } from '../api/client'
import { operatorRequest } from '../api/operator'
import type { SceneConfig } from '../api/sceneConfig'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
const initial = (id = 'one'): SceneConfig => ({ id, name: id === 'one' ? '测试接待' : '临时展览', active: id === 'one', built_in: false, description: '', capabilities: ['tool'], settings: { tool: { preserved: true } }, flow_id: 'existing-flow', interaction_policy_id: 'policy', provider_mounts: { voice_profile_id: 'voice', interaction_profile_id: 'policy', knowledge_source_ids: ['book'], display_target_ids: [] } })
function backend() {
  setBaseUrl('http://robot.test:8000')
  let active = 'one'
  const records: Record<string, SceneConfig> = { one: initial(), two: initial('two') }
  let rejectPublish = false
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.replace(/^\/operator-api/, '')
    const id = path.split('/').slice(-1)[0]
    if (init?.method === 'POST' && path.endsWith('/activate')) active = path.split('/').slice(-2)[0]
    if (init?.method === 'PUT') records[id] = { ...records[id], ...JSON.parse(String(init.body)) }
    if (init?.method === 'DELETE') delete records[id]
    if (init?.method === 'POST' && path === '/api/v1/ui/scenes') {
      const body = JSON.parse(String(init.body)); records[body.scene_id] = { ...initial(body.scene_id), name: body.name }
      return Response.json({ ok: true, scene_id: body.scene_id })
    }
    if (path.endsWith('/publish') && rejectPublish) return Response.json({ ok: false }, { status: 500 })
    if (path.endsWith('/runtime')) return Response.json({ ok: true, state: 'ready', scene: { id: active, name: records[active]?.name }, capabilities: [] })
    if (path.startsWith('/api/v1/ui/scenes/') && records[id]) return Response.json({ ok: true, scene: records[id], catalog: [{ id: 'tool', name: '新挂载的能力', scope: 'scene', product_layer: 'capability' }, { id: 'global', name: '全局身份', scope: 'global', product_layer: 'capability' }], interaction_policies: [{ id: 'policy', name: '已有策略' }], provider_mount_catalog: { voice_profiles: [{ id: 'voice', name: '真实语音配置' }], knowledge_sources: [{ id: 'book', name: '展览资料', requires_capability: 'tool' }], display_targets: [] } })
    return Response.json({ ok: true, scenes: Object.values(records).map(scene => ({ ...scene, active: scene.id === active, capability_count: scene.capabilities.length })) })
  })
  vi.stubGlobal('fetch', request)
  return { request, records, failPublish: () => { rejectPublish = true } }
}
const show = () => render(<MemoryRouter><Scenes/></MemoryRouter>)
const ready = () => screen.findByRole('textbox', { name: '场景名称' })

describe('场景原位配置', () => {
  it('直接编辑真实挂载，卸载能力连带移除知识挂载且保留未编辑字段', async () => {
    const { request } = backend(); show(); await ready()
    expect(screen.getByRole('checkbox', { name: '新挂载的能力' })).toBeChecked()
    expect(screen.queryByText('全局身份')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: '新挂载的能力' }))
    fireEvent.click(screen.getByRole('button', { name: '知识与展示' }))
    expect(screen.getByRole('checkbox', { name: /展览资料/ })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /展览资料/ })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('已保存并发布')).toBeInTheDocument()
    const body = JSON.parse(String(request.mock.calls.find(call => call[1]?.method === 'PUT')?.[1]?.body))
    expect(body).toMatchObject({ capabilities: [], flow_id: 'existing-flow', settings: { tool: { preserved: true } }, provider_mounts: { knowledge_source_ids: [] } })
    expect(request.mock.calls.some(call => call[0].endsWith('/activate'))).toBe(false)
  })
  it('选择其他场景不会激活，明确切换后必须回读成功', async () => {
    const { request } = backend(); show(); await ready()
    fireEvent.click(screen.getByRole('button', { name: /临时展览/ }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '场景名称' })).toHaveValue('临时展览'))
    expect(request.mock.calls.some(call => call[1]?.method === 'POST')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '设为当前' }))
    expect(await screen.findByText('已切换')).toBeInTheDocument()
  })
  it('复制在本页创建，调用原有组合接口', async () => {
    const { request } = backend(); show(); await ready()
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    expect(screen.getByRole('textbox', { name: '场景名称' })).toHaveValue('测试接待副本')
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => expect(request.mock.calls.some(call => call[1]?.body?.toString().includes('"mode":"copy"'))).toBe(true))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '场景名称' })).toHaveValue('测试接待副本'))
  })
  it('删除运行场景必须选择替代，取消不发送请求', async () => {
    const { request } = backend(); show(); await ready()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.getByRole('button', { name: '确认删除' })).toBeDisabled()
    fireEvent.change(screen.getByRole('combobox', { name: '替代运行场景' }), { target: { value: 'two' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(request.mock.calls.some(call => call[1]?.method === 'DELETE')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    fireEvent.change(screen.getByRole('combobox', { name: '替代运行场景' }), { target: { value: 'two' } })
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(request.mock.calls.some(call => call[1]?.method === 'DELETE' && call[0].endsWith('?replacement_scene_id=two'))).toBe(true))
  })
  it('发布失败不报成功，外部变更不覆盖', async () => {
    const { records, request } = backend(); show(); await ready()
    fireEvent.change(screen.getByRole('textbox', { name: '场景名称' }), { target: { value: '本地修改' } })
    records.one.description = '其他管理员修改'
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('已在其他页面修改')
    expect(request.mock.calls.some(call => call[1]?.method === 'PUT')).toBe(false)
    expect(screen.getByRole('textbox', { name: '场景名称' })).toHaveValue('本地修改')
  })
  it('发布失败保留草稿和错误，不显示已保存', async () => {
    const api = backend(); show(); await ready(); api.failPublish()
    fireEvent.change(screen.getByRole('textbox', { name: '场景名称' }), { target: { value: '修改名称' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('已保存并发布')).not.toBeInTheDocument()
  })
  it('读取失败有重试，预览不发送配置请求', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    show(); expect(await screen.findByRole('alert')).toHaveTextContent('无法连接机器人应用')
    expect(screen.getByRole('button', { name: '重新读取' })).toBeInTheDocument()
  })
  it('未保存的修改可以阻止选另一个场景', async () => {
    backend(); vi.spyOn(window, 'confirm').mockReturnValue(false); show(); await ready()
    fireEvent.change(screen.getByRole('textbox', { name: '场景名称' }), { target: { value: '保留我' } })
    fireEvent.click(screen.getByRole('button', { name: /临时展览/ }))
    expect(screen.getByRole('textbox', { name: '场景名称' })).toHaveValue('保留我')
  })
  it('基础系统使用可搜索设置行，工程工具默认折叠', () => {
    render(<MemoryRouter><Foundation/></MemoryRouter>)
    expect(screen.getByText('工程工具').closest('details')).not.toHaveAttribute('open')
    fireEvent.change(screen.getByRole('searchbox', { name: '查找设置' }), { target: { value: '呼吸' } })
    expect(screen.getByRole('link', { name: /呼吸与听声转向/ })).toHaveAttribute('href', '/dashboard/foundation/motion')
    expect(screen.queryByText('提示词')).not.toBeInTheDocument()
  })
  it('请求有超时边界', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => { init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))) })))
    const result = expect(operatorRequest('/api/v1/ui/runtime')).rejects.toThrow('连接超时')
    await vi.advanceTimersByTimeAsync(8000); await result
  })
})
