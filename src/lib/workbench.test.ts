import { beforeEach, describe, expect, it } from 'vitest'
import { newArticle } from './document'
import { documentOutline } from './outline'
import { applyPreferences, readPreferences, writePreferences } from './preferences'
import { renderArticle } from './render'
import { safeTypography } from './themes'

describe('article preferences and compatibility', () => {
  beforeEach(() => localStorage.clear())

  it('uses personal defaults for a new article without changing an existing article', () => {
    const existing = newArticle('已有草稿')
    const preferences = { themeId: 'technical' as const, typography: { ...existing.typography, fontSize: 18, leadParagraph: false, codeWrap: false }, autoBeautify: false }
    writePreferences(preferences)
    const created = applyPreferences(newArticle('新文章'), readPreferences())
    created.typography.fontSize = 19
    expect(existing.themeId).toBe('botanical')
    expect(existing.typography.fontSize).toBe(16)
    expect(created.themeId).toBe('technical')
    expect(created.typography.leadParagraph).toBe(false)
    expect(readPreferences()).toEqual(preferences)
  })

  it('handles older settings, malformed preferences and out-of-range code settings', () => {
    expect(safeTypography({ fontSize: 18, leadParagraph: false })).toMatchObject({ fontSize: 18, leadParagraph: false, codeFontSize: 13, codeWrap: true, tableMode: 'auto' })
    localStorage.setItem('zijian-preferences-v1', '{invalid')
    expect(readPreferences().themeId).toBe('botanical')
    localStorage.setItem('zijian-preferences-v1', JSON.stringify({ themeId: 'missing', typography: { codeFontSize: 100, tableMode: 'invalid', accent: 'red;position:fixed' } }))
    expect(readPreferences()).toMatchObject({ themeId: 'botanical', typography: { codeFontSize: 18, tableMode: 'auto', accent: '#416c58' } })
  })
})

describe('navigation and technical article output', () => {
  it('distinguishes repeated and nested headings using document order', () => {
    const article = newArticle('目录', { type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '同名章节' }] },
      { type: 'blockquote', content: [{ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '嵌套标题', marks: [{ type: 'bold' }] }] }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '同名章节' }] },
    ] })
    expect(documentOutline(article.document)).toEqual([{ index: 0, level: 2, text: '同名章节' }, { index: 1, level: 3, text: '嵌套标题' }, { index: 2, level: 2, text: '同名章节' }])
    const parse = (mode: 'preview' | 'clipboard' | 'download') => new DOMParser().parseFromString(renderArticle(article, { mode }), 'text/html')
    expect([...parse('preview').querySelectorAll('[data-section-index]')].map(node => node.getAttribute('data-section-index'))).toEqual(['0', '1', '2'])
    expect(parse('preview').querySelector('[data-section-index="2"]')?.getAttribute('data-block-index')).toBe('2')
    for (const mode of ['clipboard', 'download'] as const) expect(parse(mode).querySelector('[data-section-index],[data-block-index]')).toBeNull()
  })

  it('keeps literal long code and supports readable wide tables in exported HTML', () => {
    const code = 'const value = "<script>literal</script>";\n  console.log(value);' + 'x'.repeat(300)
    const article = newArticle('技术文章', { type: 'doc', content: [
      { type: 'codeBlock', attrs: { language: 'javascript' }, content: [{ type: 'text', text: code }] },
      { type: 'table', content: [{ type: 'tableRow', content: Array.from({ length: 4 }, (_, i) => ({ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: `列${i + 1}` }] }] })) }] },
    ] })
    article.themeId = 'technical'
    article.typography = { ...article.typography, codeFontSize: 15, codeWrap: false }
    const parse = () => new DOMParser().parseFromString(renderArticle(article, { mode: 'clipboard' }), 'text/html')
    let output = parse()
    expect(output.querySelector('pre')?.textContent).toBe(code)
    expect(output.querySelector('script')).toBeNull()
    expect(output.querySelector('pre')?.style).toMatchObject({ fontSize: '15px', whiteSpace: 'pre', overflowX: 'auto' })
    expect(output.querySelector('table')?.style.minWidth).toBe('480px')
    article.typography.codeWrap = true
    article.typography.tableMode = 'fit'
    output = parse()
    expect(output.querySelector('pre')?.style.whiteSpace).toBe('pre-wrap')
    expect(output.querySelector('pre')?.textContent).toBe(code)
    expect(output.querySelector('table')?.style.minWidth).toBe('')
  })
})
