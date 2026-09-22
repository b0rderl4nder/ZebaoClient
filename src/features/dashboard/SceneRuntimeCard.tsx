import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { voiceName } from '../../api/voiceSettings'
import {
  fetchEcosystemHealth,
  fetchReadiness,
  fetchSkillRegistry,
  fetchSceneRuntime,
  type EcosystemHealthSnapshot,
  type SkillManifest,
  type SkillRegistrySnapshot,
  type ReadinessSnapshot,
  type SceneRuntimeSnapshot,
} from '../../api/sceneRuntime'

function compactLabel(value: string | undefined, fallback: string) {
  const normalized = String(value || '').trim()
  return normalized || fallback
}

function contractLabel(value: string | undefined, fallback: string) {
  const labels: Record<string, string> = {
    verified_device_result: '设备回读',
    verified_scene_transition: '场景回读',
    verified_display_result: '展示回读',
    verified_result_required: '结果确认',
    device_state: '设备状态',
    fresh_device_state: '最新状态',
    motion_provider_ack: '动作确认',
    executor_ack_required: '执行确认',
    knowledge_and_display_state: '资料与展示',
    reminder_state: '提醒回读',
    provider_result: '提供方结果',
  }
  return labels[String(value || '').trim()] || fallback
}

function blockerLabel(value: string) {
  const labels: Record<string, string> = {
    voiceprint_acceptance: '声纹真人验收未完成',
    voice_turn_acceptance: '语音真人验收未完成',
    disk_target: '可用空间低于建议余量',
    barge_in_proven: '打断能力尚未取证',
    field_network: '现场网络未确认',
    release_bound: '运行构件未绑定',
  }
  return labels[value] || value
}

/**
 * Shows only the active SceneManager snapshot. It never invents a default
 * scene or a Client-side capability list when the runtime is unavailable.
 */
