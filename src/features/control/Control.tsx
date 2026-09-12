import { Navigate, useSearchParams } from 'react-router-dom'
import MotionControl from '../motion-control/MotionControl'
import PoseControl from '../pose-control/PoseControl'

type ControlTab = 'motions' | 'pose' | 'interaction'

export default function Control({ simulated = false }: { simulated?: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = searchParams.get('tab')
  const tab: ControlTab = rawTab === 'pose' || rawTab === 'interaction' ? rawTab : 'motions'
  if (tab === 'interaction') return <Navigate to="/dashboard/foundation/interaction" replace/>

  const selectTab = (next: ControlTab) => {
    setSearchParams(next === 'motions' ? {} : { tab: next }, { replace: true })
  }

  return (
    <div className="control-page">
      <header className="product-header">
        <div><h1>控制</h1><p>动作与姿态统一管理</p></div>
        <div className="control-tabs" role="tablist" aria-label="控制类型">
          <button type="button" role="tab" aria-selected={tab === 'motions'} className={tab === 'motions' ? 'is-active' : ''} onClick={() => selectTab('motions')}>动作</button>
          <button type="button" role="tab" aria-selected={tab === 'pose'} className={tab === 'pose' ? 'is-active' : ''} onClick={() => selectTab('pose')}>姿态</button>
        </div>
      </header>
      <div className="control-page__body">
        {tab === 'motions' ? <MotionControl simulated={simulated} /> : null}
        {tab === 'pose' ? <PoseControl simulated={simulated} /> : null}
      </div>
    </div>
  )
}
