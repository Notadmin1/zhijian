import { test, expect, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { wordFixture } from './fixtures'
import { departmentCode, tabbedCode, longCommand } from './fixtures/weixin-code'

// Simulates only the documented/injected Wechatsync callback API. It performs
// no network writes and never uses a real browser profile or WeChat account.
async function installBridge(page: Page, mode: 'success' | 'image-error' | 'no-account' | 'expired' | 'pending' = 'success') {
  await page.addInitScript(mode => {
    const state = window as unknown as Record<string, any>
    const account = { type: 'weixin', title: '测试公众号', uid: '测试公众号' }
    state.__syncTasks = []
    state.__syncUploads = []
    const api = {
      getAccounts(callback: (data: unknown) => void) { callback(mode === 'no-account' ? [{ type: 'zhihu', title: '其他平台' }] : [account, { type: 'zhihu', title: '其他平台' }]) },
      magicCall(_data: unknown, callback: (data: unknown) => void) { callback({ result: { isAuthenticated: mode !== 'expired', username: account.title, userId: 'wx-id' } }) },
      uploadImage(data: { src: string; account: { type: string } }, callback: (data: unknown) => void) {
        state.__syncUploads.push(data)
        callback(mode === 'image-error' ? { error: '图片上传失败' } : { result: { url: 'https://mmbiz.qpic.cn/test-image.png', platform: 'weixin' } })
      },
      addTask(task: unknown, update: (data: unknown) => void, callback: (data: unknown) => void) {
        state.__syncTasks.push(task)
        callback({ status: 'queued' })
        update({ accounts: [{ ...account, status: 'uploading', msg: '公众号保存中…' }] })
        if (mode !== 'pending') setTimeout(() => update({ accounts: [{ ...account, status: 'done', editResp: { draftLink: 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&appmsgid=123&token=ephemeral-private-token&lang=zh_CN' } }] }), 80)
      },
    }
    state.$syncer = api
    state.$poster = api
  }, mode)
}

test('missing extension has setup guidance and cannot submit', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '同步草稿', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('需要在当前浏览器安装')
  await expect(page.getByRole('link', { name: '安装文章同步助手' })).toHaveAttribute('href', /^https:\/\/github.com\/wechatsync\/Wechatsync/)
  await expect(page.getByRole('button', { name: '同步到公众号草稿', exact: true })).toBeDisabled()
  await page.screenshot({ path: 'test-results/weixin-setup-desktop.png', animations: 'disabled' })
})

test('connected extension without a WeChat account requires login', async ({ page }) => {
  await installBridge(page, 'no-account')
  await page.goto('/')
  await page.getByRole('button', { name: '同步草稿', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('尚未检测到已登录的公众号')
  await expect(page.getByRole('button', { name: '同步到公众号草稿', exact: true })).toBeDisabled()
})

test('Word images and current styles are synced only to WeChat draft, and result history survives reload', async ({ page }) => {
  await installBridge(page)
  await page.goto('/')
  await page.getByTestId('word-input').setInputFiles({ name: '同步测试.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await wordFixture() })
  await expect(page.getByTestId('beauty-report')).toBeVisible()
  await page.getByRole('button', { name: '同步草稿', exact: true }).click()
  await expect(page.getByLabel('目标公众号')).toHaveValue('0')
  await page.getByLabel('同步文章标题').fill('同步到公众号的单独标题')
  await page.getByRole('button', { name: '同步到公众号草稿', exact: true }).click()
  await expect(page.getByTestId('wechat-sync-result')).toContainText('已保存为公众号草稿')
  const actual = await page.evaluate(async () => {
    const state = window as unknown as Record<string, any>
    const task = state.__syncTasks[0]
    const content = new DOMParser().parseFromString(task.post.content, 'text/html')
    const request = indexedDB.open('zijian-studio')
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    const read = db.transaction('syncRecords').objectStore('syncRecords').getAll()
    const records = await new Promise<unknown[]>((resolve, reject) => { read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error) })
    db.close()
    return { count: state.__syncTasks.length, task, uploadedLocal: state.__syncUploads[0].src.startsWith('data:image/png;base64,'), picture: content.querySelector('img')?.getAttribute('src'), hasTitle: content.body.textContent?.includes(task.post.title), records }
  })
  expect(actual.count).toBe(1)
  expect(actual.task.accounts).toEqual([{ type: 'weixin', title: '测试公众号', uid: '测试公众号' }])
  expect(actual.task.draftOnly).toBe(true)
  expect(actual.task.post.title).toBe('同步到公众号的单独标题')
  expect(actual.task.post.content).toContain('font-size:')
  expect(actual.task.post.content).not.toContain('blob:')
  expect(actual.task.post.content).not.toContain('data:image/')
  expect(actual.uploadedLocal).toBe(true)
  expect(actual.picture).toBe('https://mmbiz.qpic.cn/test-image.png')
  expect(actual.hasTitle).toBe(false)
  expect(JSON.stringify(actual.records)).not.toContain('ephemeral-private-token')
  await expect(page.getByRole('link', { name: '打开公众号草稿', exact: true })).toHaveAttribute('href', /token=ephemeral-private-token/)
  await page.screenshot({ path: 'test-results/weixin-success-desktop.png', animations: 'disabled' })
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: '同步草稿', exact: true }).click()
  await expect(page.getByTestId('wechat-sync-result')).toContainText('已保存为公众号草稿')
  await expect(page.getByRole('link', { name: '打开公众号草稿', exact: true })).not.toHaveAttribute('href', /token=/)
  expect(await page.evaluate(() => (window as unknown as Record<string, any>).__syncTasks.length)).toBe(0)
})

test('image upload failure leaves the local draft and never submits a remote draft', async ({ page }) => {
  await installBridge(page, 'image-error')
  await page.goto('/')
  await page.getByTestId('word-input').setInputFiles({ name: '图片失败测试.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await wordFixture() })
  await expect(page.getByTestId('beauty-report')).toBeVisible()
  await page.getByRole('button', { name: '同步草稿', exact: true }).click()
  await expect(page.getByLabel('目标公众号')).toBeVisible()
  await page.getByRole('button', { name: '同步到公众号草稿', exact: true }).click()
  await expect(page.getByTestId('wechat-sync-result')).toContainText('尚未提交草稿')
  expect(await page.evaluate(() => (window as unknown as Record<string, any>).__syncTasks.length)).toBe(0)
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await expect(page.getByTestId('beautified-article')).toContainText('文章结尾。')
})

test('synced code keeps visible lines and indentation after editor whitespace normalization', async ({ page }, testInfo) => {
  await installBridge(page)
  await page.goto('/')
  await page.getByRole('textbox', { name: '文章正文' }).waitFor()
  await page.evaluate(async ({ departmentCode, tabbedCode, longCommand }) => {
    // @ts-expect-error Browser module served by Vite.
    const { newArticle } = await import('/src/lib/document.ts')
    // @ts-expect-error Browser module served by Vite.
    const { db } = await import('/src/lib/storage.ts')
    const snippet = (text: string, attrs: Record<string, unknown>) => ({ type: 'codeBlock', attrs: { language: 'python', ...attrs }, content: [{ type: 'text', text }] })
    const article = newArticle('代码同步换行与缩进回归', { type: 'doc', content: [
      snippet(departmentCode, { codeTitle: '部门更新伪代码', codeWrap: 'wrap', highlightLines: '14-15,20' }),
      snippet(tabbedCode, { codeTitle: 'Tab 与空行', codeWrap: 'wrap' }),
      snippet(longCommand, { language: 'bash', codeTitle: '长命令', codeWrap: 'scroll' }),
    ] })
    article.themeId = 'technical'
    await db.articles.put(article)
    localStorage.setItem('zijian-active', article.id)
  }, { departmentCode, tabbedCode, longCommand })
  await page.reload()
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue('代码同步换行与缩进回归')
  await page.getByRole('button', { name: '同步草稿', exact: true }).click()
  await expect(page.getByLabel('目标公众号')).toBeVisible()
  await page.getByRole('button', { name: '同步到公众号草稿', exact: true }).click()
  await expect(page.getByTestId('wechat-sync-result')).toContainText('已保存为公众号草稿')

  const html = await page.evaluate(async () => {
    const state = window as unknown as Record<string, any>
    // @ts-expect-error Browser module served by Vite.
    const { db } = await import('/src/lib/storage.ts')
    // @ts-expect-error Browser module served by Vite.
    const { renderArticle } = await import('/src/lib/render.ts')
    const article = await db.articles.get(localStorage.getItem('zijian-active'))
    return { original: renderArticle({ ...article, typography: { ...article.typography, includeTitle: false } }, { mode: 'clipboard' }), synced: state.__syncTasks[0].post.content, source: article.document.content.map((node: any) => node.content[0].text) }
  })
  expect(html.source).toEqual([departmentCode, tabbedCode, longCommand])

  // Stress the editor import boundary: whitespace CSS is reset and empty
  // containers are cleaned. This is a compatibility simulation, not a live
  // WeChat editor or a claim to reproduce every installed extension version.
  const review = await page.context().newPage()
  await review.setViewportSize({ width: 1180, height: 1150 })
  await review.setContent('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>代码同步兼容处理对比</title><style>body{margin:24px;background:#f1f4f6;font-family:system-ui}main{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start}article{min-width:0;background:white;padding:20px;box-sizing:border-box;border-radius:12px}h1{font-size:22px}h2{font-size:17px}@media(max-width:800px){main{grid-template-columns:1fr}}</style><h1>代码同步：兼容处理前后对比</h1><p>本地模拟编辑器清理空白后的显示；未连接真实公众号。</p><main><article id="before"><h2>原输出：换行依赖 pre 样式</h2></article><article id="after"><h2>新输出：逐行保留换行与缩进</h2></article></main>')
  await review.evaluate(({ original, synced }) => {
    function normalize(html: string) {
      const parsed = new DOMParser().parseFromString(html, 'text/html')
      for (const element of parsed.querySelectorAll<HTMLElement>('pre')) element.style.whiteSpace = 'normal'
      for (const element of parsed.querySelectorAll<HTMLElement>('code')) element.style.whiteSpace = 'inherit'
      for (let round = 0; round < 3; round++) {
        for (const element of parsed.querySelectorAll('p,div,section,span,figure')) {
          if (!element.textContent?.trim() && !element.querySelector('img,video,audio,iframe,canvas,svg')) element.remove()
        }
      }
      return parsed.body.innerHTML
    }
    document.querySelector('#before')!.insertAdjacentHTML('beforeend', normalize(original))
    document.querySelector('#after')!.insertAdjacentHTML('beforeend', normalize(synced))
  }, html)
  const blocks = review.locator('#after section').filter({ has: review.locator(':scope > p > code') })
  await expect(blocks).toHaveCount(3)
  const expected = [departmentCode.split('\n'), tabbedCode.replace(/\t/g, '    ').split('\n'), [longCommand]]
  for (let index = 0; index < expected.length; index++) {
    const actual = await blocks.nth(index).evaluate(block => {
      const lines = [...block.querySelectorAll<HTMLElement>(':scope > p')]
      return {
        text: lines.map(line => line.textContent!.replace(/\u00a0/g, ' ').replace(/\u200b/g, '')),
        y: lines.map(line => line.getBoundingClientRect().y),
        heights: lines.map(line => line.getBoundingClientRect().height),
        margin: lines.map(line => getComputedStyle(line).margin),
        highlights: block.querySelectorAll('span[style*="background"]').length,
        overflow: block.scrollWidth > block.clientWidth,
      }
    })
    expect(actual.text).toEqual(expected[index].map(line => line || ' '))
    expect(actual.y.every((y, row) => row === 0 || y > actual.y[row - 1])).toBe(true)
    expect(actual.heights.every(height => height > 0)).toBe(true)
    expect(actual.margin.every(margin => margin === '0px')).toBe(true)
    if (index === 0) { expect(actual.highlights).toBeGreaterThan(0); expect(actual.overflow).toBe(false) }
    if (index === 2) expect(actual.overflow).toBe(true)
  }
  expect(await review.locator('#before pre').first().evaluate(pre => getComputedStyle(pre).whiteSpace)).toBe('normal')
  await expect(review.locator('#after script, #after pre')).toHaveCount(0)
  await writeFile(testInfo.outputPath('weixin-code-comparison.html'), '<!doctype html>' + await review.content(), 'utf8')
  await review.screenshot({ path: testInfo.outputPath('weixin-code-comparison.png'), fullPage: true, animations: 'disabled' })
  await testInfo.attach('代码同步兼容处理对比', { path: testInfo.outputPath('weixin-code-comparison.png'), contentType: 'image/png' })
  await review.close()
})

test('expired login blocks syncing before uploads or task submission', async ({ page }) => {
  await installBridge(page, 'expired')
  await page.goto('/')
  await page.getByRole('button', { name: '同步草稿', exact: true }).click()
  await expect(page.getByLabel('目标公众号')).toBeVisible()
  await page.getByRole('button', { name: '同步到公众号草稿', exact: true }).click()
  await expect(page.getByTestId('wechat-sync-result')).toContainText('公众号登录已过期')
  expect(await page.evaluate(() => (window as unknown as Record<string, any>).__syncTasks.length)).toBe(0)
})

test('closing progress does not resend, and a reload flags uncertain saving instead of success', async ({ page }) => {
  await installBridge(page, 'pending')
  await page.goto('/')
  await page.getByRole('button', { name: '同步草稿', exact: true }).click()
  await expect(page.getByLabel('目标公众号')).toBeVisible()
  await page.getByRole('button', { name: '同步到公众号草稿', exact: true }).click()
  await expect(page.getByTestId('wechat-sync-result')).toContainText('公众号保存中')
  await page.getByRole('button', { name: '收起进度', exact: true }).click()
  await page.getByRole('button', { name: '同步进度', exact: true }).click()
  await expect(page.getByRole('button', { name: '正在保存草稿…', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => (window as unknown as Record<string, any>).__syncTasks.length)).toBe(1)
  await page.reload()
  await page.getByRole('button', { name: '同步草稿', exact: true }).click()
  await expect(page.getByTestId('wechat-sync-result')).toContainText('保存结果待确认')
  expect(await page.evaluate(() => (window as unknown as Record<string, any>).__syncTasks.length)).toBe(0)
})

test('mobile draft dialog has no horizontal overflow', async ({ page }) => {
  await installBridge(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: '同步草稿', exact: true }).click()
  await expect(page.getByLabel('目标公众号')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/weixin-sync-mobile.png', animations: 'disabled' })
})
