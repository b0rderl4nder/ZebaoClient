import { NavLink, Outlet } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/dashboard', label: '概览', icon: '⌂', end: true },
  { to: '/dashboard/motions', label: '动作', icon: '◇' },
  { to: '/dashboard/pose', label: '姿态', icon: '⌁' },
  { to: '/dashboard/apps', label: '应用', icon: '◫' },
  { to: '/dashboard/chat', label: '对话', icon: '◉' },
  { to: '/dashboard/simulation', label: '仿真', icon: '⌘' },
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
          <div><strong>泽宝</strong><small>{simulated ? '物理仿真' : host || '设备控制'}</small></div>
        </div>
        <nav>
          {NAV_ITEMS.map(item => (
            <NavLink key={item.to} to={item.to} end={'end' in item ? item.end : false} className={({ isActive }) => isActive ? 'is-active' : ''}>
              <span aria-hidden="true">{item.icon}</span><span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <button type="button" onClick={onSwitchDevice}>切换设备</button>
      </aside>
      <div className="client-shell__content"><Outlet /></div>
      <nav className="client-shell__mobile-nav" aria-label="移动端设备控制导航">
        {NAV_ITEMS.map(item => (
          <NavLink key={item.to} to={item.to} end={'end' in item ? item.end : false} className={({ isActive }) => isActive ? 'is-active' : ''}>
            <span aria-hidden="true">{item.icon}</span><span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
