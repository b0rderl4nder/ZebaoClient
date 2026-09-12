import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import EmbodiedInteractionControl from '../features/embodied/EmbodiedInteractionControl'
import { setBaseUrl } from '../api/client'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
function fixture(apply = true) {
  setBaseUrl('http://robot.test:8000')
  const status = { ok: true, enabled: true, active_scene_id: 'scene_other', scene: { name: '实际场景' }, global_activity_level: 'normal', activity_level: 'observe', scene_activity_levels: { scene_other: 'observe' }, available_activity_levels: [{ id: 'normal', name: '普通' }, { id: 'observe', name: '观察' }], mimic: { mode: 'quick', available_modes: [{ id: 'quick', name: '快速' }] } }
  const request = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH' && apply) Object.assign(status, JSON.parse(String(init.body)).activity_level ? { global_activity_level: JSON.parse(String(init.body)).activity_level } : {})
    return Response.json(status)
  })
  vi.stubGlobal('fetch', request)
  render(<StrictMode><MemoryRouter><EmbodiedInteractionControl/></MemoryRouter></StrictMode>)
  return { request, status }
}
describe('具身配置层次', () => {
  it('整机默认与当前场景有效值分开，场景表现只导航不复制编辑区', async () => {
    const api = fixture()
    expect(await screen.findByRole('combobox', { name: '整机默认主动程度' })).toHaveValue('normal')
    expect(screen.queryByRole('combobox', { name: '当前场景活跃度' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '场景表达档案' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '配置当前场景的动作表现 →' })).toHaveAttribute('href', '/dashboard/scenes?id=scene_other&tab=interaction')
    fireEvent.change(screen.getByRole('combobox', { name: '整机默认主动程度' }), { target: { value: 'observe' } })
    await screen.findByText('已保存并回读')
    const writes = api.request.mock.calls.filter(call => call[1]?.method)
    expect(writes).toHaveLength(1)
    expect(JSON.parse(String(writes[0][1]?.body))).toEqual({ activity_level: 'observe' })
    expect(writes[0][0]).toContain(':5173/operator-api/api/v1/embodied-interaction')
    expect(api.status.scene_activity_levels).toEqual({ scene_other: 'observe' })
  })
  it('回读不一致不能显示保存成功', async () => {
    fixture(false)
    fireEvent.change(await screen.findByRole('combobox', { name: '整机默认主动程度' }), { target: { value: 'observe' } })
    await screen.findByText(/设置已提交，但回读未确认/)
    expect(screen.queryByText('已保存并回读')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '整机默认主动程度' })).toHaveValue('normal')
  })
})
