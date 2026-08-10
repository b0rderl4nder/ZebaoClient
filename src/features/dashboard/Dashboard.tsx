import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AppStatus, DaemonStatus } from '../../api/types'
import { fetchDaemonStatus, restartDaemon, startDaemon, stopDaemon } from '../../api/daemon'
import { getCurrentAppStatus } from '../../api/apps'
import { setMotorMode } from '../../api/motors'
import { getFullState } from '../../api/state'
import SimulatedRobotPreview from '../simulation/SimulatedRobotPreview'

const CARDS = [
  { to: '/dashboard/motions', icon: 'ACT', title: '动作表情', desc: '播放已适配的表情和舞蹈动作，并同步眼睛屏表情脚本。' },
  { to: '/dashboard/pose', icon: 'POS', title: '姿态控制', desc: '查看头部状态，控制头部姿态、抬降和身体旋转。' },
  { to: '/dashboard/apps', icon: 'APP', title: '应用管理', desc: '浏览、安装、启动和停止 daemon 管理的机器人应用。' },
  { to: '/dashboard/chat', icon: 'AI', title: '文字对话', desc: '通过 conversation app 的文本接口验证对话链路。' },
  { to: '/dashboard/simulation', icon: 'SIM', title: 'MuJoCo 物理仿真', desc: '在官方物理模型中镜像实体姿态，检查动作冲突、超速和异常跳变。' },
]

const CONTROL_POLL_MS = 500
const START_TIMEOUT_MS = 20000
const STOP_TIMEOUT_MS = 30000
const RESTART_TIMEOUT_MS = 25000

