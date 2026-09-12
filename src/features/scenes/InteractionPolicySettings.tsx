import { useEffect, useRef, useState } from 'react'
import { deleteInteractionPolicy, policyError, policyValues, readPolicyCatalog, saveInteractionPolicy, type InteractionPolicy, type PolicyCatalog, type PolicyField, type PolicyValue } from '../../api/interactionPolicies'

type Edit = { id: string; baseline: InteractionPolicy | null; values: Record<string, PolicyValue> }
export default function InteractionPolicySettings({ selected, disabled, onCatalog, onChoose, onState }: {
  selected: string; disabled: boolean; onCatalog: (items: InteractionPolicy[]) => void; onChoose: (id: string) => void; onState: (state: { busy: boolean; editing: boolean }) => void
}) {
  const [open, setOpen] = useState(false), [catalog, setCatalog] = useState<PolicyCatalog | null>(null)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [revision, setRevision] = useState(0)
  const [edit, setEdit] = useState<Edit | null>(null), [busy, setBusy] = useState(false)
  const lock = useRef(false)
  useEffect(() => { onState({ busy, editing: Boolean(edit) }) }, [busy, Boolean(edit), onState])
  useEffect(() => () => onState({ busy: false, editing: false }), [onState])
  useEffect(() => {
    if (!open) return
    const abort = new AbortController(); setCatalog(null); setError('')
    void readPolicyCatalog(abort.signal).then(data => { if (!abort.signal.aborted) setCatalog(data) }).catch(reason => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : '策略读取失败。') })
    return () => abort.abort()
  }, [open, revision])
  const current = catalog?.policies.find(item => item.id === selected)
  const start = (mode: 'new' | 'copy' | 'edit') => {
    if (!catalog || busy || disabled || mode !== 'new' && !current) return
    const source = mode === 'new' ? catalog.defaults : current!
    const values = policyValues(source, catalog)
    values.name = mode === 'new' ? '' : mode === 'copy' ? `${source.name.slice(0, 27)}副本` : source.name
    setEdit({ id: mode === 'edit' ? source.id : `policy_${Array.from(crypto.getRandomValues(new Uint32Array(3)), value => value.toString(36)).join('')}`, baseline: mode === 'edit' ? source : null, values })
    setNotice(''); setError('')
  }
  const run = async (operation: () => Promise<void>) => {
    if (lock.current || disabled) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try { await operation() } catch (reason) { setError(reason instanceof Error ? reason.message : '策略操作未完成。') }
    finally { lock.current = false; setBusy(false) }
  }
  const cancel = () => { if (!edit || window.confirm('放弃未保存的策略修改？')) { setEdit(null); setError('') } }
  const save = () => {
    if (!edit) return
    if (edit.baseline && !window.confirm('保存后，引用此策略的场景会使用新规则。仅想改变当前场景时，请取消并复制策略。继续保存？')) return
    void run(async () => {
      const data = await saveInteractionPolicy(edit.id, edit.values, edit.baseline)
      setCatalog(data); onCatalog(data.policies); onChoose(edit.id); setEdit(null)
      setNotice(edit.baseline ? '策略已保存并回读。' : '策略已创建；当前场景的选择还需点击下方“保存”。')
    })
  }
  const remove = () => {
    if (!current || current.built_in || !window.confirm(`删除策略“${current.name}”？被场景引用的策略不能删除，此操作不可恢复。`)) return
    void run(async () => {
      const data = await deleteInteractionPolicy(current)
      setCatalog(data); onCatalog(data.policies); onChoose(''); setNotice('策略已删除并回读，请重新选择此场景的交互策略。')
    })
  }
  const field = (item: PolicyField) => {
    if (!edit) return null
    const value = edit.values[item.key]
    const change = (value: PolicyValue) => setEdit(previous => previous ? { ...previous, values: { ...previous.values, [item.key]: value } } : previous)
    const props = { disabled: busy || disabled }
    if (item.kind === 'boolean') return <label className="scene-check" key={item.key}><input type="checkbox" {...props} checked={value === true} onChange={event => change(event.target.checked)}/><span>{item.label}</span></label>
    return <label key={item.key}>{item.label}{item.kind === 'select' ? <select {...props} value={String(value ?? '')} onChange={event => change(event.target.value)}>{!item.options?.some(option => option.value === value) && <option value={String(value ?? '')} disabled>请选择有效选项</option>}{item.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input {...props} type={item.kind === 'number' ? 'number' : 'text'} min={item.minimum} max={item.maximum} maxLength={item.max_length} value={String(value ?? '')} onChange={event => change(item.kind === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)}/>}</label>
  }
  return <div className="scene-policy-settings">
    <button disabled={busy || disabled} aria-expanded={open} onClick={() => { if (edit && !window.confirm('放弃策略草稿并收起？')) return; setEdit(null); setOpen(value => !value) }}>查看与管理策略 {open ? '−' : '+'}</button>
    {open && <section aria-label="交互策略管理">
      {error && <p role="alert">{error}<button disabled={busy || disabled} onClick={() => { if (!edit || window.confirm('重新读取将放弃策略草稿，继续？')) { setEdit(null); setRevision(value => value + 1) } }}>重新读取策略</button></p>}
      {notice && <p role="status">{notice}</p>}
      {!catalog && !error && <p role="status">正在读取策略目录</p>}
      {catalog && !edit && <>
        <p className="scene-hint">{current ? `${current.name}${current.built_in ? ' · 内置只读，可复制' : ' · 可供多个场景引用'}` : '当前策略不在目录中，可新建或重新选择。'}</p>
        {current && <p className="scene-hint">{String(current.description || '')}</p>}
        <div className="scene-buttons"><button disabled={busy || disabled} onClick={() => start('new')}>新建策略</button><button disabled={busy || disabled || !current} onClick={() => start('copy')}>复制策略</button><button disabled={busy || disabled || !current || current.built_in} onClick={() => start('edit')}>编辑策略</button><button disabled={busy || disabled || !current || current.built_in} onClick={remove}>删除策略</button></div>
      </>}
      {catalog && edit && <div className="scene-policy-editor" aria-label="策略编辑">
        <div className="scene-policy-fields">{catalog.fields.filter(item => !item.advanced).map(field)}</div>
        <details className="parameter-help"><summary>高级准入检查</summary><div className="scene-policy-fields">{catalog.fields.filter(item => item.advanced).map(field)}</div></details>
        <p className="scene-hint">这是可复用规则，不是语音模型。云端原生链路不使用这些兼容准入选项。</p>
        <div className="scene-buttons"><button disabled={busy || disabled} onClick={cancel}>取消策略编辑</button><button disabled={busy || disabled || Boolean(policyError(edit.values, catalog))} onClick={save}>{busy ? '保存策略中' : '保存策略'}</button></div>
        {policyError(edit.values, catalog) && <p role="status" className="scene-hint">{policyError(edit.values, catalog)}</p>}
      </div>}
    </section>}
  </div>
}
