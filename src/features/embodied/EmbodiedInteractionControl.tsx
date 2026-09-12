import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { operatorPage } from '../../api/operator'
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

  const refresh = async () => {
    try {
      const next = simulated ? simulatedStatus : await fetchEmbodiedInteractionStatus()
      setStatus(next)
      setError('')
    } catch (reason) {
      setStatus(null)
      setError(reason instanceof Error ? reason.message : '交互系统状态暂不可用')
    }
  }

  useEffect(() => {
    void refresh()
    if (simulated) return
    const timer = window.setInterval(() => { void refresh() }, 4000)
    return () => window.clearInterval(timer)
  }, [simulated])

  const currentProfileId = status?.active_profile?.id || ''
  const sceneId = status?.active_scene_id || ''
  const options = useMemo(() => [
    {
      id: 'auto',
      name: '跟随场景',
      description: '由场景的准入方式自动选择，不留下隐式覆盖。',
    },
    ...(status?.available_profiles || []).map(profile => ({
      id: profile.id,
      name: profile.name,
      description: profile.description,
    })),
  ], [status?.available_profiles])

  const save = async (key: string, patch: EmbodiedInteractionPatch) => {
    if (saving || simulated) return
    setSaving(key)
    setNotice('')
    setError('')
    try {
      await configureEmbodiedInteraction(patch)
      const next = await fetchEmbodiedInteractionStatus()
      setStatus(next)
      setNotice('已保存')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setSaving('')
    }
  }

  return (
    <section className="embodied-control" aria-label="具身交互系统">
      <Link className="workspace-back" to="/dashboard/foundation">← 基础系统</Link>
      <header className="embodied-control__header">
        <div>
          <p>运行时控制</p>
          <h2>具身交互</h2>
          <span>统一协调注意力、听见反馈与表达动作。</span>
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

      {error ? <p className="embodied-control__error" role="alert">{error}<button onClick={() => void refresh()}>重试</button></p> : null}
      <p className="workspace-save-state" role="status">{saving ? '保存中…' : notice}</p>
      {simulated ? <p className="embodied-control__boundary">预览模式不提供场景、能力或具身档案的替代数据；请连接机器人读取真实运行态。</p> : null}

      <div className="embodied-control__status">
        <div><span>当前场景</span><strong>{status?.scene?.name || '场景状态暂不可用'}</strong></div>
        <div><span>交互阶段</span><strong>{{ listening: '正在听', thinking: '正在思考', speaking: '正在表达', idle: '待机', sleeping: '休眠', stopped: '已停止' }[status?.phase || ''] || '状态未就绪'}</strong></div>
        <div><span>动作写入</span><strong>统一安全控制</strong></div>
      </div>

      {!simulated && status && <div className="foundation-live-settings">
        <label><span>当前场景活跃度</span><select aria-label="当前场景活跃度" value={status.activity_level || ''} disabled={Boolean(saving) || !sceneId} onChange={event => void save('activity', { scene_id: sceneId, activity_level: event.target.value })}>{(status.available_activity_levels || []).map(level => <option key={level.id} value={level.id}>{level.name}</option>)}</select></label>
        <p>{status.available_activity_levels?.find(level => level.id === status.activity_level)?.description}</p>
        <label><span>快速模仿</span><select aria-label="快速模仿" value={status.mimic?.mode || ''} disabled={Boolean(saving)} onChange={event => void save('mimic', { mimic_response_mode: event.target.value })}>{status.mimic?.available_modes?.map(mode => <option key={mode.id} value={mode.id}>{mode.name}</option>)}</select></label>
        <p>仅正对的单人空闲时模仿。此开关适用于整台设备。</p>
        <a href={operatorPage('device/motion')} target="_blank" rel="noreferrer">呼吸开关与听声转向设置 ↗</a>
      </div>}

      <div className="embodied-control__profiles" role="group" aria-label="场景表达档案">
        <div className="embodied-control__section-title">
          <span>表达档案</span>
          <small>{status?.profile_source === 'scene_override' ? '当前场景已单独选择' : '当前跟随场景准入方式'}</small>
        </div>
        <div className="embodied-control__profile-grid">
          {options.map(option => {
            const selected = option.id === 'auto'
              ? status?.profile_source !== 'scene_override'
              : status?.profile_source === 'scene_override' && currentProfileId === option.id
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={selected}
                className={selected ? 'is-selected' : ''}
                disabled={Boolean(saving) || !sceneId}
                onClick={() => void save(`profile:${option.id}`, { scene_id: sceneId, profile_id: option.id })}
              >
                <strong>{option.name}</strong>
                <span>{option.description}</span>
              </button>
            )
          })}
        </div>
      </div>

    </section>
  )
}
