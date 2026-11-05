import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { beautifyDocument } from './beautify'
import { imageNodes, nodeText } from './document'
import { recoverWordStructure } from './word-structure'

const paragraph = (text: string, bold = false): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text, ...(bold ? { marks: [{ type: 'bold' }] } : {}) }] })
const document = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })

describe('automatic article beautification', () => {
  it('infers major and minor headings while keeping ordinary prose unchanged', () => {
    const input = document(paragraph('前言'), paragraph('这段正文包含中文与数字123，应保持完整。'), paragraph('一、项目背景'), paragraph('1.1 核心概念'), paragraph('普通短句不应自动变成标题'), paragraph('次级标题', true))
    const original = structuredClone(input)
    const result = beautifyDocument(input)
    expect(result.document.content?.map(n => n.type)).toEqual(['heading', 'paragraph', 'heading', 'heading', 'paragraph', 'heading'])
    expect(result.document.content?.filter(n => n.type === 'heading').map(n => n.attrs?.level)).toEqual([2, 2, 3, 3])
    expect(nodeText(result.document)).toBe(nodeText(input))
    expect(input).toEqual(original)
    expect(beautifyDocument(result.document).document).toEqual(result.document)
  })
  it('splits long prose with marks intact and keeps embedded images and nested tables', () => {
    const prose = '这是一句需要保留加粗格式与标点的中文正文，包含数字123。'.repeat(12)
    const input = document(paragraph(prose, true), { type: 'image', attrs: { assetId: 'original', src: 'asset:original', title: '图片说明' } }, { type: 'table', content: [
      { type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph('项目')] }] },
      { type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph('项目内容')] }] },
    ] })
    const result = beautifyDocument(input)
    expect(result.report.splitParagraphs).toBeGreaterThan(0)
    expect(nodeText(result.document)).toBe(nodeText(input))
    expect(result.document.content?.[0].content?.[0].marks).toEqual([{ type: 'bold' }])
    expect(imageNodes(result.document)).toEqual(imageNodes(input))
    expect(result.document.content?.at(-1)?.content?.[0].content?.[0].type).toBe('tableHeader')
    expect(beautifyDocument(result.document).document).toEqual(result.document)
  })
  it('keeps code literal and recognizes fenced code before heading inference', () => {
    const input = document(paragraph('```python'), paragraph('import json'), paragraph('payload = "<script>do_not_execute()</script>"'), paragraph('print(payload)'), paragraph('```'), paragraph('下一段正文。'))
    const result = beautifyDocument(input)
    expect(result.document.content?.[0]).toEqual({ type: 'codeBlock', attrs: { language: 'python' }, content: [{ type: 'text', text: 'import json\npayload = "<script>do_not_execute()</script>"\nprint(payload)' }] })
    expect(result.document.content?.[1]).toEqual(paragraph('下一段正文。'))
    expect(beautifyDocument(result.document).document).toEqual(result.document)
  })
  it('groups contiguous XML and command paragraphs without swallowing following prose', () => {
    const input = document(paragraph('<intent-filter>'), paragraph('  <action android:name="VIEW" />'), paragraph('</intent-filter>'), paragraph('接下来介绍测试步骤。'), paragraph('adb shell am start -a android.intent.action.VIEW'))
    const result = beautifyDocument(input)
    expect(result.document.content?.map(n => n.type)).toEqual(['codeBlock', 'paragraph', 'codeBlock'])
    expect(nodeText(result.document).replace(/\s/g, '')).toBe(nodeText(input).replace(/\s/g, ''))
    expect(beautifyDocument(result.document).document).toEqual(result.document)
  })
  it('preserves shell comments and long copied code panels instead of treating them as Markdown headings', () => {
    const collapsed = '# 示例脚本 v1.0# 配置项import json' + 'def example(): print("literal")'.repeat(12)
    const input = document(paragraph(collapsed), paragraph('后续正文。'), paragraph('# 1. 找到包名'), paragraph('# 2. 再执行命令'), paragraph('adb shell pm list packages'), paragraph('解释这一步的作用。'))
    const result = beautifyDocument(input)
    expect(result.document.content?.map(n => n.type)).toEqual(['codeBlock', 'paragraph', 'codeBlock', 'paragraph'])
    expect(result.document.content?.[0].attrs?.language).toBe('python')
    expect(nodeText(result.document).replace(/\s/g, '')).toBe(nodeText(input).replace(/\s/g, ''))
  })
  it('repairs a Java snippet split between single-line cards and paragraphs without losing whitespace', () => {
    const code = [
      'Intent intent = new Intent();',
      'intent.setClassName("example.app", "ExampleActivity");',
      '',
      '\tintent.putExtra("route", "example://page");',
      'startActivity(intent);',
    ]
    const card = (text: string): JSONContent => ({ type: 'codeBlock', attrs: { language: 'java' }, content: [{ type: 'text', text }] })
    const input = document(paragraph('第三方 POC App', true), ...code.map((line, index) => index % 2 ? paragraph(line) : line ? card(line) : { type: 'paragraph' }), paragraph('这段说明不能进入代码。'))
    const original = structuredClone(input)
    const result = beautifyDocument(input)
    expect(result.document.content?.map(node => node.type)).toEqual(['heading', 'codeBlock', 'paragraph'])
    expect(nodeText(result.document.content![1])).toBe(code.join('\n'))
    expect(result.document.content![1].attrs?.language).toBe('java')
    expect(input).toEqual(original)
    expect(beautifyDocument(result.document).document).toEqual(result.document)
  })
  it('does not merge code fragments across languages, complete multiline examples, headings or images', () => {
    const card = (text: string, language: string): JSONContent => ({ type: 'codeBlock', attrs: { language }, content: [{ type: 'text', text }] })
    const java = card('Intent intent = new Intent();', 'java')
    const image: JSONContent = { type: 'image', attrs: { src: 'https://example.com/image.png' } }
    const input = document(java, card('adb shell pm list packages', 'bash'), paragraph('说明正文。'), java, paragraph('一、另一个示例'), java, image, java, card('intent.putExtra("route", "example");\nstartActivity(intent);', 'java'), card('first();\nsecond();', 'java'))
    const result = beautifyDocument(input)
    expect(result.report.codeBlocks).toBe(7)
    expect(imageNodes(result.document)).toEqual([image])
    expect(nodeText(result.document)).toBe(nodeText(input))
    expect(beautifyDocument(result.document).document).toEqual(result.document)
  })
})

