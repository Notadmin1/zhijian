import { describe, expect, it } from 'vitest'
import { headingCandidates, newArticle, nodeText, plainText, sanitizeHTML, tidyDocument } from './document'
import { htmlFile, renderArticle } from './render'
import type { JSONContent } from '@tiptap/react'

describe('structure and lossless formatting', () => {
  const doc: JSONContent = { type: 'doc', content: [
    { type: 'paragraph' }, { type: 'paragraph' },
    { type: 'paragraph', content: [{ type: 'text', text: '一、项目背景' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '内容 123，不应被改写。' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '01 另一节标题' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '短句不是标题。' }] },
    { type: 'paragraph' }, { type: 'paragraph' },
  ] }
  it('proposes numbered headings without guessing arbitrary short paragraphs', () => {
    expect(headingCandidates(doc).map(c => c.index)).toEqual([2, 4])
  })
  it('changes only confirmed headings, preserves text, and is idempotent', () => {
    const original = structuredClone(doc)
    const cleaned = tidyDocument(doc, [2])
    expect(cleaned.content?.[0].type).toBe('heading')
    expect(cleaned.content?.[2].type).toBe('paragraph')
    expect(nodeText(cleaned)).toBe(nodeText(doc))
    expect(doc).toEqual(original)
    expect(tidyDocument(cleaned)).toEqual(cleaned)
  })
  it('preserves nested text and line breaks in plain text exports', () => {
    expect(plainText({ type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一行' }, { type: 'hardBreak' }, { type: 'text', text: '第二行' }] }] }] }] })).toBe('第一行\n第二行')
  })
})

describe('platform export', () => {
  it('escapes content and ignores unsafe URLs and invalid style input', () => {
    const article = newArticle('<script>标题</script>', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '<img onerror=alert(1)>', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] })
    article.typography.accent = 'red;position:fixed'
    article.typography.includeTitle = true
    const html = renderArticle(article)
    expect(html).toContain('&lt;script&gt;标题&lt;/script&gt;')
    expect(html).toContain('&lt;img onerror=alert(1)&gt;')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('position:fixed')
    expect(html).not.toContain('<script>')
  })
  it('keeps local images in previews and numbered placeholders in clipboard output', () => {
    const article = newArticle('标题', { type: 'doc', content: [{ type: 'image', attrs: { assetId: 'a', src: 'asset:a', title: '图片说明' } }, { type: 'image', attrs: { src: 'https://example.com/photo.png', alt: '远程图' } }] })
    expect(renderArticle(article, { assets: { a: 'blob:test' } })).toContain('src="blob:test"')
    const html = renderArticle(article, { mode: 'clipboard', imagePolicy: 'placeholder', assets: { a: 'blob:test' } })
    expect(html).toContain('图片 1：图片说明')
    expect(html).toContain('图片 2：远程图')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('blob:')
  })
  it('embeds local pictures for rich copy and keeps safe remote pictures', () => {
    const article = newArticle('图文', { type: 'doc', content: [
      { type: 'image', attrs: { assetId: 'a', src: 'asset:a' } },
      { type: 'image', attrs: { src: 'https://example.com/photo.png' } },
    ] })
    const html = renderArticle(article, { mode: 'clipboard', assets: { a: 'data:image/png;base64,aGVsbG8=' } })
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    expect(parsed.querySelectorAll('img')).toHaveLength(2)
    expect(parsed.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,aGVsbG8=')
    expect(html).not.toContain('blob:')
    expect(html).not.toContain('上传替换')
  })
  it('escapes code without interpreting article markup as executable HTML', () => {
    const code = 'const input = "<script>alert(1)</script>";\nprint(input)'
    const article = newArticle('代码', { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'javascript' }, content: [{ type: 'text', text: code }] }] })
    const parsed = new DOMParser().parseFromString(renderArticle(article), 'text/html')
    expect(parsed.querySelector('script')).toBeNull()
    expect(parsed.querySelector('pre')?.textContent).toBe(code)
    expect(parsed.querySelectorAll('pre span').length).toBeGreaterThan(0)
  })
  it('omits title unless explicitly enabled and uses inline styles', () => {
    const article = newArticle('独立标题')
    expect(renderArticle(article)).not.toContain('独立标题')
    article.typography.includeTitle = true
    expect(renderArticle(article)).toContain('独立标题')
    expect(renderArticle(article)).toContain('style=')
    expect(renderArticle(article)).not.toContain('class=')
  })
  it('exports a copyable standalone article with one title and separate page controls', () => {
    const article = newArticle('独立标题 <script>literal</script>', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '原始正文' }] }] })
    const parse = () => new DOMParser().parseFromString(htmlFile(article.title, renderArticle(article)), 'text/html')
    const withoutTitle = parse()
    expect(withoutTitle.querySelector('#export-article')?.textContent).toBe('原始正文')
    expect(withoutTitle.querySelector('#export-article button')).toBeNull()
    expect(withoutTitle.querySelectorAll('script')).toHaveLength(1)
    expect(withoutTitle.querySelector('#copy-article')?.textContent).toBe('复制到公众号')
    article.typography.includeTitle = true
    const withTitle = parse()
    expect(withTitle.querySelectorAll('h1')).toHaveLength(1)
    expect(withTitle.querySelector('#export-article h1')?.textContent).toBe(article.title)
  })
  it('removes source formatting and executable content from imported HTML', () => {
    const html = sanitizeHTML('<p style="color:red" onclick="x()">正文<script>alert(1)</script><strong>重点</strong></p><a href="javascript:x()">链接</a>')
    expect(html).toContain('<strong>重点</strong>')
    expect(html).not.toMatch(/script|onclick|style=|javascript:/)
  })
  it('preserves Word emphasis encoded as styles before removing source formatting', () => {
    const html = sanitizeHTML('<p><span style="color:red;font-weight:700;font-style:italic">强调内容</span></p>')
    expect(html).toContain('<strong>')
    expect(html).toContain('<em>')
    expect(html).not.toContain('style=')
  })
})
