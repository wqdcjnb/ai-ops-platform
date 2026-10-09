import { PUBLIC_MODEL_ID, samePublicModel } from '../public-model.js'
import { GatewayUpstreamError } from './openai-compatible.js'
import type { PlatformGatewayKey } from '../platform-db.js'
import type { GatewayAuthorization, GatewayRouteOptions } from './schemas.js'

export async function authorizeGatewayClient(authorization: string | undefined, options: GatewayRouteOptions, requestId: string, reply: any): Promise<GatewayAuthorization | { error: unknown }> {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  if(!token) {
    reply.header('www-authenticate', 'Bearer')
    return { error: sendGatewayError(reply, 401, 'GATEWAY_AUTH_REQUIRED', '请提供网关客户端凭据', requestId) }
  }
  const key = (await options.database?.findGatewayKey(token))
  if(key) {
    const controller = new AbortController()
    reply.raw.once('close', () => { if(!reply.raw.writableEnded) controller.abort() })
    if(options.runtime && reply.request.method === 'POST' && !reply.request.url.includes('/cancel')) {
      try {
        const { runtimeLimit } = await import('../runtime-coordinator.js')
        if(!await options.runtime.rateLimit('gateway:' + key.ownerUserId, runtimeLimit('AI_OPS_EMPLOYEE_RPM', 120))) {
          reply.header('retry-after', '60')
          return { error: sendGatewayError(reply, 429, 'GATEWAY_RATE_LIMITED', '当前人员调用过于频繁，请稍后重试', requestId) }
        }
        const release = await options.runtime.acquire([
          { key: 'gateway', limit: runtimeLimit('AI_OPS_GATEWAY_CONCURRENCY', 200) },
          { key: 'person:' + key.ownerUserId, limit: runtimeLimit('AI_OPS_EMPLOYEE_CONCURRENCY', 4) },
        ], { signal: controller.signal, waitMs: 1_000 })
        if(!release) {
          reply.header('retry-after', '1')
          return { error: sendGatewayError(reply, 429, 'GATEWAY_RATE_LIMITED', '当前并发较多，请稍后重试', requestId) }
        }
        const done = () => { void release().catch(() => undefined) }
        reply.raw.once('finish', done)
        reply.raw.once('close', done)
        if(controller.signal.aborted) { await release(); return { error: sendGatewayError(reply, 503, 'GATEWAY_UNAVAILABLE', '请求已取消', requestId) } }
      } catch {
        return { error: sendGatewayError(reply, 503, 'GATEWAY_UNAVAILABLE', '并发控制服务暂时不可用，请稍后重试', requestId) }
      }
    }
    return { key, upstreamContext: { signal: controller.signal } }
  }
  // Platform Keys are the only accepted client credential. Relay account
  // credentials remain encrypted server-side and are never used for client
  // authentication.
  reply.header('www-authenticate', 'Bearer')
  return { error: sendGatewayError(reply, 401, 'GATEWAY_AUTH_INVALID', '网关客户端凭据无效', requestId) }
}

export function keyAllowsModel(key: PlatformGatewayKey, model: string) {
  void key
  return samePublicModel(PUBLIC_MODEL_ID, model)
}

export function authorizeModel(key: PlatformGatewayKey | null, requestedModel: string, resolvedModel: string, requestId: string, reply: any) {
  if(!key || keyAllowsModel(key, requestedModel) || keyAllowsModel(key, resolvedModel)) return null
  return sendGatewayError(reply, 403, 'GATEWAY_MODEL_FORBIDDEN', `当前 Key 未获准调用 ${requestedModel}`, requestId)
}

export function sendUpstreamError(error: unknown, requestId: string, reply: any) {
  const details = gatewayErrorDetails(error)
  return sendGatewayError(reply, details.statusCode, details.code, details.message, requestId)
}

export function sendGatewayError(reply: any, statusCode: number, code: string, message: string, requestId: string) {
  return reply.status(statusCode).send({ error: { message, type: 'gateway_error', code, requestId } })
}

export function gatewayErrorDetails(error: unknown) {
  if(error instanceof GatewayUpstreamError) return { statusCode: error.statusCode, code: error.code, message: error.message }
  return { statusCode: 502, code: 'GATEWAY_UPSTREAM_ERROR', message: '上游服务暂时不可用' }
}

export function errorStatusCode(code: string) {
  if(code.includes('CANCEL')) return 499
  if(code.includes('RATE_LIMIT')) return 429
  if(code.includes('TIMEOUT')) return 504
  if(code.includes('AUTH')) return 502
  return 502
}
