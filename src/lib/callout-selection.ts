import type { Editor } from '@tiptap/react'
import { Fragment, NodeRange, type Node as ProseMirrorNode, type ResolvedPos } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { isCalloutKind, safeCallout } from './callouts'

function enclosingCard(position: ResolvedPos) {
  for (let depth = position.depth; depth > 0; depth--) {
    const node = position.node(depth)
    if (node.type.name === 'blockquote' && isCalloutKind(node.attrs.callout)) return { node, position: position.before(depth) }
  }
}

export function selectedCallout(editor: Editor): string {
  const { $from, $to } = editor.state.selection
  const start = enclosingCard($from)
  const end = enclosingCard($to)
  if (start && start.position === end?.position) return start.node.attrs.callout
  // The same style on separate paragraphs still represents separate cards.
  // Show a prompt so choosing that style again fires a native change event.
  if (!$from.sameParent($to) || !$from.parent.isTextblock) return ''
  return safeCallout(editor.getAttributes('paragraph').callout) || 'none'
}

/** Keep block structure and inline marks; existing cards become part of one group. */
function removeCards(node: ProseMirrorNode, suppressInference: boolean): ProseMirrorNode[] {
  if (node.isLeaf && node.type.name !== 'paragraph') return [node]
  const children: ProseMirrorNode[] = []
  node.forEach(child => children.push(...removeCards(child, suppressInference)))
  const content = Fragment.fromArray(children)
  if (node.type.name === 'blockquote' && isCalloutKind(node.attrs.callout)) return children
  if (node.type.name === 'paragraph' && (suppressInference || isCalloutKind(node.attrs.callout))) return [node.type.create({ ...node.attrs, callout: 'none' }, content, node.marks)]
  return [node.copy(content)]
}

/** Apply one card to the selected blocks, using the editor's existing block container. */
export function setCalloutSelection(editor: Editor, value: string): boolean {
  const kind = safeCallout(value)
  if (!kind) return false
  return editor.chain().focus().command(({ tr, dispatch }) => {
    if (dispatch) closeHistory(tr)
    const { $from, $to } = tr.selection
    const active = enclosingCard($from)
    const end = enclosingCard($to)
    if (active && active.position === end?.position) {
      if (kind !== 'none') {
        if (dispatch) tr.setNodeMarkup(active.position, undefined, { ...active.node.attrs, callout: kind })
        return true
      }
      if (dispatch) {
        const content: ProseMirrorNode[] = []
        active.node.forEach(node => content.push(...removeCards(node, true)))
        tr.replaceWith(active.position, active.position + active.node.nodeSize, content)
        tr.setSelection(TextSelection.between(tr.doc.resolve($from.pos - 1), tr.doc.resolve($to.pos - 1))).scrollIntoView()
      }
      return true
    }

    // A selection ending at the start of the next paragraph excludes that paragraph.
    const last = !tr.selection.empty && $to.parent.isTextblock && $to.parentOffset === 0 ? tr.doc.resolve($to.before()) : $to
    let range = $from.blockRange(last)
    if (!range) return false
    const type = editor.schema.nodes.blockquote
    let blocks: ProseMirrorNode[] = []
    while (range) {
      blocks = []
      for (let index = range.startIndex; index < range.endIndex; index++) blocks.push(...removeCards(range.parent.child(index), kind === 'none'))
      if (kind === 'none' || (type.validContent(Fragment.fromArray(blocks)) && range.parent.canReplaceWith(range.startIndex, range.endIndex, type))) break
      // Lists must keep their listItem children. Wrap the containing list instead.
      range = range.depth ? new NodeRange($from, last, range.depth - 1) : null
    }
    if (!range) return false
    if (dispatch) {
      const replacement = kind === 'none' ? Fragment.fromArray(blocks) : Fragment.from(type.create({ callout: kind }, blocks))
      tr.replaceWith(range.start, range.end, replacement)
      const start = range.start + (kind === 'none' ? 0 : 1)
      const finish = range.start + replacement.size - (kind === 'none' ? 0 : 1)
      tr.setSelection(TextSelection.between(tr.doc.resolve(start), tr.doc.resolve(finish))).scrollIntoView()
    }
    return true
  }).run()
}
