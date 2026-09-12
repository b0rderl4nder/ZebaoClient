import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import VoiceSettings from '../features/foundation/VoiceSettings'
import Foundation from '../features/foundation/Foundation'
import { voiceMountName } from '../api/voiceSettings'
import { setBaseUrl } from '../api/client'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
function backend() {
  setBaseUrl('http://robot.test:8000')
  let shared = 'platform_ws', enabled = true, active = true, persisted = true
  let fail = false
  let voice = 'Tina'
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.replace('/operator-api', '')
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    if (init?.method && fail) return Response.json({ ok: false, error: 'voice_pipeline_busy' }, { status: 409 })
    if (path === '/api/v1/scenes/voice-pipeline') { shared = body.provider; return Response.json({ ok: true }) }
    if (path === '/api/v1/backend_config') { voice = body.aliyun_native_omni_voice || voice; return Response.json({ ok: true }) }
    if (path === '/api/v1/scenes') return Response.json({ ok: true, shared_voice_pipeline_provider: shared })
    if (path.endsWith('/runtime')) return Response.json({ ok: true, state: 'ready', scene: { name: '场景专属' }, voice: { provider: 'aliyun_native_omni', label: '共享语音配置' } })
    if (path.endsWith('/voice-activation')) {
      if ('enabled' in body) enabled = body.enabled
      if (body.action === 'retire') active = false
      return Response.json({ ok: true, enabled, fixed_wake_word: '泽宝', activation: { active, state: active ? 'active' : 'inactive' }, local_kws: { ready: true, settings_persisted: persisted } })
    }
    return Response.json({ ok: true, voice_pipeline_provider: 'aliyun_native_omni', aliyun_native_omni: { configured: true, voice, model: 'server-model' }, provider_mount_catalog: { voice_profiles: [{ id: 'shared', name: '共享语音配置' }, { id: 'aliyun_native_omni', name: '云端 Omni' }, { id: 'platform_ws', name: '平台链路' }] } })
  })
  vi.stubGlobal('fetch', request)
  return { request, fail: () => { fail = true }, notPersisted: () => { persisted = false } }
}
const show = () => render(<MemoryRouter><VoiceSettings/></MemoryRouter>)

describe('Client 内语音配置', () => {
  it('语音入口留在原 Client，不打开第二个管理界面', () => {
    render(<MemoryRouter><Foundation/></MemoryRouter>)
    expect(screen.getByRole('link', { name: /语音与唤醒/ })).toHaveAttribute('href', '/dashboard/foundation/voice')
    expect(screen.getByRole('link', { name: /语音与唤醒/ })).not.toHaveAttribute('target')
  })
  it('明确区分系统默认和场景专属，进入页面零写入', async () => {
    const { request } = backend(); show()
    expect(await screen.findByText('当前默认：平台链路')).toBeInTheDocument()
    expect(screen.getByLabelText('当前语音链路')).toHaveTextContent('云端 Omni')
    expect(screen.getByRole('link', { name: '当前链路提示词 →' })).toHaveAttribute('href', '/dashboard/foundation/prompts?slot=conversation.aliyun_native_omni')
    expect(screen.getByText(/不适用于本地、平台或云端兼容链路/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /平台链路/ })).toHaveAttribute('aria-pressed', 'true')
    expect(request.mock.calls.every(call => !call[1]?.method)).toBe(true)
    expect(screen.queryByText('共享语音配置')).not.toBeInTheDocument()
    expect(voiceMountName('shared', '共享语音配置', 'platform_ws')).toBe('跟随系统 · 平台链路')
    expect(voiceMountName('shared', '共享语音配置')).toBe('跟随系统默认')
  })
  it('选择不立即切换，保存回读默认而不是场景链路', async () => {
    const { request } = backend(); show(); await screen.findByText('当前默认：平台链路')
    fireEvent.click(screen.getByRole('button', { name: /云端 Omni 选择/ }))
    expect(request.mock.calls.every(call => !call[1]?.method)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '保存默认链路' }))
    expect(await screen.findByText('系统默认已保存；场景专属选择保持不变。')).toBeInTheDocument()
    expect(request.mock.calls.filter(call => call[1]?.method === 'PATCH')).toHaveLength(1)
  })
  it('服务拒绝保留草稿、给出原因、不伪报成功', async () => {
    const api = backend(); show(); await screen.findByText('当前默认：平台链路'); api.fail()
    fireEvent.click(screen.getByRole('button', { name: /云端 Omni 选择/ }))
    fireEvent.click(screen.getByRole('button', { name: '保存默认链路' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('机器人正在交谈')
    expect(screen.getByText('尚未保存')).toBeInTheDocument()
    expect(screen.queryByText(/系统默认已保存/)).not.toBeInTheDocument()
  })
  it('修改音色只更新对应连接，空密钥不覆盖，不切换场景或链路', async () => {
    const { request } = backend(); show(); await screen.findByText('当前默认：平台链路')
    fireEvent.click(screen.getByRole('button', { name: '编辑连接与音色' }))
    fireEvent.change(screen.getByLabelText('音色'), { target: { value: 'new-voice' } })
    fireEvent.click(screen.getByRole('button', { name: '保存连接' }))
    expect(await screen.findByText(/连接已保存，空闲时刷新/)).toBeInTheDocument()
    const writes = request.mock.calls.filter(call => call[1]?.method)
    expect(writes).toHaveLength(1)
    expect(JSON.parse(String(writes[0][1]?.body))).toEqual({ backend: 'aliyun_native_omni', aliyun_native_omni_voice: 'new-voice', aliyun_native_omni_model: 'server-model' })
    expect(screen.getByText('当前默认：平台链路')).toBeInTheDocument()
  })
  it('结束会话先确认；开关持久化失败不报成功', async () => {
    const api = backend(); show(); await screen.findByText('当前默认：平台链路')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: '结束实体会话' }))
    expect(api.request.mock.calls.every(call => !call[1]?.method)).toBe(true)
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '结束实体会话' }))
    expect(await screen.findByText('实体会话已结束。')).toBeInTheDocument()
    api.notPersisted()
    fireEvent.click(screen.getByRole('switch', { name: '启用本地唤醒' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('尚未持久保存')
  })
  it('断网可重读，模拟不请求真机', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    const view = show()
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    expect(screen.getByRole('button', { name: '重新读取' })).toBeEnabled()
    view.unmount(); const api = backend()
    render(<MemoryRouter><VoiceSettings simulated/></MemoryRouter>)
    expect(api.request).not.toHaveBeenCalled()
  })
})
