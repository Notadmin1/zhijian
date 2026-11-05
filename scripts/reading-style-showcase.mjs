import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const source = process.argv[2]
if (!source) throw new Error('用法：node scripts/reading-style-showcase.mjs <Word 文件> [输出文件夹]')
const directory = resolve(process.argv[3] || 'output/阅读风格优化预览')
await mkdir(directory, { recursive: true })
const hash = async () => createHash('sha256').update(await readFile(source)).digest('hex')
const sourceHash = await hash()
const title = basename(source).replace(/\.docx$/i, '')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1512, height: 982 }, permissions: ['clipboard-read', 'clipboard-write'] })
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
const variants = [
  { name: '紧凑', density: '紧凑', decoration: 'balanced', detail: '行高 1.65 · 段距 12px，适合信息密集的技术文章。' },
  { name: '标准', density: '标准', decoration: 'balanced', detail: '行高 1.8 · 段距 16px，适合日常发布。' },
  { name: '舒展', density: '舒展', decoration: 'balanced', detail: '行高 2 · 段距 22px，增加呼吸感。' },
  { name: '简洁装饰', density: '标准', decoration: 'simple', detail: '细线标题、浅色代码与轻量卡片，减少视觉负担。' },
  { name: '适中装饰', density: '标准', decoration: 'balanced', detail: '保留安全研究模板的分区、深色代码与层级。' },
  { name: '突出装饰', density: '标准', decoration: 'expressive', detail: '增强章节底色、强调边线与卡片层次。' },
]

