import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Setup from '../features/setup/Setup'
import { setBaseUrl } from '../api/client'

afterEach(() => vi.unstubAllGlobals())

it('按框架分步配置，读取真实挂载但不自动保存或激活', async () => {
  setBaseUrl('http://robot.test:8000')
  const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, state: 'ready', scene: { id: 'custom', name: '服务端场景' }, voice: { label: '实际语音服务' }, capabilities: [], knowledge: [], displays: [] })))
  vi.stubGlobal('fetch', fetch)
  render(<MemoryRouter><Setup host="robot.test"/></MemoryRouter>)
  expect(await screen.findByText(/已读取当前场景配置/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /语音服务/ })).toHaveAttribute('href', 'http://robot.test:7862/#/device/voice')
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  expect(screen.getByText('服务端场景')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /编辑当前场景/ })).toHaveAttribute('href', 'http://robot.test:7862/#/scene?id=custom')
  expect(screen.getAllByText('未挂载（按需）')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: '检查运行' }))
  expect(screen.getByText(/挂载信息不代表真机验收通过/)).toBeInTheDocument()
  expect(fetch.mock.calls.every((call: unknown[]) => !(call[1] as RequestInit)?.method || (call[1] as RequestInit)?.method === 'GET')).toBe(true)
})

it('恢复焦点重新读取，断线后不保留旧场景或伪造已完成', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, state: 'ready', scene: { id: 'one', name: '原场景' } }))).mockRejectedValue(new TypeError('offline'))
  vi.stubGlobal('fetch', fetch)
  render(<MemoryRouter initialEntries={['/dashboard/setup?step=1']}><Setup/></MemoryRouter>)
  expect(await screen.findByText('原场景')).toBeInTheDocument()
  fireEvent.focus(window)
  expect(await screen.findByRole('alert')).toHaveTextContent('无法连接机器人应用')
  await waitFor(() => expect(screen.queryByText('原场景')).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: '重新读取' })).toBeEnabled()
})

it('预览不读取或伪造设备配置，未知步骤有边界', () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  render(<MemoryRouter initialEntries={['/dashboard/setup?step=99']}><Setup simulated/></MemoryRouter>)
  expect(screen.getByRole('heading', { name: '检查运行' })).toBeInTheDocument()
  expect(screen.getByText('尚未取得运行场景')).toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
})
