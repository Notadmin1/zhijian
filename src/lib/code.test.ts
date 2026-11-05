import { describe, expect, it } from 'vitest'
import { generateJSON } from '@tiptap/react'
import { codeLanguage, findCodeRun } from './code'
import { newArticle, nodeText } from './document'
import { prepareHTML } from './import'
import { renderArticle } from './render'
import { editorExtensions } from './tiptap'

describe('code layout import regressions', () => {
  it('preserves code whitespace in rich paste without folding it into normal paragraphs', async () => {
    const html = '<p>&lt;intent-filter&gt;</p><p>    &lt;action name="VIEW" /&gt;</p><p>\t&lt;data scheme="example" /&gt;</p><p>&lt;/intent-filter&gt;</p><p>说明：保留为正文。</p>'
    const doc = generateJSON(await prepareHTML(html), editorExtensions())
    expect(doc.content?.[0].type).toBe('codeBlock')
    expect(nodeText(doc.content![0])).toBe('<intent-filter>\n    <action name="VIEW" />\n\t<data scheme="example" />\n</intent-filter>')
    expect(doc.content?.[1].type).toBe('paragraph')
  })

  it('stops code at prose, flow arrows and images, keeping source order and every image', async () => {
    expect(findCodeRun(['adb shell pm list packages', '   ↓', '下一步操作'], 0)?.end).toBe(1)
    expect(findCodeRun(['adb shell pm list packages', '  观察：记录结果。'], 0)?.end).toBe(1)
    const html = '<p>adb shell pm list packages</p><p><img src="https://example.com/image.png"></p><p>aapt dump badging sample.apk</p>'
    const output = new DOMParser().parseFromString(await prepareHTML(html), 'text/html')
    expect([...output.body.children].map(node => node.tagName)).toEqual(['PRE', 'P', 'PRE'])
    expect(output.querySelectorAll('img')).toHaveLength(1)
  })

  it('labels Java, HTML and shell correctly and renders literal strings rather than executing them', () => {
    expect(codeLanguage('import java.util.List;\nList items = new ArrayList();')).toBe('java')
    expect(codeLanguage('import json\nprint("text")')).toBe('python')
    expect(codeLanguage('<!DOCTYPE html>\n<html>\n</html>')).toBe('html')
    expect(codeLanguage('aapt dump badging sample.apk')).toBe('bash')
    const code = '<!DOCTYPE html>\n<html>\n    <script>literal()</script>\n</html>'
    const article = newArticle('代码', { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'html' }, content: [{ type: 'text', text: code }] }] })
    const parsed = new DOMParser().parseFromString(renderArticle(article, { mode: 'clipboard' }), 'text/html')
    expect(parsed.querySelector('pre')?.textContent).toBe(code)
    expect(parsed.querySelectorAll('script')).toHaveLength(0)
    expect(parsed.querySelectorAll('pre span').length).toBeGreaterThan(5)
  })
})
