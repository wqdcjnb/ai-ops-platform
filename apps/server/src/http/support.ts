import { randomBytes } from 'node:crypto'
import { z } from 'zod'

export const SYSTEM_AUDIT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000

export type AppErrorStatus = 400 | 401 | 403 | 404 | 409 | 410 | 500 | 502 | 503 | 504

export class ManagedKeyError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode: AppErrorStatus = 409) {
    super(message)
    this.name = 'ManagedKeyError'
  }
}

export function publicGatewayBaseUrlForCodex() {
  try {
    const url = new URL(process.env.AI_OPS_PUBLIC_GATEWAY_BASE_URL?.trim() || 'http://127.0.0.1:4175')
    if(url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported gateway protocol')
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    url.pathname = (url.pathname.replace(/\/$/, '') + '/v1').replace(/\/v1\/v1$/, '/v1')
    return url.toString().replace(/\/$/, '')
  } catch {
    return 'http://127.0.0.1:4175/v1'
  }
}

export function publicAssistantServerUrl() {
  const url = new URL(publicGatewayBaseUrlForCodex())
  url.pathname = url.pathname.replace(/\/v1\/?$/u, '') || '/'
  return url.toString().replace(/\/$/u, '')
}

export function createPlatformApiKeySecret() {
  return 'sk-aiops-' + randomBytes(32).toString('base64url')
}

export function maskPlatformApiKey(secret: string) {
  return 'sk-aiops••••••' + secret.slice(-6).toUpperCase()
}

export function errorPayload(code: string, message: string, requestId: string) {
  return { error: { code, message, requestId } }
}

export function deviceSetupFailureMessage(failureCode: string | null) {
  if(failureCode === 'WORKBUDDY_INVALID_JSON') return 'WorkBuddy 的 models.json 不是有效 JSON，未修改原文件。请修复该文件后重新导入。'
  if(failureCode === 'WORKBUDDY_UNSUPPORTED_ROOT') return 'WorkBuddy 的 models.json 顶层不是模型数组，且无法安全迁移；原文件已保留。'
  if(failureCode === 'WORKBUDDY_MODEL_ID_CONFLICT') return 'WorkBuddy 已有其他自定义模型使用了保留 ID “ai-ops”。为避免覆盖原模型，本次未作修改；请先修改该模型 ID 后重新导入。'
  if(failureCode === 'KEY_UNAVAILABLE' || failureCode === 'SECRET_UNAVAILABLE') return '当前平台 Key 不可用，请刷新员工门户后重新申请或导入。'
  return '本机助手未能写入客户端配置。请重新导入；如仍失败，请联系管理员。'
}

export function parseInput(schema: z.ZodTypeAny, input: unknown, requestId: string, reply: any): any {
  const parsed = schema.safeParse(input)
  if(parsed.success) return parsed.data
  reply.status(400).send(errorPayload('VALIDATION_ERROR', '请求参数不符合接口约定。', requestId))
  return null
}
