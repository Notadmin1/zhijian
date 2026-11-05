import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import http from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const logDirectory = join(root, 'logs')
const logFile = join(logDirectory, 'launcher.log')
process.chdir(root)

function log(message, error = false) {
  const line = `[字间] ${message}`
  if (error) console.error(line)
  else console.log(line)
  try {
    mkdirSync(logDirectory, { recursive: true })
    appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`, 'utf8')
  } catch { /* A logging error must not prevent startup. */ }
}

function options() {
  let port = 5173
  let browser = true
  const args = process.argv.slice(2)
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--no-browser') browser = false
    else if (args[index] === '--port') {
      const value = args[++index]
      if (!/^\d+$/.test(value || '') || Number(value) < 1024 || Number(value) > 65535) throw new Error('端口必须是 1024 至 65535 的整数')
      port = Number(value)
    } else throw new Error(`无法识别的启动参数：${args[index]}`)
  }
  return { port, browser }
}

function inspectService(url) {
  return new Promise(resolveResult => {
    const request = http.get(url, { timeout: 2000 }, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        if (body.length < 65536) body += chunk
      })
      response.on('end', () => resolveResult(response.statusCode === 200 && (
        body.includes('content="zijian-article-studio"') || body.includes('<title>字间 · 文章排版工作台</title>')
      ) ? 'studio' : 'other'))
      response.on('error', () => resolveResult('other'))
    })
    request.on('timeout', () => request.destroy(new Error('本地服务响应超时')))
    request.on('error', error => resolveResult(error.code === 'ECONNREFUSED' ? 'absent' : 'other'))
  })
}

async function openBrowser(url) {
  const [command, args] = process.platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  try {
    await new Promise((resolveSpawn, reject) => {
      const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
      child.once('error', reject)
      child.once('spawn', () => { child.unref(); resolveSpawn() })
    })
  } catch (error) {
    log(`无法自动打开默认浏览器，请手动打开 ${url}。${error.message}`, true)
  }
}

async function installDependencies() {
  const dependencies = ['vite', '@vitejs/plugin-react', 'react', '@tiptap/react', 'mammoth']
  if (dependencies.every(name => existsSync(join(root, 'node_modules', name, 'package.json')))) return
  log('首次运行，正在安装依赖，请保持网络连接…')
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resolve(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ...(process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':').filter(Boolean).map(path => join(path, 'node_modules', 'npm', 'bin', 'npm-cli.js')),
  ]
  const npm = candidates.find(path => path && /npm-cli\.js$/i.test(path) && existsSync(path))
  if (!npm) throw new Error('没有找到 npm，请重新安装 Node.js，或在项目目录运行 npm.cmd install')
  await new Promise((resolveInstall, reject) => {
    const child = spawn(process.execPath, [npm, 'install', '--cache', join(root, '.npm-cache')], { cwd: root, stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolveInstall() : reject(new Error(`依赖安装失败（退出码 ${code}），请检查网络后重新启动`)))
  })
}

function portError(port) {
  return new Error(`端口 ${port} 已被其他程序占用，或现有服务未正常响应。请先关闭占用此端口的程序，再重新启动。为保留原有草稿，不会自动切换到其他端口。`)
}

async function main() {
  const { port, browser } = options()
  const url = `http://127.0.0.1:${port}`
  const existing = await inspectService(url)
  if (existing === 'studio') {
    log(`工作台已经运行，正在打开：${url}`)
    if (browser) await openBrowser(url)
    return
  }
  if (existing === 'other') throw portError(port)

  const [major, minor] = process.versions.node.split('.').map(Number)
  if (!(major > 22 || (major === 22 && minor >= 12) || (major === 20 && minor >= 19))) throw new Error('需要 Node.js 20.19+ 或 22.12+，请先更新 Node.js')
  await installDependencies()
  log('正在启动本地工作台…')
  const { createServer } = await import('vite')
  const server = await createServer({ root, configFile: join(root, 'vite.config.ts'), clearScreen: false, server: { host: '127.0.0.1', port, strictPort: true, open: false } })
  try {
    await server.listen()
  } catch (error) {
    await server.close()
    // Two double-clicks may arrive together. Reuse the winner instead of failing.
    if (await inspectService(url) === 'studio') {
      log(`工作台已经运行，正在打开：${url}`)
      if (browser) await openBrowser(url)
      return
    }
    if (error.code === 'EADDRINUSE' || /already in use/i.test(error.message)) throw portError(port)
    throw error
  }
  log(`工作台已就绪：${url}`)
  log('请保持此窗口打开，关闭窗口或按 Ctrl+C 可停止本次启动的服务。')
  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    await server.close()
    process.exit(0)
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  if (browser) await openBrowser(url)
}

main().catch(error => {
  log(error.message || String(error), true)
  try { appendFileSync(logFile, `${error.stack || error}\n`, 'utf8') } catch { /* Best effort. */ }
  process.exitCode = 1
})
