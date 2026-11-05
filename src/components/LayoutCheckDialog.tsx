import { useState } from 'react'
import { ArrowRight, CheckCheck, ListChecks } from 'lucide-react'
import type { LayoutIssue } from '../lib/inspection'
import Modal from './Modal'

export default function LayoutCheckDialog({ issues, ignored, onIgnore, onRestore, onLocate, onBeautify, onClose }: {
  issues: LayoutIssue[]; ignored: LayoutIssue[]; onIgnore: (issue: LayoutIssue) => void; onRestore: (key: string) => void
  onLocate: (block: number) => void; onBeautify: () => void; onClose: () => void
}) {
  const [showIgnored, setShowIgnored] = useState(false)
  const fixable = issues.some(issue => issue.title.includes('多个小框') || issue.kind === 'paragraph')
  const warnings = issues.filter(issue => issue.severity === 'warning')
  const suggestions = issues.filter(issue => issue.severity === 'suggestion')
  const row = (issue: LayoutIssue, hidden = false) => <div className="layout-issue-row" key={issue.id}>
    <button className="layout-issue-locate" onClick={() => onLocate(issue.block)}><div><strong>{issue.title}</strong><p>{issue.detail}</p></div><ArrowRight size={16} /></button>
    {hidden ? <button className="issue-ignore" onClick={() => onRestore(issue.ignoreKey)} aria-label={`恢复提醒：${issue.title}`}>恢复提醒</button> : issue.severity === 'suggestion' && <button className="issue-ignore" onClick={() => onIgnore(issue)} aria-label={`忽略建议：${issue.title}`}>忽略此项</button>}
  </div>
  return <Modal title="发布前，再读一遍" eyebrow="LAYOUT CHECK" onClose={onClose}>
    <div className="layout-check-summary"><span><ListChecks size={24} /></span><div><strong>{issues.length ? `${warnings.length} 处需处理 · ${suggestions.length} 条美观建议` : '没有发现这些常见排版问题'}</strong><p>点击问题定位原文；忽略建议后会记住选择，相关内容改变时重新检查。</p></div></div>
    <div className="layout-issue-list">
      {warnings.length > 0 && <section aria-label="需要处理的排版问题"><h3 className="issue-group warning">需要处理 <small>{warnings.length}</small></h3>{warnings.map(issue => row(issue))}</section>}
      {suggestions.length > 0 && <section aria-label="可选的美观建议"><h3 className="issue-group">美观建议 <small>{suggestions.length}</small></h3>{suggestions.map(issue => row(issue))}</section>}
      {!issues.length && <div className="layout-check-empty"><CheckCheck size={28} /><p>可以继续检查手机阅读效果，再复制到公众号。</p></div>}
      {ignored.length > 0 && <section className="ignored-issues"><button className="ignored-toggle" aria-expanded={showIgnored} onClick={() => setShowIgnored(value => !value)}>已忽略 {ignored.length} 条建议 · {showIgnored ? '收起' : '查看'}</button>{showIgnored && ignored.map(issue => row(issue, true))}</section>}
    </div>
    <p className="note">这是本地排版检查，不代表公众号后台已经验收；图片来源是否可访问，需要在预览中确认。</p>
    <div className="modal-actions"><button className="button secondary" onClick={onClose}>继续编辑</button>{fixable && <button className="button primary" onClick={onBeautify}>整理代码与长段落<ArrowRight size={15} /></button>}</div>
  </Modal>
}
