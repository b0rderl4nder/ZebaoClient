import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import CapabilityParameters, { parameterError } from '../features/scenes/CapabilityParameters'
import type { CapabilityOption } from '../api/sceneConfig'

const item: CapabilityOption = { id: 'new-capability', name: '后端新增能力', scope: 'scene', description: '后端功能说明', settings_schema: [
  { key: 'count', label: '数量', kind: 'integer', default: 2, minimum: 1, maximum: 3 },
  { key: 'enabled', label: '主动执行', kind: 'boolean', default: false },
  { key: 'style', label: '风格', kind: 'select', default: 'basic', options: [{ value: 'basic', label: '简洁' }, { value: 'rich', label: '详细' }] },
  { key: 'city', label: '城市', kind: 'text', default: '', help_text: '直接填写所在城市。' },
] }
describe('场景能力参数', () => {
  it('由后端 schema 生成可视化编辑器，修改保留未编辑字段', () => {
    const changed = vi.fn()
    render(<CapabilityParameters item={item} value={{ city: '佛山', preserved: 'retain' }} disabled={false} onChange={changed}/>)
    fireEvent.change(screen.getByLabelText('城市'), { target: { value: '广州' } })
    expect(changed).toHaveBeenLastCalledWith({ city: '广州', preserved: 'retain' })
    expect(screen.getByLabelText('数量')).toHaveValue(2)
    expect(screen.getByLabelText('主动执行')).not.toBeChecked()
    expect(screen.getByLabelText('风格')).toHaveValue('basic')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(parameterError(item.settings_schema!, { count: 30 })).toContain('数量')
    expect(parameterError(item.settings_schema!, { count: '' })).toContain('数量')
    expect(parameterError(item.settings_schema!, { style: 'unknown' })).toContain('风格')
    expect(parameterError(item.settings_schema!, { count: 3, preserved: 'retain' })).toBe('')
  })
  it('未挂载不可编辑，不声明参数时不伪造配置', () => {
    const view = render(<CapabilityParameters item={item} value={{}} disabled onChange={vi.fn()}/>)
    expect(screen.getByLabelText('城市')).toBeDisabled()
    view.rerender(<CapabilityParameters item={{ ...item, settings_schema: [] }} value={{}} disabled={false} onChange={vi.fn()}/>)
    expect(screen.getByText(/未声明独立场景参数/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
