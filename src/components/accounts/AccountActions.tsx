import { Eye, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
export function AccountActions({ name, onView, onEdit, onDelete }: {name:string; onView:()=>void; onEdit:()=>void; onDelete:()=>void}) {
  const [open,setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event:MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event:KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); ref.current?.querySelector<HTMLButtonElement>('button')?.focus() } }
    document.addEventListener('mousedown',close); document.addEventListener('keydown',escape)
    return () => { document.removeEventListener('mousedown',close); document.removeEventListener('keydown',escape) }
  },[open])
  const act = (callback:()=>void) => { setOpen(false); callback() }
  return <div className="action-menu account-actions" ref={ref}><button className="action-trigger" aria-label={`Actions for ${name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><MoreHorizontal/></button>{open && <div className="action-popover" role="menu"><button role="menuitem" onClick={() => act(onView)}><Eye/>View account</button><button role="menuitem" onClick={() => act(onEdit)}><Pencil/>Edit account</button><button role="menuitem" className="danger" onClick={() => act(onDelete)}><Trash2/>Delete account</button></div>}</div>
}
