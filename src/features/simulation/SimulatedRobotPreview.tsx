interface Props {
  yaw?: number
  pitch?: number
  roll?: number
  bodyYaw?: number
  active?: boolean
  physics?: boolean
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export default function SimulatedRobotPreview({ yaw = 0, pitch = 0, roll = 0, bodyYaw = 0, active = true, physics = false }: Props) {
  const eyeX = clamp(yaw * 18, -9, 9)
  const eyeY = clamp(-pitch * 18, -7, 7)
  const headRotate = roll * 18
  const headTranslateX = yaw * 18
  const headTranslateY = -pitch * 14
  const bodyRotate = bodyYaw * 8

  return (
    <div className="relative overflow-hidden rounded-[1.75rem] border border-white/[0.08] bg-[radial-gradient(circle_at_50%_0%,rgba(56,189,248,0.16),transparent_36%),rgba(255,255,255,0.025)] p-5 sm:p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-100/42">{physics ? 'MuJoCo Physics' : 'Kinematic Preview'}</p>
          <h3 className="mt-1 text-base font-semibold text-white/78">{physics ? '物理状态缩略图' : '姿态预览'}</h3>
        </div>
        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
          active ? 'border-emerald-200/20 bg-emerald-300/10 text-emerald-50/72' : 'border-white/10 bg-white/[0.04] text-white/38'
        }`}>
          <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-300' : 'bg-white/24'}`} />
          {active ? (physics ? '物理运行中' : '运行中') : '待机'}
        </span>
      </div>

      <div className="relative mx-auto aspect-[4/3] w-full max-w-[420px]">
        <div className="absolute inset-x-[18%] bottom-[10%] h-[30%] rounded-[2rem] border border-white/[0.09] bg-white/[0.045] shadow-[0_26px_70px_rgba(0,0,0,0.28)]" style={{ transform: `rotate(${bodyRotate}deg)` }} />
        <div
          className="absolute left-1/2 top-[18%] h-[48%] w-[54%] origin-center -translate-x-1/2 rounded-[2rem] border border-sky-100/12 bg-[linear-gradient(145deg,rgba(255,255,255,0.16),rgba(255,255,255,0.055))] shadow-[0_30px_80px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.22)] transition-transform duration-200"
          style={{ transform: `translateX(calc(-50% + ${headTranslateX}px)) translateY(${headTranslateY}px) rotate(${headRotate}deg)` }}
        >
          <div className="absolute left-[13%] right-[13%] top-[28%] h-[36%] rounded-[1.4rem] border border-cyan-100/12 bg-[#06131d] shadow-[inset_0_0_36px_rgba(56,189,248,0.12)]">
            <Eye side="left" x={eyeX} y={eyeY} />
            <Eye side="right" x={eyeX} y={eyeY} />
          </div>
          <div className="absolute left-1/2 top-[72%] h-1.5 w-12 -translate-x-1/2 rounded-full bg-sky-100/28" />
        </div>
        <div className="absolute left-[23%] top-[13%] h-[18%] w-2 rounded-full bg-sky-200/28" />
        <div className="absolute right-[23%] top-[13%] h-[18%] w-2 rounded-full bg-sky-200/28" />
        <div className="absolute inset-x-[10%] bottom-[4%] h-px bg-gradient-to-r from-transparent via-white/16 to-transparent" />
      </div>
    </div>
  )
}

function Eye({ side, x, y }: { side: 'left' | 'right'; x: number; y: number }) {
  return (
    <div className={`absolute top-1/2 h-9 w-12 -translate-y-1/2 rounded-full bg-cyan-200/90 shadow-[0_0_24px_rgba(103,232,249,0.55)] ${side === 'left' ? 'left-[18%]' : 'right-[18%]'}`}>
      <span
        className="absolute left-1/2 top-1/2 h-4 w-4 rounded-full bg-[#041018] transition-transform duration-200"
        style={{ transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))` }}
      />
    </div>
  )
}
