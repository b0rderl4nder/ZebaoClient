import { useEffect, useRef, useState } from 'react'
import { clearLogs, diagnosticText, emptyLogFilters, exportLogs, logCategories, logLevels, readLogs, redactDiagnostic, timeLabel, type LogEntry, type LogFilters, type LogPage } from '../../api/diagnostics'
import { useFormNavigationGuard } from '../../hooks/useFormNavigationGuard'
import { SettingsPage } from './SettingsControls'
import './diagnostics.css'

export default function OperationsLogs({simulated=false}:{simulated?:boolean}) {
  const [data,setData]=useState<LogPage|null>(null),[entries,setEntries]=useState<LogEntry[]>([])
  const [filters,setFilters]=useState<LogFilters>(emptyLogFilters),[query,setQuery]=useState(''),[auto,setAuto]=useState(false)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0)
  const request=useRef<AbortController|null>(null),lock=useRef(false),mounted=useRef(true)
  useFormNavigationGuard(busy,false)
  useEffect(()=>{
    mounted.current=true; const abort=new AbortController(); request.current=abort; let timer:ReturnType<typeof setTimeout>
    const load=async(initial=false)=>{
      if (abort.signal.aborted || simulated) return
      if ((initial || !window.document.hidden) && !lock.current) {
        setBusy(true); setError('')
        try { const next=await readLogs(filters,0,abort.signal); if(!abort.signal.aborted){setData(next);setEntries(next.entries)} }
        catch { if(!abort.signal.aborted)setError('日志读取失败，请重新读取。') }
        finally { if(!abort.signal.aborted)setBusy(false) }
      }
      if(auto&&!abort.signal.aborted)timer=setTimeout(()=>void load(),5000)
    }
    void load(true)
    return()=>{mounted.current=false;abort.abort();clearTimeout(timer)}
  },[filters,auto,revision,simulated])
  const more=async()=>{
    if(!data?.has_more||!data.next_before_id||busy||lock.current)return
    lock.current=true;setBusy(true);setError('')
    try { const next=await readLogs(filters,data.next_before_id,request.current?.signal);if(mounted.current){setEntries(current=>[...new Map([...current,...next.entries].map(item=>[item.id,item])).values()].slice(0,1000));setData(next)} }
    catch {if(mounted.current)setError('更早日志读取失败，请重试。')}
    finally{lock.current=false;if(mounted.current)setBusy(false)}
  }
  const clear=async()=>{
    if(busy||lock.current||!window.confirm('清空全部运行日志？不只是当前筛选结果。无法恢复，不影响对话记忆或配置。'))return
    lock.current=true;setBusy(true);setError('');setNotice('')
    try{const deleted=await clearLogs();if(mounted.current){setNotice(`已确认清理 ${deleted} 条；机器人随后产生的新日志仍会显示。`);setRevision(value=>value+1)}}
    catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:'清理未确认，请重新读取。')}
    finally{lock.current=false;if(mounted.current)setBusy(false)}
  }
  const download=async()=>{
    if(busy||lock.current)return
    lock.current=true;setBusy(true);setError('')
    try{const body=await exportLogs(filters,request.current?.signal);if(mounted.current){const url=URL.createObjectURL(new Blob([body],{type:'application/x-ndjson'}));const anchor=window.document.createElement('a');anchor.href=url;anchor.download='zebao-operations.ndjson';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('已生成筛选日志文件，最多 2000 条。')}}
    catch{if(mounted.current)setError('导出未完成，请缩小筛选范围后重试。')}
    finally{lock.current=false;if(mounted.current)setBusy(false)}
  }
  return <SettingsPage title="运行日志" simulated={simulated}>
    <form className="diagnostic-toolbar" onSubmit={event=>{event.preventDefault();setNotice('');setFilters({...filters,query:query.trim().slice(0,100)});setRevision(value=>value+1)}}>
      <label><span className="sr-only">搜索日志</span><input type="search" value={query} placeholder="搜索事件" maxLength={100} disabled={busy} onChange={event=>setQuery(event.target.value)}/></label>
      <label><span className="sr-only">日志模块</span><select value={filters.category} disabled={busy} onChange={event=>{setFilters({...filters,category:event.target.value});setNotice('')}}><option value="">全部模块</option>{Object.entries(logCategories).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
      <label><span className="sr-only">日志级别</span><select value={filters.level} disabled={busy} onChange={event=>{setFilters({...filters,level:event.target.value});setNotice('')}}><option value="">全部级别</option>{Object.entries(logLevels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
      <button type="submit" disabled={busy}>查询</button><button type="button" disabled={busy} onClick={()=>setRevision(value=>value+1)}>刷新</button>
    </form>
    <label className="settings-toggle"><input type="checkbox" checked={auto} disabled={busy} onChange={event=>setAuto(event.target.checked)}/>自动刷新最新记录</label>
    {error&&<p role="alert" className="workspace-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!data?<p role="status">{busy?'正在读取日志':'尚未读取日志'}</p>:<>
      <p className="settings-footnote">匹配 {data.total_matching} 条{data.summary?.issues_24h===undefined?'':` · 近 24 小时提醒与错误 ${data.summary.issues_24h} 条`}</p>
      <div className="diagnostic-list" aria-label="运行日志时间轴">{entries.map(item=><details key={item.id}><summary><strong className="diagnostic-event-title">{diagnosticText(item.summary)||'事件摘要未提供'}</strong><span>{logCategories[item.category]||'其他事件'} · {logLevels[item.level]||'未知级别'} · {timeLabel(item.timestamp_utc)}</span></summary><dl className="diagnostic-facts"><div><dt>阶段</dt><dd>{diagnosticText(item.stage)||'未提供'}</dd></div><div><dt>耗时</dt><dd>{item.latency_ms==null?'未记录':`${Math.round(item.latency_ms)} 毫秒`}</dd></div></dl><details><summary>诊断字段</summary><pre className="diagnostic-code">{JSON.stringify(redactDiagnostic({event:item.event_type,status:item.status,turn_id:item.turn_id,utterance_id:item.utterance_id,trace_id:item.trace_id,code:item.code,details:item.details}),null,2)}</pre></details></details>)}</div>
      {!entries.length&&<p className="workspace-empty">没有符合条件的日志</p>}
      {data.has_more&&<button disabled={busy||auto||entries.length>=1000} onClick={()=>void more()}>加载更早记录</button>}{auto&&data.has_more&&<p className="settings-footnote">暂停自动刷新后可翻阅历史。</p>}{entries.length>=1000&&<p>已显示 1000 条，请缩小筛选范围。</p>}
      <details className="settings-help"><summary>导出与清理</summary><p className="settings-footnote">导出最多 2000 条筛选记录。日志可能包含业务内容，请妥善保存。</p><div className="settings-actions"><button disabled={busy} onClick={()=>void download()}>导出筛选日志</button><button disabled={busy} onClick={()=>void clear()}>清空全部日志</button></div></details>
    </>}
  </SettingsPage>
}
