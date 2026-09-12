import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { activateScene, fetchScenes, fetchSceneRuntime, type SceneRuntimeSnapshot, type SceneSummary } from '../../api/sceneRuntime'
import { operatorPage } from '../../api/operator'

export default function Scenes({ simulated = false }: { simulated?: boolean }) {
  const [runtime, setRuntime] = useState<SceneRuntimeSnapshot | null>(null)
  const [scenes, setScenes] = useState<SceneSummary[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [revision, setRevision] = useState(0)
  const read = useCallback(async (signal?: AbortSignal) => {
    const [snapshot, catalogue] = await Promise.all([fetchSceneRuntime(signal), fetchScenes(signal)])
    if (!signal?.aborted) { setRuntime(snapshot); setScenes(catalogue.scenes || []); setError('') }
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
      catch (reason) { if (!controller.signal.aborted) { setRuntime(null); setError(reason instanceof Error ? reason.message : '场景读取失败') } }
      finally { pending = false }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [simulated, revision, read])

  const select = async (id: string) => {
    if (busy || simulated) return
    setBusy(id)
    try {
      await activateScene(id)
      const snapshot = await read()
      if (snapshot.scene?.id !== id) throw new Error('切换尚未生效，请刷新确认。')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '场景切换失败') }
    finally { setBusy('') }
  }
  const current = runtime?.scene
  const available = !simulated && Boolean(runtime?.ok)
  const groups = [
    { title: '能力', values: runtime?.capabilities, route: 'capability', empty: '尚未挂载能力' },
    { title: '知识库', values: runtime?.knowledge, route: 'scene', empty: '尚未挂载知识源' },
    { title: '展示目标', values: runtime?.displays, route: 'scene', empty: '尚未挂载展示目标' },
  ]
  return <div className="workspace-page">
    <header className="product-header"><div><h1>场景</h1><p>能力与服务，按需组合</p></div>{!simulated && <a className="workspace-primary" href={operatorPage('scenes')} target="_blank" rel="noreferrer">创建与管理</a>}</header>
    <div className="workspace-body">
      <Link className="setup-entry" to="/dashboard/setup?step=1"><span><strong>不知道从哪里开始？</strong><small>按框架逐步配置场景与挂载</small></span><span aria-hidden="true">→</span></Link>
      {simulated ? <p className="workspace-empty">连接机器人后查看实际场景与挂载。</p> : error ? <div className="workspace-error" role="alert">{error}<button onClick={() => setRevision(value => value + 1)}>重试</button></div> : !runtime ? <p role="status">正在读取场景</p> : null}
      {available && <section className="runtime-workspace" aria-label="当前场景挂载">
        <header><div><span className="workspace-eyebrow">正在运行</span><h2>{current?.name}</h2></div><a href={operatorPage(`scene?id=${encodeURIComponent(current?.id || '')}`)} target="_blank" rel="noreferrer">配置场景 →</a></header>
        <div className="runtime-profiles">
          <a href={operatorPage('device/voice')} target="_blank" rel="noreferrer"><span>语音链路</span><strong>{runtime?.voice?.label || '未挂载'}</strong></a>
          <a href={operatorPage(`scene?id=${encodeURIComponent(current?.id || '')}`)} target="_blank" rel="noreferrer"><span>交互策略</span><strong>{runtime?.interaction?.name || '未挂载'}</strong></a>
          <Link to="/dashboard/foundation/interaction"><span>具身交互</span><strong>查看与配置 →</strong></Link>
        </div>
        <div className="runtime-mounts">{groups.map(group => <section key={group.title}><h3>{group.title}<small>{group.values?.length || 0}</small></h3>{group.values?.length ? group.values.map(item => <a key={item.id} href={operatorPage(`${group.route}?id=${encodeURIComponent(group.route === 'scene' ? current?.id || '' : item.id)}`)} target="_blank" rel="noreferrer"><span>{item.name || item.label || item.id}</span><span aria-hidden="true">↗</span></a>) : <p>{group.empty}</p>}</section>)}</div>
      </section>}
      {available && <section aria-label="其他场景"><h2 className="workspace-section-title">其他场景</h2><div className="scene-choices">{scenes.filter(scene => scene.id !== current?.id).map(scene => <article key={scene.id}><div><h3>{scene.name}</h3><span>{scene.capability_count} 项能力</span></div><div><a href={operatorPage(`scene?id=${encodeURIComponent(scene.id)}`)} target="_blank" rel="noreferrer">配置</a><button disabled={Boolean(busy)} onClick={() => void select(scene.id)}>{busy === scene.id ? '切换中' : '切换'}</button></div></article>)}</div></section>}
      {!simulated && <nav className="workspace-footer-links" aria-label="场景资源"><a href={operatorPage('capabilities')} target="_blank" rel="noreferrer">能力管理 ↗</a><a href={operatorPage('people')} target="_blank" rel="noreferrer">人员与权限 ↗</a></nav>}
    </div>
  </div>
}
