import { useEffect, useMemo, useState } from 'react'
import { liveQuery } from 'dexie'
import { History, Save, RotateCcw } from 'lucide-react'
import type { Article, ArticleVersion } from '../types'
import { db, VERSION_LIMIT } from '../lib/storage'
import { imageNodes, plainText, wordCount } from '../lib/document'
import { renderArticle } from '../lib/render'
import Modal from './Modal'

const date = (time: number) => new Date(time).toLocaleString('zh-CN', { hour12: false })

function VersionPreview({ article }: { article: Article }) {
  const [assets, setAssets] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false
    const urls: Record<string, string> = {}
    setAssets({})
    setError('')
    const ids = [...new Set(imageNodes(article.document).map(node => String(node.attrs?.assetId || '')).filter(Boolean))]
    Promise.all(ids.map(async id => {
      const asset = await db.assets.get(id)
      if (!asset) throw new Error('这个版本有图片缺失，恢复后请重新添加图片')
      if (!disposed) urls[id] = URL.createObjectURL(asset.blob)
    })).then(() => { if (!disposed) setAssets({ ...urls }) }).catch(error => { if (!disposed) { setAssets({ ...urls }); setError(String(error.message || '版本图片读取失败')) } })
    return () => { disposed = true; Object.values(urls).forEach(url => URL.revokeObjectURL(url)) }
  }, [article])
  const html = useMemo(() => renderArticle({ ...article, typography: { ...article.typography, includeTitle: false } }, { assets }), [article, assets])
  return <div className="version-preview" aria-label="历史版本预览">{error && <p role="alert" className="form-error">{error}</p>}<h3>{article.title || '未命名文章'}</h3><div className="rendered-article" dangerouslySetInnerHTML={{ __html: html }} /></div>
}

export default function HistoryDialog({ article, busy, onSave, onRestore, onClose }: {
  article: Article; busy: boolean; onSave: () => Promise<void>; onRestore: (version: ArticleVersion) => void; onClose: () => void
}) {
  const [versions, setVersions] = useState<ArticleVersion[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    const subscription = liveQuery(() => db.versions.where('articleId').equals(article.id).sortBy('createdAt')).subscribe({
      next: rows => { setVersions(rows.reverse()); setLoading(false) },
      error: () => { setError('历史版本读取失败，请关闭后重试'); setLoading(false) },
    })
    return () => subscription.unsubscribe()
  }, [article.id])
  const selected = versions.find(version => version.id === selectedId) || versions[0]
  return <Modal title="历史版本" eyebrow="YOUR ARTICLE HISTORY" wide className="history-modal" onClose={onClose}>
    <div className="collection-toolbar"><p>美化、恢复和应用方案前自动留档；编辑时每 3 分钟最多留档一次。每篇保留最近 {VERSION_LIMIT} 份。</p><button className="button secondary" disabled={busy} onClick={() => { setSelectedId(''); void onSave() }}><Save size={15} />保存当前版本</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {loading ? <p className="empty-hint">正在读取历史版本…</p> : versions.length ? <div className="history-grid">
      <nav className="version-list" aria-label="文章历史版本">{versions.map(version => <button key={version.id} aria-pressed={selected?.id === version.id} onClick={() => setSelectedId(version.id)}><strong>{version.reason}</strong><time>{date(version.createdAt)}</time><span>{wordCount(version.article.document).toLocaleString()} 字 · {version.article.title}</span><p>{plainText(version.article.document).slice(0, 65)}</p></button>)}</nav>
      {selected && <VersionPreview article={selected.article} />}
    </div> : <div className="empty-hint"><History size={28} /><p>还没有历史版本，可以先保存一份当前版本。</p></div>}
    <div className="modal-actions"><span className="muted small">恢复标题、正文和整篇样式；恢复前会保留当前版本。</span><button className="button primary" disabled={busy || !selected} onClick={() => selected && onRestore(selected)}><RotateCcw size={15} />恢复选中版本</button></div>
  </Modal>
}
