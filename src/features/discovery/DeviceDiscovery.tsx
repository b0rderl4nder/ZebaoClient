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
  const [address, setAddress] = useState('')
  const [showSubnet, setShowSubnet] = useState(false)
  const [subnet, setSubnet] = useState('')
  const recent = loadRecentRobots()

  const connect = (host: string, port = DEFAULT_DAEMON_PORT) => {
    saveRecentRobot(host, port)
    onConnect(host, port)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const value = address.trim()
    if (!value) return
    const [host, rawPort] = value.split(':')
    connect(host, rawPort ? Number(rawPort) : DEFAULT_DAEMON_PORT)
  }

  return <main className="discovery-page">
    <section className="discovery-card">
      <header><span className="discovery-mark">Z</span><div><h1>连接泽宝</h1><p>选择附近设备，或输入设备地址。</p></div></header>
      {error && <div className="discovery-error" role="alert">{error}</div>}
      <form onSubmit={submit} className="discovery-address">
        <label htmlFor="robot-address">设备地址</label>
        <div><input id="robot-address" value={address} onChange={event => setAddress(event.target.value)} placeholder="192.168.3.83"/><button type="submit">连接</button></div>
      </form>
      <button type="button" className="discovery-scan" onClick={() => onScan()} disabled={scanning}>{scanning ? '正在搜索' : '搜索附近设备'}</button>
      {devices.length > 0 && <div className="discovery-list" aria-label="发现的设备">{devices.map(device => <button key={`${device.host}:${device.port}`} onClick={() => connect(device.host, device.port)}><i/><span>{device.host}:{device.port}</span><small>连接</small></button>)}</div>}
      {!devices.length && recent.length > 0 && <div className="discovery-list" aria-label="最近连接">{recent.slice(0, 3).map(robot => <button key={`${robot.host}:${robot.port}`} onClick={() => connect(robot.host, robot.port)}><i/><span>{robot.host}:{robot.port}</span><small>最近</small></button>)}</div>}
      {scanSummary && <p className="discovery-summary">{scanSummary}</p>}
      <div className="discovery-more">
        <button type="button" onClick={() => setShowSubnet(value => !value)}>{showSubnet ? '收起高级搜索' : '指定网段'}</button>
        <button type="button" onClick={onSimulate}>预览界面</button>
      </div>
      {showSubnet && <div className="discovery-subnet"><input aria-label="网段" value={subnet} onChange={event => setSubnet(event.target.value)} placeholder="10.83.0.0/24"/><button type="button" onClick={() => onScan(subnet)} disabled={!subnet.trim() || scanning}>搜索</button></div>}
    </section>
  </main>
}