export default function SceneRuntimeCard({ simulated = false }: { simulated?: boolean }) {
  const [runtime, setRuntime] = useState<SceneRuntimeSnapshot | null>(null)
  const [skills, setSkills] = useState<SkillRegistrySnapshot | null>(null)
  const [health, setHealth] = useState<EcosystemHealthSnapshot | null>(null)
  const [readiness, setReadiness] = useState<ReadinessSnapshot | null>(null)
  const [error, setError] = useState('')
  const [skillError, setSkillError] = useState('')
  const [healthError, setHealthError] = useState('')

  useEffect(() => {
    if (simulated) {
      setRuntime(null)
      setSkills(null)
      setHealth(null)
      setReadiness(null)
      setError('预览模式未连接机器人，不显示虚构的场景或能力。')
      setSkillError('')
      setHealthError('')
      return
    }
    let cancelled = false
    let controller: AbortController | null = null
    const refresh = async () => {
      controller?.abort()
      controller = new AbortController()
      try {
        const [runtimeResult, skillResult, healthResult, readinessResult] = await Promise.allSettled([
          fetchSceneRuntime(controller.signal),
          fetchSkillRegistry(controller.signal),
          fetchEcosystemHealth(controller.signal),
          fetchReadiness(controller.signal),
        ])
        if (runtimeResult.status === 'rejected') throw runtimeResult.reason
        const next = runtimeResult.value
        if (!cancelled) {
          setRuntime(next)
          setError('')
          if (skillResult.status === 'fulfilled') {
            setSkills(skillResult.value)
            setSkillError('')
          } else {
            setSkills(null)
            setSkillError(skillResult.reason instanceof Error ? skillResult.reason.message : '暂时无法读取')
          }
          if (healthResult.status === 'fulfilled') {
            setHealth(healthResult.value)
            setHealthError('')
          } else {
            setHealth(null)
            setHealthError(healthResult.reason instanceof Error ? healthResult.reason.message : '暂时无法读取')
          }
          if (readinessResult.status === 'fulfilled') setReadiness(readinessResult.value)
          else setReadiness(null)
        }
      } catch (reason) {
        const aborted = reason instanceof Error && reason.name === 'AbortError'
        if (!cancelled && !aborted) {
          setRuntime(null)
          setSkills(null)
          setHealth(null)
          setReadiness(null)
          setError(reason instanceof Error ? reason.message : '场景运行时暂不可读')
          setSkillError('')
          setHealthError('')
        }
      }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 5000)
    return () => {
      cancelled = true
      controller?.abort()
      window.clearInterval(timer)
    }
  }, [simulated])

  const summary = useMemo(() => {
    const capabilityNames = (runtime?.capabilities || [])
      .map(item => compactLabel(item.name, item.id))
      .filter(Boolean)
      .slice(0, 3)
    const requestedCount = Number(runtime?.capability_count)
    return {
      sceneName: compactLabel(runtime?.scene?.name, '场景状态暂不可用'),
      voice: voiceName(runtime?.voice?.provider, runtime?.voice?.label),
      interaction: compactLabel(runtime?.interaction?.name, '未挂载'),
      capabilityCount: Number.isFinite(requestedCount)
        ? Math.max(0, requestedCount)
        : capabilityNames.length,
      capabilityNames,
    }
  }, [runtime])

  const visibleSkills = useMemo<SkillManifest[]>(() => (
    Array.isArray(skills?.skills) ? skills.skills.filter(item => item && item.skill_id).slice(0, 12) : []
  ), [skills])

  const blockers = useMemo(() => (
    Array.isArray(readiness?.blockers)
      ? readiness.blockers.filter(item => String(item || '').trim()).slice(0, 3).map(blockerLabel)
      : []
  ), [readiness])

  return (
    <section className="scene-runtime-card" aria-label="当前场景运行时">
      <header className="scene-runtime-card__header">
        <div>
          <span>当前场景</span>
          <strong>{summary.sceneName}</strong>
        </div>
        <Link to="/dashboard/scenes">查看挂载 →</Link>
      </header>
      {error ? (
        <p className="scene-runtime-card__message" role="status">场景运行时暂不可读：{error}</p>
      ) : (
        <>
          <div className="scene-runtime-card__metrics">
            <div><span>语音</span><strong>{summary.voice}</strong></div>
            <div><span>交互</span><strong>{summary.interaction}</strong></div>
            <div><span>已挂载</span><strong>{summary.capabilityCount} 项能力</strong></div>
          </div>
          {summary.capabilityNames.length > 0 && (
            <p className="scene-runtime-card__mounts" aria-label="场景已挂载能力">
              {summary.capabilityNames.join(' · ')}
            </p>
          )}
          <section className="scene-runtime-card__health" aria-label="发布与健康">
            <header><span>发布与健康</span><strong>{health?.ok ? '运行态正常' : healthError ? '健康信息暂不可读' : '读取中'}</strong></header>
            {healthError ? (
              <p className="scene-runtime-card__message" role="status">健康摘要暂不可读：{healthError}</p>
            ) : health ? (
              <div className="scene-runtime-card__health-grid">
                <div><span>版本</span><strong>{health.release?.app_version || '未绑定'}</strong></div>
                <div><span>场景代次</span><strong>{health.scene?.generation?.slice(0, 12) || '未提供'}</strong></div>
                <div><span>构件</span><strong>{health.release?.bound ? '已绑定' : '未绑定'}</strong></div>
              </div>
            ) : null}
            {blockers.length > 0 && (
              <p className="scene-runtime-card__alerts" role="status"><span>待处理提醒</span>{blockers.join(' · ')}</p>
            )}
            {readiness && blockers.length === 0 && readiness.ready === false && (
              <p className="scene-runtime-card__alerts" role="status"><span>待处理提醒</span>验收状态尚未通过，请查看验收记录。</p>
            )}
          </section>
          <section className="scene-runtime-card__skills" aria-label="当前场景可执行 Skill">
            <header><span>可执行 Skill</span><strong>{Number.isFinite(Number(skills?.count)) ? `${skills?.count} 项` : '读取中'}</strong></header>
            {skillError ? (
              <p className="scene-runtime-card__message" role="status">Skill 契约暂不可读：{skillError}</p>
            ) : visibleSkills.length ? (
              <div className="scene-runtime-card__skill-list">
                {visibleSkills.map(skill => (
                  <article key={skill.skill_id} title={skill.description || skill.title || skill.tool_name}>
                    <div><strong>{skill.title || skill.tool_name}</strong><small>{skill.tool_name}</small></div>
                    <span>{contractLabel(skill.result_contract || skill.execution_contract, '结果确认')}</span>
                    {skill.requires_identity_authorization && <em>需授权</em>}
                  </article>
                ))}
              </div>
            ) : (
              <p className="scene-runtime-card__message">当前场景没有可执行 Skill。</p>
            )}
            {skills?.generation && <small className="scene-runtime-card__generation">契约代次 {skills.generation.slice(0, 12)} · {skills.execution_boundary || '由本机 CapabilityBroker 执行'}</small>}
          </section>
        </>
      )}
    </section>
  )
}
