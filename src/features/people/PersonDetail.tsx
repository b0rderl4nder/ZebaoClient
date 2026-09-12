import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { personResource, removePerson, unlinkFace, type PersonValues } from '../../api/people'
import { peopleRequest } from '../../api/people'
import { useSettingsDocument } from '../../hooks/useSettingsDocument'
import { ReadFailure, SaveControls, SettingToggle } from '../foundation/SettingsControls'
import FaceImport from './FaceImport'
import PreferencesEditor from './PreferencesEditor'
import VoiceCredential from './VoiceCredential'
import { useCredentialOperation } from './useCredentialOperation'
import './people.css'

const tabs = { profile: '资料与偏好', identity: '身份与权限', greeting: '主动协作' }
const privacyLabels = { share_salutation: '称呼', share_language: '语言偏好', share_response_style: '回答风格', share_business_preferences: '业务偏好', ambient_identity_enabled: '静默身份识别', activity_visible: '后台活动记录' }
export default function PersonDetail({ simulated = false }: { simulated?: boolean }) {
  const { id = '' } = useParams()
  return <PersonEditor key={id} id={id} simulated={simulated}/>
}
function PersonEditor({ id, simulated }: { id: string; simulated: boolean }) {
  const navigate = useNavigate()
  const resource = useMemo(() => personResource(id), [id])
  const state = useSettingsDocument(resource, simulated)
  const [tab, setTab] = useState<keyof typeof tabs>('profile')
  const [linking, setLinking] = useState(false)
  const [enrolling, setEnrolling] = useState(false)
  const [credentialBusy, setCredentialBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [scenes, setScenes] = useState<{ id: string; name: string }[] | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    if (!simulated) void peopleRequest<{ scenes: { id: string; name: string }[] }>('ui/scenes', { signal: controller.signal }).then(data => { if (!controller.signal.aborted && Array.isArray(data.scenes)) setScenes(data.scenes) }).catch(() => { if (!controller.signal.aborted) setScenes(null) })
    return () => controller.abort()
  }, [simulated])
  const person = state.document?.person, draft = state.draft
  const disabled = busy || state.busy || credentialBusy
  useCredentialOperation(busy || credentialBusy)
  const edit = <K extends keyof PersonValues>(key: K, value: PersonValues[K]) => state.setDraft(current => current && ({ ...current, [key]: value }))
  const action = async (run: () => Promise<void>) => { if (disabled) return; setBusy(true); setError(''); try { await run() } catch (reason) { setError(reason instanceof Error ? reason.message : '操作未确认，请重新读取。') } finally { setBusy(false) } }
  const remove = () => { if (disabled || enrolling || linking || !person || !window.confirm(`删除“${person.display_name}”的本地档案、权限和关联？远端人脸不删除。`)) return; return action(async () => { await removePerson(id); navigate('/dashboard/foundation/people') }) }
  return <div className="workspace-page native-settings people-page"><header className="product-header"><div><Link className="workspace-back" to="/dashboard/foundation/people">← 人员</Link><h1>{person?.display_name || '人员档案'}</h1></div>{person && <button disabled={disabled || enrolling || linking} onClick={() => void remove()}>删除人员</button>}</header><div className="workspace-body">
    {simulated ? <p>连接设备后管理真实人员。</p> : !person || !draft ? <ReadFailure {...state}/> : <>
      <nav className="people-tabs" aria-label="人员设置">{Object.entries(tabs).map(([key, label]) => <button key={key} disabled={disabled || enrolling || linking} aria-pressed={tab === key} onClick={() => setTab(key as keyof typeof tabs)}>{label}</button>)}</nav>
      {error && <p role="alert" className="workspace-error">{error}</p>}
      <fieldset disabled={disabled} className="people-fields">
      {tab === 'profile' && <><div className="settings-fields"><label>姓名<input maxLength={40} value={draft.display_name} onChange={event => edit('display_name', event.target.value)} onBlur={() => edit('display_name', draft.display_name.trim())}/></label><label>称呼<input maxLength={30} value={draft.salutation} onChange={event => edit('salutation', event.target.value)}/></label><label>角色<input maxLength={60} value={draft.role} onChange={event => edit('role', event.target.value)}/></label><label>首选语言<select value={draft.preferred_language} onChange={event => edit('preferred_language', event.target.value)}><option value="auto">跟随当前问题</option><option value="zh-CN">中文</option><option value="en-US">英语</option><option value="ja-JP">日语</option><option value="ko-KR">韩语</option></select></label><label className="people-wide">回答风格<input maxLength={120} value={draft.response_style} placeholder="如：简洁、专业、先给结论" onChange={event => edit('response_style', event.target.value)}/></label></div>
      <PreferencesEditor title="家具偏好" values={draft.furniture_preferences} disabled={disabled} onChange={value => edit('furniture_preferences', value)}/><PreferencesEditor title="办公偏好" values={draft.office_preferences} disabled={disabled} onChange={value => edit('office_preferences', value)}/>
      <details className="people-privacy"><summary>隐私与模型可用字段</summary>{Object.entries(privacyLabels).map(([key,label]) => <SettingToggle key={key} label={label} checked={draft.privacy[key] === true} disabled={disabled} onChange={value => edit('privacy', { ...draft.privacy, [key]: value })}/>)}<p>前四项控制模型个性化卡片；身份凭证不发送给模型。</p></details></>}
      {tab === 'identity' && <><section className="settings-section"><h2>身份凭证</h2><p>{person.identity_ready ? '身份可用' : '待完成声纹或人脸凭证'}</p><div className="people-credential"><div><strong>声纹</strong><p>{person.voiceprint.registered ? `${person.voiceprint.sample_count} 段样本` : '尚未录入'}</p></div><button disabled={disabled || state.dirty || linking || enrolling} onClick={() => setEnrolling(true)}>{person.voiceprint.registered ? '补录声纹' : '录入声纹'}</button></div>{enrolling && <VoiceCredential person={person} onBusy={setCredentialBusy} onComplete={state.refresh} onCancel={() => setEnrolling(false)}/>}<div className="people-credential"><div><strong>人脸</strong><p>{person.face.linked ? '已关联人脸库' : '尚未关联'}</p></div>{person.face.linked ? <button disabled={disabled || state.dirty || enrolling} onClick={() => void action(async () => { if (!window.confirm('移除本地人脸关联？不会删除远端人脸。')) return; await unlinkFace(person); state.refresh() })}>移除关联</button> : <button disabled={disabled || state.dirty || enrolling || linking} onClick={() => setLinking(true)}>关联人脸</button>}</div>{linking && <FaceImport personId={person.person_id} personName={person.display_name} onBusy={setCredentialBusy} onComplete={() => { setLinking(false); state.refresh() }} onCancel={() => setLinking(false)}/>}</section>
      <section className="settings-section"><h2>能力权限</h2><p>只在身份确认且当前场景已启用能力时执行。</p>{state.document!.permissions.length ? state.document!.permissions.map(permission => <div className="people-permission" key={permission.id}><SettingToggle label={permission.name} checked={draft.permissions.includes(permission.id)} disabled={disabled || enrolling || linking} onChange={enabled => edit('permissions', (enabled ? [...new Set([...draft.permissions, permission.id])] : draft.permissions.filter(id => id !== permission.id)).sort())}/><details><summary>权限说明</summary><p>{permission.description}</p></details></div>) : <p>能力权限清单暂不可用，不能新增授权。</p>}</section></>}
      {tab === 'greeting' && <section className="settings-section"><SettingToggle label="到场主动问候" checked={draft.proactive_greeting_enabled} disabled={disabled} onChange={value => edit('proactive_greeting_enabled', value)}/><p>受当前场景主动交互策略和全局冷却共同约束。</p><label className="people-cooldown">问候冷却（分钟）<input type="number" min={1} max={1440} value={Number.isFinite(draft.greeting_cooldown_seconds) ? draft.greeting_cooldown_seconds / 60 : ''} onChange={event => edit('greeting_cooldown_seconds', event.target.valueAsNumber * 60)}/></label><h2>允许问候的场景</h2><p>不勾选表示全部支持问候的场景。</p>{scenes ? scenes.map(scene => <SettingToggle key={scene.id} label={scene.name} checked={draft.greeting_scene_ids.includes(scene.id)} disabled={disabled} onChange={enabled => edit('greeting_scene_ids', enabled ? [...new Set([...draft.greeting_scene_ids, scene.id])] : draft.greeting_scene_ids.filter(id => id !== scene.id))}/>) : <p>场景目录暂不可用，已保存的选择保持不变。</p>}{draft.greeting_scene_ids.filter(id => !scenes?.some(scene => scene.id === id)).map(id => <SettingToggle key={id} label={`已保存场景（${id}）`} checked disabled={disabled || !scenes} onChange={() => edit('greeting_scene_ids', draft.greeting_scene_ids.filter(value => value !== id))}/>)}</section>}
      </fieldset><SaveControls {...state} busy={disabled || enrolling || linking}/>
    </>}
  </div></div>
}
