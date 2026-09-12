import { useEffect, useState } from 'react'
import { importPerson, readImportCandidates, type ImportCandidate } from '../../api/people'
import { useCredentialOperation } from './useCredentialOperation'

export default function FaceImport({ personId, personName, onComplete, onCancel, onBusy }: { personId?: string; personName?: string; onComplete: (id: string) => void; onCancel: () => void; onBusy?: (busy: boolean) => void }) {
  const [candidates, setCandidates] = useState<ImportCandidate[] | null>(null)
  const [selected, setSelected] = useState('')
  const [name, setName] = useState(personName || '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  useCredentialOperation(busy)
  useEffect(() => {
    const controller = new AbortController(); setBusy(true)
    void readImportCandidates(controller.signal).then(data => { if (!controller.signal.aborted) { setCandidates(data); setError('') } }).catch(reason => { if (!controller.signal.aborted) setError(reason.message) }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [revision])
  const apply = async () => {
    const candidate = candidates?.find(item => item.provider_subject === selected && !item.linked)
    if (!candidate || !name.trim() || busy) return
    setBusy(true); onBusy?.(true); setError('')
    try { onComplete(await importPerson(candidate, name, personId)) } catch (reason) { setError(reason instanceof Error ? reason.message : '导入结果未确认，请刷新人员列表。') } finally { setBusy(false); onBusy?.(false) }
  }
  return <section className="people-import" aria-label="从人脸库导入"><h2>{personId ? '关联人脸' : '从人脸库导入'}</h2><p>只建立本地关联，不复制人脸图片。</p>{error && <p role="alert">{error}</p>}{!candidates ? <button disabled={busy} onClick={() => setRevision(value => value + 1)}>{busy ? '正在读取人脸库' : '重试读取'}</button> : <><label>选择人员<select aria-label="选择人脸库人员" value={selected} disabled={busy} onChange={event => { setSelected(event.target.value); if (!personId) setName(candidates.find(item => item.provider_subject === event.target.value)?.suggested_name || '') }}><option value="">请选择</option>{candidates.map(item => <option key={item.provider_subject} value={item.provider_subject} disabled={item.linked}>{item.suggested_name}{item.linked ? '（已关联）' : ''}</option>)}</select></label>{!candidates.length && <p>人脸库暂无可导入人员。</p>}<label>档案姓名<input value={name} maxLength={40} disabled={busy || Boolean(personId)} onChange={event => setName(event.target.value)}/></label></>}<div className="settings-actions"><button disabled={busy} onClick={onCancel}>取消</button><button className="workspace-primary" disabled={busy || !selected || !name.trim()} onClick={() => void apply()}>{busy ? '处理中' : personId ? '确认关联' : '确认导入'}</button></div></section>
}
