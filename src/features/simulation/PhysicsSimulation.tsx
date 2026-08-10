import { useCallback, useEffect, useRef, useState } from 'react'
import type { FullState } from '../../api/types'
import {
  connectPhysicalStateWs,
  connectSimulationTargetWs,
  fetchOfficeMovementStatus,
  fetchSimulationState,
  fetchSimulationStatus,
  fetchUrdfFingerprint,
  getPhysicalEndpoint,
  getSimulatorEndpoint,
  playSimulationPreset,
  SIMULATION_PRESETS,
  simulationTargetFromState,
  startSimulationBackend,
  stopSimulationBackend,
  type OfficeMovementStatus,
  type SimulationPresetId,
} from '../../api/simulation'
import { desktopSimulationRunning, isDesktopApp, startDesktopSimulation, stopDesktopSimulation } from '../../api/desktop'
import Robot3DViewer from './Robot3DViewer'
import { loadPassiveJointSolver, normalizeKinematicsState, type PassiveJointSolver } from './kinematics/passiveKinematics'

type ViewMode = 'mirror' | 'validate' | 'compare'
type MirrorStats = { sent: number; dropped: number; lastFrameAt: number }

function ready(status: Awaited<ReturnType<typeof fetchSimulationStatus>> | null) {
  return Boolean(status?.state === 'running' || status?.backend_status?.ready || status?.ready)
}

function delta(a: FullState | null, b: FullState | null) {
  if (!a?.head_pose || !b?.head_pose) return null
  const fields = ['x', 'y', 'z', 'roll', 'pitch', 'yaw'] as const
  return Math.sqrt(fields.reduce((sum, key) => sum + Math.pow(Number(a.head_pose?.[key] || 0) - Number(b.head_pose?.[key] || 0), 2), 0))
}

