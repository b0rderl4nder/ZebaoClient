import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { listRecordedMoves, playRecordedMove } from '../../api/move'

const DATASETS = [
  {
    id: 'dances',
    title: '舞蹈',
    dataset: 'pollen-robotics/reachy-mini-dances-library',
  },
  {
    id: 'emotions',
    title: '表情',
    dataset: 'pollen-robotics/reachy-mini-emotions-library',
  },
] as const

type DatasetId = (typeof DATASETS)[number]['id']
type MoveMap = Record<DatasetId, string[]>

const DISPLAY_NAMES: Record<string, string> = {
  groovy_sway_and_roll: 'Groovy Sway',
  side_to_side_sway: 'Side Sway',
  head_tilt_roll: 'Head Tilt Roll',
  interwoven_spirals: 'Interwoven Spirals',
  jackson_square: 'Jackson Square',
  polyrhythm_combo: 'Polyrhythm Combo',
  stumble_and_recover: 'Stumble Recover',
  side_glance_flick: 'Side Glance',
  side_peekaboo: 'Side Peekaboo',
  sharp_side_tilt: 'Sharp Tilt',
  chicken_peck: 'Chicken Peck',
  pendulum_swing: 'Pendulum',
  simple_nod: 'Simple Nod',
  yeah_nod: 'Yeah Nod',
  uh_huh_tilt: 'Uh Huh Tilt',
  neck_recoil: 'Neck Recoil',
  dizzy_spin: 'Dizzy Spin',
  chin_lead: 'Chin Lead',
  grid_snap: 'Grid Snap',
}

const POSE_RESYNC_KEY = 'zebao_pose_resync_current'

function moveLabel(name: string) {
  return DISPLAY_NAMES[name] ?? name.replace(/_/g, ' ')
}

export default function MotionControl({ simulated = false }: { simulated?: boolean }) {
  const [activeDataset, setActiveDataset] = useState<DatasetId>('dances')
  const [moves, setMoves] = useState<MoveMap>({ dances: [], emotions: [] })
  const [loading, setLoading] = useState(!simulated)
  const [playing, setPlaying] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (simulated) {
      setMoves({ dances: ['groovy_sway_and_roll', 'simple_nod', 'yeah_nod'], emotions: ['dance1', 'dance2', 'dance3'] })
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    Promise.all(DATASETS.map(item => listRecordedMoves(item.dataset)))
      .then(([danceMoves, emotionMoves]) => {
        if (cancelled) return
        setMoves({ dances: danceMoves, emotions: emotionMoves })
        setError(null)
      })
      .catch(loadError => {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : '读取动作列表失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [simulated])

  const active = DATASETS.find(item => item.id === activeDataset) ?? DATASETS[0]
  const visibleMoves = useMemo(() => {
    const names = moves[activeDataset]
    if (activeDataset === 'emotions') {
      const preferred = ['dance1', 'dance2', 'dance3', 'cheerful1', 'laughing1', 'curious1', 'surprised1', 'sleep1']
      return [...preferred.filter(name => names.includes(name)), ...names.filter(name => !preferred.includes(name))]
    }
    return names
  }, [activeDataset, moves])

  const play = async (moveName: string) => {
    if (simulated) {
      setMessage(`模拟播放：${moveLabel(moveName)}`)
      return
    }
    setPlaying(moveName)
    setMessage(null)
    setError(null)
    try {
      const result = await playRecordedMove(active.dataset, moveName)
      localStorage.setItem(POSE_RESYNC_KEY, 'true')
      setMessage(`已发送 ${moveLabel(moveName)} · ${result.uuid.slice(0, 8)}`)
    } catch (playError) {
      setError(playError instanceof Error ? playError.message : '发送动作失败')
    } finally {
      setPlaying(null)
    }
  }

  return (
    <div className="min-h-screen animate-fade-in">
      <nav className="sticky top-0 z-50 border-b border-white/[0.05] bg-[#080810]/80 backdrop-blur-2xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6 md:px-10">
          <div className="flex items-center gap-6">
            <Link to="/dashboard" className="text-sm font-medium text-white/30 transition-colors hover:text-white/60">返回</Link>
            <h1 className="text-lg font-bold tracking-tight text-white/85">动作表情</h1>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-5xl px-6 py-10 md:px-10">
        <div className="mb-6 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4">
          <div className="grid grid-cols-2 gap-3">
            {DATASETS.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveDataset(item.id)}
                className={`h-11 rounded-xl border px-4 text-sm font-semibold transition ${activeDataset === item.id ? 'border-sky-300/[0.2] bg-sky-400/[0.08] text-sky-100/75' : 'border-white/[0.06] bg-white/[0.02] text-white/45 hover:bg-white/[0.05] hover:text-white/65'}`}
              >
                {item.title}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="mb-6 rounded-2xl border border-rose-500/[0.16] bg-rose-500/[0.06] p-4 text-sm text-rose-200/78">{error}</div>}
        {message && <div className="mb-6 rounded-2xl border border-emerald-500/[0.14] bg-emerald-500/[0.05] p-4 text-sm text-emerald-100/72">{message}</div>}

        {loading ? (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 text-sm text-white/40">正在读取动作列表</div>
        ) : visibleMoves.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 text-sm text-white/40">没有可用动作</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleMoves.map(moveName => (
              <button
                key={moveName}
                type="button"
                disabled={playing !== null}
                onClick={() => void play(moveName)}
                className="min-h-20 rounded-[1.25rem] border border-white/[0.06] bg-white/[0.02] p-4 text-left transition hover:border-white/[0.1] hover:bg-white/[0.05] disabled:opacity-40"
              >
                <span className="block text-sm font-semibold capitalize text-white/70">{moveLabel(moveName)}</span>
                <span className="mt-1 block text-xs text-white/24">{playing === moveName ? '发送中...' : active.title}</span>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
