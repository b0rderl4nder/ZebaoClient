import { useEffect, useState } from 'react'
import { fetchSceneRevisions, type SceneRevision } from '../../api/sceneConfig'

const reasons: Record<string, string> = { before_publish: '发布前', inactive_scene_updated: '修改前', before_revision_restore: '恢复前' }
export default function SceneHistory({ sceneId, busy, restore }: { sceneId: string; busy: boolean; restore: (revision: SceneRevision) => void }) {
  const [items, setItems] = useState<SceneRevision[] | null>(null)
  const [error, setError] = useState(''), [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setItems(null); setError('')
    void fetchSceneRevisions(sceneId, controller.signal).then(data => { if (!controller.signal.aborted) setItems(data) }).catch(reason => { if (!controller.signal.aborted) setError(reason.message) })
    return () => controller.abort()
  }, [sceneId, revision])
  return <section className="scene-history" aria-label="场景历史版本">
    <p className="scene-hint">恢复会替换场景配置；当前场景会立即生效，不切换到其他场景。</p>
    {error ? <p role="alert" className="workspace-error">{error}</p> : !items ? <p role="status">正在读取历史版本</p> : !items.length ? <p>还没有历史版本</p> : items.map((item, index) => <div className="scene-history-row" key={item.revision_id}><div><strong>{item.name}</strong><small>历史 {index + 1} · {item.capability_count} 项能力 · {reasons[item.reason] || '配置快照'}</small></div><button disabled={busy} onClick={() => restore(item)} aria-label={`恢复历史 ${index + 1}`}>恢复此版本</button></div>)}
    <button disabled={busy} onClick={() => setRevision(value => value + 1)}>重新读取历史</button>
  </section>
}
