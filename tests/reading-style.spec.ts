import { expect, test, type Page } from '@playwright/test'
import { pngBase64 } from './fixtures'

const code = 'class Example {\n\tString value = "<script>原文</script>";\n\n}\n'

async function seed(page: Page, legacy = false) {
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: '文章标题' })).toBeVisible()
  const id = await page.evaluate(async ({ code, pngBase64, legacy }) => {
    // @ts-expect-error Vite serves the browser module.
    const { db, addAsset } = await import('/src/lib/storage.ts')
    // @ts-expect-error Vite serves the browser module.
    const { newArticle } = await import('/src/lib/document.ts')
    const asset = await addAsset(await (await fetch(`data:image/png;base64,${pngBase64}`)).blob(), '阅读原图.png')
    const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
    const article = newArticle('当前文章的阅读风格', { type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '真实章节' }] },
      paragraph('运行以下示例：'),
      { type: 'codeBlock', attrs: { language: 'java', codeTitle: 'Example.java', codeWrap: 'scroll', highlightLines: '2' }, content: [{ type: 'text', text: code }] },
      { type: 'image', attrs: { assetId: asset.id, src: `asset:${asset.id}`, title: '保留原图', displayWidth: 75, imageAlign: 'right', imageFrame: 'border' } },
      paragraph('继续阅读正文。'),
    ] })
    article.themeId = 'research'
    article.typography.fontSize = 18
    article.typography.codeFontSize = 15
    article.typography.lineHeight = 2.2
    if (legacy) {
      delete article.typography.readingDensity
      delete article.typography.decoration
      delete article.typography.smartSpacing
    }
    await db.articles.put(article)
    localStorage.setItem('zijian-active', article.id)
    return article.id
  }, { code, pngBase64, legacy })
  await page.reload()
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue('当前文章的阅读风格')
  if ((page.viewportSize()?.width || 1512) <= 760) await page.getByRole('button', { name: '主题与样式', exact: true }).click()
  else if (!await page.getByRole('radio', { name: '紧凑', exact: true }).isVisible()) await page.getByRole('button', { name: '排版样式', exact: true }).click()
  return id
}

async function saved(page: Page) {
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
}

