import type { JSONContent } from '@tiptap/react'
import { emptyDocument, nodeText } from './document'
import { codeLanguage, codeLanguageLabel, findCodeRun, startsCode } from './code'
import { inferCallout, isCalloutKind } from './callouts'
import { hasCodeSettings } from './block-settings'
import { decoratePaths, normalizeArticleTables, pathDescription } from './technical-layout'

export interface BeautifyReport {
  headings: number
  codeBlocks: number
  lists: number
  tables: number
  splitParagraphs: number
  removedEmpty: number
  images: number
  callouts: number
}
export interface BeautifyResult { document: JSONContent; report: BeautifyReport }

const sentence = /[。；;]$/
const numberedHeading = /^(?:[一二三四五六七八九十百]+[、．.]|第[一二三四五六七八九十\d]+[章节部分篇]|\d{1,2}[、．.]\s*[^\d\s]|\d{2}\s+|[（(][一二三四五六七八九十\d]+[）)]|阶段[一二三四五六七八九十\d]+[：:])/
const minorHeading = /^\d+(?:\.\d+)+[\s、．.:：]+|^(?:步骤|测试|场景|阶段)[一二三四五六七八九十\d]+[：:\s]/
const namedHeading = /^(?:前言|引言|序言|概述|背景介绍|核心概念|工作原理|工作流程|攻击面分析|测试流程|测试方式|常见漏洞类型|总结|结语|写在最后|项目地址|参考资料|参考链接|附录(?:[：:].*)?)$/

function boldRatio(node: JSONContent) {
  const text = nodeText(node)
  const bold = (node.content || []).filter(child => child.marks?.some(mark => mark.type === 'bold')).reduce((sum, child) => sum + (child.text || '').length, 0)
  return text.length ? bold / text.length : 0
}

export function inferHeading(node: JSONContent): number | null {
  if (node.type !== 'paragraph' || inferCallout(node)) return null
  const text = nodeText(node).trim()
  if (startsCode(text)) return null
  if (!text || text.length > 90 || sentence.test(text) || /^(?:https?:\/\/|[{}<>]|(?:import|from|const|def|class)\s)/.test(text)) return null
  if (minorHeading.test(text)) return 3
  if (/^\d{1,2}[.．、)]\s+\S/.test(text)) return 3
  if (namedHeading.test(text) || numberedHeading.test(text)) return 2
  if (/^[\p{Extended_Pictographic}]/u.test(text) && boldRatio(node) >= .6) return 2
  if (text.length <= 60 && boldRatio(node) >= .85 && !/[：:]$/.test(text)) return 3
  return null
}

function sliceInline(nodes: JSONContent[], start: number, end: number) {
  let offset = 0
  const result: JSONContent[] = []
  for (const node of nodes) {
    const length = node.type === 'hardBreak' ? 1 : (node.text || '').length
    const left = Math.max(0, start - offset)
    const right = Math.min(length, end - offset)
    if (left < right) result.push(node.type === 'text' ? { ...structuredClone(node), text: node.text!.slice(left, right) } : structuredClone(node))
    offset += length
  }
  return result
}

function splitParagraph(node: JSONContent): JSONContent[] {
  const text = nodeText(node)
  if (text.length <= 200 || !/[。！？]/.test(text) || node.content?.some(n => n.type !== 'text' && n.type !== 'hardBreak')) return [node]
  const boundaries: number[] = []
  let last = 0
  for (const match of text.matchAll(/[。！？]+[”’」』）)]*/g)) {
    const end = match.index! + match[0].length
    if (end - last >= 95 && text.length - end >= 45) { boundaries.push(end); last = end }
  }
  if (!boundaries.length) return [node]
  const ends = [...boundaries, text.length]
  let start = 0
  return ends.map(end => { const paragraph = { ...structuredClone(node), content: sliceInline(node.content || [], start, end) }; start = end; return paragraph })
}

