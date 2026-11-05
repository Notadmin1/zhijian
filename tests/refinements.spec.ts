import { expect, test, type Page } from '@playwright/test'
import { pngBase64 } from './fixtures'

const firstCode = '/* 第一行注释\n第二行注释 */\n\tString route = "scheme://?value=test";\n\nstartActivity(intent);'
const secondCode = 'adb shell am start -n sample/.Main --es route "scheme://?' + 'value=test&'.repeat(12) + 'end=1"'

async function seed(page: Page) {
  await page.goto('/')
  await page.getByRole('textbox', { name: '文章正文' }).waitFor()
  await page.evaluate(async ({ firstCode, secondCode, pngBase64 }) => {
    // @ts-expect-error Browser module served by Vite.
    const { newArticle } = await import('/src/lib/document.ts')
    // @ts-expect-error Browser module served by Vite.
    const { db, addAsset } = await import('/src/lib/storage.ts')
    const asset = await addAsset(await (await fetch(`data:image/png;base64,${pngBase64}`)).blob(), '原图.png')
    const article = newArticle('局部排版验证', { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: '文章介绍与原文保持完整。' }] },
      { type: 'codeBlock', attrs: { language: 'java' }, content: [{ type: 'text', text: firstCode }] },
      { type: 'codeBlock', attrs: { language: 'bash' }, content: [{ type: 'text', text: secondCode }] },
      { type: 'image', attrs: { assetId: asset.id, src: `asset:${asset.id}`, title: '原图说明', alt: '原图' } },
      { type: 'paragraph', content: [{ type: 'text', text: '文章结尾。' }] },
    ] })
    article.themeId = 'research'
    await db.articles.put(article)
    localStorage.setItem('zijian-active', article.id)
  }, { firstCode, secondCode, pngBase64 })
  await page.reload()
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue('局部排版验证')
}

async function clipboard(page: Page) {
  await page.getByRole('button', { name: '复制到公众号', exact: true }).click()
  await expect(page.locator('.toast')).toContainText('已复制')
  return page.evaluate(async () => {
    const items = await navigator.clipboard.read()
    const html = await (await items[0].getType('text/html')).text()
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    return {
      codes: [...parsed.querySelectorAll('pre')].map(element => ({ text: element.textContent, wrap: element.style.whiteSpace, heading: element.previousElementSibling?.textContent, highlights: [...element.querySelectorAll('span')].filter(span => span.style.background).map(span => span.textContent) })),
      images: [...parsed.querySelectorAll('img')].map(element => ({ src: element.getAttribute('src'), width: element.style.width, margin: element.style.margin, border: element.style.border })),
      controls: parsed.querySelectorAll('button,input,select,script,[data-code-wrap],[data-image-width]').length,
    }
  })
}

test('each snippet has independent wrap, caption and emphasized lines through copying, beautifying and reload', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await seed(page)
  const editor = page.getByRole('textbox', { name: '文章正文' })
  await editor.locator('pre').first().click()
  await page.getByLabel('代码文件名或说明').fill('MainActivity.java')
  await page.getByLabel('当前代码块换行').selectOption('wrap')
  await page.getByLabel('代码强调行', { exact: true }).fill('2,3')
  await page.getByRole('button', { name: '应用', exact: true }).click()
  await editor.locator('pre').nth(1).click()
  await page.getByLabel('当前代码块换行').selectOption('scroll')
  await page.getByLabel('代码文件名或说明').fill('命令示例')
  await expect(page.getByLabel('代码强调行', { exact: true })).toHaveValue('')
  expect(await editor.locator('pre').allTextContents()).toEqual([firstCode, secondCode])
  await page.getByRole('button', { name: '一键美化', exact: true }).click()
  const code = page.getByTestId('beautified-article').locator('pre')
  await expect(code.first()).toHaveCSS('white-space', 'pre-wrap')
  await expect(code.nth(1)).toHaveCSS('white-space', 'pre')
  const copied = await clipboard(page)
  expect(copied.codes.map(block => block.text)).toEqual([firstCode, secondCode])
  expect(copied.codes[0].heading).toContain('MainActivity.java')
  expect(copied.codes[0].highlights).toEqual(['第二行注释 */', '\tString route = "scheme://?value=test";'])
  expect(copied.codes.map(block => block.wrap)).toEqual(['pre-wrap', 'pre'])
  expect(copied.controls).toBe(0)
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
  await page.reload()
  await editor.locator('pre').first().click()
  await expect(page.getByLabel('代码文件名或说明')).toHaveValue('MainActivity.java')
  await expect(page.getByLabel('代码强调行', { exact: true })).toHaveValue('2,3')
  await page.getByRole('button', { name: '恢复整篇设置', exact: true }).click()
  await expect(page.getByLabel('当前代码块换行')).toHaveValue('')
  await expect(page.getByLabel('代码文件名或说明')).toHaveValue('')
  expect(await editor.locator('pre').allTextContents()).toEqual([firstCode, secondCode])
})

