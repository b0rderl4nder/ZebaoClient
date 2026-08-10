export interface RobotInfo {
  name: string; host: string; port: number; addresses: string[]; version?: string
}
export interface DaemonStatus {
  ready?: boolean
  motor_control_mode?: string
  error?: string | null
  version?: string
  state?: string
  backend_status?: {
    ready?: boolean
    motor_control_mode?: string
    physics_step_hz?: number
    physics_timestep_ms?: number
    active_contacts?: number
    joint_limit_violations?: number
    error?: string | null
  }
}
export interface HeadPose {
  x?: number; y?: number; z?: number; roll?: number; pitch?: number; yaw?: number
}
export interface AppInfo {
  name: string; description?: string; url?: string; source_kind: string; extra?: Record<string, unknown>
}
export type AppState = 'starting' | 'running' | 'done' | 'stopping' | 'error'
export interface AppStatus { info: AppInfo; state: AppState; error?: string | null }
export interface JobInfo {
  job_id: string; status: 'pending' | 'running' | 'completed' | 'failed'; logs?: string[]; error?: string
}
export interface FullState {
  control_mode?: string
  head_pose?: HeadPose
  head_pose_matrix?: number[]
  target_head_pose?: HeadPose
  body_yaw?: number
  target_body_yaw?: number
  antennas_position?: [number, number]
  target_antennas_position?: [number, number]
  head_joints?: number[]
  target_head_joints?: number[]
  passive_joints?: number[] | null
  timestamp?: string
}
