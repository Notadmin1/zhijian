import { Check, RotateCcw, ChevronDown, SlidersHorizontal, Palette, Leaf, BookOpen, Sun, TerminalSquare, ShieldCheck, Footprints, AlignLeft, Columns2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Article, Typography, ThemeId } from '../types'
import { defaultTypography, themes } from '../lib/themes'
import { recommendTemplate } from '../lib/inspection'
import ReadingStyleControls from './ReadingStyleControls'

interface Props { article: Article; onTheme: (id: ThemeId) => void; onTypography: (settings: Typography) => void; autoBeautify: boolean; onAutoBeautify: (value: boolean) => void; onClose: () => void; onCompare: () => void; onPresets: () => void; onCompareReading: () => void; onContentTemplates: () => void }

export default function StylePanel({ article, onTheme, onTypography, autoBeautify, onAutoBeautify, onClose, onCompare, onPresets, onCompareReading, onContentTemplates }: Props) {
  const [tab, setTab] = useState<'theme' | 'settings'>('theme')
  const t = article.typography
  const recommendation = useMemo(() => recommendTemplate(article), [article.title, article.document])
  const recommended = themes.find(theme => theme.id === recommendation.id)!
  const templateOrder = [...themes.filter(theme => ['research', 'tutorial', 'minimal'].includes(theme.id)), ...themes.filter(theme => !['research', 'tutorial', 'minimal'].includes(theme.id))]
  const icons = { botanical: Leaf, editorial: BookOpen, warm: Sun, technical: TerminalSquare, research: ShieldCheck, tutorial: Footprints, minimal: AlignLeft }
  const set = <K extends keyof Typography>(key: K, value: Typography[K]) => onTypography({ ...t, [key]: value })
  const range = (label: string, key: 'fontSize' | 'lineHeight' | 'paragraphSpace' | 'codeFontSize', min: number, max: number, step: number, unit: string) => <div className="setting-item"><div className="setting-label"><label htmlFor={key}>{label}</label><span>{Number(t[key].toFixed(2))}{unit}</span></div><input id={key} type="range" min={min} max={max} step={step} value={t[key]} onChange={event => set(key, Number(event.target.value))} style={{ '--range-progress': `${(t[key] - min) / (max - min) * 100}%` } as React.CSSProperties} /></div>
  const toggle = (label: string, key: 'serif' | 'indent' | 'includeTitle' | 'numberHeadings' | 'leadParagraph' | 'codeWrap', hint: string) => <div className="toggle-row"><div><span>{label}</span><small>{hint}</small></div><button className={`toggle ${t[key] ? 'checked' : ''}`} role="switch" aria-label={label} aria-checked={t[key]} onClick={() => set(key, !t[key])}><span /></button></div>
  return <aside className="style-panel">
    <div className="sidebar-heading"><span>排版样式</span><button className="icon-button close-style" aria-label="收起排版样式" onClick={onClose}><X size={16} /></button></div>
    <div className="style-tabs" role="tablist" aria-label="排版设置分类"><button role="tab" aria-selected={tab === 'theme'} className={tab === 'theme' ? 'active' : ''} onClick={() => setTab('theme')}><Palette size={14} />主题模板</button><button role="tab" aria-selected={tab === 'settings'} className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}><SlidersHorizontal size={14} />细节调整</button></div>
    <div className="sidebar-scroll">
      <label className="auto-beautify-control"><input type="checkbox" checked={autoBeautify} onChange={event => onAutoBeautify(event.target.checked)} /><span>导入后自动美化<small>识别标题、代码和段落结构</small></span></label>
      <button className="compare-templates-button personal-preset-entry" onClick={onPresets}><Palette size={16} />个人排版方案<span>保存 / 应用</span></button>
      <button className="compare-templates-button personal-preset-entry" onClick={onContentTemplates}><BookOpen size={16} />开头与文末模板<span>内容 / 自动添加</span></button>
      <ReadingStyleControls typography={t} onChange={onTypography} onCompare={onCompareReading} />
      {tab === 'theme' ? <>
        <div className="template-recommendation"><span>根据当前文章推荐</span><strong>{recommended.name}</strong><p>{recommendation.reason}</p><button onClick={() => onTheme(recommended.id)}>应用推荐版式</button></div>
        <button className="compare-templates-button" onClick={onCompare}><Columns2 size={16} />用当前文章对比模板</button>
        <div className="section-caption"><span>选择整篇文章的版式</span><span>{String(themes.length).padStart(2, '0')}</span></div>
        <div className="theme-list">{templateOrder.map((theme, index) => { const Icon = icons[theme.id]; return <button key={theme.id} aria-label={`主题：${theme.name}`} aria-pressed={article.themeId === theme.id} className={`theme-card ${article.themeId === theme.id ? 'selected' : ''}`} style={{ '--theme-accent': theme.accent, '--theme-soft': theme.soft } as React.CSSProperties} onClick={() => onTheme(theme.id)}>
          <div className={`theme-sample sample-${theme.id}`}><div className="sample-overline">{theme.label} / 0{index + 1}</div><div className="sample-title">{theme.sampleTitle}</div><div className="sample-line long" /><div className="sample-line" /><div className="sample-quote" /><Icon className="theme-watermark" size={48} strokeWidth={.8} /></div>
          <div className="theme-caption"><div><strong>{theme.name}</strong><small>{theme.features}</small></div><span className="theme-check">{article.themeId === theme.id && <Check size={12} strokeWidth={3} />}</span></div>
        </button> })}</div>
        <div className="sidebar-tip"><span className="tip-icon">✳</span><p>好排版，让内容自己说话。<br /><span>切换主题不会改变文章内容。</span></p></div>
      </> : <div className="detail-settings">
        <div className="section-caption"><span>正文与段落</span><ChevronDown size={13} /></div>
        {range('正文字号', 'fontSize', 12, 24, 1, ' px')}
        {range('文字行高', 'lineHeight', 1.2, 2.6, .05, '')}
        {range('段落间距', 'paragraphSpace', 0, 40, 2, ' px')}
        <div className="settings-divider" />
        <div className="setting-label"><span>主题颜色</span><label className="custom-color" title="自定义主题色"><input type="color" aria-label="自定义主题色" value={t.accent} onChange={event => set('accent', event.target.value)} /><span>{t.accent.toUpperCase()}</span></label></div>
        <div className="color-swatches">{['#416c58', '#354c70', '#ac6c4c', '#6b5b8c', '#b25757', '#353b38'].map(color => <button key={color} aria-label={`主题色 ${color}`} className={t.accent === color ? 'selected' : ''} style={{ background: color }} onClick={() => set('accent', color)}>{t.accent === color && <Check size={13} />}</button>)}</div>
        <div className="settings-divider" />
        {toggle('宋体阅读', 'serif', '使用更有书卷感的正文')}
        {toggle('首行缩进', 'indent', '正文段落缩进两个字符')}
        {toggle('复制时包含标题', 'includeTitle', '公众号标题通常单独填写')}
        {toggle('章节数字装饰', 'numberHeadings', '为未编号的一级标题添加序号')}
        {toggle('开篇导读卡片', 'leadParagraph', '突出文章的第一段介绍')}
        <div className="settings-divider" />
        <div className="section-caption"><span>代码与表格</span><TerminalSquare size={14} /></div>
        {range('代码字号', 'codeFontSize', 11, 18, 1, ' px')}
        {toggle('代码自动换行', 'codeWrap', '控制长行折行，关闭后横向滚动')}
        <p className="code-settings-hint">多行代码各有一个框？点击“一键美化”合并连续代码；手动排版时，选中整段后点击“代码块”。</p>
        <label className="table-mode-setting">表格显示<select aria-label="表格显示" value={t.tableMode} onChange={event => set('tableMode', event.target.value as Typography['tableMode'])}><option value="auto">自动：宽表格横向滚动</option><option value="fit">压缩到正文宽度</option><option value="scroll">保留列宽，横向滚动</option></select><small>自动模式在超过三列时保留阅读列宽。</small></label>
        <button className="reset-button" onClick={() => onTypography(defaultTypography((themes.find(theme => theme.id === article.themeId) || themes[0]).accent))}><RotateCcw size={14} />恢复主题默认设置</button>
      </div>}
    </div>
    <div className="sidebar-bottom"><span className="local-dot" />偏好自动记住<span>新文章沿用</span></div>
  </aside>
}
