import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  readAcceptance,
  recordAcceptanceRun,
  timeLabel,
  type AcceptanceDocument,
  type AcceptanceRunPayload,
} from '../../api/diagnostics'
import {
  fetchEcosystemHealth,
  fetchReadiness,
  fetchSceneRuntime,
  fetchSkillRegistry,
  type EcosystemHealthSnapshot,
  type ReadinessSnapshot,
  type SceneRuntimeSnapshot,
  type SkillRegistrySnapshot,
} from '../../api/sceneRuntime'
import { voiceName } from '../../api/voiceSettings'
import './acceptance.css'

type GateState = 'pass' | 'needs-human' | 'fail' | 'unknown'

const gateLabels: Record<string, string> = {
  field_network: '网络路径',
  release_bound: '运行构件绑定',
  answer_hot: '回答服务',
  omni_hot: '云端 Omni',
  vision_available: '视觉服务',
  voiceprint_persistent: '声纹数据持久',
  barge_in_proven: '自然打断证据',
  disk_hard_floor: '磁盘硬下限',
  disk_target: '磁盘建议余量',
  temperature: '温度',
  movement_single_writer: '动作单写入',
  voiceprint_acceptance: '声纹真人证据',
  voice_turn_acceptance: '语音回合真人证据',
}

const humanGates = new Set(['voiceprint_acceptance', 'voice_turn_acceptance'])

const stageRoutes: Record<string, { label: string; to: string }> = {
  identity: { label: '人员与身份', to: '/dashboard/foundation/people' },
  vision: { label: '视觉与具身', to: '/dashboard/foundation/vision' },
  knowledge_display: { label: '场景挂载', to: '/dashboard/scenes' },
  dialogue: { label: '语音与唤醒', to: '/dashboard/foundation/voice' },
  capability: { label: '能力目录', to: '/dashboard/foundation/capabilities' },
  permission: { label: '人员权限', to: '/dashboard/foundation/people' },
  scene: { label: '场景配置', to: '/dashboard/scenes' },
  truthfulness: { label: '链路诊断', to: '/dashboard/foundation/pipeline' },
}

const initialDevice = { device_id: 'authorized_test_light', operation: '读取→切换→回读→恢复' }

function statusLabel(state: GateState) {
  return state === 'pass' ? '通过' : state === 'needs-human' ? '待真人' : state === 'fail' ? '未通过' : '待读取'
}

function gateState(key: string, readiness: ReadinessSnapshot | null): GateState {
  if (!readiness?.gates || typeof readiness.gates[key] !== 'boolean') return 'unknown'
  if (readiness.gates[key]) return 'pass'
  return humanGates.has(key) ? 'needs-human' : 'fail'
}

function maskCommit(value?: string) {
  const text = String(value || '').trim()
  return text ? text.slice(0, 12) : '未绑定'
}

