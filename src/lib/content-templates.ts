import { getSchema, type JSONContent } from '@tiptap/react'
import type { ContentTemplate, ContentTemplatePosition } from '../types'
import { imageNodes, nodeText, plainText } from './document'
import { validateDocument } from './document-validation'
import { isCalloutKind } from './callouts'
import { editorExtensions } from './tiptap'
import { db } from './storage'

export const contentTemplateExamples: { name: string; position: ContentTemplatePosition; document: JSONContent }[] = [
  { name: '作者开场', position: 'header', document: { type: 'doc', content: [
    { type: 'paragraph', attrs: { callout: 'note' }, content: [{ type: 'text', text: '你好，欢迎来到我的公众号。这里记录技术研究、实践经验和日常思考。' }] },
  ] } },
  { name: '关注与交流', position: 'footer', document: { type: 'doc', content: [
    { type: 'horizontalRule' },
    { type: 'paragraph', content: [{ type: 'text', text: '感谢阅读', marks: [{ type: 'bold' }] }] },
    { type: 'paragraph', attrs: { callout: 'tip' }, content: [{ type: 'text', text: '如果这篇文章对你有帮助，欢迎关注、收藏，也欢迎留言交流。' }] },
  ] } },
  { name: '作者介绍', position: 'footer', document: { type: 'doc', content: [
    { type: 'horizontalRule' },
    { type: 'paragraph', content: [{ type: 'text', text: '关于作者', marks: [{ type: 'bold' }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: '在这里填写你的名字、研究方向和联系方式。可以在下方添加公众号二维码。' }] },
  ] } },
]

const blank = (node: JSONContent) => node.type === 'paragraph' && !nodeText(node).trim() && !isCalloutKind(node.attrs?.callout)
const trimmed = (content: JSONContent[]) => {
  let start = 0, end = content.length
  while (start < end && blank(content[start])) start++
  while (end > start && blank(content[end - 1])) end--
  return content.slice(start, end)
}

export function safeContentTemplate(value: Partial<ContentTemplate>): ContentTemplate {
  if (!value || typeof value !== 'object') throw new Error('开头与文末模板格式无效')
  const name = String(value.name || '').trim().slice(0, 40)
  if (!name) throw new Error('请填写模板名称')
  if (value.position !== 'header' && value.position !== 'footer') throw new Error('请选择添加到开头或文末')
  const document = validateDocument(value.document)
  document.content = trimmed(document.content || [])
  if (!document.content.length || (!nodeText(document).trim() && !imageNodes(document).length)) throw new Error('请填写模板内容，或添加图片')
  if (plainText(document).length > 10000 || imageNodes(document).length > 20) throw new Error('单套模板最多 10000 字、20 张图片')
  return { id: crypto.randomUUID(), name, position: value.position, document, autoInsert: value.autoInsert === true, createdAt: Date.now(), updatedAt: Date.now() }
}

export async function saveContentTemplate(value: Pick<ContentTemplate, 'name' | 'position' | 'document'>, id?: string) {
  const template = safeContentTemplate(value)
  return db.transaction('rw', db.contentTemplates, db.assets, async () => {
    const previous = id ? await db.contentTemplates.get(id) : undefined
    if (id && !previous) throw new Error('模板已不存在，请重新选择或新建')
    const duplicate = await db.contentTemplates.where('name').equals(template.name).first()
    if (duplicate && duplicate.id !== id) throw new Error('已有同名模板，请换一个名称')
    if (!id && await db.contentTemplates.count() >= 200) throw new Error('最多保存 200 套模板，请先清理不再使用的模板')
    for (const image of imageNodes(template.document)) if (image.attrs?.assetId && !await db.assets.get(image.attrs.assetId)) throw new Error('模板中有本地图片已丢失，请重新添加')
    if (previous) {
      template.id = previous.id
      template.createdAt = previous.createdAt
      template.autoInsert = previous.position === template.position && previous.autoInsert
    }
    await db.contentTemplates.put(template)
    return template
  })
}

export function setAutomaticContentTemplate(position: ContentTemplatePosition, id: string) {
  return db.transaction('rw', db.contentTemplates, async () => {
    const chosen = id ? await db.contentTemplates.get(id) : undefined
    if (id && (!chosen || chosen.position !== position)) throw new Error('模板已不存在或位置不匹配，请重新选择')
    await db.contentTemplates.where('position').equals(position).modify(template => { template.autoInsert = template.id === id })
  })
}

let schema: ReturnType<typeof getSchema> | undefined
/** Compare editor-normalized nodes so default attributes cannot cause duplicate copies. */
export function insertContentTemplate(document: JSONContent, template: Pick<ContentTemplate, 'position' | 'document'>): { document: JSONContent; inserted: boolean } {
  const addition = trimmed(template.document.content || [])
  if (!addition.length) return { document, inserted: false }
  const current = document.content || []
  const meaningful = trimmed(current)
  const edge = template.position === 'header' ? meaningful.slice(0, addition.length) : meaningful.slice(-addition.length)
  schema ||= getSchema(editorExtensions())
  if (edge.length === addition.length && edge.every((node, index) => schema!.nodeFromJSON(node).eq(schema!.nodeFromJSON(addition[index])))) return { document, inserted: false }
  const blocks = structuredClone(addition)
  return { document: { ...document, content: template.position === 'header' ? [...blocks, ...current] : [...current, ...blocks] }, inserted: true }
}

export function applyContentTemplates(document: JSONContent, templates: ContentTemplate[]) {
  const positions = new Set<ContentTemplatePosition>()
  return templates.reduce((result, template) => {
    if (!template.autoInsert || positions.has(template.position)) return result
    positions.add(template.position)
    return insertContentTemplate(result, template).document
  }, document)
}
