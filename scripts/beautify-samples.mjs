import { chromium, expect } from '@playwright/test'
import { readdir, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import JSZip from 'jszip'
import { readFile } from 'node:fs/promises'

const source = process.argv[2]
if (!source) throw new Error('用法：node scripts/beautify-samples.mjs <Word 文件夹> [输出文件夹] [主题 ID]')
const destination = resolve(process.argv[3] || 'output/排版示例')
const themeId = process.argv[4]
const names = (await readdir(source)).filter(name => /\.docx$/i.test(name) && !name.startsWith('~$')).sort()
if (!names.length) throw new Error('文件夹内没有 .docx 文章')
await mkdir(destination, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1512, height: 982 }, permissions: ['clipboard-read', 'clipboard-write'] })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', error => pageErrors.push(error.message))
const results = []
let codePreviewSaved = false
let workspacePreviewSaved = false
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
try {
  await page.goto(process.env.STUDIO_TEST_URL || 'http://127.0.0.1:5173')
  await expect(page.getByRole('textbox', { name: '文章正文' })).toBeVisible()
  if (themeId) {
    const name = await page.evaluate(async id => {
      const { themes } = await import('/src/lib/themes.ts')
      return themes.find(theme => theme.id === id)?.name
    }, themeId)
    if (!name) throw new Error(`没有找到主题：${themeId}`)
    await page.getByRole('button', { name: '排版样式', exact: true }).click()
    await page.getByRole('button', { name: `主题：${name}`, exact: true }).click()
    await page.getByRole('button', { name: '文章目录', exact: true }).click()
  }
  for (const name of names) {
    const zip = await JSZip.loadAsync(await readFile(join(source, name)))
    const xml = await zip.file('word/document.xml').async('string')
    await page.getByTestId('word-input').setInputFiles(join(source, name))
    await expect(page.getByTestId('beautified-article')).toBeVisible({ timeout: 30000 })
    await expect(page.locator('.beautified-title')).toHaveText(name.replace(/\.docx$/i, ''))
    await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
    if (await page.getByRole('dialog').count()) await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
    const diagnostics = await page.evaluate(async xml => {
      const { db } = await import('/src/lib/storage.ts')
      const { nodeText, imageNodes } = await import('/src/lib/document.ts')
      const { beautifyDocument } = await import('/src/lib/beautify.ts')
      const { prepareClipboard } = await import('/src/lib/clipboard.ts')
      const article = await db.articles.get(localStorage.getItem('zijian-active'))
      const canonical = value => value.replace(/\s/g, '')
      const raw = new DOMParser().parseFromString(xml, 'application/xml')
      const original = [...raw.getElementsByTagNameNS('*', 't')].map(node => node.textContent).join('')
      const before = canonical(nodeText(article.sourceSnapshot))
      const after = canonical(nodeText(article.document))
      const again = beautifyDocument(article.document)
      const copied = await prepareClipboard(article)
      const parsed = new DOMParser().parseFromString(copied.html, 'text/html')
      return {
        textPreservedOnImport: canonical(original) === before,
        textPreservedOnBeautify: before === after,
        idempotent: JSON.stringify(again.document) === JSON.stringify(article.document),
        characters: after.length,
        ...again.report,
        embeddedImages: parsed.querySelectorAll('img[src^="data:image/"]').length,
        originalImages: imageNodes(article.sourceSnapshot).length,
        clipboardHasBlob: copied.html.includes('blob:'),
        headingsOutline: [...parsed.querySelectorAll('h2,h3')].map(node => ({ level: node.tagName, text: node.textContent })),
        codeLanguages: [...parsed.querySelectorAll('pre')].map(node => node.previousElementSibling?.textContent?.trim().replace(/^[●\s]+/, '')),
      }
    }, xml)
    await page.getByRole('button', { name: '复制到公众号', exact: true }).click()
    await expect(page.locator('.toast')).toContainText('已复制')
    const copiedImages = await page.evaluate(async () => {
      const items = await navigator.clipboard.read()
      const html = await (await items[0].getType('text/html')).text()
      return new DOMParser().parseFromString(html, 'text/html').querySelectorAll('img[src^="data:image/"]').length
    })
    await expect.poll(() => page.getByTestId('beautified-article').locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true)
    await page.getByRole('button', { name: '导出', exact: true }).click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /下载 HTML 文件/ }).click()
    const download = await downloadPromise
    await download.saveAs(join(destination, download.suggestedFilename()))
    const result = { name, html: download.suggestedFilename(), ...diagnostics, clipboardImages: copiedImages }
    results.push(result)
    console.log(JSON.stringify({ name, headings: result.headings, code: result.codeBlocks, images: result.images, preserved: result.textPreservedOnImport && result.textPreservedOnBeautify, idempotent: result.idempotent, copiedImages }))
    if (themeId && result.codeBlocks && !codePreviewSaved) {
      await page.getByTestId('beautified-article').locator('pre').first().scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(destination, '代码排版预览.png'), animations: 'disabled' })
      codePreviewSaved = true
    }
    if (!workspacePreviewSaved) {
      await page.screenshot({ path: join(destination, '工作台预览.png') })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.screenshot({ path: join(destination, '手机预览.png') })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.setViewportSize({ width: 1512, height: 982 })
      workspacePreviewSaved = true
    }
  }
  await writeFile(join(destination, 'verification.json'), JSON.stringify({ results, pageErrors }, null, 2), 'utf8')
  const cards = results.map((result, index) => `<a class="card" href="${escape(result.html)}"><span class="number">${String(index + 1).padStart(2, '0')}</span><div><h2>${escape(result.name.replace(/\.docx$/i, ''))}</h2><p>${result.headings} 处标题 · ${result.codeBlocks} 段代码 · ${result.images} 张配图 · ${result.characters.toLocaleString()} 字</p></div><span class="arrow">↗</span></a>`).join('')
  await writeFile(join(destination, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>字间 · 你的文章排版示例</title><style>*{box-sizing:border-box}body{background:#f5f7f2;color:#354737;font:15px/1.8 system-ui,"Microsoft YaHei",sans-serif;margin:0;padding:50px 22px}main{max-width:860px;margin:auto}.kicker{font-size:11px;letter-spacing:4px;color:#839875}h1{font:600 32px/1.6 Georgia,"Microsoft YaHei",serif;margin:14px 0}header p{color:#85907f;font-size:13px;max-width:670px}.cards{margin:32px 0}.card{color:inherit;text-decoration:none;display:flex;align-items:center;gap:21px;background:white;border:1px solid #e1e8da;border-radius:9px;padding:23px 26px;margin:13px 0;transition:transform .2s,border-color .2s}.card:hover{transform:translateY(-2px);border-color:#9db38d}.number{font:12px Georgia;color:#96a888;align-self:flex-start;margin-top:5px}.card h2{font-size:16px;line-height:1.65;font-weight:500;margin:0 0 7px}.card p{font-size:11px;color:#99a78e;margin:0}.arrow{margin-left:auto;color:#9aaa90}footer{font-size:11px;color:#95a08c;margin-top:24px}@media(max-width:600px){body{padding:25px 16px}h1{font-size:26px}.card{padding:18px 16px;gap:13px}.card h2{font-size:14px}}</style><main><header><span class="kicker">字间 / ARTICLE STUDIO</span><h1>文章已美化，打开即可复制。</h1><p>点击任一篇，查看完整排版，再点击页面顶部的「复制到公众号」。正文保留配图与代码样式，公众号标题单独填写，粘贴后检查图片。</p></header><section class="cards">${cards}</section><footer>共 ${results.length} 篇 · 源 Word 文件保持原样 · 本地独立 HTML，图片已嵌入</footer></main></html>`, 'utf8')
  for (const result of results) {
    expect(result.textPreservedOnImport, `${result.name}: Word 原文完整`).toBe(true)
    expect(result.textPreservedOnBeautify, `${result.name}: 美化文字完整`).toBe(true)
    expect(result.idempotent, `${result.name}: 再次美化不破坏结构`).toBe(true)
    expect(result.embeddedImages).toBe(result.originalImages)
    expect(result.clipboardImages).toBe(result.originalImages)
    expect(result.clipboardHasBlob).toBe(false)
    expect(result.headings).toBeGreaterThan(0)
  }
  expect(pageErrors).toEqual([])
  console.log(`已生成 ${results.length} 篇排版示例：${join(destination, 'index.html')}`)
} finally {
  await context.close()
  await browser.close()
}
