import { expect, test, type Page } from '@playwright/test'

const code = 'class Example {\n    String value = "保持完整";\n}\n'

async function seed(page: Page, inspection = false) {
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: '文章标题' })).toBeVisible()
  const id = await page.evaluate(async ({ code, inspection }) => {
    // @ts-expect-error Vite serves this browser module.
    const { db } = await import('/src/lib/storage.ts')
    // @ts-expect-error Vite serves this browser module.
    const { newArticle } = await import('/src/lib/document.ts')
    const assetId = crypto.randomUUID()
    const blob = await (await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=')).blob()
    await db.assets.put({ id: assetId, name: '历史原图.png', mime: 'image/png', blob, createdAt: Date.now() })
    const article = newArticle(inspection ? '检查分级样例' : '版本一', { type: 'doc', content: inspection ? [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '主标题' }] },
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '跳级标题' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '一段较长的文字保留完整，不自动改变原有内容。'.repeat(18) }] },
      { type: 'image', attrs: { assetId, src: `asset:${assetId}` } },
      { type: 'codeBlock', attrs: { language: 'text' }, content: [{ type: 'text', text: '明确选择的纯文本' }] },
      { type: 'image', attrs: { assetId: 'missing', src: 'asset:missing' } },
    ] : [
      { type: 'codeBlock', attrs: { language: 'java', codeTitle: '原始 Java 示例', codeWrap: 'scroll', highlightLines: '2' }, content: [{ type: 'text', text: code }] },
      { type: 'image', attrs: { assetId, src: `asset:${assetId}`, title: '原图说明', displayWidth: 75, imageFrame: 'border' } },
      { type: 'paragraph', content: [{ type: 'text', text: '初始正文。' }] },
    ] })
    article.themeId = 'research'
    article.typography.fontSize = 18
    article.typography.lineHeight = 2
    article.typography.codeFontSize = 15
    await db.articles.clear()
    await db.articles.put(article)
    localStorage.setItem('zijian-active', article.id)
    return article.id
  }, { code, inspection })
  await page.reload()
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue(inspection ? '检查分级样例' : '版本一')
  return id
}

async function openPresets(page: Page) {
  const entry = page.getByRole('button', { name: '个人排版方案', exact: false })
  if (!await entry.isVisible()) {
    if ((page.viewportSize()?.width || 1512) <= 760) await page.getByRole('button', { name: '主题与样式', exact: true }).click()
    else await page.getByRole('button', { name: '排版样式', exact: true }).click()
  }
  await entry.click()
  await expect(page.getByRole('dialog', { name: '个人排版方案' })).toBeVisible()
}

