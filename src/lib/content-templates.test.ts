import { beforeEach, describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { generateJSON, getSchema, type JSONContent } from '@tiptap/react'
import { db } from './storage'
import { newArticle, nodeText, imageNodes } from './document'
import { applyContentTemplates, insertContentTemplate, safeContentTemplate, saveContentTemplate, setAutomaticContentTemplate } from './content-templates'
import { editorExtensions } from './tiptap'
import { renderArticle } from './render'
import { createBackup, restoreBackup } from './backup'

const p = (text: string): JSONContent => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
const input = (name = '常用开场', position: 'header' | 'footer' = 'header', document = doc(p('欢迎阅读。'))) => ({ name, position, document })

beforeEach(async () => { await Promise.all([db.articles.clear(), db.assets.clear(), db.versions.clear(), db.presets.clear(), db.contentTemplates.clear()]) })

describe('content template insertion', () => {
  it('adds rich openings and endings without changing original code, snapshots, marks or image settings', () => {
    const code = 'class Example {\n\tString value = "<script>literal</script>";\n\n}\n'
    const article = newArticle('保持原稿', doc(p('正文'), { type: 'codeBlock', attrs: { language: 'java', codeTitle: 'Example.java', codeWrap: 'scroll', highlightLines: '2' }, content: [{ type: 'text', text: code }] }))
    const original = structuredClone(article)
    const opening = safeContentTemplate(input('作者介绍', 'header', doc({ type: 'paragraph', attrs: { callout: 'note' }, content: [{ type: 'text', text: '作者介绍', marks: [{ type: 'bold' }] }] })))
    const ending = safeContentTemplate(input('关注文末', 'footer', doc({ type: 'horizontalRule' }, { type: 'paragraph', content: [{ type: 'text', text: '欢迎关注', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }] }, { type: 'image', attrs: { src: 'https://example.com/qr.png', displayWidth: 33, imageAlign: 'center', title: '公众号二维码' } })))
    const result = insertContentTemplate(insertContentTemplate(article.document, opening).document, ending)
    expect(result.inserted).toBe(true)
    expect(result.document.content!.slice(1, 3)).toEqual(article.document.content)
    const html = new DOMParser().parseFromString(renderArticle({ ...article, document: result.document }, { mode: 'clipboard' }), 'text/html')
    expect(html.querySelector('pre')!.textContent).toBe(code)
    expect((html.querySelector('pre') as HTMLElement).style.whiteSpace).toBe('pre')
    expect(html.querySelector('strong')!.textContent).toBe('作者介绍')
    expect(html.querySelector('a')!.href).toBe('https://example.com/')
    expect((html.querySelector('img') as HTMLImageElement).style.width).toBe('33%')
    expect(html.querySelectorAll('script,button,[data-block-index]')).toHaveLength(0)
    expect(article).toEqual(original)
  })

  it('avoids repeated edge insertions after editor normalization, leading and trailing blank paragraphs', () => {
    for (const position of ['header', 'footer'] as const) {
      const template = safeContentTemplate(input('开头文末', position))
      const inserted = insertContentTemplate(doc(p('正文')), template).document
      const normalized = getSchema(editorExtensions()).nodeFromJSON(inserted).toJSON()
      const withBlanks = doc(p(''), ...normalized.content, p(''), p(''))
      const again = insertContentTemplate(withBlanks, template)
      expect(again).toEqual({ document: withBlanks, inserted: false })
      const changed = safeContentTemplate(input('修改后的模板', position, doc(p('不同的内容'))))
      expect(insertContentTemplate(normalized, changed).inserted).toBe(true)
    }
  })

  it('leaves space to write between automatic opening and ending in a new blank article', () => {
    const opening = { ...safeContentTemplate(input()), autoInsert: true }
    const ending = { ...safeContentTemplate(input('文末', 'footer', doc(p('感谢阅读。')))), autoInsert: true }
    const result = applyContentTemplates(newArticle().document, [opening, ending])
    expect(result.content!.map(nodeText)).toEqual(['欢迎阅读。', '', '感谢阅读。'])
    expect(applyContentTemplates(result, [opening, ending])).toEqual(result)
    expect(applyContentTemplates(result, [{ ...opening, autoInsert: false }])).toBe(result)
  })

  it('rejects blank templates, invalid hierarchies, unsafe image sources and excessive text', () => {
    expect(() => safeContentTemplate(input('', 'header'))).toThrow('名称')
    expect(() => safeContentTemplate(input('空白', 'header', doc(p(''), p('  '))))).toThrow('内容')
    expect(() => safeContentTemplate(input('过长', 'header', doc(p('字'.repeat(10001)))))).toThrow('10000')
    expect(() => safeContentTemplate(input('结构无效', 'header', doc({ type: 'text', text: '直接文本' })))).toThrow('格式')
    const template = safeContentTemplate(input('安全内容', 'footer', doc({ type: 'paragraph', content: [{ type: 'text', text: '<script>只是文字</script>', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] })))
    const html = new DOMParser().parseFromString(renderArticle(newArticle('模板', template.document)), 'text/html')
    expect(html.querySelectorAll('a,script')).toHaveLength(0)
    expect(html.body.textContent).toContain('<script>只是文字</script>')
  })
})

describe('template library and backups', () => {
  it('updates named templates, enforces one automatic choice per position, and switches it off after moving position', async () => {
    const a = await saveContentTemplate(input('开头一'))
    const b = await saveContentTemplate(input('开头二'))
    const footer = await saveContentTemplate(input('文末', 'footer'))
    await setAutomaticContentTemplate('header', a.id)
    await setAutomaticContentTemplate('footer', footer.id)
    await setAutomaticContentTemplate('header', b.id)
    expect((await db.contentTemplates.toArray()).filter(template => template.autoInsert).map(template => template.id).sort()).toEqual([b.id, footer.id].sort())
    await expect(saveContentTemplate(input('开头二'))).rejects.toThrow('同名')
    await expect(setAutomaticContentTemplate('footer', a.id)).rejects.toThrow('位置')
    const updated = await saveContentTemplate(input('开头二改名', 'header', doc(p('更新的内容'))), b.id)
    expect(updated).toMatchObject({ id: b.id, createdAt: b.createdAt, autoInsert: true })
    expect(nodeText(updated.document)).toBe('更新的内容')
    const moved = await saveContentTemplate(input('移到文末', 'footer'), b.id)
    expect(moved.autoInsert).toBe(false)
    await setAutomaticContentTemplate('footer', '')
    expect((await db.contentTemplates.toArray()).some(template => template.autoInsert)).toBe(false)
    await expect(saveContentTemplate(input('已删除的模板'), 'missing')).rejects.toThrow('不存在')
  })

  it('backs up template-only images and remaps their IDs without replacing current automatic choices', async () => {
    const originalBytes = new Uint8Array([137, 80, 78, 71])
    await db.assets.put({ id: 'template-only', name: '二维码.png', mime: 'image/png', blob: new Blob([originalBytes], { type: 'image/png' }), createdAt: 1 })
    const template = await saveContentTemplate(input('二维码文末', 'footer', doc(p('欢迎关注'), { type: 'image', attrs: { assetId: 'template-only', src: 'asset:template-only', displayWidth: 33, title: '二维码' } })))
    await setAutomaticContentTemplate('footer', template.id)
    const backup = await createBackup([newArticle('文章')])
    const zip = await JSZip.loadAsync(await backup.arrayBuffer())
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
    expect(manifest.version).toBe(3)
    expect(manifest.assets).toHaveLength(1)
    await restoreBackup(backup)
    const restored = (await db.contentTemplates.toArray()).find(item => item.id !== template.id)!
    expect(restored.name).toBe('二维码文末（恢复 1）')
    expect(restored.autoInsert).toBe(false)
    expect((await db.contentTemplates.get(template.id))!.autoInsert).toBe(true)
    const restoredImageId = imageNodes(restored.document)[0].attrs!.assetId
    expect(restoredImageId).not.toBe('template-only')
    expect(new Uint8Array(await (await db.assets.get(restoredImageId))!.blob.arrayBuffer())).toEqual(originalBytes)
    expect(imageNodes(restored.document)[0].attrs).toMatchObject({ displayWidth: 33, title: '二维码' })
    await db.contentTemplates.clear()
    await restoreBackup(backup)
    expect((await db.contentTemplates.toArray())[0].autoInsert).toBe(true)
  })

  it('rejects a missing template image atomically and still restores older v2 backups', async () => {
    await expect(saveContentTemplate(input('缺图', 'footer', doc({ type: 'image', attrs: { assetId: 'missing', src: 'asset:missing' } })))).rejects.toThrow('丢失')
    const template = safeContentTemplate(input('图片模板', 'footer', doc({ type: 'image', attrs: { assetId: 'missing', src: 'asset:missing' } })))
    const article = newArticle('测试恢复')
    const manifest = { app: 'zijian-studio', version: 3, articles: [article], assets: [], versions: [], presets: [], contentTemplates: [template] }
    const blob = await new JSZip().file('manifest.json', JSON.stringify(manifest)).generateAsync({ type: 'blob' })
    await expect(restoreBackup(blob)).rejects.toThrow('缺少')
    expect(await db.articles.count()).toBe(0)
    expect(await db.contentTemplates.count()).toBe(0)
    const oldBackup = await new JSZip().file('manifest.json', JSON.stringify({ ...manifest, version: 2, contentTemplates: undefined })).generateAsync({ type: 'blob' })
    expect((await restoreBackup(oldBackup))[0].title).toBe('测试恢复')
    expect(await db.contentTemplates.count()).toBe(0)
  })

  it('recognizes previously inserted rich text after an editor round-trip', () => {
    const template = safeContentTemplate(input('带样式文末', 'footer', doc({ type: 'paragraph', attrs: { callout: 'tip' }, content: [{ type: 'text', text: '欢迎交流', marks: [{ type: 'bold' }] }] })))
    const existing = generateJSON('<p>正文</p><p data-callout="tip"><strong>欢迎交流</strong></p><p></p>', editorExtensions())
    expect(insertContentTemplate(existing, template).inserted).toBe(false)
  })
})
