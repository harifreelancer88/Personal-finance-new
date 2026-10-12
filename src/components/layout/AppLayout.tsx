import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { CreditCard, FileChartColumn, LayoutDashboard, Layers, MoreHorizontal } from 'lucide-react'
import { Sidebar } from './Sidebar'
const mobileLinks = [{ to:'/', label:'Dashboard', icon:LayoutDashboard },{ to:'/accounts', label:'Accounts', icon:Layers },{ to:'/transactions', label:'Transactions', icon:CreditCard },{ to:'/reports', label:'Reports', icon:FileChartColumn }]
export function AppLayout() {
  const [open, setOpen] = useState(false)
  const pathname = useLocation().pathname
  const light = pathname === '/transactions' || pathname === '/accounts'
  useEffect(() => { window.scrollTo(0,0) },[pathname])
  useEffect(() => {
    if (!light) return
    const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const previous = theme?.content
    if (theme) theme.content = '#f7f6f4'
    return () => { if (theme && previous !== undefined) theme.content = previous }
  },[light])
  return <div className={`app-shell ${light ? 'monarch-transactions' : ''} ${pathname === '/accounts' ? 'monarch-accounts' : ''}`}><Sidebar light={light} open={open} onClose={() => setOpen(false)} /><main className="main-content"><Outlet context={{ openMenu: () => setOpen(true) }} /></main>{light && <nav className="mobile-navigation" aria-label="Mobile navigation">{mobileLinks.map(({to,label,icon:Icon}) => <NavLink key={to} to={to} end={to === '/'}><Icon/><span>{label}</span></NavLink>)}<button onClick={() => setOpen(true)} aria-label="More navigation"><MoreHorizontal/><span>More</span></button></nav>}</div>
}
