import type { JSONContent } from '@tiptap/react'
import type { Article } from '../types'
import { safeTypography, themes } from './themes'
import { nodeText } from './document'
import { codeLanguage } from './code'
import { calloutKinds, isCalloutKind, type CalloutKind } from './callouts'
import { codeSettings, highlightRanges, imagePresentation, imageSettings } from './block-settings'
import { blockGaps, readingMetrics, withBlockMargins } from './reading-style'

export const escapeHTML = (text: unknown) => String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
export function safeURL(value: unknown, image = false): string {
  const src = String(value || '').trim()
  if (/^https?:\/\//i.test(src)) return src
  if (!image && /^(mailto:|tel:)/i.test(src)) return src
  return ''
}
export interface RenderOptions { mode?: 'preview' | 'clipboard' | 'download'; assets?: Record<string, string>; imagePolicy?: 'embed' | 'placeholder' }

export function renderArticle(article: Article, options: RenderOptions = {}): string {
  const { mode = 'preview', assets = {}, imagePolicy = 'embed' } = options
  const t = safeTypography(article.typography)
  const theme = themes.find(x => x.id === article.themeId) || themes[0]
  const color = t.accent
  const research = article.themeId === 'research'
  const tutorial = article.themeId === 'tutorial'
  const minimal = article.themeId === 'minimal'
  const simple = t.decoration === 'simple'
  const expressive = t.decoration === 'expressive'
  const metrics = readingMetrics(t)
  const space = (value: number) => Math.round(value * metrics.scale)
  const font = t.serif ? 'Georgia, "Noto Serif SC", "Songti SC", SimSun, serif' : '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
  const pStyle = `margin:0 0 ${t.paragraphSpace}px;line-height:${t.lineHeight};font-size:${t.fontSize}px;letter-spacing:${minimal ? '.2' : '.4'}px;overflow-wrap:break-word;${t.indent ? 'text-indent:2em;' : ''}`
  let imageIndex = 0
  let sectionIndex = 0
  let outlineIndex = 0
  let firstParagraph = true
  let inTable = false
  let inListItem = false
  let inQuote = false
  let inCallout = false
  let tableRow = 0
  const cardParagraphStyle = `margin:0;font-size:${t.fontSize - 1}px;line-height:${t.lineHeight};color:#39464b;overflow-wrap:break-word;text-indent:0;`
  const renderCard = (kind: CalloutKind, contents: string) => {
    const card = calloutKinds[kind]
    const metadata = mode === 'preview' ? ` data-callout-kind="${kind}"` : ''
    return `<section${metadata} style="margin:${space(20)}px 0 ${space(24)}px;padding:${simple ? `${space(7)}px 0 ${space(7)}px ${space(15)}px` : `${space(expressive ? 20 : 17)}px ${space(expressive ? 22 : 19)}px`};border-left:${simple ? 2 : expressive ? 4 : 3}px solid ${card.color};border-radius:${simple || minimal ? 0 : expressive ? 8 : 5}px;background:${simple ? 'transparent' : card.background};font-size:${t.fontSize - 1}px;line-height:${t.lineHeight};color:#39464b;">${contents}</section>`
  }
  const render = (node: JSONContent): string => {
    const inner = () => (node.content || []).map(render).join('')
    switch (node.type) {
      case 'doc': {
        const blocks = node.content || []
        const gaps = t.smartSpacing ? blockGaps(blocks, t) : []
        return blocks.map((block, index) => {
          const html = t.smartSpacing ? withBlockMargins(render(block), gaps[index]) : render(block)
          return mode === 'preview' ? html.replace(/^<([a-z][a-z0-9]*)/i, `<$1 data-block-index="${index}"`) : html
        }).join('')
      }
      case 'text': {
        let result = escapeHTML(node.text || '')
        for (const mark of node.marks || []) {
          if (mark.type === 'bold') result = `<strong style="font-weight:700;color:${simple ? 'inherit' : color};">${result}</strong>`
          else if (mark.type === 'italic') result = `<em>${result}</em>`
          else if (mark.type === 'strike') result = `<s>${result}</s>`
          else if (mark.type === 'underline') result = `<u>${result}</u>`
          else if (mark.type === 'code') result = `<code style="background:#f1f2f1;padding:2px 4px;border-radius:3px;font-family:monospace;">${result}</code>`
          else if (mark.type === 'link') {
            const href = safeURL(mark.attrs?.href)
            if (href) result = `<a href="${escapeHTML(href)}" style="color:${color};text-decoration:underline;">${result}</a>`
          }
        }
        return result
      }
      case 'paragraph': {
        if (!inTable && !inCallout && isCalloutKind(node.attrs?.callout)) {
          if (!inListItem && !inQuote) firstParagraph = false
          return renderCard(node.attrs.callout, `<p style="${cardParagraphStyle}">${inner() || '<br />'}</p>`)
        }
        const lead = firstParagraph && t.leadParagraph && !inTable && !inListItem && !inQuote && !inCallout && nodeText(node).length >= 45 && !/^https?:\/\//.test(nodeText(node))
        if (!inTable && !inListItem && !inQuote && !inCallout) firstParagraph = false
        const style = inTable ? `margin:0 0 ${space(4)}px;font-size:${Math.max(12, t.fontSize - 2)}px;line-height:1.65;overflow-wrap:anywhere;` : inCallout ? cardParagraphStyle : inListItem || inQuote ? `${pStyle}margin-bottom:${space(4)}px;` : pStyle
        const leadStyle = simple ? `border-left:2px solid #ccd3cc;padding:${space(5)}px 0 ${space(5)}px ${space(16)}px;color:#58665d;text-indent:0;margin-bottom:${space(26)}px;` : expressive ? `background:${theme.soft};border-top:3px solid ${color};padding:${space(23)}px ${space(24)}px;border-radius:8px;color:#506057;text-indent:0;margin-bottom:${space(32)}px;` : minimal ? `border-left:2px solid #ccd3cc;padding:${space(4)}px 0 ${space(4)}px ${space(18)}px;color:#69736b;margin-bottom:${space(30)}px;text-indent:0;` : research ? `background:${theme.soft};border:1px solid #d9e5e5;border-top:3px solid ${color};padding:${space(20)}px ${space(22)}px;border-radius:3px;color:#50676b;margin-bottom:${space(30)}px;text-indent:0;` : tutorial ? `background:${theme.soft};border-left:3px solid ${color};padding:${space(19)}px ${space(21)}px;border-radius:0 8px 8px 0;color:#746050;margin-bottom:${space(28)}px;text-indent:0;` : `background:${theme.soft};padding:${space(18)}px ${space(20)}px;border-radius:5px;border-top:2px solid ${color};color:#647064;margin-bottom:${space(26)}px;font-size:${Math.max(14, t.fontSize - 1)}px;text-indent:0;line-height:${t.lineHeight};`
        return `<p style="${style}${lead ? leadStyle : ''}">${inner() || '<br />'}</p>`
      }
      case 'hardBreak': return '<br />'
      case 'heading': {
        const level = Math.max(1, Math.min(6, Number(node.attrs?.level) || 2))
        const size = level <= 2 ? t.fontSize + 4 : t.fontSize + 2
        const major = level <= 2
        if (major) sectionIndex++
        const numbered = /^(?:[一二三四五六七八九十]+[、．.]|第.+[章节]|\d+[、.．）)]|\d{2}\s)/.test(nodeText(node).trim())
        const badgeStyle = simple || (minimal && !expressive) ? `font:12px/1.6 Georgia,serif;color:#737e75;margin-right:12px;` : tutorial ? `display:inline-block;vertical-align:middle;font:600 13px/30px Arial,sans-serif;min-width:30px;text-align:center;margin-right:12px;border-radius:50%;background:${color};color:white;` : `display:inline-block;vertical-align:middle;font:600 12px/26px Arial,sans-serif;min-width:27px;text-align:center;padding:0 4px;margin-right:10px;border-radius:3px;background:${color};color:#fff;`
        const badge = major && t.numberHeadings && !numbered ? `<span style="${badgeStyle}">${String(sectionIndex).padStart(2, '0')}${minimal ? ' /' : ''}</span>` : ''
        let style = `margin:${space(major ? 34 : 25)}px 0 ${space(major ? 19 : 13)}px;font-size:${major ? size : t.fontSize + 1}px;line-height:1.65;font-weight:700;color:${color};letter-spacing:0.5px;`
        if (simple) style += `color:#35453c;letter-spacing:0;${major ? `border-bottom:1px solid #e1e7e1;padding-bottom:${space(10)}px;` : ''}`
        else if (expressive) style += major ? `background:${theme.soft};border-left:4px solid ${color};padding:${space(14)}px ${space(16)}px;border-radius:0 8px 8px 0;` : `border-left:3px solid ${color};padding-left:${space(12)}px;`
        else {
          if ((!major && !minimal) || (article.themeId === 'botanical' && !badge)) style += `border-left:3px solid ${color};padding-left:${space(12)}px;`
          if (major && article.themeId === 'editorial') style += `border-bottom:1px solid #d9dee5;padding-bottom:${space(12)}px;`
          if (major && article.themeId === 'warm') style += `background:${theme.soft};padding:${space(11)}px ${space(14)}px;border-radius:4px;`
          if (major && article.themeId === 'technical') style += `border-bottom:2px solid ${theme.soft};padding-bottom:${space(12)}px;`
          if (research && major) style += `background:${theme.soft};border-left:4px solid ${color};padding:${space(13)}px ${space(15)}px;margin-top:${space(38)}px;border-radius:0 4px 4px 0;`
          if (tutorial && major) style += `border-bottom:1px solid #e9d6c5;padding-bottom:${space(13)}px;margin-top:${space(40)}px;`
          if (minimal) style += `font-size:${major ? t.fontSize + 3 : t.fontSize + 1}px;letter-spacing:0;margin-top:${space(major ? 42 : 28)}px;margin-bottom:${space(18)}px;${major ? `border-bottom:1px solid #e8ece7;padding-bottom:${space(13)}px;` : ''}`
        }
        const navigation = mode === 'preview' ? ` data-section-index="${outlineIndex}"` : ''
        outlineIndex++
        return `<h${level}${navigation} style="${style}">${badge}${inner()}</h${level}>`
      }
      case 'blockquote': {
        if (!inCallout && isCalloutKind(node.attrs?.callout)) {
          if (!inListItem && !inQuote) firstParagraph = false
          inCallout = true
          const children = node.content || []
          const contents = children.map((child, index) => withBlockMargins(render(child), index === children.length - 1 ? 0 : space(8))).join('')
          inCallout = false
          return renderCard(node.attrs.callout, contents)
        }
        const previous = inQuote
        inQuote = true
        const contents = inner()
        inQuote = previous
        return `<blockquote style="margin:${space(24)}px 0;padding:${simple || minimal ? `${space(3)}px 0 1px ${space(19)}px` : `${space(expressive ? 22 : 18)}px ${space(expressive ? 22 : 20)}px ${space(2)}px`};border-left:${simple || minimal ? 2 : expressive ? 4 : 3}px solid ${simple || minimal ? '#ccd3cc' : color};background:${simple || minimal ? 'transparent' : theme.soft};color:#626b65;font-size:${t.fontSize - 1}px;">${contents}</blockquote>`
      }
      case 'bulletList': return `<ul style="margin:0 0 ${t.paragraphSpace}px;padding-left:24px;list-style-type:disc;">${inner()}</ul>`
      case 'orderedList': return `<ol start="${Math.max(1, Math.trunc(Number(node.attrs?.start) || 1))}" style="margin:0 0 ${t.paragraphSpace}px;padding-left:24px;">${inner()}</ol>`
      case 'listItem': {
        const previous = inListItem
        inListItem = true
        const contents = inner()
        inListItem = previous
        return `<li style="margin:0 0 ${space(6)}px;padding-left:3px;">${contents}</li>`
      }
      case 'horizontalRule': return `<hr style="border:0;border-top:1px solid ${expressive ? color : '#e2e6e2'};margin:${space(28)}px 0;" />`
      case 'codeBlock': {
        const text = (node.content || []).map(n => n.text || '').join('')
        const language = String(node.attrs?.language || codeLanguage(text)).replace(/[^\w+-]/g, '').slice(0, 20)
        const label = language.toUpperCase()
        const local = codeSettings(node.attrs)
        const wrap = local.codeWrap ? local.codeWrap === 'wrap' : t.codeWrap
        const dark = !simple && (article.themeId === 'technical' || research)
        if (inTable) return `${local.codeTitle ? `<p style="font-size:11px;color:#718092;margin:0 0 4px;">${escapeHTML(local.codeTitle)}</p>` : ''}<pre style="margin:0 0 4px;padding:3px 4px;background:#f1f3f5;white-space:${local.codeWrap === 'scroll' ? 'pre' : 'pre-wrap'};overflow-wrap:${local.codeWrap === 'scroll' ? 'normal' : 'anywhere'};overflow-x:auto;font:${Math.min(13, t.codeFontSize)}px/1.7 Consolas,Monaco,monospace;color:#435268;text-align:left;tab-size:4;"><code style="font:inherit;white-space:inherit;">${highlightCode(text, false, language, local.highlightLines)}</code></pre>`
        const background = research ? '#182d34' : dark ? '#1f2c3d' : tutorial ? '#fcfaf7' : '#f6f8fa'
        const codeHeader = simple || research || tutorial || minimal ? `<span style="font-weight:600;">${!simple && research ? 'CODE / ' : !simple && tutorial ? '示例 · ' : ''}${escapeHTML(label)}</span>` : `<span style="color:#d1a29b;">●</span> <span style="color:#d8c391;">●</span> <span style="color:#a9c1a4;">●</span><span style="margin-left:13px;">${escapeHTML(label)}</span>`
        const caption = local.codeTitle ? `<span style="margin-left:14px;letter-spacing:normal;overflow-wrap:anywhere;font-family:Consolas,monospace;">${escapeHTML(local.codeTitle)}</span>` : ''
        return `<section style="margin:${space(22)}px 0 ${space(25)}px;border:1px solid ${dark ? '#293c52' : '#e3e8ee'};${expressive || (!simple && tutorial) ? `border-left:3px solid ${color};` : ''}border-radius:${simple || minimal ? 3 : expressive ? 9 : 7}px;overflow:hidden;background:${simple ? '#f7f8f9' : background};"><p style="padding:${space(simple || minimal ? 8 : 10)}px ${space(14)}px;margin:0;border-bottom:1px solid ${dark ? '#35465b' : '#e6ebf0'};font:11px/1.4 Arial,sans-serif;letter-spacing:${simple ? '.5' : '1.5'}px;color:${dark ? '#a3b6cc' : '#718092'};">${codeHeader}${caption}</p><pre style="margin:0;padding:${space(16)}px ${space(17)}px;white-space:${wrap ? 'pre-wrap' : 'pre'};overflow-wrap:${wrap ? 'anywhere' : 'normal'};overflow-x:auto;font:${t.codeFontSize}px/${metrics.codeLineHeight} Consolas,Monaco,monospace;color:${dark ? '#e1eaf5' : '#435268'};tab-size:4;text-align:left;letter-spacing:normal;"><code style="font:inherit;white-space:inherit;">${highlightCode(text, dark, language, local.highlightLines)}</code></pre></section>`
      }
      case 'image': {
        imageIndex++
        const assetId = String(node.attrs?.assetId || '')
        const caption = String(node.attrs?.title || '')
        const alt = String(node.attrs?.alt || `图片 ${imageIndex}`)
        const local = assetId ? assets[assetId] || '' : ''
        const remote = safeURL(node.attrs?.src, true)
        const permitted = /^data:image\/(png|jpeg|gif|webp|bmp|avif);base64,/i.test(local) || (mode === 'preview' && local.startsWith('blob:'))
        const src = imagePolicy === 'placeholder' ? '' : (permitted ? local : '') || remote
        if (!src) return `<p style="padding:18px;border:1px dashed #cdd5cc;text-align:center;color:#7c847b;font-size:13px;margin:20px 0;">[图片 ${imageIndex}：${escapeHTML(caption || alt)}${mode === 'clipboard' ? '，请在公众号后台上传替换' : '，图片暂不可用'}]</p>`
        const presentation = imagePresentation(node.attrs)
        const imageStyle = `${presentation.width ? `width:${presentation.width};` : ''}margin:${presentation.margin};${presentation.border ? `border:${presentation.border};` : ''}${presentation.boxShadow ? `box-shadow:${presentation.boxShadow};` : ''}`
        return `<section style="margin:${space(24)}px 0;text-align:${imageSettings(node.attrs).imageAlign};"><img src="${escapeHTML(src)}" alt="${escapeHTML(alt)}" style="display:block;max-width:100%;height:auto;border-radius:${simple ? 0 : expressive ? 7 : 5}px;box-sizing:border-box;${imageStyle}" /><p style="font-size:12px;color:#788372;line-height:1.7;margin:${space(10)}px 0 0;letter-spacing:0.5px;">图 ${String(imageIndex).padStart(2, '0')}${caption ? ` · ${escapeHTML(caption)}` : ''}</p></section>`
      }
      case 'table': {
        const columns = Math.max(1, ...(node.content || []).map(row => (row.content || []).reduce((sum, cell) => sum + Math.max(1, Math.min(100, Number(cell.attrs?.colspan) || 1)), 0)))
        const wideExamples = columns >= 3 && node.content?.some(row => row.content?.some(cell => cell.content?.some(block => block.type === 'codeBlock' && nodeText(block).length > 65)))
        const scroll = t.tableMode === 'scroll' || (t.tableMode === 'auto' && (columns > 3 || wideExamples))
        const previousTable = inTable
        const previousRow = tableRow
        inTable = true
        tableRow = 0
        const contents = inner()
        inTable = previousTable
        tableRow = previousRow
        return `<section style="overflow-x:auto;margin:${space(24)}px 0;"><table style="border-collapse:collapse;width:100%;${scroll ? `min-width:${Math.min(960, Math.max(wideExamples ? 660 : 480, columns * 120))}px;` : ''}font-size:${Math.max(12, t.fontSize - 2)}px;table-layout:fixed;">${contents}</table></section>`
      }
      case 'tableRow': tableRow++; return `<tr>${inner()}</tr>`
      case 'tableCell': case 'tableHeader': {
        const tag = node.type === 'tableHeader' ? 'th' : 'td'
        const colspan = Math.max(1, Math.min(100, Number(node.attrs?.colspan) || 1))
        const rowspan = Math.max(1, Math.min(100, Number(node.attrs?.rowspan) || 1))
        return `<${tag} colspan="${colspan}" rowspan="${rowspan}" style="border:${simple || minimal ? '0;border-bottom:1px solid #e2e7e1' : '1px solid #dde2dc'};padding:${space(research || tutorial ? 12 : 11)}px ${space(research || tutorial ? 11 : 10)}px;text-align:left;vertical-align:top;overflow-wrap:anywhere;${tag === 'th' ? `background:${simple ? '#fff' : theme.soft};font-weight:700;border-top:${simple || minimal ? 1 : expressive ? 3 : 2}px solid ${color};` : `background:${!simple && research && tableRow % 2 === 0 ? '#f7faf9' : '#fff'};`}">${inner()}</${tag}>`
      }
      default: return inner()
    }
  }
  const title = t.includeTitle ? `<h1 style="font-size:25px;line-height:1.5;font-weight:700;margin:0 0 ${space(24)}px;color:#303b34;">${escapeHTML(article.title)}</h1>` : ''
  return `<section style="font-family:${escapeHTML(font)};font-size:${t.fontSize}px;line-height:${t.lineHeight};color:#3c453f;text-align:left;word-wrap:break-word;max-width:100%;">${title}${render(article.document)}</section>`
}