function delay(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

function isRunning(app: AppStatus | null): boolean {
  return app?.state === 'starting' || app?.state === 'running'
}

function statusBackendReady(status: DaemonStatus | null): boolean {
  return status?.backend_status?.ready ?? status?.ready ?? false
}

function motorMode(status: DaemonStatus | null, stateMotorMode?: string): string {
  if (status && status.state !== 'running' && !status.backend_status && !status.motor_control_mode) return '--'
  return status?.backend_status?.motor_control_mode ?? status?.motor_control_mode ?? stateMotorMode ?? '--'
}

async function waitForDaemonStatus(
  accept: (status: DaemonStatus) => boolean,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<DaemonStatus> {
  const startedAt = Date.now()
  let lastStatus: DaemonStatus | null = null
  let lastError: unknown = null

  while (Date.now() - startedAt < timeoutMs) {
    try {
      lastStatus = await fetchDaemonStatus()
      lastError = null
      if (accept(lastStatus)) return lastStatus
    } catch (error) {
      lastError = error
    }
    await delay(CONTROL_POLL_MS)
  }

  const detail = lastStatus?.error
    ?? lastStatus?.backend_status?.error
    ?? (lastError instanceof Error ? lastError.message : '')
  throw new Error(detail ? `${timeoutMessage}：${detail}` : timeoutMessage)
}

export default function Dashboard({
  host,
  simulated = false,
  onSwitchDevice,
}: {
  host: string
  simulated?: boolean
  onSwitchDevice?: () => void
}) {
  const [status, setStatus] = useState<DaemonStatus | null>(
    simulated ? { ready: true, motor_control_mode: 'simulated', state: 'simulated' } : null,
  )
  const [stateReachable, setStateReachable] = useState(simulated)
  const [stateMotorMode, setStateMotorMode] = useState<string | undefined>(simulated ? 'simulated' : undefined)
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [controlError, setControlError] = useState<string | null>(null)
  const [app, setApp] = useState<AppStatus | null>(
    simulated
      ? {
          info: { name: 'zebao_exhibition_conversation_app', source_kind: 'simulated', description: '模拟展厅对话应用' },
          state: 'running',
        }
      : null,
  )

  useEffect(() => {
    if (simulated) return
    const poll = () => {
      fetchDaemonStatus().then(setStatus).catch(() => {})
      getFullState()
        .then(fullState => {
          setStateReachable(true)
          setStateMotorMode(fullState.control_mode)
        })
        .catch(() => setStateReachable(false))
      getCurrentAppStatus().then(setApp).catch(() => {})
    }
    poll()
    const interval = setInterval(poll, 4000)
    return () => clearInterval(interval)
  }, [simulated])

  const daemonError = status?.error ?? status?.backend_status?.error ?? null
  const ready = simulated || (!daemonError && (statusBackendReady(status) || stateReachable))
  const mode = motorMode(status, stateMotorMode)
  const daemonOnline = simulated || (status?.state === 'running' && !status.error)

  const startControl = async () => {
    if (simulated) return
    setStarting(true)
    setControlError(null)
    try {
      await startDaemon(false)
      const runningStatus = await waitForDaemonStatus(
        nextStatus => nextStatus.state === 'running' && statusBackendReady(nextStatus),
        START_TIMEOUT_MS,
        '启动机器人控制超时',
      )
      await setMotorMode('enabled')
      const fullState = await getFullState()
      setStatus(runningStatus)
      setStateReachable(true)
      setStateMotorMode(fullState.control_mode)
    } catch (startError) {
      setControlError(startError instanceof Error ? startError.message : '启动机器人控制失败')
    } finally {
      setStarting(false)
    }
  }

  const stopControl = async () => {
    if (simulated) return
    setStopping(true)
    setControlError(null)
    try {
      await stopDaemon(true)
      const stoppedStatus = await waitForDaemonStatus(
        nextStatus => nextStatus.state !== 'running' && !statusBackendReady(nextStatus),
        STOP_TIMEOUT_MS,
        '停止机器人控制超时',
      )
      setStatus(stoppedStatus)
      setStateReachable(false)
      setStateMotorMode(undefined)
    } catch (stopError) {
      setControlError(stopError instanceof Error ? stopError.message : '停止机器人控制失败')
    } finally {
      setStopping(false)
    }
  }

  const restartControl = async () => {
    if (simulated) return
    setRestarting(true)
    setControlError(null)
    try {
      await restartDaemon()
      const runningStatus = await waitForDaemonStatus(
        nextStatus => nextStatus.state === 'running' && statusBackendReady(nextStatus),
        RESTART_TIMEOUT_MS,
        '重启机器人控制超时',
      )
      const fullState = await getFullState()
      setStatus(runningStatus)
      setStateReachable(true)
      setStateMotorMode(fullState.control_mode)
    } catch (restartError) {
      setControlError(restartError instanceof Error ? restartError.message : '重启机器人控制失败')
    } finally {
      setRestarting(false)
    }
  }

  return (
    <div className="min-h-screen animate-fade-in">
      <nav className="sticky top-0 z-50 bg-[#080810]/80 backdrop-blur-2xl border-b border-white/[0.05]">
        <div className="max-w-6xl mx-auto px-6 md:px-10 h-16 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white/85 tracking-tight">Zebao</h1>
            <p className="text-white/[0.18] text-xs">{host || '--'}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold ${
              ready ? 'bg-emerald-500/[0.06] text-emerald-300/70 border border-emerald-500/[0.12]' : 'bg-amber-500/[0.06] text-amber-300/70 border border-amber-500/[0.12]'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${ready ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]' : 'bg-amber-400'}`} />
              {simulated ? '模拟中' : ready ? '就绪' : '等待中'}
            </span>
            {onSwitchDevice && (
              <button
                type="button"
                onClick={onSwitchDevice}
                className="h-8 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-semibold text-white/42 transition hover:bg-white/[0.07] hover:text-white/70"
              >
                切换设备
              </button>
            )}
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 md:px-10 py-12">
        {simulated && (
          <div className="mb-8">
            <SimulatedRobotPreview active />
          </div>
        )}

        {!simulated && (
          <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-white/70">机器人控制状态</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <StatusLight label="状态流" ok={stateReachable} />
                <StatusLight label="Daemon" ok={daemonOnline} />
                <StatusLight label="舵机" ok={mode === 'enabled'} value={mode} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {!daemonOnline && (
                <button
                  type="button"
                  onClick={() => void startControl()}
                  disabled={starting}
                  className="h-10 rounded-xl border border-sky-300/[0.16] bg-sky-400/[0.08] px-4 text-xs font-semibold text-sky-100/72 transition hover:bg-sky-400/[0.14] disabled:opacity-40"
                >
                  {starting ? '启动中...' : '启动控制'}
                </button>
              )}
              {daemonOnline && (
                <button
                  type="button"
                  onClick={() => void stopControl()}
                  disabled={stopping}
                  className="h-10 rounded-xl border border-amber-300/[0.16] bg-amber-400/[0.08] px-4 text-xs font-semibold text-amber-100/72 transition hover:bg-amber-400/[0.14] disabled:opacity-40"
                >
                  {stopping ? '停止中...' : '停止控制'}
                </button>
              )}
              <button
                type="button"
                onClick={() => void restartControl()}
                disabled={restarting}
                className="h-10 rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 text-xs font-semibold text-white/55 transition hover:bg-white/[0.07] disabled:opacity-40"
              >
                {restarting ? '重启中...' : '重启控制'}
              </button>
            </div>
          </div>
        )}
        {(controlError || daemonError) && (
          <div className="mb-6 rounded-2xl border border-rose-500/[0.16] bg-rose-500/[0.06] p-4 text-sm text-rose-200/78">{controlError || daemonError}</div>
        )}

        <div className="mb-4 flex items-center justify-between">
          <h2 className="m-0 text-sm font-semibold text-white/65">控制</h2>
          <span className="text-xs text-white/35">{isRunning(app) ? app?.info.name ?? 'App 运行中' : '无运行应用'}</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {CARDS.map(card => (
            <Link key={card.to} to={card.to} aria-label={`${card.title}：${card.desc}`} title={card.desc} className="bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.05] hover:border-white/[0.1] rounded-2xl p-4 group no-underline flex min-h-[108px] flex-col justify-between transition-all duration-200">
              <div className="inline-flex h-9 min-w-9 w-fit items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] px-2.5 text-xs font-semibold text-amber-200/70">{card.icon}</div>
              <h3 className="m-0 text-white/70 text-sm font-semibold group-hover:text-white/90 transition-colors">{card.title}</h3>
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}

function StatusLight({ label, ok, value }: { label: string; ok: boolean; value?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${ok ? 'border-emerald-400/[0.14] bg-emerald-400/[0.06] text-emerald-200/70' : 'border-rose-400/[0.14] bg-rose-400/[0.06] text-rose-200/70'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.55)]' : 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.45)]'}`} />
      {label}{value ? ` ${value}` : ''}
    </span>
  )
}
