import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { voiceName } from '../../api/voiceSettings'
import {
  fetchSkillRegistry,
  fetchSceneRuntime,
  type SkillManifest,
  type SkillRegistrySnapshot,
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

/**
 * Shows only the active SceneManager snapshot. It never invents a default
 * scene or a Client-side capability list when the runtime is unavailable.
 */
export default function SceneRuntimeCard({ simulated = false }: { simulated?: boolean }) {
  const [runtime, setRuntime] = useState<SceneRuntimeSnapshot | null>(null)
  const [skills, setSkills] = useState<SkillRegistrySnapshot | null>(null)
  const [error, setError] = useState('')
  const [skillError, setSkillError] = useState('')

  useEffect(() => {
    if (simulated) {
      setRuntime(null)
      setSkills(null)
      setError('预览模式未连接机器人，不显示虚构的场景或能力。')
      setSkillError('')
      return
    }
    let cancelled = false
    let controller: AbortController | null = null
    const refresh = async () => {
      controller?.abort()
      controller = new AbortController()
      try {
        const [runtimeResult, skillResult] = await Promise.allSettled([
          fetchSceneRuntime(controller.signal),
          fetchSkillRegistry(controller.signal),
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
        }
      } catch (reason) {
        const aborted = reason instanceof Error && reason.name === 'AbortError'
        if (!cancelled && !aborted) {
          setRuntime(null)
          setSkills(null)
          setError(reason instanceof Error ? reason.message : '场景运行时暂不可读')
          setSkillError('')
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
