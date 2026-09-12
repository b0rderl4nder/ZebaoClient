import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { voiceName } from '../../api/voiceSettings'
import {
  fetchSceneRuntime,
  type SceneRuntimeSnapshot,
} from '../../api/sceneRuntime'

function compactLabel(value: string | undefined, fallback: string) {
  const normalized = String(value || '').trim()
  return normalized || fallback
}

/**
 * Shows only the active SceneManager snapshot. It never invents a default
 * scene or a Client-side capability list when the runtime is unavailable.
 */
export default function SceneRuntimeCard({ simulated = false }: { simulated?: boolean }) {
  const [runtime, setRuntime] = useState<SceneRuntimeSnapshot | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (simulated) {
      setRuntime(null)
      setError('预览模式未连接机器人，不显示虚构的场景或能力。')
      return
    }
    let cancelled = false
    let controller: AbortController | null = null
    const refresh = async () => {
      controller?.abort()
      controller = new AbortController()
      try {
        const next = await fetchSceneRuntime(controller.signal)
        if (!cancelled) {
          setRuntime(next)
          setError('')
        }
      } catch (reason) {
        const aborted = reason instanceof Error && reason.name === 'AbortError'
        if (!cancelled && !aborted) {
          setRuntime(null)
          setError(reason instanceof Error ? reason.message : '场景运行时暂不可读')
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
        </>
      )}
    </section>
  )
}
