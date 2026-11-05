import type { JSONContent } from '@tiptap/react'
import type { ReadingDensity, Typography } from '../types'
import { nodeText } from './document'
import { safeTypography } from './themes'
import { isCalloutKind } from './callouts'

export const readingDensities = [
  { id: 'compact', label: '紧凑', hint: '信息集中', lineHeight: 1.65, paragraphSpace: 12, scale: .8, codeLineHeight: 1.7 },
  { id: 'standard', label: '标准', hint: '日常阅读', lineHeight: 1.8, paragraphSpace: 16, scale: 1, codeLineHeight: 1.85 },
  { id: 'relaxed', label: '舒展', hint: '留白更多', lineHeight: 2, paragraphSpace: 22, scale: 1.2, codeLineHeight: 2 },
] as const

export const decorationStrengths = [
  { id: 'simple', label: '简洁', hint: '细线与轻底色' },
  { id: 'balanced', label: '适中', hint: '保留模板特色' },
  { id: 'expressive', label: '突出', hint: '加强章节与重点' },
] as const

export function readingMetrics(typography: Typography) {
  return readingDensities.find(option => option.id === typography.readingDensity) || readingDensities[1]
}

export function applyReadingDensity(typography: Typography, id: ReadingDensity): Typography {
  const option = readingDensities.find(option => option.id === id) || readingDensities[1]
  return { ...safeTypography(typography), readingDensity: option.id, lineHeight: option.lineHeight, paragraphSpace: option.paragraphSpace }
}

export function readingStyleSummary(typography: Typography) {
  const t = safeTypography(typography)
  const density = readingMetrics(t)
  const custom = t.lineHeight !== density.lineHeight || t.paragraphSpace !== density.paragraphSpace
  return `${density.label}${custom ? '·已微调' : ''} / ${decorationStrengths.find(option => option.id === t.decoration)!.label}装饰 / ${t.smartSpacing ? '自动留白' : '固定留白'}`
}

/** One visible gap per pair of top-level blocks; CSS sibling margins cannot stack. */
export function blockGaps(blocks: JSONContent[], typography: Typography): number[] {
  const scale = readingMetrics(typography).scale
  const gap = (value: number) => Math.round(value * scale)
  const media = (node: JSONContent) => ['codeBlock', 'image', 'table'].includes(node.type || '')
  const card = (node: JSONContent) => isCalloutKind(node.attrs?.callout)
  return blocks.map((current, index) => {
    const next = blocks[index + 1]
    if (!next) return 0
    if (current.type === 'heading') return gap(next.type === 'heading' ? 10 : 14)
    if (next.type === 'heading') return gap(Number(next.attrs?.level || 2) <= 2 ? 34 : 25)
    if (current.type === 'horizontalRule' || next.type === 'horizontalRule') return gap(24)
    if (current.type === 'paragraph' && !card(current) && media(next)) return gap(/[：:]\s*$/.test(nodeText(current)) ? 10 : 16)
    if (media(current) && media(next)) return gap(22)
    if (media(current)) return gap(18)
    if (card(current) && card(next)) return gap(14)
    if (card(current) || card(next)) return gap(20)
    return typography.paragraphSpace
  })
}

export function withBlockMargins(html: string, bottom: number) {
  return html.replace(/^(<[a-z][a-z0-9]*\b[^>]*?\bstyle=")([^"]*)"/i, (_, start: string, style: string) => `${start}${style}${style.endsWith(';') ? '' : ';'}margin-top:0;margin-bottom:${bottom}px;"`)
}