try {
  await page.goto(process.env.STUDIO_TEST_URL || 'http://127.0.0.1:5173')
  await page.getByTestId('word-input').setInputFiles(source)
  await expect(page.locator('.beautified-title')).toHaveText(title)
  if (await page.getByRole('dialog').count()) await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  const codes = await page.getByTestId('beautified-article').locator('pre').allTextContents()
  const articleId = await page.evaluate(() => localStorage.getItem('zijian-active'))
  await page.getByRole('button', { name: '排版样式', exact: true }).click()
  await page.getByRole('button', { name: '主题：安全研究', exact: true }).click()
  await page.getByRole('radio', { name: '标准', exact: true }).click()
  await page.getByRole('button', { name: '对比效果', exact: true }).click()
  const comparison = page.getByRole('dialog', { name: '用当前文章，对比阅读效果' })
  await expect(comparison.getByLabel('紧凑密度当前文章预览')).toContainText(title)
  await page.screenshot({ path: join(directory, '阅读密度对比.png'), animations: 'disabled' })
  await comparison.getByRole('tab', { name: '装饰强度对比', exact: true }).click()
  await page.screenshot({ path: join(directory, '装饰强度对比.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await page.screenshot({ path: join(directory, '阅读节奏操作.png'), animations: 'disabled' })

  for (const variant of variants) {
    await page.getByRole('radio', { name: variant.density, exact: true }).click()
    await page.getByLabel('装饰强度', { exact: true }).selectOption(variant.decoration)
    expect(await page.getByTestId('beautified-article').locator('pre').allTextContents()).toEqual(codes)
    await page.getByRole('button', { name: '导出', exact: true }).click()
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: /下载 HTML 文件/ }).click()
    await (await download).saveAs(join(directory, `${variant.name}.html`))
    await expect(page.getByRole('dialog')).not.toBeVisible()
    const offline = await context.newPage()
    offline.on('pageerror', error => errors.push(error.message))
    await offline.setViewportSize({ width: 760, height: 1100 })
    await offline.goto(pathToFileURL(join(directory, `${variant.name}.html`)).href)
    expect(await offline.locator('#export-article pre').allTextContents()).toEqual(codes)
    const imgs = offline.locator('#export-article img')
    for (const img of await imgs.all()) {
      await expect(img).toHaveJSProperty('complete', true)
      expect(await img.evaluate(element => element.naturalWidth)).toBeGreaterThan(0)
    }
    await offline.screenshot({ path: join(directory, `${variant.name}.png`), animations: 'disabled' })
    await offline.getByRole('button', { name: '复制到公众号', exact: true }).click()
    await expect(offline.locator('#copy-status')).toContainText('已复制')
    const offlineCodes = await offline.evaluate(async () => {
      const items = await navigator.clipboard.read()
      const parsed = new DOMParser().parseFromString(await (await items[0].getType('text/html')).text(), 'text/html')
      return [...parsed.querySelectorAll('pre')].map(node => node.textContent)
    })
    expect(offlineCodes).toEqual(codes)
    await offline.close()
  }

  await page.getByRole('radio', { name: '紧凑', exact: true }).click()
  await page.getByLabel('装饰强度', { exact: true }).selectOption('simple')
  await page.getByRole('button', { name: /个人排版方案/ }).click()
  const presets = page.getByRole('dialog', { name: '个人排版方案' })
  await presets.getByLabel('方案名称', { exact: true }).fill('紧凑简洁技术文')
  await presets.getByRole('button', { name: '保存为个人方案', exact: true }).click()
  await expect(presets.getByRole('button', { name: '应用方案 紧凑简洁技术文', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('radio', { name: '紧凑', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByLabel('装饰强度', { exact: true })).toHaveValue('simple')
  await page.getByRole('button', { name: '复制到公众号', exact: true }).click()
  await expect(page.locator('.toast')).toContainText('已复制')
  const verification = await page.evaluate(async ({ articleId, codes }) => {
    const { db } = await import('/src/lib/storage.ts')
    const { createBackup, restoreBackup } = await import('/src/lib/backup.ts')
    const { imageNodes, nodeText } = await import('/src/lib/document.ts')
    const article = await db.articles.get(articleId)
    const items = await navigator.clipboard.read()
    const copied = new DOMParser().parseFromString(await (await items[0].getType('text/html')).text(), 'text/html')
    const [restored] = await restoreBackup(await createBackup([article]))
    const originalImages = imageNodes(article.document)
    const restoredImages = imageNodes(restored.document)
    const imageBytesPreserved = (await Promise.all(originalImages.map(async (image, index) => {
      const a = new Uint8Array(await (await db.assets.get(image.attrs.assetId)).blob.arrayBuffer())
      const b = new Uint8Array(await (await db.assets.get(restoredImages[index].attrs.assetId)).blob.arrayBuffer())
      return a.length === b.length && a.every((byte, offset) => byte === b[offset])
    }))).every(Boolean)
    const presets = await db.presets.toArray()
    return {
      codeBlocks: codes.length, images: originalImages.length,
      exactCodePreserved: JSON.stringify([...copied.querySelectorAll('pre')].map(node => node.textContent)) === JSON.stringify(codes),
      originalTextPreserved: nodeText(article.document).replace(/\s/g, '') === nodeText(article.sourceSnapshot).replace(/\s/g, ''),
      copiedEmbeddedImages: copied.querySelectorAll('img[src^="data:image/"]').length,
      clipboardControlCount: copied.querySelectorAll('script,button,input,select,[data-block-index],[data-section-index]').length,
      backupStylePreserved: JSON.stringify(restored.typography) === JSON.stringify(article.typography),
      backupTextPreserved: nodeText(restored.document) === nodeText(article.document),
      presetStylePreserved: presets.length === 2 && presets.every(preset => JSON.stringify(preset.typography) === JSON.stringify(article.typography)),
      style: article.typography, imageBytesPreserved,
    }
  }, { articleId, codes })
  for (const key of ['exactCodePreserved', 'originalTextPreserved', 'backupStylePreserved', 'backupTextPreserved', 'presetStylePreserved', 'imageBytesPreserved']) expect(verification[key], key).toBe(true)
  expect(verification.copiedEmbeddedImages).toBe(verification.images)
  expect(verification.clipboardControlCount).toBe(0)
  expect(await hash()).toBe(sourceHash)

  const galleryHTML = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>字间 · 阅读风格优化预览</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f7f2;color:#35473c;font:15px/1.85 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1260px;margin:auto;padding:32px 24px}h1{font-size:30px;line-height:1.5;margin:8px 0}h2{font-size:21px;margin:36px 0 14px}header p{color:#778b75;max-width:820px}nav{display:flex;flex-wrap:wrap;gap:10px;margin:22px 0}a{color:#416c58}nav a,.read-link{display:inline-block;background:#416c58;color:white;text-decoration:none;padding:8px 16px;border-radius:6px}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.cards section{background:white;border:1px solid #e1e8dd;border-radius:10px;overflow:hidden;min-width:0}.intro{padding:18px}h3{font-size:18px;margin:0 0 5px}.intro p{font-size:13px;color:#7a8a75;min-height:48px;margin:4px 0 12px}.cards img{display:block;width:100%;height:auto;border-top:1px solid #e5ebe0}.operations{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.operations img{display:block;width:100%;height:auto;border-radius:8px;border:1px solid #e0e7db}.tip{padding:18px 22px;background:#eaf1e6;border-radius:8px;margin:20px 0;font-size:14px}.tip b{color:#3e6250}footer{font-size:12px;color:#8a9b83;margin-top:28px}@media(max-width:760px){main{padding:22px 14px}h1{font-size:24px}.cards,.operations{grid-template-columns:minmax(0,1fr)}.intro p{min-height:0}}</style><main><header><small>字间 / READING RHYTHM</small><h1>同一篇文章，找到舒服的阅读节奏</h1><p>以《${escape(title)}》的实际内容生成。前三种只改变阅读密度；后三种保持标准密度，比较装饰强度。所有示例开启相邻内容自动留白，点击“阅读全文”可直接复制排版图文。</p><nav><a href="http://127.0.0.1:5173">打开字间工作台</a><a href="verification.json">查看保留验证</a></nav></header><div class="tip"><b>推荐起点：安全研究 + 紧凑 + 简洁。</b> 技术文章的代码较多时，使用紧凑密度减少滚动；需要强调章节时，可改为适中或突出。说明贴近后面的代码和图片，新章节前保留更大间隔。</div><h2>阅读密度</h2><div class="cards">${variants.slice(0, 3).map(card).join('')}</div><h2>装饰强度</h2><div class="cards">${variants.slice(3).map(card).join('')}</div><h2>在工作台中直接对比</h2><p>排版样式 → 阅读节奏 → 对比效果。每个预览都使用当前文章，点击应用后可微调或保存为个人方案。</p><div class="operations">${['阅读密度对比', '装饰强度对比', '阅读节奏操作'].map(name => `<a href="${name}.png"><img src="${name}.png" alt="${name}" loading="lazy"></a>`).join('')}</div><footer>${verification.codeBlocks} 段代码逐字符保留 · ${verification.images} 张原图完整保留 · 原 Word 未修改 · 个人方案、备份恢复、离线复制通过验证。最终发布效果请在公众号后台检查。</footer></main></html>`
  function card(variant) { return `<section><div class="intro"><h3>${variant.name}</h3><p>${variant.detail}</p><a class="read-link" href="${variant.name}.html">阅读全文 / 复制图文</a></div><a href="${variant.name}.png"><img src="${variant.name}.png" alt="${variant.name}实际文章" loading="lazy"></a></section>` }
  await writeFile(join(directory, 'index.html'), galleryHTML, 'utf8')
  const gallery = await context.newPage()
  gallery.on('pageerror', error => errors.push(error.message))
  await gallery.goto(pathToFileURL(join(directory, 'index.html')).href)
  for (const image of await gallery.locator('img').all()) {
    await image.scrollIntoViewIfNeeded()
    await expect(image).toHaveJSProperty('complete', true)
    expect(await image.evaluate(image => image.naturalWidth)).toBeGreaterThan(0)
  }
  await gallery.evaluate(() => scrollTo(0, 0))
  await gallery.screenshot({ path: join(directory, '效果总览.png'), fullPage: true, animations: 'disabled' })
  for (const width of [1512, 390, 320]) {
    await gallery.setViewportSize({ width, height: 844 })
    expect(await gallery.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '主题与样式', exact: true }).click()
  await page.getByRole('button', { name: '对比效果', exact: true }).click()
  const mobile = page.getByRole('dialog')
  await expect(mobile).toBeVisible()
  await page.screenshot({ path: join(directory, '手机效果对比.png'), animations: 'disabled' })
  expect(await mobile.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(errors).toEqual([])
  const result = { source, sourceHash, sourceUnchanged: await hash() === sourceHash, ...verification, exportedVariants: variants.map(variant => variant.name), offlineCopyPreserved: true, checkedWidths: [1512, 390, 320], pageErrors: errors }
  await writeFile(join(directory, 'verification.json'), JSON.stringify(result, null, 2), 'utf8')
  process.stdout.write(`${JSON.stringify({ directory, ...result }, null, 2)}\n`)
} finally { await context.close(); await browser.close() }
