import { useEffect, useState } from 'react'
import { diagnosticText, readAcceptance, readAcceptanceGuidance, timeLabel, type AcceptanceDocument } from '../../api/diagnostics'
import type { ReadinessSnapshot } from '../../api/sceneRuntime'
import { voiceName } from '../../api/voiceSettings'
import { ReadFailure, SettingsPage } from './SettingsControls'
import './diagnostics.css'

export default function AcceptanceRecords({simulated=false}:{simulated?:boolean}) {
  const [data,setData]=useState<AcceptanceDocument|null>(null),[guidance,setGuidance]=useState<ReadinessSnapshot|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0)
  useEffect(()=>{const abort=new AbortController();if(!simulated){setBusy(true);setError('');void Promise.allSettled([readAcceptance(abort.signal),readAcceptanceGuidance(abort.signal)]).then(results=>{if(abort.signal.aborted)return;const acceptance=results[0],readiness=results[1];if(acceptance.status==='fulfilled')setData(acceptance.value);if(readiness.status==='fulfilled')setGuidance(readiness.value);if(acceptance.status==='rejected'&&readiness.status==='rejected')setError('验收状态读取失败，请重试。');else if(readiness.status==='rejected')setError('自动门禁读取失败，历史验收记录仍可查看。')}).finally(()=>{if(!abort.signal.aborted)setBusy(false)})}return()=>abort.abort()},[simulated,revision])
  const blockerLabels: Record<string,string> = { voiceprint_acceptance:'声纹真人验收：需要按现场手册完成已登记与未知说话人留出验证', voice_turn_acceptance:'语音真人验收：需要真人完成唤醒、连续对话、打断、能力结果、权限和具身观察' }
  const blockers=(guidance?.blockers||[]).map(item=>({id:item,label:blockerLabels[item]||item}))
  const voiceAcceptance=guidance?.voice_turn_acceptance
  return <SettingsPage title="验收记录" simulated={simulated}>
    <div className="settings-actions"><span>历史记录不等于当前版本已通过。</span><button disabled={busy} onClick={()=>setRevision(value=>value+1)}>重新读取</button></div>
    {!data?<ReadFailure busy={busy} error={error} refresh={()=>setRevision(value=>value+1)}/>:<>
      {error&&<p role="alert" className="workspace-error">{error}</p>}
      <section className="acceptance-guidance" aria-label="当前验收引导">
        <div className="acceptance-guidance__header"><div><h2>当前发布验收状态</h2><p>只读取自动门禁和已记录证据；本页不会执行设备，也不会替真人勾选。</p></div><strong className={guidance?.ready?'acceptance-state--ready':'acceptance-state--blocked'}>{guidance?.ready?'自动基线通过':'等待真人证据'}</strong></div>
        {blockers.length>0?<><h3>现在需要补的证据</h3><ul className="acceptance-guidance__list">{blockers.map(item=><li key={item.id}><span>{item.label}</span><strong>未完成</strong></li>)}</ul></>:<p className="acceptance-guidance__ok">当前没有服务端报告的阻断项；仍以最新验收运行记录为准。</p>}
        {voiceAcceptance&&<p className="acceptance-guidance__progress">语音真人验收进度：{Number.isFinite(voiceAcceptance.completed_count)?voiceAcceptance.completed_count:0}/{Number.isFinite(voiceAcceptance.required_count)?voiceAcceptance.required_count:0} · {diagnosticText(voiceAcceptance.reason)||'未签署'}</p>}
        <details className="settings-help"><summary>真人验收顺序</summary><ol className="acceptance-guidance__steps"><li>先按现场手册完成半米/一米唤醒、裸唤醒与连续追问。</li><li>再验证停止/退下、自然打断和旧音频不复活。</li><li>观察注视、声源转向、思考/说话动作、呼吸和安全边界。</li><li>最后验证当前场景挂载的能力、权限拒绝和真实设备回读。</li></ol><p className="settings-footnote">每一步只记录结果代码、回读和延迟；没有真实回读就标记“证据不足”，不要口头判定完成。</p></details>
      </section>
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
