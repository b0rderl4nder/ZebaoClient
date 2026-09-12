import { useEffect, useState } from 'react'
import { clearObservations, readObservations, visionFields, visionResource, type Observation, type VisionValues } from '../../api/deviceSettings'
import { useSettingsDocument } from '../../hooks/useSettingsDocument'
import { NumberControl, ReadFailure, SaveControls, SettingToggle, SettingsPage } from './SettingsControls'

function Observations() {
  const [rows, setRows] = useState<Observation[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [readAt, setReadAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const controller = new AbortController()
    setBusy(true)
    void readObservations(controller.signal).then(data => { if (!controller.signal.aborted) { setRows(data); setReadAt(Date.now()); setNow(Date.now()); setError('') } }).catch(() => { if (!controller.signal.aborted) { setRows(null); setError('最近观察读取失败，请重试。') } }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [revision])
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  const clear = async () => {
    if (busy || !window.confirm('清除当前环境观察？不会删除人员或知识库。')) return
    setBusy(true); setError('')
    try { await clearObservations(); const data = await readObservations(); setRows(data); setReadAt(Date.now()); if (data.length) setError('已请求清除，设备当前仍有观察记录，请重新读取核对。') }
    catch { setError('清除结果未确认，请重新读取。') }
    finally { setBusy(false) }
  }
  const fresh = rows?.filter(row => row.expires_in_ms > now - readAt)
  return <section className="settings-section" aria-label="最近观察"><div className="settings-row"><h2>最近观察</h2><div className="settings-inline-actions"><button disabled={busy} onClick={() => setRevision(value => value + 1)}>刷新观察</button><button disabled={busy || !rows?.length} onClick={() => void clear()}>清除观察</button></div></div>{error && <p role="alert">{error}</p>}{!rows && !error ? <p role="status">正在读取观察</p> : !fresh?.length ? <p>暂无有效观察</p> : <ul className="settings-observations">{fresh.map(row => <li key={row.sequence}><p>{row.summary}</p><small>剩余 {Math.ceil((row.expires_in_ms - (now - readAt)) / 1000)} 秒</small></li>)}</ul>}</section>
}
function VisionForm() {
  const state = useSettingsDocument(visionResource, false)
  const phases: Record<string, string> = { startup: '建立观察基线', empty_local_only: '无人，仅本地观察', occupied_recent: '有人，按需复查', occupied_stable: '画面稳定，降低调用频率', occupied_deep_stable: '长期稳定，降低调用频率', empty_unconfirmed: '等待确认是否有人', fixed_occupied: '有人，固定间隔复查', fixed_empty: '无人，固定间隔复查' }
  return <section className="settings-section" aria-label="环境观察设置"><h2>环境观察</h2>{state.document && state.draft ? <><p>{!state.document.values.enabled ? '已关闭' : phases[state.document.phase] || '运行阶段待确认'}</p><SettingToggle label="启用环境观察" checked={state.draft.enabled} disabled={state.busy} onChange={enabled => state.setDraft(value => value && ({ ...value, enabled }))}/><SettingToggle label="允许重要事件主动开口" checked={state.draft.proactive_enabled} disabled={state.busy || !state.draft.enabled} onChange={proactive_enabled => state.setDraft(value => value && ({ ...value, proactive_enabled }))}/><p>主动开口仍遵循当前场景与全局冷却规则。</p><details><summary>调用频率与用量</summary><SettingToggle label="稳定画面自动减少调用" checked={state.draft.adaptive_cloud_enabled} disabled={state.busy} onChange={adaptive_cloud_enabled => state.setDraft(value => value && ({ ...value, adaptive_cloud_enabled }))}/>{visionFields.map(field => <div key={field.key} className="settings-parameter"><strong>{field.label}</strong><NumberControl field={field} value={state.draft![field.key as keyof VisionValues] as number} disabled={state.busy} onChange={value => state.setDraft(current => current && ({ ...current, [field.key]: value }))}/><p>{field.help_text}</p></div>)}<p>最近十分钟调用：{state.document.calls ?? '待确认'}</p></details><SaveControls {...state}/></> : <ReadFailure {...state}/>}</section>
}
export default function VisionSettings({ simulated = false }: { simulated?: boolean }) {
  return <SettingsPage title="视觉" simulated={simulated}><VisionForm/><Observations/><p className="settings-footnote">显式看图由场景中的视觉能力提供；此页不读取或缓存原始图片。</p></SettingsPage>
}
