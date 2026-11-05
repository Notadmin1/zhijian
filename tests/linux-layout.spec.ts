import { test, expect } from '@playwright/test'
import { linuxSamples, linuxWordFixture, tableLog } from './fixtures/linux-logs'

test('Linux Word import keeps commands, comments, log lines and field tables through copy, beautify and reload', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  await page.getByTestId('word-input').setInputFiles({ name: 'Linux日志排版.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await linuxWordFixture() })
  const preview = page.getByTestId('beautified-article')
  await expect(preview).toBeVisible()
  await expect(preview.locator('pre')).toHaveCount(linuxSamples.length + 1)
  expect(await preview.locator('pre').allTextContents()).toEqual([...linuxSamples, tableLog])
  await expect(preview.locator('h2')).toHaveText([/安全日志：\/var\/log\/secure$/, /定时任务日志：\/var\/log\/cron$/, /当前与历史登录$/])
  await expect(preview.locator('h3').filter({ hasText: '1. 统计攻击源 IP' })).toHaveCount(1)
  expect(await preview.locator('h2,h3').allTextContents()).not.toContain('总体摘要')
  await expect(preview.locator('p').filter({ hasText: /^-w <path>/ })).toHaveCount(1)
  await expect(preview.locator('p').filter({ hasText: /^last -x/ })).toHaveCount(1)
  await expect(preview.locator('p').filter({ hasText: /^auditctl 命令行/ })).toHaveCount(1)
  await expect(preview.locator('table').first()).toHaveCSS('min-width', '660px')
  await expect(preview.locator('table').nth(1).locator('td').last().locator('p')).toHaveText('uid=、pid=、exe=')
  await expect(preview.locator('ul')).toHaveCount(1)
  await expect(preview.locator('ul li code').first()).toHaveText('/var/log/secure')
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
  const diagnostic = () => page.evaluate(async () => {
    // @ts-expect-error Vite browser module.
    const { db } = await import('/src/lib/storage.ts')
    // @ts-expect-error Vite browser module.
    const { nodeText } = await import('/src/lib/document.ts')
    // @ts-expect-error Vite browser module.
    const { beautifyDocument } = await import('/src/lib/beautify.ts')
    const article = await db.articles.get(localStorage.getItem('zijian-active'))
    return { sameText: nodeText(article.sourceSnapshot).replace(/\s/g, '') === nodeText(article.document).replace(/\s/g, ''), idempotent: JSON.stringify(beautifyDocument(article.document).document) === JSON.stringify(article.document), codes: article.document.content.filter((n: any) => n.type === 'codeBlock').map(nodeText) }
  })
  expect(await diagnostic()).toEqual({ sameText: true, idempotent: true, codes: linuxSamples })
  await page.getByRole('button', { name: '复制到公众号', exact: true }).click()
  await expect(page.locator('.toast')).toContainText('已复制')
  const copied = await page.evaluate(async () => {
    const items = await navigator.clipboard.read()
    const html = await (await items[0].getType('text/html')).text()
    const document = new DOMParser().parseFromString(html, 'text/html')
    return { codes: [...document.querySelectorAll('pre')].map(n => n.textContent), unsafe: document.querySelectorAll('script,button').length, text: document.body.textContent }
  })
  expect(copied.codes).toEqual([...linuxSamples, tableLog])
  expect(copied.unsafe).toBe(0)
  expect(copied.text).toContain('文章末尾完整保留。')
  await page.getByRole('button', { name: '一键美化', exact: true }).click()
  expect(await preview.locator('pre').allTextContents()).toEqual([...linuxSamples, tableLog])
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
  await page.reload()
  expect(await diagnostic()).toEqual({ sameText: true, idempotent: true, codes: linuxSamples })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '手机预览', exact: true }).click()
  const mobile = page.getByTestId('article-preview')
  await expect(mobile.locator('pre')).toHaveCount(linuxSamples.length + 1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const tableFits = await mobile.locator('table').first().evaluate(table => {
    const container = table.parentElement!
    return getComputedStyle(container).overflowX === 'auto' && container.scrollWidth > container.clientWidth && container.getBoundingClientRect().width < 390
  })
  expect(tableFits).toBe(true)
})
