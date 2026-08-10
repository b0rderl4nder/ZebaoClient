import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { HeadPose } from '../../api/types'
import { getBasicPoses, gotoPose, playGoToSleep, playWakeUp, releaseMovementManualHold, requestMovementManualHold, saveBasicPose, syncConversationStartupPosture } from '../../api/move'
import type { BasicPoseConfig } from '../../api/move'
import { connectSetTargetWs, getFullState } from '../../api/state'
import SimulatedRobotPreview from '../simulation/SimulatedRobotPreview'

const uiPitchToDaemon = (pitch: number) => -pitch
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

type BasicPoseName = 'init' | 'sleep'
type PoseTarget = {
  x: number
  z: number
  yaw: number
  pitch: number
  roll: number
  bodyYaw: number
  leftEar: number
  rightEar: number
}

const ZERO_TARGET: PoseTarget = {
  x: 0,
  z: 0,
  yaw: 0,
  pitch: 0,
  roll: 0,
  bodyYaw: 0,
  leftEar: 0,
  rightEar: 0,
}

const BASE_RADIUS = {
  x: 0.12,
  z: 0.14,
  yaw: 1.4,
  pitch: 1.0,
  roll: 1.0,
  leftEar: Math.PI,
  rightEar: Math.PI,
}

const POSE_RESYNC_KEY = 'zebao_pose_resync_current'
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function safeGotoDuration(previous: PoseTarget, next: PoseTarget): number {
  const translation = Math.hypot(next.x - previous.x, next.z - previous.z) / 0.08
  const headRotation = Math.max(
    Math.abs(next.yaw - previous.yaw),
    Math.abs(next.pitch - previous.pitch),
    Math.abs(next.roll - previous.roll),
  ) / 1.4
  const antenna = Math.max(
    Math.abs(next.leftEar - previous.leftEar),
    Math.abs(next.rightEar - previous.rightEar),
  ) / 2.4
  const body = Math.abs(next.bodyYaw - previous.bodyYaw) / 1.4
  return clamp(Math.max(0.25, translation, headRotation, antenna, body), 0.25, 3.0)
}

function limitLiveTarget(previous: PoseTarget, requested: PoseTarget, elapsedMs: number): PoseTarget {
  const elapsed = clamp(elapsedMs / 1000, 1 / 120, 0.1)
  const approach = (current: number, targetValue: number, maxSpeed: number) => {
    const delta = clamp(targetValue - current, -maxSpeed * elapsed, maxSpeed * elapsed)
    return current + delta
  }
  return {
    x: approach(previous.x, requested.x, 0.08),
    z: approach(previous.z, requested.z, 0.08),
    yaw: approach(previous.yaw, requested.yaw, 1.4),
    pitch: approach(previous.pitch, requested.pitch, 1.4),
    roll: approach(previous.roll, requested.roll, 1.4),
    bodyYaw: approach(previous.bodyYaw, requested.bodyYaw, 1.4),
    leftEar: approach(previous.leftEar, requested.leftEar, 2.4),
    rightEar: approach(previous.rightEar, requested.rightEar, 2.4),
  }
}

function baseTargetFromConfig(config: BasicPoseConfig | null, poseName: BasicPoseName): PoseTarget {
  if (!config) return ZERO_TARGET
  const headPose = poseName === 'init' ? config.init_head_pose : config.sleep_head_pose
  const antennas = poseName === 'init' ? config.init_antennas : config.sleep_antennas
  const bodyYaw = poseName === 'init' ? config.init_body_yaw : config.sleep_body_yaw
  return {
    x: headPose.x ?? 0,
    z: headPose.z ?? 0,
    yaw: headPose.yaw ?? 0,
    pitch: uiPitchToDaemon(headPose.pitch ?? 0),
    roll: headPose.roll ?? 0,
    bodyYaw: bodyYaw ?? 0,
    leftEar: antennas[0] ?? 0,
    rightEar: antennas[1] ?? 0,
  }
}

