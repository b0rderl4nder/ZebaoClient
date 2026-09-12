import { useEffect, useState } from 'react'
import { networkRequest } from '../../api/networkSettings'
import { SettingsPage, ReadFailure } from './SettingsControls'

interface Disk { free_bytes: number; target_gib: number; hard_floor_gib: number }
export default function StorageSettings({ simulated = false }: { simulated?: boolean }) {
  const [disk, setDisk] = useState<Disk | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    if (!simulated) { setBusy(true); void networkRequest<{ disk: Disk }>('demo-readiness', { signal: controller.signal }).then(data => { if (controller.signal.aborted) return; if (!data.disk || !Number.isFinite(data.disk.free_bytes) || !Number.isFinite(data.disk.target_gib) || !Number.isFinite(data.disk.hard_floor_gib)) throw new Error('磁盘状态尚未就绪。'); setDisk(data.disk); setError('') }).catch(reason => { if (!controller.signal.aborted) setError(reason.message) }).finally(() => { if (!controller.signal.aborted) setBusy(false) }) }
    return () => controller.abort()
  }, [simulated, revision])
  const free = disk ? disk.free_bytes / 1024 ** 3 : null
  return <SettingsPage title="存储" simulated={simulated}>{!simulated && <section className="settings-section" aria-label="磁盘空间">{disk && free !== null ? <><div className="settings-current"><div><span>可用空间</span><h2>{free.toFixed(2)} GiB</h2></div><strong>{free < disk.hard_floor_gib ? '空间不足' : free < disk.target_gib ? '低于建议余量' : '余量充足'}</strong></div><dl className="settings-facts"><div><dt>建议保留</dt><dd>{disk.target_gib} GiB</dd></div><div><dt>最低余量</dt><dd>{disk.hard_floor_gib} GiB</dd></div></dl><button disabled={busy} onClick={() => setRevision(value => value + 1)}>刷新空间状态</button>{error && <p role="alert">{error}</p>}<p className="settings-footnote">只读检查，不自动清理人员、录音、运行配置或回滚版本。</p></> : <ReadFailure busy={busy} error={error} refresh={() => setRevision(value => value + 1)}/>}</section>}</SettingsPage>
}
