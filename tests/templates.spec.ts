import { test, expect, type Page } from '@playwright/test'
import { codeLayoutSamples } from './fixtures'

const sample = `前言\n这篇文章记录一次完整的技术验证过程，保留环境准备、操作步骤、代码示例和观察结果，方便读者逐项复现并核对。\n一、环境准备\n前置条件：准备可用的测试设备与演示项目。\n注意：先核对配置，再执行文章中的步骤。\n二、执行验证\n目标：记录实际执行过程。\n\`\`\`java\n${codeLayoutSamples.java}\n\`\`\`\n观察：核对实际结果，不能预先认定验证成功。\n三、复盘\n说明：保留代码和截图对应关系。\n正文结尾。`

async function importSample(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '粘贴文章', exact: true }).click()
  await page.getByLabel('待导入文章').fill(sample)
  await page.getByRole('button', { name: '导入为新文章', exact: true }).click()
  await expect(page.getByTestId('beautified-article').locator('[data-callout-kind]')).toHaveCount(5)
}

test('three layouts preview the current article, preserve exact code and copy semantic cards', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await importSample(page)
  await page.getByRole('button', { name: '原文编辑', exact: true }).click()
  await page.getByRole('textbox', { name: '文章标题' }).fill('安全研究样例')
  await page.getByRole('button', { name: '排版样式', exact: true }).click()
  await page.getByRole('button', { name: '用当前文章对比模板', exact: true }).click()
  const gallery = page.getByRole('dialog')
  await expect(gallery.locator('.template-option')).toHaveCount(3)
  expect((await gallery.boundingBox())!.width).toBeGreaterThan(1050)
  for (const name of ['安全研究', '实战教程', '极简长文']) {
    const realPreview = gallery.getByLabel(`${name}当前文章预览`)
    await expect(realPreview).toContainText('安全研究样例')
    expect(await realPreview.locator('pre').textContent()).toBe(codeLayoutSamples.java)
  }
  await page.screenshot({ path: 'test-results/templates-comparison.png', animations: 'disabled' })
  await gallery.getByRole('button', { name: '应用安全研究', exact: true }).click()
  await expect(gallery).toHaveCount(0)
  const preview = page.getByTestId('beautified-article')
  await expect(preview.locator('[data-callout-kind]')).toHaveCount(5)
  const backgrounds: string[] = []
  for (const name of ['安全研究', '实战教程', '极简长文']) {
    await page.getByRole('button', { name: `主题：${name}`, exact: true }).click()
    expect(await preview.locator('pre').textContent()).toBe(codeLayoutSamples.java)
    backgrounds.push(await preview.locator('pre').evaluate(element => getComputedStyle(element.parentElement!).backgroundColor))
  }
  expect(new Set(backgrounds).size).toBe(3)
  await page.getByRole('button', { name: '复制到公众号', exact: true }).click()
  await expect(page.locator('.toast')).toContainText('已复制')
  const copied = await page.evaluate(async () => {
    const items = await navigator.clipboard.read()
    const html = await (await items[0].getType('text/html')).text()
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    const card = [...parsed.querySelectorAll('p')].find(node => node.textContent?.startsWith('注意：'))!
    return { code: parsed.querySelector('pre')?.textContent, card: card.parentElement!.style.borderLeft, metadata: parsed.querySelectorAll('script,[data-callout-kind],[data-block-index],[data-section-index]').length }
  })
  expect(copied.code).toBe(codeLayoutSamples.java)
  expect(copied.card).toContain('3px')
  expect(copied.metadata).toBe(0)
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: '主题：极简长文', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('manual card changes and removal survive beautification and reload', async ({ page }) => {
  await importSample(page)
  await page.getByRole('button', { name: '原文编辑', exact: true }).click()
  const editor = page.getByRole('textbox', { name: '文章正文' })
  await editor.locator('p').filter({ hasText: /^注意：/ }).click()
  await expect(page.getByLabel('提示卡片', { exact: true })).toHaveValue('warning')
  await page.getByLabel('提示卡片', { exact: true }).selectOption('none')
  await editor.locator('p').filter({ hasText: /^正文结尾。$/ }).click()
  await page.getByLabel('提示卡片', { exact: true }).selectOption('goal')
  await page.getByRole('button', { name: '一键美化', exact: true }).click()
  const preview = page.getByTestId('beautified-article')
  await expect(preview.locator('[data-callout-kind="warning"]')).toHaveCount(0)
  await expect(preview.locator('[data-callout-kind="goal"]').filter({ hasText: '正文结尾。' })).toHaveCount(1)
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
  await page.reload()
  await expect(editor.locator('p[data-callout="none"]')).toHaveText('注意：先核对配置，再执行文章中的步骤。')
  await expect(editor.locator('blockquote[data-callout="goal"]').filter({ hasText: '正文结尾。' })).toHaveCount(1)
})

test('layout inspection locates issues and can repair fragmented code without touching source snapshot', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('textbox', { name: '文章正文' }).waitFor()
  await page.evaluate(async java => {
    // @ts-expect-error Browser module served by Vite.
    const { newArticle } = await import('/src/lib/document.ts')
    // @ts-expect-error Browser module served by Vite.
    const { db } = await import('/src/lib/storage.ts')
    const text = (value: string) => ({ type: 'text', text: value })
    const article = newArticle('排版检查回归', { type: 'doc', content: [
      { type: 'heading', attrs: { level: 1 }, content: [text('主标题')] },
      { type: 'heading', attrs: { level: 3 }, content: [text('跳级章节')] },
      { type: 'paragraph', content: [text('这是一段需要拆分的长正文，保留原来的文字与标点。'.repeat(20))] },
      ...java.split('\n').map(line => ({ type: 'codeBlock', attrs: { language: 'java' }, content: [text(line)] })),
      { type: 'table', content: [{ type: 'tableRow', content: Array.from({ length: 4 }, () => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [text('表格内容')] }] })) }] },
      { type: 'image', attrs: { src: 'asset:missing', alt: '待重新添加的图片' } },
    ] })
    article.typography.tableMode = 'fit'
    await db.articles.put(article)
    localStorage.setItem('zijian-active', article.id)
  }, codeLayoutSamples.java)
  await page.reload()
  await expect(page.locator('.article-editor pre')).toHaveCount(4)
  await page.getByRole('button', { name: '排版检查', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('代码被拆成多个小框')
  await expect(dialog).toContainText('表格列数较多')
  await expect(dialog).toContainText('图片无法读取')
  await dialog.getByRole('button', { name: /标题层级有跳跃/ }).click()
  await expect(dialog).toHaveCount(0)
  expect(await page.evaluate(() => getSelection()?.anchorNode?.parentElement?.closest('h3')?.textContent)).toBe('跳级章节')
  await page.getByRole('button', { name: '排版检查', exact: true }).click()
  await dialog.getByRole('button', { name: '整理代码与长段落', exact: true }).click()
  await expect(page.getByTestId('beautified-article').locator('pre')).toHaveCount(1)
  expect(await page.getByTestId('beautified-article').locator('pre').textContent()).toBe(codeLayoutSamples.java)
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
  const originalCount = await page.evaluate(async () => {
    // @ts-expect-error Browser module served by Vite.
    const { db } = await import('/src/lib/storage.ts')
    const article = await db.articles.get(localStorage.getItem('zijian-active'))
    return article.sourceSnapshot.content.filter((node: any) => node.type === 'codeBlock').length
  })
  expect(originalCount).toBe(4)
})

test('mobile can compare and apply templates and open layout checks without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await importSample(page)
  await page.getByRole('button', { name: '主题与样式', exact: true }).click()
  await page.getByRole('button', { name: '用当前文章对比模板', exact: true }).click()
  await expect(page.getByRole('dialog').locator('.template-option')).toHaveCount(3)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: '应用极简长文', exact: true }).click()
  await expect(page.getByTestId('beautified-article')).toBeVisible()
  await page.getByRole('button', { name: '排版检查', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.screenshot({ path: 'test-results/layout-check-mobile.png', animations: 'disabled' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.setViewportSize({ width: 320, height: 740 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
