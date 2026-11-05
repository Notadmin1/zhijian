import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

const source = process.argv[2]
if (!source) throw new Error('用法：node scripts/template-showcase.mjs <Word 文件> [输出文件夹]')
const destination = resolve(process.argv[3] || 'output/新版排版预览')
await mkdir(destination, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1512, height: 982 }, permissions: ['clipboard-read', 'clipboard-write'] })
const title = basename(source).replace(/\.docx$/i, '')
const profiles = [
  { id: 'research', name: '安全研究', color: '#294f59', description: '研究章节、深色代码、观察与目标卡片' },
  { id: 'tutorial', name: '实战教程', color: '#9a5b37', description: '步骤标题、浅色示例、温暖的提示区域' },
  { id: 'minimal', name: '极简长文', color: '#3d4941', description: '简洁标题、细线表格、舒适留白' },
]
const checks = []
const pageErrors = []
page.on('pageerror', error => pageErrors.push(error.message))
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
try {
  await page.goto(process.env.STUDIO_TEST_URL || 'http://127.0.0.1:5173')
  await page.getByTestId('word-input').setInputFiles(source)
  await expect(page.getByTestId('beautified-article')).toBeVisible()
  await expect(page.locator('.beautified-title')).toHaveText(title)
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
  if (await page.getByRole('dialog').count()) await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  const originalCodes = await page.getByTestId('beautified-article').locator('pre').allTextContents()
  await page.getByRole('button', { name: '排版样式', exact: true }).click()
  await page.getByRole('button', { name: '用当前文章对比模板', exact: true }).click()
  await page.screenshot({ path: join(destination, '模板对比.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  for (const profile of profiles) {
    await page.getByRole('button', { name: `主题：${profile.name}`, exact: true }).click()
    await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
    expect(await page.getByTestId('beautified-article').locator('pre').allTextContents()).toEqual(originalCodes)
    await page.getByRole('button', { name: '复制到公众号', exact: true }).click()
    await expect(page.locator('.toast')).toContainText('已复制')
    const result = await page.evaluate(async () => {
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
        code: [...parsed.querySelectorAll('pre')].map(node => node.textContent),
        images: imageNodes(article.document).length,
        embeddedImages: parsed.querySelectorAll('img[src^="data:image/"]').length,
        callouts: beautifyDocument(article.document).report.callouts,
        metadata: parsed.querySelectorAll('script,[data-block-index],[data-section-index],[data-callout-kind]').length,
      }
    })
    expect(result.textPreserved).toBe(true)
    expect(result.idempotent).toBe(true)
    expect(result.code).toEqual(originalCodes)
    expect(result.embeddedImages).toBe(result.images)
    expect(result.metadata).toBe(0)
    await page.getByRole('button', { name: '导出', exact: true }).click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /下载 HTML 文件/ }).click()
    await (await downloadPromise).saveAs(join(destination, `${profile.name}.html`))
    const code = page.getByTestId('beautified-article').locator('pre').filter({ hasText: 'Intent intent = new Intent();' })
    if (await code.count()) await code.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(destination, `${profile.name}-代码.png`), animations: 'disabled' })
    const cards = page.getByTestId('beautified-article').locator('[data-callout-kind]')
    if (await cards.count()) await cards.first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(destination, `${profile.name}-卡片.png`), animations: 'disabled' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: '手机预览', exact: true }).click()
    const mobileCards = page.getByTestId('article-preview').locator('[data-callout-kind]')
    if (await mobileCards.count()) await mobileCards.first().scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: join(destination, `${profile.name}-手机.png`), animations: 'disabled' })
    await page.setViewportSize({ width: 1512, height: 982 })
    await page.getByRole('button', { name: '美化效果', exact: true }).click()
    checks.push({ template: profile.name, ...result })
  }
  const componentHTML = await page.evaluate(async () => {
    const { newArticle } = await import('/src/lib/document.ts')
    const { beautifyDocument } = await import('/src/lib/beautify.ts')
    const { themes } = await import('/src/lib/themes.ts')
    const { renderArticle, htmlFile } = await import('/src/lib/render.ts')
    const texts = ['以下为排版组件演示，使用示例文字展示六种提示卡片，不属于原文章内容。', '说明：用于解释术语、补充上下文。', '注意：用于突出操作前需要核对的事项。', '前置条件：列出读者需要准备的环境与材料。', '目标：说明本节要完成的内容。', '观察：记录实际现象，不预先认定验证成功。', '修复建议：单独呈现原文已有的建议。']
    const article = newArticle('提示卡片演示 · 示例内容', beautifyDocument({ type: 'doc', content: texts.map(text => ({ type: 'paragraph', content: [{ type: 'text', text }] })) }).document)
    article.themeId = 'research'
    article.typography.accent = themes.find(theme => theme.id === 'research').accent
    return htmlFile(article.title, renderArticle(article, { mode: 'download' }))
  })
  await writeFile(join(destination, '提示卡片示例.html'), componentHTML, 'utf8')
  const cards = profiles.map((profile, index) => `<button class="theme" data-file="${escape(profile.name)}.html" aria-pressed="${index === 0}" style="--accent:${profile.color}"><span class="number">0${index + 1}</span><strong>${profile.name}</strong><small>${profile.description}</small></button>`).join('')
  const index = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>字间 · 三种新版式</title><style>*{box-sizing:border-box}body{margin:0;background:#f2f5f0;color:#34443a;font:14px/1.7 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1100px;margin:auto;padding:38px 24px}.eyebrow{color:#7d9278;letter-spacing:3px;font-size:10px}h1{font:600 30px/1.6 Georgia,"Microsoft YaHei",serif;margin:12px 0}header p{color:#7c8976;font-size:13px;margin:8px 0}.themes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px;margin:27px 0 18px}.theme{position:relative;text-align:left;padding:19px 20px;background:white;border:1px solid #dfe6db;border-radius:8px;cursor:pointer;color:var(--accent)}.theme[aria-pressed=true]{border-color:var(--accent);box-shadow:inset 0 3px var(--accent)}.theme strong{display:block;font-size:17px}.theme small{display:block;color:#899382;font-size:11px;margin-top:7px}.number{float:right;opacity:.45;font-size:12px}.tools{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:16px 0;font-size:12px;color:#8c9785}.tools a{color:#446c58;text-decoration:none}iframe{display:block;width:100%;height:80vh;min-height:600px;background:white;border:1px solid #dfe6da;border-radius:9px}footer{margin-top:17px;font-size:11px;color:#8b9981}@media(max-width:600px){main{padding:24px 12px}h1{font-size:24px}.themes{gap:7px}.theme{padding:14px 10px}.theme strong{font-size:14px}.theme small{font-size:10px}.number{display:none}iframe{height:78vh;min-height:500px}}</style></head><body><main><header><span class="eyebrow">字间 / READING STYLES</span><h1>同一篇文章，三种阅读方式。</h1><p>${escape(title)} · 原文、代码与配图保留，切换查看整篇排版。</p></header><nav class="themes" aria-label="选择预览模板">${cards}</nav><div class="tools"><span>在下方文章内点击“复制到公众号”，即可复制当前版式。</span><span><a id="open-style" href="安全研究.html" target="_blank">独立打开本版 ↗</a> · <a href="提示卡片示例.html" target="_blank">查看六类提示卡片 ↗</a></span></div><iframe title="当前模板的完整文章" src="安全研究.html"></iframe><footer>本地生成 · 三版均含原文的 ${checks[0].images} 张图片与 ${originalCodes.length} 段代码 · 源 Word 保持原样</footer></main><script>document.querySelectorAll('.theme').forEach(function(button){button.onclick=function(){document.querySelectorAll('.theme').forEach(function(item){item.setAttribute('aria-pressed',String(item===button))});document.querySelector('iframe').src=button.dataset.file;document.getElementById('open-style').href=button.dataset.file}});</script></body></html>`
  await writeFile(join(destination, 'index.html'), index, 'utf8')
  await writeFile(join(destination, 'verification.json'), JSON.stringify({ source, checks, pageErrors }, null, 2), 'utf8')
  expect(pageErrors).toEqual([])
  for (const profile of profiles) expect((await readFile(join(destination, `${profile.name}.html`), 'utf8')).startsWith('<!doctype html>')).toBe(true)
  console.log(JSON.stringify({ destination, checks: checks.map(({ code, ...rest }) => ({ ...rest, codeBlocks: code.length })) }, null, 2))
} finally { await browser.close() }
