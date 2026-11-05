import { expect, test, type Page } from '@playwright/test'
import { pngBase64, wordFixture } from './fixtures'

const code = 'class Example {\n\tString value = "<script>原文</script>";\n\n}\n'
const opening = '你好，欢迎来到我的公众号。这里记录技术研究、实践经验和日常思考。'
const closing = '如果这篇文章对你有帮助，欢迎关注、收藏，也欢迎留言交流。'

async function seed(page: Page, withTemplates = false) {
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: '文章标题' })).toBeVisible()
  const result = await page.evaluate(async ({ code, withTemplates }) => {
    // @ts-expect-error Vite serves the browser module.
    const { db } = await import('/src/lib/storage.ts')
    // @ts-expect-error Vite serves the browser module.
    const { newArticle } = await import('/src/lib/document.ts')
    // @ts-expect-error Vite serves the browser module.
    const { contentTemplateExamples, saveContentTemplate } = await import('/src/lib/content-templates.ts')
    const article = newArticle('原有技术文章', { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: '原来的正文不会丢失。' }] },
      { type: 'codeBlock', attrs: { language: 'java', codeTitle: 'Example.java', codeWrap: 'scroll', highlightLines: '2' }, content: [{ type: 'text', text: code }] },
      { type: 'paragraph', content: [{ type: 'text', text: '文章结束。' }] },
    ] })
    article.themeId = 'research'
    await db.articles.put(article)
    localStorage.setItem('zijian-active', article.id)
    const templates = withTemplates ? await Promise.all(contentTemplateExamples.slice(0, 2).map((example: object) => saveContentTemplate(example))) : []
    return { id: article.id, templates }
  }, { code, withTemplates })
  await page.reload()
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue('原有技术文章')
  return result
}

