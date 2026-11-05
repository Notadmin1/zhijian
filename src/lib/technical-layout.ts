import type { JSONContent } from '@tiptap/react'
import { nodeText } from './document'
import { hasCodeSettings } from './block-settings'

export const pathDescription = (text: string) => /^(?:~\/|\/)\S.*?\s+[—–]\s*\S/.test(text.trim())

/** Repair only clear export fragments; keep deliberate multi-paragraph cells. */
export function normalizeArticleTables(document: JSONContent): JSONContent {
  const visit = (node: JSONContent, autoTable = false): JSONContent => {
    if (node.type === 'table') autoTable = node.attrs?.headerMode !== 'manual'
    const children = node.content?.map(child => visit(child, autoTable))
    if (!children) return node
    if (!autoTable || !['tableCell', 'tableHeader'].includes(node.type || '')) return { ...node, content: children }
    const result: JSONContent[] = []
    for (let child of children) {
      if (child.type === 'paragraph' && !nodeText(child).trim() && !child.content?.some(n => n.type !== 'text' && n.type !== 'hardBreak')) continue
      const previous = result.at(-1)
      const before = previous ? nodeText(previous) : ''
      if (child.type === 'codeBlock' && !hasCodeSettings(child.attrs) && !nodeText(child).includes('\n') && /[，,]\s*例如\s*$/.test(before)) {
        child = { type: 'paragraph', content: child.content?.map(n => ({ ...n, marks: [{ type: 'code' }] })) }
      }
      const text = nodeText(child)
      const plain = (n: JSONContent) => n.type === 'paragraph' && !n.attrs?.callout && n.content?.every(c => c.type === 'text')
      const fragment = /^[、，,）)\]】]/.test(text) || /[、，,（(\[【]\s*$/.test(before)
        || (/[（(][^）)]*$/.test(before) && !/[。！？]/.test(before))
        || (before.length <= 16 && /^(?:的|登录会话)/.test(text))
        || /[，,]\s*例如\s*$/.test(before)
      if (previous && plain(previous) && plain(child) && fragment) previous.content = [...previous.content!, ...child.content!]
      else result.push(child)
    }
    return { ...node, content: result.length ? result : [{ type: 'paragraph' }] }
  }
  return visit(document)
}

/** Paths remain literal text; existing links, code and all block code stay intact. */
export function decoratePaths(document: JSONContent): JSONContent {
  const visit = (node: JSONContent): JSONContent => {
    if (node.type === 'codeBlock') return node
    if (!node.content) return node
    if (!['paragraph', 'heading'].includes(node.type || '')) return { ...node, content: node.content.map(visit) }
    return { ...node, content: node.content.flatMap(child => {
      if (child.type !== 'text' || child.marks?.some(mark => ['code', 'link'].includes(mark.type))) return [child]
      const text = child.text || ''
      const result: JSONContent[] = []
      let cursor = 0
      for (const match of text.matchAll(/https?:\/\/\S+|(?:~|\.\.?)?\/[\w.*+@-]+(?:\/[\w.*+@-]+)*\/?/g)) {
        if (/^https?:/.test(match[0])) continue
        if (match.index! > cursor) result.push({ ...child, text: text.slice(cursor, match.index) })
        result.push({ ...child, text: match[0], marks: [...(child.marks || []), { type: 'code' }] })
        cursor = match.index! + match[0].length
      }
      if (!cursor) return [child]
      if (cursor < text.length) result.push({ ...child, text: text.slice(cursor) })
      return result
    }) }
  }
  return visit(document)
}
