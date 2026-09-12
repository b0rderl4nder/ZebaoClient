import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { equalHa, haValidation, networkWrite, normalizeZones, readHa, type HaDocument, type HaValues, type InspectionZone } from '../../api/networkSettings'
import { useFormNavigationGuard } from '../../hooks/useFormNavigationGuard'
import { ReadFailure, SaveControls, SettingToggle } from './SettingsControls'

export default function HomeAssistantSettings() {
  const [document, setDocument] = useState<HaDocument | null>(null), [draft, setDraft] = useState<HaValues | null>(null)
  const [token, setToken] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [revision, setRevision] = useState(0)
  const lock = useRef(false), mounted = useRef(true)
  const dirty = Boolean(token || document && draft && !equalHa(document.values, draft))
  useFormNavigationGuard(busy, dirty)
  useEffect(() => {
    const controller = new AbortController(); mounted.current = true; setBusy(true)
    void readHa(controller.signal).then(data => { if (!controller.signal.aborted) { setDocument(data); setDraft(data.values); setError(''); setToken('') } }).catch(reason => { if (!controller.signal.aborted) setError(reason.message) }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => { mounted.current = false; controller.abort() }
  }, [revision])
  const refresh = () => { if (!busy && (!dirty || window.confirm('放弃未保存的配置并重新读取？'))) { setNotice(''); setRevision(value => value + 1) } }
  const run = async (action: () => Promise<void>) => {
    if (lock.current || busy) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try { await action() } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '配置结果未确认，请重新读取。') } finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  const save = () => run(async () => {
    if (!document || !draft) return
    const next = { ...draft, base_url: draft.base_url.trim().replace(/\/+$/, ''), inspection_zones: normalizeZones(draft.inspection_zones) }
    const invalid = haValidation(next, token, document); if (invalid) throw new Error(invalid)
    const latest = await readHa(); if (!mounted.current) return
    if (!equalHa(document.values, latest.values)) throw new Error('配置已在其他页面修改，请重新读取。')
    const patch = { enabled: next.enabled, base_url: next.base_url, ...(equalHa({ ...document.values, inspection_zones: next.inspection_zones }, document.values) ? {} : { inspection_zones: next.inspection_zones }), ...(token.trim() ? { access_token: token.trim() } : {}) }
    const submittedToken = Boolean(token.trim())
    try {
      await networkWrite('home-assistant', 'PATCH', patch)
      if (!mounted.current) return
      const confirmed = await readHa()
      if (!equalHa(confirmed.values, next) || submittedToken && !confirmed.status.token_present) throw new Error('保存后的配置与请求不一致。')
      if (mounted.current) { setDocument(confirmed); setDraft(confirmed.values); setNotice('配置已保存并回读；连接状态单独核验。') }
    } catch (reason) { throw new Error(`${reason instanceof Error ? reason.message : '保存失败。'} 请求可能已生效，请重新读取，勿重复提交。`) }
    finally { if (mounted.current) setToken('') }
  })
  const probe = () => run(async () => { await networkWrite('home-assistant/probe', 'POST'); if (!mounted.current) return; const confirmed = await readHa(); setDocument(confirmed); setDraft(confirmed.values); if (!confirmed.status.connected) throw new Error('连接测试未确认服务在线。'); setNotice('已验证服务连接，未操作任何物联网设备。') })
  const updateZone = (index: number, change: Partial<InspectionZone>) => setDraft(value => value && ({ ...value, inspection_zones: value.inspection_zones.map((zone, i) => i === index ? { ...zone, ...change } : zone) }))
  if (!document || !draft) return <ReadFailure busy={busy} error={error} refresh={refresh}/>
  return <section className="settings-section" aria-label="物联网连接"><div className="settings-row"><div><h2>Home Assistant</h2><p>{document.status.connected ? '服务已连接' : document.status.configured ? '已配置，服务未连接' : '尚未配置'}</p></div><button disabled={busy || dirty} onClick={() => void probe()}>测试连接</button></div><p>此处配置服务连接；各场景选择允许使用的设备。</p><fieldset disabled={busy} className="network-fields"><SettingToggle label="启用物联网服务" checked={draft.enabled} disabled={busy} onChange={enabled => setDraft({ ...draft, enabled })}/><details><summary>编辑地址与凭据</summary><div className="settings-fields"><label>服务地址<input value={draft.base_url} onChange={event => setDraft({ ...draft, base_url: event.target.value })} placeholder="http://设备地址:8123" autoComplete="off"/></label><label>访问令牌<input type="password" value={token} onChange={event => setToken(event.target.value)} autoComplete="new-password" placeholder={document.status.token_present ? '留空保留已保存令牌' : '首次启用需要令牌'}/></label></div></details>
    <details><summary>巡查区域 · {draft.inspection_zones.length}</summary><p>定义区域和语音别名，不会扩大场景的设备操作范围。</p>{draft.inspection_zones.map((zone, index) => <details className="network-zone" key={zone.zone_id}><summary>{zone.name || '新区域'} · {zone.entity_ids.length} 台设备</summary><div className="settings-fields"><label>区域名称<input aria-label={`区域 ${index + 1} 名称`} value={zone.name} maxLength={60} onChange={event => updateZone(index, { name: event.target.value })}/></label><label>语音别名<input aria-label={`区域 ${index + 1} 别名`} value={zone.aliases.join('，')} onChange={event => updateZone(index, { aliases: event.target.value.split(/[，,；;]/) })} placeholder="逗号分隔"/></label></div><label className="network-select">添加设备<select value="" aria-label={`区域 ${index + 1} 添加设备`} onChange={event => { if (event.target.value) updateZone(index, { entity_ids: [...zone.entity_ids, event.target.value] }) }}><option value="">选择已接入设备</option>{document.entities.filter(entity => !zone.entity_ids.includes(entity.entity_id)).map(entity => <option key={entity.entity_id} value={entity.entity_id}>{entity.friendly_name}{entity.available ? '' : '（离线）'}</option>)}</select></label>{zone.entity_ids.map(id => <div className="network-item" key={id}><span>{document.entities.find(entity => entity.entity_id === id)?.friendly_name || `已保存设备（${id}）`}</span><button onClick={() => updateZone(index, { entity_ids: zone.entity_ids.filter(value => value !== id) })}>移除</button></div>)}<button onClick={() => setDraft({ ...draft, inspection_zones: draft.inspection_zones.filter((_, i) => i !== index) })}>删除区域</button></details>)}<button disabled={draft.inspection_zones.length >= 12} onClick={() => setDraft({ ...draft, inspection_zones: [...draft.inspection_zones, { zone_id: `zone-${Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)}`, name: '', aliases: [], entity_ids: [] }] })}>添加巡查区域</button></details>
    </fieldset><SaveControls busy={busy} dirty={dirty} error={error} notice={notice} save={save} refresh={refresh}/><div className="settings-related"><Link to="/dashboard/scenes">配置场景内设备范围 →</Link></div></section>
}
