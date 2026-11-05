import Dexie, { type Table } from 'dexie'
import type { Article, ArticleVersion, Asset, ContentTemplate, StylePreset, WeixinSyncRecord } from '../types'

class StudioDatabase extends Dexie {
  articles!: Table<Article, string>
  assets!: Table<Asset, string>
  syncRecords!: Table<WeixinSyncRecord, string>
  versions!: Table<ArticleVersion, string>
  presets!: Table<StylePreset, string>
  contentTemplates!: Table<ContentTemplate, string>
  constructor() {
    super('zijian-studio')
    this.version(1).stores({ articles: 'id, updatedAt', assets: 'id, createdAt' })
    this.version(2).stores({ articles: 'id, updatedAt', assets: 'id, createdAt', syncRecords: 'id, articleId, startedAt' })
    this.version(3).stores({ articles: 'id, updatedAt, deletedAt', versions: 'id, articleId, createdAt', presets: 'id, name, updatedAt' })
    this.version(4).stores({ contentTemplates: 'id, name, position, updatedAt' })
  }
}
export const db = new StudioDatabase()

export const VERSION_LIMIT = 30
const versionInterval = 3 * 60 * 1000
export function articleContentKey(article: Article) {
  return JSON.stringify([article.title, article.document, article.themeId, article.typography])
}

async function recordVersion(article: Article, reason: string, automatic = false) {
  const versions = (await db.versions.where('articleId').equals(article.id).sortBy('createdAt')).reverse()
  const latest = versions[0]
  if (latest && (articleContentKey(latest.article) === articleContentKey(article) || (automatic && Date.now() - latest.createdAt < versionInterval))) return latest
  const version: ArticleVersion = { id: crypto.randomUUID(), articleId: article.id, createdAt: Math.max(Date.now(), (latest?.createdAt || 0) + 1), reason, article: structuredClone(article) }
  await db.versions.put(version)
  await db.versions.bulkDelete(versions.slice(VERSION_LIMIT - 1).map(item => item.id))
  return version
}

export function checkpointArticle(article: Article, reason: string) {
  const snapshot = structuredClone(article)
  return db.transaction('rw', db.versions, () => recordVersion(snapshot, reason))
}

let saveQueue: Promise<unknown> = Promise.resolve()
export function saveArticles(articles: Article[]): Promise<void> {
  const snapshot = structuredClone(articles)
  const task = saveQueue.catch(() => undefined).then(() => db.transaction('rw', db.articles, db.versions, async () => {
    for (const article of snapshot) {
      const previous = await db.articles.get(article.id)
      if (previous?.deletedAt && !article.deletedAt) throw new Error('这篇草稿已移至回收站，请刷新后恢复草稿再编辑')
      if (previous && articleContentKey(previous) !== articleContentKey(article)) await recordVersion(previous, '编辑前自动留档', true)
      await db.articles.put(article)
    }
  }))
  saveQueue = task
  return task.then(() => undefined)
}

export async function moveToTrash(id: string) {
  await db.transaction('rw', db.articles, db.versions, async () => {
    const article = await db.articles.get(id)
    if (!article || article.deletedAt) throw new Error('草稿已不存在或已在回收站')
    await recordVersion(article, '移入回收站前')
    await db.articles.update(id, { deletedAt: Date.now() })
  })
}

export async function restoreFromTrash(id: string): Promise<Article> {
  return db.transaction('rw', db.articles, async () => {
    const article = await db.articles.get(id)
    if (!article?.deletedAt) throw new Error('这篇草稿已不在回收站，请重新打开回收站')
    delete article.deletedAt
    article.updatedAt = Date.now()
    await db.articles.put(article)
    return article
  })
}

export async function permanentlyDeleteArticle(id: string) {
  await db.transaction('rw', db.articles, db.versions, db.syncRecords, async () => {
    const article = await db.articles.get(id)
    if (!article?.deletedAt) throw new Error('只能彻底删除回收站中的草稿')
    await db.versions.where('articleId').equals(id).delete()
    await db.syncRecords.where('articleId').equals(id).delete()
    await db.articles.delete(id)
  })
}

export const imageMime = /^image\/(png|jpeg|gif|webp|bmp|avif)$/
export async function addAsset(blob: Blob, name = '图片'): Promise<Asset> {
  if (!imageMime.test(blob.type)) throw new Error('请使用 PNG、JPG、GIF、WebP、BMP 或 AVIF 图片')
  if (blob.size > 20 * 1024 * 1024) throw new Error('单张图片不能超过 20MB')
  const asset: Asset = { id: crypto.randomUUID(), blob, name, mime: blob.type, createdAt: Date.now() }
  await db.assets.put(asset)
  return asset
}

export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('无法读取图片'))
    reader.readAsDataURL(blob)
  })
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 150)
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}
