import { get, post } from './client'

export type MotorMode = 'enabled' | 'disabled' | 'gravity_compensation'

export async function getMotorStatus(): Promise<{ mode: MotorMode }> {
  return get('/api/motors/status') as Promise<{ mode: MotorMode }>
}

export async function setMotorMode(mode: MotorMode): Promise<{ status: string }> {
  return post(`/api/motors/set_mode/${mode}`) as Promise<{ status: string }>
}
