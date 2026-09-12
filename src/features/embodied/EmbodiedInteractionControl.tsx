import { useEffect, useMemo, useState } from 'react'
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

  const refresh = async () => {
    try {
      const next = simulated ? simulatedStatus : await fetchEmbodiedInteractionStatus()
      setStatus(next)
      setError('')
    } catch (reason) {
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
    if (saving) return
    setSaving(key)
    setError('')
    try {
      if (simulated) {
        setStatus(current => {
          if (!current) return current
          if (patch.enabled !== undefined) return { ...current, enabled: patch.enabled }
          const selected = (current.available_profiles || []).find(profile => profile.id === patch.profile_id)
          if (!selected || patch.profile_id === 'auto') {
            return { ...current, profile_source: 'interaction_policy_default' }
          }
          return { ...current, active_profile: selected, profile_source: 'scene_override' }
        })
        return
      }
      setStatus(await configureEmbodiedInteraction(patch))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setSaving('')
    }
  }

  return (
    <section className="embodied-control" aria-label="具身交互系统">
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
          disabled={Boolean(saving) || !status}
          onClick={() => void save('enabled', { enabled: !status?.enabled })}
        >
          <i aria-hidden="true" />
          {status?.enabled ? '已启用' : '已暂停'}
        </button>
      </header>

      {error ? <p className="embodied-control__error">{error}</p> : null}
      {simulated ? <p className="embodied-control__boundary">预览模式不提供场景、能力或具身档案的替代数据；请连接机器人读取真实运行态。</p> : null}

      <div className="embodied-control__status">
        <div><span>当前场景</span><strong>{status?.scene?.name || '场景状态暂不可用'}</strong></div>
        <div><span>交互阶段</span><strong>{status?.phase === 'listening' ? '正在听' : status?.phase === 'thinking' ? '正在思考' : status?.phase === 'speaking' ? '正在表达' : '待机'}</strong></div>
        <div><span>动作写入</span><strong>统一安全控制</strong></div>
      </div>

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

      <p className="embodied-control__boundary">
        人声、视觉和模型只能提交受限意图；只有 MovementManager 可以写入实体舵机。
      </p>
    </section>
  )
}
