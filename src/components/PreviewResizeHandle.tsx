import { useRef } from 'react'

export default function PreviewResizeHandle({ width, onChange }: { width: number; onChange: (width: number) => void }) {
  const drag = useRef<{ start: number; width: number; current: number } | null>(null)
  const clamp = (value: number) => Math.max(280, Math.min(520, Math.round(value)))
  return <div className="preview-resize-handle" role="separator" aria-label="调整预览宽度" aria-orientation="vertical" aria-valuemin={280} aria-valuemax={520} aria-valuenow={width} tabIndex={0}
    onPointerDown={event => {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      const measured = event.currentTarget.parentElement!.getBoundingClientRect().width
      drag.current = { start: event.clientX, width: measured, current: measured }
    }}
    onPointerMove={event => {
      if (!drag.current) return
      drag.current.current = clamp(drag.current.width + drag.current.start - event.clientX)
      event.currentTarget.closest<HTMLElement>('.workspace')?.style.setProperty('--preview-width', `${drag.current.current}px`)
    }}
    onLostPointerCapture={() => { if (drag.current) { onChange(clamp(drag.current.current)); drag.current = null } }}
    onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
    onPointerCancel={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
    onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      onChange(event.key === 'Home' ? 280 : event.key === 'End' ? 520 : clamp(width + (event.key === 'ArrowLeft' ? 20 : -20)))
    }}><span /></div>
}
