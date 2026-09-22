import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import OperationsLogs from '../features/foundation/OperationsLogs'
import PipelineDiagnostics from '../features/foundation/PipelineDiagnostics'
import AcceptanceRecords from '../features/foundation/AcceptanceRecords'
import Foundation from '../features/foundation/Foundation'
import { clearLogs, emptyLogFilters, exportLogs, readAcceptance, readExtendedDiagnostic, readLogs, readPipeline, redactDiagnostic } from '../api/diagnostics'
import { setBaseUrl } from '../api/client'

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()})
const entry=(id:number)=>({id,summary:`模拟事件 ${id}`,timestamp_utc:'2026-09-12T01:00:00Z',category:'service',level:'info'})
const page=(ids:number[],more=false)=>({ok:true,entries:ids.map(entry),has_more:more,next_before_id:more?Math.min(...ids):null,total_matching:ids.length})
function backend(handler:(url:URL,init:RequestInit)=>unknown){
  setBaseUrl('http://robot.test:8000')
  const fetch=vi.fn(async(url:string,init:RequestInit={})=>Response.json(await handler(new URL(url),init)))
  vi.stubGlobal('fetch',fetch);return fetch
}
const show=(component:React.ReactNode)=>render(<MemoryRouter>{component}</MemoryRouter>)

