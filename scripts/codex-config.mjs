import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const CODEX_MODEL_ID = 'ai-ops'
export const CODEX_PROVIDER_ID = 'ai-ops'
export const CODEX_PROVIDER_NAME = 'AI OPS'
export const CODEX_TOKEN_ENV = 'AI_OPS_TOKEN'

function readableError(message) {
  return new Error(message)
}

function tomlString(value) {
  return JSON.stringify(value)
}

function hasUsableApiKey(value) {
  return typeof value === 'string' && value.trim().length >= 8 && !/[\r\n]/u.test(value)
}

export function normalizeGatewayResponsesBaseUrl(baseUrl) {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) throw readableError('缺少 AI OPS 网关地址。')
  let url
  try {
    url = new URL(baseUrl.trim())
  } catch {
    throw readableError('AI OPS 网关地址无效。')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw readableError('AI OPS 网关地址必须是无账号密码的 HTTP 或 HTTPS 地址。')
  }

  url.hash = ''
  url.search = ''
  const path = url.pathname.replace(/\/+$/u, '')
  if (path.endsWith('/v1/responses')) url.pathname = path.slice(0, -'/responses'.length)
  else if (path.endsWith('/v1')) url.pathname = path
  else url.pathname = `${path}/v1`.replace(/\/+/gu, '/')
  return url.toString()
}

function isTableHeader(line) {
  return /^\s*\[\[?/u.test(line)
}

function isAiOpsProviderHeader(line) {
  return /^\s*\[\s*model_providers\s*\.\s*(?:ai-ops|"ai-ops"|'ai-ops')\s*\]\s*(?:#.*)?$/iu.test(line)
}

function rootHeaderIndex(lines) {
  return lines.findIndex(isTableHeader)
}

function setRootString(lines, key, value) {
  const headerIndex = rootHeaderIndex(lines)
  const bound = headerIndex < 0 ? lines.length : headerIndex
  const expression = new RegExp(`^\\s*${key}\\s*=`, 'u')
  const matches = []
  for (let index = 0; index < bound; index += 1) {
    if (expression.test(lines[index])) matches.push(index)
  }
  if (matches.length > 1) throw readableError(`现有 Codex 配置中重复定义了 ${key}，未作任何修改。`)
  const nextLine = `${key} = ${tomlString(value)}`
  if (matches.length === 1) {
    lines[matches[0]] = nextLine
  } else {
    lines.splice(bound, 0, nextLine)
  }
}

function aiOpsProviderBlock(gatewayBaseUrl) {
  return [
    '# >>> AI OPS provider (managed by AI OPS) >>>',
    '[model_providers.ai-ops]',
    `name = ${tomlString(CODEX_PROVIDER_NAME)}`,
    `base_url = ${tomlString(normalizeGatewayResponsesBaseUrl(gatewayBaseUrl))}`,
    `env_key = ${tomlString(CODEX_TOKEN_ENV)}`,
    'requires_openai_auth = false',
    'wire_api = "responses"',
    'request_max_retries = 0',
    'stream_max_retries = 0',
    '# <<< AI OPS provider (managed by AI OPS) <<<',
  ]
}

function replaceAiOpsProvider(lines, gatewayBaseUrl) {
  const starts = lines.reduce((matches, line, index) => {
    if (isAiOpsProviderHeader(line)) matches.push(index)
    return matches
  }, [])
  if (starts.length > 1) throw readableError('现有 Codex 配置中重复定义了 AI OPS Provider，未作任何修改。')

  const replacement = aiOpsProviderBlock(gatewayBaseUrl)
  if (starts.length === 1) {
    const start = starts[0]
    const followingHeader = lines.findIndex((line, index) => index > start && isTableHeader(line))
    const end = followingHeader < 0 ? lines.length : followingHeader
    lines.splice(start, end - start, ...replacement)
    return
  }

  while (lines.length && !lines.at(-1)?.trim()) lines.pop()
  if (lines.length) lines.push('')
  lines.push(...replacement)
}

/**
 * Build a valid user-level Codex configuration update without touching any
 * project-level configuration or existing conversation/session files.
 */
export function mergeAiOpsIntoCodexConfig(source, gatewayBaseUrl) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const normalized = source.replace(/^\uFEFF/u, '')
  const lines = normalized ? normalized.split(/\r?\n/u) : []
  while (lines.length && !lines.at(-1)?.trim()) lines.pop()
  setRootString(lines, 'model', CODEX_MODEL_ID)
  setRootString(lines, 'model_provider', CODEX_PROVIDER_ID)
  replaceAiOpsProvider(lines, gatewayBaseUrl)
  return `${lines.join(newline)}${newline}`
}

async function readTextIfPresent(path) {
  try {
    return { exists: true, value: await readFile(path, 'utf8') }
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return { exists: false, value: '' }
    throw error
  }
}

async function writeTextAtomically(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, value, { encoding: 'utf8', mode: 0o600 })
  await rename(temporaryPath, path)
}

async function setWindowsUserEnvironmentVariable(name, value) {
  if (process.platform !== 'win32') throw readableError('当前系统不支持自动写入 Codex 的用户环境变量。')
  await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command',
      `$value = [Console]::In.ReadToEnd(); if ([string]::IsNullOrWhiteSpace($value)) { exit 2 }; [Environment]::SetEnvironmentVariable('${name}', $value, 'User')`,
    ], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] })
    let standardError = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { standardError += chunk })
    child.on('error', () => reject(readableError('无法保存 Codex 所需的平台 Key。')))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(readableError(standardError ? '无法保存 Codex 所需的平台 Key。' : '保存 Codex 平台 Key 失败。'))
    })
    child.stdin.end(value)
  })
}

