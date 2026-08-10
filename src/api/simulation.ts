import { getConnectedHost } from './client'
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

function simulatorEndpoint(): string {
  return (localStorage.getItem('zebao_mujoco_endpoint') || DEFAULT_MUJOCO_ENDPOINT).replace(/\/$/, '')
}

function physicalEndpoint(): string {
  const connected = `http://${getConnectedHost()}:8000`
  return (localStorage.getItem('zebao_physical_daemon_endpoint') || connected).replace(/\/$/, '')
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

export function saveSimulatorEndpoint(endpoint: string): string {
  const normalized = endpoint.trim().replace(/\/$/, '') || DEFAULT_MUJOCO_ENDPOINT
  localStorage.setItem('zebao_mujoco_endpoint', normalized)
  return normalized
}

export function getPhysicalEndpoint(): string {
  return physicalEndpoint()
}

export function savePhysicalEndpoint(endpoint: string): string {
  const normalized = endpoint.trim().replace(/\/$/, '') || `http://${getConnectedHost()}:8000`
  localStorage.setItem('zebao_physical_daemon_endpoint', normalized)
  return normalized
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
    '/api/state/full?with_head_pose=true&with_body_yaw=true&with_antenna_positions=true',
  ) as Promise<FullState>
}

export function connectSimulationTargetWs(): WebSocket {
  return new WebSocket(
    simulatorEndpoint().replace(/^http/, 'ws') + '/api/move/ws/set_target',
  )
}

export function connectPhysicalStateWs(endpoint: string, frequency = 20): WebSocket {
  return new WebSocket(
    endpoint.replace(/^http/, 'ws').replace(/\/$/, '')
      + `/api/state/ws/full?frequency=${frequency}&with_head_pose=true&with_body_yaw=true&with_antenna_positions=true`,
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