test('images retain captions and presentation when replaced, support zoom, undo and copying', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await seed(page)
  const image = page.locator('.asset-image > img')
  await image.click()
  await page.getByLabel('图片宽度', { exact: true }).selectOption('50')
  await page.getByLabel('图片对齐', { exact: true }).selectOption('left')
  await page.getByLabel('图片装饰', { exact: true }).selectOption('border')
  const oldSource = await image.getAttribute('src')
  const replacement = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 60
    const context = canvas.getContext('2d')!; context.fillStyle = '#416c58'; context.fillRect(0, 0, 80, 60)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await page.getByTestId('replace-image-input').setInputFiles({ name: '替换截图.png', mimeType: 'image/png', buffer: Buffer.from(replacement, 'base64') })
  await expect(image).toHaveAttribute('alt', '替换截图.png')
  await expect(image).not.toHaveAttribute('src', oldSource!)
  await expect(page.getByLabel('图片说明', { exact: true })).toHaveValue('原图说明')
  await expect(page.getByLabel('图片宽度', { exact: true })).toHaveValue('50')
  await page.getByRole('button', { name: '查看大图', exact: true }).click()
  await expect(page.getByRole('dialog').locator('img')).toHaveAttribute('alt', '替换截图.png')
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  const copied = await clipboard(page)
  expect(copied.images[0]).toMatchObject({ width: '50%', margin: '0px auto 0px 0px', src: `data:image/png;base64,${replacement}` })
  expect(copied.images[0].border).toContain('1px')
  expect(copied.controls).toBe(0)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(image).toHaveAttribute('alt', '原图')
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect(image).toHaveAttribute('alt', '替换截图.png')
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
  await page.reload()
  await image.click()
  await expect(page.getByLabel('图片宽度', { exact: true })).toHaveValue('50')
  await expect(page.getByLabel('图片对齐', { exact: true })).toHaveValue('left')
  await expect(page.getByLabel('图片说明', { exact: true })).toHaveValue('原图说明')
})

