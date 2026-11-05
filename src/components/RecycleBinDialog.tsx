import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import { RotateCcw, Trash2 } from 'lucide-react'
import type { Article } from '../types'
import { db, permanentlyDeleteArticle, restoreFromTrash } from '../lib/storage'
import { wordCount } from '../lib/document'
import Modal from './Modal'

export default function RecycleBinDialog({ onRestore, onClose, notify }: {
  onRestore: (article: Article) => void; onClose: () => void; notify: (message: string, error?: boolean) => void
}) {
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmId, setConfirmId] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    const subscription = liveQuery(() => db.articles.where('deletedAt').above(0).reverse().toArray()).subscribe({
      next: rows => { setArticles(rows); setLoading(false) },
      error: () => { setError('回收站读取失败，请关闭后重试'); setLoading(false) },
    })
    return () => subscription.unsubscribe()
  }, [])
  const work = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError('')
    try { await action() } catch (error) { setError(error instanceof Error ? error.message : '操作失败，请重试') }
    finally { setBusy(false) }
  }
  return <Modal title="回收站" eyebrow="RECYCLE BIN" wide className="recycle-modal" onClose={onClose}>
    <p className="modal-description">已删除草稿会保留在这里，直到你手动彻底删除。恢复时保留正文、原稿、图片、样式和历史版本。</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="recycle-list">{loading ? <p className="empty-hint">正在读取回收站…</p> : articles.length ? articles.map(article => <section className="recycle-item" key={article.id}>
      <div><strong>{article.title || '未命名文章'}</strong><p>{wordCount(article.document).toLocaleString()} 字 · 删除于 {new Date(article.deletedAt!).toLocaleString('zh-CN', { hour12: false })}</p></div>
      <div className="recycle-actions"><button className="button secondary" disabled={busy} onClick={() => void work(async () => { const restored = await restoreFromTrash(article.id); onRestore(restored); notify('草稿已恢复，历史版本和图片均已保留') })}><RotateCcw size={14} />恢复草稿</button><button className="icon-button danger-hover" disabled={busy} aria-label={`彻底删除 ${article.title}`} onClick={() => setConfirmId(article.id)}><Trash2 size={16} /></button></div>
      {confirmId === article.id && <div className="delete-confirmation" role="group" aria-label="确认彻底删除草稿"><p>彻底删除后，这篇草稿及其历史版本将无法恢复。</p><button className="button secondary" disabled={busy} onClick={() => setConfirmId('')}>取消</button><button className="button danger" disabled={busy} onClick={() => void work(async () => { await permanentlyDeleteArticle(article.id); setConfirmId(''); notify('已彻底删除草稿及其历史版本') })}>确认彻底删除</button></div>}
    </section>) : <div className="empty-hint"><Trash2 size={28} /><p>回收站是空的</p></div>}</div>
    <div className="modal-actions"><button className="button secondary" onClick={onClose}>返回我的草稿</button></div>
  </Modal>
}
