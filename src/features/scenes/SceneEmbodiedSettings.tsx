import type { useSceneEmbodiedDraft } from './useSceneEmbodiedDraft'

export default function SceneEmbodiedSettings({ editor, disabled }: { editor: ReturnType<typeof useSceneEmbodiedDraft>; disabled: boolean }) {
  const { current, error } = editor
  if (error) return <p role="alert">{error}<button disabled={disabled} onClick={editor.reload}>重试具身设置</button></p>
  if (!current) return <p role="status">正在读取场景具身设置</p>
  const { status, draft } = current
  const levels = status.available_activity_levels || [], profiles = status.available_profiles || []
  return <div className="scene-profile-fields" aria-label="场景具身设置">
    <label>主动程度<select value={draft.activity} disabled={disabled} onChange={event => editor.patch({ activity: event.target.value })}>
      <option value="follow_global">跟随整机 · {levels.find(item => item.id === status.global_activity_level)?.name || '以设备设置为准'}</option>
      {draft.activity !== 'follow_global' && !levels.some(item => item.id === draft.activity) && <option value={draft.activity} disabled>当前档位不可用 · 保留原值</option>}
      {levels.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    <label>动作表现<select value={draft.profile} disabled={disabled} onChange={event => editor.patch({ profile: event.target.value })}>
      <option value="auto">跟随场景交互策略</option>
      {draft.profile !== 'auto' && !profiles.some(item => item.id === draft.profile) && <option value={draft.profile} disabled>当前表现不可用 · 保留原值</option>}
      {profiles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    <details className="parameter-help"><summary>这两项影响什么？</summary><p>仅对此场景生效，随下方“保存”提交；不修改整机开关或动作安全范围。</p>{levels.find(item => item.id === draft.activity)?.description && <p>{levels.find(item => item.id === draft.activity)?.description}</p>}{profiles.find(item => item.id === draft.profile)?.description && <p>{profiles.find(item => item.id === draft.profile)?.description}</p>}</details>
  </div>
}