export default function AcceptanceWorkspace({ simulated = false }: { simulated?: boolean }) {
  const [readiness, setReadiness] = useState<ReadinessSnapshot | null>(null)
  const [runtime, setRuntime] = useState<SceneRuntimeSnapshot | null>(null)
  const [health, setHealth] = useState<EcosystemHealthSnapshot | null>(null)
  const [skills, setSkills] = useState<SkillRegistrySnapshot | null>(null)
  const [acceptance, setAcceptance] = useState<AcceptanceDocument | null>(null)
  const [stageResults, setStageResults] = useState<Record<string, boolean>>({})
  const [capabilityEvidence, setCapabilityEvidence] = useState(false)
  const [deviceEvidence, setDeviceEvidence] = useState(false)
  const [deviceReadback, setDeviceReadback] = useState(false)
  const [deviceRestored, setDeviceRestored] = useState(false)
  const [displayRevision, setDisplayRevision] = useState('')
  const [latency, setLatency] = useState('')
  const [device, setDevice] = useState(initialDevice)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [unreadable, setUnreadable] = useState<string[]>([])
  const [notice, setNotice] = useState('')

  const read = useCallback(async () => {
    if (simulated) return
    setRefreshing(true)
    setError('')
    setUnreadable([])
    const results = await Promise.allSettled([
      fetchReadiness(),
      fetchSceneRuntime(),
      fetchEcosystemHealth(),
      fetchSkillRegistry(),
      readAcceptance(),
    ])
    const [readinessResult, runtimeResult, healthResult, skillsResult, acceptanceResult] = results
    if (readinessResult.status === 'fulfilled') setReadiness(readinessResult.value)
    if (runtimeResult.status === 'fulfilled') setRuntime(runtimeResult.value)
    if (healthResult.status === 'fulfilled') setHealth(healthResult.value)
    if (skillsResult.status === 'fulfilled') setSkills(skillsResult.value)
    if (acceptanceResult.status === 'fulfilled') {
      setAcceptance(acceptanceResult.value)
      setStageResults(current => {
        if (Object.keys(current).length) return current
        return Object.fromEntries(acceptanceResult.value.stages.map(stage => [stage.id, false]))
      })
    }
    const sourceLabels = ['自动门禁', '场景运行态', '健康摘要', 'Skill 契约', '历史验收']
    const failedSources = results.flatMap((item, index) => item.status === 'rejected' ? [sourceLabels[index]] : [])
    setUnreadable(failedSources)
    if (failedSources.length === results.length) {
      const first = results[0]
      setError(first.status === 'rejected' && first.reason instanceof Error ? first.reason.message : '机器人应用暂时没有返回验收数据，请检查连接后重试。')
    } else if (failedSources.length) {
      setError(`以下数据暂不可读：${failedSources.join('、')}。页面不会用缺失数据推断通过。`)
    }
    setRefreshing(false)
  }, [simulated])

  useEffect(() => { void read() }, [read])

  const gates = useMemo(() => Object.keys(readiness?.gates || {}).map(key => ({ key, label: gateLabels[key] || key, state: gateState(key, readiness) })), [readiness])
  const stageCount = Object.keys(stageResults).length
  const checkedStages = Object.values(stageResults).filter(Boolean).length
  const activeSceneGeneration = runtime?.scene?.generation || ''
  const latestRun = acceptance?.runs?.[0]

  const record = async () => {
    if (busy) return
    if (!activeSceneGeneration) { setError('当前场景代次未读取，不能记录验收。'); return }
    setBusy(true); setError(''); setNotice('')
    const payload: AcceptanceRunPayload = {
      scene_generation: activeSceneGeneration,
      stages: stageResults,
      capability_results: capabilityEvidence ? [{
        capability_id: runtime?.capabilities?.[0]?.id || 'scene_capability',
        ok: true,
        status: 'observed_success',
        provider: 'scene_capability',
      }] : [],
      device_results: deviceEvidence ? [{
        ...device,
        readback_ok: deviceReadback,
        restored: deviceRestored,
      }] : [],
      display_revision: displayRevision.trim(),
      latency_ms: latency.trim() && Number.isFinite(Number(latency)) ? { operator_observed: Number(latency) } : {},
    }
    try {
      const result = await recordAcceptanceRun(payload)
      setNotice(result.run.passed ? '本次验收记录已保存，服务端判定为通过。' : '本次验收记录已保存，但证据仍不完整，状态保持未通过。')
      await read()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '验收记录未保存，请检查场景代次后重试。')
    } finally { setBusy(false) }
  }

  if (simulated) return <div className="workspace-page acceptance-page"><header className="product-header"><div><h1>验收工作台</h1><p>按当前场景快照核对运行边界</p></div></header><div className="workspace-body"><p className="workspace-empty">连接机器人后读取真实发布、场景、能力和验收证据；预览模式不显示虚构结果。</p></div></div>

  return <div className="workspace-page acceptance-page">
    <header className="product-header">
      <div><h1>验收工作台</h1><p>先看自动门禁，再按当前场景完成真人步骤；缺证据不会被页面判为通过。</p></div>
      <button type="button" disabled={refreshing || busy} onClick={() => void read()}>{refreshing ? '读取中' : '重新读取'}</button>
    </header>
    <div className="workspace-body">
      {error && <div className="acceptance-alert acceptance-alert--error" role="alert"><div><strong>{unreadable.length === 5 ? '机器人应用暂不可达' : '部分实时数据不可读'}</strong><p>{error}</p><small>这表示证据还没有读取完整，不代表验收通过或设备已停止。</small></div><button type="button" disabled={refreshing || busy} onClick={() => void read()}>{refreshing ? '读取中' : '重新读取'}</button></div>}
      {notice && <p className="settings-notice" role="status">{notice}</p>}

      <ol className="acceptance-flow" aria-label="验收流程">
        <li className={readiness ? 'is-ready' : ''}><span>01</span><div><strong>运行检查</strong><small>运行构件、设备与场景快照</small></div></li>
        <li className={checkedStages > 0 ? 'is-ready' : ''}><span>02</span><div><strong>真人步骤</strong><small>现场观察后逐项勾选</small></div></li>
        <li className={latestRun ? 'is-ready' : ''}><span>03</span><div><strong>结果证据</strong><small>绑定代次后保存记录</small></div></li>
      </ol>

      <section className="acceptance-hero" aria-label="验收总览">
        <div><span className="workspace-eyebrow">当前运行边界</span><h2>{runtime?.scene?.name || '场景未确认'}</h2><p>{runtime?.scene?.description || '只读取 SceneManager 的冻结快照，不回退到默认场景。'}</p></div>
        <span className={`acceptance-status ${readiness?.ready ? 'is-pass' : 'is-pending'}`}><i aria-hidden="true" />{readiness?.ready ? '自动门禁通过' : '等待真人证据'}</span>
      </section>

      <section className="acceptance-snapshot" aria-label="发布与场景快照">
        <div><span>发布</span><strong>{health?.release?.app_version || '未读取'}</strong><small>{health?.release?.bound ? '构件已绑定' : '构件未绑定'}</small></div>
        <div><span>提交</span><strong>{maskCommit(health?.release?.git_commit)}</strong><small>运行代码</small></div>
        <div><span>场景代次</span><strong>{maskCommit(runtime?.scene?.generation)}</strong><small>{runtime?.scene?.id || '未读取'}</small></div>
        <div><span>语音</span><strong>{voiceName(runtime?.voice?.provider, runtime?.voice?.label)}</strong><small>{readiness?.voice_mode || '未读取'}</small></div>
        <div><span>能力 / Skill</span><strong>{runtime?.capability_count ?? runtime?.capabilities?.length ?? '—'} / {skills?.count ?? '—'}</strong><small>当前场景可用</small></div>
      </section>

      <section className="acceptance-section" aria-labelledby="automatic-gates-heading">
        <div className="acceptance-section__heading"><div><span className="workspace-eyebrow">第一层</span><h2 id="automatic-gates-heading">自动门禁</h2></div><Link to="/dashboard/foundation/pipeline">查看链路诊断 →</Link></div>
        <div className="acceptance-gates">{gates.length ? gates.map(item => <div className={`acceptance-gate is-${item.state}`} key={item.key}><span>{item.label}</span><strong>{statusLabel(item.state)}</strong></div>) : <p className="workspace-empty">正在读取自动门禁。</p>}</div>
        <p className="settings-footnote">“待真人”表示服务端健康但还没有现场证据；“未通过”表示软件或设备门禁本身未满足。两者不能混用。</p>
      </section>

      <section className="acceptance-section" aria-labelledby="human-steps-heading">
        <div className="acceptance-section__heading"><div><span className="workspace-eyebrow">第二层</span><h2 id="human-steps-heading">真人验收步骤</h2></div><span>{checkedStages}/{stageCount || 12} 已勾选</span></div>
        <p className="acceptance-section__intro">每一项都要在真实机器人上看到结果后再勾选。页面只保存结果代码，不保存原始音频、图像或模型原文。</p>
        <div className="acceptance-stages">{(acceptance?.stages || []).map(stage => { const route = stageRoutes[(stage as { kind?: string }).kind || '']; return <label className="acceptance-stage" key={stage.id}><input type="checkbox" checked={stageResults[stage.id] === true} onChange={event => setStageResults(current => ({ ...current, [stage.id]: event.target.checked }))}/><span><strong>{stage.label}</strong><small>{route ? <Link to={route.to} onClick={event => event.stopPropagation()}>{route.label} →</Link> : '按当前场景实际链路观察'}</small></span></label> })}</div>
        {!acceptance?.stages?.length && <p className="workspace-empty">验收步骤目录暂不可读。</p>}
      </section>

      <section className="acceptance-section" aria-labelledby="evidence-heading">
        <div className="acceptance-section__heading"><div><span className="workspace-eyebrow">第三层</span><h2 id="evidence-heading">结果证据</h2></div><span>保存前再次核对</span></div>
        <div className="acceptance-evidence">
          <label className="acceptance-evidence__toggle"><input type="checkbox" checked={capabilityEvidence} onChange={event => setCapabilityEvidence(event.target.checked)}/><span><strong>能力真实执行并回读成功</strong><small>只有现场确实执行过当前场景能力，才勾选；不填能力不代表通过。</small></span></label>
          <label className="acceptance-evidence__toggle"><input type="checkbox" checked={deviceEvidence} onChange={event => setDeviceEvidence(event.target.checked)}/><span><strong>已完成一个测试设备闭环</strong><small>建议只用已授权测试灯：读取原状态 → 切换 → 回读 → 恢复。</small></span></label>
          {deviceEvidence && <div className="acceptance-fields"><label>设备标识<input value={device.device_id} onChange={event => setDevice(current => ({ ...current, device_id: event.target.value }))}/></label><label>操作摘要<input value={device.operation} onChange={event => setDevice(current => ({ ...current, operation: event.target.value }))}/></label><label className="acceptance-check"><input type="checkbox" checked={deviceReadback} onChange={event => setDeviceReadback(event.target.checked)}/> 状态已回读</label><label className="acceptance-check"><input type="checkbox" checked={deviceRestored} onChange={event => setDeviceRestored(event.target.checked)}/> 已恢复原状态</label></div>}
          <div className="acceptance-fields"><label>展示版本（可选）<input value={displayRevision} onChange={event => setDisplayRevision(event.target.value)} placeholder="只填真实展示回读版本"/></label><label>观察延迟毫秒（可选）<input inputMode="decimal" value={latency} onChange={event => setLatency(event.target.value.replace(/[^0-9.]/g, ''))} placeholder="例如 850"/></label></div>
        </div>
        <div className="acceptance-submit"><p>提交只记录本次观察结果，不会执行灯光、动作或语音；服务端会绑定当前场景代次和发布构件重新判定。</p><button className="workspace-primary" type="button" disabled={busy || !activeSceneGeneration} onClick={() => void record()}>{busy ? '保存中' : '保存本次验收记录'}</button></div>
      </section>

      <section className="acceptance-section acceptance-history" aria-labelledby="history-heading">
        <div className="acceptance-section__heading"><div><span className="workspace-eyebrow">历史证据</span><h2 id="history-heading">最近验收记录</h2></div><Link to="/dashboard/foundation/acceptance">打开详细记录 →</Link></div>
        {latestRun ? <article className="acceptance-history__row"><strong>{latestRun.passed ? '服务端判定通过' : '证据未完整'}</strong><span>{timeLabel(latestRun.recorded_at)} · {latestRun.scene.id} · {maskCommit(latestRun.release.git_commit)}</span></article> : <p className="workspace-empty">还没有记录；真人勾选不会自动写入，需点击保存。</p>}
      </section>
    </div>
  </div>
}
