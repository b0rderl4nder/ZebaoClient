import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AppStatus, DaemonStatus } from '../../api/types'
import { fetchDaemonStatus, restartDaemon, startDaemon, stopDaemon } from '../../api/daemon'
import { getCurrentAppStatus } from '../../api/apps'
import { setMotorMode } from '../../api/motors'
import { getFullState } from '../../api/state'

const links = [
  { to: '/dashboard/control', title: '控制', note: '动作与姿态' },
  { to: '/dashboard/apps', title: '应用', note: '安装与运行' },
  { to: '/dashboard/chat', title: '对话', note: '最近状态' },
  { to: '/dashboard/simulation', title: '仿真', note: '真实模型与物理验证' },
]

const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms))
const backendReady = (status: DaemonStatus | null) => status?.backend_status?.ready ?? status?.ready ?? false

async function waitForState(accept: (status: DaemonStatus) => boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  let latest: DaemonStatus | null = null
  while (Date.now() < deadline) {
    try { latest = await fetchDaemonStatus(); if (accept(latest)) return latest } catch { /* retry while daemon changes state */ }
    await wait(450)
  }
  throw new Error(latest?.error || '设备状态更新超时')
}

export default function Dashboard({ host, simulated = false, onSwitchDevice }: { host: string; simulated?: boolean; onSwitchDevice?: () => void }) {
  const [status, setStatus] = useState<DaemonStatus | null>(simulated ? { ready: true, state: 'simulated', motor_control_mode: 'simulated' } : null)
  const [app, setApp] = useState<AppStatus | null>(simulated ? { info: { name: 'preview', source_kind: 'simulated', description: '' }, state: 'running' } : null)
  const [stateOnline, setStateOnline] = useState(simulated)
  const [busy, setBusy] = useState<'start' | 'stop' | 'restart' | ''>('')
  const [error, setError] = useState('')

  const refresh = () => {
    if (simulated) return
    fetchDaemonStatus().then(setStatus).catch(() => setStatus(null))
    getFullState().then(() => setStateOnline(true)).catch(() => setStateOnline(false))
    getCurrentAppStatus().then(setApp).catch(() => setApp(null))
  }

  useEffect(() => {
    refresh()
    if (simulated) return
    const timer = window.setInterval(refresh, 4000)
    return () => window.clearInterval(timer)
  }, [simulated])

  const run = async (action: 'start' | 'stop' | 'restart') => {
    if (simulated) return
    setBusy(action); setError('')
    try {
      if (action === 'start') {
        await startDaemon(false)
        setStatus(await waitForState(next => next.state === 'running' && backendReady(next), 20000))
        await setMotorMode('enabled')
      } else if (action === 'stop') {
        await stopDaemon(true)
        setStatus(await waitForState(next => next.state !== 'running' && !backendReady(next), 30000))
      } else {
        await restartDaemon()
        setStatus(await waitForState(next => next.state === 'running' && backendReady(next), 25000))
      }
      refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '设备操作失败') }
    finally { setBusy('') }
  }

  const ready = simulated || stateOnline || backendReady(status)
  const running = simulated || status?.state === 'running'
  const appRunning = app?.state === 'running' || app?.state === 'starting'

  return <div className="dashboard-page">
    <header className="product-header"><div><h1>概览</h1><p>{simulated ? '界面预览' : host || '等待设备'}</p></div><span className={`dashboard-health ${ready ? 'is-online' : ''}`}><i/>{ready ? '设备在线' : '设备离线'}</span></header>
    <main className="dashboard-body">
      {error && <div className="dashboard-error" role="alert">{error}</div>}
      <section className="dashboard-state">
        <div><span>机器人控制</span><strong>{running ? '运行中' : '已停止'}</strong></div>
        <div><span>对话应用</span><strong>{appRunning ? '运行中' : '未运行'}</strong></div>
        {!simulated && <div className="dashboard-controls">{running ? <button onClick={() => void run('stop')} disabled={Boolean(busy)}>{busy === 'stop' ? '正在停止' : '停止'}</button> : <button className="is-primary" onClick={() => void run('start')} disabled={Boolean(busy)}>{busy === 'start' ? '正在启动' : '启动'}</button>}<button onClick={() => void run('restart')} disabled={Boolean(busy)}>{busy === 'restart' ? '正在重启' : '重启'}</button></div>}
      </section>
      <nav className="dashboard-actions" aria-label="常用控制">{links.map(item => <Link key={item.to} to={item.to}><strong>{item.title}</strong><span>{item.note}</span></Link>)}</nav>
      {onSwitchDevice && <button className="dashboard-switch" type="button" onClick={onSwitchDevice}>切换设备</button>}
    </main>
  </div>
}
