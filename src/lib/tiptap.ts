import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { Extension, ReactNodeViewRenderer, type Editor } from '@tiptap/react'
import { TextSelection, type SelectionBookmark } from '@tiptap/pm/state'
import AssetImageView from '../components/AssetImageView'
import { codeLanguage } from './code'
import { safeCallout } from './callouts'
import { codeSettings, imageSettings } from './block-settings'

export const AssetImage = Image.extend({
  addNodeView() { return ReactNodeViewRenderer(AssetImageView) },
  addAttributes() {
    return {
      ...this.parent?.(),
      assetId: {
        default: null,
        parseHTML: element => element.getAttribute('data-asset-id'),
        renderHTML: attributes => attributes.assetId ? { 'data-asset-id': attributes.assetId } : {},
      },
    }
  },
}).configure({ allowBase64: false })

export function toggleCodeSelection(editor: Editor) {
  const { $from, $to } = editor.state.selection
  const range = $from.blockRange($to)
  if (!range || range.endIndex - range.startIndex < 2) return editor.chain().focus().toggleCodeBlock().run()
  const blocks = Array.from({ length: range.endIndex - range.startIndex }, (_, index) => range.parent.child(range.startIndex + index))
  // A multi-paragraph selection represents one snippet. setBlockType would
  // otherwise turn every paragraph into its own independent code card.
  if (!blocks.every(node => ['paragraph', 'codeBlock'].includes(node.type.name) && Array.from({ length: node.childCount }, (_, index) => node.child(index)).every(child => child.isText || child.type.name === 'hardBreak'))) return editor.chain().focus().toggleCodeBlock().run()
  const text = blocks.map(node => node.textBetween(0, node.content.size, '\n', '\n')).join('\n')
  const languages = [...new Set(blocks.filter(node => node.type.name === 'codeBlock' && node.attrs.language).map(node => node.attrs.language))]
  const language = languages.length === 1 ? languages[0] : codeLanguage(text)
  return editor.chain().focus().command(({ tr, dispatch }) => {
    const block = editor.schema.nodes.codeBlock.create({ language }, text ? editor.schema.text(text) : undefined)
    if (dispatch) {
      tr.replaceWith(range.start, range.end, block)
      tr.setSelection(TextSelection.create(tr.doc, range.start + 1, range.start + 1 + text.length))
    }
    return true
  }).run()
}

export function insertArticleTable(editor: Editor, options: { rows: number; cols: number; header: boolean }, bookmark?: SelectionBookmark) {
  return editor.chain().focus().command(({ tr }) => {
    if (bookmark) tr.setSelection(bookmark.resolve(tr.doc))
    return true
  }).command(({ tr, commands }) => {
    // A table is a separate block. Keep an existing snippet intact even when
    // its cursor is in the middle of a line when the insert dialog opens.
    if (tr.selection.$from.parent.type.name !== 'codeBlock') return commands.insertTable({ rows: options.rows, cols: options.cols, withHeaderRow: options.header })
    const position = tr.selection.$from.after()
    const table = editor.schema.nodeFromJSON({ type: 'table', attrs: { headerMode: 'manual' }, content: Array.from({ length: options.rows }, (_, row) => ({
      type: 'tableRow', content: Array.from({ length: options.cols }, () => ({ type: options.header && row === 0 ? 'tableHeader' : 'tableCell', content: [{ type: 'paragraph' }] })),
    })) })
    tr.insert(position, table)
    tr.setSelection(TextSelection.create(tr.doc, position + 4)).scrollIntoView()
    return true
  }).updateAttributes('table', { headerMode: 'manual' }).run()
}

export function editorExtensions() {
  return [
    Extension.create({
      name: 'blockPresentation',
      addGlobalAttributes() {
        return [
          { types: ['codeBlock'], attributes: {
            codeTitle: { default: '', parseHTML: element => codeSettings({ codeTitle: element.getAttribute('data-code-title') }).codeTitle, renderHTML: attrs => codeSettings(attrs).codeTitle ? { 'data-code-title': codeSettings(attrs).codeTitle } : {} },
            codeWrap: { default: null, parseHTML: element => codeSettings({ codeWrap: element.getAttribute('data-code-wrap') }).codeWrap, renderHTML: attrs => codeSettings(attrs).codeWrap ? { 'data-code-wrap': codeSettings(attrs).codeWrap } : {} },
            highlightLines: { default: '', parseHTML: element => codeSettings({ highlightLines: element.getAttribute('data-code-highlight') }).highlightLines, renderHTML: attrs => codeSettings(attrs).highlightLines ? { 'data-code-highlight': codeSettings(attrs).highlightLines } : {} },
          } },
          { types: ['image'], attributes: {
            displayWidth: { default: null, parseHTML: element => imageSettings({ displayWidth: element.getAttribute('data-image-width') }).displayWidth, renderHTML: attrs => imageSettings(attrs).displayWidth ? { 'data-image-width': imageSettings(attrs).displayWidth } : {} },
            imageAlign: { default: 'center', parseHTML: element => imageSettings({ imageAlign: element.getAttribute('data-image-align') }).imageAlign, renderHTML: attrs => ({ 'data-image-align': imageSettings(attrs).imageAlign }) },
            imageFrame: { default: 'none', parseHTML: element => imageSettings({ imageFrame: element.getAttribute('data-image-frame') }).imageFrame, renderHTML: attrs => ({ 'data-image-frame': imageSettings(attrs).imageFrame }) },
          } },
          { types: ['table'], attributes: {
            headerMode: { default: null, parseHTML: element => element.getAttribute('data-header-mode') === 'manual' ? 'manual' : null, renderHTML: attrs => attrs.headerMode === 'manual' ? { 'data-header-mode': 'manual' } : {} },
          } },
        ]
      },
    }),
    Extension.create({
      name: 'calloutStyle',
      addGlobalAttributes() {
        return [{ types: ['paragraph', 'blockquote'], attributes: { callout: {
          default: null,
          parseHTML: element => safeCallout(element.getAttribute('data-callout')),
          renderHTML: attributes => safeCallout(attributes.callout) ? { 'data-callout': safeCallout(attributes.callout) } : {},
        } } }]
      },
    }),
    Extension.create({
      name: 'codeSelection', priority: 1100,
      addKeyboardShortcuts() { return { 'Mod-Alt-c': () => toggleCodeSelection(this.editor) } },
    }),
    StarterKit.configure({ link: { openOnClick: false, autolink: false, protocols: ['https', 'http', 'mailto'] }, heading: { levels: [1, 2, 3] }, codeBlock: { enableTabIndentation: true, tabSize: 4 } }),
    AssetImage,
    Table.configure({ resizable: false }), TableRow, TableCell, TableHeader,
    Placeholder.configure({ placeholder: '从这里开始写作，或直接粘贴你的文章…' }),
  ]
}