function targetWithOffset(base: PoseTarget, offset: Partial<PoseTarget>): PoseTarget {
  return {
    ...base,
    x: base.x + (offset.x ?? 0),
    z: base.z + (offset.z ?? 0),
    yaw: base.yaw + (offset.yaw ?? 0),
    pitch: base.pitch + (offset.pitch ?? 0),
    roll: base.roll + (offset.roll ?? 0),
    bodyYaw: offset.bodyYaw ?? base.bodyYaw,
    leftEar: clamp(base.leftEar + (offset.leftEar ?? 0), -Math.PI, Math.PI),
    rightEar: clamp(base.rightEar + (offset.rightEar ?? 0), -Math.PI, Math.PI),
  }
}

function offsetFromBase(target: PoseTarget, base: PoseTarget): PoseTarget {
  return {
    x: target.x - base.x,
    z: target.z - base.z,
    yaw: target.yaw - base.yaw,
    pitch: target.pitch - base.pitch,
    roll: target.roll - base.roll,
    bodyYaw: target.bodyYaw,
    leftEar: target.leftEar - base.leftEar,
    rightEar: target.rightEar - base.rightEar,
  }
}

function targetFromFullState(current: Awaited<ReturnType<typeof getFullState>>): PoseTarget {
  const headPose = current.head_pose ?? {}
  const antennas = current.antennas_position ?? [0, 0]
  return {
    x: headPose.x ?? 0,
    z: headPose.z ?? 0,
    yaw: headPose.yaw ?? 0,
    pitch: uiPitchToDaemon(headPose.pitch ?? 0),
    roll: headPose.roll ?? 0,
    bodyYaw: current.body_yaw ?? 0,
    leftEar: antennas[0] ?? 0,
    rightEar: antennas[1] ?? 0,
  }
}

function setTargetWsPayload(nextTarget: PoseTarget) {
  return {
    target_head_pose: {
      x: nextTarget.x,
      y: 0,
      z: nextTarget.z,
      roll: nextTarget.roll,
      pitch: uiPitchToDaemon(nextTarget.pitch),
      yaw: nextTarget.yaw,
    },
    target_antennas: [nextTarget.leftEar, nextTarget.rightEar],
    target_body_yaw: nextTarget.bodyYaw,
  }
}

