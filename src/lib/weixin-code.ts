/**
 * Export rendered code as ordinary rich-text lines for the WeChat editor.
 * Literal newlines in <pre> depend on whitespace CSS surviving every editor
 * import. Paragraph boundaries and non-breaking spaces survive that cleanup.
 * This only changes the outgoing HTML, never the article or its source code.
 */
export function prepareWeixinCodeBlocks(root: ParentNode): void {
  for (const pre of root.querySelectorAll('pre')) {
    const owner = pre.ownerDocument
    const block = owner.createElement('section')
    block.style.cssText = pre.style.cssText
    block.style.whiteSpace = pre.style.whiteSpace === 'pre' ? 'nowrap' : 'normal'

    const sources: Element[] = []
    let targets: Element[] = []
    let column = 0
    const nextLine = () => {
      const line = owner.createElement('p')
      // Explicit resets also override the sync adapter's default paragraph CSS.
      line.style.cssText = 'margin:0;padding:0;border:0;font:inherit;color:inherit;letter-spacing:normal;text-indent:0;text-align:left;white-space:inherit;overflow-wrap:inherit;'
      const code = owner.createElement('code')
      code.style.cssText = 'padding:0;background:none;border:0;border-radius:0;font:inherit;color:inherit;white-space:inherit;letter-spacing:normal;'
      line.append(code)
      block.append(line)
      targets = [code]
      for (const source of sources) {
        const clone = source.cloneNode(false) as Element
        targets[targets.length - 1].append(clone)
        targets.push(clone)
      }
      column = 0
    }
    const visit = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const parts = (node.textContent || '').replace(/\r\n?/g, '\n').split('\n')
        parts.forEach((part, index) => {
          if (index) nextLine()
          let text = ''
          for (const char of part) {
            if (char === '\t') {
              const width = 4 - column % 4
              text += '\u00a0'.repeat(width)
              column += width
            } else {
              text += char === ' ' ? '\u00a0' : char
              column++
            }
          }
          if (text) targets[targets.length - 1].append(owner.createTextNode(text))
        })
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element
        if (element.tagName === 'BR') { nextLine(); return }
        const clone = element.cloneNode(false) as Element
        targets[targets.length - 1].append(clone)
        sources.push(element)
        targets.push(clone)
        for (const child of element.childNodes) visit(child)
        sources.pop()
        targets.pop()
      }
    }

    nextLine()
    const source = pre.querySelector('code') || pre
    for (const child of source.childNodes) visit(child)
    // An empty paragraph otherwise disappears when the editor imports HTML.
    // Include leading/trailing empty lines as well as empty lines in the middle.
    for (const line of block.children) {
      if (!line.textContent?.trim()) {
        let leaf = line.lastElementChild!
        while (leaf.lastElementChild) leaf = leaf.lastElementChild
        // Some importers remove elements whose textContent.trim() is empty.
        // The zero-width marker keeps a whitespace-only line from being removed.
        leaf.append(owner.createTextNode(`${line.textContent ? '' : '\u00a0'}\u200b`))
      }
    }
    pre.replaceWith(block)
  }
}
