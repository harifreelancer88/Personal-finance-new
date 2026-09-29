import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function SettingsSection({ icon: Icon, title, description, action, children, className = '' }: { icon: LucideIcon; title: string; description: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel settings-section ${className}`}><header className="settings-section-head"><span className="settings-icon"><Icon /></span><div><h2>{title}</h2><p>{description}</p></div>{action && <div className="settings-section-action">{action}</div>}</header><div className="settings-section-body">{children}</div></section>
}
