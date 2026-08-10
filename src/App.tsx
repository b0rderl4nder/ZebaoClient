import { Routes, Route, useNavigate } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { setStoredRobot, getStoredRobot, clearStoredRobot } from './utils/storage'
import { useRobot } from './hooks/useRobot'
import { useDiscovery } from './hooks/useDiscovery'
import DeviceDiscovery from './features/discovery/DeviceDiscovery'
import Dashboard from './features/dashboard/Dashboard'
import PoseControl from './features/pose-control/PoseControl'
import AppManager from './features/app-manager/AppManager'
import Conversation from './features/conversation/Conversation'
import MotionControl from './features/motion-control/MotionControl'
import PhysicsSimulation from './features/simulation/PhysicsSimulation'
import ClientShell from './components/ClientShell'

const SIMULATION_KEY = 'zebao_simulated_mode'

export default function App() {
  const navigate = useNavigate()
  const { connected, robot, error, connect, disconnect } = useRobot()
  const { scanning, devices, scan, scanSummary } = useDiscovery()
  const [simulated, setSimulated] = useState(() => localStorage.getItem(SIMULATION_KEY) === 'true')

  const handleConnect = useCallback(async (host: string, port: number) => {
    setSimulated(false)
    localStorage.removeItem(SIMULATION_KEY)
    await connect(host, port); setStoredRobot(host, port); navigate('/dashboard')
  }, [connect, navigate])

  const handleSimulate = useCallback(() => {
    setSimulated(true)
    localStorage.setItem(SIMULATION_KEY, 'true')
    navigate('/dashboard')
  }, [navigate])

  const handleSwitchDevice = useCallback(() => {
    disconnect()
    clearStoredRobot()
    setSimulated(false)
    localStorage.removeItem(SIMULATION_KEY)
    navigate('/')
  }, [disconnect, navigate])

  useEffect(() => {
    if (simulated) return
    const stored = getStoredRobot()
    if (stored && !connected) { connect(stored.host, stored.port).then(() => { if (window.location.pathname === '/') navigate('/dashboard') }) }
  }, [connect, connected, navigate, simulated])

  return (
    <Routes>
      <Route path="/" element={<DeviceDiscovery onConnect={handleConnect} onSimulate={handleSimulate} scanning={scanning} devices={devices} onScan={scan} scanSummary={scanSummary} error={connected ? null : error} />} />
      <Route path="/dashboard" element={<ClientShell host={simulated ? '模拟操作界面' : robot?.host ?? ''} simulated={simulated} onSwitchDevice={handleSwitchDevice} />}>
        <Route index element={<Dashboard host={simulated ? '模拟操作界面' : robot?.host ?? ''} simulated={simulated} onSwitchDevice={handleSwitchDevice} />} />
        <Route path="pose" element={<PoseControl simulated={simulated} />} />
        <Route path="motions" element={<MotionControl simulated={simulated} />} />
        <Route path="apps" element={<AppManager simulated={simulated} />} />
        <Route path="chat" element={<Conversation simulated={simulated} />} />
        <Route path="simulation" element={<PhysicsSimulation />} />
      </Route>
    </Routes>
  )
}
