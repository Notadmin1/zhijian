import { getSchema, type JSONContent } from '@tiptap/react'
import { safeURL } from './render'
import { editorExtensions } from './tiptap'
import { safeCallout } from './callouts'
import { codeSettings, imageSettings } from './block-settings'

const idPattern = /^[a-zA-Z0-9_-]{1,100}$/

const nodeTypes = new Set(['doc', 'paragraph', 'text', 'heading', 'hardBreak', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'horizontalRule', 'codeBlock', 'image', 'table', 'tableRow', 'tableCell', 'tableHeader'])
const markTypes = new Set(['bold', 'italic', 'strike', 'underline', 'code', 'link'])

export function validateDocument(value: unknown): JSONContent {
  let count = 0
  const read = (input: unknown, depth: number): JSONContent => {
    if (!input || typeof input !== 'object' || depth > 40 || ++count > 50000) throw new Error('备份中的文章结构无效或过大')
    const n = input as JSONContent
    if (!nodeTypes.has(n.type || '')) throw new Error(`备份包含不支持的正文类型：${String(n.type)}`)
    const result: JSONContent = { type: n.type }
    if (n.type === 'text') {
      if (typeof n.text !== 'string' || n.text.length > 1000000) throw new Error('备份正文无效')
      result.text = n.text
    }
    if (n.attrs) {
      if (n.type === 'image') {
        const assetId = typeof n.attrs.assetId === 'string' && idPattern.test(n.attrs.assetId) ? n.attrs.assetId : null
        result.attrs = { assetId, src: assetId ? `asset:${assetId}` : safeURL(n.attrs.src, true), alt: String(n.attrs.alt || '').slice(0, 1000), title: String(n.attrs.title || '').slice(0, 1000), ...imageSettings(n.attrs) }
      } else if (['paragraph', 'blockquote'].includes(n.type || '') && safeCallout(n.attrs.callout)) result.attrs = { callout: safeCallout(n.attrs.callout) }
      else if (n.type === 'heading') result.attrs = { level: Math.min(3, Math.max(1, Number(n.attrs.level) || 2)) }
      else if (n.type === 'codeBlock') result.attrs = { language: String(n.attrs.language || '').replace(/[^\w+-]/g, '').slice(0, 20) || null, ...codeSettings(n.attrs) }
      else if (n.type === 'table' && n.attrs.headerMode === 'manual') result.attrs = { headerMode: 'manual' }
      else if (n.type === 'orderedList') result.attrs = { start: Math.min(100000, Math.max(1, Number(n.attrs.start) || 1)) }
      else if (n.type === 'tableCell' || n.type === 'tableHeader') result.attrs = { colspan: Math.min(100, Math.max(1, Number(n.attrs.colspan) || 1)), rowspan: Math.min(100, Math.max(1, Number(n.attrs.rowspan) || 1)), colwidth: null }
    }
    if (Array.isArray(n.marks)) result.marks = n.marks.filter(m => markTypes.has(m.type)).map(m => m.type === 'link' ? { type: 'link', attrs: { href: safeURL(m.attrs?.href), target: '_blank', rel: 'noopener noreferrer nofollow' } } : { type: m.type })
    if (n.content !== undefined) {
      if (!Array.isArray(n.content)) throw new Error('备份正文无效')
      result.content = n.content.map(child => read(child, depth + 1))
    }
    return result
  }
  const document = read(value, 0)
  if (document.type !== 'doc') throw new Error('备份缺少正文根节点')
  try { getSchema(editorExtensions()).nodeFromJSON(document).check() }
  catch { throw new Error('备份中的正文结构不符合编辑器格式') }
  return document
}
