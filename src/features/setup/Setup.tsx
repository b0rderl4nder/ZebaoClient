import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { fetchSceneRuntime, type SceneRuntimeSnapshot } from '../../api/sceneRuntime'
import { operatorPage } from '../../api/operator'
import './setup.css'

const steps = ['服务连接', '场景组合', '交互与权限', '检查运行']

export default function Setup({ simulated = false, host = '' }: { simulated?: boolean; host?: string }) {
  const [params, setParams] = useSearchParams()
  const step = Math.max(0, Math.min(3, Number(params.get('step')) || 0)) | 0
  const [runtime, setRuntime] = useState<SceneRuntimeSnapshot | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => { title.current?.focus() }, [step])
  useEffect(() => {
    if (simulated) { setLoading(false); return }
    const controller = new AbortController()
    let pending = false
    const read = async () => {
      if (pending) return
      pending = true
      try {
        const result = await fetchSceneRuntime(controller.signal)
        if (!controller.signal.aborted) { setRuntime(result); setError('') }
      } catch (reason) {
        if (!controller.signal.aborted) { setRuntime(null); setError(reason instanceof Error ? reason.message : '无法读取场景配置') }
      } finally { pending = false; if (!controller.signal.aborted) setLoading(false) }
    }
    setLoading(true)
    void read()
    window.addEventListener('focus', read)
    return () => { controller.abort(); window.removeEventListener('focus', read) }
  }, [simulated, revision])
  const scene = runtime?.scene
  const sceneRoute = scene?.id ? `scene?id=${encodeURIComponent(scene.id)}` : 'scenes'
  const external = (name: string, note: string, route: string) => simulated
    ? <div className="setup-setting" aria-disabled="true"><strong>{name}</strong><span>{note}</span><small>请先连接机器人</small></div>
    : <a className="setup-setting" href={operatorPage(route)} target="_blank" rel="noreferrer"><strong>{name}</strong><span>{note}</span><small>打开设置 ↗</small></a>
  const mountNames = (items: SceneRuntimeSnapshot['knowledge']) => items?.length ? items.map(item => item.name || item.label || item.id).join('、') : '未挂载（按需）'
  return <div className="workspace-page setup-page">
    <header className="product-header"><div><h1>配置泽宝</h1><p>{simulated ? '界面预览 · 不会修改设备' : host ? `当前设备 · ${host}` : '请先确认设备连接'}</p></div><Link to="/dashboard">返回概览</Link></header>
    <div className="workspace-body setup-body">
      <nav aria-label="配置步骤"><ol className="setup-steps">{steps.map((name, index) => <li key={name}><button aria-current={index === step ? 'step' : undefined} onClick={() => setParams({ step: String(index) })}><span aria-hidden="true">0{index + 1}</span>{name}</button></li>)}</ol></nav>
      <section className="setup-panel" aria-labelledby="setup-title">
        <div className="setup-panel-title"><span className="setup-step-label">第 {step + 1} 步 / 共 4 步</span><h2 id="setup-title" ref={title} tabIndex={-1}>{steps[step]}</h2></div>
        {step === 0 && <><p className="setup-lead">先连接可复用的服务，再让场景选择使用哪些。密钥和地址只维护一份。</p><div className="setup-grid">
          {external('语音服务', '选择链路、音色与唤醒方式', 'device/voice')}
          {external('麦克风与扬声器', '确认输入设备、音量与收音', 'device/sound')}
          {external('网络与物联网', '连接网络和设备提供方；按需配置', 'device/network')}
          {external('能力与知识来源', '配置能力所需的知识库、服务和参数', 'capabilities')}
        </div></>}
        {step === 1 && <><p className="setup-lead">场景是一组挂载关系。创建或复制一个场景，为它选择语音、交互、能力、知识库与展示目标。</p><div className="setup-scene-summary"><span>当前运行场景</span><strong>{scene?.name || (loading ? '正在读取' : '尚未取得运行场景')}</strong></div><div className="setup-grid">
          {external('创建、复制与删除', '空白创建或复制已有组合；删除可恢复', 'scenes')}
          {external('编辑当前场景', '集中配置全部挂载，不复制服务密钥', sceneRoute)}
        </div><dl className="setup-bindings"><div><dt>语音</dt><dd>{runtime?.voice?.label || '未取得挂载信息'}</dd></div><div><dt>能力</dt><dd>{runtime ? `${runtime.capabilities?.length || 0} 项` : '未取得挂载信息'}</dd></div><div><dt>知识库</dt><dd>{runtime ? mountNames(runtime.knowledge) : '未取得挂载信息'}</dd></div><div><dt>展示目标</dt><dd>{runtime ? mountNames(runtime.displays) : '未取得挂载信息'}</dd></div></dl></>}
        {step === 2 && <><p className="setup-lead">基础系统负责感知与动作；场景选择交互方式，人员档案决定受保护能力的权限。</p><div className="setup-grid">
          <Link className="setup-setting" to="/dashboard/foundation/interaction"><strong>具身交互</strong><span>场景活跃度、模仿与非语言互动</span><small>打开设置 →</small></Link>
          {external('呼吸与转向', '待机、听声反馈与机型参数', 'device/motion')}
          {external('视觉与观察', '摄像头与环境感知', 'device/vision')}
          {external('人员与能力权限', '身份凭证、称呼与授权；按需配置', 'people')}
        </div></>}
        {step === 3 && <><p className="setup-lead">保存设置后重新读取。挂载信息不代表真机验收通过，启用前仍需检查连接与执行结果。</p><dl className="setup-bindings"><div><dt>当前场景</dt><dd>{scene?.name || '尚未取得运行场景'}</dd></div><div><dt>语音挂载</dt><dd>{runtime?.voice?.label || '未取得挂载信息'}</dd></div><div><dt>交互策略</dt><dd>{runtime?.interaction?.name || '未取得挂载信息'}</dd></div><div><dt>设备验证</dt><dd>在验收记录中确认</dd></div></dl><div className="setup-grid">
          {external('检查与验收', '查看真实结果和待处理问题', 'engineering/acceptance')}
          <Link className="setup-setting" to="/dashboard/scenes"><strong>选择运行场景</strong><span>核对挂载后再切换，不自动启用</span><small>打开场景 →</small></Link>
        </div></>}
        <div className="setup-readback" aria-live="polite">{simulated ? <span>连接机器人后读取实际配置。</span> : error ? <span role="alert">{error}</span> : loading ? <span role="status">正在读取设备配置…</span> : <span>已读取当前场景配置 · 切回本页自动更新</span>}{!simulated && <button disabled={loading} onClick={() => setRevision(value => value + 1)}>重新读取</button>}</div>
        <footer className="setup-footer"><span>设置页在新标签打开，保存后回到这里继续。</span><div>{step > 0 && <button onClick={() => setParams({ step: String(step - 1) })}>上一步</button>}{step < 3 ? <button className="workspace-primary" onClick={() => setParams({ step: String(step + 1) })}>下一步</button> : <Link className="workspace-primary" to="/dashboard/scenes">进入场景工作区</Link>}</div></footer>
      </section>
    </div>
  </div>
}
