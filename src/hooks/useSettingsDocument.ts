import { useCallback, useEffect, useRef, useState } from 'react'

export interface SettingsDocument<C> { values: C }
export interface SettingsResource<C, D extends SettingsDocument<C>> {
  read: (signal?: AbortSignal) => Promise<D>
  write: (next: C, previous: C) => Promise<unknown>
  validate?: (next: C, document: D) => string
  reset?: () => Promise<unknown>
  validateReset?: (document: D) => string
}
const same = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const left = Object.keys(a), right = Object.keys(b)
  return left.length === right.length && left.every(key => Object.prototype.hasOwnProperty.call(b, key) && same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
}
const message = (error: unknown) => error instanceof Error ? error.message : '请求失败，请重试。'

/** One draft and one confirmed value; entering a form never writes to the robot. */
export function useSettingsDocument<C, D extends SettingsDocument<C>>(resource: SettingsResource<C, D>, simulated: boolean) {
  const [document, setDocument] = useState<D | null>(null)
  const [draft, setDraft] = useState<C | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const mounted = useRef(false)
  const locked = useRef(false)
  const dirty = Boolean(document && draft && !same(document.values, draft))
  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    if (!simulated) {
      setBusy(true)
      void resource.read(controller.signal).then(result => {
        if (!controller.signal.aborted) { setDocument(result); setDraft(result.values); setError('') }
      }).catch(reason => { if (!controller.signal.aborted) setError(message(reason)) })
        .finally(() => { if (!controller.signal.aborted) setBusy(false) })
    }
    return () => { mounted.current = false; controller.abort() }
  }, [resource, simulated, revision])
  useEffect(() => {
    if (!dirty && !busy) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const leave = (event: MouseEvent) => {
      if (!(event.target as Element)?.closest?.('a, .client-shell__sidebar > button')) return
      if (locked.current || (dirty && !window.confirm('还有未保存的修改，确定离开？'))) { event.preventDefault(); event.stopImmediatePropagation() }
    }
    window.addEventListener('beforeunload', warn); window.document.addEventListener('click', leave, true)
    return () => { window.removeEventListener('beforeunload', warn); window.document.removeEventListener('click', leave, true) }
  }, [dirty, busy])
  const refresh = useCallback(() => {
    if (locked.current || (dirty && !window.confirm('放弃未保存的修改并重新读取？'))) return
    setNotice(''); setError(''); setRevision(value => value + 1)
  }, [dirty])
  const apply = async (reset = false) => {
    if (locked.current || busy || simulated || !document || !draft) return
    const validation = reset ? '' : resource.validate?.(draft, document)
    if (validation) { setError(validation); return }
    if (reset && (!resource.reset || !window.confirm('恢复设备推荐值？当前自定义转向参数将被替换。'))) return
    locked.current = true; setBusy(true); setError(''); setNotice('')
    let submitted = false
    try {
      const current = await resource.read()
      if (!mounted.current) return
      if (!same(current.values, document.values)) throw new Error('设置已在其他页面修改，请重新读取后再保存。')
      const currentValidation = reset ? '' : resource.validate?.(draft, current)
      if (currentValidation) throw new Error(currentValidation)
      submitted = true
      if (reset) await resource.reset!()
      else await resource.write(draft, document.values)
      if (!mounted.current) return
      const confirmed = await resource.read()
      const resetError = reset ? resource.validateReset?.(confirmed) : ''
      if (resetError) throw new Error(resetError)
      if (!reset && !same(confirmed.values, draft)) throw new Error('保存后的设备值与请求不一致，请重新读取后检查。')
      if (mounted.current) { setDocument(confirmed); setDraft(confirmed.values); setNotice(reset ? '推荐值已恢复并回读。' : '已保存并回读。') }
    } catch (reason) {
      if (mounted.current) setError(submitted ? `${message(reason)} 请求可能已生效，请重新读取确认，勿重复提交。` : message(reason))
    } finally { locked.current = false; if (mounted.current) setBusy(false) }
  }
  return { document, draft, setDraft, dirty, busy, error, notice, refresh, save: () => apply(), reset: () => apply(true) }
}
