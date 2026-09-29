import { BarChart3, CreditCard, FileChartColumn, LayoutDashboard, Settings, TrendingUp, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { NavLink } from 'react-router-dom'
import { Logo } from '../ui/Logo'

const items = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/' },
  { label: 'Transactions', icon: CreditCard, to: '/transactions' },
  { label: 'Accounts', icon: BarChart3, to: '/accounts' },
  { label: 'Investments', icon: TrendingUp, to: '/investments' },
  { label: 'Reports', icon: FileChartColumn, to: '/reports' },
  { label: 'Settings', icon: Settings, to: '/settings' },
]

interface SidebarProps { open: boolean; onClose: () => void }

export function Sidebar({ open, onClose }: SidebarProps) {
  const closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButton.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', closeOnEscape) }
  }, [open, onClose])
  return <>
    {open && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={onClose} />}
    <aside className={`sidebar ${open ? 'is-open' : ''}`} aria-label="Application sidebar">
      <div className="sidebar-head"><Logo /><button ref={closeButton} className="icon-button sidebar-close" onClick={onClose} aria-label="Close menu"><X /></button></div>
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
