import { get, post } from './client'
import type { DaemonStatus } from './types'
export async function fetchDaemonStatus(): Promise<DaemonStatus> { return get('/api/daemon/status') as Promise<DaemonStatus> }
export async function startDaemon(wakeUp = false) { return post(`/api/daemon/start?wake_up=${wakeUp}`) }
export async function stopDaemon(goToSleep = false) { return post(`/api/daemon/stop?goto_sleep=${goToSleep}`) }
export async function restartDaemon() { return post('/api/daemon/restart') }
