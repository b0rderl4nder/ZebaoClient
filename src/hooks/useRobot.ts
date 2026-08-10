import { useCallback, useState } from 'react'
import { DEFAULT_DAEMON_PORT, setBaseUrl } from '../api/client'
import type { RobotInfo } from '../api/types'

const KEY = 'zebao_recent_robots'

export function loadRecentRobots(): RobotInfo[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}

function saveRecent(robots: RobotInfo[]) { localStorage.setItem(KEY, JSON.stringify(robots.slice(0, 10))) }

export function useRobot() {
  const [connected, setConnected] = useState(false)
  const [robot, setRobot] = useState<RobotInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  const connect = useCallback(async (host: string, port = DEFAULT_DAEMON_PORT) => {
    setError(null)
    try {
      const url = `http://${host}:${port}`
      setBaseUrl(url)
      const response = await fetch(`${url}/api/daemon/status`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const status = await response.json()
      const info: RobotInfo = { name: host, host, port, addresses: [host], version: status.version }
      setRobot(info)
      setConnected(true)
      const recent = loadRecentRobots()
      saveRecent([info, ...recent.filter(item => item.host !== host || item.port !== port)])
    } catch (error) {
      setError(`连接失败：${error instanceof Error ? error.message : '未知错误'}`)
      setConnected(false)
    }
  }, [])

  const disconnect = useCallback(() => {
    setBaseUrl('')
    setRobot(null)
    setConnected(false)
    setError(null)
  }, [])

  return { connected, robot, error, connect, disconnect }
}
