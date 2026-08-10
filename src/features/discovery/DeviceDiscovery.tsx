import { useState, type FormEvent } from 'react'
import { DEFAULT_DAEMON_PORT } from '../../api/client'
import { loadRecentRobots, saveRecentRobot } from '../../utils/storage'

interface Props {
  onConnect: (host: string, port: number) => void
  onSimulate: () => void
  scanning: boolean
  devices: { host: string; port: number }[]
  onScan: (subnet?: string) => void
  scanSummary: string | null
  error: string | null
}

export default function DeviceDiscovery({ onConnect, onSimulate, scanning, devices, onScan, scanSummary, error }: Props) {
  const [ip, setIP] = useState('')
  const [subnet, setSubnet] = useState('')
  const recent = loadRecentRobots()

  const connect = (host: string, port = DEFAULT_DAEMON_PORT) => {
    saveRecentRobot(host, port)
    onConnect(host, port)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!ip.trim()) return
    const [host, rawPort] = ip.trim().split(':')
    const port = rawPort ? parseInt(rawPort, 10) : DEFAULT_DAEMON_PORT
    connect(host, port)
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 sm:px-6 sm:py-16">
      <div className="w-full max-w-lg animate-fade-in">
        <div className="text-center mb-10 sm:mb-12">
          <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-6 sm:mb-8 rounded-[1.5rem] bg-gradient-to-br from-sky-400/15 to-blue-500/8 border border-white/[0.08] flex items-center justify-center">
            <svg className="w-9 h-9 text-sky-300/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.5c4.5 0 8.2 3.7 8.2 8.2S16.5 20 12 20s-8.2-3.7-8.2-8.2S7.5 3.5 12 3.5Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 11.5h.01M15.5 11.5h.01M9.4 15c1.7 1.2 3.5 1.2 5.2 0" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold tracking-[-0.02em] text-white/90 mb-3">Zebao Control</h1>
          <p className="text-white/35 text-base font-light">连接 Reachy Mini daemon，管理小泽机器人</p>
        </div>

        {error && (
          <div className="mb-6 p-5 rounded-2xl bg-red-500/[0.06] border border-red-500/[0.15] text-red-300/70 text-sm">{error}</div>
        )}

        <form onSubmit={submit} className="mb-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={ip}
              onChange={event => setIP(event.target.value)}
              placeholder="输入 IP，例如 192.168.2.95"
              className="flex-1 h-14 px-5 bg-white/[0.04] border border-white/[0.08] rounded-2xl text-white/70 placeholder:text-white/[0.18] text-sm focus:outline-none focus:border-white/[0.15] focus:bg-white/[0.06] transition-all duration-300"
            />
            <button type="submit" className="h-14 px-8 bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.06] rounded-2xl text-white/70 hover:text-white/90 text-sm font-semibold transition-all duration-300 active:scale-[0.97]">连接</button>
          </div>
        </form>

        <div className="mb-8 space-y-3">
          <button
            type="button"
            onClick={() => onScan()}
            disabled={scanning}
            className="w-full h-14 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.05] rounded-2xl text-white/35 hover:text-white/55 text-sm font-medium transition-all duration-300 disabled:opacity-30 flex items-center justify-center gap-2.5"
          >
            {scanning ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-15" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                  <path className="opacity-70" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                </svg>
                扫描中...
              </>
            ) : '自动搜索局域网设备'}
          </button>

          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={subnet}
              onChange={event => setSubnet(event.target.value)}
              placeholder="指定网段，例如 192.168.2 或 10.0.0.0/24"
              className="flex-1 h-12 px-4 bg-white/[0.03] border border-white/[0.06] rounded-2xl text-white/60 placeholder:text-white/[0.16] text-xs focus:outline-none focus:border-white/[0.13] focus:bg-white/[0.05] transition-all duration-300"
            />
            <button
              type="button"
              onClick={() => onScan(subnet)}
              disabled={scanning || !subnet.trim()}
              className="h-12 px-5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] rounded-2xl text-white/45 hover:text-white/70 text-xs font-semibold transition-all duration-300 disabled:opacity-30"
            >
              扫描该网段
            </button>
          </div>
        </div>

        {scanSummary && (
          <p className="-mt-5 mb-7 px-1 text-center text-xs leading-relaxed text-white/[0.24]">{scanSummary}</p>
        )}

        {devices.length > 0 && (
          <div className="mb-8">
            <p className="text-white/[0.16] text-xs font-semibold uppercase tracking-[0.2em] mb-4 px-1">发现设备</p>
            <div className="space-y-2">
              {devices.map(device => (
                <button
                  key={`${device.host}:${device.port}`}
                  type="button"
                  onClick={() => connect(device.host, device.port)}
                  className="w-full flex items-center gap-4 p-5 bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.05] hover:border-white/[0.1] rounded-2xl text-left transition-all duration-200"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80 shadow-[0_0_10px_rgba(52,211,153,0.4)] shrink-0" />
                  <span className="text-white/60 text-sm font-medium">{device.host}:{device.port}</span>
                  <span className="text-white/[0.18] text-xs ml-auto">Reachy Mini</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {recent.length > 0 && (
          <div className="mb-8">
            <p className="text-white/[0.16] text-xs font-semibold uppercase tracking-[0.2em] mb-3 px-1">最近连接</p>
            <div className="space-y-1">
              {recent.slice(0, 5).map(robot => (
                <button
                  key={`${robot.host}:${robot.port}`}
                  type="button"
                  onClick={() => connect(robot.host, robot.port)}
                  className="w-full text-left px-4 py-3 text-white/[0.24] hover:text-white/[0.5] hover:bg-white/[0.02] rounded-xl text-sm transition-all duration-200"
                >
                  {robot.host}:{robot.port}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-white/[0.05] pt-5 text-center">
          <p className="mb-3 text-xs text-white/[0.18]">没有可用设备时，可以进入演示模式熟悉界面。</p>
          <button
            type="button"
            onClick={onSimulate}
            className="inline-flex h-9 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.02] px-4 text-xs font-medium text-white/28 transition hover:bg-white/[0.05] hover:text-white/48"
          >
            进入演示模式
          </button>
        </div>
      </div>
    </div>
  )
}