async function openTemplates(page: Page) {
  const entry = page.getByRole('button', { name: /开头与文末模板/ })
  if (!await entry.isVisible()) {
    if ((page.viewportSize()?.width || 1512) <= 760) await page.getByRole('button', { name: '主题与样式', exact: true }).click()
    else await page.getByRole('button', { name: '排版样式', exact: true }).click()
  }
  await entry.click()
  const dialog = page.getByRole('dialog', { name: '开头与文末模板' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('saves a rich opening, previews it before insertion, skips duplicates and offers history recovery', async ({ page }) => {
  const { id } = await seed(page)
  let dialog = await openTemplates(page)
  await dialog.getByRole('button', { name: '作者开场', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: '模板内容', exact: true })).toContainText(opening)
  await dialog.getByRole('tab', { name: '插入效果预览', exact: true }).click()
  await expect(dialog.getByLabel('模板插入效果预览')).toContainText(opening)
  expect(await dialog.getByLabel('模板插入效果预览').locator('pre').textContent()).toBe(code)
  const before = await page.evaluate(async id => {
    // @ts-expect-error Vite serves the browser module.
    const { db } = await import('/src/lib/storage.ts')
    return db.articles.get(id)
  }, id)
  expect(JSON.stringify(before.document)).not.toContain(opening)
  await dialog.getByRole('button', { name: '保存并插入当前文章开头', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const preview = page.getByTestId('beautified-article')
  await expect(preview).toContainText(opening)
  expect(await preview.locator('pre').textContent()).toBe(code)
  dialog = await openTemplates(page)
  await dialog.getByRole('button', { name: '编辑模板 作者开场', exact: true }).click()
  await dialog.getByRole('button', { name: '插入当前文章开头', exact: true }).click()
  await expect(page.locator('.toast')).toContainText('已跳过重复添加')
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await expect(preview.getByText(opening, { exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: '历史版本', exact: true }).click()
  const history = page.getByRole('dialog', { name: '历史版本' })
  await history.getByRole('navigation').getByRole('button').filter({ hasText: '插入开头模板' }).click()
  await expect(history.getByLabel('历史版本预览')).not.toContainText(opening)
  await history.getByRole('button', { name: '恢复选中版本', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '文章正文' })).not.toContainText(opening)
  expect(await page.locator('.article-editor pre').textContent()).toBe(code)
  const restored = await page.evaluate(async id => {
    // @ts-expect-error Vite serves the browser module.
    const { db } = await import('/src/lib/storage.ts')
    return db.articles.get(id)
  }, id)
  expect(restored.sourceSnapshot).toEqual(before.sourceSnapshot)
})

test('automatic choices persist and apply to new, Word and pasted articles while undo keeps the templates', async ({ page }) => {
  const { templates } = await seed(page, true)
  const dialog = await openTemplates(page)
  await dialog.getByLabel('自动添加的开头模板', { exact: true }).selectOption(templates[0].id)
  await dialog.getByLabel('自动添加的文末模板', { exact: true }).selectOption(templates[1].id)
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('textbox', { name: '文章正文' })).not.toContainText(opening)
  await page.getByRole('button', { name: '新建文章', exact: true }).click()
  const editor = page.getByRole('textbox', { name: '文章正文' })
  await expect(editor).toContainText(opening)
  await expect(editor).toContainText(closing)
  await page.keyboard.insertText('新建正文写在这里。')
  await expect(editor.locator(':scope > p').nth(1)).toHaveText('新建正文写在这里。')
  await expect(editor.locator(':scope > p').first()).toHaveText(opening)
  await page.getByTestId('word-input').setInputFiles({ name: '自动模板导入.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await wordFixture() })
  const preview = page.getByTestId('beautified-article')
  await expect(preview).toContainText('这是中文正文，数字 123 与标点应完整保留。')
  await expect(preview.getByText(opening, { exact: true })).toHaveCount(1)
  await expect(preview.getByText(closing, { exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: '撤销美化', exact: true }).click()
  await expect(editor).toContainText(opening)
  await expect(editor).toContainText(closing)
  await page.getByRole('button', { name: '查看原稿', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toContainText(opening)
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await page.getByRole('button', { name: '粘贴文章', exact: true }).click()
  await page.getByRole('textbox', { name: '待导入文章', exact: true }).fill('粘贴的原始文章正文。')
  await page.getByRole('button', { name: '导入为新文章', exact: true }).click()
  await expect(preview).toContainText('粘贴的原始文章正文。')
  await expect(preview.getByText(opening, { exact: true })).toHaveCount(1)
  await expect(preview.getByText(closing, { exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: '一键美化', exact: true }).click()
  await expect(preview.getByText(opening, { exact: true })).toHaveCount(1)
})

test('template images and rich formatting survive copying, HTML export, reload and ZIP backup', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const { id } = await seed(page)
  const dialog = await openTemplates(page)
  await dialog.getByRole('button', { name: '关注与交流', exact: true }).click()
  await dialog.getByTestId('template-image-input').setInputFiles({ name: '二维码示例.png', mimeType: 'image/png', buffer: Buffer.from(pngBase64, 'base64') })
  await expect(dialog.locator('.asset-image img')).toHaveJSProperty('naturalWidth', 1)
  await dialog.getByLabel('图片说明', { exact: true }).fill('我的公众号二维码')
  await dialog.locator('.asset-image img').click()
  await dialog.getByLabel('图片宽度', { exact: true }).selectOption('33')
  await dialog.getByRole('button', { name: '保存并插入当前文章文末', exact: true }).click()
  const preview = page.getByTestId('beautified-article')
  await expect(preview.locator('img')).toHaveJSProperty('naturalWidth', 1)
  await expect(preview).toContainText('我的公众号二维码')
  await page.getByRole('button', { name: '复制到公众号', exact: true }).click()
  await expect(page.locator('.toast')).toContainText('已复制')
  const copied = await page.evaluate(async () => {
    const items = await navigator.clipboard.read()
    const parsed = new DOMParser().parseFromString(await (await items[0].getType('text/html')).text(), 'text/html')
    return { code: parsed.querySelector('pre')!.textContent, text: parsed.body.textContent, bold: parsed.querySelector('strong')!.textContent, images: parsed.querySelectorAll('img[src^="data:image/"]').length, width: parsed.querySelector('img')!.style.width, controls: parsed.querySelectorAll('script,button,input,select,[data-block-index]').length }
  })
  expect(copied).toMatchObject({ code, bold: '感谢阅读', images: 1, width: '33%', controls: 0 })
  expect(copied.text).toContain(closing)
  await page.getByRole('button', { name: '导出', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /下载 HTML 文件/ }).click()
  const exported = await (await download).path()
  const { readFile } = await import('node:fs/promises')
  expect(await readFile(exported!, 'utf8')).toContain('我的公众号二维码')
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
  await page.reload()
  const backup = await page.evaluate(async id => {
    // @ts-expect-error Vite serves the browser module.
    const { db } = await import('/src/lib/storage.ts')
    // @ts-expect-error Vite serves the browser module.
    const { createBackup, restoreBackup } = await import('/src/lib/backup.ts')
    const article = await db.articles.get(id)
    const restored = await restoreBackup(await createBackup([article]))
    const templates = await db.contentTemplates.toArray()
    const imageIds = templates.map((template: { document: { content: { type: string; attrs: { assetId: string } }[] } }) => template.document.content.find(node => node.type === 'image')!.attrs.assetId)
    return { templates: templates.length, uniqueImageIds: new Set(imageIds).size, texts: templates.map((template: object) => JSON.stringify(template)), restored: JSON.stringify(restored[0].document) }
  }, id)
  expect(backup.templates).toBe(2)
  expect(backup.uniqueImageIds).toBe(2)
  expect(backup.texts.every((text: string) => text.includes('我的公众号二维码'))).toBe(true)
  expect(backup.restored).toContain('我的公众号二维码')
})

test('editing or deleting a library template preserves already inserted articles and clears automatic defaults', async ({ page }) => {
  const { templates } = await seed(page, true)
  let dialog = await openTemplates(page)
  await dialog.getByRole('button', { name: '编辑模板 作者开场', exact: true }).click()
  await dialog.getByRole('button', { name: '插入当前文章开头', exact: true }).click()
  dialog = await openTemplates(page)
  await dialog.getByLabel('自动添加的开头模板', { exact: true }).selectOption(templates[0].id)
  await dialog.getByRole('button', { name: '编辑模板 作者开场', exact: true }).click()
  await dialog.getByRole('textbox', { name: '模板内容', exact: true }).fill('更新后的作者介绍。')
  await dialog.getByRole('button', { name: '保存模板', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '编辑模板 作者开场', exact: true })).toContainText('更新后的作者介绍。')
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await expect(page.getByTestId('beautified-article')).toContainText(opening)
  await expect(page.getByTestId('beautified-article')).not.toContainText('更新后的作者介绍。')
  dialog = await openTemplates(page)
  await dialog.getByRole('button', { name: '编辑模板 作者开场', exact: true }).click()
  await dialog.getByRole('button', { name: '删除当前模板', exact: true }).click()
  await dialog.getByRole('button', { name: '确认删除模板', exact: true }).click()
  await expect(dialog.getByLabel('自动添加的开头模板', { exact: true })).toHaveValue('')
  await expect(dialog.getByRole('button', { name: '编辑模板 作者开场', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await expect(page.getByTestId('beautified-article')).toContainText(opening)
})

test('multiline template cards remain one card through editing, insertion, copying and backup', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const { id } = await seed(page)
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves the browser module.
    const { saveContentTemplate } = await import('/src/lib/content-templates.ts')
    await saveContentTemplate({ name: '多行作者介绍', position: 'footer', document: { type: 'doc', content: [
      { type: 'paragraph', attrs: { callout: 'note' }, content: [{ type: 'text', text: '关于作者', marks: [{ type: 'bold' }] }] },
      { type: 'paragraph', attrs: { callout: 'note' }, content: [{ type: 'text', text: '访问我的主页', marks: [{ type: 'link', attrs: { href: 'https://example.com/' } }] }] },
      { type: 'paragraph' },
      { type: 'paragraph', attrs: { callout: 'note' }, content: [{ type: 'text', text: '欢迎留言交流。' }] },
    ] } })
  })
  let dialog = await openTemplates(page)
  await dialog.getByRole('button', { name: '编辑模板 多行作者介绍', exact: true }).click()
  const editor = dialog.getByRole('textbox', { name: '模板内容', exact: true })
  await editor.locator('p').filter({ hasText: '欢迎留言交流。' }).click()
  await page.keyboard.press('End')
  await dialog.getByTestId('template-image-input').setInputFiles({ name: '作者二维码.png', mimeType: 'image/png', buffer: Buffer.from(pngBase64, 'base64') })
  await expect(editor.locator('.asset-image img')).toHaveJSProperty('naturalWidth', 1)
  await editor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await expect(dialog.getByLabel('模板段落装饰', { exact: true })).toHaveValue('')
  await dialog.getByLabel('模板段落装饰', { exact: true }).selectOption('note')
  const group = editor.locator('blockquote[data-callout]')
  await expect(group).toHaveCount(1)
  await expect(group.locator('blockquote, p[data-callout]:not([data-callout="none"])')).toHaveCount(0)
  await expect(group.locator('strong')).toHaveText('关于作者')
  await expect(group.locator('a')).toHaveAttribute('href', 'https://example.com/')
  await expect(group.locator('img')).toHaveCount(1)
  const paragraphs = await group.locator(':scope > p').count()

  await dialog.getByRole('button', { name: '撤销模板编辑', exact: true }).click()
  await expect(editor.locator('blockquote[data-callout]')).toHaveCount(0)
  await expect(editor.locator('p[data-callout="note"]')).toHaveCount(3)
  await dialog.getByRole('button', { name: '重做模板编辑', exact: true }).click()
  await expect(group).toHaveCount(1)
  await group.locator('p').filter({ hasText: '欢迎留言交流。' }).click()
  await page.keyboard.press('End')
  await expect.poll(() => editor.evaluate(element => {
    const selection = (element as any).editor.state.selection
    return { text: selection.$from.parent.textContent, offset: selection.$from.parentOffset }
  })).toEqual({ text: '欢迎留言交流。', offset: '欢迎留言交流。'.length })
  await page.keyboard.press('Enter')
  await expect(group.locator(':scope > p')).toHaveCount(paragraphs + 1)
  await page.keyboard.type('New paragraph in the same card.')
  await expect(group).toContainText('New paragraph in the same card.')
  await expect(group).toHaveCount(1)
  await dialog.getByLabel('模板段落装饰', { exact: true }).selectOption('warning')
  await expect(group).toHaveAttribute('data-callout', 'warning')
  await expect(group.locator('blockquote')).toHaveCount(0)
  await dialog.getByLabel('模板段落装饰', { exact: true }).selectOption('none')
  await expect(group).toHaveCount(0)
  await expect(editor).toContainText('New paragraph in the same card.')
  await expect(editor.locator('img')).toHaveCount(1)
  await editor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await dialog.getByLabel('模板段落装饰', { exact: true }).selectOption('tip')
  await expect(group).toHaveCount(1)
  await dialog.getByRole('tab', { name: '插入效果预览', exact: true }).click()
  await expect(dialog.getByLabel('模板插入效果预览').locator('[data-callout-kind]')).toHaveCount(1)
  await expect(dialog.getByLabel('模板插入效果预览').locator('[data-callout-kind] img')).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('multiline-template-card.png'), animations: 'disabled' })
  await dialog.getByRole('button', { name: '保存并插入当前文章文末', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const preview = page.getByTestId('beautified-article')
  await expect(preview.locator('[data-callout-kind]')).toHaveCount(1)
  await expect(preview.locator('[data-callout-kind]')).toContainText('New paragraph in the same card.')
  expect(await preview.locator('pre').textContent()).toBe(code)
  await page.getByRole('button', { name: '复制到公众号', exact: true }).click()
  const copied = await page.evaluate(async () => {
    const items = await navigator.clipboard.read()
    const parsed = new DOMParser().parseFromString(await (await items[0].getType('text/html')).text(), 'text/html')
    const heading = [...parsed.querySelectorAll('strong')].find(node => node.textContent === '关于作者')!
    const card = heading.closest('section')!
    return { lines: card.querySelectorAll(':scope > p').length, nestedCards: card.querySelectorAll('section[style*="border-left"]').length, images: card.querySelectorAll('img[src^="data:image/"]').length, href: card.querySelector('a')?.getAttribute('href'), text: card.textContent }
  })
  expect(copied.lines).toBeGreaterThanOrEqual(5)
  expect(copied.nestedCards).toBe(0)
  expect(copied.images).toBe(1)
  expect(copied.href).toBe('https://example.com/')
  expect(copied.text).toContain('New paragraph in the same card.')
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('textbox', { name: '文章正文' }).locator('blockquote[data-callout="tip"]')).toHaveCount(1)
  const restored = await page.evaluate(async id => {
    // @ts-expect-error Vite serves the browser module.
    const { db } = await import('/src/lib/storage.ts')
    // @ts-expect-error Vite serves the browser module.
    const { createBackup, restoreBackup } = await import('/src/lib/backup.ts')
    const article = await db.articles.get(id)
    const [copy] = await restoreBackup(await createBackup([article]))
    const templates = await db.contentTemplates.toArray()
    const normalize = (node: any): any => ({ ...node, ...(node.type === 'image' ? { attrs: { ...node.attrs, assetId: null, src: 'https://example.test/image.png' } } : {}), ...(node.content ? { content: node.content.map(normalize) } : {}) })
    const schema = (document.querySelector('[aria-label="文章正文"]') as any).editor.schema
    return { sameArticle: schema.nodeFromJSON(normalize(copy.document)).eq(schema.nodeFromJSON(normalize(article.document))), cards: templates.map((template: any) => template.document.content.filter((node: any) => node.type === 'blockquote' && node.attrs.callout === 'tip').length) }
  }, id)
  expect(restored.sameArticle).toBe(true)
  expect(restored.cards).toEqual([1, 1])
  dialog = await openTemplates(page)
  await dialog.getByRole('button', { name: '编辑模板 多行作者介绍', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: '模板内容', exact: true }).locator('blockquote[data-callout="tip"]')).toHaveCount(1)
})

test('template controls, preview and automatic selections work at 390px and 320px widths', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { templates } = await seed(page, true)
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    const dialog = await openTemplates(page)
    await dialog.getByLabel('自动添加的文末模板', { exact: true }).selectOption(templates[1].id)
    await dialog.getByRole('button', { name: '编辑模板 关注与交流', exact: true }).click()
    await dialog.getByRole('tab', { name: '插入效果预览', exact: true }).click()
    await expect(dialog.getByLabel('模板插入效果预览')).toContainText(closing)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await dialog.getByRole('tab', { name: '编辑内容', exact: true }).click()
    await dialog.getByRole('textbox', { name: '模板内容', exact: true }).click()
    await page.screenshot({ path: `test-results/content-templates-${width}.png`, animations: 'disabled' })
    await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  }
})
