import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createPerson, readPeople, type Person } from '../../api/people'
import FaceImport from './FaceImport'
import VoiceTest from './VoiceTest'
import { useCredentialOperation } from './useCredentialOperation'
import '../foundation/settings.css'
import './people.css'

export default function People({ simulated = false }: { simulated?: boolean }) {
  const navigate = useNavigate()
  const [people, setPeople] = useState<Person[] | null>(null)
  const [search, setSearch] = useState('')
  const [name, setName] = useState('')
  const [editor, setEditor] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  useCredentialOperation(busy)
  useEffect(() => {
    const controller = new AbortController()
    if (!simulated) void readPeople(controller.signal).then(data => { if (!controller.signal.aborted) { setPeople(data); setError('') } }).catch(reason => { if (!controller.signal.aborted) setError(reason.message) })
    return () => controller.abort()
  }, [simulated, revision])
  const openPerson = (id: string) => navigate(`/dashboard/foundation/people/${encodeURIComponent(id)}`)
  const create = async () => {
    if (busy || !name.trim()) return
    setBusy(true); setError('')
    try { openPerson(await createPerson(name)) } catch (reason) { setError(reason instanceof Error ? reason.message : '创建未确认，请刷新列表。') } finally { setBusy(false) }
  }
  return <div className="workspace-page native-settings people-page"><header className="product-header"><div><Link className="workspace-back" to="/dashboard/foundation">← 基础系统</Link><h1>人员与身份</h1></div><button className="workspace-primary" disabled={simulated || busy} onClick={() => setEditor('create')}>添加人员</button></header><div className="workspace-body">
    {simulated ? <p>连接设备后管理真实人员。</p> : <>
      {error && <div className="settings-notice"><p role="alert">{error}</p><button onClick={() => setRevision(value => value + 1)}>重新读取</button></div>}
      {editor === 'create' && <section className="people-import"><h2>添加人员</h2><form onSubmit={event => { event.preventDefault(); void create() }}><label>姓名<input value={name} maxLength={40} disabled={busy} onChange={event => setName(event.target.value)} autoFocus/></label><div className="settings-actions"><button type="button" disabled={busy} onClick={() => setEditor('')}>取消</button><button className="workspace-primary" disabled={busy || !name.trim()}>创建档案</button></div></form><button disabled={busy} onClick={() => setEditor('import')}>从人脸库导入</button></section>}
      {editor === 'import' && <FaceImport onBusy={setBusy} onComplete={openPerson} onCancel={() => setEditor('')}/>}
      <label className="people-search"><span className="sr-only">查找人员</span><input type="search" placeholder="查找人员" value={search} onChange={event => setSearch(event.target.value)}/></label>
      {!people ? !error && <p role="status">正在读取人员</p> : <><div className="people-directory">{people.filter(person => `${person.display_name} ${person.salutation} ${person.role}`.includes(search.trim())).map(person => <Link key={person.person_id} to={`/dashboard/foundation/people/${encodeURIComponent(person.person_id)}`}><div><strong>{person.display_name}</strong><small>{[person.voiceprint.registered && '声纹', person.face.linked && '人脸'].filter(Boolean).join(' · ') || '待添加身份凭证'}</small></div><span>{person.identity_ready ? '身份可用' : '待完善'}</span><span aria-hidden="true">→</span></Link>)}</div>{!people.length && <p className="workspace-empty">暂无人员，先创建档案或从人脸库导入。</p>}{people.length > 0 && !people.some(person => `${person.display_name} ${person.salutation} ${person.role}`.includes(search.trim())) && <p>没有找到相关人员。</p>}</>}
      {!editor && <VoiceTest onBusy={setBusy}/>}
    </>}
  </div></div>
}
