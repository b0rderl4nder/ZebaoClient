import { useEffect, useRef, useState } from 'react'
import { catalogRequest } from '../../api/capabilityCatalog'
import { useFormNavigationGuard } from '../../hooks/useFormNavigationGuard'
import { SettingsPage } from './SettingsControls'
import './catalog.css'

interface Fact { id: string; text: string; createdAt: string }
async function readMemory(signal?: AbortSignal) {
  const data = await catalogRequest<{ facts: Fact[] }>('/memory', { signal })
  if (!Array.isArray(data.facts) || data.facts.some(fact => typeof fact.id !== 'string' || typeof fact.text !== 'string')) throw new Error('记忆列表暂不完整，请重新读取。')
  return data.facts
}
export default function MemorySettings({ simulated = false }: { simulated?: boolean }) {
  const [facts, setFacts] = useState<Fact[] | null>(null), [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [revision, setRevision] = useState(0)
  const lock = useRef(false), mounted = useRef(true)
  useFormNavigationGuard(busy, false)
  useEffect(() => {
    const controller = new AbortController(); mounted.current = true
    if (!simulated) {
      setBusy(true); setError('')
      void readMemory(controller.signal).then(value => { if (!controller.signal.aborted) setFacts(value) }).catch(reason => { if (!controller.signal.aborted) setError(reason.message) }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    }
    return () => { mounted.current = false; controller.abort() }
  }, [revision, simulated])
  const remove = async (id?: string) => {
    if (lock.current || busy || !window.confirm(id ? '删除这条长期记忆？无法撤销。' : `清空全部 ${facts?.length || 0} 条长期记忆？无法撤销。`)) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try {
      await catalogRequest(`/memory${id ? `/${encodeURIComponent(id)}` : ''}`, { method: 'DELETE' })
      const confirmed = await readMemory()
      if (id ? confirmed.some(fact => fact.id === id) : confirmed.length) throw new Error('记忆仍在列表中，尚未确认删除，请重新读取。')
      if (mounted.current) { setFacts(confirmed); setNotice('已删除并回读确认') }
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '删除未确认') }
    finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  return <SettingsPage title="长期记忆" simulated={simulated}>
    <p>查看或删除已保存的记忆。现有接口不提供手工新增和编辑。</p>
    <label className="catalog-field">查找记忆<input type="search" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off"/></label>
    {error && <p role="alert" className="workspace-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!facts ? <p role="status">{busy ? '正在读取记忆' : '尚未读取'}</p> : <div className="catalog-list">{facts.filter(fact => fact.text.includes(query.trim())).map((fact, index) => <div className="scene-history-row" key={fact.id}><div>{fact.text}</div><button disabled={busy} aria-label={`删除记忆 ${index + 1}`} onClick={() => void remove(fact.id)}>删除</button></div>)}{!facts.some(fact => fact.text.includes(query.trim())) && <p>{query ? '没有匹配的记忆' : '还没有保存的记忆'}</p>}</div>}
    <div className="settings-actions"><button disabled={busy} onClick={() => { setNotice(''); setRevision(value => value + 1) }}>重新读取</button><button disabled={busy || !facts?.length} onClick={() => void remove()}>清空全部</button></div>
  </SettingsPage>
}
