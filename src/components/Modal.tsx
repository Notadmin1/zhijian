import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export default function Modal({ title, eyebrow, children, onClose, wide = false, className = '' }: { title: string; eyebrow?: string; children: ReactNode; onClose: () => void; wide?: boolean; className?: string }) {
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const id = useId()
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const focusable = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea,select,[tabindex="0"]') || [])
    const timer = window.setTimeout(() => (panel.current?.querySelector<HTMLElement>('[data-autofocus]') || focusable()[0])?.focus(), 0)
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current()
      if (event.key === 'Tab') {
        const elements = focusable()
        if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus() }
        else if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0]?.focus() }
      }
    }
    document.addEventListener('keydown', key)
    return () => { clearTimeout(timer); document.removeEventListener('keydown', key); previous?.focus() }
  }, [])
  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={id} className={`modal ${wide ? 'modal-wide' : ''} ${className}`}>
      <div className="modal-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2 id={id}>{title}</h2></div><button className="icon-button" aria-label="关闭对话框" onClick={onClose}><X size={19} /></button></div>
      {children}
    </div>
  </div>, document.body)
}
