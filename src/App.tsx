import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowLeft, ArrowRight, BatteryFull, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clipboard, Clock3, Copy, Download, Expand, FileArchive, FilePlus2, FileText, FileUp, FolderOpen, Image as ImageIcon, Leaf, ListTree, LoaderCircle, Monitor, MoreHorizontal, Palette, Plus, RotateCcw, Scan, Search, Send, ShieldCheck, Smartphone, Trash2, WandSparkles, Wifi, X } from 'lucide-react'
import type { Article, ArticleVersion, ContentTemplate, StylePreset, ThemeId } from './types'
import { blobToDataURL, checkpointArticle, db, downloadBlob, moveToTrash, saveArticles } from './lib/storage'
import { imageNodes, newArticle, plainText, sampleArticle, wordCount } from './lib/document'
import { createBackup, createImagePack, restoreBackup } from './lib/backup'
import { importWord } from './lib/import'
import { htmlFile, renderArticle } from './lib/render'
import { copyPlainText, copyRichText, prepareClipboard } from './lib/clipboard'
import { beautifyDocument, type BeautifyReport } from './lib/beautify'
import { safeTypography, themes } from './lib/themes'
import EditorPane from './components/EditorPane'
import StylePanel from './components/StylePanel'
import Modal from './components/Modal'
import BeautifiedPane from './components/BeautifiedPane'
import WeixinSyncDialog from './components/WeixinSyncDialog'
import OutlinePanel from './components/OutlinePanel'
import { documentOutline, scrollToArticleElement, type NavigationTarget } from './lib/outline'
import { applyPreferences, readPreferences, writePreferences } from './lib/preferences'
import { inspectLayout, isIssueIgnored } from './lib/inspection'
import LayoutCheckDialog from './components/LayoutCheckDialog'
import TemplateDialog from './components/TemplateDialog'
import PreviewResizeHandle from './components/PreviewResizeHandle'
import HistoryDialog from './components/HistoryDialog'
import RecycleBinDialog from './components/RecycleBinDialog'
import PresetDialog from './components/PresetDialog'
import { presetChanges } from './lib/presets'
import ReadingStyleDialog from './components/ReadingStyleDialog'
import ContentTemplateDialog from './components/ContentTemplateDialog'
import { applyContentTemplates, insertContentTemplate } from './lib/content-templates'

type Dialog = 'drafts' | 'paste' | 'export' | 'help' | 'copy' | 'preview' | 'warnings' | 'source' | 'delete' | 'sync' | 'outline' | 'check' | 'templates' | 'history' | 'trash' | 'presets' | 'reading' | 'contentTemplates' | null
type SaveState = 'saved' | 'saving' | 'error'

function formatDate(time: number) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(time)
}