it('工程入口均留在原 Client',()=>{
  show(<Foundation/>);fireEvent.click(screen.getByText('工程工具'))
  for(const [name,route] of [['运行日志','logs'],['链路诊断','pipeline'],['验收记录','acceptance']]) expect(screen.getByRole('link',{name:new RegExp(name)})).toHaveAttribute('href',`/dashboard/foundation/${route}`)
})
it('日志进入只读，自动刷新默认关闭，筛选与分页保留',async()=>{
  const fetch=backend(url=>page(url.searchParams.has('before_id')?[9,8]:[10,9],!url.searchParams.has('before_id')))
  show(<OperationsLogs/>);await screen.findByText('模拟事件 10')
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  fireEvent.click(screen.getByRole('button',{name:'加载更早记录'}));await screen.findByText('模拟事件 8')
  expect(screen.getAllByText('模拟事件 9')).toHaveLength(1)
  fireEvent.change(screen.getByLabelText('搜索日志'),{target:{value:'网络'}})
  fireEvent.click(screen.getByRole('button',{name:'查询'}))
  await waitFor(()=>expect(fetch.mock.calls.some(([url])=>new URL(url).searchParams.get('query')==='网络')).toBe(true))
  expect(fetch.mock.calls.every(([,init])=>!init?.method)).toBe(true)
})
it('清理取消不会写入，确认清理必须回读旧记录已消失',async()=>{
  let cleared=false
  const fetch=backend((url,init)=>{if(init.method==='DELETE'){cleared=true;return{ok:true,deleted:1,scope:'all'}}return page(url.searchParams.has('before_id')&&cleared?[]:[11])})
  show(<OperationsLogs/>);await screen.findByText('模拟事件 11')
  fireEvent.click(screen.getByText('导出与清理'))
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
  fireEvent.click(screen.getByRole('button',{name:'清空全部日志'}))
  expect(fetch.mock.calls.some(([,init])=>init?.method==='DELETE')).toBe(false)
  confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'清空全部日志'}))
  await screen.findByText(/已确认清理 1 条/)
  expect(fetch.mock.calls.some(([url])=>new URL(url).searchParams.get('before_id')==='12')).toBe(true)
})
it('清理未落地不会报告成功',async()=>{
  backend((_,init)=>init.method==='DELETE'?{ok:true,scope:'all',deleted:2}:page([20]))
  await expect(clearLogs()).rejects.toThrow('仍存在')
})
it('清理结果缺字段也不能视为成功',async()=>{
  backend((_,init)=>init.method==='DELETE'?{ok:true}:page([20]))
  await expect(clearLogs()).rejects.toThrow('未确认')
})
it('分页坏游标拒绝，避免重复拉取',async()=>{
  backend(()=>({...page([10],true),next_before_id:11}))
  await expect(readLogs(emptyLogFilters,10)).rejects.toThrow('分页状态不完整')
})
it('导出有 2000 条上限，并隐藏凭据与音频字段',async()=>{
  const fetch=backend(url=>{const start=Number(url.searchParams.get('before_id')||10000);return {...page(Array.from({length:200},(_,i)=>start-i-1),true),entries:Array.from({length:200},(_,i)=>({...entry(start-i-1),details:{api_key:'secret-value',audio:'raw-value'},summary:'Bearer secret-value'}))}})
  const body=await exportLogs({...emptyLogFilters,category:'service'})
  expect(body.split('\n')).toHaveLength(2000);expect(fetch).toHaveBeenCalledTimes(10)
  expect(body).not.toContain('secret-value');expect(body).not.toContain('raw-value')
  expect(fetch.mock.calls.every(([url])=>new URL(url).searchParams.get('category')==='service')).toBe(true)
})
it('默认诊断不查询兼容链路，不暴露说话人字段',async()=>{
  const fetch=backend(url=>url.pathname.endsWith('/ui/runtime')?{ok:true,scene:{name:'现场场景'},voice:{provider:'aliyun_native_omni'}}:{ok:true,backend_connected:true,office:{turn_pipeline:{state:'idle',stage:'failed',current:{turn_id:2,stage:'failed',updated_age_ms:90000,speaker_name:'PRIVATE'}}}})
  const snapshot=await readPipeline();expect(JSON.stringify(snapshot)).not.toContain('PRIVATE')
  show(<PipelineDiagnostics/>);await screen.findByText('90 秒')
  expect(screen.getByText('空闲')).toBeInTheDocument()
  expect(screen.getByText(/回合结果可能是历史记录/)).toBeInTheDocument()
  expect(fetch.mock.calls.some(([url])=>url.includes('diagnostic_snapshot'))).toBe(false)
})
it('完整诊断的 ok false 是检查未通过而不是 HTTP 失败',async()=>{
  backend(()=>({ok:false,captured_at_utc:'2026-09-12T01:00:00Z',failed_checks:['平台未连接'],self_check:{checks:[{name:'平台连接',ok:false}]},status:{image:'PRIVATE'}}))
  const result=await readExtendedDiagnostic()
  expect(result.ok).toBe(false);expect(result.failed_checks).toEqual(['平台未连接']);expect(JSON.stringify(result)).not.toContain('PRIVATE')
  await expect(readAcceptance()).rejects.toThrow()
})
it('无验收记录明确未验收，不生成假通过',async()=>{
  const fetch=backend(()=>({ok:true,runs:[],stages:[],count:0}))
  show(<AcceptanceRecords/>);await screen.findByText(/还没有验收记录/)
  expect(screen.queryByText('记录为通过')).not.toBeInTheDocument()
  expect(fetch.mock.calls.every(([,init])=>!init?.method)).toBe(true)
})
it('验收页把服务端真人阻断项转成下一步引导，不代填通过',async()=>{
  backend(url=>url.pathname.endsWith('/demo-readiness')?{ready:false,state:'blocked',blockers:['voice_turn_acceptance'],voice_turn_acceptance:{passed:false,reason:'acceptance_file_missing',completed_count:0,required_count:6}}:{ok:true,runs:[],stages:[],count:0})
  show(<AcceptanceRecords/>);await screen.findByText(/语音真人验收：需要真人完成/)
  expect(screen.getByText('等待真人证据')).toBeInTheDocument()
  expect(screen.getByText(/语音真人验收进度：0\/6/)).toBeInTheDocument()
  expect(screen.queryByText('记录为通过')).not.toBeInTheDocument()
})
it('验收结论使用服务端 passed，不由通过环节数推断',async()=>{
  backend(()=>({ok:true,count:1,stages:[{id:'voice',label:'语音'}],runs:[{run_id:'fixture',recorded_at:'2026-09-12',passed:false,scene:{id:'quiet',generation:'g1'},release:{git_commit:'abc',artifact_sha256:'hash'},voice_mode:'aliyun_native_omni',stages:{voice:true},capability_results:[],device_results:[]}]}))
  show(<AcceptanceRecords/>);await screen.findByText('记录未通过')
  expect(screen.queryByText('记录为通过')).not.toBeInTheDocument()
})
it('模拟模式三个页面不读写真实设备',()=>{
  const fetch=backend(()=>({}))
  show(<><OperationsLogs simulated/><PipelineDiagnostics simulated/><AcceptanceRecords simulated/></>)
  expect(fetch).not.toHaveBeenCalled()
})
it('递归脱敏与文本长度有界',()=>{
  const value=redactDiagnostic({nested:{password:'secret',subject:'person',text:'sk-test-key'} ,long:'x'.repeat(8000)})
  expect(JSON.stringify(value)).not.toContain('secret');expect(JSON.stringify(value)).not.toContain('sk-test-key');expect(JSON.stringify(value).length).toBeLessThan(4500)
})
