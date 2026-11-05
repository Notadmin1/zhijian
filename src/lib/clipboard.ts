import type { Article } from '../types'
import { imageNodes, plainText } from './document'
import { blobToDataURL, db } from './storage'
import { renderArticle } from './render'

export async function prepareClipboard(article: Article, imagePolicy: 'embed' | 'placeholder' = 'embed') {
  const assets: Record<string, string> = {}
  if (imagePolicy === 'embed') {
    const ids = [...new Set(imageNodes(article.document).map(node => String(node.attrs?.assetId || '')).filter(Boolean))]
    for (const id of ids) {
      const asset = await db.assets.get(id)
      if (!asset) throw new Error('有本地图片无法读取，请重新添加，或使用“兼容复制”保留图片占位')
      assets[id] = await blobToDataURL(asset.blob)
    }
  }
  return {
    html: renderArticle(article, { mode: 'clipboard', assets, imagePolicy }),
    text: `${article.typography.includeTitle ? `${article.title}\n\n` : ''}${plainText(article.document)}`,
  }
}

export async function copyRichText(html: string, text: string): Promise<void> {
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })])
      return
    } catch { /* Some browsers deny async clipboard, try a selected rich DOM. */ }
  }
  const container = document.createElement('div')
  container.innerHTML = html
  container.contentEditable = 'true'
  Object.assign(container.style, { position: 'fixed', left: '-10000px', top: '0' })
  document.body.append(container)
  const selection = window.getSelection()
  const previous = selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null
  const range = document.createRange()
  range.selectNodeContents(container)
  selection?.removeAllRanges()
  selection?.addRange(range)
  let copied = false
  try { copied = document.execCommand('copy') }
  finally {
    container.remove()
    selection?.removeAllRanges()
    if (previous) selection?.addRange(previous)
  }
  if (!copied) throw new Error('浏览器未允许复制，请使用 Chrome / Edge，或下载 HTML 后手动复制')
}

export async function copyPlainText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return } catch { /* use fallback */ }
  }
  await copyRichText(`<pre>${text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)}</pre>`, text)
}
