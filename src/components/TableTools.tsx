import type { Editor } from '@tiptap/react'
import { Table2 } from 'lucide-react'

export default function TableTools({ editor }: { editor: Editor }) {
  const controls: [string, () => boolean, boolean][] = [
    ['上方插行', () => editor.chain().focus().addRowBefore().run(), editor.can().addRowBefore()],
    ['下方插行', () => editor.chain().focus().addRowAfter().run(), editor.can().addRowAfter()],
    ['左侧插列', () => editor.chain().focus().addColumnBefore().run(), editor.can().addColumnBefore()],
    ['右侧插列', () => editor.chain().focus().addColumnAfter().run(), editor.can().addColumnAfter()],
    ['删除当前行', () => editor.chain().focus().deleteRow().run(), editor.can().deleteRow()],
    ['删除当前列', () => editor.chain().focus().deleteColumn().run(), editor.can().deleteColumn()],
    ['合并单元格', () => editor.chain().focus().mergeCells().run(), editor.can().mergeCells()],
    ['拆分单元格', () => editor.chain().focus().splitCell().run(), editor.can().splitCell()],
    ['切换表头', () => editor.chain().focus().toggleHeaderRow().updateAttributes('table', { headerMode: 'manual' }).run(), editor.can().toggleHeaderRow()],
    ['删除表格', () => editor.chain().focus().deleteTable().run(), editor.can().deleteTable()],
  ]
  return <div className="block-tools table-tools" aria-label="当前表格操作"><div className="table-tools-title"><Table2 size={15} /><strong>当前表格</strong><span>拖选多个单元格后可合并；操作可撤销</span></div><div className="table-tools-actions">{controls.map(([label, action, enabled]) => <button key={label} disabled={!enabled} className={label.startsWith('删除') ? 'table-delete' : ''} onClick={action}>{label}</button>)}</div></div>
}
