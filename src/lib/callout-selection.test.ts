import { afterEach, describe, expect, it } from 'vitest'
import { Editor, generateJSON, type JSONContent } from '@tiptap/react'
import { editorExtensions } from './tiptap'
import { selectedCallout, setCalloutSelection } from './callout-selection'
import { calloutKinds } from './callouts'
import { nodeText, newArticle, sanitizeHTML } from './document'
import { renderArticle } from './render'
import { beautifyDocument } from './beautify'
import { validateDocument } from './document-validation'

const p = (text: string, attrs = {}): JSONContent => ({ type: 'paragraph', attrs, content: text ? [{ type: 'text', text }] : [] })
let editor: Editor
const create = (...content: JSONContent[]) => editor = new Editor({ extensions: editorExtensions(), content: { type: 'doc', content } })
const selectBlocks = (first: number, last: number) => {
  let offset = 0, from = 0, to = 0
  editor.state.doc.forEach((node, position, index) => {
    if (index === first) from = position + 1
    if (index === last) to = position + node.nodeSize - 1
    offset += node.nodeSize
  })
  editor.commands.setTextSelection({ from, to: Math.min(to, offset) })
}
afterEach(() => editor?.destroy())

describe('selected paragraphs share one callout', () => {
  it.each(Object.keys(calloutKinds))('applies %s to one group, preserving paragraphs, empty lines and rich marks in every output mode', kind => {
    create(p('上方正文'), { type: 'paragraph', content: [{ type: 'text', text: '作者介绍', marks: [{ type: 'bold' }] }, { type: 'hardBreak' }, { type: 'text', text: '访问链接', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }] }, p(''), p('欢迎交流。'), p('下方正文'))
    const before = editor.getJSON().content!.slice(1, 4)
    selectBlocks(1, 3)
    expect(selectedCallout(editor)).toBe('')
    expect(setCalloutSelection(editor, kind)).toBe(true)
    expect(selectedCallout(editor)).toBe(kind)
    const document = editor.getJSON()
    expect(document.content!.map(node => node.type)).toEqual(['paragraph', 'blockquote', 'paragraph'])
    expect(document.content![1].content).toEqual(before)
    expect(document.content![1].attrs?.callout).toBe(kind)
    for (const mode of ['preview', 'clipboard', 'download'] as const) {
      const html = new DOMParser().parseFromString(renderArticle(newArticle('分组卡片', document), { mode }), 'text/html')
      const cards = [...html.querySelectorAll<HTMLElement>('section')].filter(element => element.style.borderLeftWidth)
      expect(cards).toHaveLength(1)
      expect(cards[0].querySelectorAll(':scope > p')).toHaveLength(3)
      expect(cards[0].querySelector('strong')?.textContent).toBe('作者介绍')
      expect(cards[0].querySelector('a')?.getAttribute('href')).toBe('https://example.com')
      expect(html.body.textContent).toContain('下方正文')
      if (mode !== 'preview') expect(html.querySelectorAll('[data-callout-kind],[data-block-index]')).toHaveLength(0)
    }
    expect(validateDocument(document).content![1].attrs?.callout).toBe(kind)
    expect(generateJSON(sanitizeHTML(editor.getHTML()), editorExtensions()).content![1].attrs?.callout).toBe(kind)
    expect(beautifyDocument(document).document).toEqual(document)
    expect(beautifyDocument(document).report.callouts).toBe(1)
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getJSON().content!.slice(1, 4)).toEqual(before)
    expect(editor.commands.redo()).toBe(true)
    expect(editor.getJSON().content![1].attrs?.callout).toBe(kind)
  })

  it('merges existing per-paragraph cards, changes the entire group from inside it, and removes decoration without losing lines', () => {
    create(p('第一行', { callout: 'note' }), p('', { callout: 'note' }), p('第三行', { callout: 'warning' }))
    const text = nodeText(editor.getJSON())
    selectBlocks(0, 2)
    expect(selectedCallout(editor)).toBe('')
    editor.commands.selectAll()
    expect(selectedCallout(editor)).toBe('')
    setCalloutSelection(editor, 'note')
    expect(editor.getJSON().content!.filter(node => node.type === 'blockquote')).toHaveLength(1)
    expect((editor.getJSON().content![0].content as JSONContent[]).every(node => node.attrs?.callout === 'none')).toBe(true)
    editor.commands.setTextSelection(3)
    setCalloutSelection(editor, 'warning')
    expect(editor.getJSON().content![0].attrs?.callout).toBe('warning')
    expect(editor.getJSON().content![0].content).toHaveLength(3)
    setCalloutSelection(editor, 'none')
    expect(editor.getJSON().content!.slice(0, 3).map(node => node.type)).toEqual(['paragraph', 'paragraph', 'paragraph'])
    expect(nodeText(editor.getJSON())).toBe(text)
    expect(editor.getJSON().content!.slice(0, 3).every(node => node.attrs?.callout === 'none')).toBe(true)
  })

  it('keeps further paragraphs inside the card and excludes the paragraph at the end boundary of a selection', () => {
    create(p('第一行'), p('第二行'), p('选区外的正文'))
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize + 1 })
    setCalloutSelection(editor, 'tip')
    expect(editor.getJSON().content!.map(node => node.type)).toEqual(['blockquote', 'paragraph'])
    const group = editor.state.doc.child(0)
    editor.commands.setTextSelection(group.nodeSize - 2)
    editor.commands.splitBlock()
    editor.commands.insertContent('新的一段')
    expect(editor.getJSON().content![0].content).toHaveLength(3)
    expect(nodeText(editor.getJSON().content![0])).toContain('新的一段')
    expect(selectedCallout(editor)).toBe('tip')
    expect(nodeText(editor.getJSON().content![1])).toBe('选区外的正文')
  })

  it('preserves lists, images and code as blocks inside one card', () => {
    create(p('作者简介'), { type: 'bulletList', content: [{ type: 'listItem', content: [p('研究方向')] }, { type: 'listItem', content: [p('联系方式')] }] }, { type: 'image', attrs: { src: 'https://example.com/qr.png', displayWidth: 33, title: '二维码' } }, { type: 'codeBlock', attrs: { language: 'bash' }, content: [{ type: 'text', text: 'echo first\n\techo second' }] })
    const before = editor.getJSON().content
    selectBlocks(0, 3)
    setCalloutSelection(editor, 'note')
    expect(editor.getJSON().content![0].content).toEqual(before)
    expect(validateDocument(editor.getJSON()).content![0].content!.map(node => node.type)).toEqual(['paragraph', 'bulletList', 'image', 'codeBlock'])
    const html = new DOMParser().parseFromString(renderArticle(newArticle('图文卡片', editor.getJSON())), 'text/html')
    expect(html.querySelectorAll('[data-callout-kind]')).toHaveLength(1)
    expect(html.querySelectorAll('[data-callout-kind] li')).toHaveLength(2)
    expect(html.querySelector('[data-callout-kind] pre')?.textContent).toBe('echo first\n\techo second')
    expect(html.querySelector('[data-callout-kind] img')?.getAttribute('src')).toBe('https://example.com/qr.png')
  })

  it('keeps list hierarchy valid when the selection spans several list items', () => {
    create({ type: 'bulletList', content: [{ type: 'listItem', content: [p('第一项')] }, { type: 'listItem', content: [p('第二项')] }] }, p('正文'))
    editor.commands.setTextSelection({ from: 3, to: editor.state.doc.child(0).nodeSize - 3 })
    expect(setCalloutSelection(editor, 'goal')).toBe(true)
    expect(editor.getJSON().content![0].content![0].type).toBe('bulletList')
    expect(() => validateDocument(editor.getJSON())).not.toThrow()
  })
})
