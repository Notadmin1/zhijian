import type { JSONContent } from '@tiptap/react'
import { nodeText } from './document'

export interface OutlineEntry { index: number; level: number; text: string }
export interface NavigationTarget { articleId: string; request: number; section?: number; block?: number }

export function documentOutline(document: JSONContent): OutlineEntry[] {
  const entries: OutlineEntry[] = []
  const visit = (node: JSONContent) => {
    if (node.type === 'heading') entries.push({ index: entries.length, level: Number(node.attrs?.level) || 2, text: nodeText(node).trim() || '空标题' })
    node.content?.forEach(visit)
  }
  visit(document)
  return entries
}

export function scrollToArticleElement(element: Element | null, container: HTMLElement | null) {
  if (!element || !container) return
  container.scrollTo({ top: container.scrollTop + element.getBoundingClientRect().top - container.getBoundingClientRect().top - 20, behavior: 'auto' })
}
