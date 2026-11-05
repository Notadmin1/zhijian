import { useEffect, useMemo, useState } from 'react'
import { liveQuery } from 'dexie'
import { ArrowDownToLine, ArrowUpToLine, Plus, Save, Trash2 } from 'lucide-react'
import type { Article, ContentTemplate, ContentTemplatePosition } from '../types'
import { db } from '../lib/storage'
import { emptyDocument, imageNodes, plainText } from '../lib/document'
import { contentTemplateExamples, insertContentTemplate, saveContentTemplate, setAutomaticContentTemplate } from '../lib/content-templates'
import { renderArticle } from '../lib/render'
import Modal from './Modal'
import ContentTemplateEditor from './ContentTemplateEditor'

export default function ContentTemplateDialog({ article, assets, onInsert, onClose, notify }: {
  article: Article; assets: Record<string, string>; onInsert: (template: ContentTemplate) => Promise<void>; onClose: () => void; notify: (message: string, error?: boolean) => void
}) {
  const [templates, setTemplates] = useState<ContentTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState('')
  const [name, setName] = useState('')
  const [position, setPosition] = useState<ContentTemplatePosition>('header')
  const [document, setDocument] = useState(emptyDocument)
  const [revision, setRevision] = useState(0)
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const [working, setWorking] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [templateAssets, setTemplateAssets] = useState<Record<string, string>>({})
  const selected = templates.find(template => template.id === editingId)
  const changed = !selected || name !== selected.name || position !== selected.position || JSON.stringify(document) !== JSON.stringify(selected.document)
  const imageKey = [...new Set(imageNodes(document).map(node => node.attrs?.assetId).filter(Boolean))].sort().join(',')

  useEffect(() => {
    const subscription = liveQuery(() => db.contentTemplates.orderBy('updatedAt').reverse().toArray()).subscribe({
      next: rows => { setTemplates(rows); setLoading(false) },
      error: () => { setLoading(false); setError('模板库读取失败，请关闭后重新打开') },
    })
    return () => subscription.unsubscribe()
  }, [])
  useEffect(() => {
    let disposed = false
    const urls: Record<string, string> = {}
    setTemplateAssets({})
    void Promise.all(imageKey.split(',').filter(Boolean).map(async id => {
      const asset = await db.assets.get(id)
      if (asset && !disposed) urls[id] = URL.createObjectURL(asset.blob)
    })).then(() => { if (!disposed) setTemplateAssets(urls) }).catch(() => { if (!disposed) setError('部分模板图片读取失败，请重新添加') })
    return () => { disposed = true; Object.values(urls).forEach(url => URL.revokeObjectURL(url)) }
  }, [imageKey])

  const preview = useMemo(() => renderArticle({ ...article, document: insertContentTemplate(article.document, { position, document }).document, typography: { ...article.typography, includeTitle: false } }, { assets: { ...assets, ...templateAssets } }), [article, position, document, assets, templateAssets])
  const load = (value?: Pick<ContentTemplate, 'name' | 'position' | 'document'> & { id?: string }) => {
    setEditingId(value?.id || ''); setName(value?.name || ''); setPosition(value?.position || 'header'); setDocument(value ? structuredClone(value.document) : emptyDocument())
    setRevision(current => current + 1); setError(''); setConfirmDelete(false); setTab('edit')
  }
  const work = async (action: () => Promise<void>) => {
    if (working || pending) return
    setWorking(true); setError('')
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败，请重试') }
    finally { setWorking(false) }
  }
  const save = async (insert = false) => {
    const saved = await saveContentTemplate({ name, position, document }, editingId || undefined)
    setEditingId(saved.id); setName(saved.name); setDocument(saved.document)
    if (insert) await onInsert(saved)
    else notify('模板已保存，可设为自动添加或插入当前文章')
  }
  return <Modal title="开头与文末模板" eyebrow="YOUR ARTICLE SIGNATURE" wide className="content-template-modal" onClose={onClose}>
    <p className="modal-description">保存常用开场、作者介绍、关注提示和二维码。选择自动模板后，新建、导入 Word 和粘贴导入的文章会自动添加；已有草稿可手动插入。</p>
    <div className="content-template-defaults" aria-label="自动添加设置">{(['header', 'footer'] as const).map(target => <label key={target}><span>{target === 'header' ? <ArrowUpToLine size={15} /> : <ArrowDownToLine size={15} />}自动添加到{target === 'header' ? '开头' : '文末'}</span><select aria-label={`自动添加的${target === 'header' ? '开头' : '文末'}模板`} value={templates.find(template => template.position === target && template.autoInsert)?.id || ''} disabled={loading || working || pending} onChange={event => { const id = event.target.value; void work(async () => { await setAutomaticContentTemplate(target, id); notify(id ? '自动添加已设置，下次新建或导入文章时生效' : '已关闭该位置的自动添加') }) }}><option value="">不自动添加</option>{templates.filter(template => template.position === target).map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>)}</div>
    <div className="content-template-grid">
      <aside className="content-template-library" aria-label="已保存的开头与文末模板"><button className="button secondary" disabled={working || pending} onClick={() => load()}><Plus size={14} />新建模板</button>{loading ? <p>正在读取模板…</p> : templates.length ? templates.map(template => <button className="content-template-choice" key={template.id} disabled={working || pending} aria-label={`编辑模板 ${template.name}`} aria-pressed={editingId === template.id} onClick={() => load(template)}><span>{template.position === 'header' ? '开头' : '文末'}{template.autoInsert && <small>自动添加</small>}</span><strong>{template.name}</strong><p>{plainText(template.document) || '图片模板'}</p></button>) : <p className="empty-hint">还没有模板。可以填写内容，或从右侧示例开始。</p>}</aside>
      <section className="content-template-workspace" aria-label="模板设置">
        <div className="content-template-fields"><label>模板名称<input aria-label="模板名称" maxLength={40} value={name} placeholder="例如：作者开场 / 公众号二维码" disabled={working || pending} onChange={event => setName(event.target.value)} /></label><label>添加位置<select aria-label="模板添加位置" value={position} disabled={working || pending} onChange={event => { setPosition(event.target.value as ContentTemplatePosition); setConfirmDelete(false) }}><option value="header">文章开头</option><option value="footer">文章文末</option></select></label></div>
        <div className="content-template-examples"><span>从示例开始</span>{contentTemplateExamples.map(example => <button disabled={working || pending} key={example.name} onClick={() => load(example)}>{example.name}</button>)}</div>
        <div className="content-template-tabs" role="tablist" aria-label="模板编辑与预览"><button role="tab" aria-selected={tab === 'edit'} onClick={() => setTab('edit')}>编辑内容</button><button role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')}>插入效果预览</button><small>{changed ? '有未保存的修改' : '已保存'}</small></div>
        <div hidden={tab !== 'edit'}><ContentTemplateEditor key={revision} document={document} onChange={setDocument} onError={setError} onPending={setPending} disabled={working || pending} /><p className="content-template-hint">支持粘贴图文、加粗、链接、卡片和本地图片。选中多段应用卡片时，会合为一个卡片。选中图片可设置宽度、对齐及说明；可用于二维码。最多 10000 字、20 张图。</p></div>
        {tab === 'preview' && <div className="content-template-preview" aria-label="模板插入效果预览"><h3>{article.title || '未命名文章'}</h3><div className="rendered-article" dangerouslySetInnerHTML={{ __html: preview }} /></div>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="content-template-actions"><button className="button secondary" disabled={working || pending || !name.trim()} onClick={() => void work(() => save())}><Save size={14} />保存模板</button><button className="button primary" disabled={working || pending || !name.trim()} onClick={() => void work(() => save(true))}>{pending ? '正在处理图片…' : `${changed ? '保存并插入' : '插入'}当前文章${position === 'header' ? '开头' : '文末'}`}</button>{editingId && <button className="icon-button danger-hover" aria-label="删除当前模板" disabled={working || pending} onClick={() => setConfirmDelete(value => !value)}><Trash2 size={15} /></button>}</div>
        {confirmDelete && <div className="delete-confirmation"><p>删除“{selected?.name}”及其自动添加设置。文章里已经插入的内容会保留。</p><button className="button secondary" disabled={working} onClick={() => setConfirmDelete(false)}>取消</button><button className="button danger" disabled={working} onClick={() => void work(async () => { await db.contentTemplates.delete(editingId); load(); notify('模板已删除') })}>确认删除模板</button></div>}
      </section>
    </div>
    <p className="note">内容会作为普通图文插入，可继续编辑。相同内容已位于对应开头或文末时会跳过；模板随 ZIP 备份保存，插入前也会保留文章历史版本。</p>
  </Modal>
}
