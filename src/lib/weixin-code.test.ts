import { describe, expect, it } from 'vitest'
import { newArticle } from './document'
import { renderArticle } from './render'
import { prepareWeixinCodeBlocks } from './weixin-code'

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html')
const readable = (element: Element) => element.textContent!.replace(/\u00a0/g, ' ').replace(/\u200b/g, '')

describe('WeChat code whitespace compatibility', () => {
  it('exports every line, blank line, tab stop and literal markup without relying on pre CSS', () => {
    const text = '\n/* 模型\n\t权限与操作对象 */\n\nif allowed:\n    return "<script>alert(1)</script> & value"\n'
    const article = newArticle('示例', { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'python', codeWrap: 'wrap', highlightLines: '3,4,6', codeTitle: '权限示例.py' }, content: [{ type: 'text', text }] }] })
    article.themeId = 'research'
    const original = JSON.stringify(article)
    const html = renderArticle(article, { mode: 'clipboard' })
    const parsed = parse(html)
    const pre = parsed.querySelector('pre')!
    const font = pre.style.font
    prepareWeixinCodeBlocks(parsed.body)

    const block = parsed.querySelector('p > code')!.parentElement!.parentElement!
    const rows = [...block.querySelectorAll(':scope > p')]
    expect(rows.map(readable)).toEqual([' ', '/* 模型', '    权限与操作对象 */', ' ', 'if allowed:', '    return "<script>alert(1)</script> & value"', ' '])
    expect(block.style.font).toBe(font)
    expect(block.style.whiteSpace).toBe('normal')
    expect(rows.every(row => (row as HTMLElement).style.margin === '0px')).toBe(true)
    expect([...block.querySelectorAll('span')].some(span => span.style.background)).toBe(true)
    expect([...block.querySelectorAll('span')].some(span => span.style.color)).toBe(true)
    expect(parsed.querySelectorAll('pre,script,img')).toHaveLength(0)
    expect(parsed.body.textContent).toContain('权限示例.py')
    expect(JSON.stringify(article)).toBe(original)
    expect(parse(renderArticle(article, { mode: 'clipboard' })).querySelector('pre')?.textContent).toBe(text)
  })

  it('keeps nested syntax spans across newline boundaries and tab stops across sibling tokens', () => {
    const parsed = parse('<pre style="white-space:pre;font:13px/1.8 monospace;"><code><span style="color:red">ab<span style="color:blue">\tX\n  Y</span>\tZ</span></code></pre>')
    prepareWeixinCodeBlocks(parsed.body)
    expect([...parsed.querySelectorAll('p')].map(readable)).toEqual(['ab  X', '  Y Z'])
    expect(parsed.querySelectorAll('p > code > span > span')).toHaveLength(2)
    expect((parsed.querySelector('section') as HTMLElement).style.whiteSpace).toBe('nowrap')
  })

  it('handles code inside tables, single long commands and ordinary inline code independently', () => {
    const long = 'curl https://example.test/?key=' + 'x'.repeat(220)
    const parsed = parse(`<p>正文 <code>inline  value</code></p><table><tbody><tr><td><pre style="white-space:pre-wrap;"><code>a  b\n\n    c</code></pre></td></tr></tbody></table><pre style="white-space:pre;"><code>${long}</code></pre>`)
    prepareWeixinCodeBlocks(parsed.body)
    expect([...parsed.querySelectorAll('td p')].map(readable)).toEqual(['a  b', ' ', '    c'])
    expect(parsed.querySelector('body > p')?.innerHTML).toBe('正文 <code>inline  value</code>')
    expect(parsed.querySelector('body > section')?.children).toHaveLength(1)
    expect(readable(parsed.querySelector('body > section')!)).toBe(long)
    const once = parsed.body.innerHTML
    prepareWeixinCodeBlocks(parsed.body)
    expect(parsed.body.innerHTML).toBe(once)
  })

  it('keeps an empty block and explicit br line breaks as visible lines', () => {
    const parsed = parse('<pre><code></code></pre><pre><code>first<br><br>last<br></code></pre>')
    prepareWeixinCodeBlocks(parsed.body)
    expect([...parsed.querySelectorAll('section')].map(block => [...block.querySelectorAll('p')].map(readable))).toEqual([[' '], ['first', ' ', 'last', ' ']])
  })
})
