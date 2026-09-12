import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { diagnosticText, readExtendedDiagnostic, readPipeline, stageLabel, timeLabel, type PipelineSnapshot } from '../../api/diagnostics'
import { voiceName } from '../../api/voiceSettings'
import { ReadFailure, SettingsPage } from './SettingsControls'
import './diagnostics.css'

export default function PipelineDiagnostics({simulated=false}:{simulated?:boolean}) {
  const [data,setData]=useState<PipelineSnapshot|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0)
  const [extended,setExtended]=useState<Awaited<ReturnType<typeof readExtendedDiagnostic>>|null>(null),[extendedError,setExtendedError]=useState(''),[extendedBusy,setExtendedBusy]=useState(false)
  const controller=useRef<AbortController|null>(null),lock=useRef(false)
  useEffect(()=>{const abort=new AbortController();controller.current=abort
    if(!simulated){setBusy(true);setError('');void readPipeline(abort.signal).then(next=>{if(!abort.signal.aborted)setData(next)}).catch(()=>{if(!abort.signal.aborted)setError('无法读取当前链路，请重新读取。')}).finally(()=>{if(!abort.signal.aborted)setBusy(false)})}
    return()=>abort.abort()
  },[simulated,revision])
  const loadExtended=async()=>{
    if(lock.current)return
    lock.current=true;setExtendedBusy(true);setExtendedError('')
    const signal=controller.current?.signal
    try{const next=await readExtendedDiagnostic(signal);if(!signal?.aborted)setExtended(next)}
    catch{if(!signal?.aborted)setExtendedError('完整诊断读取失败，请重试。')}
    finally{lock.current=false;if(!signal?.aborted)setExtendedBusy(false)}
  }
  return <SettingsPage title="链路诊断" simulated={simulated}>
    <div className="settings-actions"><Link to="/dashboard/foundation/voice">配置语音 →</Link><Link to="/dashboard/foundation/logs">查看日志 →</Link><button disabled={busy||extendedBusy} onClick={()=>setRevision(value=>value+1)}>重新读取</button></div>
    {data&&error&&<p role="alert" className="workspace-error">{error}</p>}
    {!data?<ReadFailure busy={busy} error={error} refresh={()=>setRevision(value=>value+1)}/>:<>
      <div className="settings-current"><div><span>{data.runtime.scene?.name||'活动场景未确认'}</span><strong>{voiceName(data.runtime.voice?.provider,data.runtime.voice?.label)}</strong></div><span>{data.connected===undefined?'连接未提供':data.connected?'连接已建立':'连接未建立'}</span></div>
      <dl className="diagnostic-facts"><div><dt>机器人当前状态</dt><dd>{stageLabel(data.state)}</dd></div><div><dt>最近回合结果</dt><dd>{stageLabel(data.stage)}</dd></div></dl>
      <p className="settings-footnote">回合结果可能是历史记录，不代表机器人当前仍在处理。连接成功也不代表语音已验收。</p>
      {data.current?<section className="diagnostic-list" aria-label="最近语音回合"><article><h2>回合 {data.current.turn_id??'未提供'}</h2><dl className="diagnostic-facts"><div><dt>状态</dt><dd>{stageLabel(data.current.stage)}</dd></div><div><dt>距最近变化</dt><dd>{data.current.updated_age_ms==null?'未记录':`${Math.round(data.current.updated_age_ms/1000)} 秒`}</dd></div><div><dt>原因代码</dt><dd>{diagnosticText(data.reason||data.current.admission_reason)||'未提供'}</dd></div><div><dt>输入来源</dt><dd>{data.current.source==='microphone_audio'?'实体麦克风':diagnosticText(data.current.source)||'未提供'}</dd></div></dl></article></section>:<p className="workspace-empty">没有语音回合记录</p>}
      {data.cancelled&&<details className="settings-help"><summary>上一次取消的回合</summary><p>回合 {data.cancelled.turn_id??'未提供'} · {stageLabel(data.cancelled.stage)}</p><p>{diagnosticText(data.cancelled.cancel_reason)||'原因未提供'}</p></details>}
    </>}
    <details className="settings-help"><summary>兼容链路完整诊断</summary><p className="settings-footnote">按需读取旧诊断快照，可能查询平台知识库。其检查范围包含兼容链路，不能直接当作当前 Omni 的验收结论。</p><button disabled={busy||extendedBusy} onClick={()=>void loadExtended()}>{extendedBusy?'正在读取':'读取完整诊断'}</button>{extendedError&&<p role="alert">{extendedError}</p>}{extended&&<><p>{timeLabel(extended.captured_at_utc)} · {extended.ok?'旧诊断检查通过':'旧诊断存在未通过项'}</p><ul className="diagnostic-stages">{extended.checks.map((item,index)=><li key={index}><span>{item.name}</span><span>{item.ok===null?'未提供':item.ok?'通过':'未通过'}</span></li>)}</ul>{extended.failed_checks.length>0&&<p>{extended.failed_checks.join('、')}</p>}</>}</details>
  </SettingsPage>
}
