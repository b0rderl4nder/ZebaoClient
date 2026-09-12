import { operatorRequest } from './operator'
export { OPERATOR_APP_PORT } from './operator'

export interface EmbodiedProfile {
  id: string
  name: string
  description: string
  components: Record<string, boolean>
  allowed_reactions: string[]
}

export interface EmbodiedInteractionStatus {
  ok: boolean
  enabled?: boolean
  activity_level?: string
  activity_level_source?: string
  available_activity_levels?: { id: string; name: string; description: string }[]
  mimic?: { mode?: string; available_modes?: { id: string; name: string; description: string }[] }
  phase?: string
  active_scene_id?: string
  scene?: {
    id?: string
    name?: string
    generation?: string
  }
  profile_source?: 'scene_override' | 'interaction_policy_default'
  active_profile?: EmbodiedProfile
  available_profiles?: EmbodiedProfile[]
  scene_profiles?: Record<string, string>
  attention?: {
    source?: string
    target_kind?: string
    age_ms?: number | null
  }
  last_execution?: {
    accepted?: boolean
    reason?: string
    kind?: string
    age_ms?: number | null
  }
  safety?: {
    visual_direct_servo_control?: boolean
    model_direct_servo_control?: boolean
    continuous_motion_during_microphone_capture?: boolean
  }
  error?: string
}

export interface EmbodiedInteractionPatch {
  enabled?: boolean
  scene_id?: string
  /** `auto` removes a scene override and follows the interaction policy. */
  profile_id?: string
  activity_level?: string
  mimic_response_mode?: string
}

export async function fetchEmbodiedInteractionStatus(): Promise<EmbodiedInteractionStatus> {
  return operatorRequest('/api/v1/embodied-interaction')
}

export async function configureEmbodiedInteraction(
  patch: EmbodiedInteractionPatch,
): Promise<EmbodiedInteractionStatus> {
  return operatorRequest('/api/v1/embodied-interaction', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(patch),
  })
}
