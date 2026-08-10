import { invoke } from '@tauri-apps/api/core'

export function isDesktopApp(): boolean {
  return '__TAURI_INTERNALS__' in window
}

export async function startDesktopSimulation(port = 8002, scene = 'minimal'): Promise<void> {
  if (!isDesktopApp()) throw new Error('请在泽宝桌面端启动物理仿真')
  await invoke('simulation_start', { port, scene })
}

export async function stopDesktopSimulation(): Promise<void> {
  if (!isDesktopApp()) return
  await invoke('simulation_stop')
}

export async function desktopSimulationRunning(): Promise<boolean> {
  if (!isDesktopApp()) return false
  return Boolean(await invoke('simulation_running'))
}
