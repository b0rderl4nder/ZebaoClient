import { operatorRequest } from './operator'
import type { SceneRuntimeSnapshot } from './sceneRuntime'

const request = <T>(path: string, init: RequestInit = {}) => operatorRequest<T>(`/api/v1${path}`, init, true, 15000)
export const logCategories: Record<string, string> = { speech:'听取与识别', response:'回答', conversation:'对话', tool:'能力执行', playback:'播报与打断', identity:'身份', vision:'视觉', motion:'动作', system:'系统', service:'服务' }
export const logLevels: Record<string, string> = { info:'记录', warning:'提醒', error:'错误', critical:'严重错误' }
export interface LogEntry { id:number; timestamp_unix:number; timestamp_utc:string; level:string; category:string; summary:string; stage:string; status:string; utterance_id:number; turn_id:string; trace_id:string; event_type:string; code:number|null; latency_ms:number|null; details:unknown }
export interface LogPage { entries:LogEntry[]; total_matching:number; has_more:boolean; next_before_id:number|null; summary?:{ issues_24h?:number; retention_days?:number; max_entries?:number; dropped_writes?:number } }
export interface LogFilters { query:string; category:string; level:string }
export const emptyLogFilters: LogFilters = { query:'', category:'', level:'' }
export async function readLogs(filters:LogFilters, before = 0, signal?:AbortSignal, limit = 50):Promise<LogPage> {
  const query = new URLSearchParams({ limit:String(limit) })
  if (before) query.set('before_id',String(before))
  for (const [key,value] of Object.entries(filters)) if (value) query.set(key,value)
  const data = await request<LogPage>(`/operations/logs?${query}`,{signal})
  if (!Array.isArray(data.entries) || typeof data.has_more !== 'boolean' || !Number.isFinite(data.total_matching) || data.entries.some(item => !Number.isSafeInteger(item.id) || item.id < 1 || typeof item.summary !== 'string') || data.has_more && (!Number.isSafeInteger(data.next_before_id) || Number(data.next_before_id) <= 0 || before > 0 && Number(data.next_before_id) >= before)) throw new Error('日志分页状态不完整，请重新读取。')
  return data
}
export async function clearLogs():Promise<number> {
  const before = await readLogs(emptyLogFilters,0,undefined,1)
  const cutoff = before.entries[0]?.id || 0
  const result = await request<{deleted:number;scope:string}>('/operations/logs?all_entries=true',{method:'DELETE'})
  if (!Number.isInteger(result.deleted) || result.deleted < 0 || result.scope !== 'all') throw new Error('日志清理结果未确认，请重新读取，勿重复操作。')
  if (cutoff && (await readLogs(emptyLogFilters,cutoff+1,undefined,1)).entries.length) throw new Error('清理前的日志仍存在，请重新读取，勿重复操作。')
  return result.deleted
}
/** Same bounded 2000-entry export as App; paged to avoid a large proxy response. */
export async function exportLogs(filters:LogFilters,signal?:AbortSignal):Promise<string> {
  let before = 0; const rows = new Map<number,LogEntry>()
  for (let page = 0; page < 10 && rows.size < 2000; page++) {
    const result = await readLogs(filters,before,signal,200)
    for (const item of result.entries) rows.set(item.id,item)
    if (!result.has_more) break
    before = result.next_before_id!
  }
  return [...rows.values()].slice(0,2000).map(item => JSON.stringify(redactDiagnostic(item))).join('\n')
}
export function redactDiagnostic(value:unknown, depth=0):unknown {
  if (depth>5) return '[已折叠]'
  if (typeof value==='string') return value.replace(/\b(?:sk-[\w.\-]+|pat_[\w]+|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g,'[凭据已隐藏]').replace(/Bearer\s+[^\s"']+/gi,'[凭据已隐藏]').slice(0,4000)
  if (Array.isArray(value)) return value.slice(0,100).map(item=>redactDiagnostic(item,depth+1))
  if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).slice(0,80).map(([key,item])=>[key,/(api.?key|authorization|token|password|secret|pcm|audio|image|frame|embedding|subject|speaker_name|person_name|identity)/i.test(key)?'[私密字段已隐藏]':redactDiagnostic(item,depth+1)]))
  return value
}
export const diagnosticText = (value:unknown) => String(redactDiagnostic(typeof value==='string'?value:'') || '')
export function timeLabel(value:string|number):string {
  const date=new Date(typeof value==='number'?value*1000:value)
  return Number.isFinite(date.valueOf())?date.toLocaleString('zh-CN',{hour12:false}):'时间未知'
}
export const stageLabel = (value?:string) => ({ idle:'空闲', listening:'收听', capturing:'采集', admitted:'已准入', processing:'处理中', thinking:'生成中', speaking:'播报中', completed:'已结束', done:'已结束', failed:'失败', cancelled:'已取消', pending:'等待处理' } as Record<string,string>)[value||''] || diagnosticText(value) || '未提供'
interface Turn { turn_id?:number; stage?:string; source?:string; admission_reason?:string; cancel_reason?:string; age_ms?:number; updated_age_ms?:number; output_generation?:number; utterance_id?:number }
export interface PipelineSnapshot { runtime:SceneRuntimeSnapshot; state?:string; stage?:string; reason?:string; current?:Turn; cancelled?:Turn; connected?:boolean }
const object = (value:unknown):Record<string,unknown> => value && typeof value==='object' && !Array.isArray(value)?value as Record<string,unknown>:{}
function turn(value:unknown):Turn|undefined {
  const source=object(value); if (!Object.keys(source).length) return undefined
  return Object.fromEntries(['turn_id','stage','source','admission_reason','cancel_reason','age_ms','updated_age_ms','output_generation','utterance_id'].filter(key=>typeof source[key]==='string'||typeof source[key]==='number').map(key=>[key,source[key]]))
}
export async function readPipeline(signal?:AbortSignal):Promise<PipelineSnapshot> {
  const [runtime,status]=await Promise.all([request<SceneRuntimeSnapshot>('/ui/runtime',{signal}),request<Record<string,unknown>>('/status',{signal})])
  const pipeline=object(object(status.office).turn_pipeline)
  return {runtime,state:typeof pipeline.state==='string'?pipeline.state:undefined,stage:typeof pipeline.stage==='string'?pipeline.stage:undefined,reason:typeof pipeline.blocked_reason==='string'?pipeline.blocked_reason:undefined,current:turn(pipeline.current),cancelled:turn(pipeline.last_cancelled),connected:typeof status.backend_connected==='boolean'?status.backend_connected:undefined}
}
export async function readExtendedDiagnostic(signal?:AbortSignal) {
  // `ok:false` here means an unhealthy snapshot, not a failed HTTP request.
  const data=await operatorRequest<Record<string,unknown>>('/api/v1/debug/diagnostic_snapshot?limit=10',{signal},true,20000,true)
  if (typeof data.captured_at_utc!=='string' || typeof data.ok!=='boolean') throw new Error('诊断快照不完整。')
  const check=object(data.self_check)
  return {ok:data.ok,captured_at_utc:data.captured_at_utc,summary:diagnosticText(data.summary),failed_checks:Array.isArray(data.failed_checks)?data.failed_checks.filter(value=>typeof value==='string').map(diagnosticText):[],checks:Array.isArray(check.checks)?check.checks.map(value=>{const item=object(value);return {name:diagnosticText(item.name),ok:typeof item.ok==='boolean'?item.ok:null}}):[]}
}
export interface AcceptanceRun { run_id:string; recorded_at:string; passed:boolean; scene:{id:string;generation:string}; release:{git_commit:string;artifact_sha256:string}; voice_mode:string; stages:Record<string,boolean>; capability_results:{capability_id:string;ok:boolean;status:string;provider:string}[]; device_results:{device_id:string;operation:string;readback_ok:boolean;restored:boolean}[]; display_revision:string; latency_ms:Record<string,number> }
export interface AcceptanceDocument { stages:{id:string;label:string}[]; runs:AcceptanceRun[]; count:number }
export async function readAcceptance(signal?:AbortSignal):Promise<AcceptanceDocument> {
  const data=await request<AcceptanceDocument>('/acceptance/runs',{signal})
  if (!Array.isArray(data.stages)||!Array.isArray(data.runs)||!Number.isInteger(data.count)||data.runs.some(item=>typeof item.passed!=='boolean'||typeof item.run_id!=='string'||!item.scene||!item.release||!item.stages||!Array.isArray(item.capability_results)||!Array.isArray(item.device_results))) throw new Error('验收记录不完整，请重新读取。')
  return data
}