function mergeLanguageCaptions(source: JSONContent[]): JSONContent[] {
  const result: JSONContent[] = []
  for (let index = 0; index < source.length; index++) {
    const node = source[index]
    const label = ['paragraph', 'codeBlock'].includes(node.type || '') && !hasCodeSettings(node.attrs) ? codeLanguageLabel(nodeText(node)) : null
    const next = source[index + 1]
    if (label && next?.type === 'codeBlock' && !hasCodeSettings(next.attrs) && (next.attrs?.language || codeLanguage(nodeText(next))) === label) {
      result.push(next)
      index++
    } else result.push(node)
  }
  return result
}

function mergeCodeFragments(source: JSONContent[]): JSONContent[] {
  if (!source.some(node => node.type === 'codeBlock' && !nodeText(node).includes('\n'))) return source
  const lines = source.map(node => {
    if (node.type === 'codeBlock' && !nodeText(node).includes('\n') && !hasCodeSettings(node.attrs)) return nodeText(node)
    if (node.type === 'paragraph' && !inferHeading(node) && !inferCallout(node) && !node.content?.some(child => child.type === 'image')) return nodeText(node)
    return null
  })
  const result: JSONContent[] = []
  const compatible = (a: string, b: string) => a === b || ([a, b].every(value => ['xml', 'html'].includes(value)))
  for (let index = 0; index < source.length; index++) {
    const run = findCodeRun(lines, index)
    let end = run?.end || index + 1
    let language = 'text'
    for (let cursor = index; cursor < end; cursor++) {
      const declared = source[cursor].type === 'codeBlock' ? source[cursor].attrs?.language : null
      const current = declared || codeLanguage(lines[cursor] || '')
      if (current === 'text') continue
      if (language !== 'text' && !compatible(language, current)) { end = cursor; break }
      language = language === 'html' ? language : current
    }
    // Repair old drafts with a separate card for each line, including snippets
    // partially converted by the toolbar. Full multiline examples stay separate.
    if (run && end > index + 1 && source.slice(index, end).some(node => node.type === 'codeBlock')) {
      const text = lines.slice(run.contentStart ?? index, end).join('\n')
      result.push({ type: 'codeBlock', attrs: { language: language === 'text' ? codeLanguage(text) : language }, content: [{ type: 'text', text }] })
      index = end - 1
    } else {
      result.push(...source.slice(index, end))
      index = end - 1
    }
  }
  return result
}

