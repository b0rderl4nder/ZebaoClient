import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import People from '../features/people/People'
import PersonDetail from '../features/people/PersonDetail'
import VoiceCredential from '../features/people/VoiceCredential'
import { setBaseUrl } from '../api/client'
import { createPerson, importPerson, removePerson, personResource, preferencesError, type Person } from '../api/people'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const person = (): Person => ({ person_id: 'test-person', display_name: '测试人员', salutation: '', role: '', preferred_language: 'auto', response_style: '', permissions: [], furniture_preferences: {}, office_preferences: {}, proactive_greeting_enabled: false, greeting_scene_ids: [], greeting_cooldown_seconds: 1800, privacy: { share_salutation: true }, identity_ready: false, voiceprint: { registered: false, sample_count: 0, embedding_valid: false }, face: { linked: false, enabled: false, label: '' } })
function backend() {
  setBaseUrl('http://robot.test:8000')
  let current = person(), exists = true, ignore = false, failRegister = false
  const permissions = [{ id: 'cap_manifest_permission', name: '清单中的能力', description: '只执行本场景允许的设备' }]
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.replace('/operator-api/api/v1/', ''), method = init?.method || 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    if (path === 'ui/scenes') return Response.json({ scenes: [{ id: 'scene-one', name: '测试场景' }] })
    if (path === 'people/import-candidates') return Response.json({ candidates: [{ provider_subject: 'private-id', suggested_name: '测试人员', linked: false }] })
    if (path === 'people/import') { current.face.linked = true; return Response.json({ person: current }) }
    if (path === 'people') { if (method === 'POST') { current.display_name = body.display_name; exists = true; return Response.json({ person: current }) } return Response.json({ people: exists ? [current] : [] }) }
    if (path === 'people/test-person') {
      if (method === 'PATCH' && !ignore) current = { ...current, ...body }
      if (method === 'DELETE' && !ignore) exists = false
      return exists ? Response.json({ person: current, permission_catalog: permissions }) : Response.json({ ok: true })
    }
    if (path === 'voiceprints/enrollment-prompts') return Response.json({ prompts: [{ id: 1, text: '请朗读这一句测试文字。' }] })
    if (path === 'debug/mic_capture_asr') return Response.json({ pcm16_base64: 'mock-audio-not-real', sample_rate: 16000 })
    if (path === 'voiceprints/register') {
      if (failRegister) return Response.json({ ok: false }, { status: 503 })
      current.voiceprint.sample_count += 1; return Response.json({ ok: true })
    }
    return Response.json({ ok: false }, { status: 404 })
  })
  vi.stubGlobal('fetch', fetch)
  return { fetch, ignoreWrites: () => { ignore = true }, failRegister: (value: boolean) => { failRegister = value } }
}
const writes = (api: ReturnType<typeof backend>) => api.fetch.mock.calls.filter(call => call[1]?.method)
function detail() { return render(<MemoryRouter initialEntries={['/people/test-person']}><Routes><Route path="/people/:id" element={<PersonDetail/>}/><Route path="/dashboard/foundation/people" element={<div>已返回人员列表</div>}/></Routes></MemoryRouter>) }

