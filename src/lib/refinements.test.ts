import { beforeEach, describe, expect, it } from 'vitest'
import { generateJSON, type JSONContent } from '@tiptap/react'
import { newArticle, nodeText, sanitizeHTML } from './document'
import { renderArticle } from './render'
import { beautifyDocument } from './beautify'
import { createBackup, restoreBackup, validateDocument } from './backup'
import { editorExtensions } from './tiptap'
import { db } from './storage'
import { inspectLayout } from './inspection'

const code = (text: string, attrs: Record<string, unknown> = {}): JSONContent => ({ type: 'codeBlock', attrs: { language: 'java', ...attrs }, content: [{ type: 'text', text }] })
const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] })

describe('local block presentation', () => {
  beforeEach(async () => { await db.articles.clear(); await db.assets.clear() })

  it('keeps code text and multiline tokens exact while independently styling snippets in all output modes', () => {
    const text = '/* first\n\tsecond\nthird */\n\nString value = "<script>literal</script>";\n'
    const article = newArticle('局部代码', { type: 'doc', content: [code(text, { codeTitle: '<img onerror="x">.java', codeWrap: 'scroll', highlightLines: '2,5' }), code(text, { codeWrap: 'wrap' })] })
    article.themeId = 'research'
    for (const mode of ['preview', 'clipboard', 'download'] as const) {
      const parsed = new DOMParser().parseFromString(renderArticle(article, { mode }), 'text/html')
      const snippets = [...parsed.querySelectorAll('pre')]
      expect(snippets.map(snippet => snippet.textContent)).toEqual([text, text])
      expect(snippets.map(snippet => snippet.style.whiteSpace)).toEqual(['pre', 'pre-wrap'])
      expect([...snippets[0].querySelectorAll('span')].filter(span => span.style.background).map(span => span.textContent)).toEqual(['\tsecond', 'String value = "<script>literal</script>";'])
      expect(parsed.querySelectorAll('script,img,[data-code-wrap],[data-code-title]')).toHaveLength(0)
      expect(snippets[0].previousElementSibling?.textContent).toContain('<img onerror="x">.java')
    }
  })

  it('protects customized one-line examples and manual table headers when beautifying again', () => {
    const document: JSONContent = { type: 'doc', content: [code('Intent intent = new Intent();', { codeTitle: '创建示例' }), code('startActivity(intent);', { highlightLines: '1' }), { type: 'table', attrs: { headerMode: 'manual' }, content: [
      { type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph('第一条数据')] }] },
      { type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph('第二条数据')] }] },
    ] }] }
    const original = structuredClone(document)
    const result = beautifyDocument(document).document
    expect(result).toEqual(original)
    expect(beautifyDocument(result).document).toEqual(result)
    expect(inspectLayout(newArticle('保留局部设置', result)).some(issue => issue.title.includes('多个小框'))).toBe(false)
    expect(document).toEqual(original)
  })

  it('round-trips local image and code presentation through backup and retains original image bytes', async () => {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
    await db.assets.put({ id: 'picture', name: '截图.png', mime: 'image/png', blob, createdAt: 1 })
    const article = newArticle('局部备份', { type: 'doc', content: [code('print("保留")', { language: 'python', codeTitle: 'main.py', codeWrap: 'scroll', highlightLines: '1' }), { type: 'image', attrs: { assetId: 'picture', src: 'asset:picture', title: '图注', displayWidth: 50, imageAlign: 'right', imageFrame: 'border' } }] })
    const [restored] = await restoreBackup(await createBackup([article]))
    expect(nodeText(restored.document)).toBe(nodeText(article.document))
    expect(restored.document.content?.[0].attrs).toMatchObject(article.document.content![0].attrs!)
    const attrs = restored.document.content![1].attrs!
    expect(attrs).toMatchObject({ title: '图注', displayWidth: 50, imageAlign: 'right', imageFrame: 'border' })
    expect(attrs.assetId).not.toBe('picture')
    expect(new Uint8Array(await (await db.assets.get(attrs.assetId))!.blob.arrayBuffer())).toEqual(new Uint8Array(await blob.arrayBuffer()))
    expect(restored.sourceSnapshot.content?.[1].attrs).toEqual(attrs)
    const parsed = new DOMParser().parseFromString(renderArticle(restored, { mode: 'clipboard', assets: { [attrs.assetId]: 'data:image/png;base64,iVBORw==' } }), 'text/html')
    expect(parsed.querySelector('img')?.style.width).toBe('50%')
    expect(parsed.querySelector('img')?.style.margin).toBe('0px 0px 0px auto')
    expect(parsed.querySelector('img')?.style.border).toContain('1px')
  })

  it('preserves valid presentation attributes through HTML parsing and removes invalid style values', () => {
    const document = generateJSON(sanitizeHTML('<pre data-code-title="main.java" data-code-wrap="scroll" data-code-highlight="2,3-4"><code class="language-java">first\nsecond</code></pre><img src="https://example.com/p.png" data-image-width="50" data-image-align="left" data-image-frame="shadow">'), editorExtensions())
    expect(document.content?.[0].attrs).toMatchObject({ codeTitle: 'main.java', codeWrap: 'scroll', highlightLines: '2,3-4' })
    expect(document.content?.[1].attrs).toMatchObject({ displayWidth: 50, imageAlign: 'left', imageFrame: 'shadow' })
    const unsafe: JSONContent = { type: 'doc', content: [code('literal', { codeWrap: 'scroll;position:fixed', highlightLines: '1,1-99999999', codeTitle: '</p><script>x</script>' }), { type: 'image', attrs: { src: 'https://example.com/p.png', displayWidth: -20, imageAlign: 'left;position:fixed', imageFrame: 'url(javascript:x)' } }] }
    const clean = validateDocument(unsafe)
    expect(clean.content?.[0].attrs).toMatchObject({ codeWrap: null, highlightLines: '1' })
    expect(clean.content?.[1].attrs).toMatchObject({ displayWidth: null, imageAlign: 'center', imageFrame: 'none' })
    expect(renderArticle(newArticle('检查', clean))).not.toMatch(/position:fixed|<script>/)
  })

  it('checks long code using each block override instead of only the article default', () => {
    const article = newArticle('长行', { type: 'doc', content: [code('String command = "' + 'x'.repeat(110) + '";', { codeWrap: 'scroll' }), code('String value = "' + 'x'.repeat(110) + '";', { codeWrap: 'wrap' })] })
    article.typography.codeWrap = false
    expect(inspectLayout(article).filter(issue => issue.title.includes('较长的行')).map(issue => issue.block)).toEqual([1])
  })

  it('keeps manually formatted code compact inside tables while preserving its local settings', () => {
    const text = '\tIntent intent = new Intent();\nstartActivity(intent);'
    const article = newArticle('表格代码', { type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [code(text, { codeTitle: '示例.java', codeWrap: 'scroll', highlightLines: '2' })] }] }] }] })
    const parsed = new DOMParser().parseFromString(renderArticle(article, { mode: 'clipboard' }), 'text/html')
    expect(parsed.querySelector('td pre')?.textContent).toBe(text)
    expect(parsed.querySelector<HTMLPreElement>('td pre')?.style.whiteSpace).toBe('pre')
    expect(parsed.querySelector('td > p')?.textContent).toBe('示例.java')
    expect(parsed.querySelectorAll('td section')).toHaveLength(0)
  })
})
