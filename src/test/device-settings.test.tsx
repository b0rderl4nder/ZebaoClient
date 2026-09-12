import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SoundSettings from '../features/foundation/SoundSettings'
import MotionSettings from '../features/foundation/MotionSettings'
import VisionSettings from '../features/foundation/VisionSettings'
import Foundation from '../features/foundation/Foundation'
import { setBaseUrl } from '../api/client'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
function backend() {
  setBaseUrl('http://robot.test:8000')
  let volume = 80, gain = 65, breathing = true, fail = '', noApply = false
  let parameters = { turn_gain: 1.5, other: 7 }
  const vision = { enabled: true, proactive_enabled: true, adaptive_cloud_enabled: true, occupied_cloud_interval_seconds: 180, empty_cloud_interval_seconds: 300, max_cloud_calls_per_10m: 6 }
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.replace('/operator-api', '')
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    if (fail && path.endsWith(fail)) return Response.json({ ok: false, error: 'provider_unavailable' }, { status: 503 })
    if (path.endsWith('xvf_microphone_gain')) { if (init?.method && !noApply) gain = body.volume; return Response.json({ gain, minimum: 1, maximum: 90 }) }
    if (path.endsWith('/volume') || path.endsWith('/microphone')) { if (init?.method && !noApply) volume = body.volume; return Response.json({ volume }) }
    if (path.endsWith('/idle_breathing')) { if (init?.method && !noApply) breathing = body.enabled; return Response.json({ configured_enabled: breathing, active: true, available: true }) }
    if (path.endsWith('/sound-localization/settings')) {
      if (init?.method === 'PATCH' && !noApply) parameters = { ...parameters, ...body.values }
      if (init?.method === 'DELETE' && !noApply) parameters = { turn_gain: 1, other: 7 }
      return Response.json({ enabled: true, respond_to_detected_speech: true, values: parameters, fields: [{ key: 'turn_gain', label: '转向增益', minimum: 0.5, maximum: 1.5, step: 0.05, default: 1, help_text: '测试帮助' }] })
    }
    if (path.endsWith('/status')) return Response.json({ office: { ambient_vision: vision } })
    if (path.endsWith('/ambient-vision/settings')) { if (!noApply) Object.assign(vision, body); return Response.json({ ok: true }) }
    if (path.endsWith('/observations')) return Response.json({ observations: [] })
    return Response.json({ ok: false }, { status: 404 })
  })
  vi.stubGlobal('fetch', fetch)
  return { fetch, fail: (path: string) => { fail = path }, ignoreWrites: () => { noApply = true }, changeVolume: () => { volume = 33 } }
}
const show = (component: React.ReactNode) => render(<MemoryRouter>{component}</MemoryRouter>)
const card = (name: string) => within(screen.getByRole('region', { name }))
const writes = (api: ReturnType<typeof backend>) => api.fetch.mock.calls.filter(call => call[1]?.method)