describe('原 Client 人员管理', () => {
  it('名单入口是原生档案路由，读取没有录音、导入或写入', async () => {
    const api = backend(); render(<MemoryRouter><People/></MemoryRouter>)
    expect(await screen.findByRole('link', { name: /测试人员/ })).toHaveAttribute('href', '/dashboard/foundation/people/test-person')
    expect(writes(api)).toHaveLength(0)
  })
  it('只保存改过的人员字段并回读，不复制权限或凭证', async () => {
    const api = backend(); detail(); await screen.findByLabelText('姓名')
    fireEvent.change(screen.getByRole('textbox', { name: '称呼' }), { target: { value: '测试称呼' } }); fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('已保存并回读。')).toBeInTheDocument()
    expect(JSON.parse(String(writes(api)[0][1]?.body))).toEqual({ salutation: '测试称呼' })
  })
  it('权限来自 manifest，可以先配置权限但不能伪造身份可用', async () => {
    const api = backend(); detail(); await screen.findByLabelText('姓名')
    fireEvent.click(screen.getByRole('button', { name: '身份与权限' }))
    expect(screen.getByText('待完成声纹或人脸凭证')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('清单中的能力')); fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText('已保存并回读。')
    expect(JSON.parse(String(writes(api)[0][1]?.body))).toEqual({ permissions: ['cap_manifest_permission'] })
  })
  it('问候选择真实场景名称，不要求填写内部编号', async () => {
    const api = backend(); detail(); await screen.findByLabelText('姓名')
    fireEvent.click(screen.getByRole('button', { name: '主动协作' })); fireEvent.click(await screen.findByLabelText('测试场景'))
    fireEvent.click(screen.getByRole('button', { name: '保存' })); await screen.findByText('已保存并回读。')
    expect(JSON.parse(String(writes(api)[0][1]?.body))).toEqual({ greeting_scene_ids: ['scene-one'] })
  })
  it('删除需确认、回读后才离开；没有远端删除', async () => {
    const api = backend(); detail(); await screen.findByLabelText('姓名')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: '删除人员' })); expect(writes(api)).toHaveLength(0)
    confirm.mockReturnValue(true); fireEvent.click(screen.getByRole('button', { name: '删除人员' }))
    await screen.findByText('已返回人员列表')
    expect(writes(api)).toHaveLength(1); expect(writes(api)[0][0]).toContain('/people/test-person')
  })
  it('假成功不显示保存完成', async () => {
    const api = backend(); api.ignoreWrites(); detail(); await screen.findByLabelText('姓名')
    fireEvent.change(screen.getByRole('textbox', { name: '称呼' }), { target: { value: '测试称呼' } }); fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('不一致')
  })
  it('非法偏好和清单外新增授权在发送前拒绝', () => {
    expect(preferencesError({ style: { nested: 'invalid' } })).not.toBe('')
    expect(preferencesError({ style: ['现代', '简洁'], budget: 1000, enabled: true })).toBe('')
    const p = person()
    expect(personResource(p.person_id).validate!({ ...p, permissions: ['invented'] }, { person: p, values: p, permissions: [] })).toContain('不在能力清单')
  })
  it('录入直接使用机器人，注册失败保留内存音频，不重复采集', async () => {
    const api = backend(); api.failRegister(true)
    const complete = vi.fn()
    render(<VoiceCredential person={person()} onComplete={complete} onCancel={vi.fn()} onBusy={vi.fn()}/>)
    await screen.findByText('请朗读这一句测试文字。'); expect(writes(api)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '录入当前句' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('无需重录')
    api.failRegister(false); fireEvent.click(screen.getByRole('button', { name: '重试校验与保存' }))
    await waitFor(() => expect(complete).toHaveBeenCalledOnce())
    expect(writes(api).filter(call => call[0].includes('mic_capture'))).toHaveLength(1)
    expect(writes(api).find(call => call[0].includes('mic_capture'))![0]).toContain('purpose=voiceprint_enrollment')
    expect(writes(api).filter(call => call[0].includes('voiceprints/register'))).toHaveLength(2)
  })
  it('模拟界面不读取身份或录音', () => {
    const api = backend(); render(<MemoryRouter><People simulated/></MemoryRouter>); expect(api.fetch).not.toHaveBeenCalled()
  })
  it('新增档案使用现有接口，并核验创建后的档案', async () => {
    const api = backend()
    expect(await createPerson(' 新人员 ')).toBe('test-person')
    expect(JSON.parse(String(writes(api)[0][1]?.body))).toEqual({ display_name: '新人员' })
    expect(api.fetch.mock.calls[api.fetch.mock.calls.length - 1][0]).toContain('/people/test-person')
  })
  it('给已有档案关联人脸，不另建人员且不请求图片', async () => {
    const api = backend()
    await importPerson({ provider_subject: 'private-id', suggested_name: '测试人员', linked: false }, '测试人员', 'test-person')
    expect(writes(api)).toHaveLength(1)
    expect(JSON.parse(String(writes(api)[0][1]?.body))).toEqual({ provider: 'compreface', provider_subject: 'private-id', display_name: '测试人员', person_id: 'test-person' })
    expect(api.fetch.mock.calls.every(call => !/image|capture|camera/.test(call[0]))).toBe(true)
  })
  it('删除后档案仍存在，不能显示成功', async () => {
    const api = backend(); api.ignoreWrites()
    await expect(removePerson('test-person')).rejects.toThrow('删除结果尚未确认')
  })
})