async function resolveCodexCliPath() {
  const configured = process.env.AI_OPS_CODEX_CLI_PATH
  if (configured && existsSync(configured)) return configured
  if (process.platform !== 'win32') return null

  try {
    const { stdout } = await execFileAsync('where.exe', ['codex.exe'], { windowsHide: true, timeout: 4_000, maxBuffer: 16 * 1024 })
    const candidate = stdout.split(/\r?\n/u).map((item) => item.trim()).find((item) => item && existsSync(item))
    if (candidate) return candidate
  } catch {
    // Fall through to the desktop app location.
  }

  const codexBinRoot = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin') : null
  if (!codexBinRoot) return null
  try {
    const entries = await readdir(codexBinRoot, { withFileTypes: true })
    const candidates = entries.filter((entry) => entry.isDirectory()).map((entry) => join(codexBinRoot, entry.name, 'codex.exe'))
    return candidates.find((candidate) => existsSync(candidate)) ?? null
  } catch {
    return null
  }
}

/** Only exposes an installation/authentication state; it never reads auth.json. */
export async function inspectCodexStatus() {
  const cliPath = await resolveCodexCliPath()
  if (!cliPath) return { installation: 'not_detected', login: 'not_logged_in', customProviderAvailableWithoutLogin: true }
  try {
    const { stdout, stderr } = await execFileAsync(cliPath, ['login', 'status'], { windowsHide: true, timeout: 6_000, maxBuffer: 16 * 1024 })
    const output = `${stdout}\n${stderr}`.toLowerCase()
    if (/not\s+logged|not\s+authenticated|login\s+required/u.test(output)) {
      return { installation: 'detected', login: 'not_logged_in', customProviderAvailableWithoutLogin: true }
    }
    if (/logged\s+in|using\s+chatgpt|using\s+api\s+key/u.test(output)) {
      return { installation: 'detected', login: 'logged_in', customProviderAvailableWithoutLogin: true }
    }
    return { installation: 'detected', login: 'unknown', customProviderAvailableWithoutLogin: true }
  } catch (error) {
    const details = error && typeof error === 'object' ? `${error.stdout ?? ''}\n${error.stderr ?? ''}`.toLowerCase() : ''
    if (/not\s+logged|not\s+authenticated|login\s+required/u.test(details)) {
      return { installation: 'detected', login: 'not_logged_in', customProviderAvailableWithoutLogin: true }
    }
    return { installation: 'detected', login: 'unknown', customProviderAvailableWithoutLogin: true }
  }
}

/**
 * Configures the official user-level Codex provider location and the current
 * user's AI_OPS_TOKEN environment variable. It never reads or replaces auth.json
 * and never touches Codex conversation/session storage.
 */
export async function configureCodex({
  configPath = join(homedir(), '.codex', 'config.toml'),
  apiKey,
  gatewayBaseUrl,
  setUserEnvironmentVariable = setWindowsUserEnvironmentVariable,
  inspectStatus = inspectCodexStatus,
} = {}) {
  if (typeof configPath !== 'string' || !configPath.trim()) throw readableError('缺少 Codex 配置路径。')
  if (!hasUsableApiKey(apiKey)) throw readableError('平台 Key 无效。')
  const target = configPath.trim()
  const current = await readTextIfPresent(target)
  const next = mergeAiOpsIntoCodexConfig(current.value, gatewayBaseUrl)
  const backup = current.exists ? `${target}.ai-ops-backup-${new Date().toISOString().replace(/[:.]/gu, '-')}.toml` : null

  if (backup) await copyFile(target, backup)
  await writeTextAtomically(target, next)
  await setUserEnvironmentVariable(CODEX_TOKEN_ENV, apiKey.trim())

  return {
    modelId: CODEX_MODEL_ID,
    configCreated: !current.exists,
    backupCreated: Boolean(backup),
    restartRequired: true,
    login: (await inspectStatus()).login,
  }
}
