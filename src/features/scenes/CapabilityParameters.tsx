import type { CapabilityOption, CapabilitySetting } from '../../api/sceneConfig'

export function parameterError(schema: CapabilitySetting[], values: Record<string, unknown>): string {
  for (const field of schema) {
    if (!(field.key in values)) continue
    const value = values[field.key]
    if (field.kind === 'integer' && (typeof value !== 'number' || !Number.isInteger(value) || (field.minimum != null && value < field.minimum) || (field.maximum != null && value > field.maximum))) return `${field.label}需要填写${field.minimum ?? '最小值'}到${field.maximum ?? '最大值'}之间的整数。`
    if (field.kind === 'boolean' && typeof value !== 'boolean') return `${field.label}需要选择开启或关闭。`
    if (field.kind === 'select' && !field.options?.some(option => option.value === value)) return `${field.label}请选择列表中的有效选项。`
    if (field.kind === 'text' && typeof value !== 'string') return `${field.label}需要填写文本。`
  }
  return ''
}
export const parameterObject = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** Scene-owned settings, rendered from the manifest rather than a Client capability list. */
export default function CapabilityParameters({ item, value, disabled, onChange }: { item: CapabilityOption; value: unknown; disabled: boolean; onChange: (value: Record<string, unknown>) => void }) {
  const values = parameterObject(value)
  const schema = item.settings_schema || []
  const error = parameterError(schema, values)
  return <div className="capability-parameters" aria-label={`${item.name}参数`}>
    <p className="scene-hint">{item.description || '此能力使用当前场景的配置。'}</p>
    {schema.length ? <div className="capability-fields">{schema.map(field => {
      const current = values[field.key] ?? field.default
      const update = (next: unknown) => onChange({ ...values, [field.key]: next })
      return <div key={field.key}>
        <label className={field.kind === 'boolean' ? 'scene-check' : undefined}>{field.kind === 'boolean' ? <><input type="checkbox" checked={current === true} disabled={disabled} onChange={event => update(event.target.checked)}/><span>{field.label}</span></> : <>{field.label}{field.kind === 'select' ? <select value={String(current)} disabled={disabled} onChange={event => update(event.target.value)}>{!field.options?.some(option => option.value === current) && <option value={String(current)}>待选择</option>}{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.kind === 'text' ? <textarea rows={String(current).length > 80 ? 3 : 1} value={String(current)} disabled={disabled} onChange={event => update(event.target.value)}/> : field.kind === 'integer' ? <input type="number" value={String(current)} min={field.minimum ?? undefined} max={field.maximum ?? undefined} step={1} disabled={disabled} onChange={event => update(event.target.value === '' ? '' : Number(event.target.value))}/> : <span>此参数类型暂不支持编辑，现有值保持不变。</span>}</>}</label>
        {field.help_text && <details className="parameter-help"><summary>如何填写{field.label}</summary><p>{field.help_text}</p></details>}
      </div>
    })}</div> : <p className="scene-hint">此能力未声明独立场景参数；启用状态仍由上方开关控制。</p>}
    {error && <p className="workspace-error" role="alert">{error}</p>}
    {item.examples?.length ? <details className="parameter-help"><summary>使用示例</summary><ul>{item.examples.map(example => <li key={example}>{example}</li>)}</ul></details> : null}
    <p className="scene-hint">修改随本场景一起保存，不影响其他场景。</p>
  </div>
}
