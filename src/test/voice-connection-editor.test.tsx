import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import VoiceConnectionEditor from '../features/foundation/VoiceConnectionEditor'
import { setBaseUrl } from '../api/client'

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()})
function backend(){
  setBaseUrl('http://robot.test:8000')
  const document={provider:'local_omni',revision:'rev-1',persistent:true,pending_restart:false,apply_mode:'app_restart',fields:[{id:'LOCAL_OMNI_WS_URL',label:'MiniCPM 服务地址',kind:'ws',value:'ws://original.test/stream',configured:true},{id:'LOCAL_OMNI_MODEL',label:'模型名称',kind:'text',value:'old-model',configured:true},{id:'LOCAL_OMNI_API_KEY',label:'密钥',kind:'secret',value:'',configured:true}]}
  let apply=true,fail=false
  const fetch=vi.fn(async(_url:string,init:RequestInit={})=>{
    if(fail)return Response.json({ok:false},{status:503})
    if(init.method==='PATCH'){
      const body=JSON.parse(String(init.body))
      if(apply){document.revision='rev-2';document.pending_restart=true;for(const field of document.fields)if(field.kind!=='secret'&&body.values[field.id])field.value=body.values[field.id]}
      return Response.json({ok:true,...document,revision:'rev-2'})
    }
    return Response.json({ok:true,...document})
  })
  vi.stubGlobal('fetch',fetch);return{fetch,noApply:()=>{apply=false},offline:()=>{fail=true}}
}
const show=()=>render(<MemoryRouter><VoiceConnectionEditor provider="local_omni" onDirty={()=>{}} onBusy={()=>{}}/></MemoryRouter>)
it('进入只读，编辑留在 Client，不调用旧 backend_config',async()=>{
  const api=backend();show();fireEvent.click(await screen.findByRole('button',{name:'编辑所选连接'}))
  expect(screen.getByLabelText('MiniCPM 服务地址')).toHaveValue('ws://original.test/stream')
  expect(screen.getByLabelText('密钥')).toHaveValue('')
  expect(api.fetch.mock.calls.every(([url,init])=>!init?.method&&!url.includes('backend_config'))).toBe(true)
})
it('保存需确认，只发送改变字段和版本，回读后告知待重启',async()=>{
  const api=backend();show();fireEvent.click(await screen.findByRole('button',{name:'编辑所选连接'}))
  fireEvent.change(screen.getByLabelText('模型名称'),{target:{value:'new-model'}})
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
  fireEvent.click(screen.getByRole('button',{name:'保存所选连接'}));expect(api.fetch.mock.calls.filter(([,init])=>init?.method)).toHaveLength(0)
  confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'保存所选连接'}))
  await screen.findByText(/连接已保存并回读/)
  const writes=api.fetch.mock.calls.filter(([,init])=>init?.method)
  expect(writes).toHaveLength(1);expect(JSON.parse(String(writes[0][1]?.body))).toEqual({revision:'rev-1',values:{LOCAL_OMNI_MODEL:'new-model'}})
  expect(screen.getByRole('link',{name:/应用管理安排重启/})).toHaveAttribute('href','/dashboard/apps')
})
it('回读不符不报告成功，保留非密钥草稿',async()=>{
  const api=backend();show();fireEvent.click(await screen.findByRole('button',{name:'编辑所选连接'}));api.noApply()
  vi.spyOn(window,'confirm').mockReturnValue(true)
  fireEvent.change(screen.getByLabelText('模型名称'),{target:{value:'new-model'}})
  fireEvent.change(screen.getByLabelText('密钥'),{target:{value:'temporary-secret'}})
  fireEvent.click(screen.getByRole('button',{name:'保存所选连接'}))
  await screen.findByText(/回读尚未确认/)
  expect(screen.getByLabelText('模型名称')).toHaveValue('new-model')
  expect(screen.getByLabelText('密钥')).toHaveValue('')
  expect(screen.queryByText(/连接已保存并回读/)).not.toBeInTheDocument()
})
it('接口不可用只重试，不切后端或返回旧页',async()=>{
  const api=backend();api.offline();show()
  await screen.findByRole('alert')
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'重试连接配置'}))
  await waitFor(()=>expect(api.fetch).toHaveBeenCalledTimes(2))
})
