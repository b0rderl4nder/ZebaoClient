import { useEffect, useState } from 'react'
import { diagnosticText, readAcceptance, timeLabel, type AcceptanceDocument } from '../../api/diagnostics'
import { voiceName } from '../../api/voiceSettings'
import { ReadFailure, SettingsPage } from './SettingsControls'
import './diagnostics.css'

export default function AcceptanceRecords({simulated=false}:{simulated?:boolean}) {
  const [data,setData]=useState<AcceptanceDocument|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0)
  useEffect(()=>{const abort=new AbortController();if(!simulated){setBusy(true);setError('');void readAcceptance(abort.signal).then(next=>{if(!abort.signal.aborted)setData(next)}).catch(()=>{if(!abort.signal.aborted)setError('验收记录读取失败，请重试。')}).finally(()=>{if(!abort.signal.aborted)setBusy(false)})}return()=>abort.abort()},[simulated,revision])
  return <SettingsPage title="验收记录" simulated={simulated}>
    <div className="settings-actions"><span>历史记录不等于当前版本已通过。</span><button disabled={busy} onClick={()=>setRevision(value=>value+1)}>重新读取</button></div>
    {!data?<ReadFailure busy={busy} error={error} refresh={()=>setRevision(value=>value+1)}/>:<>
      {error&&<p role="alert" className="workspace-error">{error}</p>}
      {!data.runs.length?<p className="workspace-empty">还没有验收记录。这里不自动执行设备或判定通过。</p>:<div className="diagnostic-list" aria-label="验收运行记录">{data.runs.map(run=><details key={run.run_id}><summary><strong>{run.passed?'记录为通过':'记录未通过'}</strong><span>{timeLabel(run.recorded_at)}</span></summary>
        <dl className="diagnostic-facts"><div><dt>场景标识</dt><dd>{diagnosticText(run.scene.id)}</dd></div><div><dt>当时使用的链路</dt><dd>{voiceName(run.voice_mode)}</dd></div><div><dt>发布提交</dt><dd>{diagnosticText(run.release.git_commit)}</dd></div><div><dt>展示版本</dt><dd>{diagnosticText(run.display_revision)||'未记录'}</dd></div></dl>
        <h2>各环节结果</h2><ul className="diagnostic-stages">{Object.entries(run.stages).map(([id,ok])=><li key={id}><span>{data.stages.find(item=>item.id===id)?.label||id}</span><span>{ok===true?'通过':'未通过'}</span></li>)}</ul>
        <h2>能力与设备回读</h2>{!run.capability_results.length&&!run.device_results.length?<p>没有能力或设备证据</p>:<ul className="diagnostic-stages">{run.capability_results.map((item,index)=><li key={`cap-${index}`}><span>{diagnosticText(item.capability_id)} · {diagnosticText(item.status)}</span><span>{item.ok===true?'成功':'失败'}</span></li>)}{run.device_results.map((item,index)=><li key={`device-${index}`}><span>{diagnosticText(item.device_id)}</span><span>{item.readback_ok?'已回读':'未回读'} · {item.restored?'已恢复':'未恢复'}</span></li>)}</ul>}
        <details><summary>构件与延迟证据</summary><dl className="diagnostic-facts"><div><dt>构件 SHA-256</dt><dd>{diagnosticText(run.release.artifact_sha256)}</dd></div><div><dt>场景代次</dt><dd>{diagnosticText(run.scene.generation)}</dd></div>{Object.entries(run.latency_ms||{}).map(([name,value])=><div key={name}><dt>{name}</dt><dd>{Number.isFinite(value)?`${value} 毫秒`:'未记录'}</dd></div>)}</dl></details>
      </details>)}</div>}
      <details className="settings-help"><summary>验收范围</summary><ul className="diagnostic-stages">{data.stages.map(item=><li key={item.id}>{item.label}</li>)}</ul></details>
    </>}
  </SettingsPage>
}
