const shellCommand = /^(?:adb|aapt2?|am|pm|logcat|pip3?|python3?|docker|git|npm|npx|curl|wget|dig|nmap|nslookup|apt|sudo|cd|ls|cat|echo|export|powershell|bash|sh|grep|sed|awk|chmod|java|javac|node|journalctl|dmesg|systemctl|tail|head|less|more|zcat|zgrep|last|lastb|lastlog|who|w|ausearch|aureport|auditctl|augenrules|crontab|history|find|sort|uniq|wc|ps|ss|netstat)(?:\s|$)/
const typedDeclaration = /^(?:(?:public|private|protected|static|final|abstract|synchronized|override)\s+)*(?:[A-Z][\w.$]*(?:<[^>]+>)?(?:\[\])*|void|int|long|boolean|double|float|byte|char)\s+[\w$]+\s*(?:=|\()/
const memberCall = /^[\w$]+(?:\.[\w$]+)+\s*\([^\n]*\)\s*;?$/

// Language captions copied from web code panels are metadata when followed by
// a real snippet. A bare interpreter name on its own is still a command.
export function codeLanguageLabel(text: string): string | null {
  const name = text.trim().toLowerCase()
  return ({ bash: 'bash', shell: 'bash', python: 'python', javascript: 'javascript', java: 'java', json: 'json', sql: 'sql', xml: 'xml', html: 'html' } as Record<string, string>)[name] || null
}

function shellLine(text: string): boolean {
  const command = text.replace(/^(?:\[[\w@. ~/:+-]+\][#$]|[\w.-]+@[\w.-]+:[^\s]+[$#]|[$#])\s+/, '')
  // Allow Chinese in quoted arguments, placeholders and comments, but keep
  // explanations such as “last 和 lastb 默认按时间倒序输出” in the article.
  const syntax = command.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|<[^>]+>|\s+#.*$/g, '')
  if (/[\u3400-\u9fff。；！？：]/.test(syntax)) return false
  return shellCommand.test(command) || /^-w\s+(?:\/|<)\S*.*\s-(?:p|k)\s+\S/.test(command)
    || /^-a\s+(?:always|never),(?:exit|task|user|exclude)\s+-(?:F|S)\s+\S/.test(command)
}

export function isLogLine(input: string): boolean {
  const text = input.trimStart()
  return /^(?:<\d{1,3}>)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\S+\s+[\w./@-]+(?:\[\d+\])?:\s/.test(text)
    || /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\s+.+(?:\[\d+\]:|\b(?:INFO|WARN|ERROR|DEBUG|TRACE)\b)/.test(text)
    || /^type=[A-Z_]+\s+msg=audit\(\d+(?:\.\d+)?:\d+\):/.test(text)
    || /^\[\s*\d+\.\d+\]\s+\S/.test(text)
    || /^(?:[\w.-]+\[\d+\]:\s+|pam_unix\([\w:]+\):\s+|sudo:\s+\S+\s+:\s+TTY=)/.test(text)
}

export function startsCode(input: string): boolean {
  const text = input.trimStart()
  if (/[→↓↑←]/.test(text) && !/[|&;"']/.test(text)) return false
  if (shellLine(text) || isLogLine(text) || typedDeclaration.test(text) || memberCall.test(text)) return true
  if (/^--[\w-]+(?:\s|=)/.test(text)) return true
  return /^(?:<\/?[A-Za-z!][^>]*|(?:import|from|package)\s+[\w.]+|(?:def|class|function|const|let|var|val|fun|async\s+function)\s+\w|(?:if|for|while|try|except|with)\b.*[:{]\s*$|(?:GET|POST|PUT|DELETE|PATCH)\s+\/|(?:HTTP\/\d|Content-Type:|Authorization:)|[\w$.-]+\s*=\s*(?:[\[{'"\d]|\w+\()|[{}\[\]]\s*[,;]?$|["'][^"']+["']\s*:|(?:print|console\.log)\s*\(|[\w$]+\([^\n]*\);\s*$|(?:SELECT|INSERT INTO|UPDATE|CREATE TABLE|DELETE FROM)\s)/.test(text)
}

export function collapsedCode(text: string): boolean {
  // Preserve code that already lost line breaks in its source. Never invent them.
  return text.length > 160 && /^\s*(?:#|\/\/)/.test(text) && /(?:import\s+\w|def\s+\w+\(|__name__|function\s+\w|const\s+\w)/.test(text)
}

const comment = (text: string) => /^\s*(?:#(?!#)|\/\/|\/\*|\*\s)/.test(text)
const codeURI = (text: string) => /^[\w.-]+:\/\/\S+$/.test(text.trim())

function continuesCode(text: string): boolean {
  if (!text.trim() || startsCode(text) || comment(text) || codeURI(text)) return true
  // Indentation alone is insufficient: indented prose must not be swallowed.
  if (/^[\s↓↑→←⇒─│└┌├┐┘]+$/.test(text) || /[。！？；]\s*$/.test(text) || /^\s*(?:目标|观察|说明|注意|总结)[：:]/.test(text)) return false
  return /^(?:\s{2,}|\t|\s*[}\]);]|\s*(?:return\b|raise\b|pass\b|else:|elif |--[\w-]))/.test(text)
}

export function codeLanguage(text: string): string {
  if (/^\s*<!doctype\s+html|^\s*<html\b/im.test(text)) return 'html'
  if (/^\s*</.test(text)) return 'xml'
  if (/^\s*(?:package\s+[\w.]+;|import\s+[\w.]+;|(?:public\s+)?class\s+\w+.*\{)/m.test(text) || text.split('\n').some(line => typedDeclaration.test(line.trimStart()))) return 'java'
  if (/^\s*(?:from .+ import|import \w|def |class .+:)/m.test(text) || (collapsedCode(text) && /import\s+\w|def\s+\w+\(|__name__/.test(text))) return 'python'
  if (/^\s*(?:val\s|fun\s|override fun\s)/m.test(text)) return 'kotlin'
  if (/^\s*(?:const|let|var|function)\s/m.test(text)) return 'javascript'
  if (/^\s*[\[{]/.test(text) && /"[^"\n]+"\s*:/.test(text)) return 'json'
  if (/^\s*(?:GET|POST|PUT|DELETE|HTTP\/)/.test(text)) return 'http'
  if (text.split('\n').some(line => shellLine(line.trimStart())) || /^\s*--[\w-]+(?:\s|=)/m.test(text)) return 'bash'
  if (/^\s*(?:SELECT|INSERT INTO|UPDATE|CREATE TABLE|DELETE FROM)\s/i.test(text)) return 'sql'
  return 'text'
}

/** null marks a structural boundary such as a heading, image, list or table. */
export function findCodeRun(lines: (string | null)[], start: number): { end: number; language: string; contentStart?: number } | null {
  const first = lines[start]
  if (first === null || first === undefined) return null
  let following = start + 1
  while (following < lines.length && lines[following] !== null && (!lines[following]!.trim() || comment(lines[following]!))) following++
  const commentStart = comment(first) && following < lines.length && lines[following] !== null && (startsCode(lines[following]!) || codeURI(lines[following]!))
  const label = codeLanguageLabel(first)
  const caption = label && following < lines.length && lines[following] !== null && startsCode(lines[following]!) && codeLanguage(lines[following]!) === label
  if (!startsCode(first) && !collapsedCode(first) && !commentStart && !caption) return null
  let end = start + 1
  while (end < lines.length && lines[end] !== null && continuesCode(lines[end]!)) end++
  // Keep internal blank lines, but leave trailing article spacing outside the code.
  while (end > start + 1 && !lines[end - 1]!.trim()) end--
  return { end, language: caption ? label! : codeLanguage(lines.slice(start, end).join('\n')), ...(caption ? { contentStart: start + 1 } : {}) }
}