test('density, decoration and contextual gaps survive copying, theme changes, beautification and reload', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const id = await seed(page)
  await page.getByRole('radio', { name: '紧凑', exact: true }).click()
  await page.getByLabel('装饰强度', { exact: true }).selectOption('simple')
  await page.getByRole('button', { name: '美化效果', exact: true }).click()
  const preview = page.getByTestId('beautified-article')
  await expect(preview.locator('pre')).toHaveCSS('font-size', '15px')
  await expect(preview.locator('pre')).toHaveCSS('line-height', '25.5px')
  await expect(preview.locator('pre')).toHaveCSS('white-space', 'pre')
  await expect(preview.locator('h2')).toHaveCSS('margin-top', '0px')
  await expect(preview.locator('p').filter({ hasText: '运行以下示例：' })).toHaveCSS('margin-bottom', '8px')
  expect(await preview.locator('pre').textContent()).toBe(code)
  await page.getByRole('switch', { name: '相邻内容自动留白' }).click()
  await expect(preview.locator('h2')).toHaveCSS('margin-top', '27px')
  await page.getByRole('switch', { name: '相邻内容自动留白' }).click()
  await page.getByRole('button', { name: '主题：极简长文', exact: true }).click()
  await page.getByRole('button', { name: '一键美化', exact: true }).click()
  await expect(page.getByRole('radio', { name: '紧凑', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByLabel('装饰强度', { exact: true })).toHaveValue('simple')
  await page.getByRole('button', { name: '复制到公众号', exact: true }).click()
  await expect(page.locator('.toast')).toContainText('已复制')
  const copied = await page.evaluate(async () => {
    const items = await navigator.clipboard.read()
    const parsed = new DOMParser().parseFromString(await (await items[0].getType('text/html')).text(), 'text/html')
    const pre = parsed.querySelector('pre')!
    const img = parsed.querySelector('img')!
    return { code: pre.textContent, codeFont: pre.style.fontSize, wrap: pre.style.whiteSpace, codeLineHeight: pre.style.lineHeight,
      gap: (parsed.querySelector('h2') as HTMLElement).style.marginBottom, imageWidth: img.style.width, imageBorder: img.style.borderWidth,
      controls: parsed.querySelectorAll('button,select,script,[data-block-index],[data-section-index]').length }
  })
  expect(copied).toEqual({ code, codeFont: '15px', wrap: 'pre', codeLineHeight: '1.7', gap: '11px', imageWidth: '75%', imageBorder: '1px', controls: 0 })
  await saved(page)
  await page.reload()
  await expect(page.getByRole('radio', { name: '紧凑', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByLabel('装饰强度', { exact: true })).toHaveValue('simple')
  const stored = await page.evaluate(async id => {
    // @ts-expect-error Vite serves the browser module.
    const { db } = await import('/src/lib/storage.ts')
    return (await db.articles.get(id)).typography
  }, id)
  expect(stored).toMatchObject({ fontSize: 18, codeFontSize: 15, readingDensity: 'compact', lineHeight: 1.65, paragraphSpace: 12, smartSpacing: true, decoration: 'simple' })
})

test('comparison previews the current article and applies only the chosen style', async ({ page }) => {
  const id = await seed(page)
  await page.getByRole('button', { name: '对比效果', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '用当前文章，对比阅读效果' })
  for (const label of ['紧凑', '标准', '舒展']) {
    const preview = dialog.getByLabel(`${label}密度当前文章预览`)
    await expect(preview).toContainText('真实章节')
    expect(await preview.locator('pre').textContent()).toBe(code)
    await expect(preview.locator('img')).toHaveJSProperty('naturalWidth', 1)
    expect(await preview.locator('img').evaluate(img => img.style.width)).toBe('75%')
  }
  await dialog.getByRole('tab', { name: '装饰强度对比', exact: true }).click()
  await expect(dialog.getByLabel('简洁装饰当前文章预览').locator('pre')).toHaveCSS('color', 'rgb(67, 82, 104)')
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await expect(page.locator('.density-current')).toContainText('已微调')
  await expect(page.getByLabel('装饰强度', { exact: true })).toHaveValue('balanced')
  await page.getByRole('button', { name: '对比效果', exact: true }).click()
  await dialog.getByRole('button', { name: '应用舒展密度', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('radio', { name: '舒展', exact: true })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: '对比效果', exact: true }).click()
  await dialog.getByRole('tab', { name: '装饰强度对比', exact: true }).click()
  await dialog.getByRole('button', { name: '应用突出装饰', exact: true }).click()
  await saved(page)
  const stored = await page.evaluate(async id => {
    // @ts-expect-error Vite serves the browser module.
    const { db } = await import('/src/lib/storage.ts')
    return db.articles.get(id)
  }, id)
  expect(stored.typography).toMatchObject({ readingDensity: 'relaxed', lineHeight: 2, paragraphSpace: 22, decoration: 'expressive', fontSize: 18, codeFontSize: 15 })
  expect(stored.document).toEqual(stored.sourceSnapshot)
})

test('manual spacing tweaks and reading style are included in personal presets', async ({ page }) => {
  await seed(page)
  await page.getByRole('radio', { name: '舒展', exact: true }).click()
  await page.getByLabel('装饰强度', { exact: true }).selectOption('simple')
  await page.getByRole('switch', { name: '相邻内容自动留白' }).click()
  await page.getByRole('tab', { name: '细节调整', exact: true }).click()
  await page.getByRole('slider', { name: '文字行高', exact: true }).fill('2.1')
  await expect(page.locator('.density-current')).toContainText('已微调')
  await page.getByRole('button', { name: /个人排版方案/ }).click()
  const dialog = page.getByRole('dialog', { name: '个人排版方案' })
  await dialog.getByLabel('方案名称', { exact: true }).fill('舒展简洁')
  await dialog.getByRole('button', { name: '保存为个人方案', exact: true }).click()
  await expect(dialog.locator('.preset-reading-summary')).toHaveText('舒展·已微调 / 简洁装饰 / 固定留白')
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await page.getByRole('radio', { name: '紧凑', exact: true }).click()
  await expect(page.getByRole('slider', { name: '文字行高', exact: true })).toHaveValue('1.65')
  await page.getByLabel('装饰强度', { exact: true }).selectOption('expressive')
  await page.getByRole('button', { name: /个人排版方案/ }).click()
  await dialog.getByRole('button', { name: '应用方案 舒展简洁', exact: true }).click()
  await expect(page.getByLabel('装饰强度', { exact: true })).toHaveValue('simple')
  await expect(page.getByRole('radio', { name: '舒展', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('switch', { name: '相邻内容自动留白' })).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByRole('slider', { name: '文字行高', exact: true })).toHaveValue('2.1')
})

test('old saved drafts open with safe defaults and preserve manual font sizes', async ({ page }) => {
  await seed(page, true)
  await expect(page.getByRole('radio', { name: '标准', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByLabel('装饰强度', { exact: true })).toHaveValue('balanced')
  await expect(page.getByRole('switch', { name: '相邻内容自动留白' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('.density-current')).toContainText('行高 2.2')
  await expect(page.locator('.density-current')).toContainText('已微调')
  await page.getByRole('tab', { name: '细节调整', exact: true }).click()
  await expect(page.getByRole('slider', { name: '正文字号', exact: true })).toHaveValue('18')
  await expect(page.getByRole('slider', { name: '代码字号', exact: true })).toHaveValue('15')
})

test('reading style controls and comparisons fit 390px and 320px screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seed(page)
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await page.getByRole('radio', { name: '紧凑', exact: true }).click()
    await page.getByLabel('装饰强度', { exact: true }).selectOption('simple')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: '对比效果', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await dialog.getByRole('tab', { name: '装饰强度对比', exact: true }).click()
    await dialog.getByRole('button', { name: '应用突出装饰', exact: true }).click()
    await page.getByRole('button', { name: '主题与样式', exact: true }).click()
    await expect(page.getByLabel('装饰强度', { exact: true })).toHaveValue('expressive')
  }
  await page.screenshot({ path: 'test-results/reading-style-mobile.png', animations: 'disabled' })
})
