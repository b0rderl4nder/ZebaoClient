import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CapabilityCatalog from '../features/foundation/CapabilityCatalog'
import QuietSettings from '../features/foundation/QuietSettings'
import MemorySettings from '../features/foundation/MemorySettings'
import { setBaseUrl } from '../api/client'
import { capabilityDestination, sceneCapabilityPath, setCapabilityEnabled, type CatalogItem } from '../api/capabilityCatalog'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
function backend() {
  setBaseUrl('http://robot.test:8000')
  let apply = true, fail = '', quiet = { active: false, until: 0, remaining_seconds: 0 }
  let facts = [{ id: 'fact-1', text: '测试记忆', createdAt: '' }]
  const catalog = { global_enabled: ['unrelated'], deleted_catalog: [] as CatalogItem[], scenes: [{ id: 'test', name: '测试场景', capabilities: ['tool'] }], catalog: [
    { id: 'tool', name: '可配置能力', scope: 'global', product_layer: 'capability', locked: false, deletable: true, description: '真实提供的能力' },
    { id: 'speaker_tracking', name: '听声转向', scope: 'global', product_layer: 'capability', locked: true, deletable: false },
    { id: 'living_idle', name: '待机呼吸', scope: 'scene', product_layer: 'foundation', runtime_control: 'idle_breathing', runtime_state: { enabled: false, configured_enabled: false }, locked: false, deletable: false },
    { id: 'business', name: '场景业务', scope: 'scene', product_layer: 'capability', locked: false, deletable: true },
    { id: 'model', name: '模型内部实现', scope: 'global', product_layer: 'infrastructure', locked: true, deletable: false },
  ] as CatalogItem[] }
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.replace('/operator-api/api/v1', ''), method = init?.method || 'GET', body = init?.body ? JSON.parse(String(init.body)) : {}
    if (path === fail) return Response.json({ ok: false }, { status: 503 })
    if (path === '/scenes/global' && method === 'PATCH' && apply) catalog.global_enabled = body.capabilities
    if (path === '/capabilities/tool' && method === 'DELETE' && apply) { catalog.deleted_catalog = catalog.catalog.filter(item => item.id === 'tool'); catalog.catalog = catalog.catalog.filter(item => item.id !== 'tool') }
    if (path === '/capabilities/tool/restore' && apply) { catalog.catalog.push(...catalog.deleted_catalog); catalog.deleted_catalog = [] }
    if (path === '/quiet-mode') {
      if (method === 'PATCH' && apply) quiet = { active: true, until: Date.now() / 1000 + body.duration_minutes * 60, remaining_seconds: body.duration_minutes * 60 }
      if (method === 'DELETE' && apply) quiet = { active: false, until: 0, remaining_seconds: 0 }
      return Response.json(quiet)
    }
    if (path.startsWith('/memory')) { if (method === 'DELETE' && apply) facts = []; return Response.json({ ok: true, facts }) }
    return Response.json(catalog)
  })
  vi.stubGlobal('fetch', fetch)
  return { fetch, catalog, noApply: () => { apply = false }, fail: (path: string) => { fail = path } }
}
const show = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>)
const writes = (api: ReturnType<typeof backend>) => api.fetch.mock.calls.filter(call => call[1]?.method)
describe('原 Client 能力、静默与记忆', () => {
  it('提供方设置进入原 Client，诊断不冒充可编辑配置', () => {
    const item = { id: 'test', name: '测试' } as CatalogItem
    expect(capabilityDestination({ ...item, settings_route: '#/settings?section=section-home-assistant' })).toEqual({ path: '/dashboard/foundation/network?tab=iot', label: '物联网连接设置' })
    expect(capabilityDestination({ ...item, settings_route: '#/pipeline' })?.label).toBe('查看执行诊断')
    expect(capabilityDestination({ ...item, settings_route: 'https://unknown.test' })).toBeUndefined()
    expect(sceneCapabilityPath('scene&one', 'tool/one')).toBe('/dashboard/scenes?id=scene%26one&capability=tool%2Fone')
  })
  it('能力场景入口携带实际场景与能力，不跳旧后台或自动挂载', async () => {
    const api = backend(); api.catalog.scenes.push({ id: 'second', name: '第二场景', capabilities: ['business'] })
    show(<CapabilityCatalog/>); await screen.findByText('可配置能力')
    fireEvent.click(screen.getByRole('button', { name: '场景能力' })); fireEvent.click(screen.getByText('场景业务'))
    expect(screen.getByRole('link', { name: /测试场景.*未挂载/ })).toHaveAttribute('href', '/dashboard/scenes?id=test&capability=business')
    expect(screen.getByRole('link', { name: /第二场景.*已挂载/ })).toHaveAttribute('href', '/dashboard/scenes?id=second&capability=business')
    expect(screen.getAllByRole('link').every(link => !link.hasAttribute('target'))).toBe(true)
    expect(writes(api)).toHaveLength(0)
  })
  it('模拟模式下三种页面均不请求机器人', () => {
    const api = backend(); show(<><CapabilityCatalog simulated/><QuietSettings simulated/><MemorySettings simulated/></>)
    expect(api.fetch).not.toHaveBeenCalled()
  })
  it('目录来自 App，基础项不冒充运行中，不展示模型实现', async () => {
    const api = backend(); show(<CapabilityCatalog/>); await screen.findByText('可配置能力')
    expect(screen.queryByText('模型内部实现')).not.toBeInTheDocument()
    expect(screen.queryByText('场景业务')).not.toBeInTheDocument()
    expect(screen.getByText('待机呼吸').closest('details')).toHaveTextContent('设备已关闭')
    expect(screen.getByRole('link', { name: '配置听声转向 →' })).toHaveAttribute('href', '/dashboard/foundation/motion')
    expect(writes(api)).toHaveLength(0)
  })
  it('总开关保存不丢未显示项，不自动切换场景', async () => {
    const api = backend(); show(<CapabilityCatalog/>); await screen.findByText('可配置能力'); fireEvent.click(screen.getByText('可配置能力'))
    fireEvent.click(screen.getByRole('checkbox', { name: '允许使用可配置能力' }))
    await screen.findByText('总开关已保存并回读')
    expect(JSON.parse(String(writes(api)[0][1]?.body)).capabilities).toEqual(['unrelated', 'tool'])
    expect(writes(api)).toHaveLength(1)
  })
  it('其他页面改动总开关后拒绝覆盖', async () => {
    const api = backend(); const baseline = structuredClone(api.catalog); api.catalog.global_enabled.push('new')
    await expect(setCapabilityEnabled('tool', true, baseline)).rejects.toThrow('其他页面修改')
    expect(writes(api)).toHaveLength(0)
  })
  it('总开关未回读一致不提示成功', async () => {
    const api = backend(); api.noApply(); show(<CapabilityCatalog/>); await screen.findByText('可配置能力'); fireEvent.click(screen.getByText('可配置能力'))
    fireEvent.click(screen.getByRole('checkbox', { name: '允许使用可配置能力' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('未回读一致')
  })
  it('能力删除和恢复均确认、回读，取消不执行', async () => {
    const api = backend(); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    show(<CapabilityCatalog/>); await screen.findByText('可配置能力'); fireEvent.click(screen.getByText('可配置能力'))
    fireEvent.click(screen.getByRole('button', { name: '删除能力' })); expect(writes(api)).toHaveLength(0)
    confirm.mockReturnValue(true); fireEvent.click(screen.getByRole('button', { name: '删除能力' }))
    await screen.findByText('已删除并回读，可从已删除目录恢复。')
    fireEvent.click(screen.getByRole('button', { name: '已删除' })); fireEvent.click(screen.getByText('可配置能力'))
    fireEvent.click(screen.getByRole('button', { name: '恢复能力' }))
    await screen.findByText('已恢复并回读，请检查场景挂载。'); expect(writes(api)).toHaveLength(2)
  })
  it('读取失败有错误重试，模拟模式不读真实配置', async () => {
    const api = backend(); api.fail('/ui/scenes'); show(<CapabilityCatalog/>); await screen.findByRole('alert')
    expect(writes(api)).toHaveLength(0)
  })
  it('静默只有明确点击确认才生效，并能结束', async () => {
    const api = backend(); vi.spyOn(window, 'confirm').mockReturnValue(true); show(<QuietSettings/>); await screen.findByText('未开启')
    expect(writes(api)).toHaveLength(0); fireEvent.click(screen.getByRole('button', { name: '开始静默' }))
    await screen.findByText('静默已生效并回读'); expect(writes(api)[0][1]?.body).toBe('{"duration_minutes":120}')
    fireEvent.click(screen.getByRole('button', { name: '结束静默' })); await screen.findByText('静默已结束并回读')
  })
  it('静默验证拒绝无效时长和未真实生效的请求', async () => {
    const api = backend(); vi.spyOn(window, 'confirm').mockReturnValue(true); show(<QuietSettings/>); await screen.findByText('未开启')
    fireEvent.change(screen.getByLabelText('静默时长（分钟）'), { target: { value: '0' } }); fireEvent.click(screen.getByRole('button', { name: '开始静默' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('1–1440'); expect(writes(api)).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('静默时长（分钟）'), { target: { value: '10' } }); api.noApply(); fireEvent.click(screen.getByRole('button', { name: '开始静默' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('尚未回读确认'))
  })
  it('记忆显式删除并回读，不在浏览器存储正文', async () => {
    const api = backend(); vi.spyOn(window, 'confirm').mockReturnValue(true); const storage = vi.spyOn(Storage.prototype, 'setItem')
    show(<MemorySettings/>); await screen.findByText('测试记忆'); expect(writes(api)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '删除记忆 1' })); await screen.findByText('已删除并回读确认')
    expect(screen.getByText('还没有保存的记忆')).toBeInTheDocument(); expect(storage).not.toHaveBeenCalled()
  })
  it('记忆未被删除时保留内容和错误', async () => {
    const api = backend(); api.noApply(); vi.spyOn(window, 'confirm').mockReturnValue(true); show(<MemorySettings/>); await screen.findByText('测试记忆')
    fireEvent.click(screen.getByRole('button', { name: '清空全部' })); expect(await screen.findByRole('alert')).toHaveTextContent('仍在列表中')
    expect(screen.getByText('测试记忆')).toBeInTheDocument()
  })
})
