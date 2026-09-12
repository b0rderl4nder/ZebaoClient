import { gainResource, microphoneResource, speakerResource, type VolumeDocument } from '../../api/deviceSettings'
import { useSettingsDocument, type SettingsResource } from '../../hooks/useSettingsDocument'
import { NumberControl, ReadFailure, SaveControls, SettingsPage } from './SettingsControls'

function VolumeSetting({ title, resource, help }: { title: string; resource: SettingsResource<{ value: number }, VolumeDocument>; help?: string }) {
  const state = useSettingsDocument(resource, false)
  return <section className="settings-section" aria-label={title}><h2>{title}</h2>{help && <p>{help}</p>}{state.document && state.draft ? <>
    <NumberControl field={state.document} value={state.draft.value} unit={state.document.unit} disabled={state.busy} onChange={value => state.setDraft({ value })}/>
    <SaveControls {...state}/>
  </> : <ReadFailure {...state}/>}</section>
}
export default function SoundSettings({ simulated = false }: { simulated?: boolean }) {
  return <SettingsPage title="声音" simulated={simulated}><VolumeSetting title="扬声器" resource={speakerResource}/><VolumeSetting title="麦克风" resource={microphoneResource}/><details className="settings-section"><summary>麦克风高级设置</summary><VolumeSetting title="前级增益" resource={gainResource} help="阵列硬件增益，不是音量百分比。只修改当前设备。"/></details><p className="settings-footnote">调整后点击保存；进入页面不会录音或播放测试音。</p></SettingsPage>
}
