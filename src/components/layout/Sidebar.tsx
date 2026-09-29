import { BarChart3, CreditCard, FileChartColumn, LayoutDashboard, Settings, TrendingUp, X } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { Logo } from '../ui/Logo'

const items = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/' },
  { label: 'Transactions', icon: CreditCard, to: '/transactions' },
  { label: 'Accounts', icon: BarChart3 },
  { label: 'Investments', icon: TrendingUp },
  { label: 'Reports', icon: FileChartColumn },
  { label: 'Settings', icon: Settings },
]

interface SidebarProps { open: boolean; onClose: () => void }

export function Sidebar({ open, onClose }: SidebarProps) {
  return <>
    {open && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={onClose} />}
    <aside className={`sidebar ${open ? 'is-open' : ''}`}>
      <div className="sidebar-head"><Logo /><button className="icon-button sidebar-close" onClick={onClose} aria-label="Close menu"><X /></button></div>
      <nav aria-label="Primary navigation">
        <p className="nav-label">Menu</p>
        <ul className="nav-list">{items.map(({ label, icon: Icon, to }) => <li key={label}>
          {to ? <NavLink end={to === '/'} to={to} onClick={onClose} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon size={19} /><span>{label}</span></NavLink>
            : <button className="nav-item disabled" disabled title="Coming soon"><Icon size={19} /><span>{label}</span><small>Soon</small></button>}
        </li>)}</ul>
      </nav>
      <div className="sidebar-family"><div className="avatar-stack"><span>AK</span><span>SK</span><span>+</span></div><strong>Family space</strong><p>2 members connected</p></div>
      <p className="sidebar-footer">Private by design<br/><span>© 2026 Personal Finance</span></p>
    </aside>
  </>
}