export default function App() {
  const [articles, setArticles] = useState<Article[]>([])
  const [activeId, setActiveId] = useState('')
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [paste, setPaste] = useState('')
  const [query, setQuery] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({})
  const [editorVersion, setEditorVersion] = useState(0)
  const [mobileTab, setMobileTab] = useState<'editor' | 'preview' | 'style'>('editor')
  const [previewDevice, setPreviewDevice] = useState<'mobile' | 'desktop'>('mobile')
  const [deleteId, setDeleteId] = useState('')
  const [contentView, setContentView] = useState<'edit' | 'beautified'>('edit')
  const [preferences, setPreferences] = useState(readPreferences)
  const autoBeautify = preferences.autoBeautify
  const [sidebar, setSidebar] = useState<'none' | 'style' | 'outline'>(() => {
    try { const value = localStorage.getItem('zijian-sidebar'); return value === 'style' || value === 'outline' ? value : 'none' } catch { return 'none' }
  })
  const [focused, setFocused] = useState(false)
  const [previewVisible, setPreviewVisible] = useState(() => { try { return localStorage.getItem('zijian-preview-visible') !== 'false' } catch { return true } })
  const [previewWidth, setPreviewWidth] = useState(() => { try { return Math.max(280, Math.min(520, Number(localStorage.getItem('zijian-preview-width')) || 350)) } catch { return 350 } })
  const [navigation, setNavigation] = useState<NavigationTarget | null>(null)
  const [checkedAssets, setCheckedAssets] = useState<Set<string> | undefined>()
  const [wechatSyncing, setWechatSyncing] = useState(false)
  const [beautyReport, setBeautyReport] = useState<{ id: string; report: BeautifyReport } | null>(null)
  const [beforeBeauty, setBeforeBeauty] = useState<{ id: string; document: Article['document'] } | null>(null)
  const wordInput = useRef<HTMLInputElement>(null)
  const backupInput = useRef<HTMLInputElement>(null)
  const phoneScroll = useRef<HTMLDivElement>(null)
  const articleRef = useRef<Article[]>([])
  const pendingArticles = useRef(new Map<string, Article>())
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const revision = useRef(0)
  const readyRef = useRef(false)
  const active = articles.find(article => article.id === activeId) || articles[0]
  const outline = useMemo(() => active ? documentOutline(active.document) : [], [active?.document])
  const allLayoutIssues = useMemo(() => active ? inspectLayout(active, dialog === 'check' ? checkedAssets : undefined) : [], [active?.document, active?.typography, checkedAssets, dialog])
  const layoutIssues = allLayoutIssues.filter(issue => !isIssueIgnored(active, issue))
  const ignoredIssues = allLayoutIssues.filter(issue => isIssueIgnored(active, issue))

  useEffect(() => { writePreferences(preferences) }, [preferences])
  useEffect(() => { try { localStorage.setItem('zijian-preview-visible', String(previewVisible)); localStorage.setItem('zijian-preview-width', String(previewWidth)) } catch { /* Optional layout settings. */ } }, [previewVisible, previewWidth])
  useEffect(() => { try { localStorage.setItem('zijian-sidebar', sidebar) } catch { /* Optional layout preference. */ } }, [sidebar])
  useEffect(() => { setNavigation(current => current?.articleId === activeId ? current : null) }, [activeId])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !dialog) setFocused(false) }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [dialog])

  const notify = useCallback((message: string, error = false) => setToast({ message, error }), [])
  useEffect(() => {
    if (!toast) return
    const timeout = setTimeout(() => setToast(null), toast.error ? 8000 : 4500)
    return () => clearTimeout(timeout)
  }, [toast])

  useEffect(() => {
    let disposed = false
    db.transaction('rw', db.articles, async () => {
      if (await db.articles.count() === 0) await db.articles.put(sampleArticle())
      let data = (await db.articles.orderBy('updatedAt').reverse().toArray()).filter(article => !article.deletedAt)
      if (!data.length) { const fresh = newArticle(); await db.articles.put(fresh); data = [fresh] }
      return data
    }).then(data => {
      if (disposed) return
      data = data.map(article => ({ ...article, typography: safeTypography(article.typography) }))
      let lastId = ''
      try { lastId = localStorage.getItem('zijian-active') || '' } catch { /* IndexedDB remains the primary store. */ }
      articleRef.current = data
      setArticles(data)
      setActiveId(data.some(item => item.id === lastId) ? lastId : data[0].id)
      readyRef.current = true
      setReady(true)
    }).catch(error => { if (!disposed) setLoadError(`本地草稿库暂时不可用：${error instanceof Error ? error.message : '请检查浏览器存储权限'}`) })
    return () => { disposed = true }
  }, [])

  const flushSave = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = undefined
    if (!readyRef.current || !pendingArticles.current.size) return
    const pending = [...pendingArticles.current.values()]
    const currentRevision = revision.current
    setSaveState('saving')
    try {
      await saveArticles(pending)
      for (const article of pending) if (pendingArticles.current.get(article.id) === article) pendingArticles.current.delete(article.id)
      if (currentRevision === revision.current) setSaveState('saved')
    } catch (error) {
      setSaveState('error')
      throw error
    }
  }, [])

  const replaceArticles = useCallback((next: Article[]) => {
    const previous = new Map(articleRef.current.map(article => [article.id, article]))
    const ids = new Set(next.map(article => article.id))
    for (const id of pendingArticles.current.keys()) if (!ids.has(id)) pendingArticles.current.delete(id)
    for (const article of next) if (previous.get(article.id) !== article) pendingArticles.current.set(article.id, article)
    articleRef.current = next
    setArticles(next)
    revision.current++
    setSaveState('saving')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flushSave().catch(() => notify('草稿保存失败，请导出备份并检查浏览器存储空间', true)) }, 500)
  }, [flushSave, notify])

  useEffect(() => {
    const save = () => { if (document.visibilityState === 'hidden') void flushSave().catch(() => undefined) }
    const unload = (event: BeforeUnloadEvent) => {
      if (saveState !== 'saved') { event.preventDefault(); void flushSave().catch(() => undefined) }
    }
    document.addEventListener('visibilitychange', save)
    window.addEventListener('beforeunload', unload)
    return () => { document.removeEventListener('visibilitychange', save); window.removeEventListener('beforeunload', unload) }
  }, [flushSave, saveState])

  useEffect(() => {
    if (!activeId) return
    try { localStorage.setItem('zijian-active', activeId) } catch { /* Optional convenience only. */ }
  }, [activeId])

  const assetKey = active ? [...new Set(imageNodes(active.document).map(node => String(node.attrs?.assetId || '')).filter(Boolean))].sort().join(',') : ''
  useEffect(() => {
    let disposed = false
    const urls: Record<string, string> = {}
    if (!assetKey) { setAssetUrls({}); return }
    Promise.all(assetKey.split(',').map(async id => {
      const asset = await db.assets.get(id)
      if (asset && !disposed) urls[id] = URL.createObjectURL(asset.blob)
    })).then(() => { if (!disposed) setAssetUrls({ ...urls }) }).catch(() => notify('部分预览图片读取失败', true))
    return () => { disposed = true; Object.values(urls).forEach(url => URL.revokeObjectURL(url)) }
  }, [assetKey, notify])

  const update = (changes: Partial<Article>) => {
    if (!active) return
    replaceArticles(articleRef.current.map(article => article.id === active.id ? { ...article, ...changes, updatedAt: Date.now() } : article))
  }
  const applyTheme = (id: ThemeId) => {
    if (!active) return
    const typography = { ...active.typography, accent: themes.find(theme => theme.id === id)!.accent }
    update({ themeId: id, typography })
    setPreferences(current => ({ ...current, themeId: id, typography }))
  }
  const openLayoutCheck = () => void run(async () => {
    const ids = await db.assets.toCollection().primaryKeys()
    setCheckedAssets(new Set(ids))
    setDialog('check')
  })
  const applyBeautify = () => void run(async () => {
    if (!active) return
    await flushSave()
    await checkpointArticle(active, '一键美化前')
    setBeforeBeauty({ id: active.id, document: structuredClone(active.document) })
    const result = beautifyDocument(active.document)
    update({ document: result.document })
    setNavigation(null)
    setBeautyReport({ id: active.id, report: result.report })
    setEditorVersion(value => value + 1)
    setContentView('beautified')
    setMobileTab('editor')
    notify(`美化完成：${result.report.headings} 个标题、${result.report.codeBlocks} 段代码，原文可随时恢复`)
  })
  const undoBeautify = () => {
    if (!beforeBeauty || beforeBeauty.id !== active?.id) return
    update({ document: beforeBeauty.document })
    setNavigation(null)
    setBeforeBeauty(null)
    setBeautyReport(null)
    setEditorVersion(value => value + 1)
    setContentView('edit')
    notify('已撤销本次美化')
  }
  const run = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try { await work() } catch (error) { notify(error instanceof Error ? error.message : '操作失败，请重试', true) }
    finally { setBusy(false) }
  }
  const saveCurrentVersion = () => run(async () => {
    await flushSave()
    await checkpointArticle(active, '手动保存')
    notify('当前版本已留档，可关闭后重新打开查看')
  })
  const restoreVersion = (version: ArticleVersion) => void run(async () => {
    await flushSave()
    await checkpointArticle(active, '恢复历史版本前')
    update({ title: version.article.title, document: structuredClone(version.article.document), themeId: version.article.themeId, typography: safeTypography(version.article.typography), ignoredLayoutIssues: [...(version.article.ignoredLayoutIssues || [])] })
    setEditorVersion(value => value + 1)
    setBeforeBeauty(null)
    setBeautyReport(null)
    setNavigation(null)
    setContentView('edit')
    setMobileTab('editor')
    await flushSave()
    setDialog(null)
    notify('已恢复选中版本，恢复前的内容也已留档')
  })
  const applyPreset = (preset: StylePreset, includeFooter: boolean) => void run(async () => {
    await flushSave()
    await checkpointArticle(active, `应用方案“${preset.name}”前`)
    const changes = presetChanges(active, preset, includeFooter)
    update(changes)
    setPreferences(current => ({ ...current, themeId: preset.themeId, typography: safeTypography(preset.typography) }))
    setBeforeBeauty(null)
    setBeautyReport(null)
    setEditorVersion(value => value + 1)
    setContentView('beautified')
    setMobileTab('editor')
    await flushSave()
    setDialog(null)
    notify(`已应用个人方案“${preset.name}”${includeFooter && preset.footer ? '，文末已插入（相同文末不会重复添加）' : ''}`)
  })
  const openArticle = async (id: string) => {
    await flushSave()
    setActiveId(id)
    setDialog(null)
    setMobileTab('editor')
  }
  const insertTemplate = async (template: ContentTemplate) => {
    const result = insertContentTemplate(active.document, template)
    if (!result.inserted) { notify('相同模板内容已在文章对应位置，已跳过重复添加'); return }
    await flushSave()
    await checkpointArticle(active, `插入${template.position === 'header' ? '开头' : '文末'}模板“${template.name}”前`)
    update({ document: result.document })
    setEditorVersion(value => value + 1)
    setBeforeBeauty(null)
    setBeautyReport(null)
    setNavigation(null)
    await flushSave()
    setDialog(null)
    setContentView('beautified')
    setMobileTab('editor')
    notify(`已将“${template.name}”添加到文章${template.position === 'header' ? '开头' : '文末'}，可继续编辑或从历史版本恢复`)
  }
  const createArticle = (title?: string, document?: Article['document']) => applyPreferences(newArticle(title, document), preferences)
  const addArticle = async (article = createArticle()) => {
    await flushSave()
    const blankBody = article.document.content?.length === 1 && article.document.content[0].type === 'paragraph' && !plainText(article.document) ? article.document.content[0] : undefined
    const templates = (await db.contentTemplates.orderBy('updatedAt').reverse().toArray()).filter(template => template.autoInsert)
    article = { ...article, document: applyContentTemplates(article.document, templates) }
    setBeforeBeauty(current => current?.id === article.id ? { ...current, document: applyContentTemplates(current.document, templates) } : current)
    await db.transaction('rw', db.articles, db.versions, async () => {
      await db.articles.put(article)
      await checkpointArticle({ ...article, document: structuredClone(article.sourceSnapshot) }, '创建或导入时')
    })
    replaceArticles([article, ...articleRef.current])
    setActiveId(article.id)
    setDialog(null)
    setMobileTab('editor')
    setContentView('edit')
    if (blankBody && templates.length) setNavigation({ articleId: article.id, block: article.document.content!.indexOf(blankBody), request: Date.now() })
  }
  const uploadWord = (file: File) => void run(async () => {
    const result = await importWord(file)
    const article = createArticle(file.name.replace(/\.docx$/i, ''), result.document)
    if (autoBeautify) {
      const beautiful = beautifyDocument(result.document)
      setBeforeBeauty({ id: article.id, document: structuredClone(result.document) })
      article.document = beautiful.document
      setBeautyReport({ id: article.id, report: beautiful.report })
    }
    await addArticle(article)
    setEditorVersion(value => value + 1)
    setContentView(autoBeautify ? 'beautified' : 'edit')
    setWarnings(result.warnings)
    if (result.warnings.length) setDialog('warnings')
    notify(autoBeautify ? `Word 已导入并自动美化${result.recoveredHeadings ? `，已恢复 ${result.recoveredHeadings} 处标题样式` : ''}` : 'Word 已导入，可点击“一键美化”完成排版')
  })
  const copy = async (imagePolicy: 'embed' | 'placeholder' = 'embed') => {
    if (!active) return
    const content = await prepareClipboard(active, imagePolicy)
    await copyRichText(content.html, content.text)
    setDialog(null)
    notify(images && imagePolicy === 'embed' ? '已复制美化图文，请粘贴到公众号后台，并检查图片是否被平台接收' : '已复制排版正文，请粘贴到公众号后台检查后发布')
  }
  const exportHTML = async () => {
    if (!active) return
    const sources: Record<string, string> = {}
    for (const id of assetKey.split(',').filter(Boolean)) {
      const asset = await db.assets.get(id)
      if (!asset) throw new Error('有本地图片已丢失，请重新添加后导出')
      sources[id] = await blobToDataURL(asset.blob)
    }
    downloadBlob(new Blob([htmlFile(active.title, renderArticle(active, { mode: 'download', assets: sources }))], { type: 'text/html;charset=utf-8' }), `${active.title || '未命名文章'}.html`)
    notify('HTML 已导出，本地图片已嵌入文件；远程图片仍依赖来源链接')
    setDialog(null)
  }
  const backup = async () => {
    await flushSave()
    downloadBlob(await createBackup(articleRef.current), `字间备份-${new Date().toISOString().slice(0, 10)}.zip`)
    notify('全部草稿及本地图片已备份')
  }
  const restore = (file: File) => void run(async () => {
    await flushSave()
    const restored = await restoreBackup(file)
    const visible = restored.filter(article => !article.deletedAt)
    replaceArticles([...visible, ...articleRef.current])
    if (visible.length) setActiveId(visible[0].id)
    setDialog(null)
    notify(`已恢复 ${visible.length} 篇草稿${restored.length > visible.length ? `和 ${restored.length - visible.length} 篇回收站文章` : ''}，历史版本、个人方案和开头文末模板一并恢复，原有草稿已保留`)
  })
  const count = active ? wordCount(active.document) : 0
  const images = active ? imageNodes(active.document).length : 0
  const preview = useMemo(() => active ? renderArticle({ ...active, typography: { ...active.typography, includeTitle: false } }, { assets: assetUrls }) : '', [active, assetUrls])
  const currentTheme = themes.find(theme => theme.id === active?.themeId) || themes[0]
  useEffect(() => {
    if (!navigation || navigation.articleId !== active?.id) return
    const selector = navigation.section !== undefined ? `[data-section-index="${navigation.section}"]` : `[data-block-index="${navigation.block}"]`
    scrollToArticleElement(phoneScroll.current?.querySelector(selector) || null, phoneScroll.current)
  }, [navigation, active?.id, preview, contentView, mobileTab])
  const draftList = articles.filter(article => article.title.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.updatedAt - a.updatedAt)
  const navigateSection = (section: number) => {
    if (!active) return
    setNavigation({ articleId: active.id, section, request: Date.now() })
    setMobileTab('editor')
    if (dialog === 'outline') setDialog(null)
  }
  const editBlock = (block?: number) => {
    setContentView('edit')
    setMobileTab('editor')
    if (block !== undefined) setNavigation({ articleId: active.id, block, request: Date.now() })
  }
  const toggleSidebar = (panel: 'style' | 'outline') => {
    setFocused(false)
    if (window.matchMedia('(max-width: 760px)').matches) {
      if (panel === 'outline') setDialog('outline')
      else setMobileTab(value => value === 'style' ? 'editor' : 'style')
    } else setSidebar(value => value === panel ? 'none' : panel)
  }

  if (!ready) return <div className="loading-page"><div className="brand-mark">字</div><h1>字间</h1>{loadError ? <><p>{loadError}</p><button className="button primary" onClick={() => location.reload()}>重新尝试</button></> : <><LoaderCircle className="spin" size={22} /><p>正在打开你的写作空间…</p></>}</div>

  return <div className="app-shell" data-mobile-tab={mobileTab} data-focused={focused}>
    <header className="app-header">
      <a className="brand" href="#" onClick={event => event.preventDefault()} aria-label="字间文章排版工作台"><div className="brand-mark">字</div><div className="brand-name">字间<span>ARTICLE STUDIO</span></div></a>
      <span className="header-divider" />
      <button className="draft-nav" onClick={() => { setQuery(''); setDialog('drafts') }}><FolderOpen size={17} /><span>我的草稿</span><ChevronRight size={13} /><span className="current-draft-name">{active.title || '未命名文章'}</span></button>
      <div className={`save-status save-${saveState}`} role="status">{saveState === 'saving' ? <LoaderCircle size={13} className="spin" /> : saveState === 'error' ? <button onClick={() => void run(flushSave)}>重试保存</button> : <CheckCheck size={14} />}<span>{saveState === 'saved' ? '已保存到本地' : saveState === 'saving' ? '保存中…' : '保存失败'}</span></div>
      <div className="header-actions"><button className="icon-button new-article-button" aria-label="新建文章" title="新建文章" onClick={() => void run(() => addArticle())} disabled={busy}><Plus size={18} /></button><button className="button secondary import-button" onClick={() => wordInput.current?.click()} disabled={busy}><FileUp size={16} /><span>导入 Word</span></button><button className="icon-button help-button" title="使用指南" aria-label="使用指南" onClick={() => setDialog('help')}><CircleHelp size={20} /></button></div>
    </header>

    <div className="workspace-heading"><div><div className="workspace-eyebrow"><span />导入文章 → 整理排版 → 预览检查</div><h1>把文章排好，让阅读更轻松<span>。</span></h1></div><div className="workspace-actions"><button className="button quiet export-menu-button" onClick={() => setDialog('export')}><Download size={16} /><span>导出</span><ChevronDown size={13} /></button><button className="button beautify-button" title="整理标题、代码与段落，保留你的样式设置" onClick={applyBeautify} disabled={busy}><WandSparkles size={16} /><span>一键美化</span></button><button className="button sync-button" onClick={() => setDialog('sync')} disabled={busy}>{wechatSyncing ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}<span>{wechatSyncing ? '同步进度' : '同步草稿'}</span></button><button className="button primary copy-button" onClick={() => void run(copy)} disabled={busy}><Copy size={16} /><span>复制到公众号</span><ArrowRight size={15} /></button></div></div>

    <div className="workbench-tools">
      <div><button aria-label="文章目录" aria-pressed={!focused && sidebar === 'outline'} onClick={() => toggleSidebar('outline')}><ListTree size={16} /><span>文章目录</span><small>{outline.length}</small></button><button aria-label="排版样式" aria-pressed={!focused && sidebar === 'style'} onClick={() => toggleSidebar('style')}><Palette size={16} /><span>排版样式</span></button><span className="workbench-tool-divider" /><button aria-label={focused ? '退出专注模式' : '专注模式'} aria-pressed={focused} onClick={() => { setFocused(value => !value); setMobileTab('editor') }}><Scan size={16} /><span>{focused ? '退出专注' : '专注模式'}</span></button><button aria-label="排版检查" onClick={openLayoutCheck}><ShieldCheck size={16} /><span>排版检查</span>{layoutIssues.length > 0 && <small>{layoutIssues.length}</small>}</button></div>
      <div className="preview-controls">
        <button className="preview-toggle" aria-label={previewVisible && contentView === 'edit' && !focused ? '收起手机预览' : '显示手机预览'} aria-pressed={previewVisible && contentView === 'edit' && !focused} onClick={() => { if (contentView !== 'edit' || focused) { setContentView('edit'); setFocused(false); setPreviewVisible(true) } else setPreviewVisible(value => !value) }}><Smartphone size={15} /><span>{previewVisible && contentView === 'edit' && !focused ? '收起预览' : '展开预览'}</span></button>
        <button className="reading-preview-button" aria-label="阅读预览" title="放大阅读预览" onClick={() => { setPreviewDevice('mobile'); setDialog('preview') }}><Expand size={15} /><span>阅读预览</span></button>
      </div>
    </div>

    <div className="mobile-navigation"><button className={mobileTab === 'style' ? 'active' : ''} onClick={() => setMobileTab('style')}>主题与样式</button><button className={mobileTab === 'editor' ? 'active' : ''} onClick={() => setMobileTab('editor')}>正文编辑</button><button className={mobileTab === 'preview' ? 'active' : ''} onClick={() => setMobileTab('preview')}>手机预览</button></div>

    <main className="workspace" inert={busy} data-sidebar={sidebar} data-content-view={contentView} data-preview-visible={previewVisible} style={{ '--preview-width': `${previewWidth}px` } as React.CSSProperties}>
      <StylePanel article={active} autoBeautify={autoBeautify} onAutoBeautify={value => setPreferences(current => ({ ...current, autoBeautify: value }))} onTheme={applyTheme} onCompare={() => setDialog('templates')} onPresets={() => setDialog('presets')} onCompareReading={() => setDialog('reading')} onContentTemplates={() => setDialog('contentTemplates')} onTypography={typography => {
        update({ typography })
        setPreferences(current => ({ ...current, themeId: active.themeId, typography }))
      }} onClose={() => { setSidebar('none'); setMobileTab('editor') }} />
      {sidebar === 'outline' && <OutlinePanel entries={outline} selected={navigation?.articleId === active.id ? navigation.section : undefined} onNavigate={navigateSection} onClose={() => setSidebar('none')} />}
      <div className="editor-area"><div className="editor-entry-bar"><div className="content-view-tabs"><button className={contentView === 'edit' ? 'active' : ''} onClick={() => setContentView('edit')}><FileText size={13} />原文编辑</button><button className={contentView === 'beautified' ? 'active' : ''} onClick={() => setContentView('beautified')}><WandSparkles size={13} />美化效果</button></div><button onClick={() => { setPaste(''); setDialog('paste') }}><Clipboard size={14} />粘贴文章</button><span className="entry-divider" /><button onClick={() => setDialog('source')}><RotateCcw size={13} />查看原稿</button><button onClick={() => setDialog('history')}><Clock3 size={13} />历史版本</button></div><div className="editor-component" style={{ display: contentView === 'edit' ? 'flex' : 'none' }} aria-hidden={contentView !== 'edit'}><EditorPane key={`${active.id}-${editorVersion}`} article={active} onChange={document => { update({ document }); setBeforeBeauty(null); setBeautyReport(null); setNavigation(null) }} onTitleChange={title => update({ title })} notify={notify} navigation={contentView === 'edit' ? navigation : null} /></div>{contentView === 'beautified' && <BeautifiedPane article={active} html={preview} report={beautyReport?.id === active.id ? beautyReport.report : undefined} canUndo={beforeBeauty?.id === active.id} onUndo={undoBeautify} onEdit={editBlock} navigation={navigation} />}</div>
      <aside className="preview-panel">
        <PreviewResizeHandle width={previewWidth} onChange={setPreviewWidth} />
        <div className="preview-panel-heading"><div><Smartphone size={16} /><strong>阅读预览</strong></div><button className="icon-button" aria-label="放大阅读预览" title="放大预览" onClick={() => setDialog('preview')}><Expand size={16} /></button></div>
        <div className="preview-subheading">换个视角，读一遍自己的文字</div>
        <div className="phone-stage"><div className="phone-frame">
          <div className="phone-status"><span>9:41</span><div className="phone-island" /><span><Wifi size={13} /><BatteryFull size={17} /></span></div>
          <div className="phone-nav"><ArrowLeft size={17} /><span>图文消息</span><MoreHorizontal size={19} /></div>
          <div ref={phoneScroll} className="phone-scroll"><div className="phone-article">
            <h1 className="phone-article-title">{active.title || '未命名文章'}</h1>
            <div className="phone-author"><span style={{ color: active.typography.accent }}>你的公众号</span><span>预览</span></div>
            <div data-testid="article-preview" className="rendered-article" dangerouslySetInnerHTML={{ __html: preview }} />
            <div className="phone-end"><Leaf size={14} /><span>感谢阅读</span></div>
          </div></div>
          <div className="phone-home" />
        </div></div>
        <div className="preview-caption"><span style={{ background: currentTheme.accent }} />{currentTheme.name}<span className="caption-divider">/</span>手机阅读视图</div>
        <div className="preview-note"><ShieldCheck size={15} /><span>发布前，请在公众号后台检查最终效果</span></div>
      </aside>
    </main>

    <footer className="app-footer"><div><span className="footer-status-dot" />本地草稿<span className="footer-separator" />{count.toLocaleString()} 字<span className="footer-separator" /><Clock3 size={12} />约 {Math.max(1, Math.ceil(count / 400))} 分钟阅读{images > 0 && <><span className="footer-separator" /><ImageIcon size={12} />{images} 张图片</>}</div><button onClick={() => setDialog('help')}>把时间留给创作<span>✧</span></button></footer>

    <input ref={wordInput} data-testid="word-input" type="file" accept=".docx,.doc" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) uploadWord(file) }} />
    <input ref={backupInput} data-testid="backup-input" type="file" accept=".zip" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) restore(file) }} />
    <WeixinSyncDialog open={dialog === 'sync'} article={active} onClose={() => setDialog(null)} onBusyChange={setWechatSyncing} beforeSync={flushSave} notify={notify} />
    {dialog === 'check' && <LayoutCheckDialog issues={layoutIssues} ignored={ignoredIssues} onIgnore={issue => update({ ignoredLayoutIssues: [...new Set([...(active.ignoredLayoutIssues || []), issue.ignoreKey])].slice(-500) })} onRestore={key => update({ ignoredLayoutIssues: (active.ignoredLayoutIssues || []).filter(item => item !== key) })} onLocate={block => { setDialog(null); editBlock(block) }} onBeautify={() => { setDialog(null); applyBeautify() }} onClose={() => setDialog(null)} />}
    {dialog === 'history' && <HistoryDialog article={active} busy={busy} onSave={saveCurrentVersion} onRestore={restoreVersion} onClose={() => setDialog(null)} />}
    {dialog === 'presets' && <PresetDialog article={active} busy={busy} onApply={applyPreset} onClose={() => setDialog(null)} notify={notify} />}
    {dialog === 'trash' && <RecycleBinDialog onClose={() => setDialog('drafts')} notify={notify} onRestore={article => { replaceArticles([article, ...articleRef.current.filter(item => item.id !== article.id)]); setActiveId(article.id); setEditorVersion(value => value + 1); setBeforeBeauty(null); setBeautyReport(null); setContentView('edit'); setMobileTab('editor'); setDialog(null) }} />}
    {dialog === 'templates' && <TemplateDialog article={active} assets={assetUrls} onApply={id => { applyTheme(id); setDialog(null); setContentView('beautified'); setMobileTab('editor'); notify(`已应用${themes.find(theme => theme.id === id)!.name}版式`) }} onClose={() => setDialog(null)} />}
    {dialog === 'reading' && <ReadingStyleDialog article={active} assets={assetUrls} onApply={typography => { update({ typography }); setPreferences(current => ({ ...current, themeId: active.themeId, typography })); setDialog(null); setContentView('beautified'); setMobileTab('editor'); notify('已应用阅读风格，可继续微调或保存为个人方案') }} onClose={() => setDialog(null)} />}
    {dialog === 'contentTemplates' && <ContentTemplateDialog article={active} assets={assetUrls} onInsert={insertTemplate} onClose={() => setDialog(null)} notify={notify} />}

    {dialog === 'paste' && <Modal title="把文章带到字间" eyebrow="IMPORT YOUR WORDS" onClose={() => setDialog(null)}>
      <p className="modal-description">在下方粘贴纯文本，导入为一篇新草稿。若要保留粗体、列表和图片，请直接粘贴到正文编辑区。</p>
      <textarea className="paste-textarea" data-autofocus aria-label="待导入文章" placeholder="在这里粘贴你的文章…" value={paste} onChange={event => setPaste(event.target.value)} />
      <div className="modal-actions"><span className="muted small">导入不会覆盖当前文章</span><button className="button primary" disabled={!paste.trim() || busy} onClick={() => void run(async () => {
        const document = { type: 'doc', content: paste.replace(/\r\n?/g, '\n').split('\n').map(line => ({ type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}) })) }
        const article = createArticle('粘贴的文章', document)
        if (autoBeautify) {
          const result = beautifyDocument(document)
          setBeforeBeauty({ id: article.id, document: structuredClone(document) })
          article.document = result.document
          setBeautyReport({ id: article.id, report: result.report })
        }
        await addArticle(article)
        setContentView(autoBeautify ? 'beautified' : 'edit')
        notify(autoBeautify ? '文章已导入并自动美化，可查看效果或继续编辑' : '文章已导入，点击“一键美化”开始排版')
      })}><FilePlus2 size={16} />导入为新文章</button></div>
    </Modal>}

    {dialog === 'outline' && <Modal title="文章目录" onClose={() => setDialog(null)}><OutlinePanel entries={outline} selected={navigation?.section} onNavigate={navigateSection} onClose={() => setDialog(null)} /></Modal>}

    {dialog === 'drafts' && <Modal title="我的草稿" eyebrow="YOUR WRITING COLLECTION" wide onClose={() => setDialog(null)}>
      <div className="draft-modal-toolbar"><label className="search-field"><Search size={16} /><input data-autofocus aria-label="搜索草稿" placeholder="搜索文章标题…" value={query} onChange={event => setQuery(event.target.value)} /></label><button className="button secondary" disabled={busy} onClick={() => void run(async () => { await flushSave(); setDialog('trash') })}><Trash2 size={15} />回收站</button><button className="button primary" disabled={busy} onClick={() => void run(() => addArticle())}><Plus size={16} />新建</button></div>
      <div className="draft-list">{draftList.length ? draftList.map(article => <div key={article.id} className={`draft-item ${article.id === active.id ? 'current' : ''}`}><button className="draft-open" onClick={() => void run(() => openArticle(article.id))} disabled={busy}><div className="draft-file-icon"><FileText size={23} /></div><div><strong>{article.title || '未命名文章'}</strong><span>{wordCount(article.document).toLocaleString()} 字 · {formatDate(article.updatedAt)}{article.id === active.id ? ' · 正在编辑' : ''}</span></div><ChevronRight size={17} /></button><button className="icon-button danger-hover" aria-label={`删除草稿 ${article.title}`} onClick={() => { setDeleteId(article.id); setDialog('delete') }}><Trash2 size={16} /></button></div>) : <div className="empty-hint">没有找到匹配的草稿</div>}</div>
      <div className="draft-backup-bar"><span><ShieldCheck size={14} />草稿只保存在当前浏览器，建议定期备份</span><div><button onClick={() => void run(backup)} disabled={busy}>备份全部</button><button onClick={() => backupInput.current?.click()} disabled={busy}>恢复备份</button></div></div>
    </Modal>}

    {dialog === 'export' && <Modal title="带着好内容出发" eyebrow="EXPORT & BACKUP" onClose={() => setDialog(null)}>
      <p className="modal-description">选择适合你的导出方式。公众号标题通常需要单独填写。</p>
      <div className="export-options"><button disabled={busy} onClick={() => setDialog('sync')}><span className="export-icon green"><Send size={20} /></span><div><strong>同步到公众号草稿箱</strong><small>通过文章同步助手自动转存图片并保存草稿</small></div><ChevronRight size={16} /></button></div>
      <div className="export-options"><button disabled={busy} onClick={() => void run(copy)}><span className="export-icon green"><Copy size={20} /></span><div><strong>复制公众号排版图文</strong><small>保留美化样式、本地图片和远程图片链接</small></div><ChevronRight size={16} /></button><button disabled={busy} onClick={() => void run(exportHTML)}><span className="export-icon blue"><FileText size={20} /></span><div><strong>下载 HTML 文件</strong><small>可独立打开，内含“复制到公众号”按钮</small></div><ChevronRight size={16} /></button><button disabled={busy} onClick={() => void run(async () => { await copyPlainText(`${active.typography.includeTitle ? `${active.title}\n\n` : ''}${plainText(active.document)}`); notify('纯文本已复制'); setDialog(null) })}><span className="export-icon sand"><Clipboard size={20} /></span><div><strong>复制纯文本</strong><small>保留文字内容，去除所有排版样式</small></div><ChevronRight size={16} /></button>{images > 0 && <><button disabled={busy} onClick={() => void run(async () => { downloadBlob(await createImagePack(active), `${active.title || '文章'}-图片.zip`); notify('图片包已导出，请按编号上传到公众号后台') })}><span className="export-icon sand"><ImageIcon size={20} /></span><div><strong>导出文章图片</strong><small>平台未接收图片时，可用原图重新上传</small></div><ChevronRight size={16} /></button><button disabled={busy} onClick={() => setDialog('copy')}><span className="export-icon gray"><ImageIcon size={20} /></span><div><strong>兼容复制（图片占位）</strong><small>仅在平台不接收嵌入图片时使用</small></div><ChevronRight size={16} /></button></>}<button disabled={busy} onClick={() => void run(backup)}><span className="export-icon gray"><FileArchive size={20} /></span><div><strong>备份全部草稿</strong><small>保存正文、主题设置、原稿和本地图片</small></div><ChevronRight size={16} /></button><button disabled={busy} onClick={() => backupInput.current?.click()}><span className="export-icon gray"><FolderOpen size={20} /></span><div><strong>恢复备份包</strong><small>恢复为新草稿，保留已有文章</small></div><ChevronRight size={16} /></button></div>
    </Modal>}

    {dialog === 'copy' && <Modal title="发布前，照顾一下图片" eyebrow="IMAGE CHECK" onClose={() => setDialog(null)}>
      <div className="image-check-illustration"><ImageIcon size={33} strokeWidth={1.4} /><span>{images}</span></div><p className="modal-description">文章包含 <strong>{images} 张图片</strong>。复制时会在图片原位置保留编号占位，请将图片导出，在公众号后台上传并替换，避免发布后缺图。</p><p className="note">远程图片在导出包中提供来源链接，需从来源另行保存。排版文字可正常复制。</p>
      <div className="modal-actions"><button className="button secondary" disabled={busy} onClick={() => void run(async () => { downloadBlob(await createImagePack(active), `${active.title || '文章'}-图片.zip`); notify('图片包已导出') })}><ArrowDownToLine size={16} />导出图片</button><button className="button primary" disabled={busy} onClick={() => void run(() => copy('placeholder'))}><Copy size={16} />复制正文与占位</button></div>
    </Modal>}

    {dialog === 'help' && <Modal title="从原稿到好看的文章" eyebrow="A LITTLE GUIDE" onClose={() => setDialog(null)}>
      <div className="guide-steps"><div><span>01</span><section><h3>带入你的内容</h3><p>导入 .docx 文件，或使用“粘贴文章”。默认自动识别标题、代码和长段落，直接显示美化结果。</p></section></div><div><span>02</span><section><h3>一键美化，随心调整</h3><p>已有草稿点击“一键美化”。切换主题，调整字号、行距、段距、章节装饰和开篇导读；可撤销美化或查看原稿。</p></section></div><div><span>03</span><section><h3>复制图文，然后发布</h3><p>点击“复制到公众号”，在后台粘贴，单独填写标题。检查图片、表格和间距；若平台未接收图片，可在“导出”中下载原图重新上传。</p></section></div></div>
      <div className="help-local"><ShieldCheck size={20} /><p><strong>你的文章，保存在你的浏览器里</strong><span>排版与本地保存无需登录。主动点击“同步草稿”后，扩展会把所选图文上传到公众号。清理浏览器数据前请备份草稿。外部图片预览会访问来源网站。</span></p></div><div className="modal-actions"><button className="button primary" onClick={() => setDialog(null)}>开始创作<ArrowRight size={16} /></button></div>
    </Modal>}

    {dialog === 'preview' && <Modal title="把自己当作读者" eyebrow="READING PREVIEW" wide onClose={() => setDialog(null)}><div className="preview-device-tabs"><button className={previewDevice === 'mobile' ? 'active' : ''} onClick={() => setPreviewDevice('mobile')}><Smartphone size={15} />手机</button><button className={previewDevice === 'desktop' ? 'active' : ''} onClick={() => setPreviewDevice('desktop')}><Monitor size={15} />宽屏</button></div><div className={`large-preview ${previewDevice}`}><h1>{active.title || '未命名文章'}</h1><div className="rendered-article" dangerouslySetInnerHTML={{ __html: preview }} /></div><p className="note">此处展示阅读参考，公众号可能会处理部分样式，请粘贴后检查。</p></Modal>}

    {dialog === 'warnings' && <Modal title="Word 导入完成，请检查这些内容" eyebrow="IMPORT NOTES" onClose={() => setDialog(null)}><p className="modal-description">已保留可识别的正文，以下 Word 特性可能无法完整转换：</p><ul className="warning-list">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul><div className="modal-actions"><button className="button primary" onClick={() => setDialog(null)}>检查文章<ArrowRight size={16} /></button></div></Modal>}

    {dialog === 'source' && <Modal title="导入时的原稿" eyebrow="ORIGINAL SNAPSHOT" wide onClose={() => setDialog(null)}><p className="modal-description">这里保留文章创建或导入时的正文快照。恢复仅替换当前正文，保留标题与主题。恢复前会自动保存当前历史版本。</p><pre className="source-snapshot">{plainText(active.sourceSnapshot) || '这篇文章从空白草稿开始，原稿为空。'}</pre><div className="modal-actions"><button className="button secondary" onClick={() => setDialog(null)}>关闭</button><button className="button primary" disabled={busy} onClick={() => void run(async () => { await flushSave(); await checkpointArticle(active, '恢复原稿前'); update({ document: structuredClone(active.sourceSnapshot) }); setEditorVersion(value => value + 1); setBeforeBeauty(null); setBeautyReport(null); setContentView('edit'); await flushSave(); setDialog(null); notify('已恢复导入时的原稿，恢复前的内容已留档') })}><RotateCcw size={15} />恢复这份原稿</button></div></Modal>}

    {dialog === 'delete' && <Modal title="删除这篇草稿？" eyebrow="DELETE DRAFT" onClose={() => setDialog('drafts')}><p className="modal-description">“{articles.find(article => article.id === deleteId)?.title || '未命名文章'}”会移入回收站。正文、图片和历史版本会保留，可随时恢复。</p><div className="modal-actions"><button className="button secondary" onClick={() => setDialog('drafts')}>保留草稿</button><button className="button danger" disabled={busy} onClick={() => void run(async () => {
      await flushSave()
      await moveToTrash(deleteId)
      let next = articleRef.current.filter(article => article.id !== deleteId)
      if (!next.length) { const fresh = newArticle(); await db.articles.put(fresh); next = [fresh] }
      replaceArticles(next)
      if (deleteId === active.id) setActiveId(next[0].id)
      setDialog('drafts')
      notify('草稿已移入回收站，可从“我的草稿 → 回收站”恢复')
    })}><Trash2 size={15} />删除草稿</button></div></Modal>}

    {busy && <div className="busy-indicator" role="status"><LoaderCircle size={15} className="spin" />正在处理，请稍候…</div>}
    {toast && <div className={`toast ${toast.error ? 'toast-error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <CircleHelp size={18} /> : <Check size={18} />}<span>{toast.message}</span><button aria-label="关闭提示" onClick={() => setToast(null)}><X size={15} /></button></div>}
  </div>
}
