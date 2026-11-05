import { beforeEach, describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { db } from './storage'
import { newArticle, imageNodes } from './document'
import { createBackup, restoreBackup, validateDocument } from './backup'

describe('backup and restore', () => {
  beforeEach(async () => { await db.articles.clear(); await db.assets.clear() })
  it('round-trips body, theme, original snapshot and image bytes without overwriting existing drafts', async () => {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
    await db.assets.put({ id: 'original-image', name: '测试.png', mime: 'image/png', blob, createdAt: 1 })
    const article = newArticle('原稿', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文' }] }, { type: 'image', attrs: { assetId: 'original-image', src: 'asset:original-image', title: '图片说明' } }] })
    article.themeId = 'warm'
    article.typography.fontSize = 18
    await db.articles.put(article)
    const backup = await createBackup([article])
    const restored = await restoreBackup(backup)
    expect(restored).toHaveLength(1)
    expect(restored[0].id).not.toBe(article.id)
    expect(restored[0].themeId).toBe('warm')
    expect(restored[0].typography.fontSize).toBe(18)
    const id = imageNodes(restored[0].document)[0].attrs?.assetId
    expect(id).not.toBe('original-image')
    const image = await db.assets.get(id)
    expect(new Uint8Array(await image!.blob.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]))
    expect(imageNodes(restored[0].sourceSnapshot)[0].attrs?.assetId).toBe(id)
    expect(await db.articles.count()).toBe(2)
  })
  it('rejects unsupported backup versions', async () => {
    const zip = new JSZip().file('manifest.json', JSON.stringify({ app: 'zijian-studio', version: 99, articles: [], assets: [] }))
    await expect(restoreBackup(await zip.generateAsync({ type: 'blob' }))).rejects.toThrow('不支持')
  })
  it('preserves the technical template, code language and reading settings in a backup', async () => {
    const article = newArticle('技术手记', { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'python' }, content: [{ type: 'text', text: 'import json\nprint("完整保留")' }] }] })
    article.themeId = 'technical'
    article.typography = { ...article.typography, codeFontSize: 15, codeWrap: false, tableMode: 'scroll' }
    const [restored] = await restoreBackup(await createBackup([article]))
    expect(restored.themeId).toBe('technical')
    expect(restored.typography).toEqual(article.typography)
    expect(restored.document.content?.[0].attrs?.language).toBe('python')
    expect(restored.sourceSnapshot.content?.[0].attrs?.language).toBe('python')
    expect(restored.document.content?.[0].content).toEqual(article.document.content?.[0].content)
  })
  it('does not write partial restored drafts if an image reference is missing', async () => {
    const article = newArticle('缺少图片', { type: 'doc', content: [{ type: 'image', attrs: { assetId: 'missing', src: 'asset:missing' } }] })
    const zip = new JSZip().file('manifest.json', JSON.stringify({ app: 'zijian-studio', version: 1, articles: [article], assets: [] }))
    await expect(restoreBackup(await zip.generateAsync({ type: 'blob' }))).rejects.toThrow('缺少')
    expect(await db.articles.count()).toBe(0)
    expect(await db.assets.count()).toBe(0)
  })
  it('round-trips new template IDs and manual callout choices', async () => {
    for (const themeId of ['research', 'tutorial', 'minimal'] as const) {
      const article = newArticle('卡片备份', { type: 'doc', content: [
        { type: 'paragraph', attrs: { callout: 'warning' }, content: [{ type: 'text', text: '注意：保留设置。' }] },
        { type: 'paragraph', attrs: { callout: 'none' }, content: [{ type: 'text', text: '说明：保持普通正文。' }] },
      ] })
      article.themeId = themeId
      const [restored] = await restoreBackup(await createBackup([article]))
      expect(restored.themeId).toBe(themeId)
      expect(restored.document).toEqual(article.document)
      expect(restored.sourceSnapshot).toEqual(article.sourceSnapshot)
    }
  })
  it('rejects an invalid node hierarchy before it reaches the editor', () => {
    expect(() => validateDocument({ type: 'doc', content: [{ type: 'text', text: '根节点不能直接包含文本' }] })).toThrow('不符合编辑器格式')
  })
})
