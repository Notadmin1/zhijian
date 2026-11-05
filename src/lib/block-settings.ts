type Attributes = Record<string, unknown> | null | undefined

export function highlightRanges(value: unknown): [number, number][] {
  return String(value ?? '').slice(0, 160).split(',').flatMap(part => {
    const match = part.trim().match(/^(\d{1,5})(?:\s*-\s*(\d{1,5}))?$/)
    if (!match) return []
    const start = Number(match[1])
    const end = Number(match[2] || match[1])
    return start > 0 && end >= start ? [[start, end] as [number, number]] : []
  })
}

export function codeSettings(attrs: Attributes) {
  return {
    codeTitle: String(attrs?.codeTitle ?? '').replace(/[\r\n]/g, ' ').slice(0, 120),
    codeWrap: attrs?.codeWrap === 'wrap' || attrs?.codeWrap === 'scroll' ? attrs.codeWrap : null,
    highlightLines: highlightRanges(attrs?.highlightLines).map(([start, end]) => start === end ? String(start) : `${start}-${end}`).join(','),
  }
}

export function hasCodeSettings(attrs: Attributes) {
  const settings = codeSettings(attrs)
  return Boolean(settings.codeTitle || settings.codeWrap || settings.highlightLines)
}

export function imageSettings(attrs: Attributes) {
  const width = Number(attrs?.displayWidth)
  return {
    displayWidth: Number.isFinite(width) && width >= 25 && width <= 100 ? Math.round(width) : null,
    imageAlign: attrs?.imageAlign === 'left' || attrs?.imageAlign === 'right' ? attrs.imageAlign : 'center',
    imageFrame: attrs?.imageFrame === 'border' || attrs?.imageFrame === 'shadow' ? attrs.imageFrame : 'none',
  }
}

export function imagePresentation(attrs: Attributes) {
  const { displayWidth, imageAlign, imageFrame } = imageSettings(attrs)
  return {
    width: displayWidth ? `${displayWidth}%` : undefined,
    margin: imageAlign === 'left' ? '0 auto 0 0' : imageAlign === 'right' ? '0 0 0 auto' : '0 auto',
    border: imageFrame === 'border' ? '1px solid #dce3df' : undefined,
    boxShadow: imageFrame === 'shadow' ? '0 5px 18px #263c3024' : undefined,
  }
}
