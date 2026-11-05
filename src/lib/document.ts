import DOMPurify from 'dompurify'
import type { JSONContent } from '@tiptap/react'
import type { Article } from '../types'
import { defaultTypography } from './themes'

export const emptyDocument = (): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph' }] })
export const textNode = (text: string): JSONContent => ({ type: 'text', text })
export function nodeText(node: JSONContent): string {
  if (node.type === 'text') return node.text || ''
  if (node.type === 'hardBreak') return '\n'
  return (node.content || []).map(nodeText).join('')
}
export function plainText(doc: JSONContent): string {
  function read(node: JSONContent): string {
    if (node.type === 'text') return node.text || ''
    if (node.type === 'hardBreak') return '\n'
    if (node.type === 'image') return node.attrs?.title || node.attrs?.alt || ''
    const result = (node.content || []).map(read).join('')
    return ['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock', 'tableRow'].includes(node.type || '') ? `${result}\n` : result
  }
  return read(doc).trim()
}
export const wordCount = (doc: JSONContent) => plainText(doc).replace(/\s/g, '').length

export function walk(doc: JSONContent, fn: (node: JSONContent) => void) {
  fn(doc)
  doc.content?.forEach(child => walk(child, fn))
}
export function imageNodes(doc: JSONContent) {
  const nodes: JSONContent[] = []
  walk(doc, node => { if (node.type === 'image') nodes.push(node) })
  return nodes
}
export function newArticle(title = '未命名文章', document = emptyDocument()): Article {
  return {
    id: crypto.randomUUID(), schemaVersion: 1, title, document,
    sourceSnapshot: structuredClone(document), themeId: 'botanical', typography: defaultTypography(),
    createdAt: Date.now(), updatedAt: Date.now(),
  }
}

export const sampleArticle = () => newArticle('在忙碌的日子里，找回阅读的节奏', {
  type: 'doc', content: [
    { type: 'paragraph', content: [textNode('有多久，你没有完整地读完一篇文章了？')] },
    { type: 'paragraph', content: [textNode('信息越是密集，我们越需要一点留白。让文字有呼吸的空间，也让阅读，重新成为一件舒服的小事。')] },
    { type: 'heading', attrs: { level: 2 }, content: [textNode('01  给文字一点呼吸感')] },
    { type: 'paragraph', content: [textNode('好的排版，不是给文字加上更多装饰，而是让内容被轻松看见。合适的字号、舒展的行距，以及恰到好处的段落间隔，都在默默照顾读者的感受。')] },
    { type: 'blockquote', content: [{ type: 'paragraph', content: [textNode('阅读的美好，藏在文字与留白之间。')] }] },
    { type: 'heading', attrs: { level: 2 }, content: [textNode('02  从一篇喜欢的文章开始')] },
    { type: 'paragraph', content: [textNode('你可以直接修改这篇示例，也可以导入 Word，或把准备好的文章粘贴进来。选择一套喜欢的主题，让想法自然流动。')] },
    { type: 'bulletList', content: [
      { type: 'listItem', content: [{ type: 'paragraph', content: [textNode('保留内容本来的样子，让样式保持统一。')] }] },
      { type: 'listItem', content: [{ type: 'paragraph', content: [textNode('留出适当的空白，给重要的观点一点空间。')] }] },
      { type: 'listItem', content: [{ type: 'paragraph', content: [textNode('发布之前，花一分钟检查手机上的阅读效果。')] }] },
    ] },
    { type: 'horizontalRule' },
    { type: 'paragraph', content: [textNode('愿每一份认真写下的内容，都能被好好阅读。')] },
  ],
})

export function sanitizeHTML(html: string): string {
  const config = {
    ALLOWED_TAGS: ['p', 'div', 'section', 'article', 'span', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 's', 'del', 'u', 'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'hr', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'pre', 'code', 'figure', 'figcaption', 'sup', 'sub'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'start', 'data-asset-id', 'data-callout', 'data-code-title', 'data-code-wrap', 'data-code-highlight', 'data-image-width', 'data-image-align', 'data-image-frame', 'data-header-mode'],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['data-asset-id', 'data-callout'],
  }
  // Word and web clipboards often encode emphasis in styles instead of semantic tags.
  const intermediate = DOMPurify.sanitize(html, { ...config, ALLOWED_ATTR: [...config.ALLOWED_ATTR, 'style'] })
  const parsed = new DOMParser().parseFromString(intermediate, 'text/html')
  for (const element of parsed.querySelectorAll<HTMLElement>('[style]')) {
    if (element.querySelector('p,div,section,article,ul,ol,table,blockquote,h1,h2,h3,h4,h5,h6')) continue
    const style = element.style
    const tags: string[] = []
    if (style.fontWeight === 'bold' || Number(style.fontWeight) >= 600) tags.push('strong')
    if (style.fontStyle === 'italic') tags.push('em')
    const decoration = style.textDecorationLine || style.textDecoration
    if (decoration.includes('underline')) tags.push('u')
    if (decoration.includes('line-through')) tags.push('s')
    for (const tag of tags) { const mark = parsed.createElement(tag); mark.append(...element.childNodes); element.append(mark) }
  }
  return DOMPurify.sanitize(parsed.body.innerHTML, config)
}

export interface HeadingCandidate { index: number; text: string }
export function headingCandidates(doc: JSONContent): HeadingCandidate[] {
  return (doc.content || []).flatMap((node, index) => {
    const text = nodeText(node).trim()
    const numbered = /^(?:[一二三四五六七八九十百]+[、．.]\s*|[（(][一二三四五六七八九十\d]+[）)]\s*|\d{1,2}[、．.]\s*|\d{2}\s+)\S/.test(text)
    return node.type === 'paragraph' && text.length <= 36 && numbered && !/[。！？；!?;]$/.test(text)
      ? [{ index, text }] : []
  })
}

export function tidyDocument(doc: JSONContent, headings: number[] = []): JSONContent {
  const result = structuredClone(doc)
  const selected = new Set(headings)
  let lastEmpty = false
  result.content = (result.content || []).flatMap((node, index) => {
    const empty = node.type === 'paragraph' && !node.content?.length
    if (empty && lastEmpty) return []
    lastEmpty = empty
    if (selected.has(index) && node.type === 'paragraph') {
      node.type = 'heading'
      node.attrs = { level: 2 }
    }
    return [node]
  })
  while (result.content.length > 1 && result.content[0].type === 'paragraph' && !result.content[0].content?.length) result.content.shift()
  while (result.content.length > 1 && result.content.at(-1)?.type === 'paragraph' && !result.content.at(-1)?.content?.length) result.content.pop()
  return result.content.length ? result : emptyDocument()
}
