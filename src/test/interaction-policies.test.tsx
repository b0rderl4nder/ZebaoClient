import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import InteractionPolicySettings from '../features/scenes/InteractionPolicySettings'
import { deleteInteractionPolicy, saveInteractionPolicy, type PolicyCatalog, type InteractionPolicy } from '../api/interactionPolicies'
import { setBaseUrl } from '../api/client'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const base: InteractionPolicy = { id: 'builtin', name: '内置规则', built_in: true, description: '设备提供的规则说明', entry_mode: 'wake', require_physical_speech: true, front_sector_degrees: 55, allow_standby_attention: true }
function fixture() {
  setBaseUrl('http://robot.test:8000')
  const custom = { ...base, id: 'custom', name: '自定义规则', built_in: false }
  const data: PolicyCatalog = { defaults: base, policies: [{ ...base }, custom], preserved_fields: ['allow_standby_attention'], fields: [
    { key: 'name', label: '策略名称', kind: 'text', max_length: 30 }, { key: 'description', label: '说明', kind: 'text', max_length: 160 },
    { key: 'entry_mode', label: '怎样开始交谈', kind: 'select', options: [{ value: 'wake', label: '先唤醒' }, { value: 'explicit', label: '明确触发' }] },
    { key: 'require_physical_speech', label: '真人语音证据', kind: 'boolean', advanced: true },
    { key: 'front_sector_degrees', label: '前向角度', kind: 'number', minimum: 15, maximum: 90, advanced: true },
  ] }
  let inUse = false
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/ui/interaction-policies')) return Response.json({ ok: true, ...data })
    const id = url.split('/').pop()!
    if (init?.method === 'DELETE') {
      if (inUse) return Response.json({ ok: false, error: 'interaction_policy_in_use' }, { status: 409 })
      data.policies = data.policies.filter(item => item.id !== id)
    }
    if (init?.method === 'PUT') {
      const updated = { id, built_in: false, ...JSON.parse(String(init.body)) }
      data.policies = [...data.policies.filter(item => item.id !== id), updated]
    }
    return Response.json({ ok: true })
  })
  vi.stubGlobal('fetch', request)
  return { request, data, custom, inUse: () => { inUse = true } }
}
function Harness({ initial = 'builtin' }: { initial?: string }) {
  const [selected, setSelected] = useState(initial)
  return <><output aria-label="场景策略选择">{selected}</output><InteractionPolicySettings selected={selected} disabled={false} onCatalog={() => {}} onChoose={setSelected} onState={notify}/></>
}
const notify = vi.fn()
async function open() { fireEvent.click(screen.getByRole('button', { name: /查看与管理策略/ })); await screen.findByRole('button', { name: '新建策略' }) }

describe('兼容交互策略原位管理', () => {
  it('按需加载，内置不可覆盖/删除，复制可改并保留兼容字段，不发布场景', async () => {
    const api = fixture(); render(<Harness/>)
    expect(api.request).not.toHaveBeenCalled()
    await open()
    expect(screen.getByRole('button', { name: '编辑策略' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '删除策略' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '复制策略' }))
    fireEvent.change(screen.getByRole('textbox', { name: '策略名称' }), { target: { value: '新的规则' } })
    fireEvent.click(screen.getByRole('button', { name: '保存策略' }))
    await screen.findByText(/策略已创建；/)
    const writes = api.request.mock.calls.filter(call => call[1]?.method)
    expect(writes).toHaveLength(1)
    expect(writes[0][0]).toMatch(/\/interaction-policies\/policy_/)
    expect(JSON.parse(String(writes[0][1]?.body))).toMatchObject({ name: '新的规则', allow_standby_attention: true })
    expect(screen.getByLabelText('场景策略选择').textContent).toMatch(/^policy_/)
  })
  it('新建需要名称，高级范围校验不发送非法参数', async () => {
    const api = fixture(); render(<Harness/>); await open()
    fireEvent.click(screen.getByRole('button', { name: '新建策略' }))
    expect(screen.getByRole('button', { name: '保存策略' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: '策略名称' }), { target: { value: '自己的规则' } })
    fireEvent.click(screen.getByText('高级准入检查'))
    fireEvent.change(screen.getByRole('spinbutton', { name: '前向角度' }), { target: { value: '91' } })
    expect(screen.getByRole('button', { name: '保存策略' })).toBeDisabled()
    expect(api.request.mock.calls.some(call => call[1]?.method)).toBe(false)
  })
  it('修改现有规则需要影响范围确认，取消不写入，确认后回读', async () => {
    const api = fixture(); vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<Harness initial="custom"/>); await open(); fireEvent.click(screen.getByRole('button', { name: '编辑策略' }))
    fireEvent.change(screen.getByRole('textbox', { name: '策略名称' }), { target: { value: '修改后' } })
    fireEvent.click(screen.getByRole('button', { name: '保存策略' }))
    expect(api.request.mock.calls.some(call => call[1]?.method)).toBe(false)
    vi.mocked(window.confirm).mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '保存策略' }))
    await screen.findByText('策略已保存并回读。')
    expect(api.data.policies.find(item => item.id === 'custom')?.name).toBe('修改后')
  })
  it('被引用不能删除，未引用删除后清空待选引用，不改活动场景', async () => {
    const api = fixture(); api.inUse(); vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Harness initial="custom"/>); await open(); fireEvent.click(screen.getByRole('button', { name: '删除策略' }))
    await screen.findByText(/策略仍被场景或已发布配置引用/)
    expect(screen.getByLabelText('场景策略选择')).toHaveTextContent('custom')
    expect(api.data.policies.some(item => item.id === 'custom')).toBe(true)
  })
  it('未使用策略可删除，删除结果必须回读确认', async () => {
    const api = fixture(); const confirmed = await deleteInteractionPolicy(api.custom)
    expect(confirmed.policies.some(item => item.id === 'custom')).toBe(false)
    expect(api.request.mock.calls.filter(call => call[1]?.method)).toHaveLength(1)
  })
  it('并发修改拒绝覆盖；新建超时后的同 ID 重试不能覆盖已创建规则', async () => {
    const api = fixture(), baseline = { ...api.custom }
    api.custom.name = '其他页面修改'
    await expect(saveInteractionPolicy('custom', { name: '覆盖值' }, baseline)).rejects.toThrow(/策略已在别处修改/)
    await expect(saveInteractionPolicy('custom', { name: '重复创建' }, null)).rejects.toThrow(/可能已创建/)
    expect(api.request.mock.calls.some(call => call[1]?.method)).toBe(false)
  })
  it('读取失败可重试，不提供猜测的编辑默认值', async () => {
    const api = fixture(), original = api.request.getMockImplementation()!
    api.request.mockImplementationOnce(async () => Response.json({ ok: false }, { status: 503 }))
    render(<Harness/>); fireEvent.click(screen.getByRole('button', { name: /查看与管理策略/ }))
    await screen.findByRole('button', { name: '重新读取策略' })
    expect(screen.queryByRole('button', { name: '新建策略' })).not.toBeInTheDocument()
    api.request.mockImplementation(original)
    fireEvent.click(screen.getByRole('button', { name: '重新读取策略' }))
    await screen.findByRole('button', { name: '新建策略' })
    await waitFor(() => expect(api.request.mock.calls.some(call => call[1]?.method)).toBe(false))
  })
})
