import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import NetworkSettings from '../features/foundation/NetworkSettings'
import HomeAssistantSettings from '../features/foundation/HomeAssistantSettings'
import StorageSettings from '../features/foundation/StorageSettings'
import { setBaseUrl } from '../api/client'
import { wifiValidation, haValidation, type HaDocument } from '../api/networkSettings'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
function backend() {
  setBaseUrl('http://robot.test:8000')
  let connected = 'known-profile', networks = ['known-profile'], apply = true, fail = '', enabled = false
  const ha = { enabled: true, base_url: 'http://ha.test:8123', inspection_zones: [], configured: true, token_present: true, connected: true }
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.replace('/operator-api/api/v1/', ''), method = init?.method || 'GET', body = init?.body ? JSON.parse(String(init.body)) : {}
    if (path === fail) return Response.json({ ok: false }, { status: 503 })
    if (path === 'network/wifi') return Response.json({ wifi: { mode: 'wlan', connected_network: connected, known_networks: networks }, field_network: {} })
    if (path === 'network/wifi/scan') return Response.json({ networks: ['new-wifi'] })
    if (path === 'network/wifi/connect') { if (apply) connected = body.ssid; return Response.json({ ok: true }) }
    if (path.startsWith('network/wifi/') && method === 'DELETE') { if (apply) networks = []; return Response.json({ ok: true }) }
    if (path === 'home-assistant') { if (method === 'PATCH' && apply) Object.assign(ha, body); return Response.json({ home_assistant: ha, entities: [{ entity_id: 'light.test', friendly_name: '测试灯', available: true }] }) }
    if (path === 'home-assistant/probe') return Response.json({ ok: true })
    if (path === 'app_autostart') { if (method === 'POST' && apply) enabled = body.enabled; return Response.json({ enabled }) }
    if (path === 'demo-readiness') return Response.json({ disk: { free_bytes: 2 * 1024 ** 3, target_gib: 5, hard_floor_gib: 3 }, unrelated: { private: 'must-not-render' } })
    return Response.json({ ok: false }, { status: 404 })
  })
  vi.stubGlobal('fetch', fetch)
  return { fetch, noApply: () => { apply = false }, fail: (path: string) => { fail = path } }
}
const show = (component: React.ReactNode) => render(<MemoryRouter>{component}</MemoryRouter>)
const writes = (api: ReturnType<typeof backend>) => api.fetch.mock.calls.filter(call => call[1]?.method)
describe('原 Client 网络与存储', () => {
  it('物联网深链接只打开物联网，不扫描或加载 Wi-Fi', async () => {
    const api = backend()
    render(<MemoryRouter initialEntries={['/dashboard/foundation/network?tab=iot']}><NetworkSettings/></MemoryRouter>)
    await screen.findByLabelText('服务地址')
    expect(screen.getByRole('button', { name: '物联网' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('link', { name: '配置场景内设备范围 →' })).toHaveAttribute('href', '/dashboard/scenes?capability=office_iot')
    expect(api.fetch.mock.calls.every(call => call[0].endsWith('home-assistant'))).toBe(true)
    expect(writes(api)).toHaveLength(0)
  })
  it('进页只读取网络，不扫描、连接或操作设备；其他组按需读取', async () => {
    const api = backend(); show(<NetworkSettings/>); await screen.findByText('当前连接配置：known-profile')
    expect(writes(api)).toHaveLength(0)
    expect(api.fetch.mock.calls.every(call => call[0].endsWith('network/wifi'))).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '物联网' })); await screen.findByLabelText('服务地址')
    expect(writes(api)).toHaveLength(0)
  })
  it('组间切换保留草稿，不反复确认或自动保存', async () => {
    const api = backend(); show(<NetworkSettings/>); await screen.findByLabelText('网络名称')
    fireEvent.change(screen.getByLabelText('网络名称'), { target: { value: 'draft-name' } })
    fireEvent.click(screen.getByRole('button', { name: '物联网' })); await screen.findByLabelText('服务地址')
    fireEvent.click(screen.getByRole('button', { name: 'Wi-Fi 与外带' }))
    expect(screen.getByLabelText('网络名称')).toHaveValue('draft-name'); expect(writes(api)).toHaveLength(0)
  })
  it('切网确认后只提交一次并回读，不碰其他网络服务', async () => {
    const api = backend(); vi.spyOn(window, 'confirm').mockReturnValue(true); show(<NetworkSettings/>); await screen.findByLabelText('网络名称')
    fireEvent.click(screen.getByText('连接或更换 Wi-Fi')); fireEvent.change(screen.getByLabelText('网络名称'), { target: { value: 'new-wifi' } })
    fireEvent.click(screen.getByRole('button', { name: '连接网络' }))
    expect(await screen.findByText('已回读确认当前连接。')).toBeInTheDocument()
    expect(writes(api)).toHaveLength(1)
    expect(JSON.parse(String(writes(api)[0][1]?.body))).toEqual({ ssid: 'new-wifi', password: '' })
  })
  it('服务器接受但未切换，不报成功且阻止自动重发', async () => {
    const api = backend(); api.noApply(); vi.spyOn(window, 'confirm').mockReturnValue(true); show(<NetworkSettings/>); await screen.findByLabelText('网络名称')
    fireEvent.click(screen.getByText('连接或更换 Wi-Fi')); fireEvent.change(screen.getByLabelText('网络名称'), { target: { value: 'new-wifi' } })
    fireEvent.click(screen.getByRole('button', { name: '连接网络' })); await screen.findByText(/请求已提交，尚未确认/)
    expect(screen.getByRole('button', { name: '连接网络' })).toBeDisabled(); expect(writes(api)).toHaveLength(1)
  })
  it('提交时断连是未确认，不谎报热点自动恢复', async () => {
    const api = backend(); api.fail('network/wifi/connect'); vi.spyOn(window, 'confirm').mockReturnValue(true); show(<NetworkSettings/>); await screen.findByLabelText('网络名称')
    fireEvent.click(screen.getByText('连接或更换 Wi-Fi')); fireEvent.change(screen.getByLabelText('网络名称'), { target: { value: 'new-wifi' } })
    fireEvent.click(screen.getByRole('button', { name: '连接网络' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('切网可能已生效')
    expect(screen.queryByText(/热点将自动恢复/)).not.toBeInTheDocument()
  })
  it('物联网停用保存不清除令牌、实体白名单或巡查区域', async () => {
    const api = backend(); show(<HomeAssistantSettings/>); await screen.findByLabelText('启用物联网服务')
    fireEvent.click(screen.getByLabelText('启用物联网服务')); fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('配置已保存并回读；连接状态单独核验。')).toBeInTheDocument()
    expect(JSON.parse(String(writes(api)[0][1]?.body))).toEqual({ enabled: false, base_url: 'http://ha.test:8123' })
  })
  it('配置未实际保存不报成功', async () => {
    const api = backend(); api.noApply(); show(<HomeAssistantSettings/>); await screen.findByLabelText('启用物联网服务')
    fireEvent.click(screen.getByLabelText('启用物联网服务')); fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('不一致')
  })
  it('开机启动独立读写并回读', async () => {
    const api = backend(); show(<NetworkSettings/>); fireEvent.click(screen.getByRole('button', { name: '开机启动' }))
    fireEvent.click(await screen.findByLabelText('开机后自动启动 App')); fireEvent.click(within(screen.getByRole('region', { name: '开机启动' })).getByRole('button', { name: '保存' }))
    await screen.findByText('已保存并回读。'); expect(writes(api)).toHaveLength(1); expect(writes(api)[0][0]).toContain('app_autostart')
  })
  it('磁盘显示实际余量，不展开整份诊断或静默清理', async () => {
    const api = backend(); show(<StorageSettings/>); expect(await screen.findByText('2.00 GiB')).toBeInTheDocument()
    expect(screen.getByText('空间不足')).toBeInTheDocument(); expect(screen.queryByText('must-not-render')).not.toBeInTheDocument(); expect(writes(api)).toHaveLength(0)
  })
  it('未连接时不使用预览网络与存储值', async () => {
    const api = backend(); show(<><NetworkSettings simulated/><StorageSettings simulated/></>)
    await waitFor(() => expect(api.fetch).not.toHaveBeenCalled())
  })
  it('输入边界明确，不接受凭据在URL或空区域', () => {
    expect(wifiValidation('很长的网络名称'.repeat(5), '')).not.toBe('')
    expect(wifiValidation('hotspot', 'short', true)).not.toBe('')
    const doc: HaDocument = { values: { enabled: true, base_url: 'http://user:secret@host', inspection_zones: [] }, entities: [], status: { connected: true, token_present: true, configured: true } }
    expect(haValidation(doc.values, '', doc)).toContain('不含账号')
  })
  it('巡查区域可新增和删除，未保存不会操作真实设备', async () => {
    const api = backend(); show(<HomeAssistantSettings/>); await screen.findByLabelText('启用物联网服务')
    fireEvent.click(screen.getByText('巡查区域 · 0')); fireEvent.click(screen.getByRole('button', { name: '添加巡查区域' }))
    fireEvent.click(screen.getByText('新区域 · 0 台设备'))
    fireEvent.change(screen.getByLabelText('区域 1 名称'), { target: { value: '测试区域' } })
    fireEvent.change(screen.getByLabelText('区域 1 添加设备'), { target: { value: 'light.test' } })
    expect(writes(api)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText('配置已保存并回读；连接状态单独核验。')
    const body = JSON.parse(String(writes(api)[0][1]?.body))
    expect(body.inspection_zones[0].entity_ids).toEqual(['light.test']); expect(body).not.toHaveProperty('allowed_entity_ids')
    fireEvent.click(screen.getByRole('button', { name: '删除区域' })); fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(writes(api)).toHaveLength(2))
    expect(JSON.parse(String(writes(api)[1][1]?.body)).inspection_zones).toEqual([])
  })
})
