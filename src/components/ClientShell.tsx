import { NavLink, Outlet } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/dashboard', label: '概览', mark: '01', end: true },
  { to: '/dashboard/control', label: '控制', mark: '02' },
  { to: '/dashboard/apps', label: '应用', mark: '03' },
  { to: '/dashboard/simulation', label: '仿真', mark: '04' },
] as const

export default function ClientShell({
  host,
  simulated,
  onSwitchDevice,
}: {
  host: string
  simulated: boolean
  onSwitchDevice: () => void
}) {
  return (
    <div className="client-shell">
      <aside className="client-shell__sidebar" aria-label="设备控制导航">
        <div className="client-shell__brand">
          <span aria-hidden="true">泽</span>
          <div><strong>泽宝</strong><small>{simulated ? '界面预览' : host || '设备控制'}</small></div>
        </div>
        <nav>
          {NAV_ITEMS.map(item => (
            <NavLink key={item.to} to={item.to} end={'end' in item ? item.end : false} className={({ isActive }) => isActive ? 'is-active' : ''}>
              <span aria-hidden="true">{item.mark}</span><span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <button type="button" onClick={onSwitchDevice}>切换设备</button>
      </aside>
      <main className="client-shell__content"><Outlet /></main>
      <nav className="client-shell__mobile-nav" aria-label="移动端设备控制导航">
        {NAV_ITEMS.map(item => (
          <NavLink key={item.to} to={item.to} end={'end' in item ? item.end : false} className={({ isActive }) => isActive ? 'is-active' : ''}>
            <span aria-hidden="true">{item.mark}</span><span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
