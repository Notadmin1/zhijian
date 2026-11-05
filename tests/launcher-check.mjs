import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Exercise the real Windows entry point, including Unicode / spaces in its path.
const root = fileURLToPath(new URL('../', import.meta.url))
if (process.platform !== 'win32') throw new Error('This check requires Windows CMD')
const entry = readFileSync(join(root, '启动字间.cmd'))
assert(entry.every(byte => byte <= 127), 'The CMD entry must stay ASCII')
assert(!/(?<!\r)\n/.test(entry.toString('ascii')), 'The CMD entry must use CRLF')

function run(launcher, port, cwd) {
  return new Promise((resolveResult, reject) => {
    const command = `call "${launcher}" --no-browser --port ${port} <nul`
    const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
      cwd, windowsHide: true, windowsVerbatimArguments: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', text => { output += text })
    child.stderr.on('data', text => { output += text })
    child.once('error', reject)
    child.once('exit', code => resolveResult({ code, output }))
  })
}

const fixtureRoot = join(root, 'test-results', '启动入口 含空格')
mkdirSync(join(fixtureRoot, 'scripts'), { recursive: true })
copyFileSync(join(root, '启动字间.cmd'), join(fixtureRoot, '启动字间.cmd'))
copyFileSync(join(root, 'scripts', 'launch.mjs'), join(fixtureRoot, 'scripts', 'launch.mjs'))

const server = http.createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end('<meta name="application-name" content="zijian-article-studio">')
})
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
const port = server.address().port
try {
  const reused = await run(join(fixtureRoot, '启动字间.cmd'), port, join(root, 'docs'))
  assert.equal(reused.code, 0, reused.output)
  assert.match(reused.output, /工作台已经运行/)
  assert(!reused.output.includes('not recognized'), reused.output)
  console.log('PASS: actual CMD reuses an existing studio, including a path with spaces and Chinese characters')

  server.removeAllListeners('request')
  server.on('request', (_request, response) => response.end('A different local application'))
  const occupied = await run(join(root, '启动字间.cmd'), port, join(root, 'docs'))
  assert.equal(occupied.code, 1, occupied.output)
  assert.match(occupied.output, /已被其他程序占用/)
  assert.match(occupied.output, /不会自动切换/)
  assert.match(occupied.output, /logs\\launcher\.log/)
  console.log('PASS: actual CMD reports unrelated port conflicts and retains an actionable error')
} finally {
  await new Promise(resolveClose => server.close(resolveClose))
}
