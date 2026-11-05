import { afterEach, describe, expect, it, vi } from 'vitest'
import { newArticle } from './document'
import { getWeixinAccounts, syncWeixinDraft, validateWeixinArticle, weixinDraftURL, weixinImageURL, type WechatsyncAPI, type WechatsyncTask, type WeixinAccount } from './weixin-sync'

const account: WeixinAccount = { type: 'weixin', title: '我的测试公众号', uid: '我的测试公众号' }
const draftLink = 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&appmsgid=123&token=private-session&lang=zh_CN'
const article = () => newArticle('单独的文章标题', { type: 'doc', content: [
  { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '正文标题' }] },
  { type: 'paragraph', content: [{ type: 'text', text: '完整的文章正文 <script>literal</script>，应当保留。' }] },
  { type: 'image', attrs: { src: 'https://example.com/original.png', title: '原图说明' } },
  { type: 'image', attrs: { src: 'https://example.com/original.png' } },
] })
function bridge(): WechatsyncAPI {
  return {
    getAccounts: vi.fn(callback => callback([account, { type: 'zhihu', title: '其他平台' }])),
    magicCall: vi.fn((_data, callback) => callback({ result: { isAuthenticated: true, username: account.title, userId: 'wx-id' } })),
    uploadImage: vi.fn((_data, callback) => callback({ result: { url: 'http://mmbiz.qpic.cn/converted.png', platform: 'weixin' } })),
    addTask: vi.fn((task, onUpdate, callback) => {
      callback({ status: 'queued' })
      onUpdate({ guid: task.guid, accounts: [{ ...account, status: 'uploading', msg: '保存中…' }] })
      onUpdate({ guid: task.guid, accounts: [{ ...account, status: 'done', editResp: { draftLink } }] })
    }),
  }
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('Wechatsync public API integration', () => {
  it('filters to authenticated WeChat accounts', async () => {
    await expect(getWeixinAccounts(bridge())).resolves.toEqual([account])
  })
  it('uploads each unique picture before draft creation and preserves inline styles and captions', async () => {
    const api = bridge()
    const source = article()
    source.typography.includeTitle = true
    const progress = vi.fn()
    await expect(syncWeixinDraft(source, account, progress, { api })).resolves.toEqual({ draftUrl: draftLink })
    expect(api.magicCall).toHaveBeenCalledWith({ methodName: 'checkAuth', account }, expect.any(Function))
    expect(api.uploadImage).toHaveBeenCalledTimes(1)
    expect(api.uploadImage).toHaveBeenCalledWith({ src: 'https://example.com/original.png', account }, expect.any(Function))
    const task = vi.mocked(api.addTask).mock.calls[0][0]
    expect(task.accounts).toEqual([account])
    expect(task.draftOnly).toBe(true)
    expect(task.post.title).toBe(source.title)
    const html = new DOMParser().parseFromString(task.post.content, 'text/html')
    expect([...html.querySelectorAll('img')].every(img => img.src === 'https://mmbiz.qpic.cn/converted.png')).toBe(true)
    expect(html.querySelector('img')?.getAttribute('style')).toContain('max-width:100%')
    expect(html.body.textContent).toContain('原图说明')
    expect(html.querySelector('h2')?.getAttribute('style')).toContain('color:')
    expect(html.querySelector('script')).toBeNull()
    expect(task.post.content).not.toContain(source.title)
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'images' }))
  })
  it('does not submit when an image upload fails', async () => {
    const api = bridge()
    vi.mocked(api.uploadImage).mockImplementation((_data, callback) => callback({ error: '上传失败' }))
    await expect(syncWeixinDraft(article(), account, vi.fn(), { api })).rejects.toThrow('尚未提交草稿')
    expect(api.addTask).not.toHaveBeenCalled()
  })
  it('submits code as explicit rich-text lines while keeping the source document unchanged', async () => {
    const api = bridge()
    const source = newArticle('代码同步', { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: '代码之前的说明' }] },
      { type: 'codeBlock', attrs: { language: 'python' }, content: [{ type: 'text', text: '// 可信身份\nfunction updateDepartment(request):\n    user = getCurrentUserFromSessionOrToken()\n\n    return 200' }] },
    ] })
    const original = JSON.stringify(source)
    await syncWeixinDraft(source, account, vi.fn(), { api })
    const task = vi.mocked(api.addTask).mock.calls[0][0]
    const parsed = new DOMParser().parseFromString(task.post.content, 'text/html')
    expect(parsed.querySelector('pre')).toBeNull()
    expect([...parsed.querySelectorAll('p > code')].map(code => code.textContent!.replace(/\u00a0/g, ' ').replace(/\u200b/g, ''))).toEqual(['// 可信身份', 'function updateDepartment(request):', '    user = getCurrentUserFromSessionOrToken()', ' ', '    return 200'])
    expect(parsed.body.textContent).toContain('代码之前的说明')
    expect(api.uploadImage).not.toHaveBeenCalled()
    expect(JSON.stringify(source)).toBe(original)
  })
  it('does not upload or save into an account changed after selection', async () => {
    const api = bridge()
    vi.mocked(api.magicCall).mockImplementation((_data, callback) => callback({ result: { isAuthenticated: true, username: '另外的公众号', userId: 'other' } }))
    await expect(syncWeixinDraft(article(), account, vi.fn(), { api })).rejects.toMatchObject({ code: 'account-changed' })
    expect(api.uploadImage).not.toHaveBeenCalled()
    expect(api.addTask).not.toHaveBeenCalled()
  })
  it('does not ignore a mismatched account identifier just because the display name matches', async () => {
    const api = bridge()
    await expect(syncWeixinDraft(article(), { ...account, uid: 'different-account-id' }, vi.fn(), { api })).rejects.toMatchObject({ code: 'account-changed' })
    expect(api.addTask).not.toHaveBeenCalled()
  })
  it('does not treat queued acknowledgement or another task as a saved draft, and blocks concurrent writes', async () => {
    const api = bridge()
    let update: (state: unknown) => void = () => undefined
    let payload: WechatsyncTask | undefined
    vi.mocked(api.addTask).mockImplementation((task, onUpdate, callback) => { payload = task; update = onUpdate; callback({ status: 'queued' }) })
    let completed = false
    const pending = syncWeixinDraft(article(), account, vi.fn(), { api }).then(result => { completed = true; return result })
    await vi.waitFor(() => expect(api.addTask).toHaveBeenCalled())
    update({ guid: 'another-task', accounts: [{ ...account, status: 'done', editResp: { draftLink } }] })
    await Promise.resolve()
    expect(completed).toBe(false)
    await expect(syncWeixinDraft(article(), account, vi.fn(), { api })).rejects.toMatchObject({ code: 'busy' })
    update({ guid: payload!.guid, accounts: [{ ...account, status: 'done', editResp: { draftLink } }] })
    await expect(pending).resolves.toEqual({ draftUrl: draftLink })
  })
  it('reports uncertain outcome instead of successful saving when final status never arrives', async () => {
    vi.useFakeTimers()
    const api = bridge()
    vi.mocked(api.addTask).mockImplementation((_task, _update, callback) => callback({ status: 'queued' }))
    const pending = expect(syncWeixinDraft(article(), account, vi.fn(), { api, saveTimeout: 25 })).rejects.toMatchObject({ code: 'unknown' })
    await vi.runAllTimersAsync()
    await pending
  })
  it('validates title/body before starting a remote operation', () => {
    const source = article()
    source.title = '标题'.repeat(33)
    expect(() => validateWeixinArticle(source)).toThrow('最多 64')
    expect(() => validateWeixinArticle(newArticle('空白'))).toThrow('正文为空')
  })
  it('only opens genuine draft edit links and never persists the returned session token', () => {
    expect(weixinDraftURL(draftLink)).toBe(draftLink)
    expect(weixinDraftURL(draftLink, true)).toContain('appmsgid=123')
    expect(weixinDraftURL(draftLink, true)).not.toContain('token')
    expect(weixinDraftURL('https://mp.weixin.qq.com.evil.test/cgi-bin/appmsg?action=edit&appmsgid=1')).toBe('')
    expect(weixinDraftURL('https://mp.weixin.qq.com/cgi-bin/appmsg?action=delete&appmsgid=1')).toBe('')
    expect(weixinDraftURL('javascript:alert(1)')).toBe('')
    expect(weixinImageURL('https://mmbiz.qpic.cn.evil.test/image.png')).toBe('')
  })
})
