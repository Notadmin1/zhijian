import { beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { newArticle, plainText } from './document'
import { articleContentKey, checkpointArticle, db, moveToTrash, permanentlyDeleteArticle, restoreFromTrash, saveArticles, VERSION_LIMIT } from './storage'
import { presetChanges, savePreset } from './presets'
import { createBackup, restoreBackup } from './backup'
import { inspectLayout, isIssueIgnored } from './inspection'

beforeEach(async () => {
  vi.restoreAllMocks()
  await Promise.all([db.articles.clear(), db.assets.clear(), db.versions.clear(), db.presets.clear(), db.syncRecords.clear()])
})

describe('persistent recovery', () => {
  it('keeps the previous content on autosave, throttles automatic versions and deduplicates explicit checkpoints', async () => {
    const article = newArticle('原来的标题')
    await db.articles.put(article)
    await saveArticles([{ ...article, title: '第一次修改' }])
    expect((await db.versions.toArray())[0].article.title).toBe('原来的标题')
    const second = { ...article, title: '第二次修改' }
    await saveArticles([second])
    expect(await db.versions.count()).toBe(1)
    await checkpointArticle(second, '恢复原稿前')
    await checkpointArticle(second, '手动保存')
    expect(await db.versions.count()).toBe(2)
    db.close()
    await db.open()
    expect((await db.articles.get(article.id))?.title).toBe('第二次修改')
    expect(await db.versions.count()).toBe(2)
  })

  it('retains the newest 30 distinct versions even when created during the same millisecond', async () => {
    const article = newArticle('历史')
    vi.spyOn(Date, 'now').mockReturnValue(123456789)
    for (let i = 0; i < VERSION_LIMIT + 5; i++) await checkpointArticle({ ...article, title: `版本 ${i}` }, '手动保存')
    const versions = await db.versions.where('articleId').equals(article.id).sortBy('createdAt')
    expect(versions).toHaveLength(VERSION_LIMIT)
    expect(versions[0].article.title).toBe('版本 5')
    expect(versions.at(-1)?.article.title).toBe('版本 34')
  })

  it('protects deleted drafts from stale saves and restores their body, snapshot and history', async () => {
    const article = newArticle('待恢复草稿', { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'java' }, content: [{ type: 'text', text: 'class Demo {\n  String value = "原始代码";\n}' }] }] })
    await db.articles.put(article)
    await moveToTrash(article.id)
    await expect(saveArticles([{ ...article, title: '旧窗口修改' }])).rejects.toThrow('回收站')
    expect((await db.articles.get(article.id))?.deletedAt).toBeGreaterThan(0)
    const restored = await restoreFromTrash(article.id)
    expect(restored.deletedAt).toBeUndefined()
    expect(restored.document).toEqual(article.document)
    expect(restored.sourceSnapshot).toEqual(article.sourceSnapshot)
    expect(await db.versions.where('articleId').equals(article.id).count()).toBe(1)
    await expect(permanentlyDeleteArticle(article.id)).rejects.toThrow('只能')
    await moveToTrash(article.id)
    await permanentlyDeleteArticle(article.id)
    expect(await db.articles.get(article.id)).toBeUndefined()
    expect(await db.versions.where('articleId').equals(article.id).count()).toBe(0)
  })

  it('rolls back the entire save if one draft is already in the recycle bin', async () => {
    const a = newArticle('A'), b = newArticle('B')
    await db.articles.bulkPut([a, b])
    await moveToTrash(b.id)
    await expect(saveArticles([{ ...a, title: '不应部分保存' }, { ...b, title: '旧的 B' }])).rejects.toThrow('回收站')
    expect((await db.articles.get(a.id))?.title).toBe('A')
    expect(await db.versions.where('articleId').equals(a.id).count()).toBe(0)
  })
})

describe('personal styles', () => {
  it('stores named styles without duplicates and preserves content unless footer insertion is selected', async () => {
    const article = newArticle('技术文章', { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'java', codeWrap: 'scroll', highlightLines: '2' }, content: [{ type: 'text', text: 'class Demo {\n  // exact code\n}' }] }] })
    article.themeId = 'research'
    article.typography = { ...article.typography, codeFontSize: 15, lineHeight: 2, codeWrap: false }
    const preset = await savePreset(article, '漏洞分析', '作者介绍\n谢谢阅读')
    await expect(savePreset(article, '漏洞分析', '')).rejects.toThrow('同名')
    const changed = newArticle('另一篇文章', article.document)
    const styleOnly = presetChanges(changed, preset)
    expect(styleOnly.document).toBeUndefined()
    expect(styleOnly.typography).toEqual(article.typography)
    const applied = { ...changed, ...presetChanges(changed, preset, true) }
    expect(applied.document.content?.[0]).toEqual(changed.document.content?.[0])
    expect(plainText(applied.document)).toContain('作者介绍\n谢谢阅读')
    expect(presetChanges(applied, preset, true).document).toBeUndefined()
    const withTrailingBlank = { ...applied, document: { ...applied.document, content: [...applied.document.content!, { type: 'paragraph' }] } }
    expect(presetChanges(withTrailingBlank, preset, true).document).toBeUndefined()
    expect((await db.presets.get(preset.id))?.footer).toBe('作者介绍\n谢谢阅读')
    const updated = await savePreset({ ...article, themeId: 'tutorial' }, '教程', '新的文末', preset.id)
    expect(updated.id).toBe(preset.id)
    expect(updated.createdAt).toBe(preset.createdAt)
    expect(await db.presets.count()).toBe(1)
  })
})

