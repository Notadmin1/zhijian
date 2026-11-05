import { beforeEach, describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { newArticle } from './document'
import { defaultTypography, safeTypography, themes } from './themes'
import { applyReadingDensity, withBlockMargins } from './reading-style'
import { renderArticle } from './render'
import { db } from './storage'
import { presetChanges, savePreset } from './presets'
import { createBackup, restoreBackup } from './backup'

const p = (text: string, attrs = {}): JSONContent => ({ type: 'paragraph', attrs, content: [{ type: 'text', text }] })
const heading = (text: string, level = 2): JSONContent => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] })
const codeText = '/* first\n\tsecond */\n\nString value = "<script>literal</script>";\n'
const code: JSONContent = { type: 'codeBlock', attrs: { language: 'java', codeTitle: 'Example.java', codeWrap: 'scroll', highlightLines: '2,4' }, content: [{ type: 'text', text: codeText }] }
const image: JSONContent = { type: 'image', attrs: { src: 'https://example.com/original.png', title: '原始图片', displayWidth: 75, imageAlign: 'right', imageFrame: 'border' } }
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html')
const blocksOf = (document: Document) => [...document.body.firstElementChild!.children] as HTMLElement[]

describe('reading rhythm and decoration', () => {
  it('normalizes legacy settings while preserving fonts and explicit manual tweaks', () => {
    const legacy = safeTypography({ fontSize: 19, codeFontSize: 15, lineHeight: 2.2, paragraphSpace: 25, accent: '#124567', serif: true })
    expect(legacy).toMatchObject({ readingDensity: 'standard', smartSpacing: true, decoration: 'balanced', lineHeight: 2.2, paragraphSpace: 25 })
    const compact = applyReadingDensity(legacy, 'compact')
    expect(compact).toEqual({ ...legacy, readingDensity: 'compact', lineHeight: 1.65, paragraphSpace: 12 })
    const invalid = safeTypography(JSON.parse('{"readingDensity":"invalid","decoration":"invalid","smartSpacing":false}'))
    expect(invalid).toMatchObject({ readingDensity: 'standard', decoration: 'balanced', smartSpacing: false })
  })

  it('uses a single contextual gap, binds descriptions to media, and separates new chapters', () => {
    const article = newArticle('留白', { type: 'doc', content: [heading('章节'), heading('子标题', 3), p('说明如下：', { callout: 'none' }), code, image, p('后续正文'), heading('下一章节'), p('结束')] })
    const original = structuredClone(article)
    const parsed = parse(renderArticle(article))
    const blocks = blocksOf(parsed)
    expect(blocks.map(block => block.style.marginTop)).toEqual(Array(8).fill('0px'))
    expect(blocks.map(block => block.style.marginBottom)).toEqual(['10px', '14px', '10px', '22px', '18px', '34px', '14px', '0px'])
    expect(article).toEqual(original)
    article.typography = applyReadingDensity(article.typography, 'compact')
    expect(blocksOf(parse(renderArticle(article))).map(block => block.style.marginBottom)).toEqual(['8px', '11px', '8px', '18px', '14px', '27px', '11px', '0px'])
    article.typography.smartSpacing = false
    const fixed = blocksOf(parse(renderArticle(article)))
    expect(fixed[0].style.marginTop).toBe('27px')
    expect(fixed[2].style.marginBottom).toBe('12px')
    expect(fixed[3].style.marginTop).toBe('18px')
  })

  it('leaves nested lists and quotations readable without introducing lead cards inside them', () => {
    const long = '这是列表内的长说明，保留文字并使用紧凑的内部间隔。'.repeat(3)
    const article = newArticle('列表', { type: 'doc', content: [
      { type: 'bulletList', content: [{ type: 'listItem', content: [p(long), p('第二段')] }] },
      { type: 'blockquote', content: [p(long)] }, p(long),
    ] })
    const parsed = parse(renderArticle(article))
    const listParagraph = parsed.querySelector('li p') as HTMLElement
    expect(listParagraph.style.marginBottom).toBe('4px')
    expect(listParagraph.style.background).toBe('')
    expect((parsed.querySelector('blockquote p') as HTMLElement).style.marginBottom).toBe('4px')
    expect(blocksOf(parsed)[2].style.background).not.toBe('')
  })

  it('changes visual weight without ignoring disabled heading numbers or lead styling', () => {
    const article = newArticle('装饰', { type: 'doc', content: [heading('无编号标题'), p('这是开篇导语。'.repeat(12)), p('注意说明', { callout: 'note' }), code] })
    article.themeId = 'research'
    article.typography.numberHeadings = false
    article.typography.leadParagraph = false
    const variants = ['simple', 'balanced', 'expressive'].map(decoration => parse(renderArticle({ ...article, typography: { ...article.typography, decoration: decoration as 'simple' | 'balanced' | 'expressive' } })))
    expect(variants.map(doc => doc.querySelector('h2')!.textContent)).toEqual(Array(3).fill('无编号标题'))
    expect(variants.map(doc => (doc.querySelector('h2') as HTMLElement).style.borderLeftWidth)).toEqual(['', '4px', '4px'])
    expect(variants.map(doc => (doc.querySelector('pre') as HTMLElement).style.color)).toEqual(['rgb(67, 82, 104)', 'rgb(225, 234, 245)', 'rgb(225, 234, 245)'])
    expect(variants.map(doc => (doc.querySelector('[data-callout-kind]') as HTMLElement).style.borderLeftWidth)).toEqual(['2px', '3px', '4px'])
    for (const doc of variants) expect(blocksOf(doc)[1].style.background).toBe('')
  })

  it('preserves exact content, local settings and inline publishing styles across every theme and reading style', () => {
    const article = newArticle('全文保留', { type: 'doc', content: [heading('章节标题'), p('运行以下示例：'), code, image,
      { type: 'paragraph', content: [{ type: 'text', text: '原链接', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com/?a=1&b=2' } }] }] },
    ] })
    const original = structuredClone(article)
    for (const theme of themes) for (const density of ['compact', 'standard', 'relaxed'] as const) for (const decoration of ['simple', 'balanced', 'expressive'] as const) {
      const typography = { ...applyReadingDensity(article.typography, density), decoration }
      const variants = ['preview', 'clipboard', 'download'].map(mode => parse(renderArticle({ ...article, themeId: theme.id, typography }, { mode: mode as 'preview' | 'clipboard' | 'download' })))
      for (const [index, doc] of variants.entries()) {
        const pre = doc.querySelector('pre') as HTMLElement
        const img = doc.querySelector('img') as HTMLImageElement
        expect(pre.textContent).toBe(codeText)
        expect(pre.style.whiteSpace).toBe('pre')
        expect(pre.style.lineHeight).toBe(density === 'compact' ? '1.7' : density === 'standard' ? '1.85' : '2')
        expect(pre.previousElementSibling!.textContent).toContain('Example.java')
        expect([...pre.querySelectorAll('span')].filter(span => span.style.background).map(span => span.textContent)).toEqual(['\tsecond */', 'String value = "<script>literal</script>";'])
        expect(img.style.width).toBe('75%')
        expect(img.style.marginLeft).toBe('auto')
        expect(img.style.marginRight).toBe('0px')
        expect(img.style.borderWidth).toBe('1px')
        expect(doc.querySelector('a')!.getAttribute('href')).toBe('https://example.com/?a=1&b=2')
        expect(doc.querySelectorAll('script,button,input,select')).toHaveLength(0)
        if (index) {
          expect(doc.querySelectorAll('[data-block-index],[data-section-index],[data-callout-kind]')).toHaveLength(0)
          expect([...doc.querySelectorAll('[style]')].map(node => node.getAttribute('style'))).toEqual([...variants[0].querySelectorAll('[style]')].map(node => node.getAttribute('style')))
        }
      }
    }
    expect(article).toEqual(original)
  })

  it('overrides only the outer block margins without rewriting code text or nested styles', () => {
    const html = '<section style="margin:20px 0"><pre style="margin:3px">&lt;section style="text"&gt;\n\tunchanged</pre></section>'
    const parsed = parse(withBlockMargins(html, 13))
    expect((parsed.querySelector('section') as HTMLElement).style.marginTop).toBe('0px')
    expect((parsed.querySelector('section') as HTMLElement).style.marginBottom).toBe('13px')
    expect((parsed.querySelector('pre') as HTMLElement).style.margin).toBe('3px')
    expect(parsed.querySelector('pre')!.textContent).toBe('<section style="text">\n\tunchanged')
  })
})

describe('reading style persistence', () => {
  beforeEach(async () => { await Promise.all([db.articles.clear(), db.assets.clear(), db.versions.clear(), db.presets.clear()]) })

  it('round-trips custom reading styles through personal presets and full ZIP backups', async () => {
    const article = newArticle('样式备份', { type: 'doc', content: [heading('标题'), code] })
    article.typography = { ...applyReadingDensity(defaultTypography(), 'relaxed'), lineHeight: 2.1, smartSpacing: false, decoration: 'simple', fontSize: 18 }
    const preset = await savePreset(article, '舒展技术文章', '')
    expect(presetChanges(newArticle(), preset).typography).toEqual(article.typography)
    const [restored] = await restoreBackup(await createBackup([article]))
    expect(restored.typography).toEqual(article.typography)
    const restoredPreset = (await db.presets.toArray()).find(item => item.id !== preset.id)!
    expect(restoredPreset.typography).toEqual(article.typography)
    expect(parse(renderArticle(restored)).querySelector('pre')!.textContent).toBe(codeText)
  })
})
