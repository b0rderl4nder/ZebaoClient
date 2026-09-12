import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Scenes from '../features/scenes/Scenes'
import Foundation from '../features/foundation/Foundation'
import { setBaseUrl } from '../api/client'
import { operatorRequest } from '../api/operator'

afterEach(() => vi.unstubAllGlobals())

describe('场景工作区', () => {
  it('显示服务端动态挂载，并验证切换后的真实场景', async () => {
    setBaseUrl('http://robot.test:8000')
    let active = 'one'
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') active = 'two'
      const payload = url.endsWith('/runtime') ? {
        ok: true, state: 'ready', scene: { id: active, name: active === 'one' ? '测试接待' : '临时展览', generation: active },
        capabilities: [{ id: 'custom-tool', name: '新挂载的能力' }], knowledge: [{ id: 'catalogue', label: '展览资料' }], displays: [],
      } : { ok: true, scenes: [{ id: 'one', name: '测试接待', capability_count: 1 }, { id: 'two', name: '临时展览', capability_count: 0 }] }
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', request)
    render(<MemoryRouter><Scenes/></MemoryRouter>)
    expect(await screen.findByRole('link', { name: '新挂载的能力' })).toHaveAttribute('href', 'http://robot.test:7862/#/capability?id=custom-tool')
    expect(screen.getByText('展览资料')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '切换' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: '临时展览' }).tagName).toBe('H2'))
    expect(request.mock.calls.filter(call => call[1]?.method === 'POST').map(call => call[0])).toEqual(['http://robot.test:7862/api/v1/scenes/two/activate'])
  })

  it('失败不会显示为切换成功，提供明确重试', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    render(<MemoryRouter><Scenes/></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('无法连接机器人应用')
    expect(screen.queryByLabelText('当前场景挂载')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })

  it('呼吸和转向可以直接搜索并打开原设置入口', () => {
    render(<MemoryRouter><Foundation/></MemoryRouter>)
    fireEvent.change(screen.getByRole('searchbox', { name: '查找设置' }), { target: { value: '呼吸' } })
    expect(screen.getByRole('link', { name: /呼吸与听声转向/ })).toHaveAttribute('href', 'http://robot.test:7862/#/device/motion')
    expect(screen.queryByText('提示词')).not.toBeInTheDocument()
  })

  it('请求有超时边界，故障不会永久显示加载', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })))
    const result = expect(operatorRequest('/api/v1/ui/runtime')).rejects.toThrow('连接超时')
    await vi.advanceTimersByTimeAsync(8000)
    await result
    vi.useRealTimers()
  })
})
