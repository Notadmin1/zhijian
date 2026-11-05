import { Check, BookOpen, Undo2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { Article } from '../types'
import type { BeautifyReport } from '../lib/beautify'
import { themes } from '../lib/themes'
import { wordCount } from '../lib/document'
import { scrollToArticleElement, type NavigationTarget } from '../lib/outline'

export default function BeautifiedPane({ article, html, report, canUndo, onUndo, onEdit, navigation }: {
  article: Article; html: string; report?: BeautifyReport; canUndo: boolean; onUndo: () => void; onEdit: (block?: number) => void; navigation: NavigationTarget | null
}) {
  const theme = themes.find(theme => theme.id === article.themeId) || themes[0]
  const scroll = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (navigation?.articleId !== article.id || navigation.section === undefined) return
    const target = scroll.current?.querySelector(`[data-section-index="${navigation.section}"]`) || null
    scrollToArticleElement(target, scroll.current)
    target?.classList.add('section-target')
    const timer = setTimeout(() => target?.classList.remove('section-target'), 1400)
    return () => { clearTimeout(timer); target?.classList.remove('section-target') }
  }, [navigation, article.id, html])
  return <section className="beautified-pane">
    <div className="beauty-report" data-testid="beauty-report"><Check size={16} /><div><strong>{report ? '已完成自动排版与美化' : '公众号排版效果'}</strong><span>{report ? `${report.headings} 个标题 · ${report.codeBlocks} 段代码 · ${report.tables} 个表格 · ${report.images} 张图片${report.callouts ? ` · ${report.callouts} 个提示卡片` : ''}${report.splitParagraphs ? ` · 拆分 ${report.splitParagraphs} 处长段落` : ''}` : '标题、导读、正文与配图，按当前主题统一呈现'}</span></div>{canUndo && <button onClick={onUndo}><Undo2 size={13} />撤销美化</button>}</div>
    <div ref={scroll} className="beautified-scroll"><article className="beautified-paper">
      <div className="beautified-kicker" style={{ color: article.typography.accent }}><span />{theme.label}<span className="kicker-line" /></div>
      <h1 className="beautified-title">{article.title || '未命名文章'}</h1>
      <div className="beautified-meta"><span>{theme.name}</span><i />约 {Math.max(1, Math.ceil(wordCount(article.document) / 400))} 分钟阅读<button onClick={() => onEdit()}>编辑正文 →</button></div>
      <div className="beautified-rule" />
      <div data-testid="beautified-article" className="rendered-article" onDoubleClick={event => {
        const block = (event.target as Element).closest<HTMLElement>('[data-block-index]')
        if (block && !((event.target as Element).closest('a'))) onEdit(Number(block.dataset.blockIndex))
      }} dangerouslySetInnerHTML={{ __html: html }} />
      <div className="beautified-end"><BookOpen size={15} /><span>END</span></div>
    </article></div>
    <div className="beautified-edit-hint">双击正文段落，定位到原文编辑。</div>
  </section>
}
