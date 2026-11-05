import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import mammoth from 'mammoth'
import JSZip from 'jszip'

const directory = process.argv[2]
if (!directory) throw new Error('Pass the sample article directory')
const output = 'test-results/article-inspection'
await mkdir(output, { recursive: true })
for (const name of (await readdir(directory)).filter(name => name.endsWith('.docx'))) {
  const buffer = await readFile(join(directory, name))
  const result = await mammoth.convertToHtml({ buffer })
  const zip = await JSZip.loadAsync(buffer)
  const xml = await zip.file('word/document.xml').async('string')
  const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(match => ({
    text: [...match[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(text => text[1]).join(''),
    style: match[0].match(/<w:pStyle[^>]*w:val="([^"]+)"/)?.[1] || '',
  })).filter(p => p.text.trim())
  await writeFile(join(output, `${name}.html`), result.value, 'utf8')
  const report = {
    name, paragraphs: paragraphs.length, images: (result.value.match(/<img /g) || []).length,
    htmlHeadings: (result.value.match(/<h[1-6]/g) || []).length,
    htmlLists: (result.value.match(/<[uo]l>/g) || []).length,
    messages: result.messages,
    excerpt: paragraphs.slice(0, 35).map(p => ({ ...p, text: p.text.slice(0, 230) })),
    htmlExcerpt: result.value.replace(/src="data:[^"]+"/g, 'src="[embedded image]"').slice(0, 3500),
  }
  await writeFile(join(output, `${name}.json`), JSON.stringify(report, null, 2), 'utf8')
  const styles = Object.groupBy(paragraphs.filter(p => p.style), p => p.style)
  console.log(JSON.stringify({ name, paragraphs: paragraphs.length, images: report.images, headings: report.htmlHeadings, lists: report.htmlLists, messages: result.messages.map(m => m.message), styles: Object.fromEntries(Object.entries(styles).map(([id, entries]) => [id, { count: entries.length, examples: entries.slice(0, 8).map(p => p.text.slice(0, 110)) }])), opening: paragraphs.slice(0, 7).map(p => p.text.slice(0, 160)) }, null, 2))
}
