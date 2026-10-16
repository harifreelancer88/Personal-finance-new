import { Menu } from 'lucide-react'
import { Link, useOutletContext } from 'react-router-dom'
import type { ReactNode } from 'react'
export function WorkflowShell({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  const { openMenu } = useOutletContext<{ openMenu: () => void }>()
  return (
    <>
      <header className="activity-header">
        <button
          className="icon-button activity-menu"
          onClick={openMenu}
          aria-label="Open navigation"
        >
          <Menu />
        </button>
        <h1>{title}</h1>
      </header>
      <div className="page-body workflow-page">
        <nav className="workflow-nav" aria-label="Finance tools">
          <Link to="/bills">Bills & instalments</Link>
          <Link to="/imports">Statement imports</Link>
          <Link to="/analytics">Comparison reports</Link>
          <Link to="/backup">Backup & restore</Link>
        </nav>
        <p className="workflow-intro">{description}</p>
        {children}
      </div>
    </>
  )
}
export function Feedback({
  error,
  notice,
}: {
  error?: string
  notice?: string
}) {
  return (
    <>
      {error && (
        <p role="alert" className="api-feedback error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="api-feedback">
          {notice}
        </p>
      )}
    </>
  )
}
