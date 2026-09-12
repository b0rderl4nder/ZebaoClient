import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { readVoiceActivation, readVoiceCatalog, readVoiceRuntime, saveNativeConnection, saveVoiceDefault, updateVoiceActivation, voiceName, type VoiceActivation, type VoiceCatalog } from '../../api/voiceSettings'
import type { SceneRuntimeSnapshot } from '../../api/sceneRuntime'
import { useFormNavigationGuard } from '../../hooks/useFormNavigationGuard'
import VoiceConnectionEditor from './VoiceConnectionEditor'
import './settings.css'

const states: Record<string, string> = { inactive: '待唤醒', awaiting_tail: '正在收听', active: '已激活', retiring: '正在退出' }
const feedbackStates: Record<string, string> = { startup: '准备中', ready: '已就绪', scheduled: '待播放', played: '已播放', cancelled: '已取消', unavailable: '暂不可用' }
const message = (error: unknown) => error instanceof Error ? error.message : '请求失败，请重试。'

export default function VoiceSettings({ simulated = false }: { simulated?: boolean }) {
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null)
  const [runtime, setRuntime] = useState<SceneRuntimeSnapshot | null>(null)
  const [activation, setActivation] = useState<VoiceActivation | null>(null)
  const [activationError, setActivationError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [selected, setSelected] = useState('')
  const [connection, setConnection] = useState({ model: '', voice: '', endpoint: '', key: '' })
  const [editing, setEditing] = useState(false)
  const [tab, setTab] = useState('链路选择')
  const [connectionProvider, setConnectionProvider] = useState('')
  const [providerDirty, setProviderDirty] = useState(false)
  const [providerBusy, setProviderBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const lock = useRef(false)
  const dirty = editing || providerDirty || Boolean(catalog && selected !== catalog.shared_voice_pipeline_provider)
  useFormNavigationGuard(Boolean(busy) || providerBusy, dirty)
  const editingProvider = connectionProvider || runtime?.voice?.provider || catalog?.voice_pipeline_provider || ''
  const promptSlot = ({ aliyun_native_omni: 'conversation.aliyun_native_omni', cloud_omni: 'conversation.cloud_omni', local_omni: 'conversation.local_omni', platform_ws: 'conversation.composed_policy' } as Record<string, string>)[runtime?.voice?.provider || '']
  const read = useCallback(async (signal?: AbortSignal) => {
    const [next, snapshot] = await Promise.all([readVoiceCatalog(signal), readVoiceRuntime(signal)])
    if (!signal?.aborted) { setCatalog(next); setRuntime(snapshot); setSelected(next.shared_voice_pipeline_provider) }
    return next
  }, [])
  const readActivation = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await readVoiceActivation(signal)
      if (!signal?.aborted) { setActivation(next); setActivationError('') }
      return next
    } catch (reason) {
      if (!signal?.aborted) { setActivation(null); setActivationError(message(reason)) }
      return null
    }
  }, [])
  useEffect(() => {
    if (simulated) return
    const controller = new AbortController()
    void read(controller.signal).catch(reason => { if (!controller.signal.aborted) setError(message(reason)) })
    void readActivation(controller.signal)
    return () => controller.abort()
  }, [simulated, read, readActivation, revision])
  const run = async (id: string, action: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true
    setBusy(id); setNotice(''); setError('')
    try { await action() } catch (reason) { setError(message(reason)) } finally { lock.current = false; setBusy('') }
  }
  const saveDefault = () => run('default', async () => {
    const current = await readVoiceCatalog()
    if (current.shared_voice_pipeline_provider !== catalog?.shared_voice_pipeline_provider) throw new Error('系统默认已被其他页面修改，请重新读取后再保存。')
    await saveVoiceDefault(selected)
    const confirmed = await read()
    if (confirmed.shared_voice_pipeline_provider !== selected) throw new Error('请求已提交，但系统默认值尚未确认。请重新读取，不要重复切换。')
    setNotice('系统默认已保存；场景专属选择保持不变。')
  })
  const changeActivation = (body: { enabled: boolean } | { action: 'retire' }) => run('activation', async () => {
    await updateVoiceActivation(body)
    const confirmed = await readActivation()
    if (!confirmed) throw new Error('请求已提交，但唤醒状态尚未确认，请重新读取。')
    if ('enabled' in body && (confirmed.enabled !== body.enabled || confirmed.local_kws.settings_persisted === false)) throw new Error('开关尚未持久保存，请重新读取后检查。')
    if ('action' in body && confirmed.activation.active) throw new Error('会话尚未结束，请重新读取后检查。')
    setNotice('action' in body ? '实体会话已结束。' : '唤醒设置已保存。')
  })
  const editConnection = () => {
    setConnection({ model: catalog?.aliyun_native_omni?.model || '', voice: catalog?.aliyun_native_omni?.voice || '', endpoint: '', key: '' }); setEditing(true)
  }
  const saveConnection = () => run('connection', async () => {
    if (!catalog?.aliyun_native_omni?.configured && (!connection.endpoint.trim() || !connection.key.trim())) throw new Error('首次配置请填写服务地址和密钥。')
    const fields: Record<string, string> = {}
    for (const [name, value] of Object.entries(connection)) {
      if (value.trim()) fields[`aliyun_native_omni_${name === 'endpoint' ? 'ws_url' : name === 'key' ? 'api_key' : name}`] = value.trim()
    }
    try { await saveNativeConnection(fields) } finally { setConnection(value => ({ ...value, key: '' })) }
    const confirmed = await readVoiceCatalog()
    if (!confirmed.aliyun_native_omni?.configured || (connection.voice.trim() && confirmed.aliyun_native_omni.voice !== connection.voice.trim()) || (connection.model.trim() && confirmed.aliyun_native_omni.model !== connection.model.trim())) throw new Error('连接保存请求已提交，但尚未确认。请重新读取后检查。')
    setCatalog(confirmed); setEditing(false); setNotice('连接已保存，空闲时刷新；这不代表云端连接已验证。')
  })
  const refresh = () => { if (!dirty || window.confirm('重新读取将放弃未保存修改，继续？')) { setEditing(false); setConnection({ model: '', voice: '', endpoint: '', key: '' }); setError(''); setNotice(''); setRevision(value => value + 1) } }
  return <div className="workspace-page native-settings">
    <header className="product-header"><div><Link className="workspace-back" to="/dashboard/foundation">← 基础系统</Link><h1>语音与唤醒</h1></div><button disabled={Boolean(busy) || simulated} onClick={refresh}>重新读取</button></header>
    <div className="workspace-body">
      {error && <p className="workspace-error" role="alert">{error}</p>}
      {notice && <p className="settings-notice" role="status">{notice}</p>}
      {simulated ? <p className="workspace-empty">连接机器人后配置语音。</p> : !catalog ? !error && <p role="status">正在读取语音设置</p> : <>
        <section className="settings-current" aria-label="当前语音链路"><div><span>{runtime?.scene?.name || '当前场景待确认'}</span><strong>{voiceName(runtime?.voice?.provider, runtime?.voice?.label)}</strong></div><Link to="/dashboard/scenes">调整场景选择 →</Link></section>
        <div className="settings-related">{promptSlot && <Link to={`/dashboard/foundation/prompts?slot=${encodeURIComponent(promptSlot)}`}>当前链路提示词 →</Link>}<Link to="/dashboard/foundation/sound">麦克风与音量 →</Link></div>
        <nav className="voice-settings-tabs" aria-label="语音设置栏目">{['链路选择','连接参数','唤醒设置'].map(item=><button key={item} aria-pressed={tab===item} disabled={Boolean(busy)||providerBusy||editing||providerDirty} onClick={()=>setTab(item)}>{item}</button>)}</nav>
        {tab==='链路选择' && <section className="settings-section" aria-labelledby="default-voice-heading"><h2 id="default-voice-heading">系统默认链路</h2><p>只影响选择“跟随系统”的场景。</p>
          <div className="settings-choices" role="group" aria-label="系统默认链路">{(catalog.provider_mount_catalog?.voice_profiles || []).filter(item => item.id !== 'shared').map(item => <button key={item.id} aria-pressed={selected === (item.provider || item.id)} disabled={Boolean(busy)} onClick={() => setSelected(item.provider || item.id)}><strong>{voiceName(item.provider || item.id, item.name)}</strong><span>{selected === (item.provider || item.id) ? '已选择' : item.id === 'cloud_omni' || item.id === 'local_omni' ? '保留链路' : '选择'}</span></button>)}</div>
          {!catalog.provider_mount_catalog?.voice_profiles?.length && <p role="status">服务未返回可选链路，无法切换。</p>}
          <div className="settings-actions"><span>{selected !== catalog.shared_voice_pipeline_provider ? '尚未保存' : `当前默认：${voiceName(catalog.shared_voice_pipeline_provider)}`}</span><button className="workspace-primary" disabled={Boolean(busy) || !selected || selected === catalog.shared_voice_pipeline_provider} onClick={() => void saveDefault()}>{busy === 'default' ? '保存中' : '保存默认链路'}</button></div>
        </section>}
        {tab==='连接参数' && <section className="settings-section" aria-labelledby="connection-picker-heading"><h2 id="connection-picker-heading">连接配置</h2><label className="settings-profile-picker">要配置的链路<select aria-label="要配置的链路" value={editingProvider} disabled={Boolean(busy)||providerBusy||editing||providerDirty} onChange={event=>setConnectionProvider(event.target.value)}>{(catalog.provider_mount_catalog?.voice_profiles||[]).filter(item=>item.id!=='shared').map(item=><option key={item.id} value={item.provider||item.id}>{voiceName(item.provider||item.id,item.name)}</option>)}</select></label><p className="settings-footnote">这里只编辑连接，不改变系统默认或场景选择。</p></section>}
        {tab==='连接参数' && editingProvider === 'aliyun_native_omni' && <section className="settings-section" aria-labelledby="native-connection-heading"><div className="settings-row"><div><h2 id="native-connection-heading">云端 Omni · 独立连接设置</h2><p>{catalog.aliyun_native_omni?.configured ? `音色 ${catalog.aliyun_native_omni.voice || '待确认'}` : '尚未配置'} · 不适用于本地、平台或云端兼容链路</p></div>{!editing && <button disabled={Boolean(busy)} onClick={editConnection}>编辑连接与音色</button>}</div>
          {editing && <form onSubmit={event => { event.preventDefault(); void saveConnection() }}><div className="settings-fields">
            <label>音色<input value={connection.voice} disabled={Boolean(busy)} onChange={event => setConnection({ ...connection, voice: event.target.value })} placeholder="服务支持的音色名称"/></label>
            <label>模型<input value={connection.model} disabled={Boolean(busy)} onChange={event => setConnection({ ...connection, model: event.target.value })}/></label>
            <label>服务地址<input value={connection.endpoint} disabled={Boolean(busy)} autoComplete="off" placeholder={catalog.aliyun_native_omni?.configured ? '留空保留现有地址' : 'wss://…'} onChange={event => setConnection({ ...connection, endpoint: event.target.value })}/></label>
            <label>密钥<input type="password" value={connection.key} disabled={Boolean(busy)} autoComplete="new-password" placeholder={catalog.aliyun_native_omni?.configured ? '留空保留现有密钥' : '输入服务密钥'} onChange={event => setConnection({ ...connection, key: event.target.value })}/></label>
          </div><p>只修改此连接。生效时机由原服务在空闲边界处理。</p><div className="settings-actions"><button type="button" disabled={Boolean(busy)} onClick={() => { setEditing(false); setConnection({ model: '', voice: '', endpoint: '', key: '' }) }}>取消</button><button className="workspace-primary" disabled={Boolean(busy)}>{busy === 'connection' ? '保存中' : '保存连接'}</button></div></form>}
        </section>}
        {tab==='连接参数' && editingProvider && editingProvider !== 'aliyun_native_omni' && <VoiceConnectionEditor key={editingProvider+revision} provider={editingProvider} onDirty={setProviderDirty} onBusy={setProviderBusy}/>}
        {tab==='唤醒设置' && <section className="settings-section" aria-labelledby="wake-heading"><h2 id="wake-heading">实体麦克风唤醒</h2>
          {activationError ? <p role="alert">{activationError}</p> : !activation ? <p role="status">正在读取唤醒状态</p> : <><div className="settings-row"><div><strong>{activation.fixed_wake_word || '唤醒词待确认'}</strong><p>{states[activation.activation.state] || '状态待确认'} · {activation.local_kws.ready ? '唤醒模型就绪' : '唤醒模型未就绪'}</p></div><label className="settings-toggle"><input type="checkbox" role="switch" checked={activation.enabled} disabled={Boolean(busy)} onChange={event => void changeActivation({ enabled: event.target.checked })}/>启用本地唤醒</label></div>
          <p>扫码说话不需要唤醒，不改变实体会话。</p>
          {activation.activation.active && <button disabled={Boolean(busy)} onClick={() => { if (window.confirm('结束实体会话并取消待播内容？扫码语音不受影响。')) void changeActivation({ action: 'retire' }) }}>结束实体会话</button>}
          <details><summary>提示音与诊断</summary><dl className="settings-facts"><div><dt>“我在”提示音</dt><dd>{activation.diagnostics?.bare_wake_local_audio_ready === undefined ? '待确认' : activation.diagnostics.bare_wake_local_audio_ready ? '已就绪' : '未就绪'}</dd></div><div><dt>退下提示音</dt><dd>{feedbackStates[activation.diagnostics?.session_exit_feedback?.state || ''] || '待确认'}</dd></div><div><dt>最近唤醒耗时</dt><dd>{activation.local_kws.last_latency_ms == null ? '暂无记录' : `${Math.round(activation.local_kws.last_latency_ms)} 毫秒`}</dd></div></dl></details></>}
        </section>}
      </>}
    </div>
  </div>
}
