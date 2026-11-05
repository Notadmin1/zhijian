import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const source = process.argv[2]
if (!source) throw new Error('用法：node scripts/refinement-showcase.mjs <Word 文件> [输出文件夹]')
const directory = resolve(process.argv[3] || 'output/精修排版预览')
await mkdir(directory, { recursive: true })
const hash = async () => createHash('sha256').update(await readFile(source)).digest('hex')
const sourceHash = await hash()
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, permissions: ['clipboard-read', 'clipboard-write'] })
const errors = []
page.on('pageerror', error => errors.push(error.message))
const title = basename(source).replace(/\.docx$/i, '')
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
try {
  await page.goto(process.env.STUDIO_TEST_URL || 'http://127.0.0.1:5173')
  await page.getByTestId('word-input').setInputFiles(source)
  await expect(page.locator('.beautified-title')).toHaveText(title)
  if (await page.getByRole('dialog').count()) await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  const originalCodes = await page.getByTestId('beautified-article').locator('pre').allTextContents()
  await page.getByRole('button', { name: '排版样式', exact: true }).click()
  await page.getByRole('button', { name: '主题：安全研究', exact: true }).click()
  await page.getByRole('button', { name: '收起排版样式', exact: true }).click()
  await page.getByRole('button', { name: '原文编辑', exact: true }).click()
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
  await page.screenshot({ path: join(directory, '紧凑工作台.png'), animations: 'disabled' })
  const editor = page.getByRole('textbox', { name: '文章正文' })
  const settings = [
    { match: '<intent-filter>', name: 'AndroidManifest.xml', wrap: 'wrap', lines: '2-4' },
    { match: 'aapt dump badging', name: 'DeepLink 排查命令', wrap: 'scroll', lines: '' },
    { match: 'Intent intent = new Intent();', name: '第三方 POC App · MainActivity.java', wrap: 'wrap', lines: '3-4' },
  ]
  for (const setting of settings) {
    const snippet = editor.locator('pre').filter({ hasText: setting.match })
    if (await snippet.count() !== 1) throw new Error(`无法唯一定位代码：${setting.match}`)
    await snippet.click()
    await page.getByLabel('代码文件名或说明').fill(setting.name)
    await page.getByLabel('当前代码块换行').selectOption(setting.wrap)
    await page.getByLabel('代码强调行', { exact: true }).fill(setting.lines)
    await page.getByRole('button', { name: '应用', exact: true }).click()
  }
  await page.getByTestId('article-preview').locator('pre').filter({ hasText: 'Intent intent = new Intent();' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(directory, '代码局部设置.png'), animations: 'disabled' })
  const picture = page.locator('.asset-image > img').first()
  await picture.click()
  await page.getByLabel('图片宽度', { exact: true }).selectOption('75')
  await page.getByLabel('图片装饰', { exact: true }).selectOption('border')
  await page.getByLabel('当前图片设置', { exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(directory, '图片精修工具.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '查看大图', exact: true }).click()
  await page.screenshot({ path: join(directory, '原图查看.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await editor.locator('table th, table td').first().click()
  await expect(page.getByLabel('当前表格操作', { exact: true })).toBeVisible()
  await page.screenshot({ path: join(directory, '表格编辑工具.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '一键美化', exact: true }).click()
  expect(await page.getByTestId('beautified-article').locator('pre').allTextContents()).toEqual(originalCodes)
  await page.getByRole('button', { name: '复制到公众号', exact: true }).click()
  await expect(page.locator('.toast')).toContainText('已复制')
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
  const verification = await page.evaluate(async () => {
    const { db } = await import('/src/lib/storage.ts')
    const { nodeText, imageNodes } = await import('/src/lib/document.ts')
    const { beautifyDocument } = await import('/src/lib/beautify.ts')
    const article = await db.articles.get(localStorage.getItem('zijian-active'))
    const items = await navigator.clipboard.read()
    const html = await (await items[0].getType('text/html')).text()
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    return {
      textPreserved: nodeText(article.sourceSnapshot).replace(/\s/g, '') === nodeText(article.document).replace(/\s/g, ''),
      idempotent: JSON.stringify(beautifyDocument(article.document).document) === JSON.stringify(article.document),
      codes: [...parsed.querySelectorAll('pre')].map(pre => pre.textContent),
      blockSettings: article.document.content.filter(node => node.type === 'codeBlock' && node.attrs.codeTitle).map(node => node.attrs),
      images: imageNodes(article.document).length,
      embeddedImages: parsed.querySelectorAll('img[src^="data:image/"]').length,
      firstImageWidth: parsed.querySelector('img')?.style.width,
      internalControls: parsed.querySelectorAll('button,input,select,script,[data-code-wrap],[data-image-width],[data-block-index],[data-section-index]').length,
    }
  })
  expect(verification.textPreserved).toBe(true)
  expect(verification.idempotent).toBe(true)
  expect(verification.codes).toEqual(originalCodes)
  expect(verification.embeddedImages).toBe(verification.images)
  expect(verification.firstImageWidth).toBe('75%')
  expect(verification.blockSettings.length).toBe(3)
  expect(verification.internalControls).toBe(0)
  await page.getByRole('button', { name: '导出', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /下载 HTML 文件/ }).click()
  await (await downloadPromise).saveAs(join(directory, '完整文章.html'))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '手机预览', exact: true }).click()
  await page.getByTestId('article-preview').locator('pre').filter({ hasText: 'Intent intent = new Intent();' }).scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: join(directory, '手机阅读效果.png'), animations: 'disabled' })
  const standalone = await browser.newPage({ viewport: { width: 1000, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
  await standalone.goto(pathToFileURL(join(directory, '完整文章.html')).href)
  await standalone.getByRole('button', { name: '复制到公众号', exact: true }).click()
  await expect(standalone.locator('#copy-status')).toContainText('已复制')
  const offlineCodes = await standalone.evaluate(async () => {
    const items = await navigator.clipboard.read()
    const parsed = new DOMParser().parseFromString(await (await items[0].getType('text/html')).text(), 'text/html')
    return [...parsed.querySelectorAll('pre')].map(pre => pre.textContent)
  })
  expect(offlineCodes).toEqual(originalCodes)
  const java = standalone.locator('#export-article pre').filter({ hasText: 'Intent intent = new Intent();' })
  await java.locator('..').screenshot({ path: join(directory, 'Java代码效果.png'), animations: 'disabled' })
  const sourceUntouched = sourceHash === await hash()
  expect(sourceUntouched).toBe(true)
  expect(errors).toEqual([])
  const screenshots = [
    ['紧凑工作台', '顶部留白缩小，预览可收起或拖动调宽。'],
    ['代码局部设置', '每段代码独立设置换行、文件名和关键行强调。'],
    ['图片精修工具', '选择图片后调整宽度、对齐和边框，支持替换。'],
    ['表格编辑工具', '增删行列、合并和拆分单元格，以及手动表头。'],
    ['原图查看', '使用原始图片查看截图细节。'],
    ['手机阅读效果', '代码缩进、空行和关键行强调在手机预览中保留。'],
  ].map(([name, description]) => `<a class="card" href="${escape(name)}.png" target="_blank"><img src="${escape(name)}.png" alt="${escape(name)}" loading="lazy"><strong>${escape(name)}</strong><p>${escape(description)}</p></a>`).join('')
  await writeFile(join(directory, 'index.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>字间 · 局部精修效果</title><style>*{box-sizing:border-box}body{margin:0;background:#f3f6f0;color:#314a3b;font:14px/1.8 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1140px;margin:auto;padding:36px 22px}small{color:#7b9274;letter-spacing:2px}h1{font-size:30px;margin:10px 0}header p{color:#73846b}nav{display:flex;flex-wrap:wrap;gap:10px;margin:22px 0}nav a{background:#416c58;color:white;padding:9px 16px;border-radius:6px;text-decoration:none}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:26px 0}.card{display:block;padding:12px;background:white;border:1px solid #e0e7db;border-radius:9px;text-decoration:none;color:inherit;min-width:0}.card img{display:block;width:100%;height:240px;object-fit:contain;background:#f8faf5;border-radius:4px}.card strong{display:block;margin:10px 5px 0}.card p{font-size:12px;color:#7d8f74;margin:5px}iframe{width:100%;height:85vh;min-height:560px;border:1px solid #dce5d5;border-radius:8px;background:white}footer{color:#819177;font-size:12px;margin-top:16px}@media(max-width:650px){main{padding:24px 12px}.grid{grid-template-columns:1fr}.card img{height:210px}h1{font-size:25px}}</style></head><body><main><header><small>字间 / ARTICLE DETAILS</small><h1>排好整篇，也能精修每一处。</h1><p>${escape(title)} · ${verification.codes.length} 段代码与 ${verification.images} 张原图完整保留。此页演示代码说明、强调行和图片宽度等局部设置，正文文字保持原样。</p></header><nav><a href="http://127.0.0.1:5173">打开工作台</a><a href="完整文章.html" target="_blank">独立打开完整文章</a><a href="#article">查看完整排版 ↓</a></nav><div class="grid">${screenshots}</div><h2 id="article">完整文章，可直接复制</h2><iframe title="局部精修后的完整文章" src="完整文章.html"></iframe><footer>本地生成 · 已验证代码文字、图片嵌入、复制与离线打开 · 源 Word 保持原样</footer></main></body></html>`, 'utf8')
  await writeFile(join(directory, 'verification.json'), JSON.stringify({ source, ...verification, sourceUntouched, offlineCopy: true, pageErrors: errors }, null, 2), 'utf8')
  console.log(JSON.stringify({ directory, textPreserved: verification.textPreserved, codeBlocks: verification.codes.length, images: verification.images, localSettings: verification.blockSettings.length, offlineCopy: true, sourceUntouched }, null, 2))
} finally { await browser.close() }
