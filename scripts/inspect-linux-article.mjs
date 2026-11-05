import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import mammoth from 'mammoth'
import JSZip from 'jszip'
import { JSDOM } from 'jsdom'

const file = process.argv[2]
if (!file) throw new Error('Pass a Word file')
const output = process.argv[3] || 'output/Linux日志排版优化'
await mkdir(output, { recursive: true })
const buffer = await readFile(file)
const zip = await JSZip.loadAsync(buffer)
const xml = await zip.file('word/document.xml').async('string')
const styles = await zip.file('word/styles.xml')?.async('string') || ''
const raw = await mammoth.convertToHtml({ buffer })
const dom = new JSDOM(raw.value).window.document
const paragraphs = [...dom.body.children].map((n, i) => ({ i, type: n.tagName, text: n.textContent, html: n.outerHTML.replace(/src="data:[^"]+"/g, 'src="[image]"') }))
await writeFile(`${output}/word.html`, raw.value)
await writeFile(`${output}/word.xml`, xml)
await writeFile(`${output}/styles.xml`, styles)
await writeFile(`${output}/paragraphs.json`, JSON.stringify(paragraphs, null, 2))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1512, height: 982 } })
  const page = await context.newPage()
  await page.goto('http://127.0.0.1:5173')
  const result = await page.evaluate(async ({ name, bytes, xml, styles }) => {
    const { importWord } = await import('/src/lib/import.ts')
    const { beautifyDocument } = await import('/src/lib/beautify.ts')
    const { recoverWordStructure } = await import('/src/lib/word-structure.ts')
    const { htmlFile } = await import('/src/lib/render.ts')
    const { prepareClipboard } = await import('/src/lib/clipboard.ts')
    const { findCodeRun } = await import('/src/lib/code.ts')
    const { newArticle, nodeText, imageNodes } = await import('/src/lib/document.ts')
    const imported = await importWord(new File([new Uint8Array(bytes)], name))
    const beauty = beautifyDocument(imported.document)
    const recovery = recoverWordStructure(xml, styles)
    const article = newArticle(name.replace(/\.docx$/i, ''), beauty.document)
    article.themeId = 'technical'
    article.typography.accent = '#365c86'
    const copied = await prepareClipboard(article)
    const parsed = new DOMParser().parseFromString(copied.html, 'text/html')
    const original = new DOMParser().parseFromString(xml, 'application/xml')
    const originalParagraphs = [...original.getElementsByTagNameNS('*', 'p')].map(p => [...p.getElementsByTagNameNS('*', 't')].map(n => n.textContent).join(''))
    const captions = originalParagraphs.map((_text, index) => findCodeRun(originalParagraphs, index)?.contentStart === index + 1 ? index : -1).filter(index => index >= 0)
    const canonical = value => value.replace(/\s/g, '')
    const expectedText = canonical(originalParagraphs.filter((_text, index) => !captions.includes(index)).join(''))
    const importedText = canonical(nodeText(imported.document))
    let difference = 0
    while (difference < Math.min(expectedText.length, importedText.length) && expectedText[difference] === importedText[difference]) difference++
    const verification = {
      wordTextPreserved: expectedText === importedText,
      ...(expectedText === importedText ? {} : { firstDifference: { index: difference, original: expectedText.slice(Math.max(0, difference - 80), difference + 250), imported: importedText.slice(Math.max(0, difference - 80), difference + 250) } }),
      movedLanguageCaptions: captions.length,
      beautifyTextPreserved: canonical(nodeText(imported.document)) === canonical(nodeText(beauty.document)),
      idempotent: JSON.stringify(beautifyDocument(beauty.document).document) === JSON.stringify(beauty.document),
      originalImages: imageNodes(imported.document).length,
      exportedImages: parsed.querySelectorAll('img[src^="data:image/"]').length,
      bodyCodeBlocks: beauty.document.content.filter(n => n.type === 'codeBlock').length,
      strayCaptionBlocks: beauty.document.content.filter(n => n.type === 'codeBlock' && nodeText(n).trim() === 'bash').length,
      emptyHeadings: beauty.document.content.filter(n => n.type === 'heading' && !nodeText(n).trim()).length,
    }
    return {
      imported, beauty,
      recovery: { styles: [...recovery.styles], codeTexts: [...recovery.codeTexts] },
      verification,
      blocks: beauty.document.content.map((n, i) => ({ i, type: n.type, attrs: n.attrs, text: nodeText(n) })),
      html: htmlFile(article.title, copied.html),
    }
  }, { name: file.split(/[\\/]/).at(-1), bytes: [...buffer], xml, styles })
  await writeFile(`${output}/result.json`, JSON.stringify({ ...result, html: undefined }, null, 2))
  await writeFile(`${output}/index.html`, result.html)
  await writeFile(`${output}/verification.json`, JSON.stringify({ ...result.verification, report: result.beauty.report }, null, 2))
  await page.setContent(result.html)
  await page.screenshot({ path: `${output}/桌面预览.png` })
  await page.locator('pre').filter({ hasText: '-w /etc/passwd' }).first().scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${output}/审计规则预览.png` })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('pre').filter({ hasText: 'aureport --summary' }).first().scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${output}/手机代码预览.png` })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(result.verification.wordTextPreserved).toBe(true)
  expect(result.verification.beautifyTextPreserved).toBe(true)
  expect(result.verification.idempotent).toBe(true)
  expect(result.verification.exportedImages).toBe(result.verification.originalImages)
  expect(result.verification.strayCaptionBlocks).toBe(0)
  expect(result.verification.emptyHeadings).toBe(0)
  console.log(JSON.stringify({ output, report: result.beauty.report, ...result.verification }, null, 2))
} finally { await browser.close() }
