import { ListTree, X } from 'lucide-react'
import type { OutlineEntry } from '../lib/outline'

export default function OutlinePanel({ entries, selected, onNavigate, onClose }: {
  entries: OutlineEntry[]; selected?: number; onNavigate: (index: number) => void; onClose: () => void
}) {
  const minimumLevel = Math.min(...entries.map(entry => entry.level), 2)
  return <aside className="outline-panel" aria-label="文章章节目录">
    <div className="sidebar-heading"><span><ListTree size={16} />文章目录 <small>{entries.length}</small></span><button className="icon-button" aria-label="收起文章目录" onClick={onClose}><X size={16} /></button></div>
    <p className="outline-description">点击章节，定位到当前编辑或美化视图。</p>
    <nav className="outline-list" aria-label="章节导航">{entries.length ? entries.map(entry => <button key={entry.index} aria-current={selected === entry.index ? 'location' : undefined} className={selected === entry.index ? 'selected' : ''} style={{ paddingLeft: 16 + Math.max(0, entry.level - minimumLevel) * 15 }} onClick={() => onNavigate(entry.index)}><span className="outline-marker" /><span>{entry.text}</span></button>) : <div className="outline-empty"><ListTree size={28} /><strong>还没有章节标题</strong><p>点击“一键美化”识别标题，或在编辑器里设置标题层级。</p></div>}</nav>
    <div className="sidebar-bottom">目录随正文更新<span>仅工作台可见</span></div>
  </aside>
}
