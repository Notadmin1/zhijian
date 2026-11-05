import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import { ArrowRight, BookmarkPlus, Pencil, Trash2 } from 'lucide-react'
import type { Article, StylePreset } from '../types'
import { db } from '../lib/storage'
import { savePreset } from '../lib/presets'
import { themes } from '../lib/themes'
import { readingStyleSummary } from '../lib/reading-style'
import Modal from './Modal'

export default function PresetDialog({ article, busy, onApply, onClose, notify }: {
  article: Article; busy: boolean; onApply: (preset: StylePreset, includeFooter: boolean) => void; onClose: () => void; notify: (message: string, error?: boolean) => void
}) {
  const [presets, setPresets] = useState<StylePreset[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [footer, setFooter] = useState('')
  const [editingId, setEditingId] = useState('')
  const [includeFooter, setIncludeFooter] = useState<Record<string, boolean>>({})
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const subscription = liveQuery(() => db.presets.orderBy('updatedAt').reverse().toArray()).subscribe({
      next: rows => { setPresets(rows); setLoading(false) },
      error: () => { setError('个人方案读取失败，请关闭后重试'); setLoading(false) },
    })
    return () => subscription.unsubscribe()
  }, [])
  const reset = () => { setName(''); setFooter(''); setEditingId(''); setError('') }
  const work = async (action: () => Promise<void>) => {
    if (working) return
    setWorking(true)
    setError('')
    try { await action() } catch (error) { setError(error instanceof Error ? error.message : '操作失败，请重试') }
    finally { setWorking(false) }
  }
  return <Modal title="个人排版方案" eyebrow="YOUR OWN STYLES" wide className="preset-modal" onClose={onClose}>
    <p className="modal-description">把当前主题、字体、间距及整篇代码和表格设置存成方案。应用后新文章也会沿用这些样式，已有草稿保持各自设置。</p>
    <form className="preset-form" onSubmit={event => { event.preventDefault(); void work(async () => { await savePreset(article, name, footer, editingId || undefined); notify(editingId ? '已用当前文章的样式更新方案' : '当前样式已保存为个人方案'); reset() }) }}>
      <div className="preset-form-heading"><BookmarkPlus size={17} /><strong>{editingId ? '更新方案：使用当前文章的样式' : '保存当前文章的样式'}</strong><span>{themes.find(theme => theme.id === article.themeId)?.name} · {article.typography.fontSize}px · 行高 {article.typography.lineHeight}</span></div>
      <label>方案名称<input aria-label="方案名称" maxLength={40} required placeholder="例如：漏洞分析 / 工具教程" value={name} onChange={event => setName(event.target.value)} /></label>
      <label>固定文末（可选）<textarea aria-label="固定文末" maxLength={2000} rows={3} placeholder="作者介绍、关注提示或常用结语；应用时可选择是否插入" value={footer} onChange={event => setFooter(event.target.value)} /></label>
      <div className="preset-form-actions">{editingId && <button type="button" className="button secondary" disabled={working || busy} onClick={reset}>取消更新</button>}<button className="button primary" disabled={working || busy || !name.trim()}>{editingId ? '更新为当前样式' : '保存为个人方案'}</button></div>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="preset-list" aria-label="已保存的个人方案">{loading ? <p className="empty-hint">正在读取个人方案…</p> : presets.length ? presets.map(preset => <section className="preset-item" key={preset.id} style={{ '--preset-accent': preset.typography.accent } as React.CSSProperties}>
      <header><span className="preset-color" /><strong>{preset.name}</strong><button className="icon-button" disabled={working || busy} aria-label={`编辑方案 ${preset.name}`} onClick={() => { setEditingId(preset.id); setName(preset.name); setFooter(preset.footer); setError('') }}><Pencil size={14} /></button><button className="icon-button danger-hover" disabled={working || busy} aria-label={`删除方案 ${preset.name}`} onClick={() => void work(async () => { await db.presets.delete(preset.id); if (editingId === preset.id) reset(); notify('个人方案已删除，文章内容不受影响') })}><Trash2 size={14} /></button></header>
      <p>{themes.find(theme => theme.id === preset.themeId)?.name} · 正文 {preset.typography.fontSize}px · 行高 {preset.typography.lineHeight} · 段距 {preset.typography.paragraphSpace}px</p>
      <small>代码 {preset.typography.codeFontSize}px / {preset.typography.codeWrap ? '自动换行' : '横向滚动'} · 表格{preset.typography.tableMode === 'auto' ? '自动' : preset.typography.tableMode === 'fit' ? '适应宽度' : '横向滚动'}</small>
      <p className="preset-reading-summary">{readingStyleSummary(preset.typography)}</p>
      {preset.footer && <><pre className="preset-footer-preview">{preset.footer}</pre><label className="preset-footer-choice"><input type="checkbox" checked={!!includeFooter[preset.id]} onChange={event => setIncludeFooter(current => ({ ...current, [preset.id]: event.target.checked }))} />应用“{preset.name}”时插入文末</label></>}
      <button className="button secondary" disabled={working || busy} onClick={() => onApply(preset, !!includeFooter[preset.id])}>应用方案 {preset.name}<ArrowRight size={14} /></button>
    </section>) : <p className="empty-hint">还没有个人方案，先把当前满意的排版保存下来。</p>}</div>
  </Modal>
}
