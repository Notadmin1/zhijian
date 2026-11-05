import { test, expect } from '@playwright/test'
import { codeLayoutSamples, codeWordFixture } from './fixtures'

async function seedCodeArticle(page: import('@playwright/test').Page, type: 'paragraph' | 'codeBlock') {
  await page.goto('/')
  await page.getByRole('textbox', { name: '文章正文' }).waitFor()
  const code = codeLayoutSamples.java.replace('intent.putExtra', '\tintent.putExtra').replace('\nstartActivity', '\n\nstartActivity')
  await page.evaluate(async ({ code, type }) => {
    // @ts-expect-error Browser module served by Vite.
    const { newArticle } = await import('/src/lib/document.ts')
    // @ts-expect-error Browser module served by Vite.
    const { db } = await import('/src/lib/storage.ts')
    const article = newArticle('第三方 POC App 排版回归', { type: 'doc', content: [
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '第三方 POC App（模拟应用）' }] },
      ...code.split('\n').map(text => ({ type: text ? type : 'paragraph', ...(type === 'codeBlock' && text ? { attrs: { language: 'java' } } : {}), ...(text ? { content: [{ type: 'text', text }] } : {}) })),
      { type: 'paragraph', content: [{ type: 'text', text: '示例之后的说明保持原样。' }] },
    ] })
    await db.articles.put(article)
    localStorage.setItem('zijian-active', article.id)
  }, { code, type })
  await page.reload()
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue('第三方 POC App 排版回归')
  return code
}

test('selecting several code paragraphs creates one code block, supports undo, and keeps surrounding prose', async ({ page }) => {
  const code = await seedCodeArticle(page, 'paragraph')
  const editor = page.getByRole('textbox', { name: '文章正文' })
  await editor.evaluate((element, count) => {
    element.focus()
    const paragraphs = element.querySelectorAll(':scope > p')
    const range = document.createRange()
    range.setStart(paragraphs[0], 0)
    range.setEnd(paragraphs[count - 1], paragraphs[count - 1].childNodes.length)
    const selection = getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  }, code.split('\n').length)
  await page.getByRole('button', { name: '代码块', exact: true }).click()
  await expect(editor.locator('pre')).toHaveCount(1)
  expect(await editor.locator('pre').textContent()).toBe(code)
  await expect(editor.locator('h3')).toHaveText('第三方 POC App（模拟应用）')
  await expect(editor.locator('p').last()).toHaveText('示例之后的说明保持原样。')
  await expect(page.getByLabel('代码语言', { exact: true })).toHaveValue('java')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(editor.locator('pre')).toHaveCount(0)
  await expect(editor.locator('p')).toHaveCount(code.split('\n').length + 1)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  expect(await editor.locator('pre').textContent()).toBe(code)
  await page.getByRole('button', { name: '美化效果', exact: true }).click()
  await expect(page.getByTestId('beautified-article').locator('pre')).toHaveCount(1)
  expect(await page.getByTestId('beautified-article').locator('pre').textContent()).toBe(code)
})

test('beautifying an old draft merges line cards into one Java snippet and copying keeps all lines', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const code = await seedCodeArticle(page, 'codeBlock')
  const editor = page.getByRole('textbox', { name: '文章正文' })
  await expect(editor.locator('pre')).toHaveCount(4)
  await page.getByRole('button', { name: '一键美化', exact: true }).click()
  const preview = page.getByTestId('beautified-article')
  await expect(preview.locator('pre')).toHaveCount(1)
  expect(await preview.locator('pre').textContent()).toBe(code)
  await expect(preview).toContainText('JAVA')
  await page.getByRole('button', { name: '复制到公众号', exact: true }).click()
  await expect(page.locator('.toast')).toContainText('已复制')
  const copied = await page.evaluate(async () => {
    const items = await navigator.clipboard.read()
    const html = await (await items[0].getType('text/html')).text()
    return [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('pre')].map(node => node.textContent)
  })
  expect(copied).toEqual([code])
  await page.getByRole('button', { name: '撤销美化', exact: true }).click()
  await expect(editor.locator('pre')).toHaveCount(4)
  await page.getByRole('button', { name: '一键美化', exact: true }).click()
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
  await page.reload()
  await expect(editor.locator('pre')).toHaveCount(1)
  expect(await editor.locator('pre').textContent()).toBe(code)
})

