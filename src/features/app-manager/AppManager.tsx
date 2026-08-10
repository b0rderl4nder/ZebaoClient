import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { AppInfo, AppStatus, JobInfo } from '../../api/types'
import {
  getCurrentAppStatus,
  getJobStatus,
  installApp,
  listAvailableApps,
  removeApp,
  startApp,
  stopCurrentApp,
} from '../../api/apps'
import { EXHIBITION_CONVERSATION_APP_PORT, getConnectedHost } from '../../api/client'

const SIMULATED_APPS: AppInfo[] = [
  {
    name: 'zebao_exhibition_conversation_app',
    source_kind: 'simulated',
    description: '展厅实时语音与文本对话应用，用于模拟 daemon 内部署的 7861 app。',
    extra: { cardData: { title: '泽宝展厅对话应用' } },
  },
  {
    name: 'zebao_eyes_server',
    source_kind: 'simulated',
    description: 'Orange Pi 眼睛显示服务，用于模拟表情与状态同步链路。',
    extra: { cardData: { title: '眼睛显示服务' } },
  },
]

function isRunning(status: AppStatus | null): boolean {
  return status?.state === 'starting' || status?.state === 'running'
}

function appTitle(app: AppInfo): string {
  const cardData = app.extra?.cardData
  if (cardData && typeof cardData === 'object' && 'title' in cardData && typeof cardData.title === 'string') {
    return cardData.title
  }
  return app.name
}

