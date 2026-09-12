import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  configureEmbodiedInteraction,
  fetchEmbodiedInteractionStatus,
  type EmbodiedInteractionPatch,
  type EmbodiedInteractionStatus,
} from '../../api/embodied'

const simulatedStatus: EmbodiedInteractionStatus = {
  ok: false,
  enabled: false,
  profile_source: 'interaction_policy_default',
  available_profiles: [],
  attention: { source: 'none', target_kind: '', age_ms: null },
  last_execution: { accepted: false, reason: 'simulation_without_robot', kind: '', age_ms: null },
}

export default function EmbodiedInteractionControl({ simulated = false }: { simulated?: boolean }) {
  const [status, setStatus] = useState<EmbodiedInteractionStatus | null>(simulated ? simulatedStatus : null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState('')
  const [notice, setNotice] = useState('')
  const savingRef = useRef(false), readingRef = useRef<number | null>(null), mounted = useRef(true)
  const readAbort = useRef<AbortController | null>(null)
  const readEpoch = useRef(0)

  const refresh = async () => {
    if (savingRef.current || readingRef.current !== null) return
    const epoch = ++readEpoch.current
    readingRef.current = epoch
    const abort = new AbortController(); readAbort.current = abort
    try {
      const next = simulated ? simulatedStatus : await fetchEmbodiedInteractionStatus(abort.signal)
      if (!mounted.current || readEpoch.current !== epoch) return
      setStatus(next)
      setError('')
    } catch (reason) {
      if (!mounted.current || readEpoch.current !== epoch) return
      setStatus(null)
      setError(reason instanceof Error ? reason.message : '交互系统状态暂不可用')
    } finally { if (readingRef.current === epoch) readingRef.current = null }
  }

  useEffect(() => {
    mounted.current = true
    void refresh()
    const timer = simulated ? undefined : window.setInterval(() => { void refresh() }, 4000)
    return () => { mounted.current = false; readEpoch.current++; readAbort.current?.abort(); readingRef.current = null; window.clearInterval(timer) }
  }, [simulated])

  const sceneId = status?.active_scene_id || ''

  const save = async (key: string, patch: EmbodiedInteractionPatch) => {
    if (savingRef.current || simulated) return
    savingRef.current = true; readEpoch.current++; readAbort.current?.abort()
    setSaving(key)
    setNotice('')
    setError('')
    try {
      await configureEmbodiedInteraction(patch)
      const next = await fetchEmbodiedInteractionStatus()
      if (!mounted.current) return
      setStatus(next)
      if (patch.enabled !== undefined && next.enabled !== patch.enabled || patch.activity_level !== undefined && next.global_activity_level !== patch.activity_level || patch.mimic_response_mode !== undefined && next.mimic?.mode !== patch.mimic_response_mode) throw new Error('设置已提交，但回读未确认，请重新读取。')
      setNotice('已保存并回读')
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      savingRef.current = false
      if (mounted.current) setSaving('')
    }
  }

  return (
    <section className="embodied-control" aria-label="具身交互系统">
      <Link className="workspace-back" to="/dashboard/foundation">← 基础系统</Link>
      <header className="embodied-control__header">
        <div>
          <h2>具身交互</h2>
          <span>整机默认，场景可单独选择表现。</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(status?.enabled)}
          className={`embodied-control__switch ${status?.enabled ? 'is-on' : ''}`}
          disabled={Boolean(saving) || !status || simulated}
          onClick={() => void save('enabled', { enabled: !status?.enabled })}
        >
          <i aria-hidden="true" />
          {status?.enabled ? '已启用' : '已暂停'}
        </button>
      </header>

      {error ? <p className="embodied-control__error" role="alert">{error}<button disabled={Boolean(saving)} onClick={() => void refresh()}>重试</button></p> : null}
      <p className="workspace-save-state" role="status">{saving ? '保存中…' : notice}</p>
      {simulated ? <p className="embodied-control__boundary">预览模式不提供场景、能力或具身档案的替代数据；请连接机器人读取真实运行态。</p> : null}

      <div className="embodied-control__status">
        <div><span>当前场景</span><strong>{status?.scene?.name || '场景状态暂不可用'}</strong></div>
        <div><span>交互阶段</span><strong>{{ listening: '正在听', thinking: '正在思考', speaking: '正在表达', idle: '待机', sleeping: '休眠', stopped: '已停止' }[status?.phase || ''] || '状态未就绪'}</strong></div>
        <div><span>动作写入</span><strong>统一安全控制</strong></div>
      </div>

      {!simulated && status && <div className="foundation-live-settings">
        <label><span>整机默认主动程度</span><select aria-label="整机默认主动程度" value={status.global_activity_level || ''} disabled={Boolean(saving) || !status.global_activity_level} onChange={event => void save('activity', { activity_level: event.target.value })}>{!status.global_activity_level && <option value="">设备未提供整机默认值</option>}{(status.available_activity_levels || []).map(level => <option key={level.id} value={level.id}>{level.name}</option>)}</select></label>
        <p>{status.available_activity_levels?.find(level => level.id === status.global_activity_level)?.description}</p>
        <label><span>快速模仿</span><select aria-label="快速模仿" value={status.mimic?.mode || ''} disabled={Boolean(saving)} onChange={event => void save('mimic', { mimic_response_mode: event.target.value })}>{status.mimic?.available_modes?.map(mode => <option key={mode.id} value={mode.id}>{mode.name}</option>)}</select></label>
        <p>仅正对的单人空闲时模仿。此开关适用于整台设备。</p>
        <Link to="/dashboard/foundation/motion">呼吸开关与听声转向设置 →</Link>
      </div>}

      {!simulated && sceneId && <div className="embodied-control__profiles"><Link to={`/dashboard/scenes?${new URLSearchParams({ id: sceneId, tab: 'interaction' })}`}>配置当前场景的动作表现 →</Link><p className="scene-hint">场景单独设置后，不受整机默认档位调整影响。</p></div>}

    </section>
  )
}