test('Word keeps exact code whitespace, languages and table inline code through copy, export and reload', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  await page.getByTestId('word-input').setInputFiles({ name: '代码排版.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await codeWordFixture() })
  const preview = page.getByTestId('beautified-article')
  await expect(preview.locator('pre')).toHaveCount(3)
  expect(await preview.locator('pre').allTextContents()).toEqual(Object.values(codeLayoutSamples))
  await expect(preview.locator('table pre, table section')).toHaveCount(0)
  await expect(preview.locator('table code').first()).toHaveText('jump_scheme')
  await expect(preview.locator('p').filter({ hasText: /^观察：/ })).toHaveCount(1)
  await expect(preview.locator('p').filter({ hasText: /^ActivityNotFoundException$/ })).toHaveCount(1)
  const imported = await page.evaluate(async () => {
    // @ts-expect-error Browser module served by Vite.
    const { db } = await import('/src/lib/storage.ts')
    // @ts-expect-error Browser module served by Vite.
    const { nodeText } = await import('/src/lib/document.ts')
    // @ts-expect-error Browser module served by Vite.
    const { beautifyDocument } = await import('/src/lib/beautify.ts')
    const article = await db.articles.get(localStorage.getItem('zijian-active'))
    return {
      source: article.sourceSnapshot.content.filter((node: any) => node.type === 'codeBlock').map((node: any) => ({ text: nodeText(node), language: node.attrs.language })),
      idempotent: JSON.stringify(beautifyDocument(article.document).document) === JSON.stringify(article.document),
      sameText: nodeText(article.sourceSnapshot).replace(/\s/g, '') === nodeText(article.document).replace(/\s/g, ''),
    }
  })
  expect(imported.source).toEqual(Object.entries(codeLayoutSamples).map(([language, text]) => ({ language, text })))
  expect(imported.idempotent).toBe(true)
  expect(imported.sameText).toBe(true)
  await page.getByRole('button', { name: '复制到公众号', exact: true }).click()
  await expect(page.locator('.toast')).toContainText('已复制')
  const copied = await page.evaluate(async () => {
    const items = await navigator.clipboard.read()
    const html = await (await items[0].getType('text/html')).text()
    const document = new DOMParser().parseFromString(html, 'text/html')
    return { code: [...document.querySelectorAll('pre')].map(node => node.textContent), scripts: document.querySelectorAll('script').length }
  })
  expect(copied).toEqual({ code: Object.values(codeLayoutSamples), scripts: 0 })
  await page.getByRole('button', { name: '导出', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /下载 HTML 文件/ }).click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const exported = await page.evaluate(html => {
    return [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('pre')].map(node => node.textContent)
  }, Buffer.concat(chunks).toString('utf8'))
  expect(exported).toEqual(Object.values(codeLayoutSamples))
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '美化效果', exact: true }).click()
  expect(await preview.locator('pre').allTextContents()).toEqual(Object.values(codeLayoutSamples))
})

test('code toolbar changes language, indents with Tab, and keeps manual edits after reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新建文章', exact: true }).click()
  const editor = page.getByRole('textbox', { name: '文章正文' })
  await editor.click()
  await page.getByRole('button', { name: '代码块', exact: true }).click()
  await page.getByLabel('代码语言', { exact: true }).selectOption('java')
  await page.keyboard.insertText('Intent intent = new Intent();')
  await page.keyboard.press('Home')
  await page.keyboard.press('Tab')
  await expect(editor.locator('pre')).toHaveText('    Intent intent = new Intent();')
  await page.keyboard.press('Shift+Tab')
  await expect(editor.locator('pre')).toHaveText('Intent intent = new Intent();')
  await page.keyboard.press('Tab')
  await page.getByRole('button', { name: '美化效果', exact: true }).click()
  await expect(page.getByTestId('beautified-article').locator('pre')).toHaveText('    Intent intent = new Intent();')
  await expect(page.getByTestId('beautified-article')).toContainText('JAVA')
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
  await page.reload()
  await editor.locator('pre').click()
  await expect(page.getByLabel('代码语言', { exact: true })).toHaveValue('java')
  await expect(editor.locator('pre')).toHaveText('    Intent intent = new Intent();')
})

test('rich paste retains tabs and indentation before beautification and fits mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: '新建文章', exact: true }).click()
  await page.getByRole('textbox', { name: '文章正文' }).click()
  await page.evaluate(() => {
    const data = new DataTransfer()
    data.setData('text/html', '<p>&lt;intent-filter&gt;</p><p>    &lt;action name="VIEW" /&gt;</p><p>\t&lt;data scheme="example" /&gt;</p><p>&lt;/intent-filter&gt;</p><p>说明：这段仍是正文。</p>')
    document.querySelector('.article-editor')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  const code = '<intent-filter>\n    <action name="VIEW" />\n\t<data scheme="example" />\n</intent-filter>'
  await expect(page.locator('.article-editor pre')).toHaveText(code)
  await expect(page.locator('.article-editor > p').filter({ hasText: /^说明：/ })).toHaveCount(1)
  await page.getByRole('button', { name: '一键美化', exact: true }).click()
  await page.getByRole('button', { name: '手机预览', exact: true }).click()
  const preview = page.getByTestId('article-preview')
  await expect(preview.locator('pre')).toHaveText(code)
  expect(await preview.locator('pre').textContent()).toBe(code)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