test('history survives reload, restores exact code and images, and allows returning to the state before restoration', async ({ page }) => {
  const id = await seed(page)
  await page.getByRole('button', { name: '历史版本', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '历史版本' })
  await dialog.getByRole('button', { name: '保存当前版本', exact: true }).click()
  await expect(dialog.getByRole('navigation').getByRole('button').first()).toContainText('手动保存')
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await page.getByRole('textbox', { name: '文章标题' }).fill('版本二')
  await page.locator('.article-editor p').last().click()
  await page.keyboard.press('End')
  await page.keyboard.insertText('后来增加的文字。')
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '历史版本', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '历史版本' })
  await dialog.getByRole('navigation').getByRole('button').filter({ hasText: '手动保存' }).click()
  const snapshot = dialog.getByLabel('历史版本预览')
  await expect(snapshot).toContainText('版本一')
  expect(await snapshot.locator('pre').textContent()).toBe(code)
  await expect(snapshot.locator('img')).toHaveJSProperty('complete', true)
  await expect(snapshot.locator('img')).toHaveJSProperty('naturalWidth', 1)
  await page.screenshot({ path: 'test-results/history-version-preview.png', animations: 'disabled' })
  await dialog.getByRole('button', { name: '恢复选中版本', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue('版本一')
  await expect(page.locator('.article-editor')).not.toContainText('后来增加的文字。')
  expect(await page.locator('.article-editor pre').textContent()).toBe(code)
  await page.getByRole('button', { name: '历史版本', exact: true }).click()
  await dialog.getByRole('navigation').getByRole('button').filter({ hasText: '恢复历史版本前' }).click()
  await expect(snapshot).toContainText('后来增加的文字。')
  await dialog.getByRole('button', { name: '恢复选中版本', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue('版本二')
  const restored = await page.evaluate(async id => {
    // @ts-expect-error Vite serves this browser module.
    const { db } = await import('/src/lib/storage.ts')
    return db.articles.get(id)
  }, id)
  expect(restored.document.content[0].attrs).toMatchObject({ language: 'java', codeTitle: '原始 Java 示例', codeWrap: 'scroll', highlightLines: '2' })
  expect(JSON.stringify(restored.sourceSnapshot)).not.toContain('后来增加的文字。')
  await page.screenshot({ path: 'test-results/history-restored.png', animations: 'disabled' })
})

test('deleting the last draft keeps a working editor and a recoverable article after reload', async ({ page }) => {
  const id = await seed(page)
  await page.getByRole('button', { name: /我的草稿/ }).click()
  await page.getByRole('button', { name: '删除草稿 版本一', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('会移入回收站')
  await page.getByRole('button', { name: '删除草稿', exact: true }).click()
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue('未命名文章')
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: /我的草稿/ }).click()
  await page.getByRole('button', { name: '回收站', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '回收站' })).toContainText('版本一')
  await page.screenshot({ path: 'test-results/recycle-bin.png', animations: 'disabled' })
  await page.getByRole('button', { name: '恢复草稿', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue('版本一')
  expect(await page.locator('.article-editor pre').textContent()).toBe(code)
  await expect(page.locator('.article-editor img')).toHaveJSProperty('naturalWidth', 1)
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
  await page.reload()
  expect(await page.evaluate(() => localStorage.getItem('zijian-active'))).toBe(id)
  await page.getByRole('button', { name: '历史版本', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('navigation').getByRole('button')).not.toHaveCount(0)
})

test('personal schemes persist, apply exact styles, and insert the fixed footer only when selected without duplicates', async ({ page }) => {
  await seed(page)
  await openPresets(page)
  let dialog = page.getByRole('dialog', { name: '个人排版方案' })
  await dialog.getByLabel('方案名称', { exact: true }).fill('漏洞分析')
  await dialog.getByLabel('固定文末', { exact: true }).fill('作者介绍\n感谢阅读，欢迎交流。')
  await dialog.getByRole('button', { name: '保存为个人方案', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '应用方案 漏洞分析', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await page.getByRole('button', { name: '主题：极简长文', exact: true }).click()
  await page.getByRole('tab', { name: '细节调整' }).click()
  await page.getByLabel('正文字号', { exact: true }).fill('14')
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
  await page.reload()
  await openPresets(page)
  dialog = page.getByRole('dialog', { name: '个人排版方案' })
  await expect(dialog.getByLabel('应用“漏洞分析”时插入文末')).not.toBeChecked()
  await dialog.getByRole('button', { name: '应用方案 漏洞分析', exact: true }).click()
  const preview = page.getByTestId('beautified-article')
  await expect(preview).toBeVisible()
  await expect(preview).not.toContainText('感谢阅读，欢迎交流。')
  expect(await preview.locator('pre').textContent()).toBe(code)
  await expect(preview.locator('p').filter({ hasText: '初始正文。' })).toHaveCSS('font-size', '18px')
  await openPresets(page)
  await dialog.getByLabel('应用“漏洞分析”时插入文末').check()
  await dialog.getByRole('button', { name: '应用方案 漏洞分析', exact: true }).click()
  await expect(preview.getByText('感谢阅读，欢迎交流。', { exact: true })).toHaveCount(1)
  await openPresets(page)
  await dialog.getByLabel('应用“漏洞分析”时插入文末').check()
  await dialog.getByRole('button', { name: '应用方案 漏洞分析', exact: true }).click()
  await expect(preview.getByText('感谢阅读，欢迎交流。', { exact: true })).toHaveCount(1)
  expect(await preview.locator('pre').textContent()).toBe(code)
  await openPresets(page)
  await page.screenshot({ path: 'test-results/personal-presets.png', animations: 'disabled' })
})

test('layout checks separate required issues, persist ignored suggestions and offer restoring reminders', async ({ page }) => {
  await seed(page, true)
  await page.getByRole('button', { name: '排版检查', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('需要处理的排版问题')).toContainText('图片无法读取')
  await expect(dialog.getByLabel('可选的美观建议')).toContainText('图片还没有说明')
  await expect(dialog).not.toContainText('代码语言尚未明确')
  await dialog.getByRole('button', { name: '忽略建议：这一段较长', exact: true }).click()
  await expect(dialog.getByLabel('可选的美观建议')).not.toContainText('这一段较长')
  await dialog.getByRole('button', { name: '忽略建议：图片还没有说明', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '已忽略 2 条建议 · 查看', exact: true })).toBeVisible()
  await expect(dialog.getByLabel('需要处理的排版问题').getByRole('button', { name: /忽略/ })).toHaveCount(0)
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '排版检查', exact: true }).click()
  dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: '已忽略 2 条建议 · 查看', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '已忽略 2 条建议 · 查看', exact: true }).click()
  await dialog.getByRole('button', { name: '恢复提醒：这一段较长', exact: true }).click()
  await expect(dialog.getByLabel('可选的美观建议')).toContainText('这一段较长')
  await page.screenshot({ path: 'test-results/graded-layout-check.png', animations: 'disabled' })
})

test('recycle bin requires an inline confirmation for permanent deletion and keeps the active draft', async ({ page }) => {
  await seed(page)
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves this browser module.
    const { db, moveToTrash } = await import('/src/lib/storage.ts')
    // @ts-expect-error Vite serves this browser module.
    const { newArticle } = await import('/src/lib/document.ts')
    const article = newArticle('可以彻底删除的草稿')
    await db.articles.put(article)
    await moveToTrash(article.id)
  })
  await page.getByRole('button', { name: /我的草稿/ }).click()
  await page.getByRole('button', { name: '回收站', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '彻底删除 可以彻底删除的草稿', exact: true }).click()
  const confirmation = dialog.getByRole('group', { name: '确认彻底删除草稿' })
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: '取消', exact: true }).click()
  await expect(dialog).toContainText('可以彻底删除的草稿')
  await dialog.getByRole('button', { name: '彻底删除 可以彻底删除的草稿', exact: true }).click()
  await confirmation.getByRole('button', { name: '确认彻底删除', exact: true }).click()
  await expect(dialog).toContainText('回收站是空的')
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue('版本一')
})

test('history, personal styles and graded checks fit narrow mobile screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seed(page)
  await page.getByRole('button', { name: '历史版本', exact: true }).click()
  await page.getByRole('button', { name: '保存当前版本', exact: true }).click()
  await expect(page.getByLabel('历史版本预览')).toBeVisible()
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  }
  await page.screenshot({ path: 'test-results/history-mobile.png', animations: 'disabled' })
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await openPresets(page)
  await page.getByLabel('方案名称', { exact: true }).fill('手机阅读方案')
  await page.getByRole('button', { name: '保存为个人方案', exact: true }).click()
  await expect(page.getByRole('button', { name: '应用方案 手机阅读方案', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/personal-presets-mobile.png', animations: 'disabled' })
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await page.getByRole('button', { name: '正文编辑', exact: true }).click()
  await page.getByRole('button', { name: '排版检查', exact: true }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
})