describe('原 Client 设备配置', () => {
  it('三个原入口改为内部配置，不新开旧管理页', () => {
    show(<Foundation/>)
    for (const [name, route] of [['声音', 'sound'], ['呼吸与听声转向', 'motion'], ['视觉', 'vision']]) {
      const link = screen.getByRole('link', { name: new RegExp(name) })
      expect(link).toHaveAttribute('href', `/dashboard/foundation/${route}`)
      expect(link).not.toHaveAttribute('target')
    }
  })
  it('正确读取硬件 gain，不将其当百分比或零；进页无写入', async () => {
    const api = backend(); show(<SoundSettings/>)
    expect(await screen.findByLabelText('麦克风前级增益')).toHaveValue(65)
    expect(screen.getByLabelText('麦克风前级增益')).toHaveAttribute('max', '90')
    expect(card('前级增益').queryByText('%')).not.toBeInTheDocument()
    expect(writes(api)).toHaveLength(0)
  })
  it('保存一个音量只修改原接口并回读，不录音不播放', async () => {
    const api = backend(); show(<SoundSettings/>); await screen.findByLabelText('扬声器音量')
    fireEvent.change(screen.getByLabelText('扬声器音量'), { target: { value: '66' } })
    expect(writes(api)).toHaveLength(0)
    fireEvent.click(card('扬声器').getByRole('button', { name: '保存' }))
    expect(await card('扬声器').findByText('已保存并回读。')).toBeInTheDocument()
    expect(writes(api)).toHaveLength(1)
    expect(writes(api)[0][0]).toContain('/daemon/volume')
    expect(JSON.parse(String(writes(api)[0][1]?.body))).toEqual({ volume: 66 })
  })
  it('并发改值时拒绝覆盖，保留草稿', async () => {
    const api = backend(); show(<SoundSettings/>); await screen.findByLabelText('扬声器音量')
    fireEvent.change(screen.getByLabelText('扬声器音量'), { target: { value: '66' } }); api.changeVolume()
    fireEvent.click(card('扬声器').getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('其他页面修改')
    expect(writes(api)).toHaveLength(0)
    expect(screen.getByLabelText('扬声器音量')).toHaveValue(66)
  })
  it('返回成功但回读不一致，不能伪报已保存', async () => {
    const api = backend(); api.ignoreWrites(); show(<SoundSettings/>); await screen.findByLabelText('扬声器音量')
    fireEvent.change(screen.getByLabelText('扬声器音量'), { target: { value: '66' } }); fireEvent.click(card('扬声器').getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('设备值与请求不一致')
    expect(screen.queryByText('已保存并回读。')).not.toBeInTheDocument()
  })
  it('单个音频接口故障不拖垮其他设置，可重试恢复', async () => {
    const api = backend(); api.fail('xvf_microphone_gain'); show(<SoundSettings/>)
    expect(await screen.findByLabelText('扬声器音量')).toHaveValue(80)
    expect(await card('前级增益').findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByLabelText('麦克风前级增益')).not.toBeInTheDocument()
    api.fail(''); fireEvent.click(card('前级增益').getByRole('button', { name: '重试读取' }))
    expect(await screen.findByLabelText('麦克风前级增益')).toHaveValue(65)
  })
  it('错误数值不提交，按设备实际边界校验', async () => {
    const api = backend(); show(<SoundSettings/>); await screen.findByLabelText('麦克风前级增益')
    fireEvent.change(screen.getByLabelText('麦克风前级增益'), { target: { value: '99' } }); fireEvent.click(card('前级增益').getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('1–90')
    expect(writes(api)).toHaveLength(0)
  })
  it('呼吸与转向独立保存，转向只提交修改字段不动硬件限位', async () => {
    const api = backend(); show(<MotionSettings/>); await screen.findByLabelText('转向增益')
    fireEvent.change(screen.getByLabelText('转向增益'), { target: { value: '1.4' } })
    fireEvent.click(card('听声转向').getByRole('button', { name: '保存' }))
    expect(await card('听声转向').findByText('已保存并回读。')).toBeInTheDocument()
    expect(JSON.parse(String(writes(api)[0][1]?.body))).toEqual({ values: { turn_gain: 1.4 } })
    expect(screen.getByLabelText('启用待机呼吸')).toBeChecked()
    fireEvent.click(screen.getByLabelText('启用待机呼吸')); fireEvent.click(card('待机呼吸').getByRole('button', { name: '保存' }))
    expect(await card('待机呼吸').findByText('已保存并回读。')).toBeInTheDocument()
    expect(writes(api)).toHaveLength(2)
  })
  it('恢复推荐值有明确确认，不默默覆写', async () => {
    const api = backend(); show(<MotionSettings/>); await screen.findByLabelText('转向增益')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: '恢复设备推荐值' })); expect(writes(api)).toHaveLength(0)
    confirm.mockReturnValue(true); fireEvent.click(screen.getByRole('button', { name: '恢复设备推荐值' }))
    expect(await screen.findByText('推荐值已恢复并回读。')).toBeInTheDocument()
    expect(writes(api)[0][1]?.method).toBe('DELETE')
  })
  it('视觉仅改变选中项，不读取图片或调用云端分析', async () => {
    const api = backend(); show(<VisionSettings/>); await screen.findByLabelText('启用环境观察')
    expect(writes(api)).toHaveLength(0)
    fireEvent.click(screen.getByLabelText('允许重要事件主动开口')); fireEvent.click(card('环境观察设置').getByRole('button', { name: '保存' }))
    expect(await screen.findByText('已保存并回读。')).toBeInTheDocument()
    expect(JSON.parse(String(writes(api)[0][1]?.body))).toEqual({ proactive_enabled: false })
    expect(api.fetch.mock.calls.every(call => !/image|capture|camera/.test(call[0]))).toBe(true)
  })
  it('恢复请求没有真实生效时，不提示已恢复', async () => {
    const api = backend(); api.ignoreWrites(); vi.spyOn(window, 'confirm').mockReturnValue(true)
    show(<MotionSettings/>); await screen.findByLabelText('转向增益')
    fireEvent.click(screen.getByRole('button', { name: '恢复设备推荐值' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('尚未恢复为推荐值')
    expect(screen.queryByText('推荐值已恢复并回读。')).not.toBeInTheDocument()
  })
  it('模拟界面不读写真实设备，不填假状态', async () => {
    const api = backend(); show(<><SoundSettings simulated/><MotionSettings simulated/><VisionSettings simulated/></>)
    await waitFor(() => expect(screen.getAllByText('连接机器人后配置，不使用预览值。')).toHaveLength(3))
    expect(api.fetch).not.toHaveBeenCalled()
  })
})
