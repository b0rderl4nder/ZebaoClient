import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { changePrompt, promptApplyLabel, readPrompts, type PromptChange, type PromptDocument, type PromptSlot } from '../../api/prompts'
import { useFormNavigationGuard } from '../../hooks/useFormNavigationGuard'
import { ReadFailure, SettingsPage } from './SettingsControls'
import './prompts.css'

export default function PromptSettings({ simulated = false }: { simulated?: boolean }) {
  const [params] = useSearchParams()
  const [document, setDocument] = useState<PromptDocument | null>(null), [selected, setSelected] = useState(params.get('slot') || '')
  const [query, setQuery] = useState(''), [category, setCategory] = useState(''), [variantId, setVariantId] = useState('default')
  const [draft, setDraft] = useState<{ mode: 'create' | 'update'; id?: string; name: string; text: string } | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [revision, setRevision] = useState(0)
  const lock = useRef(false), mounted = useRef(true)
  useFormNavigationGuard(busy, Boolean(draft))
  useEffect(() => {
    const abort = new AbortController(); mounted.current = true
    if (!simulated) {
      setBusy(true); setError('')
      void readPrompts(abort.signal).then(data => { if (!abort.signal.aborted) {
        setDocument(data)
        const slot = data.slots.find(item => item.id === selected)
        if (slot) setVariantId(slot.active_variant_id)
      } }).catch(() => { if (!abort.signal.aborted) setError('无法读取提示词，请检查连接后重试。') }).finally(() => { if (!abort.signal.aborted) setBusy(false) })
    }
    return () => { mounted.current = false; abort.abort() }
    // Selection changes are local; only explicit refresh reloads the document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulated, revision])
  const slot = document?.slots.find(item => item.id === selected)
  const variant = slot?.variants.find(item => item.id === variantId)
  const text = variantId === 'default' ? slot?.default_text : variant?.text
  const discard = () => !draft || window.confirm('放弃尚未保存的版本修改？')
  const selectSlot = (next: PromptSlot) => {
    if (busy || !discard()) return
    setSelected(next.id); setVariantId(next.active_variant_id); setDraft(null); setError(''); setNotice('')
  }
  const run = async (change: PromptChange) => {
    if (!slot || busy || lock.current) return
    if (change.kind === 'activate' && !window.confirm(`启用此版本用于“${slot.name}”？${promptApplyLabel(slot.apply_mode)}。不改变场景挂载或语音链路。`)) return
    if (change.kind === 'delete' && !window.confirm(variantId === slot.active_variant_id ? '删除当前版本？将恢复该用途的默认提示词，删除无法撤销。' : '删除此版本？无法撤销。')) return
    if (change.kind === 'update' && change.id === slot.active_variant_id && !window.confirm('正在修改启用中的版本，保存后将影响后续请求。继续？')) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const next = await changePrompt(slot, change)
      if (mounted.current) {
        setDocument(next); setDraft(null)
        const updated = next.slots.find(item => item.id === slot.id)!
        if (change.kind === 'create') setVariantId(updated.variants.find(item => !slot.variants.some(old => old.id === item.id))?.id || updated.active_variant_id)
        else if (change.kind === 'delete') setVariantId(updated.active_variant_id)
        else if (change.kind === 'activate') setVariantId(change.id)
        setNotice(!next.persistent ? '已回读，但服务未启用持久保存，重启可能丢失。' : change.kind === 'create' ? '新版本已保存，尚未启用。' : change.kind === 'activate' || change.kind === 'update' && change.id === slot.active_variant_id ? `配置已回读；${promptApplyLabel(slot.apply_mode)}。` : '版本变更已回读确认。')
      }
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '操作未确认，请重新读取。') }
    finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  const refresh = () => { if (!busy && discard()) { setDraft(null); setNotice(''); setRevision(value => value + 1) } }
  const visible = document?.slots.filter(item => (!category || item.category === category) && `${item.name}${item.description}`.includes(query.trim())) || []
  return <SettingsPage title="提示词" simulated={simulated}>
    {!document ? <ReadFailure busy={busy} error={error} refresh={refresh}/> : <>
      <p className="settings-footnote">按用途管理版本。默认版本保留，新建不自动启用。</p>
      <div className={`prompt-filters${slot ? ' has-selection' : ''}`}><label><span className="sr-only">查找提示词</span><input type="search" placeholder="查找用途" value={query} onChange={event => setQuery(event.target.value)}/></label><label><span className="sr-only">提示词分类</span><select value={category} onChange={event => setCategory(event.target.value)}><option value="">全部用途</option>{[...new Set(document.slots.map(item => item.category))].map(name => <option key={name}>{name}</option>)}</select></label><button disabled={busy} onClick={refresh}>重新读取</button></div>
      {error && <p className="workspace-error" role="alert">{error}</p>}{notice && <p className="settings-notice" role="status">{notice}</p>}
      <div className={`prompt-workspace${slot ? ' has-selection' : ''}`}>
        <nav className="prompt-list" aria-label="提示词用途">{visible.map(item => <button key={item.id} disabled={busy} aria-pressed={item.id === selected} onClick={() => selectSlot(item)}><strong>{item.name}</strong><span>{!item.editable ? '只读' : item.active_variant_id === 'default' ? '默认' : '自定义'}</span></button>)}{!visible.length && <p>没有匹配的用途</p>}</nav>
        <section className="prompt-editor" aria-label="提示词版本管理">{!slot ? <p className="workspace-empty">选择一个用途，查看内容和生效版本。</p> : <>
          <button className="prompt-back" disabled={busy} onClick={() => { if (discard()) { setSelected(''); setDraft(null) } }}>← 用途列表</button>
          <h2>{slot.name}</h2><p>{slot.description}</p>
          <label className="prompt-version">查看版本<select aria-label="查看版本" disabled={busy || Boolean(draft)} value={variantId} onChange={event => { setVariantId(event.target.value); setNotice('') }}><option value="default">默认版本{slot.active_variant_id === 'default' ? ' · 当前启用' : ''}</option>{slot.variants.map(item => <option key={item.id} value={item.id}>{item.name}{slot.active_variant_id === item.id ? ' · 当前启用' : ''}</option>)}</select></label>
          <p className="settings-footnote">{promptApplyLabel(slot.apply_mode)}{!document.persistent ? ' · 服务未启用持久保存' : ''}</p>
          {draft ? <form onSubmit={event => { event.preventDefault(); void run({ kind: draft.mode, id: draft.id, name: draft.name, text: draft.text }) }}>
            <label>版本名称<input value={draft.name} maxLength={48} required disabled={busy} onChange={event => setDraft({ ...draft, name: event.target.value })}/></label>
            <label>提示词内容<textarea value={draft.text} rows={12} required disabled={busy} onChange={event => setDraft({ ...draft, text: event.target.value })}/></label>
            <p className="settings-footnote">{[...draft.text].length} / {slot.max_chars} 字{slot.variables.length ? ` · 必须保留：${slot.variables.map(name => `{${name}}`).join('、')}` : ''}</p>
            <div className="prompt-actions"><button type="button" disabled={busy} onClick={() => { if (discard()) setDraft(null) }}>取消</button><button type="submit" className="workspace-primary" disabled={busy}>保存版本</button></div>
          </form> : <>
            <pre className="prompt-text">{text ?? '此版本已不可用，请重新读取。'}</pre>
            {slot.editable && <div className="prompt-actions"><button disabled={busy} onClick={() => setDraft({ mode: 'create', name: '', text: '' })}>新增版本</button><button disabled={busy || text === undefined} onClick={() => setDraft({ mode: 'create', name: `${variant?.name || '默认'}副本`.slice(0, 48), text: text || '' })}>复制此版本</button>
              {variant && <button disabled={busy} onClick={() => setDraft({ mode: 'update', id: variant.id, name: variant.name, text: variant.text })}>编辑</button>}
              {variantId !== slot.active_variant_id && <button className="workspace-primary" disabled={busy || text === undefined} onClick={() => void run({ kind: 'activate', id: variantId })}>{variantId === 'default' ? '恢复默认' : '启用此版本'}</button>}
              {variant && <button disabled={busy} onClick={() => void run({ kind: 'delete', id: variant.id })}>删除版本</button>}
            </div>}
          </>}
          <details className="settings-help"><summary>使用范围与变量</summary><p>{slot.used_by.join('、') || '由服务维护用途关联'}</p><p>{slot.variables.length ? slot.variables.map(name => `{${name}}`).join('、') : '无模板变量'}</p><p>这里只管理对应用途，不切换语音、不挂载能力。启用版本不代表模型已完成一次使用验证。</p></details>
        </>}</section>
      </div>
    </>}
  </SettingsPage>
}
