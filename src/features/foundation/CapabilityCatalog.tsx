import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { archiveCapability, nativeCapabilitySettings, readCapabilityCatalog, setCapabilityEnabled, type CapabilityCatalog as Catalog, type CatalogItem } from '../../api/capabilityCatalog'
import { operatorPage } from '../../api/operator'
import { useFormNavigationGuard } from '../../hooks/useFormNavigationGuard'
import { ReadFailure, SettingsPage } from './SettingsControls'
import './catalog.css'

export default function CapabilityCatalog({ simulated = false }: { simulated?: boolean }) {
  const [data, setData] = useState<Catalog | null>(null)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false), [revision, setRevision] = useState(0)
  const [query, setQuery] = useState(''), [section, setSection] = useState('global')
  const lock = useRef(false), mounted = useRef(true)
  useFormNavigationGuard(busy, false)
  useEffect(() => {
    const controller = new AbortController(); mounted.current = true
    if (!simulated) {
      setBusy(true); setError('')
      void readCapabilityCatalog(controller.signal).then(value => { if (!controller.signal.aborted) setData(value) }).catch(reason => { if (!controller.signal.aborted) setError(reason.message) }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    }
    return () => { mounted.current = false; controller.abort() }
  }, [revision, simulated])
  const run = async (task: () => Promise<Catalog>, message: string) => {
    if (lock.current || busy) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try { const result = await task(); if (mounted.current) { setData(result); setNotice(message) } }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '操作未确认，请重新读取。') }
    finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  const archive = (item: CatalogItem, restoring: boolean) => {
    if (!window.confirm(restoring ? `恢复“${item.name}”到可用目录？恢复后的场景挂载请重新核对。` : `删除“${item.name}”并从挂载它的场景中移除？可在已删除中恢复。`)) return
    void run(() => archiveCapability(item.id, restoring), restoring ? '已恢复并回读，请检查场景挂载。' : '已删除并回读，可从已删除目录恢复。')
  }
  const candidates = section === 'deleted' ? data?.deleted_catalog : data?.catalog.filter(item => item.product_layer !== 'infrastructure' && (section === 'global' ? item.scope === 'global' || item.product_layer === 'foundation' : item.scope !== 'global' && item.product_layer !== 'foundation'))
  const items = candidates?.filter(item => `${item.name}${item.description || ''}${item.category || ''}`.includes(query.trim())) || []
  return <SettingsPage title="能力管理" simulated={simulated}>{data ? <>
    <div className="catalog-toolbar"><nav aria-label="能力范围">{[['global', '全局与基础'], ['scene', '场景能力'], ['deleted', '已删除']].map(([id, name]) => <button key={id} aria-pressed={section === id} onClick={() => setSection(id)}>{name}</button>)}</nav><label><span className="sr-only">查找能力</span><input type="search" placeholder="查找能力" value={query} onChange={event => setQuery(event.target.value)}/></label></div>
    <p className="scene-hint">{section === 'scene' ? '这里管理可用目录，进入场景选择挂载和参数。' : section === 'deleted' ? '恢复后核对总开关与场景挂载。' : '设备设置独立控制，场景切换不复制这些配置。'}</p>
    {error && <p role="alert" className="workspace-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="catalog-list">{items.map(item => {
      const native = nativeCapabilitySettings(item.id)
      const runtime = item.runtime_state
      const deviceControlled = item.product_layer === 'foundation' || Boolean(item.runtime_control)
      const enabled = data.global_enabled.includes(item.id)
      return <details key={item.id}><summary><strong>{item.name}</strong><span>{section === 'deleted' ? '已删除' : deviceControlled ? runtime ? runtime.configured_enabled === false || runtime.enabled === false ? '设备已关闭' : runtime.active ? '运行中' : '等待运行' : '设备独立设置' : item.locked ? '基础项' : enabled ? '总开关开启' : '总开关关闭'}</span></summary><div className="catalog-detail">
        <p>{item.detail || item.description || '由机器人运行组件提供。'}</p>
        {section === 'deleted' ? <button disabled={busy} onClick={() => archive(item, true)}>恢复能力</button> : <>
          {!item.locked && !deviceControlled && <label className="scene-check"><input type="checkbox" checked={enabled} disabled={busy} onChange={event => { const next = event.target.checked; void run(() => setCapabilityEnabled(item.id, next, data), '总开关已保存并回读') }}/><span>允许使用{item.name}</span></label>}
          <div className="catalog-links">{native ? <Link to={`/dashboard/foundation/${native}`}>配置{item.name} →</Link> : item.settings_route ? <a href={operatorPage(item.settings_route)} target="_blank" rel="noreferrer">高级配置（尚待迁入） ↗</a> : null}
          {item.scope === 'scene' && !deviceControlled && <Link to="/dashboard/scenes">选择场景与参数 →</Link>}
          {item.deletable && <button disabled={busy} onClick={() => archive(item, false)}>删除能力</button>}</div>
          {item.examples?.length ? <details className="parameter-help"><summary>使用示例</summary><ul>{item.examples.map(text => <li key={text}>{text}</li>)}</ul></details> : null}
        </>}
      </div></details>
    })}</div>{!items.length && <p className="workspace-empty">{query ? '没有匹配的能力' : section === 'deleted' ? '没有已删除的能力' : '暂无能力'}</p>}
    <button disabled={busy} onClick={() => { setNotice(''); setRevision(value => value + 1) }}>重新读取目录</button>
  </> : <ReadFailure busy={busy} error={error} refresh={() => setRevision(value => value + 1)}/>}</SettingsPage>
}
