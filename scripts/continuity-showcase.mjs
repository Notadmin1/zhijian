import { chromium, expect } from '@playwright/test'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const source = process.argv[2]
if (!source) throw new Error('用法：node scripts/continuity-showcase.mjs <Word 文件> [输出文件夹]')
const directory = resolve(process.argv[3] || 'output/本轮优化预览')
await mkdir(directory, { recursive: true })
const hash = async () => createHash('sha256').update(await readFile(source)).digest('hex')
const sourceHash = await hash()
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
const title = basename(source).replace(/\.docx$/i, '')
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
try {
  await page.goto(process.env.STUDIO_TEST_URL || 'http://127.0.0.1:5173')
  await page.getByTestId('word-input').setInputFiles(source)
  await expect(page.locator('.beautified-title')).toHaveText(title)
  if (await page.getByRole('dialog').count()) await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  const codes = await page.getByTestId('beautified-article').locator('pre').allTextContents()
  const articleId = await page.evaluate(() => localStorage.getItem('zijian-active'))

  await page.getByRole('button', { name: '排版样式', exact: true }).click()
  await page.getByRole('button', { name: '主题：安全研究', exact: true }).click()
  await page.getByRole('button', { name: /个人排版方案/ }).click()
  const presetDialog = page.getByRole('dialog', { name: '个人排版方案' })
  await presetDialog.getByLabel('方案名称', { exact: true }).fill('安全研究排版')
  await presetDialog.getByLabel('固定文末', { exact: true }).fill('作者介绍｜记录技术研究与实践\n感谢阅读，欢迎交流。')
  await presetDialog.getByRole('button', { name: '保存为个人方案', exact: true }).click()
  await expect(presetDialog.getByRole('button', { name: '应用方案 安全研究排版', exact: true })).toBeVisible()
  await page.screenshot({ path: join(directory, '个人排版方案.png'), animations: 'disabled' })
  await presetDialog.getByRole('button', { name: '应用方案 安全研究排版', exact: true }).click()
  await expect(presetDialog).not.toBeVisible()
  expect(await page.getByTestId('beautified-article').locator('pre').allTextContents()).toEqual(codes)
  await page.getByRole('button', { name: '历史版本', exact: true }).click()
  const history = page.getByRole('dialog', { name: '历史版本' })
  await history.getByRole('button', { name: '保存当前版本', exact: true }).click()
  await expect(history.getByLabel('历史版本预览')).toBeVisible()
  await page.screenshot({ path: join(directory, '历史版本预览.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()

  await page.getByRole('button', { name: '排版检查', exact: true }).click()
  const check = page.getByRole('dialog')
  await expect(check).toBeVisible()
  const ignore = check.getByRole('button', { name: /忽略建议/ })
  if (await ignore.count()) await ignore.first().click()
  await page.screenshot({ path: join(directory, '分级排版检查.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: /我的草稿/ }).click()
  await page.getByRole('button', { name: `删除草稿 ${title}`, exact: true }).click()
  await page.getByRole('button', { name: '删除草稿', exact: true }).click()
  await page.getByRole('button', { name: '回收站', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '回收站' })).toContainText(title)
  await page.screenshot({ path: join(directory, '回收站恢复.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '恢复草稿', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue(title)
  expect(await page.locator('.article-editor pre').allTextContents()).toEqual(codes)
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
  await page.reload()
  expect(await page.evaluate(() => localStorage.getItem('zijian-active'))).toBe(articleId)

  await page.getByRole('button', { name: '复制到公众号', exact: true }).click()
  await expect(page.locator('.toast')).toContainText('已复制')
  const verification = await page.evaluate(async ({ codes, articleId }) => {
    const { db } = await import('/src/lib/storage.ts')
    const { createBackup, restoreBackup } = await import('/src/lib/backup.ts')
    const { imageNodes, nodeText } = await import('/src/lib/document.ts')
    const article = await db.articles.get(articleId)
    const items = await navigator.clipboard.read()
    const html = await (await items[0].getType('text/html')).text()
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    const versions = await db.versions.where('articleId').equals(articleId).toArray()
    const presets = await db.presets.toArray()
    const restored = await restoreBackup(await createBackup([article]))
    const copy = restored.find(item => item.title === article.title)
    const restoredVersions = await db.versions.where('articleId').equals(copy.id).toArray()
    const readCodes = document => {
      const values = []
      const visit = node => { if (node.type === 'codeBlock') values.push(nodeText(node)); node.content?.forEach(visit) }
      visit(document)
      return values
    }
    const originalImageIds = imageNodes(article.document).map(node => node.attrs.assetId)
    const restoredImageIds = imageNodes(copy.document).map(node => node.attrs.assetId)
    const imageBytesPreserved = (await Promise.all(originalImageIds.map(async (id, index) => {
      const a = await (await db.assets.get(id)).blob.arrayBuffer()
      const b = await (await db.assets.get(restoredImageIds[index])).blob.arrayBuffer()
      return id !== restoredImageIds[index] && a.byteLength === b.byteLength && new Uint8Array(a).every((byte, offset) => byte === new Uint8Array(b)[offset])
    }))).every(Boolean)
    return {
      codeBlocks: codes.length,
      copiedCodePreserved: JSON.stringify([...parsed.querySelectorAll('pre')].map(pre => pre.textContent)) === JSON.stringify(codes),
      textPreserved: nodeText(article.document).replace(/\s/g, '') === nodeText(article.sourceSnapshot).replace(/\s/g, ''),
      embeddedImages: parsed.querySelectorAll('img[src^="data:image/"]').length,
      images: originalImageIds.length,
      versions: versions.length, presets: presets.length,
      ignoredSuggestions: article.ignoredLayoutIssues?.length || 0,
      backupCodePreserved: JSON.stringify(readCodes(copy.document)) === JSON.stringify(codes),
      backupVersionCountPreserved: restoredVersions.length === versions.length,
      backupIgnoredSuggestionsPreserved: JSON.stringify(copy.ignoredLayoutIssues) === JSON.stringify(article.ignoredLayoutIssues),
      imageBytesPreserved,
      clipboardControls: parsed.querySelectorAll('button,input,select,script,[data-section-index],[data-block-index]').length,
    }
  }, { codes, articleId })
  for (const key of ['copiedCodePreserved', 'textPreserved', 'backupCodePreserved', 'backupVersionCountPreserved', 'backupIgnoredSuggestionsPreserved', 'imageBytesPreserved']) expect(verification[key], key).toBe(true)
  expect(verification.embeddedImages).toBe(verification.images)
  expect(verification.versions).toBeGreaterThan(0)
  expect(verification.presets).toBe(1)
  expect(verification.clipboardControls).toBe(0)
  await page.getByRole('button', { name: '导出', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /下载 HTML 文件/ }).click()
  await (await download).saveAs(join(directory, '完整文章.html'))
  expect(await hash()).toBe(sourceHash)
  expect(errors).toEqual([])
  await writeFile(join(directory, 'verification.json'), JSON.stringify({ source, sourceHash, sourceUnchanged: true, ...verification, pageErrors: errors }, null, 2), 'utf8')

  let checkDemo = false
  try { await copyFile(resolve('test-results/graded-layout-check.png'), join(directory, '检查分级演示.png')); checkDemo = true } catch { /* The optional example is available after browser tests. */ }
  const cards = [
    ['历史版本预览', '正文上方 → 历史版本', '查看当时的排版再恢复，恢复前的内容也会留档。'],
    ['个人排版方案', '排版样式 → 个人排版方案', '保存命名样式与固定文末，选择应用内容，避免重复设置。'],
    [checkDemo ? '检查分级与忽略（演示文章）' : '分级排版检查', '顶部 → 排版检查', '先处理结构和图片问题，美观建议可以忽略并记住。', checkDemo ? '检查分级演示' : '分级排版检查'],
    ['回收站恢复', '我的草稿 → 回收站', '找回误删的文章，保留原稿、图片和历史版本。'],
  ]
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>字间 · 本轮优化预览</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f7ef;color:#354a2d;font:15px/1.85 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1250px;margin:auto;padding:36px 22px}h1{font-size:30px;margin:6px 0}header p{color:#7b8f6c;max-width:740px}nav{display:flex;gap:12px;flex-wrap:wrap;margin:22px 0}nav a{padding:9px 18px;border-radius:7px;background:#416c58;color:white;text-decoration:none}nav a+ a{background:#e5eddc;color:#527143}.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}section{min-width:0;background:white;border:1px solid #e1e9d8;border-radius:12px;overflow:hidden}section .intro{padding:20px}h2{font-size:19px;margin:0 0 7px}section p{font-size:13px;color:#859677;margin:7px 0}section small{font-size:12px;color:#698650}img{display:block;width:100%;height:auto;border-top:1px solid #e9efdf}footer{margin-top:28px;font-size:12px;color:#8c9b7c}@media(max-width:700px){.cards{grid-template-columns:1fr}main{padding:20px 14px}h1{font-size:24px}}</style><main><header><small>字间 / DAILY WORKFLOW</small><h1>放心修改，复用自己的排版</h1><p>使用《${escape(title)}》生成的实际功能截图。${checkDemo ? '检查分级使用单独标注的演示文章，展示问题与建议同时出现时的操作。' : ''}点击截图可放大查看。</p><nav><a href="完整文章.html">阅读完整排版文章</a><a href="http://127.0.0.1:5173">打开字间工作台</a><a href="verification.json">查看内容保留验证</a></nav></header><div class="cards">${cards.map(([name, path, detail, picture = name]) => `<section><div class="intro"><small>${escape(path)}</small><h2>${escape(name)}</h2><p>${escape(detail)}</p></div><a href="${picture}.png"><img src="${picture}.png" alt="${escape(name)}实际操作截图" loading="lazy"></a></section>`).join('')}</div><footer>${verification.codeBlocks} 段代码逐字符保留 · ${verification.images} 张原图完整保留 · 历史与备份恢复通过验证 · 原 Word 文件未修改。此效果页展示功能，个人草稿请在工作台查看。</footer></main></html>`
  await writeFile(join(directory, 'index.html'), html, 'utf8')
  const gallery = await context.newPage()
  gallery.on('pageerror', error => errors.push(error.message))
  await gallery.goto(pathToFileURL(join(directory, 'index.html')).href)
  for (const picture of await gallery.locator('img').all()) {
    await picture.scrollIntoViewIfNeeded()
    await expect(picture).toHaveJSProperty('complete', true)
    expect(await picture.evaluate(image => image.naturalWidth)).toBeGreaterThan(0)
  }
  await gallery.evaluate(() => scrollTo(0, 0))
  await gallery.screenshot({ path: join(directory, '功能总览.png'), fullPage: true, animations: 'disabled' })
  for (const width of [1366, 390, 320]) {
    await gallery.setViewportSize({ width, height: 900 })
    expect(await gallery.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await gallery.screenshot({ path: join(directory, '手机效果页.png'), fullPage: true, animations: 'disabled' })
  const offline = await context.newPage()
  offline.on('pageerror', error => errors.push(error.message))
  await offline.goto(pathToFileURL(join(directory, '完整文章.html')).href)
  await offline.getByRole('button', { name: '复制到公众号', exact: true }).click()
  await expect(offline.locator('#copy-status')).toContainText('已复制')
  const offlineCodes = await offline.evaluate(async () => {
    const items = await navigator.clipboard.read()
    const copiedHTML = await (await items[0].getType('text/html')).text()
    return [...new DOMParser().parseFromString(copiedHTML, 'text/html').querySelectorAll('pre')].map(pre => pre.textContent)
  })
  expect(offlineCodes).toEqual(codes)
  expect(errors).toEqual([])
  const result = { source, sourceHash, sourceUnchanged: await hash() === sourceHash, ...verification, galleryCheckedWidths: [1366, 390, 320], offlineCopyPreserved: true, pageErrors: errors }
  await writeFile(join(directory, 'verification.json'), JSON.stringify(result, null, 2), 'utf8')
  process.stdout.write(`${JSON.stringify({ directory, ...result }, null, 2)}\n`)
} finally { await context.close(); await browser.close() }
