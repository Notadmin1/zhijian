import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import { Bold, Italic, Underline, List, ListOrdered, Quote, Minus, ImagePlus, Link2, Undo2, Redo2, WandSparkles, Table2, RemoveFormatting, Code, Code2 } from 'lucide-react'
import type { Article } from '../types'
import { editorExtensions, insertArticleTable, toggleCodeSelection } from '../lib/tiptap'
import type { SelectionBookmark } from '@tiptap/pm/state'
import { addAsset } from '../lib/storage'
import { prepareHTML } from '../lib/import'
import { headingCandidates, tidyDocument } from '../lib/document'
import { safeURL } from '../lib/render'
import Modal from './Modal'
import { scrollToArticleElement, type NavigationTarget } from '../lib/outline'
import { calloutKinds } from '../lib/callouts'
import { selectedCallout, setCalloutSelection } from '../lib/callout-selection'
import CodeBlockTools from './CodeBlockTools'
import TableTools from './TableTools'

interface Props {
  article: Article
  onChange: (document: JSONContent) => void
  onTitleChange: (title: string) => void
  notify: (message: string, error?: boolean) => void
  navigation: NavigationTarget | null
}

export default function EditorPane({ article, onChange, onTitleChange, notify, navigation }: Props) {
  const imageInput = useRef<HTMLInputElement>(null)
  const [dialog, setDialog] = useState<'tidy' | 'link' | 'table' | null>(null)
  const [tableSize, setTableSize] = useState({ rows: 3, cols: 2, header: true })
  const tableSelection = useRef<SelectionBookmark | undefined>(undefined)
  const [selected, setSelected] = useState<number[]>([])
  const [link, setLink] = useState('')
  const [pending, setPending] = useState(false)
  const latest = useRef({ onChange, notify })
  latest.current = { onChange, notify }

  const addImages = async (files: File[]) => {
    setPending(true)
    try {
      for (const file of files) {
        const asset = await addAsset(file, file.name)
        editor?.chain().focus().insertContent({ type: 'image', attrs: { src: `asset:${asset.id}`, assetId: asset.id, alt: file.name, title: '' } }).run()
      }
      latest.current.notify(`已添加 ${files.length} 张图片；复制发布时可导出图片包`)
    } catch (error) { latest.current.notify(error instanceof Error ? error.message : '图片添加失败', true) }
    finally { setPending(false) }
  }

  const editor = useEditor({
    extensions: editorExtensions(),
    content: article.document,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { class: 'article-editor', 'aria-label': '文章正文', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'false' },
      handlePaste: (_view, event) => {
        const html = event.clipboardData?.getData('text/html')
        const files = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith('image/'))
        if (files.length && !html) { event.preventDefault(); void addImages(files); return true }
        if (html) {
          event.preventDefault()
          setPending(true)
          void prepareHTML(html, files).then(clean => editor?.chain().focus().insertContent(clean).run()).catch(error => latest.current.notify(error instanceof Error ? error.message : '粘贴失败', true)).finally(() => setPending(false))
          return true
        }
        return false
      },
      handleDrop: (_view, event, _slice, moved) => {
        if (moved) return false
        const files = Array.from(event.dataTransfer?.files || []).filter(file => file.type.startsWith('image/'))
        if (!files.length) return false
        event.preventDefault()
        void addImages(files)
        return true
      },
    },
    onUpdate: ({ editor: current }) => latest.current.onChange(current.getJSON()),
  })
  useEffect(() => {
    if (!editor || navigation?.articleId !== article.id) return
    let position: number | undefined
    if (navigation.section !== undefined) {
      let index = 0
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading' && index++ === navigation.section) position = pos
      })
    } else if (navigation.block !== undefined) {
      editor.state.doc.forEach((_node, pos, index) => { if (index === navigation.block) position = pos })
    }
    if (position === undefined) return
    editor.commands.setTextSelection(Math.min(position + 1, editor.state.doc.content.size))
    // Focus without moving the whole workbench; only the article pane should scroll.
    editor.view.dom.focus({ preventScroll: true })
    const element = editor.view.nodeDOM(position)
    scrollToArticleElement(element instanceof Element ? element : null, editor.view.dom.closest('.editor-scroll'))
  }, [editor, navigation, article.id])
  const candidates = editor ? headingCandidates(editor.getJSON()) : []
  if (!editor) return <div className="editor-panel">正在准备编辑器…</div>
  const tool = (label: string, icon: React.ReactNode, action: () => void, active = false, disabled = false) => <button type="button" className={`tool-button ${active ? 'active' : ''}`} title={label} aria-label={label} aria-pressed={active} onClick={action} disabled={disabled}>{icon}</button>
  return <section className="editor-panel">
    <div className="panel-heading"><div className="panel-heading-label"><span className="status-dot" /><span>正文编辑</span></div><span className="muted small">自由书写，样式交给字间</span></div>
    <div className="editor-toolbar" aria-label="正文格式工具栏">
      <select aria-label="段落样式" value={editor.isActive('heading', { level: 1 }) ? '1' : editor.isActive('heading', { level: 2 }) ? '2' : editor.isActive('heading', { level: 3 }) ? '3' : 'p'} onChange={event => { if (event.target.value === 'p') editor.chain().focus().setParagraph().run(); else editor.chain().focus().setHeading({ level: Number(event.target.value) as 1 | 2 | 3 }).run() }}>
        <option value="p">正文</option><option value="1">大标题</option><option value="2">一级标题</option><option value="3">二级标题</option>
      </select>
      <span className="toolbar-divider" />
      {tool('加粗', <Bold size={17} />, () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'))}
      {tool('斜体', <Italic size={17} />, () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'))}
      {tool('下划线', <Underline size={17} />, () => editor.chain().focus().toggleUnderline().run(), editor.isActive('underline'))}
      <span className="toolbar-divider" />
      {tool('无序列表', <List size={18} />, () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'))}
      {tool('有序列表', <ListOrdered size={18} />, () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'))}
      {tool('引用', <Quote size={17} />, () => editor.chain().focus().toggleBlockquote().run(), editor.isActive('blockquote'))}
      <select aria-label="提示卡片" value={selectedCallout(editor)} disabled={!editor.isActive('paragraph') || editor.isActive('table')} onChange={event => setCalloutSelection(editor, event.target.value)}><option value="" disabled>提示卡片…</option><option value="none">普通正文</option>{Object.entries(calloutKinds).map(([kind, value]) => <option key={kind} value={kind}>{value.label}卡片</option>)}</select>
      {tool('行内代码', <Code size={17} />, () => editor.chain().focus().toggleCode().run(), editor.isActive('code'))}
      {tool('代码块', <Code2 size={17} />, () => toggleCodeSelection(editor), editor.isActive('codeBlock'))}
      {tool('分隔线', <Minus size={18} />, () => editor.chain().focus().setHorizontalRule().run())}
      {tool('添加链接', <Link2 size={17} />, () => { setLink(editor.getAttributes('link').href || ''); setDialog('link') }, editor.isActive('link'))}
      {tool('添加图片', <ImagePlus size={18} />, () => imageInput.current?.click(), false, pending)}
      {tool('插入表格', <Table2 size={17} />, () => { tableSelection.current = editor.state.selection.getBookmark(); setDialog('table') }, false, editor.isActive('table'))}
      {tool('清除文字格式', <RemoveFormatting size={17} />, () => editor.chain().focus().unsetAllMarks().run())}
      <span className="toolbar-divider" />
      {tool('撤销', <Undo2 size={17} />, () => editor.chain().focus().undo().run(), false, !editor.can().undo())}
      {tool('重做', <Redo2 size={17} />, () => editor.chain().focus().redo().run(), false, !editor.can().redo())}
      <button className="tidy-button" onClick={() => { setSelected(candidates.map(c => c.index)); setDialog('tidy') }}><WandSparkles size={15} />整理结构</button>
    </div>
    {editor.isActive('codeBlock') && <CodeBlockTools key={editor.state.selection.$from.before()} editor={editor} />}
    {editor.isActive('table') && <TableTools editor={editor} />}
    {pending && <div className="inline-progress">正在处理粘贴内容或图片，请稍候…</div>}
    <div className="editor-scroll"><div className="editor-paper">
      <div className="document-eyebrow">YOUR WORDS, BEAUTIFULLY ARRANGED</div>
      <textarea className="article-title-input" aria-label="文章标题" placeholder="给文章起个名字…" rows={1} maxLength={300} value={article.title} onChange={event => onTitleChange(event.target.value)} />
      <div className="article-meta">正文在此编辑 · 右侧查看排版效果</div>
      <div className="paper-rule" />
      <EditorContent editor={editor} />
      <div className="end-mark">· · ·</div>
    </div></div>
    <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif" multiple hidden onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; if (files.length) void addImages(files) }} />
    {dialog === 'table' && <Modal title="插入表格" eyebrow="TABLE" onClose={() => setDialog(null)}>
      <p className="modal-description">选择行列数，插入后可增删行列、合并单元格和调整表头。</p>
      <div className="table-size-fields"><label>行数<input type="number" aria-label="表格行数" min={1} max={30} value={tableSize.rows} onChange={event => setTableSize(value => ({ ...value, rows: Number(event.target.value) }))} /></label><label>列数<input type="number" aria-label="表格列数" min={1} max={12} value={tableSize.cols} onChange={event => setTableSize(value => ({ ...value, cols: Number(event.target.value) }))} /></label></div>
      <label className="table-header-option"><input type="checkbox" checked={tableSize.header} onChange={event => setTableSize(value => ({ ...value, header: event.target.checked }))} />第一行作为表头</label>
      <div className="modal-actions"><button className="button secondary" onClick={() => setDialog(null)}>取消</button><button className="button primary" disabled={!Number.isInteger(tableSize.rows) || tableSize.rows < 1 || tableSize.rows > 30 || !Number.isInteger(tableSize.cols) || tableSize.cols < 1 || tableSize.cols > 12} onClick={() => { insertArticleTable(editor, tableSize, tableSelection.current); setDialog(null) }}>插入表格</button></div>
    </Modal>}
    {dialog === 'tidy' && <Modal title="让文章结构更清晰" eyebrow="SMART STRUCTURE" onClose={() => setDialog(null)}>
      <p className="modal-description">合并多余的空段落，统一已有样式，不改写正文。勾选下面的段落，将它们设为一级标题。</p>
      <div className="candidate-list">{candidates.length ? candidates.map(candidate => <label key={candidate.index} className="candidate"><input type="checkbox" checked={selected.includes(candidate.index)} onChange={event => setSelected(values => event.target.checked ? [...values, candidate.index] : values.filter(value => value !== candidate.index))} /><span>{candidate.text}</span><small>标题候选</small></label>) : <div className="empty-hint">没有需要确认的标题，可直接整理空段落。</div>}</div>
      <p className="note">整理后可使用工具栏的“撤销”恢复。</p>
      <div className="modal-actions"><button className="button secondary" onClick={() => setDialog(null)}>取消</button><button className="button primary" onClick={() => { editor.chain().focus().setContent(tidyDocument(editor.getJSON(), selected)).run(); setDialog(null); notify('结构已整理，正文文字保持不变') }}><WandSparkles size={16} />应用整理</button></div>
    </Modal>}
    {dialog === 'link' && <Modal title="添加文字链接" eyebrow="INSERT LINK" onClose={() => setDialog(null)}>
      <p className="modal-description">选中文字后添加链接。公众号可能会根据账号权限处理外部链接。</p>
      <input className="field-input" data-autofocus aria-label="链接地址" placeholder="https://example.com" value={link} onChange={event => setLink(event.target.value)} />
      <div className="modal-actions"><button className="button secondary" onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); setDialog(null) }}>移除链接</button><button className="button primary" disabled={!safeURL(link)} onClick={() => { editor.chain().focus().extendMarkRange('link').setLink({ href: safeURL(link) }).run(); setDialog(null) }}>应用链接</button></div>
    </Modal>}
  </section>
}