function highlightCode(code: string, dark = false, language = 'text', highlighted = ''): string {
  const markup = /^(xml|html)$/i.test(language)
  const tokens = markup
    ? /(<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<\/?[\w:.-]+|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[\w:.-]+(?=\s*=)|\/?>)/gi
    : /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|#[^\n]*|\/\*[\s\S]*?\*\/|\/\/[^\n]*|\b(?:import|from|as|def|class|return|if|else|elif|for|while|try|except|with|in|not|and|or|const|let|var|val|fun|function|async|await|true|false|null|True|False|None|print|new|public|private|protected|static|final|void|int|boolean|package|extends|implements|throw|throws)\b|--[\w-]+|\b[A-Z][\w$]*\b|\b[\w$]+(?=\s*\()|\b\d+(?:\.\d+)?\b)/g
  let html = ''
  let last = 0
  for (const match of code.matchAll(tokens)) {
    html += escapeHTML(code.slice(last, match.index))
    const value = match[0]
    const color = /^["']/.test(value) ? (dark ? '#aad6b4' : '#49805d')
      : /^(?:#|\/\/|\/\*|<!--)/.test(value) ? (dark ? '#9eafc3' : '#728090')
      : (markup && /^<|^\/?>$/.test(value)) || (!markup && /^[\w$]+$/.test(value) && code[match.index! + value.length] === '(') ? (dark ? '#9ac8f5' : '#376b9d')
      : markup || /^\d|^--|^[A-Z]/.test(value) ? (dark ? '#edc387' : '#956c27')
      : (dark ? '#cdb6ed' : '#8861aa')
    html += `<span style="color:${color};">${escapeHTML(value).replace(/\n/g, `</span>\n<span style="color:${color};">`)}</span>`
    last = match.index! + value.length
  }
  const complete = html + escapeHTML(code.slice(last))
  const ranges = highlightRanges(highlighted)
  return ranges.length ? complete.split('\n').map((line, index) => ranges.some(([start, end]) => index + 1 >= start && index + 1 <= end) ? `<span style="background:${dark ? '#375550' : '#fff0bb'};border-radius:2px;">${line}</span>` : line).join('\n') : complete
}

export const htmlFile = (title: string, body: string) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title)}</title><style>body{margin:0;background:#f4f6f3;color:#364338;font-family:system-ui,"Microsoft YaHei",sans-serif}.export-toolbar{position:sticky;top:0;z-index:2;background:#fffffff5;border-bottom:1px solid #e0e6dd;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px}.export-toolbar button{border:0;background:#416c58;color:white;padding:11px 17px;border-radius:6px;cursor:pointer;white-space:nowrap}.export-paper{max-width:720px;box-sizing:border-box;margin:30px auto;background:white;padding:40px 42px;border:1px solid #e4e9df;border-radius:9px}.export-title{font-size:27px;line-height:1.6;margin:0 0 28px;color:#33412f}.export-help{color:#8e9c86;font-size:11px;line-height:1.8;max-width:700px;margin:16px auto 35px;padding:0 20px}@media(max-width:600px){.export-paper{padding:26px 22px;margin:18px 10px}.export-toolbar{padding:10px 14px}.export-toolbar span{font-size:10px}}</style></head><body><header class="export-toolbar"><span id="copy-status">美化完成 · 可直接复制排版图文</span><button id="copy-article">复制到公众号</button></header><main class="export-paper">${/<h1[ >]/i.test(body) ? '' : `<h1 class="export-title">${escapeHTML(title)}</h1>`}<article id="export-article">${body}</article></main><p class="export-help">公众号标题单独填写。粘贴后请检查图片是否被平台接收；如未接收，可从本文保存图片后上传。</p><script>document.getElementById('copy-article').onclick=async function(){var article=document.getElementById('export-article');var status=document.getElementById('copy-status');try{if(navigator.clipboard&&window.ClipboardItem&&window.isSecureContext){await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([article.innerHTML],{type:'text/html'}),'text/plain':new Blob([article.innerText],{type:'text/plain'})})]);}else{var selection=getSelection();var range=document.createRange();range.selectNodeContents(article);selection.removeAllRanges();selection.addRange(range);if(!document.execCommand('copy'))throw new Error('manual');selection.removeAllRanges();}status.textContent='已复制，请粘贴到公众号后台并检查图片';}catch(error){var selection=getSelection();var range=document.createRange();range.selectNodeContents(article);selection.removeAllRanges();selection.addRange(range);status.textContent='正文已选中，请按 Ctrl+C 复制，再粘贴到公众号';}};</script></body></html>`
