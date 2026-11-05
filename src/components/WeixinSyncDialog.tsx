import { useEffect, useRef, useState } from 'react'
import { CheckCheck, ExternalLink, Image, LoaderCircle, RefreshCw, Send, ShieldCheck } from 'lucide-react'
import type { Article, WeixinSyncRecord } from '../types'
import { db } from '../lib/storage'
import { imageNodes, wordCount } from '../lib/document'
import { getWeixinAccounts, syncWeixinDraft, syncErrorMessage, validateWeixinArticle, weixinDraftURL, WeixinSyncError, WECHATSYNC_INSTALL, WEIXIN_HOME, type WeixinAccount } from '../lib/weixin-sync'
import Modal from './Modal'

interface Props {
  open: boolean
  article: Article
  onClose: () => void
  onBusyChange: (busy: boolean) => void
  beforeSync: () => Promise<void>
  notify: (message: string, error?: boolean) => void
}

export default function WeixinSyncDialog({ open, article, onClose, onBusyChange, beforeSync, notify }: Props) {
  const [snapshot, setSnapshot] = useState(article)
  const [title, setTitle] = useState(article.title)
  const [accounts, setAccounts] = useState<WeixinAccount[]>([])
  const [selected, setSelected] = useState('0')
  const [connection, setConnection] = useState<'checking' | 'ready' | 'missing' | 'no-account' | 'error'>('checking')
  const [connectionError, setConnectionError] = useState('')
  const [error, setError] = useState('')
  const [record, setRecord] = useState<WeixinSyncRecord | null>(null)
  const [history, setHistory] = useState<WeixinSyncRecord[]>([])
  const [liveDraftLink, setLiveDraftLink] = useState('')
  const running = useRef(false)
  const detection = useRef(0)
  const titleLength = Array.from(title.trim()).length
  const syncing = record?.status === 'syncing'

  const loadHistory = async (articleId: string) => {
    try {
      const records = await db.syncRecords.where('articleId').equals(articleId).toArray()
      const normalized = records.map(item => item.status === 'syncing' && !running.current ? { ...item, status: 'unknown' as const, stage: '上次同步未收到最终结果，请先检查公众号草稿箱', error: '页面曾关闭或刷新，尚未确认保存结果' } : item)
      const interrupted = normalized.filter((item, index) => item.status !== records[index].status)
      if (interrupted.length) await db.syncRecords.bulkPut(interrupted)
      setHistory(normalized.sort((a, b) => b.startedAt - a.startedAt).slice(0, 5))
    } catch { notify('暂时无法读取同步记录', true) }
  }
  const detectAccounts = async () => {
    const current = ++detection.current
    setConnection('checking')
    setConnectionError('')
    try {
      const result = await getWeixinAccounts()
      if (current !== detection.current) return
      setAccounts(result)
      setSelected('0')
      setConnection(result.length ? 'ready' : 'no-account')
    } catch (reason) {
      if (current !== detection.current) return
      setConnection(reason instanceof WeixinSyncError && reason.code === 'extension-missing' ? 'missing' : 'error')
      setConnectionError(syncErrorMessage(reason))
    }
  }

  useEffect(() => {
    if (!open || running.current) return
    setSnapshot(structuredClone(article))
    setTitle(article.title)
    setError('')
    if (record?.articleId !== article.id) { setRecord(null); setLiveDraftLink('') }
    void loadHistory(article.id)
    void detectAccounts()
    return () => { detection.current++ }
    // Capture one article when opening; later typing must not change an active upload.
  }, [open, article.id])

  const submit = async () => {
    const account = accounts[Number(selected)]
    if (running.current || !account || connection !== 'ready') return
    const sending = { ...structuredClone(snapshot), title: title.trim() }
    setError('')
    try { validateWeixinArticle(sending) } catch (reason) { setError(syncErrorMessage(reason)); return }
    running.current = true
    onBusyChange(true)
    setLiveDraftLink('')
    let job: WeixinSyncRecord = {
      id: crypto.randomUUID(), articleId: sending.id, articleUpdatedAt: sending.updatedAt,
      articleTitle: sending.title, accountName: account.title,
      status: 'syncing', stage: '正在准备同步…', images: imageNodes(sending.document).length, startedAt: Date.now(),
    }
    let started = false
    const persistProgress = (next: WeixinSyncRecord) => {
      setRecord({ ...next })
      // Queue writes in order so a slow progress write cannot overwrite success.
      recordWrites = recordWrites.catch(() => undefined).then(() => db.syncRecords.put({ ...next }))
    }
    let recordWrites: Promise<unknown> = Promise.resolve()
    try {
      await beforeSync()
      // Persist the attempt before sending. A refresh must not make an unfinished
      // request look safe to retry automatically.
      await db.syncRecords.put(job)
      started = true
      setRecord({ ...job })
      const result = await syncWeixinDraft(sending, account, progress => {
        job = { ...job, stage: progress.message }
        persistProgress(job)
      })
      setLiveDraftLink(result.draftUrl)
      job = { ...job, status: 'succeeded', stage: '已保存为公众号草稿', draftUrl: weixinDraftURL(result.draftUrl, true), finishedAt: Date.now() }
      persistProgress(job)
      notify(`已同步到「${account.title}」的公众号草稿`)
    } catch (reason) {
      const message = syncErrorMessage(reason)
      setError(message)
      if (started) {
        job = { ...job, status: reason instanceof WeixinSyncError && reason.code === 'unknown' ? 'unknown' : 'failed', stage: message, error: message, finishedAt: Date.now() }
        persistProgress(job)
      }
      if (reason instanceof WeixinSyncError && reason.code === 'account-changed') { setConnection('error'); setConnectionError(message) }
      notify(message, true)
    } finally {
      await recordWrites.catch(() => notify('同步结果未能保存在本地，请到公众号后台检查草稿', true))
      running.current = false
      onBusyChange(false)
      await loadHistory(sending.id)
    }
  }

  if (!open) return null
  const latest = record || history[0]
  const needsCheck = latest?.status === 'unknown'
  const successful = latest?.status === 'succeeded'
  return <Modal title="同步公众号草稿" eyebrow="WECHAT DRAFT" onClose={onClose}>
    <p className="modal-description">将当前排版图文保存到公众号草稿箱，图片自动转存。保存后可在公众号后台补充封面、作者并预览。</p>
    <div className="wechat-connection">
      <div className="wechat-connection-heading"><span className="wechat-icon">微</span><div><strong>微信公众号</strong><small>{connection === 'checking' ? '正在检测扩展与登录账号…' : connection === 'ready' ? '使用当前浏览器已登录的公众号' : '先连接你的公众号'}</small></div><button className="icon-button" aria-label="重新检测公众号" disabled={syncing || connection === 'checking'} onClick={() => void detectAccounts()}><RefreshCw size={15} className={connection === 'checking' ? 'spin' : ''} /></button></div>
      {connection === 'checking' ? <div className="wechat-detecting"><LoaderCircle size={16} className="spin" />首次检测可能需要几十秒，请稍候…</div> : connection === 'ready' ? <label className="wechat-account-label">目标公众号<select aria-label="目标公众号" disabled={syncing} value={selected} onChange={event => setSelected(event.target.value)}>{accounts.map((account, index) => <option key={`${account.uid || account.title}-${index}`} value={index}>{account.title}</option>)}</select><span className="wechat-connected"><CheckCheck size={13} />已登录</span></label> : <div className="wechat-setup">
        <p role={connection === 'error' ? 'alert' : undefined}>{connection === 'missing' ? '需要在当前浏览器安装「文章同步助手」扩展。' : connection === 'no-account' ? '扩展已连接，尚未检测到已登录的公众号。' : connectionError}</p>
        <ol><li><a href={WECHATSYNC_INSTALL} target="_blank" rel="noopener noreferrer">安装文章同步助手<ExternalLink size={11} /></a>，允许扩展访问本站。</li><li><a href={WEIXIN_HOME} target="_blank" rel="noopener noreferrer">打开公众号后台<ExternalLink size={11} /></a>，在同一浏览器登录。</li><li>安装扩展后刷新工作台；登录后点击“重新检测”。</li></ol>
        <button className="button secondary" onClick={() => void detectAccounts()}><RefreshCw size={13} />重新检测</button>
      </div>}
    </div>
    <div className="wechat-article-info"><label htmlFor="wechat-sync-title">文章标题<span className={titleLength > 64 ? 'invalid' : ''}>{titleLength}/64</span></label><input id="wechat-sync-title" aria-label="同步文章标题" aria-invalid={titleLength > 64} value={title} disabled={syncing} onChange={event => setTitle(event.target.value)} /><p>{wordCount(snapshot.document).toLocaleString()} 字<span>·</span><Image size={12} />{imageNodes(snapshot.document).length} 张图片<span>·</span>保留当前美化样式</p></div>
    {latest && <div data-testid="wechat-sync-result" className={`wechat-result result-${latest.status}`} role={latest.status === 'failed' || latest.status === 'unknown' ? 'alert' : 'status'}>
      {syncing ? <LoaderCircle size={18} className="spin" /> : successful ? <CheckCheck size={19} /> : <ShieldCheck size={19} />}
      <div><strong>{syncing ? '正在同步，请保持此页面打开' : successful ? '已保存为公众号草稿' : needsCheck ? '保存结果待确认' : '本次同步未完成'}</strong><p>{successful ? `${latest.accountName} · ${latest.articleTitle}` : latest.stage}</p>{successful && <a href={(record?.id === latest.id && liveDraftLink) || latest.draftUrl || WEIXIN_HOME} target="_blank" rel="noopener noreferrer">打开公众号草稿<ExternalLink size={12} /></a>}{needsCheck && <a href={WEIXIN_HOME} target="_blank" rel="noopener noreferrer">先检查公众号草稿箱<ExternalLink size={12} /></a>}</div>
    </div>}
    {error && latest?.error !== error && <p className="wechat-form-error" role="alert">{error}</p>}
    {history.length > 0 && <details className="wechat-history"><summary>此文章的同步记录 · {history.length}</summary>{history.map(item => <div key={item.id}><span>{item.accountName}<small>{new Date(item.startedAt).toLocaleString('zh-CN', { hour12: false })}</small></span><b>{item.status === 'succeeded' ? '已存草稿' : item.status === 'failed' ? '失败' : item.status === 'syncing' ? '同步中' : '待确认'}</b></div>)}</details>}
    <p className="wechat-local-note"><ShieldCheck size={13} />通过文章同步助手在本机同步，无需填写 AppSecret 或复制 Cookie。</p>
    <div className="modal-actions"><button className="button secondary" onClick={onClose}>{syncing ? '收起进度' : '关闭'}</button><button className="button primary" disabled={connection !== 'ready' || syncing || !titleLength || titleLength > 64} onClick={() => void submit()}>{syncing ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />}{syncing ? '正在保存草稿…' : successful ? '再保存一份草稿' : needsCheck ? '检查后重新同步' : '同步到公众号草稿'}</button></div>
    {(successful || needsCheck) && <p className="wechat-duplicate-note">{successful && latest.articleUpdatedAt < snapshot.updatedAt ? '当前文章已修改，上方是此前保存的草稿。' : ''}再次同步会新建一份草稿，请先检查已有记录。</p>}
  </Modal>
}