describe('graded inspections', () => {
  it('remembers optional suggestions across paragraph moves, checks changed content again and never hides missing images', () => {
    const long = { type: 'paragraph', content: [{ type: 'text', text: '原有长段落的正文。'.repeat(40) }] }
    const article = newArticle('检查', { type: 'doc', content: [long, { type: 'image', attrs: { assetId: 'missing', src: 'asset:missing' } }] })
    const issues = inspectLayout(article, new Set())
    const suggestion = issues.find(issue => issue.kind === 'paragraph')!
    const missing = issues.find(issue => issue.kind === 'image')!
    expect(suggestion.severity).toBe('suggestion')
    expect(missing.severity).toBe('warning')
    article.ignoredLayoutIssues = [suggestion.ignoreKey, missing.ignoreKey]
    expect(isIssueIgnored(article, suggestion)).toBe(true)
    expect(isIssueIgnored(article, missing)).toBe(false)
    article.document.content?.unshift({ type: 'paragraph' })
    const moved = inspectLayout(article).find(issue => issue.kind === 'paragraph')!
    expect(moved.block).toBe(1)
    expect(isIssueIgnored(article, moved)).toBe(true)
    long.content[0].text += '新内容'
    expect(isIssueIgnored(article, inspectLayout(article).find(issue => issue.kind === 'paragraph')!)).toBe(false)
  })

  it('does not ask for language selection after the user explicitly chooses plain text', () => {
    const article = newArticle('文本示例', { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'text' }, content: [{ type: 'text', text: '保持原样的输出内容' }] }] })
    expect(inspectLayout(article).some(issue => issue.title === '代码语言尚未明确')).toBe(false)
    article.document.content![0].attrs!.language = null
    expect(inspectLayout(article).some(issue => issue.title === '代码语言尚未明确')).toBe(true)
  })
})

describe('complete backup compatibility', () => {
  it('backs up recycled drafts, images referenced only in history, ignored checks and named styles with fresh IDs', async () => {
    const image = { id: 'history-image', name: '原图.png', mime: 'image/png', blob: new Blob(['unchanged image bytes'], { type: 'image/png' }), createdAt: 1 }
    await db.assets.put(image)
    const article = newArticle('当前文章')
    article.ignoredLayoutIssues = ['paragraph:abc:123']
    const historical = { ...article, document: { type: 'doc', content: [{ type: 'image', attrs: { assetId: image.id, src: `asset:${image.id}` } }] } }
    await checkpointArticle(historical, '替换图片前')
    const recycled = newArticle('回收站文章')
    await db.articles.bulkPut([article, recycled])
    await moveToTrash(recycled.id)
    await savePreset(article, '日常样式', '固定文末')
    const backup = await createBackup([article])
    const restored = await restoreBackup(backup)
    expect(restored).toHaveLength(2)
    const live = restored.find(item => !item.deletedAt)!
    const trash = restored.find(item => item.deletedAt)!
    expect(trash.title).toBe('回收站文章')
    expect(live.id).not.toBe(article.id)
    expect(live.ignoredLayoutIssues).toEqual(article.ignoredLayoutIssues)
    const versions = await db.versions.where('articleId').equals(live.id).toArray()
    expect(versions).toHaveLength(1)
    expect(articleContentKey(versions[0].article)).not.toBe(articleContentKey(article))
    const restoredImageId = versions[0].article.document.content![0].attrs!.assetId
    expect(restoredImageId).not.toBe(image.id)
    expect(await (await db.assets.get(restoredImageId))!.blob.text()).toBe('unchanged image bytes')
    expect((await db.presets.toArray()).map(item => item.name)).toEqual(expect.arrayContaining(['日常样式', '日常样式（恢复 1）']))
  })

  it('continues to restore the old v1 backup format', async () => {
    const article = newArticle('旧版备份')
    const zip = new JSZip().file('manifest.json', JSON.stringify({ app: 'zijian-studio', version: 1, articles: [article], assets: [] }))
    const restored = await restoreBackup(await zip.generateAsync({ type: 'blob' }))
    expect(restored[0].title).toBe('旧版备份')
    expect(await db.versions.count()).toBe(0)
  })
})
