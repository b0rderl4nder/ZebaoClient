import { get, wsUrl } from './client'
import type { HeadPose, FullState } from './types'
export async function getHeadPose(): Promise<HeadPose> { return get('/api/state/present_head_pose?use_pose_matrix=false') as Promise<HeadPose> }
export async function getFullState(): Promise<FullState> { return get('/api/state/full?with_head_pose=true&with_body_yaw=true&with_control_mode=true') as Promise<FullState> }
export function connectStateWs(frequency = 10): WebSocket { return new WebSocket(wsUrl(`/api/state/ws/full?frequency=${frequency}&with_head_pose=true&with_body_yaw=true`)) }
export function connectSetTargetWs(): WebSocket { return new WebSocket(wsUrl('/api/move/ws/set_target')) }
