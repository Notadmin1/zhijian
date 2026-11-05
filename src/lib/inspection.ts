import type { JSONContent } from '@tiptap/react'
import type { Article, ThemeId } from '../types'
import { nodeText } from './document'
import { codeLanguage, findCodeRun } from './code'
import { safeTypography } from './themes'
import { codeSettings, hasCodeSettings } from './block-settings'

export interface LayoutIssue {
  id: string
  ignoreKey: string
  severity: 'warning' | 'suggestion'
  kind: 'heading' | 'paragraph' | 'code' | 'table' | 'image'
  title: string
  detail: string
  block: number
}

function fingerprint(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return (hash >>> 0).toString(36)
}

export function isIssueIgnored(article: Article, issue: LayoutIssue) {
  return issue.severity === 'suggestion' && (article.ignoredLayoutIssues || []).includes(issue.ignoreKey)
}

function fragmentedPair(left: JSONContent, right: JSONContent) {
  if (hasCodeSettings(left.attrs) || hasCodeSettings(right.attrs)) return false
  if (left.type !== 'codeBlock' || right.type !== 'codeBlock' || [left, right].some(node => nodeText(node).includes('\n'))) return false
  const languages = [left, right].map(node => node.attrs?.language || codeLanguage(nodeText(node)))
  const compatible = languages[0] === languages[1] || languages.includes('text') || languages.every(language => ['xml', 'html'].includes(language))
  return compatible && findCodeRun([nodeText(left), nodeText(right)], 0)?.end === 2
}

export function inspectLayout(article: Article, availableAssets?: ReadonlySet<string>): LayoutIssue[] {
  const issues: LayoutIssue[] = []
  const settings = safeTypography(article.typography)
  let previousHeading = 0
  const add = (kind: LayoutIssue['kind'], title: string, detail: string, block: number, path: string, node: JSONContent, severity: LayoutIssue['severity'] = 'suggestion') => issues.push({
    id: `${kind}-${path}`, kind, title, detail, block, severity,
    ignoreKey: `${kind}:${fingerprint(title)}:${fingerprint(JSON.stringify(node))}`,
  })
  const visit = (node: JSONContent, block: number, path: string, parent?: JSONContent) => {
    const text = nodeText(node)
    if (node.type === 'heading') {
      const level = Number(node.attrs?.level) || 2
      if (!text.trim()) add('heading', '有一个空标题', '补充章节标题，或改为普通正文。', block, path, node, 'warning')
      else if (previousHeading && level > previousHeading + 1) add('heading', '标题层级有跳跃', '建议依次使用大标题、一级标题和二级标题。', block, path, node, 'warning')
      previousHeading = level
    }
    if (node.type === 'paragraph' && text.length > 220 && !parent?.type?.startsWith('table')) add('paragraph', '这一段较长', `${text.length} 字连在一个段落里，可在句末拆分，方便手机阅读。`, block, path, node)
    if (node.type === 'codeBlock') {
      const detected = node.attrs?.language || codeLanguage(text)
      if (!node.attrs?.language && (!detected || detected === 'text')) add('code', '代码语言尚未明确', '在编辑器中选择语言，可以获得更准确的高亮；选择纯文本后不再提醒。', block, path, node)
      const wrap = codeSettings(node.attrs).codeWrap
      if ((wrap === 'wrap' || (!wrap && settings.codeWrap)) && text.split('\n').some(line => line.length > 100)) add('code', '代码有较长的行', '手机上会折成多行；可在代码块设置中选择横向滚动，或在“细节调整”统一调整。', block, `${path}-width`, node)
    }
    if (node.type === 'table') {
      const columns = Math.max(0, ...(node.content || []).map(row => (row.content || []).reduce((sum, cell) => sum + Math.max(1, Number(cell.attrs?.colspan) || 1), 0)))
      if (columns > 3 && settings.tableMode === 'fit') add('table', '表格列数较多', `${columns} 列压在手机正文宽度内可能过窄，建议使用自动或横向滚动。`, block, path, node)
    }
    if (node.type === 'image') {
      const assetId = String(node.attrs?.assetId || '')
      const src = String(node.attrs?.src || '')
      if ((assetId && availableAssets && !availableAssets.has(assetId)) || (!assetId && !/^https?:\/\//i.test(src))) add('image', '有一张图片无法读取', '重新添加图片后再复制发布。', block, path, node, 'warning')
      else if (!String(node.attrs?.title || '').trim()) add('image', '图片还没有说明', '可以补充截图对应的步骤或验证结果，让读者更容易理解。', block, path, node)
    }
    const children = node.content || []
    children.forEach((child, index) => {
      if (index && fragmentedPair(children[index - 1], child)) {
        if (index === 1 || !fragmentedPair(children[index - 2], children[index - 1])) add('code', '连续的代码被拆成多个小框', '点击“一键美化”可合并同一段连续代码，原有换行会保留。', node.type === 'doc' ? index - 1 : block, `${path}-${index}-fragments`, child, 'warning')
      }
      visit(child, node.type === 'doc' ? index : block, `${path}-${index}`, node)
    })
  }
  visit(article.document, 0, 'root')
  return issues
}

export function recommendTemplate(article: Article): { id: ThemeId; reason: string } {
  const text = `${article.title}\n${nodeText(article.document)}`
  if (/漏洞|安全|攻击面|注入|POC|CVE-|渗透|修复建议/i.test(text)) return { id: 'research', reason: '文中包含安全分析与验证内容，适合按研究过程组织阅读。' }
  if (/步骤|教程|实战|安装|配置|阶段|操作指南/.test(text)) return { id: 'tutorial', reason: '文中包含操作步骤，适合突出阶段、命令与执行结果。' }
  return { id: 'minimal', reason: '以文字阅读为主，适合简洁章节与舒适留白。' }
}
