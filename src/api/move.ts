import { EXHIBITION_CONVERSATION_APP_PORT, OFFICIAL_CONVERSATION_APP_PORT, appUrl, get, post } from './client'
import type { HeadPose } from './types'

export interface GotoRequest {
  head_pose?: { x?: number; y?: number; z?: number; roll?: number; pitch?: number; yaw?: number }; antennas?: [number, number]; body_yaw?: number; duration?: number
}

export async function gotoPose(req: GotoRequest): Promise<{ uuid: string }> {
  return post('/api/move/goto', {
    head_pose: req.head_pose ? { x: req.head_pose.x ?? 0, y: req.head_pose.y ?? 0, z: req.head_pose.z ?? 0, roll: req.head_pose.roll ?? 0, pitch: req.head_pose.pitch ?? 0, yaw: req.head_pose.yaw ?? 0 } : { x: 0, y: 0, z: 0, roll: 0, pitch: 0, yaw: 0 },
    antennas: req.antennas ?? [0.0, 0.0],
    body_yaw: req.body_yaw ?? 0.0,
    duration: req.duration ?? 1.0,
    interpolation: 'minjerk',
  }) as Promise<{ uuid: string }>
}

export async function setTarget(req: GotoRequest): Promise<{ status: string; reason?: string }> {
  return post('/api/move/set_target', {
    target_head_pose: req.head_pose ? { x: req.head_pose.x ?? 0, y: req.head_pose.y ?? 0, z: req.head_pose.z ?? 0, roll: req.head_pose.roll ?? 0, pitch: req.head_pose.pitch ?? 0, yaw: req.head_pose.yaw ?? 0 } : undefined,
    target_antennas: req.antennas ?? [0.0, 0.0],
    target_body_yaw: req.body_yaw ?? 0.0,
  }) as Promise<{ status: string; reason?: string }>
}

export interface MovementManualHoldStatus {
  ok?: boolean
  manual_control?: {
    active?: boolean
    reason?: string
    hold_seconds?: number
    remaining_seconds?: number
  }
}

export async function requestMovementManualHold(holdSeconds = 8): Promise<MovementManualHoldStatus | null> {
  const ports = [OFFICIAL_CONVERSATION_APP_PORT, EXHIBITION_CONVERSATION_APP_PORT]
  for (const port of ports) {
    try {
      const response = await fetch(appUrl(port, '/movement/manual-hold'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hold_seconds: holdSeconds,
          reason: 'frontend_pose_remote',
        }),
      })
      if (response.ok) return (await response.json()) as MovementManualHoldStatus
      if (response.status === 404 || response.status === 503) continue
    } catch {
      continue
    }
  }
  return null
}

export async function releaseMovementManualHold(reason = 'frontend_pose_remote_done'): Promise<MovementManualHoldStatus | null> {
  const ports = [OFFICIAL_CONVERSATION_APP_PORT, EXHIBITION_CONVERSATION_APP_PORT]
  for (const port of ports) {
    try {
      const response = await fetch(appUrl(port, '/movement/manual-release'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      if (response.ok) return (await response.json()) as MovementManualHoldStatus
      if (response.status === 404 || response.status === 503) continue
    } catch {
      continue
    }
  }
  return null
}

export interface StartupPostureSyncResult {
  ok: boolean
  port?: number
  error?: string
}

export async function syncConversationStartupPosture(posture = 'daemon_init', applyNow = false): Promise<StartupPostureSyncResult> {
  const ports = [OFFICIAL_CONVERSATION_APP_PORT, EXHIBITION_CONVERSATION_APP_PORT]
  let lastError = ''
  for (const port of ports) {
    try {
      const response = await fetch(appUrl(port, '/api/v1/startup_postures/apply'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          posture,
          apply_now: applyNow,
        }),
      })
      if (response.ok) return { ok: true, port }
      lastError = `${port}: ${response.status}`
      if (response.status === 404 || response.status === 503) continue
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      continue
    }
  }
  return { ok: false, error: lastError || 'startup posture endpoint unavailable' }
}

export interface BasicPoseConfig {
  init_head_pose: HeadPose
  sleep_head_pose: HeadPose
  init_antennas: [number, number]
  sleep_antennas: [number, number]
  init_body_yaw?: number
  sleep_body_yaw?: number
  config_path: string
  exists: boolean
}

export async function getBasicPoses(): Promise<BasicPoseConfig> {
  return get('/api/move/basic-poses?use_pose_matrix=false') as Promise<BasicPoseConfig>
}

export async function saveBasicPose(poseName: 'init' | 'sleep', headPose: HeadPose, antennas: [number, number], bodyYaw = 0): Promise<BasicPoseConfig> {
  return post('/api/move/basic-poses?use_pose_matrix=false', {
    pose_name: poseName,
    head_pose: { x: headPose.x ?? 0, y: headPose.y ?? 0, z: headPose.z ?? 0, roll: headPose.roll ?? 0, pitch: headPose.pitch ?? 0, yaw: headPose.yaw ?? 0 },
    antennas,
    body_yaw: bodyYaw,
  }) as Promise<BasicPoseConfig>
}

export async function playWakeUp(): Promise<{ uuid: string }> { return post('/api/move/play/wake_up') as Promise<{ uuid: string }> }
export async function playGoToSleep(): Promise<{ uuid: string }> { return post('/api/move/play/goto_sleep') as Promise<{ uuid: string }> }
export async function stopMove(uuid: string): Promise<void> { await post('/api/move/stop', { uuid }) }
export async function getRunningMoves(): Promise<string[]> { return get('/api/move/running') as Promise<string[]> }
export async function listRecordedMoves(datasetName: string): Promise<string[]> {
  return get(`/api/move/recorded-move-datasets/list/${datasetName}`) as Promise<string[]>
}
export async function playRecordedMove(datasetName: string, moveName: string): Promise<{ uuid: string }> {
  return post(`/api/move/play/recorded-move-dataset/${datasetName}/${moveName}`) as Promise<{ uuid: string }>
}
