import { Navigate, Routes, Route, useNavigate } from 'react-router-dom'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { setStoredRobot, getStoredRobot, clearStoredRobot } from './utils/storage'
import { useRobot } from './hooks/useRobot'
import { useDiscovery } from './hooks/useDiscovery'
import DeviceDiscovery from './features/discovery/DeviceDiscovery'
import ClientShell from './components/ClientShell'

const Dashboard = lazy(() => import('./features/dashboard/Dashboard'))
const Control = lazy(() => import('./features/control/Control'))
const AppManager = lazy(() => import('./features/app-manager/AppManager'))
const Conversation = lazy(() => import('./features/conversation/Conversation'))
const PhysicsSimulation = lazy(() => import('./features/simulation/PhysicsSimulation'))
const Scenes = lazy(() => import('./features/scenes/Scenes'))
const Foundation = lazy(() => import('./features/foundation/Foundation'))
const VoiceSettings = lazy(() => import('./features/foundation/VoiceSettings'))
const SoundSettings = lazy(() => import('./features/foundation/SoundSettings'))
const MotionSettings = lazy(() => import('./features/foundation/MotionSettings'))
const VisionSettings = lazy(() => import('./features/foundation/VisionSettings'))
const NetworkSettings = lazy(() => import('./features/foundation/NetworkSettings'))
const StorageSettings = lazy(() => import('./features/foundation/StorageSettings'))
const CapabilityCatalog = lazy(() => import('./features/foundation/CapabilityCatalog'))
const QuietSettings = lazy(() => import('./features/foundation/QuietSettings'))
const MemorySettings = lazy(() => import('./features/foundation/MemorySettings'))
const People = lazy(() => import('./features/people/People'))
const PersonDetail = lazy(() => import('./features/people/PersonDetail'))
const EmbodiedInteractionControl = lazy(() => import('./features/embodied/EmbodiedInteractionControl'))

function Page({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="route-loading" role="status">正在加载</div>}>{children}</Suspense>
}

const SIMULATION_KEY = 'zebao_simulated_mode'

export default function App() {
  const navigate = useNavigate()
  const { connected, robot, error, connect, disconnect } = useRobot()
  const { scanning, devices, scan, scanSummary } = useDiscovery()
  const [simulated, setSimulated] = useState(() => localStorage.getItem(SIMULATION_KEY) === 'true')

  const handleConnect = useCallback(async (host: string, port: number) => {
    setSimulated(false)
    localStorage.removeItem(SIMULATION_KEY)
    if (await connect(host, port)) { setStoredRobot(host, port); navigate('/dashboard') }
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
    if (stored && !connected) { connect(stored.host, stored.port).then(ok => { if (ok && window.location.pathname === '/') navigate('/dashboard') }) }
  }, [connect, connected, navigate, simulated])

  return (
    <Routes>
      <Route path="/" element={<DeviceDiscovery onConnect={handleConnect} onSimulate={handleSimulate} scanning={scanning} devices={devices} onScan={scan} scanSummary={scanSummary} error={connected ? null : error} />} />
      <Route path="/dashboard" element={<ClientShell host={simulated ? '模拟操作界面' : robot?.host ?? ''} simulated={simulated} onSwitchDevice={handleSwitchDevice} />}>
        <Route index element={<Page><Dashboard host={simulated ? '模拟操作界面' : robot?.host ?? ''} simulated={simulated} onSwitchDevice={handleSwitchDevice} /></Page>} />
        <Route path="control" element={<Page><Control simulated={simulated} /></Page>} />
        <Route path="scenes" element={<Page><Scenes simulated={simulated}/></Page>} />
        <Route path="setup" element={<Navigate to="/dashboard/scenes" replace />} />
        <Route path="foundation" element={<Page><Foundation simulated={simulated}/></Page>} />
        <Route path="foundation/voice" element={<Page><VoiceSettings simulated={simulated}/></Page>} />
        <Route path="foundation/sound" element={<Page><SoundSettings simulated={simulated}/></Page>} />
        <Route path="foundation/motion" element={<Page><MotionSettings simulated={simulated}/></Page>} />
        <Route path="foundation/vision" element={<Page><VisionSettings simulated={simulated}/></Page>} />
        <Route path="foundation/network" element={<Page><NetworkSettings simulated={simulated}/></Page>} />
        <Route path="foundation/storage" element={<Page><StorageSettings simulated={simulated}/></Page>} />
        <Route path="foundation/capabilities" element={<Page><CapabilityCatalog simulated={simulated}/></Page>} />
        <Route path="foundation/quiet" element={<Page><QuietSettings simulated={simulated}/></Page>} />
        <Route path="foundation/memory" element={<Page><MemorySettings simulated={simulated}/></Page>} />
        <Route path="foundation/people" element={<Page><People simulated={simulated}/></Page>} />
        <Route path="foundation/people/:id" element={<Page><PersonDetail simulated={simulated}/></Page>} />
        <Route path="foundation/interaction" element={<Page><EmbodiedInteractionControl simulated={simulated}/></Page>} />
        <Route path="pose" element={<Navigate to="/dashboard/control?tab=pose" replace />} />
        <Route path="motions" element={<Navigate to="/dashboard/control?tab=motions" replace />} />
        <Route path="apps" element={<Page><AppManager simulated={simulated} /></Page>} />
        <Route path="chat" element={<Page><Conversation simulated={simulated} /></Page>} />
        <Route path="simulation" element={<Page><PhysicsSimulation /></Page>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
