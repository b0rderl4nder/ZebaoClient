import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import URDFLoader from 'urdf-loader'
import type { FullState } from '../../api/types'

const STEWART = ['stewart_1', 'stewart_2', 'stewart_3', 'stewart_4', 'stewart_5', 'stewart_6']
const PASSIVE = Array.from({ length: 7 }, (_, index) => ['x', 'y', 'z'].map(axis => `passive_${index + 1}_${axis}`)).flat()

interface RobotModel extends THREE.Object3D {
  joints: Record<string, unknown>
  setJointValue: (name: string, value: number) => void
}

function normalizeEndpoint(endpoint: string) {
  return endpoint.replace(/\/$/, '')
}

function useUrdf(endpoint: string) {
  const [robot, setRobot] = useState<RobotModel | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    const base = normalizeEndpoint(endpoint)
    void fetch(`${base}/api/kinematics/urdf`)
      .then(response => { if (!response.ok) throw new Error('无法读取机器人模型'); return response.json() as Promise<{ urdf: string }> })
      .then(({ urdf }) => new Promise<RobotModel>((resolve, reject) => {
        const loader = new URDFLoader()
        let model: RobotModel | null = null
        loader.manager.setURLModifier(url => `${base}/api/kinematics/stl/${encodeURIComponent(url.split('/').pop() || url)}`)
        loader.manager.onError = () => reject(new Error('机器人网格加载失败'))
        loader.manager.onLoad = () => { if (model) resolve(model) }
        model = loader.parse(urdf) as RobotModel
        window.setTimeout(() => { if (model) resolve(model) }, 5000)
      }))
      .then(model => {
        if (cancelled) return
        model.traverse(child => {
          const mesh = child as THREE.Mesh
          if (!mesh.isMesh) return
          mesh.castShadow = true
          mesh.receiveShadow = true
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          materials.forEach(material => {
            if (material instanceof THREE.MeshStandardMaterial) {
              material.roughness = .72
              material.metalness = .08
            }
          })
        })
        setRobot(model)
      })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : '模型加载失败') })
    return () => { cancelled = true }
  }, [endpoint])
  return { robot, error }
}

function applyState(robot: RobotModel, state: FullState) {
  const head = state.head_joints
  if (Array.isArray(head) && head.length >= 7) {
    if (robot.joints.yaw_body) robot.setJointValue('yaw_body', head[0])
    STEWART.forEach((name, index) => { if (robot.joints[name]) robot.setJointValue(name, head[index + 1]) })
  } else if (typeof state.body_yaw === 'number' && robot.joints.yaw_body) {
    robot.setJointValue('yaw_body', state.body_yaw)
  }
  const passive = state.passive_joints
  if (Array.isArray(passive)) PASSIVE.forEach((name, index) => { if (robot.joints[name] && Number.isFinite(passive[index])) robot.setJointValue(name, passive[index]) })
  const antennas = state.antennas_position
  if (Array.isArray(antennas)) {
    if (robot.joints.left_antenna) robot.setJointValue('left_antenna', -antennas[1])
    if (robot.joints.right_antenna) robot.setJointValue('right_antenna', -antennas[0])
  }
  robot.updateMatrixWorld(true)
}

function RobotObject({ robot, state }: { robot: RobotModel; state: FullState | null }) {
  const clone = useMemo(() => robot.clone(true) as RobotModel, [robot])
  useEffect(() => { if (state) applyState(clone, state) }, [clone, state])
  return <group rotation={[0, -Math.PI / 2, 0]}><primitive object={clone} rotation={[-Math.PI / 2, 0, 0]} /></group>
}

export default function Robot3DViewer({ endpoint, state, connected, highlight = false }: { endpoint: string; state: FullState | null; connected: boolean; highlight?: boolean }) {
  const { robot, error } = useUrdf(endpoint)
  return <div className={`robot-viewer ${highlight ? 'is-warning' : ''}`}>
    {robot ? <Canvas camera={{ position: [.55, .36, .65], fov: 34 }} dpr={[1, 1.75]} gl={{ antialias: true }} shadows>
      <color attach="background" args={['#0b0b0b']} />
      <ambientLight intensity={1.15}/><directionalLight position={[2, 3, 2]} intensity={2.3} castShadow/><directionalLight position={[-2, 1, -1]} intensity={.7} color="#d99a43"/>
      <RobotObject robot={robot} state={state}/>
      <Grid position={[0, -.01, 0]} args={[2, 2]} cellSize={.05} cellColor="#24231f" sectionSize={.25} sectionColor="#3a3328" fadeDistance={2}/>
      <OrbitControls makeDefault target={[0, .18, 0]} minDistance={.35} maxDistance={1.4} enablePan={false}/>
    </Canvas> : <div className="robot-viewer__empty"><strong>{error || '正在加载真实模型'}</strong><span>{error ? '请检查机器人daemon与模型接口' : 'URDF与网格正在准备'}</span></div>}
    <div className="robot-viewer__status"><i className={connected ? 'is-online' : ''}/>{connected ? '实时状态' : '等待连接'}</div>
  </div>
}
