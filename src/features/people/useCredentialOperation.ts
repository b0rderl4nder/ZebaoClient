import { useEffect } from 'react'

// Do not abandon an in-flight privacy operation or silently lose retained audio.
export function useCredentialOperation(busy: boolean, retained = false) {
  useEffect(() => {
    if (!busy && !retained) return
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const leave = (event: MouseEvent) => {
      if (!(event.target as Element)?.closest?.('a, .client-shell__sidebar > button')) return
      if (busy || !window.confirm('离开会丢弃尚未保存的录音，确定离开？')) { event.preventDefault(); event.stopImmediatePropagation() }
    }
    window.addEventListener('beforeunload', unload); document.addEventListener('click', leave, true)
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', leave, true) }
  }, [busy, retained])
}
