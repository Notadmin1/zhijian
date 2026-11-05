import { useRef, useState } from 'react'
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import { Bold, Italic, List, Link2, Minus, ImagePlus, Undo2, Redo2 } from 'lucide-react'
import { editorExtensions } from '../lib/tiptap'
import { addAsset } from '../lib/storage'
import { prepareHTML } from '../lib/import'
import { safeURL } from '../lib/render'
import { calloutKinds } from '../lib/callouts'
import { selectedCallout, setCalloutSelection } from '../lib/callout-selection'

export default function ContentTemplateEditor({ document, onChange, onPending, onError, disabled }: {
  document: JSONContent; onChange: (document: JSONContent) => void; onPending: (pending: boolean) => void; onError: (message: string) => void; disabled: boolean
}) {
  const imageInput = useRef<HTMLInputElement>(null)
  const latest = useRef({ onChange, onPending, onError })
  latest.current = { onChange, onPending, onError }
  const [linkOpen, setLinkOpen] = useState(false)
  const [link, setLink] = useState('')
  const addImages = async (files: File[]) => {
    latest.current.onPending(true)
    try {
      for (const file of files) {
        const asset = await addAsset(file, file.name)
        if (!editor?.isDestroyed) editor?.chain().focus().insertContent({ type: 'image', attrs: { assetId: asset.id, src: `asset:${asset.id}`, alt: file.name, displayWidth: 50 } }).run()
      }
    } catch (error) { latest.current.onError(error instanceof Error ? error.message : '图片添加失败') }
    finally { latest.current.onPending(false) }
  }
  const editor = useEditor({
    extensions: editorExtensions(), content: document, shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { class: 'article-editor content-template-editor', role: 'textbox', 'aria-label': '模板内容', 'aria-multiline': 'true', spellcheck: 'false' },
      handlePaste: (_view, event) => {
        const html = event.clipboardData?.getData('text/html')
        const files = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith('image/'))
        if (html) {
          event.preventDefault()
          latest.current.onPending(true)
          void prepareHTML(html, files).then(clean => { if (!editor?.isDestroyed) editor?.chain().focus().insertContent(clean).run() }).catch(error => latest.current.onError(error instanceof Error ? error.message : '粘贴失败')).finally(() => latest.current.onPending(false))
          return true
        }
        if (files.length) { event.preventDefault(); void addImages(files); return true }
        return false
      },
      handleDrop: (_view, event, _slice, moved) => {
        const files = Array.from(event.dataTransfer?.files || []).filter(file => file.type.startsWith('image/'))
        if (moved || !files.length) return false
        event.preventDefault(); void addImages(files); return true
      },
    },
    onUpdate: ({ editor: current }) => latest.current.onChange(current.getJSON()),
  })
  if (!editor) return <p>正在准备模板编辑器…</p>
  const tool = (label: string, icon: React.ReactNode, action: () => void, active = false) => <button type="button" className={`tool-button ${active ? 'active' : ''}`} aria-label={label} title={label} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={action}>{icon}</button>
  return <div className="content-template-composer" inert={disabled}>
    <div className="editor-toolbar" aria-label="模板格式工具栏">
      {tool('模板加粗', <Bold size={16} />, () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'))}
      {tool('模板斜体', <Italic size={16} />, () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'))}
      {tool('模板列表', <List size={16} />, () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'))}
      {tool('模板链接', <Link2 size={16} />, () => { setLink(String(editor.getAttributes('link').href || '')); setLinkOpen(value => !value) }, editor.isActive('link'))}
      {tool('模板分割线', <Minus size={16} />, () => editor.chain().focus().setHorizontalRule().run())}
      {tool('添加模板图片', <ImagePlus size={16} />, () => imageInput.current?.click())}
      <select aria-label="模板段落装饰" disabled={disabled} value={selectedCallout(editor)} onChange={event => setCalloutSelection(editor, event.target.value)}><option value="" disabled>整组卡片样式…</option><option value="none">普通正文</option>{Object.entries(calloutKinds).map(([id, kind]) => <option key={id} value={id}>{kind.label}卡片</option>)}</select>
      {tool('撤销模板编辑', <Undo2 size={16} />, () => editor.chain().focus().undo().run())}
      {tool('重做模板编辑', <Redo2 size={16} />, () => editor.chain().focus().redo().run())}
    </div>
    {linkOpen && <div className="template-link-row"><input aria-label="模板链接地址" value={link} placeholder="https://example.com" onChange={event => setLink(event.target.value)} /><button className="button secondary" onClick={() => {
      const href = safeURL(link)
      if (link.trim() && !href) { latest.current.onError('请使用 http、https、mailto 或 tel 链接'); return }
      if (href) editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
      else editor.chain().focus().extendMarkRange('link').unsetLink().run()
      setLinkOpen(false)
    }}>应用链接</button></div>}
    <EditorContent editor={editor} />
    <input ref={imageInput} hidden type="file" multiple data-testid="template-image-input" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; if (files.length) void addImages(files) }} />
  </div>
}
