import { generateJSON } from '@tiptap/react'
import type { JSONContent } from '@tiptap/react'
import { addAsset } from './storage'
import { sanitizeHTML } from './document'
import { editorExtensions } from './tiptap'
import { normalizeWordTextXML, recoverWordStructure } from './word-structure'
import { codeLanguage, findCodeRun } from './code'

function inlineText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
  if (node instanceof Element && node.tagName === 'BR') return '\n'
  return Array.from(node.childNodes).map(inlineText).join('')
}

function preserveCodeLayout(parsed: Document) {
  // Convert code paragraphs before ProseMirror's normal paragraph parser folds
  // whitespace. XML, Java and shell continuations then retain source indentation.
  for (const container of Array.from(parsed.querySelectorAll('body,blockquote,li,td,th')).reverse()) {
    const children = Array.from(container.children)
    const lines = children.map(child => child.tagName === 'P' && !child.querySelector('img') ? inlineText(child) : null)
    for (let index = 0; index < children.length; index++) {
      const run = findCodeRun(lines, index)
      if (!run) continue
      const pre = parsed.createElement('pre')
      const code = parsed.createElement('code')
      code.className = `language-${run.language}`
      code.textContent = lines.slice(run.contentStart ?? index, run.end).join('\n')
      pre.append(code)
      children[index].before(pre)
      for (let line = index; line < run.end; line++) children[line].remove()
      index = run.end - 1
    }
  }
  for (const pre of parsed.querySelectorAll('pre')) {
    if (!pre.querySelector('code')) {
      const code = parsed.createElement('code')
      code.textContent = inlineText(pre)
      code.className = `language-${codeLanguage(code.textContent)}`
      pre.replaceChildren(code)
    }
  }
}

export interface ImportResult { document: JSONContent; warnings: string[]; recoveredHeadings: number }

export async function prepareHTML(html: string, files: File[] = []): Promise<string> {
  const parsed = new DOMParser().parseFromString(sanitizeHTML(html), 'text/html')
  let fileIndex = 0
  for (const img of parsed.querySelectorAll('img')) {
    const src = img.getAttribute('src') || ''
    if (/^data:image\/(png|jpeg|gif|webp|bmp|avif);base64,/i.test(src)) {
      const response = await fetch(src)
      const asset = await addAsset(await response.blob(), img.alt || '导入图片')
      img.setAttribute('data-asset-id', asset.id)
      img.src = `asset:${asset.id}`
    } else if (!/^https?:\/\//i.test(src) && !img.hasAttribute('data-asset-id')) {
      const file = files[fileIndex++]
      if (file) {
        const asset = await addAsset(file, img.alt || file.name)
        img.setAttribute('data-asset-id', asset.id)
        img.src = `asset:${asset.id}`
      } else {
        img.removeAttribute('src')
        img.alt = `${img.alt || '图片'}（来源不可用，请重新添加）`
        img.src = 'asset:missing'
      }
    }
  }
  // Flatten source-only wrappers so nested web layouts do not swallow paragraphs.
  for (const wrapper of [...parsed.querySelectorAll('section,article,div')].reverse()) {
    if (!wrapper.querySelector('p,h1,h2,h3,h4,h5,h6,ul,ol,table,blockquote,div,section,article')) {
      const p = parsed.createElement('p')
      p.append(...wrapper.childNodes)
      wrapper.replaceWith(p)
    } else wrapper.replaceWith(...wrapper.childNodes)
  }
  preserveCodeLayout(parsed)
  return parsed.body.innerHTML
}

export async function importWord(file: File): Promise<ImportResult> {
  if (!/\.docx$/i.test(file.name)) throw new Error('请选择 .docx 文件；旧版 .doc 请在 Word 中另存为 .docx')
  if (file.size > 20 * 1024 * 1024) throw new Error('Word 文件不能超过 20MB')
  const [{ default: mammoth }, { default: JSZip }] = await Promise.all([import('mammoth'), import('jszip')])
  let arrayBuffer = await file.arrayBuffer()
  const zip = await JSZip.loadAsync(arrayBuffer)
  const xml = await zip.file('word/document.xml')?.async('string')
  if (!xml) throw new Error('这不是有效的 Word 文档，缺少正文数据')
  const normalizedXML = normalizeWordTextXML(xml)
  if (normalizedXML !== xml) {
    zip.file('word/document.xml', normalizedXML)
    arrayBuffer = await zip.generateAsync({ type: 'arraybuffer' })
  }
  const recovery = recoverWordStructure(xml, await zip.file('word/styles.xml')?.async('string'))
  const result = await mammoth.convertToHtml({ arrayBuffer }, {
    transformDocument: recovery.transform,
    ignoreEmptyParagraphs: false,
    styleMap: ["p[style-name='Zijian Heading 2'] => h2:fresh", "p[style-name='Zijian Heading 3'] => h3:fresh", "p[style-name='Zijian Code'] => pre:separator('\\n')", "r[style-name='Zijian Inline Code'] => code"],
  })
  const warnings = result.messages.map(message => message.message).filter(message => {
    const id = message.match(/(?:ID:?\s*)([^\s)]+)/)?.[1]
    return !(id && recovery.styles.has(id) && /not defined|Unrecognised paragraph style/.test(message))
  })
  const html = await prepareHTML(result.value)
  const document = generateJSON(html, editorExtensions())
  return { document, warnings, recoveredHeadings: recovery.recovered }
}