describe('Word documents with missing heading style definitions', () => {
  const xml = (paragraphs: string) => `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`
  const p = (style: string, text: string) => `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
  it('recovers absent numeric styles and their hierarchy, leaving defined body styles alone', () => {
    const recovery = recoverWordStructure(xml(p('3', '一、主要章节') + p('3', '二、实施步骤') + p('4', '1.1 次级章节') + p('0', '正文样式。')), '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:styleId="0"/></w:styles>')
    expect([...recovery.styles]).toEqual([['3', 2], ['4', 3]])
    expect(recovery.recovered).toBe(3)
    const model = { type: 'document', children: [{ type: 'paragraph', styleId: '4', children: [{ type: 'run', children: [{ type: 'text', value: '1.1 次级章节' }] }] }] }
    expect(recovery.transform(model).children[0].styleName).toBe('Zijian Heading 3')
    expect(model.children[0]).not.toHaveProperty('styleName')
  })
  it('does not recover ordinary body text or numeric styles used only inside a table', () => {
    const recovery = recoverWordStructure(xml(p('1', '这是一段正文，带有句号。') + `<w:tbl><w:tr><w:tc>${p('2', '表格内容')}</w:tc></w:tr></w:tbl>`))
    expect(recovery.styles.size).toBe(0)
  })
  it('recovers heading IDs hidden by a malformed nested styles root', () => {
    const styles = '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:styles><w:style w:styleId="1"/><w:style w:styleId="2"/></w:styles></w:styles>'
    const recovery = recoverWordStructure(xml(p('1', '前言') + p('1', 'Agent的核心组成') + p('2', '1、次级章节')), styles)
    expect([...recovery.styles]).toEqual([['1', 2], ['2', 3]])
  })
})
