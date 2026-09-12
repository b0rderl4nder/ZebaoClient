import { useState } from 'react'
import type { Preferences } from '../../api/people'

export default function PreferencesEditor({ title, values, disabled, onChange }: { title: string; values: Preferences; disabled: boolean; onChange: (value: Preferences) => void }) {
  const [raw, setRaw] = useState(false)
  const [error, setError] = useState('')
  const change = (key: string, value: Preferences[string]) => onChange({ ...values, [key]: value })
  return <details className="people-preferences"><summary>{title} · {Object.keys(values).length} 项</summary><div className="settings-row"><span>最多 20 项</span><button type="button" onClick={() => setRaw(value => !value)}>{raw ? '可视化编辑' : '查看原始数据'}</button></div>{raw ? <pre aria-label={`${title}原始数据`}>{JSON.stringify(values, null, 2)}</pre> : <>
    {Object.entries(values).map(([key, value]) => <div className="preference-row" key={key}><strong>{key}</strong><select aria-label={`${title} ${key} 类型`} disabled={disabled} value={Array.isArray(value) ? 'list' : typeof value} onChange={event => change(key, event.target.value === 'number' ? 0 : event.target.value === 'boolean' ? false : event.target.value === 'list' ? [] : '')}><option value="string">文字</option><option value="number">数字</option><option value="boolean">开关</option><option value="list">列表</option></select>
      {Array.isArray(value) ? <textarea aria-label={`${title} ${key}`} value={value.join('\n')} disabled={disabled} rows={3} placeholder="每行一项" onChange={event => change(key, event.target.value.split('\n'))}/> : typeof value === 'boolean' ? <label className="settings-toggle"><input type="checkbox" aria-label={`${title} ${key}`} checked={value} disabled={disabled} onChange={event => change(key, event.target.checked)}/>启用</label> : <input aria-label={`${title} ${key}`} type={typeof value === 'number' ? 'number' : 'text'} value={typeof value === 'number' && !Number.isFinite(value) ? '' : value} maxLength={120} disabled={disabled} onChange={event => change(key, typeof value === 'number' ? event.target.valueAsNumber : event.target.value)}/>}
      <button type="button" disabled={disabled} aria-label={`删除${title} ${key}`} onClick={() => onChange(Object.fromEntries(Object.entries(values).filter(([name]) => name !== key)))}>删除</button></div>)}
    <form className="preference-add" onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const key = String(new FormData(form).get('name') || '').trim(); if (!key || key in values) { setError('请填写未使用的偏好名称。'); return } if (Object.keys(values).length >= 20) return; setError(''); onChange({ ...values, [key]: '' }); form.reset() }}><label><span className="sr-only">{title}新项目名称</span><input name="name" maxLength={40} placeholder="偏好名称，如风格" disabled={disabled}/></label><button disabled={disabled || Object.keys(values).length >= 20}>添加偏好</button></form>
    {error && <p role="alert">{error}</p>}
  </>}</details>
}
