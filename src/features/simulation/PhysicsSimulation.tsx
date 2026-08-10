import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { DaemonStatus, FullState } from '../../api/types'
import {
  connectPhysicalStateWs,
  connectSimulationTargetWs,
  fetchOfficeMovementStatus,
  fetchSimulationState,
  fetchSimulationStatus,
  getPhysicalEndpoint,
  getSimulatorEndpoint,
  savePhysicalEndpoint,
  saveSimulatorEndpoint,
  simulationTargetFromState,
  startSimulationBackend,
  stopSimulationBackend,
  type OfficeMovementStatus,
} from '../../api/simulation'
import SimulatedRobotPreview from './SimulatedRobotPreview'

type MirrorStats = {
  sent: number
  dropped: number
  lastFrameAt: number
}

const EMPTY_STATS: MirrorStats = { sent: 0, dropped: 0, lastFrameAt: 0 }

function backendReady(status: DaemonStatus | null): boolean {
  return Boolean(status?.state === 'running' || status?.backend_status?.ready || status?.ready)
}

export default function PhysicsSimulation() {
  const [endpoint, setEndpoint] = useState(getSimulatorEndpoint())
  const [physicalEndpoint, setPhysicalEndpoint] = useState(getPhysicalEndpoint())
  const [status, setStatus] = useState<DaemonStatus | null>(null)
  const [simulatorReachable, setSimulatorReachable] = useState(false)
  const [simState, setSimState] = useState<FullState | null>(null)
  const [movement, setMovement] = useState<OfficeMovementStatus | null>(null)
  const [mirroring, setMirroring] = useState(false)
  const [stats, setStats] = useState<MirrorStats>(EMPTY_STATS)
  const [busy, setBusy] = useState<'start' | 'stop' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const physicalWsRef = useRef<WebSocket | null>(null)
  const simulationWsRef = useRef<WebSocket | null>(null)
  const statsRef = useRef<MirrorStats>(EMPTY_STATS)

  const stopMirror = useCallback(() => {
    physicalWsRef.current?.close()
    simulationWsRef.current?.close()
    physicalWsRef.current = null
    simulationWsRef.current = null
    setMirroring(false)
  }, [])

  const poll = useCallback(async () => {
    try {
      const nextStatus = await fetchSimulationStatus()
      setStatus(nextStatus)
      setSimulatorReachable(true)
      if (backendReady(nextStatus)) {
        fetchSimulationState().then(setSimState).catch(() => {})
      }
    } catch {
      setSimulatorReachable(false)
      setStatus(null)
      setSimState(null)
      stopMirror()
    }
    fetchOfficeMovementStatus(physicalEndpoint).then(setMovement).catch(() => setMovement(null))
  }, [physicalEndpoint, stopMirror])

  useEffect(() => {
    void poll()
    const timer = window.setInterval(() => void poll(), 2000)
    return () => {
      window.clearInterval(timer)
      stopMirror()
    }
  }, [poll, stopMirror])

  const startMirror = () => {
    setError(null)
    setMessage(null)
    if (!backendReady(status)) {
      setError('请先启动 MuJoCo 物理 backend。')
      return
    }
    stopMirror()
    const physical = connectPhysicalStateWs(physicalEndpoint, 20)
    const simulation = connectSimulationTargetWs()
    physicalWsRef.current = physical
    simulationWsRef.current = simulation
    statsRef.current = EMPTY_STATS
    setStats(EMPTY_STATS)

    simulation.onopen = () => {
      if (physical.readyState === WebSocket.OPEN) setMirroring(true)
    }
    physical.onopen = () => {
      if (simulation.readyState === WebSocket.OPEN) setMirroring(true)
    }
    physical.onmessage = event => {
      try {
        const state = JSON.parse(String(event.data)) as FullState
        const target = simulationTargetFromState(state)
        if (!target || simulation.readyState !== WebSocket.OPEN) {
          statsRef.current = { ...statsRef.current, dropped: statsRef.current.dropped + 1 }
        } else {
          simulation.send(JSON.stringify(target))
          statsRef.current = {
            ...statsRef.current,
            sent: statsRef.current.sent + 1,
            lastFrameAt: Date.now(),
          }
        }
        if ((statsRef.current.sent + statsRef.current.dropped) % 5 === 0) {
          setStats({ ...statsRef.current })
        }
      } catch {
        statsRef.current = { ...statsRef.current, dropped: statsRef.current.dropped + 1 }
      }
    }
    const fail = () => {
      setError('物理镜像连接已断开。')
      stopMirror()
    }
    physical.onerror = fail
    physical.onclose = () => setMirroring(false)
    simulation.onerror = fail
    simulation.onclose = () => setMirroring(false)
  }

  const startBackend = async () => {
    setBusy('start')
    setError(null)
    try {
      await startSimulationBackend()
      setMessage('MuJoCo backend 已启动，物理窗口会在本机显示。')
      await poll()
    } catch (startError) {
      setError(
        startError instanceof Error
          ? `启动失败：${startError.message}`
          : '启动 MuJoCo backend 失败',
      )
    } finally {
      setBusy(null)
    }
  }

  const stopBackend = async () => {
    setBusy('stop')
    setError(null)
    stopMirror()
    try {
      await stopSimulationBackend()
      setMessage('MuJoCo backend 已停止。')
      await poll()
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : '停止 MuJoCo backend 失败')
    } finally {
      setBusy(null)
    }
  }

  const applyEndpoint = () => {
    setEndpoint(saveSimulatorEndpoint(endpoint))
    setMessage('仿真服务地址已保存。')
    setError(null)
    stopMirror()
    void poll()
  }

  const applyPhysicalEndpoint = () => {
    setPhysicalEndpoint(savePhysicalEndpoint(physicalEndpoint))
    setMessage('实体机器人地址已保存。')
    setError(null)
    stopMirror()
  }

  const safety = movement?.motion_safety
  const safe = Boolean(safety?.ready && (safety.rejected_count ?? 0) === 0)
  const head = simState?.head_pose

  return (
    <div className="min-h-screen animate-fade-in">
      <nav className="sticky top-0 z-50 border-b border-white/[0.05] bg-[#080810]/80 backdrop-blur-2xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6 md:px-10">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white/85">MuJoCo 物理仿真</h1>
            <p className="text-xs text-white/[0.24]">官方 Reachy Mini physics backend</p>
          </div>
          <Link to="/dashboard" className="text-xs font-semibold text-white/40 no-underline transition hover:text-white/75">返回控制台</Link>
        </div>
      </nav>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8 md:px-10 md:py-12">
        <section className="grid gap-4 md:grid-cols-4">
          <StatusCard label="本机服务" value={simulatorReachable ? '在线' : '未启动'} ok={simulatorReachable} />
          <StatusCard label="MuJoCo" value={backendReady(status) ? '物理运行中' : '未运行'} ok={backendReady(status)} />
          <StatusCard label="实体镜像" value={mirroring ? '20Hz 镜像中' : '未连接'} ok={mirroring} />
          <StatusCard label="实体安全门" value={safe ? '已接管' : '未确认'} ok={safe} />
        </section>

        {(error || message) && (
          <div className={`rounded-2xl border p-4 text-sm ${error ? 'border-rose-400/15 bg-rose-400/[0.06] text-rose-100/75' : 'border-emerald-400/15 bg-emerald-400/[0.06] text-emerald-100/70'}`}>
            {error || message}
          </div>
        )}

        <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-[1.75rem] border border-white/[0.07] bg-white/[0.025] p-5 sm:p-6">
            <h2 className="text-base font-semibold text-white/75">仿真控制</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/32">
              本页连接电脑上的独立 MuJoCo daemon。实体姿态只向仿真单向复制，仿真故障不会阻塞或控制实体舵机。
            </p>
            <label className="mt-6 block text-xs font-semibold text-white/35">仿真服务地址</label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input value={endpoint} onChange={event => setEndpoint(event.target.value)} className="h-11 flex-1 rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 text-sm text-white/65 outline-none focus:border-sky-300/25" />
              <button type="button" onClick={applyEndpoint} className="h-11 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 text-xs font-semibold text-white/55 hover:bg-white/[0.08]">保存地址</button>
            </div>
            <label className="mt-4 block text-xs font-semibold text-white/35">实体机器人 daemon 地址</label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input value={physicalEndpoint} onChange={event => setPhysicalEndpoint(event.target.value)} className="h-11 flex-1 rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 text-sm text-white/65 outline-none focus:border-sky-300/25" />
              <button type="button" onClick={applyPhysicalEndpoint} className="h-11 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 text-xs font-semibold text-white/55 hover:bg-white/[0.08]">保存实体地址</button>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {!backendReady(status) ? (
                <button type="button" disabled={!simulatorReachable || busy !== null} onClick={() => void startBackend()} className="h-11 rounded-xl border border-emerald-300/15 bg-emerald-300/[0.08] px-5 text-xs font-semibold text-emerald-100/75 disabled:opacity-35">
                  {busy === 'start' ? '启动中…' : '启动物理仿真'}
                </button>
              ) : (
                <button type="button" disabled={busy !== null} onClick={() => void stopBackend()} className="h-11 rounded-xl border border-amber-300/15 bg-amber-300/[0.08] px-5 text-xs font-semibold text-amber-100/75 disabled:opacity-35">
                  {busy === 'stop' ? '停止中…' : '停止物理仿真'}
                </button>
              )}
              {!mirroring ? (
                <button type="button" disabled={!backendReady(status)} onClick={startMirror} className="h-11 rounded-xl border border-sky-300/15 bg-sky-300/[0.08] px-5 text-xs font-semibold text-sky-100/75 disabled:opacity-35">镜像实体机器人</button>
              ) : (
                <button type="button" onClick={stopMirror} className="h-11 rounded-xl border border-white/[0.08] bg-white/[0.04] px-5 text-xs font-semibold text-white/55">断开镜像</button>
              )}
            </div>
            {!simulatorReachable && (
              <div className="mt-5 rounded-xl border border-amber-300/10 bg-amber-300/[0.04] p-4 text-xs leading-relaxed text-amber-100/55">
                本机仿真宿主尚未运行。启动 `zebao_daemon/tools/simulation/start_mujoco_shadow.ps1` 后，本页即可管理 MuJoCo backend。
              </div>
            )}
          </div>

          <SimulatedRobotPreview yaw={head?.yaw} pitch={head?.pitch} roll={head?.roll} bodyYaw={simState?.body_yaw} active={backendReady(status)} physics />
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <DiagnosticPanel title="镜像传输">
            <Metric label="已发送帧" value={stats.sent} />
            <Metric label="丢弃帧" value={stats.dropped} warn={stats.dropped > 0} />
            <Metric label="最新帧" value={stats.lastFrameAt ? `${Math.max(0, Date.now() - stats.lastFrameAt)} ms 前` : '--'} />
            <Metric label="当前动作层" value={movement?.motion_priority || '--'} />
            <Metric label="主动作" value={movement?.primary_move?.name || movement?.primary_move?.type || '--'} />
          </DiagnosticPanel>
          <DiagnosticPanel title="实体动作安全包络">
            <Metric label="限速帧" value={safety?.limited_count ?? '--'} warn={(safety?.limited_count ?? 0) > 0} />
            <Metric label="拒绝帧" value={safety?.rejected_count ?? '--'} warn={(safety?.rejected_count ?? 0) > 0} />
            <Metric label="当前比例" value={safety?.last_scale === undefined ? '--' : safety.last_scale.toFixed(3)} />
            <Metric label="最近原因" value={safety?.last_reasons?.join('、') || '无'} />
            <Metric label="思考让权" value={movement?.thinking_motion?.suppressed_by || '无'} />
          </DiagnosticPanel>
        </section>
      </main>
    </div>
  )
}

function StatusCard({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-5">
      <div className="text-xs font-semibold text-white/25">{label}</div>
      <div className={`mt-2 flex items-center gap-2 text-sm font-semibold ${ok ? 'text-emerald-200/75' : 'text-white/45'}`}>
        <span className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-white/20'}`} />
        {value}
      </div>
    </div>
  )
}

function DiagnosticPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-[1.5rem] border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6">
      <h3 className="text-sm font-semibold text-white/65">{title}</h3>
      <div className="mt-4 divide-y divide-white/[0.05]">{children}</div>
    </div>
  )
}

function Metric({ label, value, warn = false }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 text-xs">
      <span className="text-white/30">{label}</span>
      <span className={warn ? 'font-semibold text-amber-200/75' : 'font-semibold text-white/60'}>{value}</span>
    </div>
  )
}
