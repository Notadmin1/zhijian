import { Check, ArrowRight } from 'lucide-react'
import type { Article, ThemeId } from '../types'
import { themes } from '../lib/themes'
import { renderArticle } from '../lib/render'
import { recommendTemplate } from '../lib/inspection'
import Modal from './Modal'

export default function TemplateDialog({ article, assets, onApply, onClose }: {
  article: Article; assets: Record<string, string>; onApply: (id: ThemeId) => void; onClose: () => void
}) {
  const recommended = recommendTemplate(article)
  return <Modal title="用你的文章，挑一个版式" eyebrow="FIND YOUR READING STYLE" wide className="template-modal" onClose={onClose}>
    <p className="modal-description">下面是同一篇文章的三种排版。应用后可继续调整字号、行距与卡片，正文和代码文字保持原样。</p>
    <div className="template-comparison">{themes.filter(theme => ['research', 'tutorial', 'minimal'].includes(theme.id)).map(theme => <section key={theme.id} className="template-option" style={{ '--template-accent': theme.accent, '--template-soft': theme.soft } as React.CSSProperties}>
      <header><div><span>{theme.label}</span><h3>{theme.name}</h3></div>{recommended.id === theme.id && <small>推荐</small>}</header>
      <p className="template-features">{theme.features}</p>
      <div className="template-real-preview" aria-label={`${theme.name}当前文章预览`}><h4>{article.title || '未命名文章'}</h4><div className="rendered-article" dangerouslySetInnerHTML={{ __html: renderArticle({ ...article, themeId: theme.id, typography: { ...article.typography, accent: theme.accent, includeTitle: false } }, { assets }) }} /></div>
      <button className="button" onClick={() => onApply(theme.id)}>{article.themeId === theme.id && <Check size={15} />}应用{theme.name}<ArrowRight size={15} /></button>
    </section>)}</div>
    <p className="note">推荐依据：{recommended.reason}</p>
  </Modal>
}
