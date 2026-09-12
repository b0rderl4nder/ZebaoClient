import { useRef, useState } from 'react'
import { peopleRequest } from '../../api/people'
import { useCredentialOperation } from './useCredentialOperation'

export default function VoiceTest({ onBusy }: { onBusy?: (busy: boolean) => void }) {
  const [busy, setBusy] = useState(false), [result, setResult] = useState(''), [error, setError] = useState('')
  const locked = useRef(false)
  useCredentialOperation(busy)
  const run = async () => {
    if (locked.current) return
    locked.current = true; setBusy(true); onBusy?.(true); setError(''); setResult('请对机器人自然说一句话，约 6 秒。')
    try {
      const payload = await peopleRequest<Record<string, unknown>>('debug/mic_capture_asr?seconds=6&include_pcm=0&processed=1&transcribe=1&suppress_handler=1&purpose=voiceprint_test', { method: 'POST' }, 25000)
      const identity = payload.voiceprint && typeof payload.voiceprint === 'object' ? payload.voiceprint as Record<string, unknown> : payload
      const name = identity.person_name || identity.final_person_name
      setResult((identity.matched === true || identity.identity_ready === true) && typeof name === 'string' && name !== 'unknown' ? `已确认身份：${name}` : '本次未确认身份。不会新增或修改声纹。')
    } catch (reason) { setResult(''); setError(reason instanceof Error ? reason.message : '测试未完成。') }
    finally { locked.current = false; setBusy(false); onBusy?.(false) }
  }
  return <details className="people-privacy"><summary>实时识别测试</summary><p>机器人麦克风采集，不保存测试录音、不修改模板。</p><button disabled={busy} onClick={() => void run()}>{busy ? '正在识别' : '开始测试'}</button>{result && <p role="status">{result}</p>}{error && <p role="alert">{error}</p>}</details>
}
