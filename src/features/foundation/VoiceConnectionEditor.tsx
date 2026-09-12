import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { operatorRequest } from '../../api/operator'

interface ConnectionField { id:string; label:string; kind:'text'|'url'|'ws'|'secret'; value:string; configured:boolean; group?:string }
interface ConnectionDocument { provider:string; revision:string; persistent:boolean; pending_restart:boolean; apply_mode:string; fields:ConnectionField[] }
async function read(provider:string, signal?:AbortSignal):Promise<ConnectionDocument> {
  const data=await operatorRequest<ConnectionDocument>(`/api/v1/settings/voice-connections/${encodeURIComponent(provider)}`,{signal},true)
  if(data.provider!==provider||typeof data.revision!=='string'||!Array.isArray(data.fields)||data.fields.some(field=>!field.id||typeof field.value!=='string'))throw new Error('连接配置格式不完整。')
  return data
}

export default function VoiceConnectionEditor({provider,onDirty,onBusy}:{provider:string;onDirty:(dirty:boolean)=>void;onBusy:(busy:boolean)=>void}) {
  const [data,setData]=useState<ConnectionDocument|null>(null),[draft,setDraft]=useState<Record<string,string>>({})
  const [editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0)
  const lock=useRef(false),mounted=useRef(true)
  useEffect(()=>{onDirty(editing);return()=>onDirty(false)},[editing,onDirty])
  useEffect(()=>{onBusy(busy);return()=>onBusy(false)},[busy,onBusy])
  useEffect(()=>{
    const abort=new AbortController();mounted.current=true;setData(null);setError('');setBusy(true)
    void read(provider,abort.signal).then(next=>{if(!abort.signal.aborted)setData(next)}).catch(()=>{if(!abort.signal.aborted)setError('无法读取此链路的独立配置。请检查 App 连接与版本后重试，不会跳转旧页面。')}).finally(()=>{if(!abort.signal.aborted)setBusy(false)})
    return()=>{mounted.current=false;abort.abort()}
  },[provider,revision])
  const cancel=()=>{setEditing(false);setDraft({});setNotice('')}
  const save=async()=>{
    if(lock.current||!data)return
    const values=Object.fromEntries(data.fields.filter(field=>draft[field.id]?.trim()&&draft[field.id].trim()!==field.value).map(field=>[field.id,draft[field.id].trim()]))
    if(!Object.keys(values).length){setError('没有修改内容。');return}
    if(!window.confirm('保存此链路连接？不会切换场景或中断当前对话，重启 App 后生效。'))return
    lock.current=true;setBusy(true);setError('');setNotice('')
    try{
      const response=await operatorRequest<ConnectionDocument>(`/api/v1/settings/voice-connections/${encodeURIComponent(provider)}`,{method:'PATCH',body:JSON.stringify({revision:data.revision,values})},true)
      const confirmed=await read(provider)
      if(response.revision!==confirmed.revision||confirmed.persistent!==true||Object.entries(values).some(([id,value])=>{const field=confirmed.fields.find(item=>item.id===id);return !field||(field.kind==='secret'?!field.configured:field.value!==value)}))throw new Error('保存已提交，但回读尚未确认。请重新读取，勿重复提交。')
      if(mounted.current){setData(confirmed);setEditing(false);setDraft({});setNotice('连接已保存并回读；重启 App 后使用，不会自动选择此链路。')}
    }catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:'连接保存未确认。')}
    finally{lock.current=false;if(mounted.current){setBusy(false);setDraft(current=>Object.fromEntries(Object.entries(current).filter(([id])=>data.fields.find(field=>field.id===id)?.kind!=='secret')))}}
  }
  return <div aria-label="所选链路连接设置">
    {error&&<p role="alert" className="workspace-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!data?<><p>{busy?'正在读取连接配置':'连接配置未读取'}</p><button disabled={busy} onClick={()=>setRevision(value=>value+1)}>重试连接配置</button></>:<>
      <div className="settings-row"><p>{data.pending_restart?'有已保存配置，等待 App 重启生效':'已读取此链路配置'} · 编辑不会切换链路</p>{!editing&&<button disabled={busy} onClick={()=>{setDraft(Object.fromEntries(data.fields.map(field=>[field.id,field.kind==='secret'?'':field.value])));setError('');setEditing(true)}}>编辑所选连接</button>}</div>
      {editing&&<form onSubmit={event=>{event.preventDefault();void save()}}>{[...new Set(data.fields.map(field=>field.group||'连接'))].map((group,index)=><details className="settings-connection-group" key={group} open={index===0?true:undefined}><summary>{group}</summary><div className="settings-fields">{data.fields.filter(field=>(field.group||'连接')===group).map(field=><label key={field.id}>{field.label}<input type={field.kind==='secret'?'password':'text'} value={draft[field.id]||''} autoComplete={field.kind==='secret'?'new-password':'off'} disabled={busy} placeholder={field.kind==='secret'&&field.configured?'留空保留现有密钥':'留空保留原值'} onChange={event=>setDraft({...draft,[field.id]:event.target.value})}/></label>)}</div></details>)}<p className="settings-footnote">只填写要修改的值。保存不重启服务、不验证远端连通；重启时会短暂中断对话。</p><div className="settings-actions"><button type="button" disabled={busy} onClick={cancel}>取消编辑</button><button className="workspace-primary" disabled={busy}>{busy?'保存中':'保存所选连接'}</button></div></form>}
      {(data.pending_restart||notice)&&<Link to="/dashboard/apps">前往应用管理安排重启 →</Link>}
    </>}
  </div>
}