function appSourceId(app: AppInfo): string | null {
  const id = app.extra?.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

const FALLBACK_ENTRY_PORTS: Record<string, number> = {
  zebao_exhibition_conversation_app: EXHIBITION_CONVERSATION_APP_PORT,
  lzwc_robot_exhibition_conversation_app: EXHIBITION_CONVERSATION_APP_PORT,
}

function fallbackEntryPort(app: AppInfo | null | undefined): number | null {
  const name = app?.name || ''
  return FALLBACK_ENTRY_PORTS[name] ?? null
}

function uniqueApps(apps: AppInfo[]): AppInfo[] {
  const seen = new Set<string>()
  return apps.filter(app => {
    const key = appSourceId(app) ?? app.name
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function appEntryUrl(app: AppInfo): string | null {
  const rawUrl = app.extra?.custom_app_url
  const fallbackPort = fallbackEntryPort(app)
  if ((typeof rawUrl !== 'string' || rawUrl.length === 0) && fallbackPort) {
    return `http://${getConnectedHost()}:${fallbackPort}/`
  }
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return null
  try {
    const url = new URL(rawUrl)
    if (url.hostname === '0.0.0.0' || url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      url.hostname = getConnectedHost()
    }
    return url.toString()
  } catch {
    return null
  }
}

export default function AppManager({ simulated = false }: { simulated?: boolean }) {
  const [apps, setApps] = useState<AppInfo[]>([])
  const [installed, setInstalled] = useState<AppInfo[]>([])
  const [current, setCurrent] = useState<AppStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogLoaded, setCatalogLoaded] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobInfo, setJobInfo] = useState<JobInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadInstalled = async () => {
    setError(null)
    if (simulated) {
      setApps(SIMULATED_APPS)
      setInstalled(SIMULATED_APPS)
      setCurrent({ info: SIMULATED_APPS[0], state: 'running' })
      setLoading(false)
      return
    }
    try {
      const [installedApps, currentStatus] = await Promise.all([
        listAvailableApps('installed'),
        getCurrentAppStatus(),
      ])
      setInstalled(installedApps)
      setCurrent(currentStatus)
    } catch (loadError) {
      console.warn('Failed to load apps', loadError)
      setError(loadError instanceof Error ? loadError.message : '读取应用列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadInstalled()
  }, [simulated])

  useEffect(() => {
    if (simulated) return
    if (!jobId) return
    const interval = setInterval(async () => {
      try {
        const info = await getJobStatus(jobId)
        setJobInfo(info)
        if (info.status === 'completed' || info.status === 'failed') {
          setJobId(null)
          void loadInstalled()
        }
      } catch (pollError) {
        console.warn('Failed to poll app job', pollError)
      }
    }, 700)
    return () => clearInterval(interval)
  }, [jobId, simulated])

  const installedApps = useMemo(() => uniqueApps(installed), [installed])
  const installedNames = useMemo(() => new Set(installedApps.map(app => app.name)), [installedApps])
  const installedSourceIds = useMemo(() => new Set(installedApps.map(appSourceId).filter(Boolean) as string[]), [installedApps])
  const installableApps = useMemo(() => {
    const seenNames = new Set<string>()
    return uniqueApps(apps).filter(app => {
      const sourceId = appSourceId(app)
      if (installedNames.has(app.name)) return false
      if (sourceId && installedSourceIds.has(sourceId)) return false
      if (seenNames.has(app.name)) return false
      seenNames.add(app.name)
      return true
    })
  }, [apps, installedNames, installedSourceIds])
  const runningName = isRunning(current) ? current?.info.name : null
  const runningApp = runningName ? installedApps.find(app => app.name === runningName) ?? current?.info ?? null : null
  const runningEntryUrl = runningApp ? appEntryUrl(runningApp) : null

  const loadInstallableApps = async () => {
    setError(null)
    if (simulated) {
      setApps(SIMULATED_APPS)
      setCatalogLoaded(true)
      return
    }
    setCatalogLoading(true)
    try {
      setApps(await listAvailableApps())
      setCatalogLoaded(true)
    } catch (catalogError) {
      console.warn('Failed to load app catalog', catalogError)
      setError(catalogError instanceof Error ? catalogError.message : '获取可安装应用失败')
    } finally {
      setCatalogLoading(false)
    }
  }

  const handleStart = async (name: string) => {
    setError(null)
    if (simulated) {
      const app = installed.find(item => item.name === name) ?? apps.find(item => item.name === name)
      if (app) setCurrent({ info: app, state: 'running' })
      return
    }
    try {
      setCurrent(await startApp(name))
      setTimeout(() => void loadInstalled(), 1000)
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : '启动应用失败')
    }
  }

  const handleStop = async () => {
    setError(null)
    if (simulated) {
      setCurrent(null)
      return
    }
    try {
      await stopCurrentApp()
      await loadInstalled()
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : '停止应用失败')
    }
  }

  return (
    <div className="app-shell min-h-screen animate-fade-in">
      <nav className="glass-nav sticky top-0 z-50">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-10">
          <div className="flex min-w-0 items-center gap-4">
            <Link to="/dashboard" className="rounded-full px-3 py-2 text-sm font-medium text-white/48 transition hover:bg-white/10 hover:text-white">返回</Link>
            <h1 className="truncate text-base font-semibold tracking-normal text-white">应用管理</h1>
          </div>
          {isRunning(current) && (
            <div className="flex shrink-0 items-center gap-2">
              {runningEntryUrl && (
                <a href={runningEntryUrl} target="_blank" rel="noreferrer" className="rounded-full border border-emerald-300/[0.22] bg-emerald-400/[0.14] px-4 py-2 text-xs font-semibold text-emerald-50 shadow-[0_10px_26px_rgba(16,185,129,0.1)] transition hover:border-emerald-200/35 hover:bg-emerald-400/[0.22] hover:text-white">
                  打开入口
                </a>
              )}
              <button onClick={handleStop} className="rounded-full border border-rose-200/24 bg-rose-300/10 px-4 py-2 text-xs font-semibold text-rose-50 transition hover:bg-rose-300/16">
                停止 {current?.info.name}
              </button>
            </div>
          )}
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10 lg:px-10">
        <section className="glass-panel mb-5 rounded-[2rem] p-6 sm:p-8">
          <div className="relative z-10 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-sky-100/50">App Store</p>
              <h2 className="text-3xl font-semibold tracking-normal text-white sm:text-4xl">机器人应用</h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-white/52">{simulated ? '当前是客户端模拟模式，应用状态只在本地界面中变化。' : '默认只读取已安装应用；需要安装新应用时再获取可安装列表。'}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:min-w-72">
              <MiniStat label="可安装" value={String(installableApps.length)} />
              <MiniStat label="已安装" value={String(installedApps.length)} />
            </div>
          </div>
        </section>

        {error && (
          <div className="glass-soft mb-5 rounded-[1.5rem] border-rose-200/20 p-5 text-sm text-rose-100/80">{error}</div>
        )}

        {jobId && (
          <div className="glass-soft mb-5 flex items-start gap-4 rounded-[1.5rem] p-5">
            {(!jobInfo || jobInfo.status === 'running' || jobInfo.status === 'pending') && <span className="mt-0.5 h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-sky-200/20 border-t-sky-100" />}
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white/82">
                {!jobInfo ? '任务已提交' : jobInfo.status === 'completed' ? '任务完成' : jobInfo.status === 'failed' ? '任务失败' : '处理中'}
              </div>
              {jobInfo?.logs && <div className="mt-1 truncate text-xs text-white/38">{jobInfo.logs.slice(-1)[0]}</div>}
              {jobInfo?.error && <div className="mt-1 text-xs text-rose-100/72">{jobInfo.error}</div>}
            </div>
          </div>
        )}

        {loading ? (
          <EmptyState title="加载中" desc="正在读取 daemon 应用列表。" />
        ) : installedApps.length === 0 && installableApps.length === 0 ? (
          <EmptyState title="暂无可用应用" desc="请确认 daemon 已启动，apps_venv 中已安装 conversation app，或 Hugging Face 应用源可访问。" />
        ) : (
          <div className="space-y-8">
            <AppSection title="已安装" desc="这些应用已经在 daemon 的 apps_venv 中，可以直接启动或卸载。">
              {installedApps.length === 0 ? (
                <CompactEmpty text="暂无已安装应用" />
              ) : (
                installedApps.map(app => (
                  <AppCard
                    key={`installed:${app.name}`}
                    app={app}
                    installed
                    running={runningName === app.name}
                    blocked={Boolean(runningName && runningName !== app.name)}
                    onStart={() => void handleStart(app.name)}
                    entryUrl={appEntryUrl(app)}
                    onInstall={() => undefined}
                    onRemove={() => {
                      if (confirm(`卸载 "${app.name}"？`)) {
                        if (simulated) {
                          setInstalled(previous => previous.filter(item => item.name !== app.name))
                          if (current?.info.name === app.name) setCurrent(null)
                        } else {
                          removeApp(app.name).then(result => { setJobId(result.job_id); setJobInfo(null) }).catch(removeError => setError(removeError instanceof Error ? removeError.message : '卸载失败'))
                        }
                      }
                    }}
                  />
                ))
              )}
            </AppSection>

            <AppSection
              title="可安装"
              desc={catalogLoaded ? '这里隐藏了已安装和同名重复的公共目录条目。' : '点击按钮后才会拉取 HuggingFace 应用目录。'}
              action={(
                <button disabled={catalogLoading} onClick={() => void loadInstallableApps()} className="liquid-button rounded-xl px-4 py-2 text-xs font-semibold text-white disabled:opacity-45">
                  {catalogLoading ? '获取中' : catalogLoaded ? '刷新可安装应用' : '获取可安装应用'}
                </button>
              )}
            >
              {!catalogLoaded ? (
                <CompactEmpty text="尚未获取可安装应用列表" />
              ) : installableApps.length === 0 ? (
                <CompactEmpty text="没有新的可安装应用" />
              ) : (
                installableApps.map(app => (
                  <AppCard
                    key={`${app.source_kind}:${appSourceId(app) ?? app.name}`}
                    app={app}
                    installed={false}
                    running={false}
                    blocked={false}
                    entryUrl={null}
                    onStart={() => undefined}
                    onRemove={() => undefined}
                    onInstall={() => {
                      if (simulated) {
                        setInstalled(previous => [...previous, app])
                      } else {
                        installApp(app).then(result => { setJobId(result.job_id); setJobInfo(null) }).catch(installError => setError(installError instanceof Error ? installError.message : '安装失败'))
                      }
                    }}
                  />
                ))
              )}
            </AppSection>
          </div>
        )}
      </main>
    </div>
  )
}

function AppSection({ title, desc, action, children }: { title: string; desc: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold tracking-normal text-white/86">{title}</h3>
          <p className="mt-1 text-sm text-white/42">{desc}</p>
        </div>
        {action}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  )
}

function AppCard({
  app,
  installed,
  running,
  blocked,
  entryUrl,
  onStart,
  onInstall,
  onRemove,
}: {
  app: AppInfo
  installed: boolean
  running: boolean
  blocked: boolean
  entryUrl: string | null
  onStart: () => void
  onInstall: () => void
  onRemove: () => void
}) {
  return (
    <article className="glass-soft rounded-[1.6rem] p-5 transition hover:border-white/24 hover:bg-white/[0.11]">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold tracking-normal text-white/90">{appTitle(app)}</h3>
          <p className="mt-1 truncate text-xs text-white/28">{app.name}</p>
          <p className="mt-2 line-clamp-2 min-h-[2.75rem] text-sm leading-6 text-white/44">{app.description || '暂无描述'}</p>
        </div>
        {running ? (
          <span className="shrink-0 rounded-full border border-emerald-200/24 bg-emerald-300/10 px-3 py-1 text-xs font-semibold text-emerald-50">运行中</span>
        ) : installed ? (
          <span className="shrink-0 rounded-full border border-sky-200/18 bg-sky-300/10 px-3 py-1 text-xs font-semibold text-sky-50/78">已安装</span>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {installed ? (
          <>
            {running ? (
              <span className="inline-flex h-10 items-center rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 text-xs font-semibold text-white/46">
                已启动
              </span>
            ) : (
              <button disabled={blocked} onClick={onStart} className="liquid-button h-10 rounded-xl px-4 text-xs font-semibold text-white disabled:opacity-35">
                启动
              </button>
            )}
            {entryUrl && (
              <a href={entryUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-xl border border-emerald-300/[0.22] bg-emerald-400/[0.14] px-5 text-xs font-semibold text-emerald-50 shadow-[0_10px_26px_rgba(16,185,129,0.12)] transition hover:border-emerald-200/35 hover:bg-emerald-400/[0.22] hover:text-white">
                打开入口
              </a>
            )}
            <button onClick={onRemove} className="h-10 rounded-xl px-4 text-xs font-semibold text-white/34 transition hover:bg-rose-300/10 hover:text-rose-50">
              卸载
            </button>
          </>
        ) : (
          <button onClick={onInstall} className="liquid-button h-10 rounded-xl px-4 text-xs font-semibold text-white">
            安装
          </button>
        )}
      </div>
    </article>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/12 bg-white/[0.07] p-4">
      <div className="text-xs text-white/38">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white/86">{value}</div>
    </div>
  )
}

function CompactEmpty({ text }: { text: string }) {
  return <div className="glass-soft rounded-[1.6rem] p-5 text-sm text-white/40">{text}</div>
}

function EmptyState({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="glass-soft rounded-[2rem] px-6 py-20 text-center">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.07] text-sm font-semibold text-white/52">APP</div>
      <p className="text-lg font-semibold text-white/78">{title}</p>
      <p className="mt-2 text-sm text-white/38">{desc}</p>
    </div>
  )
}
