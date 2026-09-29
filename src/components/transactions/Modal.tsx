import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'

export function Modal({ title, description, children, onClose, size = 'normal' }: { title: string; description?: string; children: ReactNode; onClose: () => void; size?: 'normal' | 'small' }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} className={`app-dialog ${size}`} onCancel={onClose} onClick={event => { if (event.target === ref.current) onClose() }} aria-labelledby="dialog-title">
    <div className="dialog-shell">
      <header className="dialog-header"><div><h2 id="dialog-title">{title}</h2>{description && <p>{description}</p>}</div><button type="button" className="dialog-close" onClick={onClose} aria-label="Close dialog"><X /></button></header>
      {children}
    </div>
  </dialog>
}
