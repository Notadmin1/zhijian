import JSZip from 'jszip'
import type { JSONContent } from '@tiptap/react'
import type { Article, ArticleVersion, Asset } from '../types'
import { imageNodes, walk } from './document'
import { db, imageMime } from './storage'
import { safeTypography, themes } from './themes'
import { safeURL } from './render'
import { validateDocument } from './document-validation'
import { safePreset } from './presets'
import { safeContentTemplate } from './content-templates'

export { validateDocument } from './document-validation'

const extension = (mime: string) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/avif': 'avif' })[mime] || 'png'
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/

export async function createBackup(articles: Article[]): Promise<Blob> {
  const zip = new JSZip()
  const trash = await db.articles.where('deletedAt').above(0).toArray()
  const allArticles = [...new Map([...trash, ...articles].map(article => [article.id, article])).values()]
  const versions = await db.versions.where('articleId').anyOf(allArticles.map(article => article.id)).toArray()
  const presets = await db.presets.toArray()
  const contentTemplates = await db.contentTemplates.toArray()
  const documents = [...allArticles, ...versions.map(version => version.article)]
  const ids = new Set([...documents.flatMap(a => [...imageNodes(a.document), ...imageNodes(a.sourceSnapshot)]), ...contentTemplates.flatMap(template => imageNodes(template.document))].map(n => String(n.attrs?.assetId || '')).filter(Boolean))
  const assets: { id: string; name: string; mime: string; path: string; createdAt: number }[] = []
  for (const id of ids) {
    const asset = await db.assets.get(id)
    if (!asset) throw new Error('部分本地图片已丢失，无法生成完整备份；请先检查文章图片')
    const path = `assets/${id}.${extension(asset.mime)}`
    zip.file(path, await asset.blob.arrayBuffer())
    assets.push({ id, name: asset.name, mime: asset.mime, path, createdAt: asset.createdAt })
  }
  zip.file('manifest.json', JSON.stringify({ app: 'zijian-studio', version: 3, exportedAt: Date.now(), articles: allArticles, versions, presets, contentTemplates, assets }, null, 2))
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

export async function restoreBackup(file: Blob): Promise<Article[]> {
  if (file.size > 50 * 1024 * 1024) throw new Error('备份包不能超过 50MB')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const entry = zip.file('manifest.json')
  if (!entry) throw new Error('这不是字间导出的备份包')
  const manifest = JSON.parse(await entry.async('string'))
  if (manifest.app !== 'zijian-studio' || ![1, 2, 3].includes(manifest.version) || !Array.isArray(manifest.articles) || !Array.isArray(manifest.assets)) throw new Error('不支持的备份格式或版本')
  const savedVersions = manifest.version >= 2 ? manifest.versions : []
  const savedPresets = manifest.version >= 2 ? manifest.presets : []
  const savedTemplates = manifest.version >= 3 ? manifest.contentTemplates : []
  if (!Array.isArray(savedVersions) || !Array.isArray(savedPresets) || savedVersions.length > 30000 || savedPresets.length > 500) throw new Error('备份中的历史版本或个人方案无效')
  if (!Array.isArray(savedTemplates) || savedTemplates.length > 200) throw new Error('备份中的开头与文末模板无效')
  if (manifest.articles.length > 1000 || manifest.assets.length > 3000) throw new Error('备份内容过多')
  const idMap = new Map<string, string>()
  const assets: Asset[] = []
  let totalSize = 0
  for (const item of manifest.assets) {
    if (!idPattern.test(item.id) || !imageMime.test(item.mime) || !/^assets\/[\w-]+\.(png|jpg|gif|webp|bmp|avif)$/.test(item.path)) throw new Error('备份中的图片信息无效')
    const image = zip.file(item.path)
    if (!image) throw new Error('备份中的图片文件缺失')
    const data = await image.async('arraybuffer')
    totalSize += data.byteLength
    if (data.byteLength > 20 * 1024 * 1024 || totalSize > 150 * 1024 * 1024) throw new Error('备份中的图片过大')
    const id = crypto.randomUUID()
    idMap.set(item.id, id)
    assets.push({ id, name: String(item.name || '图片').slice(0, 200), mime: item.mime, blob: new Blob([data], { type: item.mime }), createdAt: Date.now() })
  }
  const remap = (doc: JSONContent) => {
    walk(doc, node => {
      if (node.type === 'image' && node.attrs?.assetId) {
        const id = idMap.get(node.attrs.assetId)
        if (!id) throw new Error('备份缺少文章引用的图片')
        node.attrs.assetId = id
        node.attrs.src = `asset:${id}`
      }
    })
    return doc
  }
  const readArticle = (item: Partial<Article>, id: string): Article => {
    if (!item || typeof item !== 'object') throw new Error('备份中的文章数据无效')
    if (item.schemaVersion !== 1) throw new Error('不支持的文章数据版本')
    return {
      id, schemaVersion: 1, title: String(item.title || '恢复的文章').slice(0, 300),
      document: remap(validateDocument(item.document)), sourceSnapshot: remap(validateDocument(item.sourceSnapshot || item.document)),
      themeId: themes.some(t => t.id === item.themeId) ? item.themeId! : 'botanical', typography: safeTypography(item.typography),
      createdAt: Number(item.createdAt) || Date.now(), updatedAt: Date.now(),
      ...(Number.isFinite(item.deletedAt) && Number(item.deletedAt) > 0 ? { deletedAt: Number(item.deletedAt) } : {}),
      ...(Array.isArray(item.ignoredLayoutIssues) ? { ignoredLayoutIssues: item.ignoredLayoutIssues.filter(key => typeof key === 'string' && /^[a-z]+:[a-z0-9]+:[a-z0-9]+$/.test(key)).slice(-500) } : {}),
    }
  }
  const articleIds = new Map<string, string>()
  const articles: Article[] = manifest.articles.map((item: Partial<Article>) => {
    if (!item || !idPattern.test(String(item.id || '')) || articleIds.has(item.id!)) throw new Error('备份中的文章编号无效或重复')
    const id = crypto.randomUUID()
    articleIds.set(item.id!, id)
    return readArticle(item, id)
  })
  if (!articles.length) throw new Error('备份包内没有文章')
  const counts = new Map<string, number>()
  const versions: ArticleVersion[] = savedVersions.map((item: ArticleVersion) => {
    const articleId = item && articleIds.get(item.articleId)
    if (!articleId) throw new Error('历史版本没有对应的文章')
    const count = (counts.get(articleId) || 0) + 1
    counts.set(articleId, count)
    if (count > 30) throw new Error('单篇文章的历史版本过多')
    const article = readArticle(item.article, articleId)
    delete article.deletedAt
    return { id: crypto.randomUUID(), articleId, article, reason: String(item.reason || '恢复的版本').slice(0, 120), createdAt: Number(item.createdAt) || Date.now() }
  })
  const presets = savedPresets.map(item => safePreset(item))
  const contentTemplates = savedTemplates.map(item => { const template = safeContentTemplate(item); template.document = remap(template.document); return template })
  await db.transaction('rw', [db.articles, db.assets, db.versions, db.presets, db.contentTemplates], async () => {
    const names = new Set((await db.presets.toArray()).map(preset => preset.name))
    for (const preset of presets) {
      const original = preset.name
      let suffix = 1
      while (names.has(preset.name)) preset.name = `${original.slice(0, 27)}（恢复 ${suffix++}）`
      names.add(preset.name)
    }
    const existingTemplates = await db.contentTemplates.toArray()
    const templateNames = new Set(existingTemplates.map(template => template.name))
    const automaticPositions = new Set(existingTemplates.filter(template => template.autoInsert).map(template => template.position))
    if (existingTemplates.length + contentTemplates.length > 200) throw new Error('恢复后模板数量超过 200 套，请先清理模板库')
    for (const template of contentTemplates) {
      const original = template.name
      let suffix = 1
      while (templateNames.has(template.name)) template.name = `${original.slice(0, 27)}（恢复 ${suffix++}）`
      templateNames.add(template.name)
      template.autoInsert = template.autoInsert && !automaticPositions.has(template.position)
      if (template.autoInsert) automaticPositions.add(template.position)
    }
    await db.assets.bulkPut(assets)
    await db.articles.bulkPut(articles)
    await db.versions.bulkPut(versions)
    await db.presets.bulkPut(presets)
    await db.contentTemplates.bulkPut(contentTemplates)
  })
  return articles
}

export async function createImagePack(article: Article): Promise<Blob> {
  const zip = new JSZip()
  const lines = [`${article.title} · 图片清单`, '请按编号在公众号后台上传图片并替换正文占位。', '']
  const images = imageNodes(article.document)
  for (let index = 0; index < images.length; index++) {
    const node = images[index]
    const asset = node.attrs?.assetId ? await db.assets.get(String(node.attrs.assetId)) : undefined
    const number = String(index + 1).padStart(2, '0')
    if (asset) {
      const name = `${number}.${extension(asset.mime)}`
      zip.file(name, await asset.blob.arrayBuffer())
      lines.push(`${number}. ${name}${node.attrs?.title ? ` — ${node.attrs.title}` : ''}`)
    } else lines.push(`${number}. ${safeURL(node.attrs?.src, true) || '图片已丢失，请重新添加'}（远程图片请从来源保存后上传）`)
  }
  zip.file('图片清单.txt', lines.join('\n'))
  return zip.generateAsync({ type: 'blob' })
}