export default function PoseControl({ simulated = false }: { simulated?: boolean }) {
  const [pose, setPose] = useState<HeadPose>({})
  const [liveMode, setLiveMode] = useState(false)
  const [target, setTargetState] = useState<PoseTarget>(ZERO_TARGET)
  const [basicPoses, setBasicPoses] = useState<BasicPoseConfig | null>(null)
  const [activeBase, setActiveBase] = useState<BasicPoseName>('init')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [savingPose, setSavingPose] = useState<BasicPoseName | null>(null)
  const [playingMove, setPlayingMove] = useState<'wake' | 'sleep' | null>(null)
  const targetRef = useRef<PoseTarget>(target)
  const lastSentTargetRef = useRef<PoseTarget>(target)
  const lastSentAtRef = useRef(performance.now())
  const targetSeededRef = useRef(simulated)
  const shouldResyncCurrentRef = useRef(!simulated && localStorage.getItem(POSE_RESYNC_KEY) === 'true')
  const manualHoldRefreshAtRef = useRef(0)
  const stepSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stepSendInFlightRef = useRef(false)
  const pendingStepTargetRef = useRef<PoseTarget | null>(null)
  const liveWsRef = useRef<WebSocket | null>(null)
  const manualReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPoseEditingRef = useRef(false)

  useEffect(() => {
    targetRef.current = target
  }, [target])

  const activeBaseTarget = useMemo(() => baseTargetFromConfig(basicPoses, activeBase), [basicPoses, activeBase])
  const offset = useMemo(() => offsetFromBase(target, activeBaseTarget), [target, activeBaseTarget])

  const syncTarget = (nextTarget: PoseTarget) => {
    setTargetState(nextTarget)
    targetRef.current = nextTarget
    targetSeededRef.current = true
  }

  const rememberSentTarget = (nextTarget: PoseTarget) => {
    lastSentTargetRef.current = nextTarget
    lastSentAtRef.current = performance.now()
  }

  const ensureManualPoseHold = async (force = false) => {
    if (simulated) return
    const now = Date.now()
    if (!force && now - manualHoldRefreshAtRef.current < 1500) return
    manualHoldRefreshAtRef.current = now
    await requestMovementManualHold(10)
  }

  const requestManualPoseHold = (force = false) => {
    void ensureManualPoseHold(force)
  }

  const clearManualReleaseTimer = () => {
    if (manualReleaseTimerRef.current) {
      clearTimeout(manualReleaseTimerRef.current)
      manualReleaseTimerRef.current = null
    }
  }

  const beginPoseEdit = () => {
    if (simulated) return
    isPoseEditingRef.current = true
    clearManualReleaseTimer()
    requestManualPoseHold(true)
  }

  const releaseManualPoseControl = (reason = 'frontend_pose_remote_done') => {
    if (simulated) return
    isPoseEditingRef.current = false
    manualHoldRefreshAtRef.current = 0
    void releaseMovementManualHold(reason)
  }

  const scheduleManualPoseRelease = (reason = 'frontend_pose_remote_done', delayMs = 700) => {
    if (simulated) return
    clearManualReleaseTimer()
    manualReleaseTimerRef.current = setTimeout(() => {
      releaseManualPoseControl(reason)
    }, delayMs)
  }

  const sendTargetByLiveWs = (nextTarget: PoseTarget) => {
    const ws = liveWsRef.current
    if (simulated || !liveMode || !ws || ws.readyState !== WebSocket.OPEN) return false
    try {
      requestManualPoseHold()
      const now = performance.now()
      const limitedTarget = limitLiveTarget(
        lastSentTargetRef.current,
        nextTarget,
        now - lastSentAtRef.current,
      )
      ws.send(JSON.stringify(setTargetWsPayload(limitedTarget)))
      rememberSentTarget(limitedTarget)
      setError(null)
      return true
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : '实时发送目标失败')
      return false
    }
  }

  useEffect(() => {
    if (simulated) return
    getBasicPoses()
      .then(config => {
        setBasicPoses(config)
        const nextTarget = baseTargetFromConfig(config, activeBase)
        syncTarget(nextTarget)
        rememberSentTarget(nextTarget)
      })
      .catch(loadError => setError(loadError instanceof Error ? loadError.message : '读取基准姿态失败'))
  }, [simulated])

  useEffect(() => {
    if (simulated) {
      setPose({ x: target.x, z: target.z, yaw: target.yaw, pitch: target.pitch, roll: target.roll })
      return
    }
    const readState = () => {
      getFullState()
        .then(current => {
          const headPose = current.head_pose ?? {}
          const currentPitch = uiPitchToDaemon(headPose.pitch ?? 0)
          setPose({ ...headPose, pitch: currentPitch })
          if (shouldResyncCurrentRef.current) {
            const nextTarget = targetFromFullState(current)
            syncTarget(nextTarget)
            rememberSentTarget(nextTarget)
            shouldResyncCurrentRef.current = false
            localStorage.removeItem(POSE_RESYNC_KEY)
          } else if (!targetSeededRef.current) {
            const nextTarget = targetFromFullState(current)
            syncTarget(nextTarget)
            rememberSentTarget(nextTarget)
          }
        })
        .catch(readError => {
          setError(readError instanceof Error ? readError.message : '读取姿态失败')
        })
    }
    readState()
    if (!liveMode) {
      const interval = setInterval(readState, 800)
      return () => clearInterval(interval)
    }
  }, [liveMode, simulated])

  useEffect(() => {
    if (simulated) return
    if (!liveMode) return
    const ws = connectSetTargetWs()
    liveWsRef.current = ws

    ws.onopen = () => {
      setError(null)
      if (isPoseEditingRef.current) sendTargetByLiveWs(targetRef.current)
    }
    ws.onerror = () => setError('实时控制 WebSocket 连接失败')
    ws.onclose = () => {
      if (liveMode) setError('实时控制 WebSocket 已断开')
    }

    return () => {
      ws.onclose = null
      if (liveWsRef.current === ws) liveWsRef.current = null
      ws.close()
    }
  }, [liveMode, simulated])

  useEffect(() => {
    return () => {
      if (stepSendTimerRef.current) clearTimeout(stepSendTimerRef.current)
      clearManualReleaseTimer()
      if (isPoseEditingRef.current) releaseManualPoseControl('pose_page_unmount')
    }
  }, [])

  const flushStepTargetSend = () => {
    if (stepSendTimerRef.current) {
      clearTimeout(stepSendTimerRef.current)
      stepSendTimerRef.current = null
    }
    if (simulated || !liveMode || stepSendInFlightRef.current) return
    const nextTarget = pendingStepTargetRef.current
    if (!nextTarget) return
    pendingStepTargetRef.current = null
    if (sendTargetByLiveWs(nextTarget)) return
    stepSendInFlightRef.current = true
    void sendTargetNow(nextTarget, { forceHold: false }).finally(() => {
      stepSendInFlightRef.current = false
      if (pendingStepTargetRef.current && !stepSendTimerRef.current) {
        stepSendTimerRef.current = setTimeout(flushStepTargetSend, 60)
      }
    })
  }

  const scheduleStepTargetSend = (nextTarget: PoseTarget) => {
    if (simulated || !liveMode) return
    pendingStepTargetRef.current = nextTarget
    if (sendTargetByLiveWs(nextTarget)) {
      pendingStepTargetRef.current = null
      return
    }
    if (!stepSendTimerRef.current) {
      stepSendTimerRef.current = setTimeout(flushStepTargetSend, 60)
    }
  }

  const updateTarget = (next: Partial<PoseTarget>, stream = true) => {
    const nextTarget = { ...targetRef.current, ...next }
    syncTarget(nextTarget)
    setPose({ x: nextTarget.x, z: nextTarget.z, yaw: nextTarget.yaw, pitch: nextTarget.pitch, roll: nextTarget.roll })
    if (stream) {
      if (!isPoseEditingRef.current) beginPoseEdit()
      else requestManualPoseHold()
      scheduleStepTargetSend(nextTarget)
    }
  }

  const updateOffset = (nextOffset: Partial<PoseTarget>) => {
    updateTarget(targetWithOffset(activeBaseTarget, { ...offset, ...nextOffset }))
  }

  const commitCurrentTarget = () => {
    void sendTargetNow(targetRef.current).finally(() => {
      scheduleManualPoseRelease('frontend_pose_remote_commit')
    })
  }

  const sendTargetNow = async (nextTarget = targetRef.current, options: { forceHold?: boolean } = {}) => {
    if (simulated) return 0
    try {
      await ensureManualPoseHold(options.forceHold ?? true)
      const duration = safeGotoDuration(lastSentTargetRef.current, nextTarget)
      await gotoPose({
        head_pose: { x: nextTarget.x, z: nextTarget.z, yaw: nextTarget.yaw, pitch: uiPitchToDaemon(nextTarget.pitch), roll: nextTarget.roll },
        antennas: [nextTarget.leftEar, nextTarget.rightEar],
        body_yaw: nextTarget.bodyYaw,
        duration,
      })
      rememberSentTarget(nextTarget)
      setError(null)
      setMessage(null)
      return duration
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : '发送目标失败')
      return 0
    }
  }

  const switchBase = (poseName: BasicPoseName) => {
    setActiveBase(poseName)
    const nextTarget = baseTargetFromConfig(basicPoses, poseName)
    updateTarget(nextTarget, false)
    void sendTargetNow(nextTarget).finally(() => {
      scheduleManualPoseRelease('frontend_pose_switch_base')
    })
  }

  const resetToActiveBase = async () => {
    const nextTarget = activeBaseTarget
    updateTarget(nextTarget, false)
    await sendTargetNow(nextTarget)
    scheduleManualPoseRelease('frontend_pose_reset')
  }

  const saveCurrentAsBasicPose = async (poseName: BasicPoseName) => {
    if (simulated) return
    const currentTarget = targetRef.current
    setSavingPose(poseName)
    setMessage(null)
    try {
      const moveDuration = await sendTargetNow(currentTarget)
      await sleep(Math.max(350, moveDuration * 1000 + 150))
      const actualState = await getFullState()
      const actualTarget = targetFromFullState(actualState)
      const config = await saveBasicPose(
        poseName,
        {
          z: actualTarget.z,
          x: actualTarget.x,
          yaw: actualTarget.yaw,
          pitch: uiPitchToDaemon(actualTarget.pitch),
          roll: actualTarget.roll,
        },
        [actualTarget.leftEar, actualTarget.rightEar],
        actualTarget.bodyYaw,
      )
      setBasicPoses(config)
      setActiveBase(poseName)
      syncTarget(actualTarget)
      setError(null)
      releaseManualPoseControl('frontend_basic_pose_saved')
      if (poseName === 'init') {
        const syncResult = await syncConversationStartupPosture('daemon_init', true)
        if (syncResult.ok) {
          setMessage('已保存为唤醒基准，并已同步新版对话 App 当前动作基准')
        } else {
          setMessage('已保存为唤醒基准；新版对话 App 初始姿态同步失败')
        }
      } else {
        setMessage('已保存为睡眠基准姿态')
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存姿态定义失败')
    } finally {
      setSavingPose(null)
      scheduleManualPoseRelease('frontend_basic_pose_save_done', 200)
    }
  }

  const playBasicMove = async (moveName: 'wake' | 'sleep') => {
    if (simulated) return
    setPlayingMove(moveName)
    setMessage(null)
    try {
      releaseManualPoseControl('frontend_basic_move_play')
      if (moveName === 'wake') await playWakeUp()
      else await playGoToSleep()
      setError(null)
      setMessage(moveName === 'wake' ? '已发送唤醒动作' : '已发送休眠动作')
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : '发送动作失败')
    } finally {
      setPlayingMove(null)
    }
  }

  return (
    <div className="min-h-screen animate-fade-in">
      <nav className="sticky top-0 z-50 bg-[#080810]/80 backdrop-blur-2xl border-b border-white/[0.05]">
        <div className="max-w-4xl mx-auto px-6 md:px-10 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/dashboard" className="text-white/30 hover:text-white/60 transition-colors text-sm font-medium">返回</Link>
            <h1 className="text-lg font-bold text-white/85 tracking-tight">姿态遥控</h1>
          </div>
          <button onClick={() => setLiveMode(!liveMode)} className={`px-4 py-2 rounded-xl text-xs font-semibold tracking-wide transition-all duration-300 ${liveMode ? 'bg-sky-500/[0.08] text-sky-300/80 border border-sky-500/[0.15]' : 'text-white/30 border border-white/[0.06] hover:text-white/55'}`}>
            {liveMode ? '实时模式' : '步进模式'}
          </button>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 md:px-10 py-12">
        {error && (
          <div className="mb-6 rounded-2xl border border-rose-500/[0.16] bg-rose-500/[0.06] p-4 text-sm text-rose-200/78">{error}</div>
        )}
        {message && (
          <div className="mb-6 rounded-2xl border border-emerald-500/[0.14] bg-emerald-500/[0.05] p-4 text-sm text-emerald-100/72">{message}</div>
        )}

        <div className="grid grid-cols-1 gap-8">
          <div className="space-y-8">
            {simulated && (
              <SimulatedRobotPreview yaw={target.yaw} pitch={target.pitch} roll={target.roll} bodyYaw={target.bodyYaw} active={liveMode} />
            )}

            <div className="bg-white/[0.02] border border-white/[0.06] rounded-[1.5rem] p-6">
              <p className="text-white/[0.18] text-xs font-semibold uppercase tracking-[0.2em] mb-5">当前姿态</p>
              <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-8">
                <PoseValue label="X" value={pose.x} />
                <PoseValue label="Z" value={pose.z} />
                <PoseValue label="Pitch" value={pose.pitch} />
                <PoseValue label="Yaw" value={pose.yaw} />
                <PoseValue label="Roll" value={pose.roll} />
                <PoseValue label="Body" value={target.bodyYaw} />
                <PoseValue label="左耳" value={target.leftEar} />
                <PoseValue label="右耳" value={target.rightEar} />
              </div>
            </div>

            {!simulated && (
              <div className="rounded-[1.25rem] border border-white/[0.05] bg-white/[0.015] p-4">
                <div className="mb-3 text-xs font-semibold text-white/32">当前编辑基准</div>
                <div className="grid grid-cols-2 gap-3">
                  <BaseButton active={activeBase === 'init'} onClick={() => switchBase('init')}>唤醒基准</BaseButton>
                  <BaseButton active={activeBase === 'sleep'} onClick={() => switchBase('sleep')}>睡眠基准</BaseButton>
                </div>
              </div>
            )}

            <div className="bg-white/[0.02] border border-white/[0.06] rounded-[1.5rem] p-6 space-y-7">
              <Slider label="前后偏移" unit="X" value={offset.x} min={-BASE_RADIUS.x} max={BASE_RADIUS.x} step={0.001} onStart={beginPoseEdit} onChange={value => updateOffset({ x: value })} onCommit={commitCurrentTarget} />
              <Slider label="抬降偏移" unit="Z" value={offset.z} min={-BASE_RADIUS.z} max={BASE_RADIUS.z} step={0.001} onStart={beginPoseEdit} onChange={value => updateOffset({ z: value })} onCommit={commitCurrentTarget} />
              <Slider label="左右偏移" unit="Yaw" value={offset.yaw} min={-BASE_RADIUS.yaw} max={BASE_RADIUS.yaw} step={0.01} onStart={beginPoseEdit} onChange={value => updateOffset({ yaw: value })} onCommit={commitCurrentTarget} />
              <Slider label="俯仰偏移" unit="Pitch" value={offset.pitch} min={-BASE_RADIUS.pitch} max={BASE_RADIUS.pitch} step={0.01} onStart={beginPoseEdit} onChange={value => updateOffset({ pitch: value })} onCommit={commitCurrentTarget} />
              <Slider label="歪头偏移" unit="Roll" value={offset.roll} min={-BASE_RADIUS.roll} max={BASE_RADIUS.roll} step={0.01} onStart={beginPoseEdit} onChange={value => updateOffset({ roll: value })} onCommit={commitCurrentTarget} />
              <Slider label="转身" unit="Body" value={target.bodyYaw} min={-1.5} max={1.5} step={0.01} onStart={beginPoseEdit} onChange={value => updateTarget({ bodyYaw: value })} onCommit={commitCurrentTarget} />
              <Slider label="左耳偏移" unit="L" value={offset.leftEar} min={-BASE_RADIUS.leftEar} max={BASE_RADIUS.leftEar} step={0.01} onStart={beginPoseEdit} onChange={value => updateOffset({ leftEar: value })} onCommit={commitCurrentTarget} />
              <Slider label="右耳偏移" unit="R" value={offset.rightEar} min={-BASE_RADIUS.rightEar} max={BASE_RADIUS.rightEar} step={0.01} onStart={beginPoseEdit} onChange={value => updateOffset({ rightEar: value })} onCommit={commitCurrentTarget} />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => void resetToActiveBase()}
                className="h-12 rounded-[1.25rem] border border-white/[0.06] bg-white/[0.02] px-4 text-sm font-semibold text-white/55 transition hover:bg-white/[0.06] hover:text-white/80"
              >
                重置
              </button>
              {!simulated && (
                <button
                  type="button"
                  onClick={() => void playBasicMove('wake')}
                  disabled={playingMove !== null}
                  className="h-12 rounded-[1.25rem] border border-sky-300/[0.16] bg-sky-400/[0.07] px-4 text-sm font-semibold text-sky-100/70 transition hover:bg-sky-400/[0.13] disabled:opacity-40"
                >
                  {playingMove === 'wake' ? '发送中...' : '唤醒'}
                </button>
              )}
              {!simulated && (
                <button
                  type="button"
                  onClick={() => void playBasicMove('sleep')}
                  disabled={playingMove !== null}
                  className="h-12 rounded-[1.25rem] border border-white/[0.06] bg-white/[0.02] px-4 text-sm font-semibold text-white/48 transition hover:bg-white/[0.05] hover:text-white/70 disabled:opacity-40"
                >
                  {playingMove === 'sleep' ? '发送中...' : '休眠'}
                </button>
              )}
            </div>

            {!simulated && (
              <div className="rounded-[1.25rem] border border-white/[0.05] bg-white/[0.015] p-4">
                <div className="mb-3 text-xs font-semibold text-white/32">保存当前姿态定义</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => void saveCurrentAsBasicPose('init')}
                    disabled={savingPose !== null}
                    className="h-11 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 text-xs font-semibold text-white/48 transition hover:bg-white/[0.05] hover:text-white/70 disabled:opacity-40"
                  >
                    {savingPose === 'init' ? '保存中...' : '保存为唤醒基准'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveCurrentAsBasicPose('sleep')}
                    disabled={savingPose !== null}
                    className="h-11 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 text-xs font-semibold text-white/48 transition hover:bg-white/[0.05] hover:text-white/70 disabled:opacity-40"
                  >
                    {savingPose === 'sleep' ? '保存中...' : '保存为睡眠基准'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

function BaseButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-10 rounded-xl border px-3 text-xs font-semibold transition ${active ? 'border-sky-300/[0.2] bg-sky-400/[0.08] text-sky-100/75' : 'border-white/[0.06] bg-white/[0.02] text-white/45 hover:bg-white/[0.05]'}`}
    >
      {children}
    </button>
  )
}

function PoseValue({ label, value }: { label: string; value?: number }) {
  return (
    <div>
      <div className="text-white/[0.18] text-xs font-medium mb-1">{label}</div>
      <div className="text-white/55 text-lg font-mono font-light">{value !== undefined ? value.toFixed(3) : '--'}</div>
    </div>
  )
}

function Slider({ label, unit, value, min, max, step, onStart, onChange, onCommit }: { label: string; unit: string; value: number; min: number; max: number; step: number; onStart: () => void; onChange: (value: number) => void; onCommit: (value: number) => void }) {
  const displayPrecision = unit === 'X' || unit === 'Z' ? 3 : 2
  const commit = (rawValue: number) => {
    onCommit(rawValue)
  }
  return (
    <div>
      <div className="flex justify-between items-end mb-3">
        <span className="text-white/45 text-sm font-medium">{label}</span>
        <span className="text-white/28 text-xs font-mono bg-white/[0.04] px-3 py-1 rounded-lg">{value.toFixed(displayPrecision)} <span className="text-white/[0.14]">{unit}</span></span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={onStart}
        onChange={event => onChange(parseFloat(event.target.value))}
        onPointerUp={event => commit(parseFloat(event.currentTarget.value))}
        onPointerCancel={event => commit(parseFloat(event.currentTarget.value))}
        onBlur={event => commit(parseFloat(event.currentTarget.value))}
        onKeyUp={event => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') commit(parseFloat(event.currentTarget.value))
        }}
        className="w-full h-1.5 rounded-full bg-white/[0.06] appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-sky-400 [&::-webkit-slider-thumb]:shadow-[0_0_16px_rgba(56,189,248,0.4)]"
      />
    </div>
  )
}
