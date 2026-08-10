import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { appUrl, EXHIBITION_CONVERSATION_APP_PORT } from '../../api/client'

interface Message { role: 'user' | 'assistant'; text: string; time: Date }

interface ConversationStatus {
  running?: boolean
  active?: boolean
  status?: string
  messages?: unknown[]
}

function isConversationReady(status: ConversationStatus): boolean {
  if (typeof status.running === 'boolean') return status.running
  if (typeof status.active === 'boolean') return status.active
  return true
}

export default function Conversation({ simulated = false }: { simulated?: boolean }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [connected, setConnected] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (simulated) {
      setConnected(true)
      setError(null)
      return
    }
    const poll = async () => {
      try {
        const response = await fetch(appUrl(EXHIBITION_CONVERSATION_APP_PORT, '/conversation/status'))
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        setConnected(isConversationReady(await response.json()))
        setError(null)
      } catch (statusError) {
        setConnected(false)
        setError(statusError instanceof Error ? statusError.message : '无法连接 conversation app')
      }
    }
    void poll()
    const interval = setInterval(poll, 5000)
    return () => clearInterval(interval)
  }, [simulated])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    const userMessage: Message = { role: 'user', text, time: new Date() }
    setMessages(previous => [...previous, userMessage])
    setInput('')
    setSending(true)
    setError(null)
    if (simulated) {
      window.setTimeout(() => {
        setMessages(previous => [...previous, {
          role: 'assistant',
          text: `模拟回复：我收到了“${text}”。真实部署时这条消息会发送给 conversation app。`,
          time: new Date(),
        }])
        setSending(false)
      }, 350)
      return
    }
    try {
      const response = await fetch(appUrl(EXHIBITION_CONVERSATION_APP_PORT, '/conversation/text'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
      setMessages(previous => [...previous, {
        role: 'assistant',
        text: data.text || data.response || '已收到。',
        time: new Date(),
      }])
      setConnected(true)
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : '发送失败'
      setError(message)
      setMessages(previous => [...previous, {
        role: 'assistant',
        text: `发送失败：${message}。请确认展厅 conversation app 已通过 daemon 启动，并监听 ${EXHIBITION_CONVERSATION_APP_PORT} 端口。`,
        time: new Date(),
      }])
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="app-shell flex min-h-screen flex-col animate-fade-in">
      <nav className="glass-nav sticky top-0 z-50 shrink-0">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6 lg:px-10">
          <div className="flex min-w-0 items-center gap-4">
            <Link to="/dashboard" className="rounded-full px-3 py-2 text-sm font-medium text-white/48 transition hover:bg-white/10 hover:text-white">返回</Link>
            <h1 className="truncate text-base font-semibold tracking-normal text-white">文字对话</h1>
          </div>
          <span className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-semibold ${
            connected
              ? 'border-emerald-200/24 bg-emerald-300/10 text-emerald-50'
              : 'border-white/12 bg-white/[0.06] text-white/48'
          }`}>
            <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.75)]' : 'bg-white/24'}`} />
            {connected ? '已连接' : '等待服务'}
          </span>
        </div>
      </nav>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-10 lg:px-10">
        <div className="mx-auto flex min-h-full max-w-5xl flex-col">
          <section className="glass-panel mb-5 rounded-[2rem] p-6 sm:p-8">
            <div className="relative z-10">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-sky-100/50">Conversation</p>
              <h2 className="text-3xl font-semibold tracking-normal text-white sm:text-4xl">和 Zebao 对话</h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-white/52">{simulated ? '当前是客户端模拟模式，消息会在本地生成模拟回复。' : '这个入口用于验证 client 到 daemon 管理应用，再到 conversation app 的文本对话链路。'}</p>
              {error && <p className="mt-3 text-sm text-rose-100/70">当前状态：{error}</p>}
            </div>
          </section>

          <section className="glass-soft flex min-h-[420px] flex-1 flex-col rounded-[2rem] p-4 sm:p-5">
            <div className="flex-1 space-y-4 overflow-y-auto p-1 sm:p-2">
              {messages.length === 0 && (
                <div className="flex min-h-[320px] flex-col items-center justify-center text-center">
                  <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.07] text-sm font-semibold text-white/52">CHAT</div>
                  <p className="text-lg font-semibold text-white/72">开始对话</p>
                  <p className="mt-2 text-sm text-white/36">{simulated ? '输入一句话，查看本地模拟回复。' : '需要先在应用管理中启动 conversation app。'}</p>
                </div>
              )}
              {messages.map((message, index) => (
                <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[86%] rounded-[1.35rem] border px-4 py-3 text-sm leading-7 shadow-[0_12px_32px_rgba(0,0,0,0.16)] sm:max-w-[72%] ${
                    message.role === 'user'
                      ? 'rounded-br-md border-sky-200/24 bg-sky-300/14 text-white'
                      : 'rounded-bl-md border-white/12 bg-white/[0.08] text-white/72'
                  }`}>
                    {message.text}
                    <div className={`mt-2 text-xs ${message.role === 'user' ? 'text-sky-50/42' : 'text-white/30'}`}>
                      {message.time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          </section>
        </div>
      </div>

      <div className="glass-nav shrink-0 border-t border-white/10">
        <form onSubmit={event => { event.preventDefault(); void send() }} className="mx-auto flex max-w-5xl gap-3 px-4 py-5 sm:px-6 lg:px-10">
          <input
            type="text"
            value={input}
            onChange={event => setInput(event.target.value)}
            placeholder="输入消息..."
            className="liquid-input h-16 min-w-0 flex-1 rounded-2xl px-6 text-base text-white placeholder:text-white/34"
          />
          <button disabled={sending || !input.trim()} type="submit" className="liquid-button h-16 rounded-2xl px-7 text-base font-semibold text-white disabled:opacity-40 sm:px-9">
            {sending ? '发送中' : '发送'}
          </button>
        </form>
      </div>
    </div>
  )
}
