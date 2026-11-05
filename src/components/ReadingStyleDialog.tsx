import { useState } from 'react'
import { ArrowRight, Check } from 'lucide-react'
import type { Article, DecorationStrength, ReadingDensity, Typography } from '../types'
import { applyReadingDensity, decorationStrengths, readingDensities, readingStyleSummary } from '../lib/reading-style'
import { safeTypography, themes } from '../lib/themes'
import { renderArticle } from '../lib/render'
import Modal from './Modal'

export default function ReadingStyleDialog({ article, assets, onApply, onClose }: {
  article: Article; assets: Record<string, string>; onApply: (typography: Typography) => void; onClose: () => void
}) {
  const [tab, setTab] = useState<'density' | 'decoration'>('density')
  const theme = themes.find(theme => theme.id === article.themeId) || themes[0]
  const options = tab === 'density' ? readingDensities : decorationStrengths
  return <Modal title="用当前文章，对比阅读效果" eyebrow="FIND YOUR READING RHYTHM" wide className="template-modal reading-comparison-modal" onClose={onClose}>
    <p className="modal-description">下面是同一篇文章的完整排版。先比较阅读密度，再比较装饰强度；应用后可继续微调，也可保存为个人方案。</p>
    <div className="reading-comparison-tabs" role="tablist" aria-label="效果对比分类"><button role="tab" aria-selected={tab === 'density'} onClick={() => setTab('density')}>阅读密度对比</button><button role="tab" aria-selected={tab === 'decoration'} onClick={() => setTab('decoration')}>装饰强度对比</button></div>
    <div className="template-comparison">{options.map(option => {
      const typography: Typography = tab === 'density' ? applyReadingDensity(article.typography, option.id as ReadingDensity) : { ...safeTypography(article.typography), decoration: option.id as DecorationStrength }
      const selected = tab === 'density' ? article.typography.readingDensity === option.id && article.typography.lineHeight === typography.lineHeight && article.typography.paragraphSpace === typography.paragraphSpace : article.typography.decoration === option.id
      const label = `${option.label}${tab === 'density' ? '密度' : '装饰'}`
      return <section key={`${tab}-${option.id}`} className="template-option reading-style-option" style={{ '--template-accent': theme.accent, '--template-soft': theme.soft } as React.CSSProperties}>
        <header><div><span>{option.hint}</span><h3>{option.label}</h3></div>{selected && <small>当前</small>}</header>
        <p className="template-features">{tab === 'density' ? `行高 ${typography.lineHeight} · 段距 ${typography.paragraphSpace}px` : option.hint}</p>
        <div className="template-real-preview" aria-label={`${label}当前文章预览`}><h4>{article.title || '未命名文章'}</h4><div className="rendered-article" dangerouslySetInnerHTML={{ __html: renderArticle({ ...article, typography: { ...typography, includeTitle: false } }, { assets }) }} /></div>
        <button className="button" onClick={() => onApply(typography)}>{selected && <Check size={15} />}应用{label}<ArrowRight size={15} /></button>
      </section>
    })}</div>
    <p className="note">当前：{readingStyleSummary(article.typography)}。代码的换行、强调行及图片的手动设置会保留。</p>
  </Modal>
}
