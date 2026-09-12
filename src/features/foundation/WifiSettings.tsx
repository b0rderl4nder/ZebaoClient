import { useEffect, useRef, useState } from 'react'
import { networkWrite, readWifi, wifiValidation, type WifiState } from '../../api/networkSettings'
import { useFormNavigationGuard } from '../../hooks/useFormNavigationGuard'
export default function WifiSettings() {
  const [data, setData] = useState<WifiState | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [ssid, setSsid] = useState(''), [password, setPassword] = useState(''), [hotspotName, setHotspotName] = useState(''), [hotspotPassword, setHotspotPassword] = useState('')
  const [networks, setNetworks] = useState<string[] | null>(null), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0), [pending, setPending] = useState(false)
  const lock = useRef(false), mounted = useRef(true)
  useFormNavigationGuard(busy, Boolean(ssid || password || hotspotName || hotspotPassword))
  useEffect(() => {
    const controller = new AbortController(); mounted.current = true
    void readWifi(controller.signal).then(value => { if (!controller.signal.aborted) { setData(value); setError('') } }).catch(reason => { if (!controller.signal.aborted) setError(reason.message) })
    return () => { mounted.current = false; controller.abort() }
  }, [revision])
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try { await action() } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '操作未确认，请重新读取。') } finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  const scan = () => run(async () => { const result = await networkWrite<{ networks: string[] }>('network/wifi/scan', 'POST'); if (!Array.isArray(result.networks)) throw new Error('没有收到有效扫描结果。'); if (mounted.current) setNetworks(result.networks) })
  const connect = (hotspot = false) => {
    const name = hotspot ? hotspotName : ssid, secret = hotspot ? hotspotPassword : password
    const invalid = wifiValidation(name, secret, hotspot); if (invalid) { setError(invalid); return }
    if (pending || !window.confirm(`${hotspot ? '启动热点' : '切换网络'}会断开当前 Wi-Fi，页面可能失联。确认操作？`)) return
    return run(async () => {
      setPending(true)
      try {
        await networkWrite(hotspot ? 'network/hotspot' : 'network/wifi/connect', 'POST', { ssid: name, password: secret })
        if (!mounted.current) return
        const current = await readWifi(); setData(current)
        if (!hotspot && current.wifi.connected_network === name) { setNotice('已回读确认当前连接。'); setPending(false); setSsid('') }
        else setNotice('请求已提交，尚未确认连接结果。请重新读取，不要重复切网。')
      } catch { if (mounted.current) setError('尚未确认网络结果：切网可能已生效。请连接目标网络或机器人热点后重新读取，不要重复提交。') }
      finally { if (mounted.current) { setPassword(''); setHotspotPassword('') } }
    })
  }
  const forget = (name: string) => { if (!window.confirm(`忘记连接配置“${name}”？${name === data?.wifi.connected_network ? '它正在使用，可能导致断连。' : ''}`)) return; return run(async () => {
    await networkWrite(`network/wifi/${encodeURIComponent(name)}`, 'DELETE'); if (!mounted.current) return
    const current = await readWifi(); setData(current)
    if (current.wifi.known_networks.includes(name)) throw new Error('设备仍保留此连接配置，未确认删除成功。')
    setNotice('已忘记并回读确认。')
  }) }
  const field = data?.field_network
  const fieldLabel = !field || !Object.keys(field).length ? '状态待确认' : field.portable_mode ? field.end_to_end_ready === true ? '外带服务可达' : '外带服务尚未连通' : field.route_available === true ? '当前服务可达' : '当前服务尚未连通'
  return <section className="settings-section" aria-label="网络连接"><div className="settings-row"><div><h2>Wi-Fi</h2><p>当前连接配置：{data?.wifi.connected_network || (data ? '未连接' : '正在读取')}</p></div><button disabled={busy} onClick={() => void run(async () => { const current = await readWifi(); if (mounted.current) { setData(current); setPending(false); setNotice('状态已重新读取；切网前请核对当前连接。') } })}>重新读取网络</button></div><p>{fieldLabel}</p>
    {error && <p role="alert" className="workspace-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <details><summary>连接或更换 Wi-Fi</summary><fieldset disabled={busy || pending} className="network-fields"><button onClick={() => void scan()}>扫描附近网络</button>{networks && <label>附近网络<select value={ssid} onChange={event => setSsid(event.target.value)}><option value="">{networks.length ? '选择网络' : '未发现网络，可手动填写'}</option>{networks.map(name => <option key={name}>{name}</option>)}</select></label>}<div className="settings-fields"><label>网络名称<input value={ssid} onChange={event => setSsid(event.target.value)} autoComplete="off"/></label><label>Wi-Fi 密码<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" placeholder="开放网络可留空"/></label></div><button onClick={() => void connect()} className="workspace-primary">连接网络</button></fieldset></details>
    <details><summary>已保存连接 · {data?.wifi.known_networks.length ?? '—'}</summary><p>设备可能返回连接配置名，不一定等于 Wi-Fi 名称。</p>{data?.wifi.known_networks.map(name => <div className="network-item" key={name}><span>{name}{data.wifi.connected_network === name ? ' · 当前' : ''}</span><button disabled={busy || pending} onClick={() => void forget(name)}>忘记</button></div>)}</details>
    <details><summary>启动临时配网热点</summary><p>沿用设备原接口，不改变 EdgeLink 自动恢复规则。</p><fieldset disabled={busy || pending} className="network-fields"><div className="settings-fields"><label>热点名称<input value={hotspotName} onChange={event => setHotspotName(event.target.value)} autoComplete="off"/></label><label>热点密码<input type="password" value={hotspotPassword} onChange={event => setHotspotPassword(event.target.value)} placeholder="8–63 位" autoComplete="new-password"/></label></div><button onClick={() => void connect(true)}>启动热点</button></fieldset></details>
    {!data && <button disabled={busy} onClick={() => setRevision(value => value + 1)}>重试读取</button>}
  </section>
}
