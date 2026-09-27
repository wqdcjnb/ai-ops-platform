import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { configureCodex, inspectCodexStatus } from './codex-config.mjs'
import { configureWorkBuddyModels } from './workbuddy-config.mjs'

const port = Number(process.env.AI_OPS_WORKBUDDY_CONNECTOR_PORT ?? 4176)
const configPath = process.env.AI_OPS_WORKBUDDY_CONFIG_PATH ?? join(homedir(), '.workbuddy', 'models.json')
const configuredOrigins = (process.env.AI_OPS_WORKBUDDY_CONNECTOR_ORIGINS ?? 'http://127.0.0.1:4174,http://localhost:4174')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const allowedOrigins = new Set(configuredOrigins)

function sendJson(response, statusCode, body, origin) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  }
  if (origin && allowedOrigins.has(origin)) headers['access-control-allow-origin'] = origin
  response.writeHead(statusCode, headers)
  response.end(JSON.stringify(body))
}

function allowedOrigin(request) {
  const origin = typeof request.headers.origin === 'string' ? request.headers.origin : ''
  return origin && allowedOrigins.has(origin) ? origin : null
}

async function readJsonBody(request) {
  const chunks = []
  let length = 0
  for await (const chunk of request) {
    length += chunk.length
    if (length > 16 * 1024) throw new Error('请求体过大。')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('请求格式无效。')
  }
}

const server = createServer(async (request, response) => {
  const origin = allowedOrigin(request)
  if (request.method === 'OPTIONS') {
    if (!origin) return sendJson(response, 403, { error: '不允许的页面来源。' })
    response.writeHead(204, {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '600',
      vary: 'Origin',
    })
    return response.end()
  }

  if (request.method === 'GET' && request.url === '/health') {
    return sendJson(response, 200, { status: 'ok', service: 'ai-ops-workbuddy-connector', clients: ['workbuddy', 'codex'] }, origin)
  }

  if (request.method === 'GET' && request.url === '/v1/codex/status') {
    if (!origin) return sendJson(response, 403, { error: '不允许的页面来源。' })
    try {
      // The status is deliberately coarse. The connector never reads or
      // exposes Codex auth.json, account identity, or any local path.
      return sendJson(response, 200, { ok: true, codex: await inspectCodexStatus() }, origin)
    } catch {
      return sendJson(response, 200, { ok: true, codex: { installation: 'not_detected', login: 'unknown', customProviderAvailableWithoutLogin: true } }, origin)
    }
  }

  if (request.method !== 'POST' || !['/v1/workbuddy/configure', '/v1/codex/configure'].includes(request.url ?? '')) {
    return sendJson(response, 404, { error: '未找到本地连接器接口。' }, origin)
  }
  if (!origin) return sendJson(response, 403, { error: '不允许的页面来源。' })

  try {
    const body = await readJsonBody(request)
    if (request.url === '/v1/workbuddy/configure') {
      const result = await configureWorkBuddyModels({
        configPath,
        apiKey: body?.apiKey,
        gatewayBaseUrl: body?.gatewayBaseUrl,
      })
      // Intentionally never echo an API Key, path, or configuration content.
      return sendJson(response, 200, { ok: true, modelId: result.modelId, created: result.created, restoredFromBackup: result.restoredFromBackup, preservedModels: result.preservedModels }, origin)
    }

    const result = await configureCodex({
      apiKey: body?.apiKey,
      gatewayBaseUrl: body?.gatewayBaseUrl,
    })
    // Intentionally never echo an API Key, path, account state detail, or
    // configuration content. Existing Codex conversations are untouched.
    return sendJson(response, 200, {
      ok: true,
      modelId: result.modelId,
      configCreated: result.configCreated,
      backupCreated: result.backupCreated,
      restartRequired: result.restartRequired,
      login: result.login,
    }, origin)
  } catch (error) {
    const message = error instanceof Error ? error.message : request.url === '/v1/codex/configure' ? '无法写入 Codex 配置。' : '无法写入 WorkBuddy 配置。'
    return sendJson(response, 400, { ok: false, error: message }, origin)
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`AI OPS local client connector listening on http://127.0.0.1:${port}`)
})
