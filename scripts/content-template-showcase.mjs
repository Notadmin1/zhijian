import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const source = process.argv[2]
if (!source) throw new Error('用法：node scripts/content-template-showcase.mjs <Word 文件> [输出目录]')
const directory = resolve(process.argv[3] || 'output/开头文末模板预览')
await mkdir(directory, { recursive: true })
const hash = async () => createHash('sha256').update(await readFile(source)).digest('hex')
const sourceHash = await hash()
const title = basename(source).replace(/\.docx$/i, '')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] })
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
const escape = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
try {
  await page.goto(process.env.STUDIO_TEST_URL || 'http://127.0.0.1:5173')
  await page.getByTestId('word-input').setInputFiles(source)
  await expect(page.locator('.beautified-title')).toHaveText(title)
  if (await page.getByRole('dialog').count()) await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
  const articleId = await page.evaluate(() => localStorage.getItem('zijian-active'))
  const codes = await page.getByTestId('beautified-article').locator('pre').allTextContents()
  const originalDocument = await page.evaluate(async articleId => { const { db } = await import('/src/lib/storage.ts'); return (await db.articles.get(articleId)).document }, articleId)
  await page.getByRole('button', { name: '排版样式', exact: true }).click()
  await page.getByRole('button', { name: '主题：安全研究', exact: true }).click()
  const open = async () => { await page.getByRole('button', { name: /开头与文末模板/ }).click(); const dialog = page.getByRole('dialog', { name: '开头与文末模板' }); await expect(dialog).toBeVisible(); return dialog }
  let dialog = await open()
  await dialog.getByRole('button', { name: '作者开场', exact: true }).click()
  await dialog.getByRole('button', { name: '保存模板', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '编辑模板 作者开场', exact: true })).toBeVisible()
  await page.screenshot({ path: join(directory, '模板编辑.png'), animations: 'disabled' })
  await dialog.getByRole('tab', { name: '插入效果预览', exact: true }).click()
  await expect(dialog.getByLabel('模板插入效果预览')).toContainText('欢迎来到我的公众号')
  await page.screenshot({ path: join(directory, '开头插入预览.png'), animations: 'disabled' })
  await dialog.getByRole('button', { name: '插入当前文章开头', exact: true }).click()
  dialog = await open()
  await dialog.getByRole('button', { name: '关注与交流', exact: true }).click()
  await dialog.getByRole('button', { name: '保存模板', exact: true }).click()
  const templates = await page.evaluate(async () => { const { db } = await import('/src/lib/storage.ts'); return db.contentTemplates.toArray() })
  await dialog.getByLabel('自动添加的开头模板', { exact: true }).selectOption(templates.find(template => template.position === 'header').id)
  await dialog.getByLabel('自动添加的文末模板', { exact: true }).selectOption(templates.find(template => template.position === 'footer').id)
  await page.screenshot({ path: join(directory, '自动添加设置.png'), animations: 'disabled' })
  await dialog.getByRole('button', { name: '插入当前文章文末', exact: true }).click()
  expect(await page.getByTestId('beautified-article').locator('pre').allTextContents()).toEqual(codes)
  await page.getByRole('button', { name: '复制到公众号', exact: true }).click()
  await expect(page.locator('.toast')).toContainText('已复制')
  const verification = await page.evaluate(async ({ articleId, originalDocument, codes }) => {
    const { db } = await import('/src/lib/storage.ts')
    const { createBackup, restoreBackup } = await import('/src/lib/backup.ts')
    const { insertContentTemplate } = await import('/src/lib/content-templates.ts')
    const { imageNodes, nodeText } = await import('/src/lib/document.ts')
    const article = await db.articles.get(articleId)
    const templates = await db.contentTemplates.toArray()
    const opening = templates.find(template => template.position === 'header')
    const ending = templates.find(template => template.position === 'footer')
    const middle = article.document.content.slice(opening.document.content.length, -ending.document.content.length)
    const items = await navigator.clipboard.read()
    const copied = new DOMParser().parseFromString(await (await items[0].getType('text/html')).text(), 'text/html')
    const [restored] = await restoreBackup(await createBackup([article]))
    return { codeBlocks: codes.length, images: imageNodes(article.document).length,
      originalBodyPreserved: JSON.stringify(middle) === JSON.stringify(originalDocument.content),
      copiedCodesPreserved: JSON.stringify([...copied.querySelectorAll('pre')].map(node => node.textContent)) === JSON.stringify(codes),
      copiedEmbeddedImages: copied.querySelectorAll('img[src^="data:image/"]').length,
      copiedHasOpeningAndEnding: copied.body.textContent.includes('欢迎来到我的公众号') && copied.body.textContent.includes('欢迎留言交流'),
      noDuplicateInsertion: !insertContentTemplate(article.document, opening).inserted && !insertContentTemplate(article.document, ending).inserted,
      backupTextPreserved: nodeText(restored.document) === nodeText(article.document),
      restoredTemplates: await db.contentTemplates.count(),
      automaticChoices: (await db.contentTemplates.toArray()).filter(template => template.autoInsert).map(template => template.position).sort(),
      clipboardControls: copied.querySelectorAll('script,input,button,select,[data-block-index]').length,
    }
  }, { articleId, originalDocument, codes })
  for (const key of ['originalBodyPreserved', 'copiedCodesPreserved', 'copiedHasOpeningAndEnding', 'noDuplicateInsertion', 'backupTextPreserved']) expect(verification[key], key).toBe(true)
  expect(verification.copiedEmbeddedImages).toBe(verification.images)
  expect(verification.restoredTemplates).toBe(4)
  expect(verification.automaticChoices).toEqual(['footer', 'header'])
  expect(verification.clipboardControls).toBe(0)
  await page.evaluate(async originalIds => { const { db } = await import('/src/lib/storage.ts'); await db.contentTemplates.where('id').noneOf(originalIds).delete() }, templates.map(template => template.id))
  await page.getByRole('button', { name: '导出', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /下载 HTML 文件/ }).click()
  await (await download).saveAs(join(directory, '完整文章.html'))
  const offline = await context.newPage()
  offline.on('pageerror', error => errors.push(error.message))
  await offline.setViewportSize({ width: 760, height: 1000 })
  await offline.goto(pathToFileURL(join(directory, '完整文章.html')).href)
  expect(await offline.locator('#export-article pre').allTextContents()).toEqual(codes)
  await offline.screenshot({ path: join(directory, '文章开头.png'), animations: 'disabled' })
  await offline.locator('#export-article').getByText('感谢阅读', { exact: true }).scrollIntoViewIfNeeded()
  await offline.screenshot({ path: join(directory, '文章文末.png'), animations: 'disabled' })
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await page.getByRole('button', { name: '主题与样式', exact: true }).click()
    dialog = await open()
    await dialog.getByRole('button', { name: '编辑模板 作者开场', exact: true }).click()
    await dialog.evaluate(node => { node.scrollTop = 0 })
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: join(directory, `手机模板设置-${width}.png`), animations: 'disabled' })
    await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  }
  expect(await hash()).toBe(sourceHash)
  expect(errors).toEqual([])
  const result = { source, sourceHash, sourceUnchanged: true, ...verification, checkedWidths: [1440, 390, 320], pageErrors: errors }
  const cards = [['模板编辑', '文字、链接、卡片与图片，保存后可反复使用。'], ['自动添加设置', '开头和文末各选一套，新建、Word 和粘贴导入时自动添加。'], ['文章开头', '作者开场跟随文章主题显示。'], ['文章文末', '分割线、感谢语与关注提示随正文一起复制。']]
  await writeFile(join(directory, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>字间 · 开头与文末模板</title><style>*{box-sizing:border-box}body{margin:0;background:#f3f6ef;color:#354b34;font:15px/1.85 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1180px;margin:auto;padding:30px 22px}h1{font-size:30px;margin:8px 0}header p{color:#7c8e72;max-width:820px}nav{display:flex;gap:10px;flex-wrap:wrap;margin:22px 0}nav a{background:#416c58;color:white;text-decoration:none;border-radius:6px;padding:9px 16px}.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.cards section{min-width:0;border:1px solid #e0e8d9;border-radius:9px;overflow:hidden;background:white}.intro{padding:18px}h2{font-size:19px;margin:0}.intro p{font-size:13px;color:#809275;margin:8px 0 0}img{display:block;width:100%;height:auto;border-top:1px solid #e6ecdf}footer{font-size:12px;color:#8a9c7e;margin-top:24px}@media(max-width:760px){main{padding:20px 14px}.cards{grid-template-columns:1fr}h1{font-size:24px}}</style><main><header><small>字间 / ARTICLE SIGNATURE</small><h1>设置一次，文章自动带上开头与文末</h1><p>使用《${escape(title)}》展示实际效果。模板是可编辑的普通图文，可放作者介绍、链接、关注提示和你自己的公众号二维码。相同内容已在对应位置时跳过重复添加。</p><nav><a href="完整文章.html">阅读全文 / 复制到公众号</a><a href="http://127.0.0.1:5173">打开字间</a><a href="verification.json">保留验证</a></nav></header><div class="cards">${cards.map(([name, description]) => `<section><div class="intro"><h2>${name}</h2><p>${description}</p></div><a href="${name}.png"><img src="${name}.png" alt="${name}" loading="lazy"></a></section>`).join('')}</div><footer>${verification.codeBlocks} 段代码逐字符保留 · ${verification.images} 张原图保留 · 原 Word 未改动。入口：排版样式 → 开头与文末模板。</footer></main></html>`, 'utf8')
  const gallery = await context.newPage()
  gallery.on('pageerror', error => errors.push(error.message))
  await gallery.goto(pathToFileURL(join(directory, 'index.html')).href)
  for (const image of await gallery.locator('img').all()) {
    await image.scrollIntoViewIfNeeded()
    await expect(image).toHaveJSProperty('complete', true)
    expect(await image.evaluate(node => node.naturalWidth)).toBeGreaterThan(0)
  }
  await gallery.evaluate(() => scrollTo(0, 0))
  await gallery.screenshot({ path: join(directory, '效果总览.png'), fullPage: true, animations: 'disabled' })
  for (const width of [1440, 390, 320]) {
    await gallery.setViewportSize({ width, height: 844 })
    expect(await gallery.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  expect(errors).toEqual([])
  await writeFile(join(directory, 'verification.json'), JSON.stringify(result, null, 2), 'utf8')
  process.stdout.write(`${JSON.stringify({ directory, ...result }, null, 2)}\n`)
} finally { await context.close(); await browser.close() }
