import { useEffect, useState } from 'react'
import { configureEmbodiedInteraction, fetchEmbodiedInteractionStatus, type EmbodiedInteractionStatus } from '../../api/embodied'

type Choice = { activity: string; profile: string }
type State = { sceneId: string; status: EmbodiedInteractionStatus; original: Choice; draft: Choice }
const equal = (a: Choice, b: Choice) => a.activity === b.activity && a.profile === b.profile
function choice(status: EmbodiedInteractionStatus, id: string): Choice {
  if (!status.scene_activity_levels || !status.scene_profiles || !Array.isArray(status.available_activity_levels) || !Array.isArray(status.available_profiles)) throw new Error('设备尚未提供完整的场景具身配置；原值未改动。')
  return { activity: status.scene_activity_levels[id] || 'follow_global', profile: status.scene_profiles[id] || 'auto' }
}

/** Shares the existing scene editor's draft/save boundary; never writes on selection. */
export function useSceneEmbodiedDraft(sceneId: string, visible: boolean) {
  const [state, setState] = useState<State | null>(null)
  const [failure, setFailure] = useState({ sceneId: '', message: '' })
  const [revision, setRevision] = useState(0)
  const current = state?.sceneId === sceneId ? state : null
  useEffect(() => { setState(null); setFailure({ sceneId: '', message: '' }) }, [sceneId])
  useEffect(() => {
    if (!sceneId || !visible || current) return
    const abort = new AbortController()
    setFailure({ sceneId, message: '' })
    void fetchEmbodiedInteractionStatus(abort.signal).then(status => {
      const selected = choice(status, sceneId)
      if (!abort.signal.aborted) setState({ sceneId, status, original: selected, draft: selected })
    }).catch(error => { if (!abort.signal.aborted) setFailure({ sceneId, message: error instanceof Error ? error.message : '场景具身设置读取失败。' }) })
    return () => abort.abort()
  }, [sceneId, visible, Boolean(current), revision])
  const dirty = Boolean(current && !equal(current.original, current.draft))
  const reset = () => setState(value => value?.sceneId === sceneId ? { ...value, draft: value.original } : value)
  const patch = (changes: Partial<Choice>) => setState(value => value?.sceneId === sceneId ? { ...value, draft: { ...value.draft, ...changes } } : value)
  const preflight = async () => {
    if (!current || !dirty) return
    const latest = choice(await fetchEmbodiedInteractionStatus(), sceneId)
    if (!equal(latest, current.original)) throw new Error('此场景的具身设置已在别处修改，请还原并重新读取后再保存。')
  }
  const save = async () => {
    if (!current || !dirty) return
    // Check only this scene's two overrides; never overwrite another scene or global settings.
    await preflight()
    const values = {
      scene_id: sceneId,
      ...(current.draft.activity !== current.original.activity ? { activity_level: current.draft.activity } : {}),
      ...(current.draft.profile !== current.original.profile ? { profile_id: current.draft.profile } : {}),
    }
    await configureEmbodiedInteraction(values)
    const status = await fetchEmbodiedInteractionStatus()
    const actual = choice(status, sceneId)
    if (!equal(actual, current.draft)) throw new Error('具身设置已提交，但回读未确认；请重新读取，勿重复提交。')
    setState(value => value?.sceneId === sceneId ? { sceneId, status, original: actual, draft: actual } : value)
  }
  return { current, dirty, error: failure.sceneId === sceneId ? failure.message : '', patch, reset, preflight, save,
    reload: () => { setState(null); setRevision(value => value + 1) } }
}
