import JSZip from 'jszip'
import { wordFixture } from '../fixtures'

export const linuxSamples = [
  `#syslog 时间字段可以按字典序比较。\nawk '$1=="Oct" && $3>="09:00:00" && $3<="18:00:00"' /var/log/secure    #查某天的记录`,
  '# 查看爆破的起止时间\ngrep "Failed password" /var/log/secure | head -1\ngrep "Failed password" /var/log/secure | tail -1\n\n# 追踪审计事件\nausearch -m USER_LOGIN -ts recent -i',
  '# 账户与认证文件\n-w /etc/passwd -p wa -k identity\n-w /etc/shadow -p wa -k identity\n\n# 持久化位置\n-w /etc/cron.d/ -p wa -k cron',
  '# 命令执行（必配）\n-a always,exit -F arch=b64 -S execve -k proc_exec\n\n# 网络连接\n-a always,exit -F arch=b64 -S connect -k network_connect',
  'Apr 20 14:00:01 myserver CRON[1234]: (root) CMD (/usr/local/bin/backup.sh)\nApr 20 14:05:01 myserver CRON[1235]: (root) CMD (/usr/local/bin/backup.sh)',
  '# 总体摘要\naureport --summary\n\n# 按用户统计\naureport -u -i',
  '# 当前用户\ncrontab -l\n\n# 所有用户\nls -la /var/spool/cron/   # RHEL/CentOS',
  'lastlog -u <username>',
]
export const tableLog = 'sshd[12345]: Accepted password for username from 192.0.2.100 port 12345 ssh2'

export async function linuxWordFixture(): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await wordFixture())
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const p = (text: string, style = '', mono = false) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r>${mono ? '<w:rPr><w:rFonts w:ascii="Consolas"/></w:rPr>' : ''}<w:t xml:space="preserve">${escape(text)}</w:t></w:r></w:p>`
  const code = (text: string) => text.split('\n').map(line => p(line)).join('')
  const cell = (text: string) => `<w:tc>${p(text)}</w:tc>`
  const cdata = (text: string) => `<w:p><w:r><w:t xml:space="preserve"><![CDATA[${text}]]></w:t></w:r></w:p>`
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
    ${p('安全日志：/var/log/secure', '1')}${p('本篇介绍系统日志与排查命令，所有示例均作为文章原文展示。')}
    ${p('场景一：排查 SSH 登录', '2')}${p('1. 统计攻击源 IP', '4')}
    ${linuxSamples[0].split('\n').map(cdata).join('')}${p('按时间范围筛选后，再按事件类型排查。')}
    ${p('bash', '', true)}${code(linuxSamples[1])}${p('命令解读：统计指定日志中的记录。')}
    ${p('文件监控', '2')}${code(linuxSamples[2])}${p('-w <path>：要监控的文件或目录。')}
    ${p('系统调用监控', '2')}${code(linuxSamples[3])}${p('-F arch=b64：指定 64 位架构。')}
    ${p('日志格式', '2')}${code(linuxSamples[4])}${p('日志中的时间戳用于关联事件。')}
    ${p('统计概览', '2')}${code(linuxSamples[5])}${p('统计结果需要结合原始事件核对。')}
    ${p('定时任务日志：/var/log/cron', '1')}${p('bash', '', true)}${code(linuxSamples[6])}${p('注意：日志可能被删除或篡改，需要交叉验证。')}
    ${p('当前与历史登录', '1')}${p('bash', '', true)}${code(linuxSamples[7])}
    ${p('last -x | grep reboot 可以列出所有重启记录。')}${p('auditctl 命令行：规则立即生效，但重启后丢失。')}
    ${p('', '2')}
    <w:tbl><w:tr>${['事件类型', '日志示例', '解读要点'].map(cell).join('')}</w:tr><w:tr>${['登录成功', tableLog, '用户通过密码登录。'].map(cell).join('')}</w:tr></w:tbl>
    <w:tbl><w:tr>${['记录类型', '字段'].map(cell).join('')}</w:tr><w:tr>${cell('SYSCALL')}<w:tc>${['uid=', '、', 'pid=', '、', 'exe=', ''].map(text => p(text)).join('')}</w:tc></w:tr></w:tbl>
    ${p('/var/log/secure — 身份验证日志。')}${p('/var/log/wtmp或/var/log/utmp — 登录记录。')}${p('/var/log/audit/ — 审计事件。')}
    ${p('文章末尾完整保留。')}
  </w:body></w:document>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}
