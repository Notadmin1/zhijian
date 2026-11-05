import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { ImageOff, Replace, ZoomIn } from 'lucide-react'
import { addAsset, db } from '../lib/storage'
import { safeURL } from '../lib/render'
import { imagePresentation, imageSettings } from '../lib/block-settings'
import Modal from './Modal'

export default function AssetImageView({ node, updateAttributes, selected, editor, getPos }: NodeViewProps) {
  const [src, setSrc] = useState('')
  const [loading, setLoading] = useState(true)
  const [zoom, setZoom] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const replacement = useRef<HTMLInputElement>(null)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const settings = imageSettings(node.attrs)
  const replace = async (file: File) => {
    setError('')
    setPending(true)
    try {
      const asset = await addAsset(file, file.name)
      if (mounted.current) updateAttributes({ assetId: asset.id, src: `asset:${asset.id}`, alt: file.name })
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '图片替换失败') }
    finally { if (mounted.current) setPending(false) }
  }
  useEffect(() => {
    let disposed = false
    let url = ''
    setLoading(true)
    if (node.attrs.assetId) {
      db.assets.get(node.attrs.assetId).then(asset => {
        if (disposed) return
        if (asset) { url = URL.createObjectURL(asset.blob); setSrc(url) } else setSrc('')
        setLoading(false)
      }).catch(() => { if (!disposed) { setSrc(''); setLoading(false) } })
    } else { setSrc(safeURL(node.attrs.src, true)); setLoading(false) }
    return () => { disposed = true; if (url) URL.revokeObjectURL(url) }
  }, [node.attrs.assetId, node.attrs.src])
  return <NodeViewWrapper className={`asset-image ${selected ? 'asset-image-selected' : ''}`} contentEditable={false}>
    {src ? <img src={src} alt={node.attrs.alt || '文章图片'} style={imagePresentation(node.attrs)} data-drag-handle title="单击调整图片，双击查看大图" onClick={() => { const position = getPos(); if (typeof position === 'number') editor.commands.setNodeSelection(position) }} onDoubleClick={() => setZoom(true)} onError={() => setSrc('')} /> : <div className="image-unavailable" onClick={() => { const position = getPos(); if (typeof position === 'number') editor.commands.setNodeSelection(position) }}><ImageOff size={22} /><span>{loading ? '正在载入图片…' : '图片不可用，请重新添加'}</span></div>}
    <input aria-label="图片说明" placeholder="添加图片说明…" value={node.attrs.title || ''} onChange={event => updateAttributes({ title: event.target.value })} />
    {selected && <div className="image-tools" aria-label="当前图片设置">
      <label>宽度<select aria-label="图片宽度" value={settings.displayWidth || ''} onChange={event => updateAttributes({ displayWidth: event.target.value ? Number(event.target.value) : null })}><option value="">原始大小</option>{[100, 75, 50, 33].map(width => <option key={width} value={width}>{width}%</option>)}</select></label>
      <label>对齐<select aria-label="图片对齐" value={settings.imageAlign} onChange={event => updateAttributes({ imageAlign: event.target.value })}><option value="left">居左</option><option value="center">居中</option><option value="right">居右</option></select></label>
      <label>装饰<select aria-label="图片装饰" value={settings.imageFrame} onChange={event => updateAttributes({ imageFrame: event.target.value })}><option value="none">无装饰</option><option value="border">细边框</option><option value="shadow">柔和阴影</option></select></label>
      <button disabled={pending} onClick={() => replacement.current?.click()}><Replace size={14} />{pending ? '正在替换…' : '替换图片'}</button>
      <button disabled={!src} onClick={() => setZoom(true)}><ZoomIn size={14} />查看大图</button>
    </div>}
    {error && <p className="image-tool-error" role="alert">{error}</p>}
    <input ref={replacement} data-testid="replace-image-input" hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void replace(file) }} />
    {zoom && <Modal title="查看图片" className="image-lightbox" wide onClose={() => setZoom(false)}><img className="lightbox-image" src={src} alt={node.attrs.alt || '文章图片'} /><p className="note">{node.attrs.title || node.attrs.alt || '原图预览'}</p></Modal>}
  </NodeViewWrapper>
}
