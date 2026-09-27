import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export const WORKBUDDY_MODEL_ID = 'ai-ops'
export const WORKBUDDY_MODEL_NAME = 'AI OPS'

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readableError(message) {
  return new Error(message)
}

export function normalizeGatewayChatCompletionsUrl(baseUrl) {
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
  const path = url.pathname.replace(/\/+$/u, '') || ''
  if (path.endsWith('/chat/completions')) {
    url.pathname = path
  } else if (path.endsWith('/v1')) {
    url.pathname = `${path}/chat/completions`
  } else {
    url.pathname = `${path}/v1/chat/completions`.replace(/\/+/gu, '/')
  }
  return url.toString()
}

function isAiOpsModel(value) {
  if (!isRecord(value)) return false
  const id = typeof value.id === 'string' ? value.id.trim().toLowerCase() : ''
  const name = typeof value.name === 'string' ? value.name.trim().toLowerCase() : ''
  const vendor = typeof value.vendor === 'string' ? value.vendor.trim().toLowerCase() : ''
  return id === WORKBUDDY_MODEL_ID || (name === WORKBUDDY_MODEL_NAME.toLowerCase() && vendor === WORKBUDDY_MODEL_NAME.toLowerCase())
}

function createAiOpsModel({ apiKey, gatewayBaseUrl }) {
  if (typeof apiKey !== 'string' || apiKey.trim().length < 8) throw readableError('平台 Key 无效。')
  return {
    id: WORKBUDDY_MODEL_ID,
    name: WORKBUDDY_MODEL_NAME,
    vendor: WORKBUDDY_MODEL_NAME,
    apiKey: apiKey.trim(),
    url: normalizeGatewayChatCompletionsUrl(gatewayBaseUrl),
    supportsToolCall: true,
    // AI OPS chooses a compatible route server-side. Do not advertise an
    // unverified WorkBuddy-native vision capability here.
    supportsImages: false,
    supportsReasoning: false,
  }
}

async function readJsonIfPresent(path) {
  try {
    return { exists: true, value: JSON.parse(await readFile(path, 'utf8')) }
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return { exists: false, value: null }
    if (error instanceof SyntaxError) throw readableError('现有 WorkBuddy 模型配置不是有效 JSON，未作任何修改。')
    throw error
  }
}

function splitModelConfig(value) {
  if (Array.isArray(value)) return { shape: 'array', models: value, container: null }
  if (isRecord(value) && Array.isArray(value.models)) return { shape: 'object', models: value.models, container: value }
  throw readableError('现有 WorkBuddy 模型配置格式无法识别，未作任何修改。')
}

function mergeAiOpsModel(current, aiOpsModel) {
  const remaining = current.models.filter((model) => !isAiOpsModel(model))
  const models = [...remaining, aiOpsModel]
  if (current.shape === 'array') return models

  const next = { ...current.container, models }
  if (Array.isArray(current.container.availableModels)) {
    next.availableModels = [...new Set([
      ...current.container.availableModels.filter((modelId) => modelId !== WORKBUDDY_MODEL_ID),
      WORKBUDDY_MODEL_ID,
    ])]
  }
  return next
}

async function writeJsonAtomically(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporaryPath, path)
}

/**
 * Upserts only the AI OPS entry in WorkBuddy's local model configuration.
 * Existing unrelated models stay unchanged; WorkBuddy conversation/database
 * files are never opened or modified.
 */
export async function configureWorkBuddyModels({ configPath, apiKey, gatewayBaseUrl }) {
  if (typeof configPath !== 'string' || !configPath.trim()) throw readableError('缺少 WorkBuddy 模型配置路径。')
  const target = configPath.trim()
  const current = await readJsonIfPresent(target)
  const backupPath = `${target}.bak`
  const source = current.exists ? current : await readJsonIfPresent(backupPath)
  const parsed = source.exists ? splitModelConfig(source.value) : { shape: 'array', models: [], container: null }
  const aiOpsModel = createAiOpsModel({ apiKey, gatewayBaseUrl })

  let backup = null
  if (current.exists) {
    backup = `${target}.ai-ops-backup-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`
    await copyFile(target, backup)
  }

  const next = mergeAiOpsModel(parsed, aiOpsModel)
  await writeJsonAtomically(target, next)
  return {
    modelId: WORKBUDDY_MODEL_ID,
    created: !current.exists,
    restoredFromBackup: !current.exists && source.exists,
    preservedModels: parsed.models.filter((model) => !isAiOpsModel(model)).length,
    backup,
  }
}
