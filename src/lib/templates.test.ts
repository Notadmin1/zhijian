import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { beautifyDocument } from './beautify'
import { calloutKinds, inferCallout } from './callouts'
import { newArticle, nodeText } from './document'
import { renderArticle } from './render'
import { inspectLayout, recommendTemplate } from './inspection'
import { validateDocument } from './backup'

const p = (text: string, attrs?: Record<string, unknown>): JSONContent => ({ type: 'paragraph', ...(attrs ? { attrs } : {}), content: [{ type: 'text', text, marks: [{ type: 'bold' }] }] })
const code = (text: string, language = 'java'): JSONContent => ({ type: 'codeBlock', attrs: { language }, content: [{ type: 'text', text }] })

describe('semantic cards and article templates', () => {
  it('recognizes only explicit callout labels and preserves exact text, marks and manual suppression', () => {
    const texts = ['说明：保留原文。', '注意：先检查环境。', '前置条件：准备测试设备。', '目标：记录每一步。', '观察：核对实际结果，不能预先认定成功。', '修复建议：保留边界检查。']
    expect(texts.map(text => inferCallout(p(text)))).toEqual(Object.keys(calloutKinds))
    const input: JSONContent = { type: 'doc', content: [...texts.map(text => p(text)), p('注意：手动保持普通正文。', { callout: 'none' }), p('这是一段解释注意事项的普通正文。'), p('观察：'), code('String value = "注意：这里是代码";')] }
    const original = structuredClone(input)
    const result = beautifyDocument(input)
    expect(result.report.callouts).toBe(6)
    expect(nodeText(result.document)).toBe(nodeText(input))
    expect(result.document.content?.[0].content?.[0].marks).toEqual([{ type: 'bold' }])
    expect(result.document.content?.[6].attrs?.callout).toBe('none')
    expect(result.document.content?.[8].attrs?.callout).toBeUndefined()
    expect(beautifyDocument(result.document).document).toEqual(result.document)
    expect(input).toEqual(original)
  })

  it('exports three different layouts while keeping code exact and leaving preview markers out of copied HTML', () => {
    const text = 'Intent intent = new Intent();\n\tintent.putExtra("route", "<script>literal</script>");'
    const document: JSONContent = { type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '验证过程' }] },
      p('观察：结果保持原样。', { callout: 'result' }), code(text),
    ] }
    const outputs = ['research', 'tutorial', 'minimal'].map(id => {
      const article = { ...newArticle('模板', document), themeId: id as 'research' | 'tutorial' | 'minimal' }
      const html = renderArticle(article, { mode: 'clipboard' })
      const parsed = new DOMParser().parseFromString(html, 'text/html')
      expect(parsed.querySelector('pre')?.textContent).toBe(text)
      expect(parsed.querySelectorAll('script,[data-block-index],[data-section-index],[data-callout-kind]')).toHaveLength(0)
      expect(parsed.querySelector('p')?.textContent).toBe('观察：结果保持原样。')
      expect(parsed.querySelector('p')?.parentElement?.style.borderLeft).toContain('3px')
      return html
    })
    expect(new Set(outputs).size).toBe(3)
  })

  it('validates stored card choices and ignores unsupported card attributes', () => {
    const document: JSONContent = { type: 'doc', content: [p('提示。', { callout: 'warning' }), p('普通。', { callout: 'none' }), p('非法。', { callout: 'warning;position:fixed' })] }
    const restored = validateDocument(document)
    expect(restored.content?.map(node => node.attrs?.callout)).toEqual(['warning', 'none', undefined])
    expect(renderArticle(newArticle('卡片', document))).not.toContain('position:fixed')
  })

  it('recommends templates from the current article without modifying it', () => {
    const article = newArticle('安全测试实战', { type: 'doc', content: [p('安全分析与 POC。')] })
    const original = structuredClone(article)
    expect(recommendTemplate(article).id).toBe('research')
    expect(recommendTemplate(newArticle('安装教程')).id).toBe('tutorial')
    expect(recommendTemplate(newArticle('阅读随想')).id).toBe('minimal')
    expect(article).toEqual(original)
  })
})

describe('layout inspection', () => {
  it('finds actionable issues with the correct top-level block and no source changes', () => {
    const article = newArticle('检查', { type: 'doc', content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '主标题' }] },
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '跳级标题' }] },
      p('这是一段需要拆分的长正文。'.repeat(30)),
      code('Intent intent = new Intent();'), code('startActivity(intent);'),
      { type: 'table', content: [{ type: 'tableRow', content: Array.from({ length: 4 }, () => ({ type: 'tableCell', content: [p('内容')] })) }] },
      { type: 'image', attrs: { assetId: 'missing', src: 'asset:missing' } },
    ] })
    article.typography.tableMode = 'fit'
    const original = structuredClone(article)
    const issues = inspectLayout(article, new Set())
    expect(issues.map(issue => [issue.kind, issue.block])).toEqual([['heading', 1], ['paragraph', 2], ['code', 3], ['table', 5], ['image', 6]])
    expect(new Set(issues.map(issue => issue.id)).size).toBe(issues.length)
    expect(article).toEqual(original)
  })

  it('does not suggest merging different languages or report a stored image as missing before reading assets', () => {
    const article = newArticle('边界', { type: 'doc', content: [code('Intent intent = new Intent();'), code('adb shell pm list packages', 'bash'), { type: 'image', attrs: { assetId: 'local', src: 'asset:local', title: '图片说明' } }] })
    expect(inspectLayout(article)).toEqual([])
    expect(inspectLayout(article, new Set(['local']))).toEqual([])
    expect(inspectLayout(article, new Set())[0].title).toContain('无法读取')
  })
})