export function beautifyDocument(input: JSONContent): BeautifyResult {
  const report: BeautifyReport = { headings: 0, codeBlocks: 0, lists: 0, tables: 0, splitParagraphs: 0, removedEmpty: 0, images: 0, callouts: 0 }
  const source = mergeCodeFragments(mergeLanguageCaptions(structuredClone(input.content || [])))
  const codeLines = source.map(node => node.type === 'paragraph' && !inferHeading(node) && !inferCallout(node) && !node.content?.some(child => child.type === 'image') ? nodeText(node) : null)
  const blocks: JSONContent[] = []
  for (let index = 0; index < source.length; index++) {
    const node = source[index]
    if (['paragraph', 'heading'].includes(node.type || '') && !nodeText(node).trim() && !node.content?.some(child => child.type === 'image')) { report.removedEmpty++; continue }
    // Explicit code fences take priority over all heading/list inference.
    const text = nodeText(node)
    const fence = node.type === 'paragraph' ? text.trim().match(/^```([\w+-]*)$/) : null
    if (fence) {
      const end = source.findIndex((candidate, candidateIndex) => candidateIndex > index && candidate.type === 'paragraph' && nodeText(candidate).trim() === '```')
      if (end > index) {
        const code = source.slice(index + 1, end).map(nodeText).join('\n')
        blocks.push({ type: 'codeBlock', attrs: { language: fence[1] || codeLanguage(code) }, content: code ? [{ type: 'text', text: code }] : [] })
        index = end
        continue
      }
    }
    const run = findCodeRun(codeLines, index)
    if (run) {
      const code = codeLines.slice(run.contentStart ?? index, run.end).join('\n')
      blocks.push({ type: 'codeBlock', attrs: { language: run.language }, content: [{ type: 'text', text: code }] })
      index = run.end - 1
      continue
    }
    const markdown = node.type === 'paragraph' && text.length <= 110 ? text.match(/^(#{1,6})\s+(.+)$/) : null
    const level = inferHeading(node)
    if (markdown) blocks.push({ type: 'heading', attrs: { level: markdown[1].length <= 2 ? 2 : 3 }, content: sliceInline(node.content || [], markdown[1].length + 1, text.length) })
    else if (level) blocks.push({ ...node, type: 'heading', attrs: { level } })
    else if (node.type === 'paragraph') {
      const kind = inferCallout(node)
      const paragraphs = kind ? [{ ...node, attrs: { ...node.attrs, callout: kind } }] : splitParagraph(node)
      report.splitParagraphs += paragraphs.length - 1
      blocks.push(...paragraphs)
    } else if (node.type === 'codeBlock') blocks.push({ ...node, attrs: { ...node.attrs, language: node.attrs?.language || codeLanguage(text) } })
    else blocks.push(node)
  }

  // Turn explicit bullet runs and short enumerations following a colon into lists.
  const result: JSONContent[] = []
  for (let index = 0; index < blocks.length; index++) {
    const node = blocks[index]
    const text = nodeText(node)
    const explicit = node.type === 'paragraph' && !inferCallout(node) && /^\s*[-•●]\s+\S/.test(text)
    const paths = node.type === 'paragraph' && !inferCallout(node) && pathDescription(text)
    const afterColon = result.at(-1)?.type === 'paragraph' && /[：:]\s*$/.test(nodeText(result.at(-1)!))
    const shortItem = (n: JSONContent) => {
      const text = nodeText(n)
      if (n.type !== 'paragraph' || inferCallout(n) || startsCode(text) || !text.trim()) return false
      const colon = text.search(/[：:]/)
      const definition = colon > 0 && colon <= 28 && text.length <= 160 && boldRatio({ ...n, content: sliceInline(n.content || [], 0, colon) }) >= .8
      return definition || (text.length <= 45 && !/[。！？]$/.test(text.trim()))
    }
    if (explicit || paths || (afterColon && shortItem(node))) {
      const items: JSONContent[] = []
      let end = index
      while (end < blocks.length && (explicit ? blocks[end].type === 'paragraph' && !inferCallout(blocks[end]) && /^\s*[-•●]\s+\S/.test(nodeText(blocks[end])) : paths ? blocks[end].type === 'paragraph' && !inferCallout(blocks[end]) && pathDescription(nodeText(blocks[end])) : shortItem(blocks[end]))) {
        const current = blocks[end]
        const prefix = explicit ? nodeText(current).match(/^\s*[-•●]\s+/)![0].length : 0
        items.push({ type: 'listItem', content: [{ ...current, content: prefix ? sliceInline(current.content || [], prefix, nodeText(current).length) : current.content }] })
        end++
      }
      if (items.length >= (explicit ? 2 : 3)) { result.push({ type: 'bulletList', content: items }); index = end - 1; continue }
    }
    if (node.type === 'table' && node.attrs?.headerMode !== 'manual' && (node.content?.length || 0) >= 2) {
      const firstRow = node.content![0]
      if (firstRow.content?.every(cell => nodeText(cell).length <= 60)) firstRow.content = firstRow.content.map(cell => ({ ...cell, type: 'tableHeader' }))
    }
    result.push(node)
  }
  const document = decoratePaths(normalizeArticleTables(result.length ? { type: 'doc', content: result } : emptyDocument()))
  const count = (node: JSONContent, inCard = false) => {
    if (node.type === 'heading') report.headings++
    if (node.type === 'codeBlock') report.codeBlocks++
    if (node.type === 'bulletList' || node.type === 'orderedList') report.lists++
    if (node.type === 'table') report.tables++
    if (node.type === 'image') report.images++
    const card = ['paragraph', 'blockquote'].includes(node.type || '') && isCalloutKind(node.attrs?.callout)
    if (card && !inCard) report.callouts++
    node.content?.forEach(child => count(child, inCard || card))
  }
  count(document)
  return { document, report }
}
