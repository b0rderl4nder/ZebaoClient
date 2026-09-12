import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { NumberField } from '../../api/deviceSettings'
import './settings.css'

export function SettingsPage({ title, children, simulated }: { title: string; children: ReactNode; simulated: boolean }) {
  return <div className="workspace-page native-settings"><header className="product-header"><div><Link className="workspace-back" to="/dashboard/foundation">← 基础系统</Link><h1>{title}</h1></div></header><div className="workspace-body">{simulated ? <p className="workspace-empty">连接机器人后配置，不使用预览值。</p> : children}</div></div>
}
export function SaveControls({ busy, dirty, error, notice, save, refresh }: { busy: boolean; dirty: boolean; error: string; notice: string; save: () => Promise<void>; refresh: () => void }) {
  return <><div className="settings-actions"><span>{busy ? '正在处理' : dirty ? '尚未保存' : notice || '已读取设备值'}</span><button type="button" disabled={busy} onClick={refresh}>重新读取</button><button className="workspace-primary" type="submit" disabled={busy || !dirty} onClick={() => void save()}>保存</button></div>{error && <p className="workspace-error" role="alert">{error}</p>}</>
}
export function SettingToggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (next: boolean) => void }) {
  return <label className="settings-toggle"><input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)}/>{label}</label>
}
export function NumberControl({ field, value, disabled, onChange, unit = '' }: { field: Pick<NumberField, 'label' | 'minimum' | 'maximum' | 'step'>; value: number; disabled: boolean; onChange: (next: number) => void; unit?: string }) {
  return <div className="settings-number"><input type="range" aria-label={`${field.label}滑杆`} min={field.minimum} max={field.maximum} step={field.step} value={Number.isFinite(value) ? value : field.minimum} disabled={disabled} onChange={event => onChange(event.target.valueAsNumber)}/><label><span className="sr-only">{field.label}</span><input type="number" aria-label={field.label} min={field.minimum} max={field.maximum} step={field.step} value={Number.isFinite(value) ? value : ''} disabled={disabled} onChange={event => onChange(event.target.valueAsNumber)}/><span aria-hidden="true">{unit}</span></label></div>
}
export function ReadFailure({ busy, error, refresh }: { busy: boolean; error: string; refresh: () => void }) {
  return error ? <div className="settings-notice"><p role="alert">{error}</p><button disabled={busy} onClick={refresh}>重试读取</button></div> : <p role="status">正在读取设备设置</p>
}
