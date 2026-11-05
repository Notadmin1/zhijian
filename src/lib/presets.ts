import type { Article, StylePreset } from '../types'
import { db } from './storage'
import { safeTypography, themes } from './themes'
import { nodeText } from './document'

export function safePreset(value: Partial<StylePreset>): StylePreset {
  if (!value || typeof value !== 'object') throw new Error('个人方案格式无效')
  const name = String(value.name || '').trim().slice(0, 40)
  if (!name) throw new Error('请填写方案名称')
  return {
    id: crypto.randomUUID(), name,
    themeId: themes.some(theme => theme.id === value.themeId) ? value.themeId! : 'botanical',
    typography: safeTypography(value.typography), footer: String(value.footer || '').trim().slice(0, 2000),
    createdAt: Date.now(), updatedAt: Date.now(),
  }
}

export async function savePreset(article: Article, name: string, footer: string, id?: string) {
  const preset = safePreset({ name, themeId: article.themeId, typography: article.typography, footer })
  return db.transaction('rw', db.presets, async () => {
    const duplicate = await db.presets.where('name').equals(preset.name).first()
    if (duplicate && duplicate.id !== id) throw new Error('已有同名方案，请换一个名称，或更新已有方案')
    if (id) {
      const previous = await db.presets.get(id)
      if (!previous) throw new Error('方案已不存在，请重新打开个人方案')
      preset.id = id
      preset.createdAt = previous.createdAt
    }
    await db.presets.put(preset)
    return preset
  })
}

export function presetChanges(article: Article, preset: StylePreset, includeFooter = false): Partial<Article> {
  const changes: Partial<Article> = { themeId: preset.themeId, typography: safeTypography(preset.typography) }
  if (includeFooter && preset.footer.trim()) {
    const paragraphs = preset.footer.replace(/\r\n?/g, '\n').split('\n').map(text => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) }))
    // Applying the same footer repeatedly must not duplicate the closing paragraphs.
    const content = article.document.content || []
    let end = content.length
    while (end && content[end - 1].type === 'paragraph' && !nodeText(content[end - 1]).trim()) end--
    const tail = content.slice(Math.max(0, end - paragraphs.length), end)
    const alreadyPresent = tail.length === paragraphs.length && tail.every((node, i) => node.type === 'paragraph' && nodeText(node) === nodeText(paragraphs[i]))
    if (!alreadyPresent) changes.document = { ...article.document, content: [...structuredClone(content), ...paragraphs] }
  }
  return changes
}
