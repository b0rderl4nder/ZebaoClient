import { useEffect } from 'react'
export function useFormNavigationGuard(busy: boolean, dirty: boolean) {
  useEffect(() => {
    if (!busy && !dirty) return
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const click = (event: MouseEvent) => {
      if (!(event.target as Element)?.closest?.('a, .client-shell__sidebar > button')) return
      if (busy || !window.confirm('有未保存的配置，确定离开？')) { event.preventDefault(); event.stopImmediatePropagation() }
    }
    window.addEventListener('beforeunload', unload); document.addEventListener('click', click, true)
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', click, true) }
  }, [busy, dirty])
}
