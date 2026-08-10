import { render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import ClientShell from '../components/ClientShell'
import DeviceDiscovery from '../features/discovery/DeviceDiscovery'
import { playSimulationPreset, SIMULATION_PRESETS } from '../api/simulation'

describe('桌面控制端信息架构', () => {
  it('主导航严格收口为概览、控制、应用和仿真', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<ClientShell host="192.168.3.83" simulated={false} onSwitchDevice={vi.fn()} />}>
            <Route index element={<div>设备概览</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    const desktopNavigation = screen.getByLabelText('设备控制导航')
    expect(desktopNavigation.querySelectorAll('nav a')).toHaveLength(4)
    for (const name of ['概览', '控制', '应用', '仿真']) {
      expect(screen.getAllByText(name)).toHaveLength(2)
    }
    expect((await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([])
  })

  it('连接页提供明确标签且不要求手填仿真服务地址', async () => {
    const { container } = render(
      <DeviceDiscovery
        onConnect={vi.fn()}
        onSimulate={vi.fn()}
        scanning={false}
        devices={[]}
        onScan={vi.fn()}
        scanSummary={null}
        error={null}
      />,
    )

    expect(screen.getByLabelText('设备地址')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/MuJoCo.*地址|服务地址|PowerShell/)
    expect((await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([])
  })
})

describe('仿真动作隔离', () => {
  it('四类验收动作只发往本机MuJoCo', async () => {
    vi.useFakeTimers()
    const request = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ uuid: 'simulation-only' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', request)

    expect(Object.keys(SIMULATION_PRESETS)).toEqual(['nod', 'turn', 'dance', 'thinking'])
    const playback = playSimulationPreset('nod', new AbortController().signal)
    await vi.runAllTimersAsync()
    await playback
    expect(request).toHaveBeenCalledTimes(SIMULATION_PRESETS.nod.frames.length)
    for (const [url] of request.mock.calls) {
      expect(String(url)).toMatch(/^http:\/\/127\.0\.0\.1:8002\/api\/move\/goto$/)
    }

    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
})
