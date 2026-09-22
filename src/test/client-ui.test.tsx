import { render, screen, waitFor } from '@testing-library/react'
import axe from 'axe-core'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import ClientShell from '../components/ClientShell'
import DeviceDiscovery from '../features/discovery/DeviceDiscovery'
import Dashboard from '../features/dashboard/Dashboard'
import SceneRuntimeCard from '../features/dashboard/SceneRuntimeCard'
import EmbodiedInteractionControl from '../features/embodied/EmbodiedInteractionControl'
import AcceptanceWorkspace from '../features/acceptance/AcceptanceWorkspace'
import { playSimulationPreset, SIMULATION_PRESETS } from '../api/simulation'

describe('桌面控制端信息架构', () => {
  it('主导航直接呈现场景和基础系统，仿真保留独立入口', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<ClientShell host="192.168.3.83" simulated={false} onSwitchDevice={vi.fn()} />}>
            <Route index element={<div>设备概览</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    const desktopNavigation = screen.getByLabelText('泽宝管理导航')
    expect(desktopNavigation.querySelectorAll('nav a')).toHaveLength(6)
    for (const name of ['概览', '场景', '能力', '人员', '设备', '验收']) {
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

  it('将具身交互呈现为独立运行时控制，而不是能力导航', async () => {
    const { container } = render(<MemoryRouter><EmbodiedInteractionControl simulated /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: '具身交互' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '已暂停' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByRole('group', { name: '场景表达档案' })).not.toBeInTheDocument()
    expect(container.textContent).toContain('统一安全控制')
    expect((await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([])
  })

  it('概览只读取场景运行时快照，不制造默认场景或客户端能力目录', async () => {
    const { container } = render(
      <MemoryRouter>
        <Dashboard host="192.168.3.83" simulated />
      </MemoryRouter>,
    )

    expect(screen.getByLabelText('当前场景运行时')).toBeInTheDocument()
    expect(container.textContent).toContain('预览模式未连接机器人，不显示虚构的场景或能力。')
    expect(container.textContent).not.toMatch(/默认场景|普通对话场景/)
    expect((await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([])
  })

  it('在同一运行快照旁展示 Skill 合同，不把 Client 变成执行入口', async () => {
    const request = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/ui/runtime')) {
        return Response.json({
          ok: true,
          state: 'ready',
          scene: { id: 'quiet', name: '安静办公', generation: 'scene-generation' },
          capabilities: [{ id: 'office_iot', name: '办公室物联网' }],
          capability_count: 1,
          voice: { provider: 'aliyun_native_omni', label: '云端 Omni' },
          interaction: { id: 'wake', name: '唤醒后连续对话' },
        })
      }
      if (path.endsWith('/ecosystem/skills')) {
        return Response.json({
          ok: true,
          generation: 'skill-generation',
          count: 1,
          execution_boundary: 'CapabilityBroker',
          skills: [{
            skill_id: 'control_home_assistant',
            tool_name: 'control_home_assistant',
            title: '控制物联网',
            result_contract: 'verified_device_result',
            requires_identity_authorization: true,
          }],
        })
      }
      if (path.endsWith('/ecosystem/health')) {
        return Response.json({
          ok: true,
          release: { app_version: '0.1.421', bound: true },
          scene: { generation: 'scene-generation' },
        })
      }
      if (path.endsWith('/demo-readiness')) {
        return Response.json({ ready: false, blockers: ['disk_target'] })
      }
      return Response.json({ ok: false }, { status: 404 })
    })
    vi.stubGlobal('fetch', request)
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <SceneRuntimeCard />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText('控制物联网')).toBeInTheDocument())
    expect(screen.getByText('设备回读')).toBeInTheDocument()
    expect(screen.getByText('需授权')).toBeInTheDocument()
    expect(screen.getByText(/CapabilityBroker/)).toBeInTheDocument()
    expect(screen.getByText('0.1.421')).toBeInTheDocument()
    expect(screen.getByText('可用空间低于建议余量')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('验收工作台显示当前场景、自动门禁和真人证据入口', async () => {
    const request = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/demo-readiness')) return Response.json({ ready: false, state: 'blocked', blockers: ['voice_turn_acceptance'], voice_mode: 'cloud_omni_native', gates: { field_network: true, voice_turn_acceptance: false } })
      if (url.pathname.endsWith('/ui/runtime')) return Response.json({ ok: true, state: 'ready', scene: { id: 'quiet', name: '安静办公', generation: 'generation-123', description: '现场场景' }, capabilities: [{ id: 'office_iot', name: '办公室物联网' }], capability_count: 1, voice: { provider: 'aliyun_native_omni', label: '云端 Omni' } })
      if (url.pathname.endsWith('/ecosystem/health')) return Response.json({ ok: true, release: { app_version: '0.1.423', git_commit: 'abcdef1234567890', bound: true } })
      if (url.pathname.endsWith('/ecosystem/skills')) return Response.json({ ok: true, count: 2, skills: [] })
      if (url.pathname.endsWith('/acceptance/runs')) return init?.method === 'POST' ? Response.json({ ok: true, run: { run_id: 'new', recorded_at: '2026-09-23', passed: false, scene: { id: 'quiet', generation: 'generation-123' }, release: { git_commit: 'abc', artifact_sha256: 'hash' }, voice_mode: 'cloud_omni_native', stages: {}, capability_results: [], device_results: [], display_revision: '', latency_ms: {} } }) : Response.json({ ok: true, count: 0, stages: [{ id: 'voice_entry', label: '完成唤醒或手机入口复核', kind: 'dialogue' }], runs: [] })
      return Response.json({ ok: false }, { status: 404 })
    })
    vi.stubGlobal('fetch', request)
    render(<MemoryRouter><AcceptanceWorkspace /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('heading', { name: '验收工作台' })).toBeInTheDocument())
    expect(await screen.findByText('安静办公')).toBeInTheDocument()
    expect(screen.getByText('自动门禁')).toBeInTheDocument()
    expect(screen.getByText('真人验收步骤')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存本次验收记录' })).toBeEnabled()
    vi.unstubAllGlobals()
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
