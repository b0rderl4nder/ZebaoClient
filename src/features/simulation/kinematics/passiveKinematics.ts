import { Euler, Matrix4 } from 'three'
import type { FullState, HeadPose } from '../../../api/types'

export type PassiveJointSolver = (headJoints: number[], headPoseMatrix: number[]) => number[] | null

let solverPromise: Promise<PassiveJointSolver> | null = null

export function loadPassiveJointSolver(): Promise<PassiveJointSolver> {
  if (solverPromise) return solverPromise
  solverPromise = import('./reachy_mini_kinematics_wasm.js').then(async module => {
    await module.default()
    return (headJoints: number[], headPoseMatrix: number[]) => {
      if (headJoints.length !== 7 || headPoseMatrix.length !== 16) return null
      const result = module.calculate_passive_joints(
        new Float64Array(headJoints),
        new Float64Array(headPoseMatrix),
      )
      return Array.from(result)
    }
  })
  return solverPromise
}

function poseFromMatrix(values: number[]): HeadPose {
  const matrix = new Matrix4().set(...values as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number])
  const euler = new Euler().setFromRotationMatrix(matrix, 'XYZ')
  return { x: values[3], y: values[7], z: values[11], roll: euler.x, pitch: euler.y, yaw: euler.z }
}

export function normalizeKinematicsState(payload: unknown, solver: PassiveJointSolver | null): FullState {
  const raw = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const poseValue = raw.head_pose
  const matrix = Array.isArray(poseValue)
    ? poseValue.map(Number)
    : poseValue && typeof poseValue === 'object' && Array.isArray((poseValue as { m?: unknown }).m)
      ? ((poseValue as { m: unknown[] }).m).map(Number)
      : null
  const state = { ...raw } as FullState
  if (matrix?.length === 16) {
    state.head_pose_matrix = matrix
    state.head_pose = poseFromMatrix(matrix)
  }
  if (solver && state.head_joints && state.head_pose_matrix) {
    state.passive_joints = solver(state.head_joints, state.head_pose_matrix)
  }
  return state
}
