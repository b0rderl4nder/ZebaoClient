import { getBaseUrl, getConnectedHost } from './client'
import type { DaemonStatus, FullState, HeadPose } from './types'

export const DEFAULT_MUJOCO_ENDPOINT = 'http://127.0.0.1:8002'
export const OFFICE_APP_PORTS = [7862, 7861, 7860] as const

export interface MotionSafetyStatus {
  mode?: string
  ready?: boolean
  limited_count?: number
  rejected_count?: number
  last_scale?: number
  last_reasons?: string[]
  limits?: Record<string, number>
  peak_requested?: Record<string, number>
}

export interface OfficeMovementStatus {
  worker_running?: boolean
  queue_size?: number
  motion_priority?: string
  primary_move?: { type?: string; name?: string } | null
  thinking_motion?: { suppressed_by?: string | null }
  motion_safety?: MotionSafetyStatus
}

export type SimulationPresetId = 'nod' | 'turn' | 'dance' | 'thinking'

type SimulationKeyframe = {
  head_pose: Required<HeadPose>
  antennas: [number, number]
  body_yaw: number
  duration: number
}

const NEUTRAL_HEAD: Required<HeadPose> = { x: 0, y: 0, z: 0, roll: 0, pitch: 0, yaw: 0 }

export const SIMULATION_PRESETS: Record<SimulationPresetId, { label: string; frames: SimulationKeyframe[] }> = {
  nod: {
    label: '点头',
    frames: [
      { head_pose: { ...NEUTRAL_HEAD, pitch: -0.16 }, antennas: [0, 0], body_yaw: 0, duration: 0.38 },
      { head_pose: { ...NEUTRAL_HEAD, pitch: 0.12 }, antennas: [0, 0], body_yaw: 0, duration: 0.34 },
      { head_pose: NEUTRAL_HEAD, antennas: [0, 0], body_yaw: 0, duration: 0.42 },
    ],
  },
  turn: {
    label: '转头',
    frames: [
      { head_pose: { ...NEUTRAL_HEAD, yaw: -0.42 }, antennas: [0, 0], body_yaw: -0.22, duration: 0.65 },
      { head_pose: { ...NEUTRAL_HEAD, yaw: 0.42 }, antennas: [0, 0], body_yaw: 0.22, duration: 0.9 },
      { head_pose: NEUTRAL_HEAD, antennas: [0, 0], body_yaw: 0, duration: 0.65 },
    ],
  },
  dance: {
    label: '跳舞',
    frames: [
      { head_pose: { ...NEUTRAL_HEAD, roll: 0.16, yaw: -0.22 }, antennas: [0.42, -0.28], body_yaw: -0.3, duration: 0.48 },
      { head_pose: { ...NEUTRAL_HEAD, roll: -0.16, yaw: 0.22 }, antennas: [-0.28, 0.42], body_yaw: 0.3, duration: 0.62 },
      { head_pose: { ...NEUTRAL_HEAD, pitch: -0.1, yaw: -0.18 }, antennas: [0.36, 0.36], body_yaw: -0.24, duration: 0.5 },
      { head_pose: { ...NEUTRAL_HEAD, pitch: 0.08, yaw: 0.18 }, antennas: [-0.2, -0.2], body_yaw: 0.24, duration: 0.5 },
      { head_pose: NEUTRAL_HEAD, antennas: [0, 0], body_yaw: 0, duration: 0.65 },
    ],
  },
  thinking: {
    label: '思考',
    frames: [
      { head_pose: { ...NEUTRAL_HEAD, roll: 0.08, yaw: -0.12 }, antennas: [0.34, -0.18], body_yaw: 0, duration: 0.5 },
      { head_pose: { ...NEUTRAL_HEAD, roll: -0.05, yaw: 0.08 }, antennas: [-0.12, 0.3], body_yaw: 0, duration: 0.55 },
      { head_pose: NEUTRAL_HEAD, antennas: [0, 0], body_yaw: 0, duration: 0.55 },
    ],
  },
}

function simulatorEndpoint(): string {
  return DEFAULT_MUJOCO_ENDPOINT
}

function physicalEndpoint(): string {
  return getBaseUrl() || `http://${getConnectedHost()}:8000`
}

