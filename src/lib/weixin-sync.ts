import type { Article } from '../types'
import { prepareClipboard } from './clipboard'
import { imageNodes, plainText } from './document'
import { prepareWeixinCodeBlocks } from './weixin-code'

export const WEIXIN_HOME = 'https://mp.weixin.qq.com/'
export const WECHATSYNC_INSTALL = 'https://github.com/wechatsync/Wechatsync#安装方式'

export interface WeixinAccount {
  type: 'weixin'
  title: string
  uid?: string
  [key: string]: unknown
}
export interface SyncProgress { stage: 'preparing' | 'images' | 'saving'; message: string; current?: number; total?: number }
export interface DraftResult { draftUrl: string }
export interface WechatsyncTask {
  guid: string
  post: { title: string; content: string; desc: string }
  accounts: WeixinAccount[]
  draftOnly: true
}
type Callback = (result: unknown, response?: unknown) => void
export interface WechatsyncAPI {
  getAccounts: (callback: Callback) => void
  magicCall: (data: { methodName: string; account: WeixinAccount }, callback: Callback) => void
  uploadImage: (data: { src: string; account: WeixinAccount }, callback: Callback) => void
  addTask: (task: WechatsyncTask, onUpdate: (task: unknown) => void, callback: Callback) => void
}
declare global { interface Window { $syncer?: WechatsyncAPI; $poster?: WechatsyncAPI } }

export class WeixinSyncError extends Error {
  constructor(public code: 'extension-missing' | 'timeout' | 'account-changed' | 'failed' | 'unknown' | 'busy', message: string) { super(message); this.name = 'WeixinSyncError' }
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
export function syncErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '同步失败，请检查公众号登录状态后重试'
  return message.replace(/data:image\/[^\s"'<>]+/gi, '[图片数据]').replace(/\b(token|ticket|key)=([^&\s"'<>]+)/gi, '$1=…').slice(0, 300)
}

// Public API callbacks use one result argument. Also accept older error/result callbacks.
function callbackResult(first: unknown, second?: unknown): unknown {
  if (second !== undefined) {
    if (first) throw new Error(syncErrorMessage(first))
    return second
  }
  return first
}
function unwrap(response: unknown): unknown {
  let value = response
  for (let i = 0; i < 4; i++) {
    const data = object(value)
    if (data.error) throw new Error(syncErrorMessage(data.error))
    if (data.success === false) throw new Error(String(data.message || '同步助手返回失败'))
    if ('result' in data) value = data.result
    else if ('data' in data) value = data.data
    else return value
  }
  return value
}
function callAPI(invoke: (callback: Callback) => void, timeout: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new WeixinSyncError('timeout', '同步助手响应超时，请检查扩展和公众号登录状态')), timeout)
    const done: Callback = (first, second) => {
      clearTimeout(timer)
      try { resolve(unwrap(callbackResult(first, second))) } catch (error) { reject(error) }
    }
    try { invoke(done) } catch (error) { clearTimeout(timer); reject(error) }
  })
}
export async function detectWechatsync(timeout = 1600): Promise<WechatsyncAPI> {
  const start = Date.now()
  do {
    const api = window.$syncer || window.$poster
    if (api && ['getAccounts', 'magicCall', 'uploadImage', 'addTask'].every(key => typeof api[key as keyof WechatsyncAPI] === 'function')) return api
    if (Date.now() - start >= timeout) break
    await new Promise(resolve => setTimeout(resolve, 80))
  } while (true)
  throw new WeixinSyncError('extension-missing', '未检测到文章同步助手。请在当前浏览器安装扩展，并允许访问本站，然后刷新工作台。')
}
export async function getWeixinAccounts(api?: WechatsyncAPI): Promise<WeixinAccount[]> {
  const bridge = api || await detectWechatsync()
  const response = await callAPI(callback => bridge.getAccounts(callback), 45000)
  if (!Array.isArray(response)) throw new Error('同步助手返回的账号格式不正确，请更新扩展后重试')
  return response.filter((item): item is WeixinAccount => object(item).type === 'weixin' && typeof object(item).title === 'string')
}

export function weixinDraftURL(value: unknown, persistent = false): string {
  try {
    const url = new URL(String(value))
    if (url.protocol !== 'https:' || url.hostname !== 'mp.weixin.qq.com' || url.port || url.username || url.password || url.pathname !== '/cgi-bin/appmsg' || url.searchParams.get('action') !== 'edit' || !url.searchParams.get('appmsgid')) return ''
    url.hash = ''
    if (persistent) {
      // Store only the draft identifier, never the session token in the returned edit URL.
      for (const key of [...url.searchParams.keys()]) if (!['t', 'action', 'type', 'appmsgid', 'lang'].includes(key)) url.searchParams.delete(key)
    }
    return url.href
  } catch { return '' }
}
export function weixinImageURL(src: string): string {
  try {
    const url = new URL(src)
    if (!['https:', 'http:'].includes(url.protocol) || !['mmbiz.qpic.cn', 'mmbiz.qlogo.cn'].includes(url.hostname) || url.port || url.username || url.password) return ''
    url.protocol = 'https:'
    return url.href
  } catch { return '' }
}
function sameAccount(expected: WeixinAccount, auth: Record<string, unknown>) {
  if (expected.uid) return [auth.userId, auth.username].includes(expected.uid)
  return Boolean(auth.username && expected.title === auth.username)
}
export function validateWeixinArticle(article: Article) {
  if (!article.title.trim()) throw new Error('请填写文章标题')
  if (Array.from(article.title.trim()).length > 64) throw new Error('公众号标题最多 64 个字，请缩短标题后同步')
  if (!plainText(article.document).trim() && !imageNodes(article.document).length) throw new Error('正文为空，请先导入或编辑文章')
}

