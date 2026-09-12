import { useEffect, useRef, useState } from 'react'
import { catalogRequest } from '../../api/capabilityCatalog'
import { useFormNavigationGuard } from '../../hooks/useFormNavigationGuard'
import { SettingsPage } from './SettingsControls'
import './catalog.css'

interface QuietState { active: boolean; until: number; remaining_seconds: number }
async function readQuiet(signal?: AbortSignal): Promise<QuietState> {
  const result = await catalogRequest<QuietState>('/quiet-mode', { signal })
  if (typeof result.active !== 'boolean' || !Number.isFinite(result.remaining_seconds)) throw new Error('静默状态不完整，请重新读取。')
  return result
}
export default function QuietSettings({ simulated = false }: { simulated?: boolean }) {
  const [data, setData] = useState<QuietState | null>(null), [minutes, setMinutes] = useState(120)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [revision, setRevision] = useState(0)
  const lock = useRef(false), mounted = useRef(true)
  useFormNavigationGuard(busy, false)
  useEffect(() => {
    const controller = new AbortController(); mounted.current = true
    if (!simulated) {
      setBusy(true); setError('')
      void readQuiet(controller.signal).then(value => { if (!controller.signal.aborted) setData(value) }).catch(reason => { if (!controller.signal.aborted) setError(reason.message) }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    }
    return () => { mounted.current = false; controller.abort() }
  }, [revision, simulated])
  const change = async (enable: boolean) => {
    if (lock.current || busy) return
    if (enable && (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)) { setError('请输入 1–1440 分钟。'); return }
    if (!window.confirm(enable ? `开始静默 ${minutes} 分钟？会影响当前交流和主动播报。` : '提前结束静默？')) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try {
      await catalogRequest('/quiet-mode', enable ? { method: 'PATCH', body: JSON.stringify({ duration_minutes: minutes }) } : { method: 'DELETE' })
      const current = await readQuiet()
      if (current.active !== enable || enable && (current.remaining_seconds <= 0 || Math.abs(current.remaining_seconds - minutes * 60) > 30)) throw new Error('静默结果尚未回读确认，请刷新，不要重复提交。')
      if (mounted.current) { setData(current); setNotice(enable ? '静默已生效并回读' : '静默已结束并回读') }
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '操作未确认') }
    finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  return <SettingsPage title="定时静默" simulated={simulated}><section className="settings-section">
    <div className="settings-current"><span>读取时状态</span><strong>{data ? data.active ? `静默中 · 剩余约 ${Math.ceil(data.remaining_seconds / 60)} 分钟` : '未开启' : '等待读取'}</strong></div>
    <p>仅在主动设置后生效，到时自动结束；不会关闭设备或改写场景。</p>
    <label className="catalog-field">静默时长（分钟）<input type="number" min={1} max={1440} value={minutes || ''} disabled={busy} onChange={event => setMinutes(Number(event.target.value))}/></label>
    <div className="settings-actions"><button className="workspace-primary" disabled={busy || !data} onClick={() => void change(true)}>开始静默</button><button disabled={busy || !data?.active} onClick={() => void change(false)}>结束静默</button><button disabled={busy} onClick={() => { setNotice(''); setRevision(value => value + 1) }}>刷新状态</button></div>
    {error && <p role="alert" className="workspace-error">{error}</p>}{notice && <p role="status">{notice}</p>}
  </section></SettingsPage>
}
