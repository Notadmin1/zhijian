import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Code2, ChevronDown, ChevronUp } from 'lucide-react'
import { codeSettings, highlightRanges } from '../lib/block-settings'

export default function CodeBlockTools({ editor }: { editor: Editor }) {
  const [expanded, setExpanded] = useState(true)
  const attrs = editor.getAttributes('codeBlock')
  const settings = codeSettings(attrs)
  const [lines, setLines] = useState(settings.highlightLines)
  useEffect(() => { setLines(settings.highlightLines) }, [settings.highlightLines])
  const valid = !lines.trim() || lines.split(',').every(part => highlightRanges(part).length === 1)
  const apply = (value: Record<string, unknown>) => editor.chain().updateAttributes('codeBlock', value).run()
  return <div className="block-tools code-block-tools" aria-label="当前代码块设置">
    <button className="block-tools-heading" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}><Code2 size={15} /><strong>当前代码块</strong><span>单独设置，保留代码原文</span>{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
    {expanded && <div className="block-tools-fields">
      <label>代码语言<select aria-label="代码语言" value={attrs.language || ''} onChange={event => apply({ language: event.target.value || null })}><option value="">自动识别</option>{['text', 'bash', 'xml', 'html', 'java', 'kotlin', 'javascript', 'typescript', 'json', 'python', 'sql'].map(value => <option key={value} value={value}>{value === 'text' ? '纯文本' : value.toUpperCase()}</option>)}</select></label>
      <label>长行显示<select aria-label="当前代码块换行" value={settings.codeWrap || ''} onChange={event => apply({ codeWrap: event.target.value || null })}><option value="">跟随整篇设置</option><option value="wrap">自动换行</option><option value="scroll">横向滚动</option></select></label>
      <label className="code-caption-field">文件名 / 示例说明<input aria-label="代码文件名或说明" value={settings.codeTitle} maxLength={120} placeholder="例如 AndroidManifest.xml" onChange={event => apply({ codeTitle: event.target.value })} /></label>
      <label className="code-highlight-field">强调第几行<div className="inline-field"><input aria-label="代码强调行" value={lines} maxLength={160} placeholder="例如 2,4-6" aria-invalid={!valid} onChange={event => setLines(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && valid) { event.preventDefault(); apply({ highlightLines: codeSettings({ highlightLines: lines }).highlightLines }) } }} /><button disabled={!valid} onClick={() => apply({ highlightLines: codeSettings({ highlightLines: lines }).highlightLines })}>应用</button></div>{!valid && <small role="alert">填写行号或范围，如 2,4-6。</small>}</label>
      <button className="block-reset" onClick={() => { apply({ codeTitle: '', codeWrap: null, highlightLines: '' }); setLines('') }}>恢复整篇设置</button>
    </div>}
  </div>
}