let inFlight = false
export async function syncWeixinDraft(article: Article, account: WeixinAccount, onProgress: (progress: SyncProgress) => void, options: { api?: WechatsyncAPI; callTimeout?: number; saveTimeout?: number } = {}): Promise<DraftResult> {
  if (inFlight) throw new WeixinSyncError('busy', '已有文章正在同步，请等待当前任务完成')
  validateWeixinArticle(article)
  if (account.type !== 'weixin') throw new Error('当前仅支持同步微信公众号草稿')
  inFlight = true
  try {
    const api = options.api || await detectWechatsync()
    const timeout = options.callTimeout ?? 90000
    onProgress({ stage: 'preparing', message: '正在核对公众号登录状态…' })
    const auth = object(await callAPI(callback => api.magicCall({ methodName: 'checkAuth', account }, callback), timeout))
    if (!auth.isAuthenticated) throw new Error('公众号登录已过期，请重新登录后检测账号')
    if (!sameAccount(account, auth)) throw new WeixinSyncError('account-changed', '当前登录的公众号已变化，请重新检测账号并确认同步目标')
    const { html } = await prepareClipboard({ ...article, title: article.title.trim(), typography: { ...article.typography, includeTitle: false } })
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    prepareWeixinCodeBlocks(parsed.body)
    const images = [...parsed.querySelectorAll('img')]
    const sources = [...new Set(images.map(img => img.getAttribute('src') || ''))]
    const uploaded = new Map<string, string>()
    for (let index = 0; index < sources.length; index++) {
      const src = sources[index]
      onProgress({ stage: 'images', message: `正在转存图片 ${index + 1}/${sources.length}…`, current: index, total: sources.length })
      const existing = weixinImageURL(src)
      if (existing) { uploaded.set(src, existing); continue }
      try {
        const response = await callAPI(callback => api.uploadImage({ src, account }, callback), timeout)
        const url = weixinImageURL(String(object(Array.isArray(response) ? response[0] : response).url || ''))
        if (!url) throw new Error('未返回有效的微信图片地址，请更新同步助手扩展')
        uploaded.set(src, url)
      } catch (error) { throw new Error(`第 ${index + 1} 张图片转存失败，尚未提交草稿：${syncErrorMessage(error)}`) }
    }
    for (const img of images) img.setAttribute('src', uploaded.get(img.getAttribute('src') || '')!)
    onProgress({ stage: 'saving', message: '图片已就绪，正在保存公众号草稿…', current: sources.length, total: sources.length })
    const task: WechatsyncTask = {
      guid: crypto.randomUUID(),
      post: { title: article.title.trim(), content: parsed.body.innerHTML, desc: plainText(article.document).replace(/\s+/g, ' ').slice(0, 120) },
      accounts: [account], draftOnly: true,
    }
    return await new Promise<DraftResult>((resolve, reject) => {
      let settled = false
      const finish = (error?: unknown, result?: DraftResult) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error); else resolve(result!)
      }
      const timer = setTimeout(() => finish(new WeixinSyncError('unknown', '暂未收到保存结果。请先在公众号后台检查草稿，避免重复创建；不要直接重复点击同步。')), options.saveTimeout ?? 180000)
      try {
        api.addTask(task, update => {
          if (settled) return
          const state = object(update)
          if (state.guid && state.guid !== task.guid) return
          if (!Array.isArray(state.accounts)) return
          const target = state.accounts.find(item => {
            const data = object(item)
            return data.type === 'weixin' && (!data.uid || !account.uid || data.uid === account.uid) && (!data.title || data.title === account.title)
          })
          if (!target) return
          const data = object(target)
          if (data.status === 'failed' || data.status === 'error') finish(new Error(syncErrorMessage(data.error || data.msg || '公众号保存失败，请检查登录状态后重试')))
          else if (data.status === 'done') finish(undefined, { draftUrl: weixinDraftURL(object(data.editResp).draftLink) })
          else if (data.msg) onProgress({ stage: 'saving', message: syncErrorMessage(String(data.msg)) })
        }, (first, second) => {
          // A queued/accepted response is not proof of a saved draft. v2 sends
          // completion only through taskUpdate; its addTask acknowledgement may never fire.
          if (settled) return
          try { unwrap(callbackResult(first, second)) } catch (error) { finish(error) }
        })
      } catch (error) {
        // A thrown bridge error may happen after the request has left this page.
        finish(new WeixinSyncError('unknown', `未能确认草稿保存结果，请先到公众号后台检查：${syncErrorMessage(error)}`))
      }
    })
  } finally { inFlight = false }
}
