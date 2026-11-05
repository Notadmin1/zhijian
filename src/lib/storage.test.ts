import { expect, it } from 'vitest'
import Dexie from 'dexie'
import { newArticle } from './document'
import { db } from './storage'

it('adds sync history without losing existing v1 drafts or image bytes', async () => {
  db.close()
  await db.delete()
  const original = newArticle('升级前的文章')
  const old = new Dexie('zijian-studio')
  old.version(1).stores({ articles: 'id, updatedAt', assets: 'id, createdAt' })
  await old.table('articles').put(original)
  await old.table('assets').put({ id: 'old-image', blob: new Blob(['original image bytes'], { type: 'image/png' }), name: '原图', mime: 'image/png', createdAt: 1 })
  old.close()
  await db.open()
  expect(await db.articles.get(original.id)).toEqual(original)
  expect(await (await db.assets.get('old-image'))?.blob.text()).toBe('original image bytes')
  expect(await db.syncRecords.count()).toBe(0)
  expect(await db.versions.count()).toBe(0)
  expect(await db.presets.count()).toBe(0)
})

it('upgrades the existing v2 database while retaining drafts and WeChat sync records', async () => {
  db.close()
  await db.delete()
  const article = newArticle('已有同步记录的文章')
  const old = new Dexie('zijian-studio')
  old.version(2).stores({ articles: 'id, updatedAt', assets: 'id, createdAt', syncRecords: 'id, articleId, startedAt' })
  const record = { id: 'previous-sync', articleId: article.id, articleUpdatedAt: article.updatedAt, articleTitle: article.title, accountName: '测试公众号', status: 'succeeded', stage: '完成', images: 0, startedAt: 1, finishedAt: 2 }
  await old.table('articles').put(article)
  await old.table('syncRecords').put(record)
  old.close()
  await db.open()
  expect(await db.articles.get(article.id)).toEqual(article)
  expect(await db.syncRecords.get(record.id)).toEqual(record)
  expect(await db.versions.count()).toBe(0)
  expect(await db.presets.count()).toBe(0)
})

it('adds content templates while retaining v3 drafts, history and named personal styles', async () => {
  db.close()
  await db.delete()
  const article = newArticle('升级前的 v3 草稿')
  const old = new Dexie('zijian-studio')
  old.version(3).stores({ articles: 'id, updatedAt, deletedAt', assets: 'id, createdAt', syncRecords: 'id, articleId, startedAt', versions: 'id, articleId, createdAt', presets: 'id, name, updatedAt' })
  const preset = { id: 'saved-preset', name: '原有方案', themeId: article.themeId, typography: article.typography, footer: '原有文末', createdAt: 1, updatedAt: 1 }
  const version = { id: 'saved-version', articleId: article.id, article, reason: '原有历史', createdAt: 1 }
  await old.table('articles').put(article)
  await old.table('presets').put(preset)
  await old.table('versions').put(version)
  old.close()
  await db.open()
  expect(await db.articles.get(article.id)).toEqual(article)
  expect(await db.presets.get(preset.id)).toEqual(preset)
  expect(await db.versions.get(version.id)).toEqual(version)
  expect(await db.contentTemplates.count()).toBe(0)
})