export default function PhysicsSimulation() {
  const simulatorEndpoint = getSimulatorEndpoint()
  const physicalEndpoint = getPhysicalEndpoint()
  const desktop = isDesktopApp()
  const [mode, setMode] = useState<ViewMode>('mirror')
  const [status, setStatus] = useState<Awaited<ReturnType<typeof fetchSimulationStatus>> | null>(null)
  const [physicalState, setPhysicalState] = useState<FullState | null>(null)
  const [simulationState, setSimulationState] = useState<FullState | null>(null)
  const [movement, setMovement] = useState<OfficeMovementStatus | null>(null)
  const [stats, setStats] = useState<MirrorStats>({ sent: 0, dropped: 0, lastFrameAt: 0 })
  const [stateRate, setStateRate] = useState(0)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [activePreset, setActivePreset] = useState<SimulationPresetId | null>(null)
  const [modelFingerprints, setModelFingerprints] = useState<{ physical: string; simulation: string } | null>(null)
  const physicalWs = useRef<WebSocket | null>(null)
  const simulationWs = useRef<WebSocket | null>(null)
  const rateWindow = useRef({ startedAt: performance.now(), frames: 0 })
  const passiveSolver = useRef<PassiveJointSolver | null>(null)
  const presetController = useRef<AbortController | null>(null)

  const recordPhysicalFrame = () => {
    const current = rateWindow.current
    current.frames += 1
    const elapsed = performance.now() - current.startedAt
    if (elapsed >= 1000) {
      setStateRate(current.frames * 1000 / elapsed)
      rateWindow.current = { startedAt: performance.now(), frames: 0 }
    }
  }

  const stopMirror = useCallback(() => {
    physicalWs.current?.close(); simulationWs.current?.close()
    physicalWs.current = null; simulationWs.current = null
  }, [])

  const poll = useCallback(async () => {
    fetchSimulationStatus().then(setStatus).catch(() => setStatus(null))
    fetchSimulationState().then(payload => setSimulationState(normalizeKinematicsState(payload, passiveSolver.current))).catch(() => setSimulationState(null))
    fetchOfficeMovementStatus(physicalEndpoint).then(setMovement).catch(() => setMovement(null))
  }, [physicalEndpoint])

  useEffect(() => {
    void loadPassiveJointSolver().then(solver => { passiveSolver.current = solver }).catch(() => { passiveSolver.current = null })
    void poll()
    const stateSocket = connectPhysicalStateWs(physicalEndpoint, 20)
    physicalWs.current = stateSocket
    stateSocket.onmessage = event => { try { setPhysicalState(normalizeKinematicsState(JSON.parse(String(event.data)), passiveSolver.current)); recordPhysicalFrame() } catch { /* ignore malformed frame */ } }
    const timer = window.setInterval(() => void poll(), 1500)
    void Promise.all([fetchUrdfFingerprint(physicalEndpoint), fetchUrdfFingerprint(simulatorEndpoint)])
      .then(([physical, simulation]) => setModelFingerprints({ physical, simulation }))
      .catch(() => setModelFingerprints(null))
    return () => { window.clearInterval(timer); stateSocket.close(); presetController.current?.abort(); stopMirror() }
  }, [physicalEndpoint, poll, simulatorEndpoint, stopMirror])

  const startPhysics = async () => {
    setBusy(true); setMessage('')
    try {
      if (desktop && !(await desktopSimulationRunning())) await startDesktopSimulation()
      if (!desktop) throw new Error('网页版只提供实体3D镜像，请使用泽宝桌面端启动MuJoCo。')
      const deadline = Date.now() + 12000
      while (Date.now() < deadline) {
        try { await fetchSimulationStatus(); break } catch { await new Promise(resolve => window.setTimeout(resolve, 350)) }
      }
      await startSimulationBackend()
      await poll()
      setMessage('MuJoCo物理环境已就绪')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'MuJoCo启动失败')
    } finally { setBusy(false) }
  }

  const stopPhysics = async () => {
    setBusy(true); stopMirror()
    try { await stopSimulationBackend().catch(() => null); await stopDesktopSimulation(); setStatus(null); setSimulationState(null); setMessage('物理环境已关闭') }
    finally { setBusy(false) }
  }

  const validateMotion = () => {
    if (!ready(status)) { setMessage('请先启动MuJoCo'); return }
    stopMirror()
    const source = connectPhysicalStateWs(physicalEndpoint, 20)
    const target = connectSimulationTargetWs()
    physicalWs.current = source; simulationWs.current = target
    let sent = 0; let dropped = 0
    source.onmessage = event => {
      try {
        const state = normalizeKinematicsState(JSON.parse(String(event.data)), passiveSolver.current)
        setPhysicalState(state)
        recordPhysicalFrame()
        const command = simulationTargetFromState(state)
        if (command && target.readyState === WebSocket.OPEN) { target.send(JSON.stringify(command)); sent += 1 } else dropped += 1
      } catch { dropped += 1 }
      setStats({ sent, dropped, lastFrameAt: Date.now() })
    }
    source.onerror = () => setMessage('实体状态连接中断')
    target.onerror = () => setMessage('MuJoCo状态连接中断')
    setMessage('正在把实体动作单向送入MuJoCo验证')
  }

  const validatePreset = async (presetId: SimulationPresetId) => {
    if (!ready(status)) { setMessage('请先启动MuJoCo'); return }
    presetController.current?.abort()
    const controller = new AbortController()
    presetController.current = controller
    setActivePreset(presetId)
    setMessage(`正在仿真回放${SIMULATION_PRESETS[presetId].label}`)
    try {
      await playSimulationPreset(presetId, controller.signal)
      if (!controller.signal.aborted) setMessage(`${SIMULATION_PRESETS[presetId].label}回放完成，未写入实体机器人`)
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setMessage(error instanceof Error ? error.message : '动作验证失败')
      }
    } finally {
      if (presetController.current === controller) presetController.current = null
      setActivePreset(null)
      await poll()
    }
  }

  const physicsReady = ready(status)
  const difference = delta(physicalState, simulationState)
  const conflictCount = Number(movement?.motion_safety?.rejected_count || 0)
  const modelMismatch = Boolean(modelFingerprints && modelFingerprints.physical !== modelFingerprints.simulation)
  const warning = modelMismatch || conflictCount > 0 || (difference !== null && difference > .08)
  const viewerEndpoint = mode === 'mirror' ? physicalEndpoint : simulatorEndpoint
  const viewerState = mode === 'mirror' ? physicalState : simulationState

  return <div className="simulation-page">
    <header className="simulation-header"><div><h1>物理仿真</h1><p>真实模型与MuJoCo安全验证</p></div><div className="simulation-health"><i className={physicsReady ? 'is-online' : ''}/>{physicsReady ? 'MuJoCo运行中' : desktop ? 'MuJoCo未启动' : '网页版'}</div></header>
    <nav className="simulation-tabs" aria-label="仿真模式">
      <button className={mode === 'mirror' ? 'is-active' : ''} onClick={() => setMode('mirror')}>实体镜像</button>
      <button className={mode === 'validate' ? 'is-active' : ''} onClick={() => setMode('validate')}>动作验证</button>
      <button className={mode === 'compare' ? 'is-active' : ''} onClick={() => setMode('compare')}>差异分析</button>
    </nav>
    <section className="simulation-stage">
      <Robot3DViewer endpoint={viewerEndpoint} state={viewerState} connected={mode === 'mirror' ? Boolean(physicalState) : physicsReady} highlight={warning}/>
      <aside className="simulation-inspector">
        <div className="simulation-inspector__status"><span>{mode === 'mirror' ? '实体状态' : mode === 'validate' ? '验证状态' : '差异状态'}</span><strong>{warning ? '需要检查' : viewerState ? '稳定' : '等待数据'}</strong></div>
        {mode === 'mirror' && <p>只读取实体机器人的真实关节，不会发送任何动作。</p>}
        {mode === 'validate' && <><p>选择动作在MuJoCo中完整回放，结果不会写回舵机。</p><div className="simulation-presets">{(Object.keys(SIMULATION_PRESETS) as SimulationPresetId[]).map(id => <button key={id} onClick={() => void validatePreset(id)} disabled={!physicsReady || activePreset !== null}>{activePreset === id ? '回放中' : SIMULATION_PRESETS[id].label}</button>)}</div><button className="simulation-secondary" onClick={validateMotion} disabled={!physicsReady || activePreset !== null}>镜像实体动作</button></>}
        {mode === 'compare' && <div className="difference-list"><div><span>模型一致</span><strong>{modelFingerprints ? modelMismatch ? '不一致' : '一致' : '检查中'}</strong></div><div><span>姿态差异</span><strong>{difference === null ? '—' : difference.toFixed(4)}</strong></div><div><span>状态同步</span><strong>{stateRate ? `${stateRate.toFixed(1)} Hz` : '—'}</strong></div><div><span>物理步频</span><strong>{status?.backend_status?.physics_step_hz ? `${status.backend_status.physics_step_hz} Hz` : '—'}</strong></div><div><span>活动接触</span><strong>{status?.backend_status?.active_contacts ?? '—'}</strong></div><div><span>关节越界</span><strong>{status?.backend_status?.joint_limit_violations ?? '—'}</strong></div><div><span>拒绝帧</span><strong>{conflictCount}</strong></div><div><span>仿真帧</span><strong>{stats.sent}</strong></div><div><span>丢弃帧</span><strong>{stats.dropped}</strong></div></div>}
        <div className="simulation-controls">{physicsReady ? <button onClick={() => void stopPhysics()} disabled={busy}>关闭物理环境</button> : <button onClick={() => void startPhysics()} disabled={busy || !desktop}>{busy ? '正在启动' : desktop ? '启动MuJoCo' : '请在桌面端启动'}</button>}</div>
        {message && <div className="simulation-message">{message}</div>}
      </aside>
    </section>
  </div>
}
