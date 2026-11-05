// Some web editors export paragraph style IDs without exporting styles.xml.
// Recover only styles consistently used for short headings, never body styles.
import { codeLanguageLabel, collapsedCode, startsCode } from './code'

const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const value = (element: Element | undefined, name = 'val') => element?.getAttributeNS(wordNamespace, name) || element?.getAttribute(`w:${name}`) || ''
const descendants = (element: Document | Element, name: string) => Array.from(element.getElementsByTagNameNS('*', name))
const normalized = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Mammoth's XML reader drops CDATA children inside w:t in some web exports. */
export function normalizeWordTextXML(xml: string): string {
  if (!xml.includes('<![CDATA[')) return xml
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.querySelector('parsererror')) throw new Error('Word 正文格式无效，无法读取')
  let changed = false
  for (const text of document.getElementsByTagNameNS(wordNamespace, 't')) {
    for (const child of Array.from(text.childNodes)) {
      if (child.nodeType !== Node.CDATA_SECTION_NODE) continue
      text.replaceChild(document.createTextNode(child.textContent || ''), child)
      changed = true
    }
  }
  return changed ? new XMLSerializer().serializeToString(document) : xml
}

export interface WordRecovery {
  styles: Map<string, number>
  codeTexts: Set<string>
  recovered: number
  transform: (element: any) => any
}

function modelText(element: any): string {
  if (typeof element.value === 'string') return element.value
  if (element.type === 'tab') return '\t'
  if (element.type === 'break') return '\n'
  return (element.children || []).map(modelText).join('')
}

export function recoverWordStructure(xml: string, stylesXML = ''): WordRecovery {
  const parser = new DOMParser()
  const document = parser.parseFromString(xml, 'application/xml')
  if (document.querySelector('parsererror')) throw new Error('Word 正文格式无效，无法读取')
  // Mammoth only reads direct children of w:styles. Some Word exporters nest a
  // second w:styles root: those definitions exist in XML but are never applied.
  const stylesRoot = stylesXML ? parser.parseFromString(stylesXML, 'application/xml').documentElement : null
  const definedStyles = stylesRoot ? Array.from(stylesRoot.children).filter(style => style.localName === 'style').map(style => value(style, 'styleId')) : []
  const groups = new Map<string, string[]>()
  const codeTexts = new Set<string>()
  const monospaceTexts = new Set<string>()
  for (const paragraph of descendants(document, 'p')) {
    let parent = paragraph.parentElement
    let inTable = false
    while (parent) { if (parent.localName === 'tc') inTable = true; parent = parent.parentElement }
    const text = descendants(paragraph, 't').map(node => node.textContent || '').join('')
    if (!text.trim()) continue
    let codeLength = 0
    for (const run of descendants(paragraph, 'r')) {
      const fonts = descendants(run, 'rFonts')[0]
      if (fonts && /Consolas|Courier|Menlo|Monaco|monospace/i.test(`${value(fonts, 'ascii')} ${value(fonts, 'hAnsi')}`)) codeLength += descendants(run, 't').map(node => node.textContent || '').join('').length
    }
    if (codeLength / text.length >= .8) {
      monospaceTexts.add(normalized(text))
      if (!inTable && !codeLanguageLabel(text) && (startsCode(text) || collapsedCode(text))) codeTexts.add(normalized(text))
    }
    const style = value(descendants(paragraph, 'pStyle')[0])
    if (style && !inTable && !definedStyles.includes(style)) groups.set(style, [...(groups.get(style) || []), text.trim()])
  }
  const candidates = [...groups].filter(([id, texts]) => {
    if (!/^(\d+|heading\s*\d+|标题\s*\d+)$/i.test(id)) return false
    const headings = texts.filter(text => text.length <= 110 && !/[。；;]$/.test(text) && !/^(https?:|\s*[{}<>]|(?:import|from|const|def|class)\s)/.test(text) && !monospaceTexts.has(normalized(text)))
    return headings.length / texts.length >= .8
  })
  const ranks = candidates.map(([id]) => Number(id.match(/\d+/)?.[0] || 1))
  const minimum = Math.min(...ranks)
  const styles = new Map<string, number>()
  let recovered = 0
  for (const [id, texts] of candidates) {
    const rank = Number(id.match(/\d+/)?.[0] || 1)
    const major = texts.some(text => /^(前言|引言|序言|总结|结语|写在最后|工作流程|攻击面分析|测试流程|测试方式|常见漏洞类型)$/.test(text))
      || texts.filter(text => /^[一二三四五六七八九十]+[、．.]/.test(text)).length >= 2
      || texts.filter(text => /^[\p{Extended_Pictographic}]/u.test(text)).length >= 3
      || (texts.length <= 2 && texts.every(text => /简介$/.test(text)))
    styles.set(id, major || rank === minimum ? 2 : 3)
    recovered += texts.length
  }
  const transform = (element: any): any => {
    const result = { ...element }
    if (element.type === 'paragraph') {
      const text = modelText(element)
      if (codeTexts.has(normalized(text))) result.styleName = 'Zijian Code'
      else if (styles.has(element.styleId) && text.trim().length <= 110 && !/[。；;]$/.test(text.trim())) result.styleName = `Zijian Heading ${styles.get(element.styleId)}`
    }
    if (element.type === 'run' && /Consolas|Courier|Menlo|Monaco|monospace/i.test(element.font || '')) {
      const text = modelText(element).trim()
      // Font alone does not make a whole paragraph a code block. Keep short
      // identifiers, file names and URLs as inline code, including in tables.
      if (text && !/[。！？；]/.test(text) && (!/[\u3400-\u9fff]/.test(text) || /^(?:[\w.+-]+:|\.\.\/)/.test(text))) result.styleName = 'Zijian Inline Code'
    }
    if (element.children) result.children = element.children.map(transform)
    return result
  }
  return { styles, codeTexts, recovered, transform }
}
