import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

export function AppLayout() {
  const [open, setOpen] = useState(false)
  return <div className="app-shell"><Sidebar open={open} onClose={() => setOpen(false)} /><main className="main-content"><Outlet context={{ openMenu: () => setOpen(true) }} /></main></div>
}
