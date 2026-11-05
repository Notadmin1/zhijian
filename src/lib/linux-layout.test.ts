import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { generateJSON } from '@tiptap/react'
import { startsCode, findCodeRun, codeLanguage } from './code'
import { beautifyDocument } from './beautify'
import { prepareHTML } from './import'
import { newArticle, nodeText } from './document'
import { renderArticle } from './render'
import { editorExtensions } from './tiptap'
import { normalizeWordTextXML, recoverWordStructure } from './word-structure'

const p = (text: string, bold = false): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text, ...(bold ? { marks: [{ type: 'bold' }] } : {}) }] })
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const rules = ['# 账户与认证文件', '-w /etc/passwd -p wa -k identity', '-w /etc/shadow -p wa -k identity', '', '# 持久化位置', '-w /etc/cron.d/ -p wa -k cron']

describe('Linux article layout', () => {
  it('normalizes Word CDATA text without changing code, entities, mixed text or other XML data', () => {
    const code = `awk '$1=="Oct" && $3<="18:00:00"' /var/log/secure    #查某天的记录`
    const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">前缀 <![CDATA[${code}]]> 后缀 &amp; &lt;</w:t></w:r></w:p><custom><![CDATA[保持原样]]></custom></w:body></w:document>`
    const normalized = normalizeWordTextXML(xml)
    const parsed = new DOMParser().parseFromString(normalized, 'application/xml')
    expect(parsed.getElementsByTagNameNS('*', 't')[0].textContent).toBe(`前缀 ${code} 后缀 & <`)
    expect(parsed.getElementsByTagNameNS('*', 't')[0].childNodes).toHaveLength(1)
    expect(parsed.querySelector('custom')?.firstChild?.nodeType).toBe(Node.CDATA_SECTION_NODE)
    expect(normalizeWordTextXML(normalized)).toBe(normalized)
    expect(normalizeWordTextXML('<w:t>普通文本</w:t>')).toBe('<w:t>普通文本</w:t>')
    expect(findCodeRun(['#syslog 时间字段可以直接比较。', code, '后续正文。'], 0)?.end).toBe(2)
  })
  it.each([
    'ausearch -m USER_LOGIN -ts recent -i', 'aureport --summary', 'crontab -l',
    'lastb -i | head -50', 'lastlog -u <username>', 'journalctl -u sshd --since "2026-10-28"',
    'dmesg -T | tail -20', 'systemctl status auditd', 'tail -f /var/log/secure',
    '-w /etc/passwd -p wa -k identity', '-a always,exit -F arch=b64 -S <syscall> -k <key>',
    '[root@server ~]# ausearch -m EXECVE -i', 'last -i | grep "<可疑IP>"',
  ])('recognizes commands/rules without rewriting them: %s', text => {
    expect(startsCode(text)).toBe(true)
    expect(codeLanguage(text)).toBe('bash')
  })

  it.each([
    'auditctl 命令行：规则立即生效，但重启后丢失，仅用于测试或临时排查。',
    'last 和 lastb 默认按时间倒序输出，关键选项包括 -i',
    'last -x | grep reboot 可以列出所有重启记录。',
    '-w <path>：要监控的文件或目录。',
    '-a always,exit：在系统调用退出时始终记录',
    '-F arch=b64：指定 64 位架构。',
    '/var/log/secure — 包含验证和授权方面信息。',
  ])('keeps explanations as prose: %s', text => {
    expect(startsCode(text)).toBe(false)
    expect(findCodeRun([text], 0)).toBeNull()
  })

  it('keeps audit comments, rules and internal blank lines together before Markdown inference', async () => {
    const input = doc(p('文件监控', true), ...rules.map(text => text ? p(text) : { type: 'paragraph' }), p('-w <path>：要监控的文件或目录。'))
    const beauty = beautifyDocument(input)
    expect(beauty.document.content?.map(n => n.type)).toEqual(['heading', 'codeBlock', 'paragraph'])
    expect(nodeText(beauty.document.content![1])).toBe(rules.join('\n'))
    expect(beautifyDocument(beauty.document).document).toEqual(beauty.document)
    const imported: JSONContent = generateJSON(await prepareHTML(rules.map(text => `<p>${escape(text)}</p>`).join('') + '<p>说明：正文仍然保留。</p>'), editorExtensions())
    expect(nodeText(imported.content![0])).toBe(rules.join('\n'))
    expect(imported.content?.map(n => n.type)).toEqual(['codeBlock', 'paragraph'])
  })

  it.each([
    'Apr 20 14:00:01 myserver CRON[1234]: (root) CMD (/usr/local/bin/backup.sh)',
    'Oct 28 09:00:01 host sshd[123]: Failed password for root from 192.0.2.1 port 22 ssh2',
    '2026-10-28T09:00:01+08:00 host sshd[123]: Accepted publickey for alice',
    'type=SYSCALL msg=audit(1793149201.123:42): arch=c000003e syscall=59 success=yes',
    'type=EXECVE msg=audit(1793149201.123:42): argc=2 a0="bash" a1="-i"',
    '[    0.123456] Linux version 6.8.0',
  ])('renders log output as literal text, not a heading or Java/JSON: %s', text => {
    const result = beautifyDocument(doc(p(text), p('日志说明，仍然属于正文。')))
    expect(result.document.content?.[0].type).toBe('codeBlock')
    expect(result.document.content?.[0].attrs?.language).toBe('text')
    expect(nodeText(result.document.content![0])).toBe(text)
    expect(result.document.content?.[1].type).toBe('paragraph')
  })

  it('moves a copied language caption into the code header and repairs captions in old drafts', async () => {
    const code = '# 当前用户\ncrontab -l\n\n# 所有用户\nls -la /var/spool/cron/'
    const input = doc(p('bash'), ...code.split('\n').map(text => text ? p(text) : { type: 'paragraph' }), p('后续说明。'))
    const result = beautifyDocument(input)
    expect(result.document.content?.map(n => n.type)).toEqual(['codeBlock', 'paragraph'])
    expect(nodeText(result.document.content![0])).toBe(code)
    expect(result.document.content?.[0].attrs?.language).toBe('bash')
    const old = doc({ type: 'codeBlock', attrs: { language: 'bash' }, content: [{ type: 'text', text: 'bash' }] }, result.document.content![0], p('后续说明。'))
    expect(beautifyDocument(old).document).toEqual(result.document)
    expect(nodeText(beautifyDocument(doc(p('bash'))).document)).toBe('bash')
    const imported = generateJSON(await prepareHTML('<p>bash</p>' + code.split('\n').map(text => `<p>${escape(text)}</p>`).join('')), editorExtensions())
    expect(nodeText(imported.content![0])).toBe(code)
  })

  it('keeps numeric steps subordinate and removes empty headings from recovered Word styles', () => {
    const result = beautifyDocument(doc({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '安全日志' }] }, p('场景一：排查 SSH'), p('1. 统计攻击源 IP', true), p('ausearch -m USER_LOGIN -i'), { type: 'heading', attrs: { level: 3 } }))
    expect(result.document.content?.filter(n => n.type === 'heading').map(n => n.attrs?.level)).toEqual([2, 3, 3])
    expect(result.report.removedEmpty).toBe(1)
  })

  it('preserves monospace table fragments and interpreter captions for contextual import', () => {
    const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="Consolas"/></w:rPr><w:t>bash</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:rPr><w:rFonts w:ascii="Consolas"/></w:rPr><w:t>a0="bash" a1="-i"</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
    expect(recoverWordStructure(xml).codeTexts.size).toBe(0)
  })

  it('joins clear table fragments while preserving distinct paragraphs and manual table layout', () => {
    const cell = { type: 'tableCell', content: [p('记录类型 ('), p('type='), p(')'), p(''), p('这是独立的一段。'), p('另一段正文。')] }
    const table = { type: 'table', content: [{ type: 'tableRow', content: [cell] }] }
    const input = doc(table)
    const result = beautifyDocument(input)
    expect(result.document.content?.[0].content?.[0].content?.[0].content?.map(nodeText)).toEqual(['记录类型 (type=)', '这是独立的一段。', '另一段正文。'])
    expect(nodeText(result.document)).toBe(nodeText(input))
    const manual = doc({ ...table, attrs: { headerMode: 'manual' } })
    expect(beautifyDocument(manual).document).toEqual(manual)
    expect(beautifyDocument(result.document).document).toEqual(result.document)
  })

  it('formats file explanations as a list with inline paths, keeping links and block code unchanged', () => {
    const input = doc(p('/var/log/secure — 身份验证日志。'), p('/var/log/wtmp或/var/log/utmp — 登录记录。'), p('/var/log/audit/ — 审计事件。'), p('参考 https://example.com/var/log/audit'), { type: 'codeBlock', attrs: { language: 'bash', codeTitle: '手动示例', codeWrap: 'scroll' }, content: [{ type: 'text', text: 'cat /var/log/secure' }] })
    const result = beautifyDocument(input)
    expect(result.report.lists).toBe(1)
    expect(nodeText(result.document)).toBe(nodeText(input))
    expect(result.document.content?.[0].content?.[0].content?.[0].content?.[0].marks).toEqual([{ type: 'code' }])
    expect(result.document.content?.[1]).toEqual(input.content![3])
    expect(result.document.content?.[2]).toEqual(input.content![4])
    expect(beautifyDocument(result.document).document).toEqual(result.document)
  })

  it('groups bold definition items after an introduction without absorbing the following paragraph', () => {
    const definition = (name: string, text: string) => ({ type: 'paragraph', content: [{ type: 'text', text: name, marks: [{ type: 'bold' }] }, { type: 'text', text: `：${text}` }] })
    const input = doc(p('日志字段包括：'), definition('时间戳', '事件发生的日期和时间。'), definition('主机名', '产生日志的服务器。'), definition('程序名', '产生日志的服务。'), p('接下来介绍用法。'))
    const result = beautifyDocument(input)
    expect(result.document.content?.map(n => n.type)).toEqual(['paragraph', 'bulletList', 'paragraph'])
    expect(nodeText(result.document)).toBe(nodeText(input))
    expect(beautifyDocument(result.document).document).toEqual(result.document)
  })

  it('gives wide log comparison tables room to scroll while respecting the chosen fit mode', () => {
    const log = 'sshd[12345]: Accepted password for username from 192.0.2.100 port 12345 ssh2'
    const article = newArticle('日志表格', doc({ type: 'table', content: [{ type: 'tableRow', content: [p('事件'), p('示例'), p('解读')].map(n => ({ type: 'tableCell', content: [n] })) }, { type: 'tableRow', content: [{ type: 'tableCell', content: [p('成功')] }, { type: 'tableCell', content: [{ type: 'codeBlock', content: [{ type: 'text', text: log }] }] }, { type: 'tableCell', content: [p('登录成功。')] }] }] }))
    const parsed = () => new DOMParser().parseFromString(renderArticle(article), 'text/html')
    expect(parsed().querySelector('table')?.style.minWidth).toBe('660px')
    expect(parsed().querySelector('td pre')?.textContent).toBe(log)
    article.typography.tableMode = 'fit'
    expect(parsed().querySelector('table')?.style.minWidth).toBe('')
  })
})
