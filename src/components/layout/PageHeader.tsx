import { Bell, Menu, Search } from 'lucide-react'

interface PageHeaderProps { title: string; eyebrow: string; onMenu: () => void }

export function PageHeader({ title, eyebrow, onMenu }: PageHeaderProps) {
  return <header className="page-header">
    <div className="header-title"><button className="icon-button menu-button" onClick={onMenu} aria-label="Open menu"><Menu /></button><div><p>{eyebrow}</p><h1>{title}</h1></div></div>
    <div className="header-actions">
      <button className="icon-button" aria-label="Search"><Search /></button>
      <button className="icon-button notification" aria-label="Notifications"><Bell /><span /></button>
      <div className="profile"><span className="profile-avatar">AK</span><div><strong>Arjun Kumar</strong><small>Family admin</small></div></div>
    </div>
  </header>
}
