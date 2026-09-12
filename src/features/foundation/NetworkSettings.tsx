import { useState } from 'react'
import { networkRequest, networkWrite } from '../../api/networkSettings'
import { useSettingsDocument, type SettingsResource } from '../../hooks/useSettingsDocument'
import { SettingsPage, ReadFailure, SaveControls, SettingToggle } from './SettingsControls'
import WifiSettings from './WifiSettings'
import HomeAssistantSettings from './HomeAssistantSettings'
import './network.css'

const autostartResource: SettingsResource<{ enabled: boolean }, { values: { enabled: boolean } }> = {
  read: async signal => { const data = await networkRequest<{ enabled: boolean }>('app_autostart', { signal }); if (typeof data.enabled !== 'boolean') throw new Error('自启状态暂不可用。'); return { values: { enabled: data.enabled } } },
  write: next => networkWrite('app_autostart', 'POST', next),
}
function Autostart() {
  const state = useSettingsDocument(autostartResource, false)
  return <section className="settings-section" aria-label="开机启动"><h2>App 开机自启</h2>{state.draft ? <><SettingToggle label="开机后自动启动 App" checked={state.draft.enabled} disabled={state.busy} onChange={enabled => state.setDraft({ enabled })}/><SaveControls {...state}/></> : <ReadFailure {...state}/>}</section>
}
export default function NetworkSettings({ simulated = false }: { simulated?: boolean }) {
  const [tab, setTab] = useState('wifi')
  const [visited, setVisited] = useState(['wifi'])
  return <SettingsPage title="网络与连接" simulated={simulated}>{!simulated && <><nav className="network-tabs" aria-label="连接设置">{[['wifi', 'Wi-Fi 与外带'], ['iot', '物联网'], ['startup', '开机启动']].map(([id, label]) => <button key={id} aria-pressed={tab === id} onClick={() => { setVisited(current => [...new Set([...current, id])]); setTab(id) }}>{label}</button>)}</nav>{visited.map(id => <div className="network-pane" key={id} hidden={tab !== id}>{id === 'wifi' ? <WifiSettings/> : id === 'iot' ? <HomeAssistantSettings/> : <Autostart/>}</div>)}</>}</SettingsPage>
}