async function simulationRequest(path: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 3000)
  try {
    const response = await fetch(`${simulatorEndpoint()}${path}`, {
      ...init,
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`${response.status} ${text || response.statusText}`)
    return text ? JSON.parse(text) : null
  } finally {
    window.clearTimeout(timer)
  }
}

export function getSimulatorEndpoint(): string {
  return simulatorEndpoint()
}

export function getPhysicalEndpoint(): string {
  return physicalEndpoint()
}

export async function fetchSimulationStatus(): Promise<DaemonStatus> {
  return simulationRequest('/api/daemon/status') as Promise<DaemonStatus>
}

export async function startSimulationBackend(): Promise<unknown> {
  return simulationRequest('/api/daemon/start?wake_up=false', { method: 'POST' })
}

export async function stopSimulationBackend(): Promise<unknown> {
  return simulationRequest('/api/daemon/stop?goto_sleep=false', { method: 'POST' })
}

export async function fetchSimulationState(): Promise<FullState> {
  return simulationRequest(
    '/api/state/full?with_head_pose=true&use_pose_matrix=true&with_head_joints=true&with_body_yaw=true&with_antenna_positions=true',
  ) as Promise<FullState>
}

function waitFor(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds)
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer)
      reject(new DOMException('动作验证已取消', 'AbortError'))
    }, { once: true })
  })
}

export async function playSimulationPreset(presetId: SimulationPresetId, signal: AbortSignal): Promise<void> {
  const preset = SIMULATION_PRESETS[presetId]
  for (const frame of preset.frames) {
    if (signal.aborted) throw new DOMException('动作验证已取消', 'AbortError')
    const result = await simulationRequest('/api/move/goto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...frame, interpolation: 'minjerk' }),
    }) as { uuid?: string }
    try {
      await waitFor(frame.duration * 1000 + 80, signal)
    } catch (error) {
      if (result.uuid) {
        await simulationRequest('/api/move/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uuid: result.uuid }),
        }).catch(() => null)
      }
      throw error
    }
  }
}

export async function fetchUrdfFingerprint(endpoint: string): Promise<string> {
  const response = await fetch(`${endpoint.replace(/\/$/, '')}/api/kinematics/urdf`)
  if (!response.ok) throw new Error(`URDF ${response.status}`)
  const payload = await response.json() as { urdf?: string }
  const source = payload.urdf || ''
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function connectSimulationTargetWs(): WebSocket {
  return new WebSocket(
    simulatorEndpoint().replace(/^http/, 'ws') + '/api/move/ws/set_target',
  )
}

export function connectPhysicalStateWs(endpoint: string, frequency = 20): WebSocket {
  return new WebSocket(
    endpoint.replace(/^http/, 'ws').replace(/\/$/, '')
      + `/api/state/ws/full?frequency=${frequency}&with_head_pose=true&use_pose_matrix=true&with_head_joints=true&with_body_yaw=true&with_antenna_positions=true`,
  )
}

export function simulationTargetFromState(state: FullState): {
  target_head_pose: Required<HeadPose>
  target_antennas: [number, number]
  target_body_yaw: number
} | null {
  const head = state.head_pose
  const antennas = state.antennas_position
  if (!head || !antennas || antennas.length !== 2) return null
  const values = [
    head.x ?? 0,
    head.y ?? 0,
    head.z ?? 0,
    head.roll ?? 0,
    head.pitch ?? 0,
    head.yaw ?? 0,
    antennas[0],
    antennas[1],
    state.body_yaw ?? 0,
  ]
  if (!values.every(Number.isFinite)) return null
  return {
    target_head_pose: {
      x: values[0],
      y: values[1],
      z: values[2],
      roll: values[3],
      pitch: values[4],
      yaw: values[5],
    },
    target_antennas: [values[6], values[7]],
    target_body_yaw: values[8],
  }
}

export async function fetchOfficeMovementStatus(endpoint = physicalEndpoint()): Promise<OfficeMovementStatus> {
  const host = new URL(endpoint).hostname
  let lastError: unknown = null
  for (const port of OFFICE_APP_PORTS) {
    try {
      const response = await fetch(`http://${host}:${port}/api/v1/status`)
      if (!response.ok) continue
      const payload = await response.json() as { movement?: OfficeMovementStatus }
      if (payload.movement) return payload.movement
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('办公室 App 动作状态不可用')
}
