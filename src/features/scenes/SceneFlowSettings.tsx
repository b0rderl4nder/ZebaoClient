import { useEffect, useState } from 'react'
import { fetchSceneFlows, type CapabilityOption, type SceneFlowDefinition } from '../../api/sceneConfig'

/** Configuration only: selecting a definition does not run or mount its actions. */
export default function SceneFlowSettings({ value, disabled, mountedCapabilities, catalog, onChange }: {
  value: string; disabled: boolean; mountedCapabilities: string[]; catalog: CapabilityOption[]; onChange: (id: string) => void
}) {
  const [flows, setFlows] = useState<SceneFlowDefinition[] | null>(null)
  const [error, setError] = useState(''), [revision, setRevision] = useState(0)
  useEffect(() => {
    const abort = new AbortController(); setError(''); setFlows(null)
    void fetchSceneFlows(abort.signal).then(result => { if (!abort.signal.aborted) setFlows(result) }).catch(reason => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : '流程目录读取失败。') })
    return () => abort.abort()
  }, [revision])
  const selected = flows?.find(flow => flow.id === value)
  const suggested = [...new Set(selected?.stages.flatMap(stage => stage.suggested_capabilities) || [])].filter(id => !mountedCapabilities.includes(id))
  return <section className="scene-flow-settings" aria-label="场景流程配置">
    <h2>场景流程</h2>
    <p className="scene-hint">只选择流程，随场景保存；不会立即运行或自动添加能力。</p>
    {error ? <p role="alert">{error}<button disabled={disabled} onClick={() => setRevision(value => value + 1)}>重试流程目录</button></p> : !flows ? <p role="status">正在读取流程目录</p> : <>
      <label>使用哪个流程<select value={value} disabled={disabled || !flows.length} onChange={event => onChange(event.target.value)}>
        {!selected && <option value={value} disabled>当前流程不在可用目录 · 保留原值</option>}
        {flows.map(flow => <option key={flow.id} value={flow.id}>{flow.name}</option>)}
      </select></label>
      {selected && <p className="scene-hint">{selected.description}</p>}
      {suggested.length > 0 && <p className="scene-hint">流程建议但尚未挂载：{suggested.map(id => catalog.find(item => item.id === id)?.name || '当前目录未提供的能力').join('、')}。如需使用，请到“能力”中选择。</p>}
      {selected && selected.stages.length > 0 && <details className="parameter-help"><summary>查看流程步骤</summary><ol>{selected.stages.map(stage => <li key={stage.id}><strong>{stage.name}</strong><p>{stage.goal}</p></li>)}</ol></details>}
      {!flows.length && <p role="status">设备暂无可选流程，现有配置保持不变。</p>}
    </>}
  </section>
}
