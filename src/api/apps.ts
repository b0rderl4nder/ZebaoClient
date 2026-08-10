import { get, post } from './client'
import type { AppInfo, AppStatus, JobInfo } from './types'
export async function listAvailableApps(sourceKind?: string): Promise<AppInfo[]> {
  return get(sourceKind ? `/api/apps/list-available/${sourceKind}` : '/api/apps/list-available') as Promise<AppInfo[]>
}
export async function installApp(app: AppInfo) { return post('/api/apps/install', app) as Promise<{ job_id: string }> }
export async function removeApp(name: string) { return post(`/api/apps/remove/${name}`) as Promise<{ job_id: string }> }
export async function startApp(name: string) { return post(`/api/apps/start-app/${name}`) as Promise<AppStatus> }
export async function stopCurrentApp() { await post('/api/apps/stop-current-app') }
export async function getCurrentAppStatus() { return get('/api/apps/current-app-status') as Promise<AppStatus | null> }
export async function getJobStatus(jobId: string) { return get(`/api/apps/job-status/${jobId}`) as Promise<JobInfo> }
