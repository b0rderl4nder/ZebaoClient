import { Link } from 'react-router-dom'
import { idleResource, tuningResource } from '../../api/deviceSettings'
import { useSettingsDocument } from '../../hooks/useSettingsDocument'
import { NumberControl, ReadFailure, SaveControls, SettingToggle, SettingsPage } from './SettingsControls'

function Breathing() {
  const state = useSettingsDocument(idleResource, false)
  const status = !state.document ? '' : !state.document.available ? '动作服务不可用' : !state.document.values.enabled ? '已关闭' : state.document.active ? '运行中' : state.document.suppressed ? '已开启，当前让位于其他动作' : '已开启，等待空闲'
  return <section className="settings-section" aria-label="待机呼吸"><h2>待机呼吸</h2>{state.document && state.draft ? <><p>{status}</p><SettingToggle label="启用待机呼吸" checked={state.draft.enabled} disabled={state.busy} onChange={enabled => state.setDraft({ enabled })}/><SaveControls {...state}/></> : <ReadFailure {...state}/>}</section>
}
function Turning() {
  const state = useSettingsDocument(tuningResource, false)
  return <section className="settings-section" aria-label="听声转向"><h2>听声转向</h2>{state.document && state.draft ? <><p>看向说话人，不等于开启对话。</p><SettingToggle label="启用听声转向" checked={state.draft.enabled} disabled={state.busy} onChange={enabled => state.setDraft(value => value && ({ ...value, enabled }))}/><SettingToggle label="未唤醒时也看向说话人" checked={state.draft.respond_to_detected_speech} disabled={state.busy || !state.draft.enabled} onChange={respond_to_detected_speech => state.setDraft(value => value && ({ ...value, respond_to_detected_speech }))}/>
    <details><summary>转向幅度与响应参数</summary>{state.document.fields.map(field => <div className="settings-parameter" key={field.key}><strong>{field.label}</strong><NumberControl field={field} value={state.draft!.parameters[field.key]} disabled={state.busy || !state.draft!.enabled} onChange={value => state.setDraft(current => current && ({ ...current, parameters: { ...current.parameters, [field.key]: value } }))}/><details className="settings-help"><summary>参数说明</summary><p>{field.help_text}</p></details></div>)}<button disabled={state.busy} onClick={() => void state.reset()}>恢复设备推荐值</button></details><SaveControls {...state}/>
  </> : <ReadFailure {...state}/>}</section>
}
export default function MotionSettings({ simulated = false }: { simulated?: boolean }) {
  return <SettingsPage title="呼吸与听声转向" simulated={simulated}><Breathing/><Turning/><div className="settings-section settings-related"><Link to="/dashboard/foundation/interaction">模仿、注视与表达 →</Link><Link to="/dashboard/control?tab=pose">姿态与动作控制 →</Link></div></SettingsPage>
}
