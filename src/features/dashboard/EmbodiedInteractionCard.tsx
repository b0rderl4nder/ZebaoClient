import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchEmbodiedInteractionStatus,
  type EmbodiedInteractionStatus,
} from '../../api/embodied'

const phaseLabel: Record<string, string> = {
  idle: '待机',
  listening: '正在听',
  thinking: '正在思考',
  speaking: '正在表达',
  sleeping: '休眠',
  stopped: '已停止',
}

const targetLabel: Record<string, string> = {
  current_speaker: '说话的人',
  visible_person: '面前的人',
  attended_object: '共同关注的物品',
  gesture_target: '手势目标',
}

const commandLabel: Record<string, string> = {
  sound_attention: '听声关注',
  heard_acknowledgement: '听见反馈',
  completion_acknowledgement: '停句反馈',
  visual_attention: '视觉关注',
  semantic_reaction: '表达动作',
}

const simulatedStatus: EmbodiedInteractionStatus = {
  ok: false,
  enabled: false,
  attention: { source: 'none', target_kind: '', age_ms: null },
  last_execution: { accepted: false, reason: 'waiting', kind: '', age_ms: null },
}

function sourceLabel(source: string | undefined) {
  if (source === 'sound') return '声源'
  if (source === 'vision') return '视觉'
  return '未关注'
}

export default function EmbodiedInteractionCard({ simulated = false }: { simulated?: boolean }) {
  const [status, setStatus] = useState<EmbodiedInteractionStatus | null>(simulated ? simulatedStatus : null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (simulated) {
      setStatus(simulatedStatus)
      setError('')
      return
    }
    let cancelled = false
    const refresh = async () => {
      try {
        const next = await fetchEmbodiedInteractionStatus()
        if (!cancelled) {
          setStatus(next)
          setError('')
        }
      } catch (reason) {
        if (!cancelled) { setStatus(null); setError(reason instanceof Error ? reason.message : '状态暂不可用') }
      }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [simulated])

  const summary = useMemo(() => {
    const attention = status?.attention
    const target = attention?.target_kind ? targetLabel[attention.target_kind] || attention.target_kind : '等待真人输入'
    const last = status?.last_execution
    const action = last?.kind ? commandLabel[last.kind] || last.kind : '等待事件'
    return {
      phase: phaseLabel[status?.phase || ''] || '连接中',
      target,
      action,
      source: sourceLabel(attention?.source),
    }
  }, [status])

  return (
    <section className="embodied-card" aria-label="具身交互状态">
      <header className="embodied-card__header">
        <div>
          <span>具身交互</span>
          <strong>{status?.active_profile?.name || (simulated ? '尚未连接设备' : error ? '状态不可用' : '正在连接')}</strong>
        </div>
        <Link to="/dashboard/foundation/interaction">配置交互 →</Link>
      </header>
      {error ? (
        <p className="embodied-card__message">交互内核状态暂不可读：{error}</p>
      ) : (
        <div className="embodied-card__metrics">
          <div><span>当前</span><strong>{summary.phase}</strong></div>
          <div><span>{summary.source}</span><strong>{summary.target}</strong></div>
          <div><span>最近</span><strong>{summary.action}</strong></div>
        </div>
      )}
      <p className="embodied-card__note">
        {status?.active_profile?.description || '场景只选择表达风格；动作始终由统一安全控制器执行。'}
      </p>
    </section>
  )
}