test('table dimensions, row and column tools, merge and split work without restoring a manually removed header', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新建文章', exact: true }).click()
  const editor = page.getByRole('textbox', { name: '文章正文' })
  await editor.click()
  await page.getByRole('button', { name: '插入表格', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('表格行数').fill('2')
  await dialog.getByLabel('表格列数').fill('2')
  await dialog.getByRole('button', { name: '插入表格', exact: true }).click()
  const table = editor.locator('table')
  await expect(table.locator('tr')).toHaveCount(2)
  await expect(table.locator('th')).toHaveCount(2)
  await table.locator('th').first().click()
  await page.keyboard.insertText('名称')
  await page.getByRole('button', { name: '下方插行', exact: true }).click()
  await expect(table.locator('tr')).toHaveCount(3)
  await table.locator('tr').nth(1).locator('th,td').first().click()
  await page.getByRole('button', { name: '删除当前行', exact: true }).click()
  await expect(table.locator('tr')).toHaveCount(2)
  await page.getByRole('button', { name: '右侧插列', exact: true }).click()
  await expect(table.locator('tr').first().locator('th,td')).toHaveCount(3)
  await table.locator('tr').first().locator('th,td').nth(1).click()
  await page.getByRole('button', { name: '删除当前列', exact: true }).click()
  await expect(table.locator('tr').first().locator('th,td')).toHaveCount(2)
  await page.getByRole('button', { name: '切换表头', exact: true }).click()
  await expect(table.locator('th')).toHaveCount(0)
  const cells = table.locator('tr').last().locator('td')
  await cells.nth(0).click(); await page.keyboard.insertText('值 A')
  await cells.nth(1).click(); await page.keyboard.insertText('值 B')
  const left = (await cells.nth(0).boundingBox())!
  const right = (await cells.nth(1).boundingBox())!
  await page.mouse.move(left.x + 8, left.y + left.height / 2)
  await page.mouse.down()
  await page.mouse.move(right.x + right.width / 2, right.y + right.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByRole('button', { name: '合并单元格', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '合并单元格', exact: true }).click()
  await expect(table.locator('td[colspan="2"]')).toHaveCount(1)
  await page.getByRole('button', { name: '拆分单元格', exact: true }).click()
  await expect(table.locator('td[colspan="2"]')).toHaveCount(0)
  await expect(table).toContainText('值 A')
  await expect(table).toContainText('值 B')
  await page.getByRole('button', { name: '一键美化', exact: true }).click()
  await expect(page.getByTestId('beautified-article').locator('th')).toHaveCount(0)
  await expect(page.getByTestId('beautified-article').locator('table')).toContainText('名称')
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
  await page.reload()
  await expect(editor.locator('table th')).toHaveCount(0)
  await expect(editor.locator('table')).toContainText('值 B')
})

test('compact layout exposes more body, resizes the preview and remembers hiding it', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await seed(page)
  expect((await page.locator('.workspace').boundingBox())!.height).toBeGreaterThan(565)
  const handle = page.getByRole('separator', { name: '调整预览宽度' })
  await handle.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(handle).toHaveAttribute('aria-valuenow', '370')
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down(); await page.mouse.move(box.x - 35, box.y + box.height / 2, { steps: 5 }); await page.mouse.up()
  expect(Number(await handle.getAttribute('aria-valuenow'))).toBeGreaterThan(390)
  await page.getByRole('button', { name: '收起手机预览', exact: true }).click()
  await expect(page.locator('.preview-panel')).not.toBeVisible()
  await page.reload()
  await expect(page.locator('.preview-panel')).not.toBeVisible()
  await page.getByRole('button', { name: '显示手机预览', exact: true }).click()
  await expect(page.locator('.preview-panel')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/refined-workspace.png', animations: 'disabled' })
})

test('inserting a table from the middle of code preserves the complete snippet and supports undo', async ({ page }) => {
  await seed(page)
  const editor = page.getByRole('textbox', { name: '文章正文' })
  await editor.locator('pre').first().click()
  await page.keyboard.press('Control+Home')
  await editor.locator('pre').first().click()
  await page.keyboard.press('Home')
  await page.getByRole('button', { name: '插入表格', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '插入表格', exact: true }).click()
  expect(await editor.locator('pre').allTextContents()).toEqual([firstCode, secondCode])
  await expect(editor.locator('pre + .tableWrapper, pre + table')).toHaveCount(1)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(editor.locator('table')).toHaveCount(0)
  expect(await editor.locator('pre').allTextContents()).toEqual([firstCode, secondCode])
})

test('code, image and table controls remain usable at narrow phone widths', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seed(page)
  const editor = page.getByRole('textbox', { name: '文章正文' })
  await editor.locator('pre').first().click()
  await page.getByLabel('代码文件名或说明').fill('Main.java')
  await page.getByLabel('代码强调行', { exact: true }).fill('3-1')
  await expect(page.getByRole('button', { name: '应用', exact: true })).toBeDisabled()
  await expect(page.getByRole('alert')).toContainText('填写行号或范围')
  await page.getByLabel('代码强调行', { exact: true }).fill('1-3')
  await page.getByRole('button', { name: '应用', exact: true }).click()
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await page.locator('.code-block-tools').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    const previewButton = (await page.getByRole('button', { name: '阅读预览', exact: true }).boundingBox())!
    expect(previewButton.x + previewButton.width).toBeLessThanOrEqual(width)
  }
  await page.locator('.asset-image > img').click()
  await page.getByLabel('图片宽度', { exact: true }).selectOption('75')
  await page.getByRole('button', { name: '查看大图', exact: true }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await editor.locator('p').last().click()
  await page.getByRole('button', { name: '插入表格', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '插入表格', exact: true }).click()
  await expect(page.getByLabel('当前表格操作', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/refined-mobile-tools.png', animations: 'disabled' })
})
