import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { activateScene, fetchScenes, fetchSceneRuntime, type SceneRuntimeSnapshot, type SceneSummary } from '../../api/sceneRuntime'
import { createSceneConfig, deleteSceneConfig, fetchSceneDetail, fetchSceneTemplates, restoreSceneRevision, saveSceneConfig, type MountOption, type SceneConfig, type SceneDetail, type SceneRevision, type SceneTemplate } from '../../api/sceneConfig'
import { operatorPage } from '../../api/operator'
import { voiceMountName } from '../../api/voiceSettings'
import CapabilityParameters, { parameterError, parameterObject } from './CapabilityParameters'
import SceneHistory from './SceneHistory'
import { useFormNavigationGuard } from '../../hooks/useFormNavigationGuard'

const comparable = (scene: SceneConfig) => JSON.stringify({ ...scene, active: undefined })
const tabs = ['能力', '语音与交互', '知识与展示']

export default function Scenes({ simulated = false }: { simulated?: boolean }) {
  const [runtime, setRuntime] = useState<SceneRuntimeSnapshot | null>(null)
  const [scenes, setScenes] = useState<SceneSummary[]>([])
  const [selected, setSelected] = useState('')
  const [detail, setDetail] = useState<SceneDetail | null>(null)
  const [draft, setDraft] = useState<SceneConfig | null>(null)
  const [tab, setTab] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const [expandedCapability, setExpandedCapability] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [revision, setRevision] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [source, setSource] = useState('')
  const [templates, setTemplates] = useState<SceneTemplate[] | null>(null)
  const [templateError, setTemplateError] = useState('')
  const [templateRevision, setTemplateRevision] = useState(0)
  const [showHistory, setShowHistory] = useState(false)
  const taskLock = useRef(false)
  const [removing, setRemoving] = useState(false)
  const [replacement, setReplacement] = useState('')
  const dirty = Boolean(draft && detail && comparable(draft) !== comparable(detail.scene))
  useFormNavigationGuard(Boolean(busy), dirty || creating && Boolean(name.trim()))
  const nativeWake = ['cloud_omni', 'aliyun_native_omni'].includes(detail?.voice_pipeline_provider || '')
  useEffect(() => {
    if (!creating) return
    const controller = new AbortController()
    setTemplates(null); setTemplateError('')
    void fetchSceneTemplates(controller.signal).then(items => { if (!controller.signal.aborted) setTemplates(items) }).catch(reason => { if (!controller.signal.aborted) setTemplateError(reason.message) })
    return () => controller.abort()
  }, [creating, templateRevision])
  const read = useCallback(async (signal?: AbortSignal) => {
    const [snapshot, catalogue] = await Promise.all([fetchSceneRuntime(signal), fetchScenes(signal)])
    if (!signal?.aborted) { setLoaded(true); setRuntime(snapshot); setScenes(catalogue.scenes || []); setSelected(id => id || snapshot.scene?.id || catalogue.scenes?.[0]?.id || '') }
    return snapshot
  }, [])
  useEffect(() => {
    if (simulated) return
    const controller = new AbortController()
    let pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      try { await read(controller.signal) }
      catch (reason) { if (!controller.signal.aborted) { setRuntime(null); setScenes([]); setError(reason instanceof Error ? reason.message : '场景读取失败') } }
      finally { pending = false }
    }
    void refresh(); window.addEventListener('focus', refresh)
    const timer = window.setInterval(refresh, 5000)
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [simulated, revision, read])
  useEffect(() => {
    if (!selected || simulated) return
    const controller = new AbortController()
    setDetail(null); setDraft(null); setError(''); setNotice(''); setRemoving(false)
    fetchSceneDetail(selected, controller.signal).then(data => {
      if (!controller.signal.aborted) { setDetail(data); setDraft(structuredClone(data.scene)) }
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法读取配置') })
    return () => controller.abort()
  }, [selected, simulated, revision])
  const choose = (id: string) => {
    if (busy || (dirty && !window.confirm('放弃未保存的修改？'))) return
    setSelected(id); setCreating(false); setShowAll(false); setShowHistory(false)
  }
  const patch = (change: Partial<SceneConfig>) => setDraft(current => current ? { ...current, ...change } : current)
  const mount = (change: Partial<SceneConfig['provider_mounts']>) => draft && patch({ provider_mounts: { ...draft.provider_mounts, ...change } })
  const toggleCapability = (id: string, enabled: boolean) => {
    if (!draft) return
    const ids = enabled ? [...draft.capabilities, id] : draft.capabilities.filter(value => value !== id)
    const supported = (values: string[] | undefined, options: MountOption[] = []) => (values || []).filter(value => {
      const required = options.find(option => option.id === value)?.requires_capability
      return !required || ids.includes(required)
    })
    patch({ capabilities: ids, provider_mounts: { ...draft.provider_mounts,
      knowledge_source_ids: supported(draft.provider_mounts.knowledge_source_ids, detail?.provider_mount_catalog?.knowledge_sources),
      display_target_ids: supported(draft.provider_mounts.display_target_ids, detail?.provider_mount_catalog?.display_targets),
    } })
  }
  const perform = async (action: string, task: () => Promise<void>) => {
    if (taskLock.current || busy || simulated) return
    taskLock.current = true
    setBusy(action); setError(''); setNotice('')
    try { await task() } catch (reason) { setError(reason instanceof Error ? reason.message : '操作未完成，请重试') }
    finally { taskLock.current = false; setBusy('') }
  }
  const save = () => perform('save', async () => {
    if (!draft || !detail) return
    for (const item of detail.catalog.filter(item => draft.capabilities.includes(item.id))) {
      const invalid = parameterError(item.settings_schema || [], parameterObject(draft.settings[item.id]))
      if (invalid) throw new Error(`${item.name}：${invalid}`)
    }
    const latest = await fetchSceneDetail(draft.id)
    if (comparable(latest.scene) !== comparable(detail.scene)) throw new Error('此场景已在其他页面修改。请先重新读取，再合并修改。')
    const saved = await saveSceneConfig({ ...draft, name: draft.name.trim() })
    setDetail(saved); setDraft(structuredClone(saved.scene)); await read(); setNotice('已保存并发布')
  })
  const activate = () => perform('activate', async () => {
    await activateScene(selected)
    const snapshot = await read()
    if (snapshot.scene?.id !== selected) throw new Error('切换尚未生效，请重新读取确认。')
    setNotice('已切换')
  })
  const create = () => perform('create', async () => {
    const template = templates?.find(item => source ? item.source_scene_id === source : item.mode === 'blank')
    if (!template) throw new Error('请选择设备提供的创建来源。')
    const result = await createSceneConfig(name.trim(), template.source_scene_id || undefined, template.mode)
    const created = await fetchSceneDetail(result.scene_id)
    if (created.scene.name !== name.trim()) throw new Error('场景可能已创建，但结果未确认，请重新读取，勿重复创建。')
    setCreating(false); setName(''); setSelected(result.scene_id); await read()
  })
  const remove = () => perform('delete', async () => {
    const current = await fetchSceneRuntime()
    if (current.scene?.id === selected && !replacement) throw new Error('此场景正在运行，请先选择替代场景。')
    await deleteSceneConfig(selected, current.scene?.id === selected ? replacement : '')
    const catalogue = await fetchScenes()
    if (catalogue.scenes.some(scene => scene.id === selected)) throw new Error('场景仍在列表中，尚未确认删除成功。')
    setRemoving(false); setSelected(''); setDetail(null); setDraft(null); await read(); setNotice('已删除并回读确认')
  })
  const restore = (revision: SceneRevision) => {
    if (busy || !window.confirm(`恢复“${revision.name}”的历史配置？${dirty ? '未保存修改将丢弃。' : ''}当前场景会立即生效。`)) return
    void perform('restore', async () => {
      const latest = await fetchSceneDetail(selected)
      if (!detail || comparable(latest.scene) !== comparable(detail.scene)) throw new Error('场景已在其他页面修改，请先重新读取。')
      const restored = await restoreSceneRevision(selected, revision)
      setDetail(restored); setDraft(structuredClone(restored.scene)); await read(); setShowHistory(false); setNotice('历史版本已恢复并回读')
    })
  }
  const startCreate = (copy: boolean) => {
    if (dirty && !window.confirm('放弃未保存的修改？')) return
    if (detail) setDraft(structuredClone(detail.scene))
    setName(copy ? `${draft?.name || ''}副本` : ''); setSource(copy ? selected : ''); setCreating(true); setRemoving(false)
  }
  const renderMounts = (title: string, key: 'knowledge_source_ids' | 'display_target_ids', options: MountOption[] = []) => <section className="scene-options"><h2>{title}</h2>{options.length ? options.map(option => {
    const blocked = Boolean(option.requires_capability && !draft?.capabilities.includes(option.requires_capability))
    const dependency = detail?.catalog.find(item => item.id === option.requires_capability)?.name
    return <label key={option.id} className="scene-check"><input type="checkbox" disabled={Boolean(busy) || blocked} checked={draft?.provider_mounts[key]?.includes(option.id) || false} onChange={event => {
      const values = draft?.provider_mounts[key] || []
      mount({ [key]: event.target.checked ? [...values, option.id] : values.filter(value => value !== option.id) })
    }}/><span>{option.name}{blocked && <small>先启用{dependency || '对应能力'}</small>}</span></label>
  }) : <p className="workspace-empty">暂无可挂载资源</p>}</section>

  return <div className="workspace-page scene-config-page">
    <header className="product-header"><div><h1>场景</h1><p>选一个场景，直接调整它的能力与挂载。</p></div><button className="workspace-primary" disabled={simulated || Boolean(busy)} onClick={() => startCreate(false)}>新建场景</button></header>
    <div className="workspace-body">
      {simulated && <p className="workspace-empty">连接机器人后配置真实场景。</p>}
      {error && <div className="workspace-error" role="alert">{error}<button disabled={Boolean(busy)} onClick={() => { if (!dirty || window.confirm('重新读取会放弃未保存的修改，继续？')) { setError(''); setRevision(value => value + 1) } }}>重新读取</button></div>}
      {notice && <p role="status">{notice}</p>}
      {creating && <form className="scene-inline-form" aria-label="新建场景" onSubmit={event => { event.preventDefault(); void create() }}>
        <label>场景名称<input autoFocus required maxLength={40} value={name} onChange={event => setName(event.target.value)} disabled={Boolean(busy)}/></label>
        <label>从哪里开始<select value={source} onChange={event => setSource(event.target.value)} disabled={Boolean(busy) || !templates}><option value="" disabled={!templates?.some(item => item.mode === 'blank')}>{templates ? '空白场景' : '正在读取来源'}</option>{templates?.filter(item => item.mode !== 'blank').map(item => <option key={item.id} value={item.source_scene_id}>{item.name}</option>)}</select></label>
        <div className="scene-buttons"><button type="button" disabled={Boolean(busy)} onClick={() => setCreating(false)}>取消</button><button className="workspace-primary" disabled={!name.trim() || !templates || Boolean(busy)}>{busy === 'create' ? '创建中' : '创建'}</button></div>
        {templateError && <p role="alert">{templateError}<button type="button" onClick={() => setTemplateRevision(value => value + 1)}>重试读取来源</button></p>}
      </form>}
      {!simulated && <div className="scene-workbench">
        <nav className="scene-selector" aria-label="选择场景">{scenes.map(scene => <button key={scene.id} aria-pressed={selected === scene.id} disabled={Boolean(busy)} onClick={() => choose(scene.id)}><strong>{scene.name}</strong><span>{runtime?.scene?.id === scene.id ? '运行中' : `${scene.capability_count} 项能力`}</span></button>)}</nav>
        {!creating && draft && detail ? <section className="scene-editor" aria-label="场景配置">
          <div className="scene-editor-heading"><label>名称<input aria-label="场景名称" maxLength={40} value={draft.name} disabled={Boolean(busy)} onChange={event => patch({ name: event.target.value })}/></label><div className="scene-buttons"><button disabled={Boolean(busy)} onClick={() => startCreate(true)}>复制</button><button disabled={Boolean(busy)} onClick={() => { setRemoving(true); setReplacement('') }}>删除</button></div></div>
          {removing && <div className="scene-delete" role="group" aria-label="删除确认"><p>删除“{draft.name}”及其场景配置？不删除人员和服务。当前接口没有删除恢复入口，请先复制需要保留的配置。</p>{runtime?.scene?.id === selected && <label>替代运行场景<select value={replacement} onChange={event => setReplacement(event.target.value)} disabled={Boolean(busy)}><option value="">请选择</option>{scenes.filter(scene => scene.id !== selected).map(scene => <option key={scene.id} value={scene.id}>{scene.name}</option>)}</select></label>}<div className="scene-buttons"><button disabled={Boolean(busy)} onClick={() => setRemoving(false)}>取消</button><button disabled={Boolean(busy) || (runtime?.scene?.id === selected && !replacement)} onClick={() => void remove()}>确认删除</button></div></div>}
          <div className="scene-section-tabs" role="group" aria-label="配置分组">{tabs.map((title, index) => <button key={title} aria-pressed={tab === index} onClick={() => setTab(index)}>{title}</button>)}</div>
          <div className="scene-editor-content">
            {tab === 0 && <div className="scene-options"><div className="scene-options-heading"><p className="scene-hint">已选 {draft.capabilities.length} 项 · 取消勾选即可移除</p><button onClick={() => setShowAll(value => !value)}>{showAll ? '仅看已选' : '添加能力'}</button></div>{detail.catalog.filter(item => item.scope === 'scene' && item.product_layer === 'capability' && (showAll || draft.capabilities.includes(item.id))).map(item => <div key={item.id}><div className="scene-capability"><label className="scene-check"><input type="checkbox" checked={draft.capabilities.includes(item.id)} disabled={Boolean(busy)} onChange={event => toggleCapability(item.id, event.target.checked)}/><span>{item.name}</span></label><button aria-label={`设置${item.name}`} aria-expanded={expandedCapability === item.id} onClick={() => setExpandedCapability(value => value === item.id ? '' : item.id)}>设置 {expandedCapability === item.id ? '−' : '+'}</button></div>{expandedCapability === item.id && <CapabilityParameters item={item} value={draft.settings[item.id]} disabled={Boolean(busy) || !draft.capabilities.includes(item.id)} onChange={value => patch({ settings: { ...draft.settings, [item.id]: value } })}/>}</div>)}</div>}
            {tab === 1 && <div className="scene-profile-fields">
              <label>这个场景使用的语音<select value={draft.provider_mounts.voice_profile_id || ''} disabled={Boolean(busy)} onChange={event => mount({ voice_profile_id: event.target.value })}><option value="" disabled>请选择</option>{detail.provider_mount_catalog?.voice_profiles?.map(item => <option key={item.id} value={item.id}>{voiceMountName(item.id, item.name, detail.shared_voice_pipeline_provider)}</option>)}</select></label>
              <Link to="/dashboard/foundation/voice">设置系统默认、音色与唤醒 →</Link>
              {nativeWake ? <p className="scene-hint">当前云端链路：实体麦克风先说“泽宝”，扫码语音直接进入。激活规则在基础系统统一配置。</p> : <label>交互策略<select value={draft.interaction_policy_id} disabled={Boolean(busy)} onChange={event => patch({ interaction_policy_id: event.target.value, provider_mounts: { ...draft.provider_mounts, interaction_profile_id: event.target.value } })}>{detail.interaction_policies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
              <Link to="/dashboard/foundation/interaction">设备具身交互设置 →</Link>
              <label>场景说明<textarea rows={2} maxLength={160} value={draft.description} disabled={Boolean(busy)} onChange={event => patch({ description: event.target.value })}/></label>
            </div>}
            {tab === 2 && <div className="scene-resource-columns">{renderMounts('知识来源', 'knowledge_source_ids', detail.provider_mount_catalog?.knowledge_sources)}{renderMounts('展示目标', 'display_target_ids', detail.provider_mount_catalog?.display_targets)}</div>}
          </div>
          <footer className="scene-editor-footer"><span>{dirty ? '有未保存修改' : runtime?.scene?.id === selected ? '当前运行场景' : '修改不会自动切换场景'}</span><div className="scene-buttons">{dirty && <button disabled={Boolean(busy)} onClick={() => { if (window.confirm('放弃未保存的修改？')) setDraft(structuredClone(detail.scene)) }}>还原</button>}{runtime?.scene?.id !== selected && <button disabled={dirty || Boolean(busy)} onClick={() => void activate()}>设为当前</button>}<button className="workspace-primary" disabled={!dirty || !draft.name.trim() || Boolean(busy)} onClick={() => void save()}>{busy === 'save' ? '保存中' : '保存'}</button></div></footer>
          <div className="scene-more"><button aria-expanded={showHistory} onClick={() => setShowHistory(value => !value)}>历史版本 {showHistory ? '−' : '+'}</button>{showHistory && <SceneHistory key={selected} sceneId={selected} busy={Boolean(busy)} restore={restore}/>}</div>
        </section> : !creating && !error && <p role="status">{selected ? '正在读取配置' : loaded ? '还没有场景，点击“新建场景”开始。' : '正在读取场景'}</p>}
      </div>}
      {!simulated && <details className="scene-more"><summary>更多管理</summary><nav className="workspace-footer-links"><a href={operatorPage(`scene?id=${encodeURIComponent(selected)}`)} target="_blank" rel="noreferrer">流程与高级参数 ↗</a><a href={operatorPage('capabilities')} target="_blank" rel="noreferrer">全局能力 ↗</a><Link to="/dashboard/foundation/people">人员与权限 →</Link></nav></details>}
    </div>
  </div>
}
