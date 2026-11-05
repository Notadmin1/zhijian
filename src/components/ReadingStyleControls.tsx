import { Columns2 } from 'lucide-react'
import type { Typography } from '../types'
import { applyReadingDensity, decorationStrengths, readingDensities, readingMetrics } from '../lib/reading-style'

export default function ReadingStyleControls({ typography, onChange, onCompare }: {
  typography: Typography; onChange: (typography: Typography) => void; onCompare: () => void
}) {
  const density = readingMetrics(typography)
  const customized = typography.lineHeight !== density.lineHeight || typography.paragraphSpace !== density.paragraphSpace
  return <section className="reading-style-controls" aria-label="整篇阅读风格">
    <div className="reading-style-heading"><strong>阅读节奏</strong><button onClick={onCompare}><Columns2 size={13} />对比效果</button></div>
    <div className="density-options" role="radiogroup" aria-label="阅读密度">{readingDensities.map(option => <button role="radio" aria-label={option.label} aria-checked={typography.readingDensity === option.id} key={option.id} onClick={() => onChange(applyReadingDensity(typography, option.id))}><strong>{option.label}</strong><small>{option.hint}</small></button>)}</div>
    <p className="density-current">行高 {typography.lineHeight} · 段距 {typography.paragraphSpace}px{customized && <span>已微调</span>}</p>
    <label className="decoration-setting">装饰强度<select aria-label="装饰强度" value={typography.decoration} onChange={event => onChange({ ...typography, decoration: event.target.value as Typography['decoration'] })}>{decorationStrengths.map(option => <option value={option.id} key={option.id}>{option.label} · {option.hint}</option>)}</select></label>
    <div className="reading-spacing-toggle"><div><span>相邻内容自动留白</span><small>说明贴近图文，章节保持间隔</small></div><button className={`toggle ${typography.smartSpacing ? 'checked' : ''}`} role="switch" aria-label="相邻内容自动留白" aria-checked={typography.smartSpacing} onClick={() => onChange({ ...typography, smartSpacing: !typography.smartSpacing })}><span /></button></div>
    <p className="reading-controls-hint">选择密度会联动行高、段距与块间留白；可继续微调，字号和代码文字保持原样。</p>
  </section>
}
