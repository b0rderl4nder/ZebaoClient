import { useEffect, useRef, useState } from 'react'
import { peopleRequest, readPerson, type Person } from '../../api/people'
import { useCredentialOperation } from './useCredentialOperation'

interface Recording { pcm: string; rate: number; promptId: number; originalCount: number }
interface Prompt { id: number; text: string }
export default function VoiceCredential({ person, onComplete, onCancel, onBusy }: { person: Person; onComplete: () => void; onCancel: () => void; onBusy: (busy: boolean) => void }) {
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [retained, setRetained] = useState(false)
  const recording = useRef<Recording | null>(null)
  const submitted = useRef(false)
  const locked = useRef(false)
  const mounted = useRef(true)
  const [revision, setRevision] = useState(0)
  useCredentialOperation(busy, retained)
  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    void peopleRequest<{ prompts: Prompt[] }>('voiceprints/enrollment-prompts', { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return
      if (!Array.isArray(data.prompts) || !data.prompts.length) throw new Error('录入文字暂未就绪。')
      setPrompts(data.prompts); setError('')
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message) })
    return () => { mounted.current = false; controller.abort(); recording.current = null }
  }, [revision])
  const prompt = prompts.length ? prompts[person.voiceprint.sample_count % prompts.length] : null
  const submit = async () => {
    const audio = recording.current
    if (!audio || !mounted.current) return
    // After an uncertain response, read first to avoid registering twice.
    const current = await readPerson(person.person_id)
    if (!mounted.current) return
    if (submitted.current && current.person.voiceprint.sample_count > audio.originalCount) {
      recording.current = null; setRetained(false); setNotice('当前句已保存并回读。'); onComplete(); return
    }
    if (current.person.display_name !== person.display_name || current.person.voiceprint.sample_count !== audio.originalCount) throw new Error('人员或样本已在其他页面修改，请关闭录入后重新读取。')
    setNotice('正在校验并保存…'); submitted.current = true
    await peopleRequest('voiceprints/register', { method: 'POST', body: JSON.stringify({ person_name: person.display_name, pcm16_base64: audio.pcm, sample_rate: audio.rate, prompt_id: audio.promptId }) }, 45000)
    if (!mounted.current) return
    const confirmed = await readPerson(person.person_id)
    if (confirmed.person.voiceprint.sample_count <= audio.originalCount) throw new Error('样本数量尚未更新，未确认保存成功。')
    recording.current = null; setRetained(false); setNotice('当前句已保存并回读，可以继续下一句。'); onComplete()
  }
  const run = async (retry = false) => {
    if (locked.current || !prompt) return
    locked.current = true; setBusy(true); onBusy(true); setError('')
    try {
      if (!retry) {
        setNotice('正在录音，请对着机器人朗读，约 6 秒。'); submitted.current = false
        const data = await peopleRequest<{ pcm16_base64?: string; sample_rate?: number }>('debug/mic_capture_asr?seconds=6&include_pcm=1&processed=1&transcribe=0&suppress_handler=1&purpose=voiceprint_enrollment', { method: 'POST' }, 25000)
        if (!mounted.current) return
        if (!data.pcm16_base64 || !Number.isFinite(data.sample_rate)) throw new Error('机器人没有返回有效录音，请检查麦克风。')
        recording.current = { pcm: data.pcm16_base64, rate: data.sample_rate!, promptId: prompt.id, originalCount: person.voiceprint.sample_count }; setRetained(true)
      }
      await submit()
    } catch (reason) { if (mounted.current) { setNotice(''); setError(`${reason instanceof Error ? reason.message : '录入未完成。'}${recording.current ? ' 录音仍在本页内存中，无需重录。' : ''}`) } }
    finally { locked.current = false; if (mounted.current) setBusy(false); onBusy(false) }
  }
  return <section className="people-import" aria-label="声纹录入"><h2>录入声纹</h2><p>使用机器人麦克风。录完自动校验与保存，不需要下载上传。</p><blockquote>{prompt?.text || '正在读取朗读文字…'}</blockquote><p>已有 {person.voiceprint.sample_count} 段样本</p>{notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}<div className="settings-actions"><button disabled={busy} onClick={() => { if (!retained || window.confirm('关闭并丢弃尚未保存的录音？')) onCancel() }}>关闭</button>{!prompts.length ? <button onClick={() => setRevision(value => value + 1)}>重试读取</button> : <button className="workspace-primary" disabled={busy} onClick={() => void run(retained)}>{busy ? '处理中' : retained ? '重试校验与保存' : '录入当前句'}</button>}</div></section>
}
