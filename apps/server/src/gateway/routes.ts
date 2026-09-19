import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { gatewayModeSchema, gatewayProviderSchema, type GatewayConfig } from '../gateway-config.js'
import type { PlatformDatabase, PlatformGatewayKey } from '../platform-db.js'
import { GatewayUpstreamError, type GatewayUpstream, type OpenAiResponsesEvent, type OpenAiResponsesRequest } from './openai-compatible.js'
import { createGatewayConnector, describeGatewayConnector } from './connectors.js'
import { responsesRequestSchema, responsesResponseSchema, toChatRequest, toResponsePayload, unsupportedResponseFields } from './responses.js'
import { outputTextLength as chunkTextLength, recordGatewayUsage, usageFromPayload, type GatewayUsageMeasurement } from './telemetry.js'

const gatewayCapabilitiesSchema = z.object({
  models: z.boolean(),
  chatCompletions: z.boolean(),
  responses: z.boolean(),
  streaming: z.boolean(),
})

const gatewayConnectorSchema = z.object({
  id: gatewayModeSchema,
  label: z.string(),
  environment: z.enum(['production', 'experiment']),
  configured: z.boolean(),
})

export const gatewayHealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('ai-ops-gateway'),
  mode: gatewayModeSchema,
  provider: gatewayProviderSchema,
  connector: gatewayConnectorSchema,
  upstreamConfigured: z.boolean(),
  capabilities: gatewayCapabilitiesSchema,
  requestId: z.string(),
})

export const gatewayConfigResponseSchema = z.object({
  mode: gatewayModeSchema,
  connector: gatewayConnectorSchema,
  upstream: z.object({
    provider: gatewayProviderSchema,
    configured: z.boolean(),
  }),
  routing: z.object({
    defaultModelConfigured: z.boolean(),
    fallbackModelConfigured: z.boolean(),
    allowFallback: z.boolean(),
  }),
  capabilities: gatewayCapabilitiesSchema,
  requestId: z.string(),
})

const gatewayErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string(),
    code: z.string(),
    requestId: z.string(),
  }),
})

const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.union([z.string(), z.array(z.unknown())]),
}).passthrough()

export const chatCompletionRequestSchema = z.object({
  model: z.string().trim().min(1).max(128),
  messages: z.array(chatMessageSchema).min(1).max(100),
  stream: z.boolean().optional().default(false),
  temperature: z.number().finite().min(0).max(2).optional(),
  top_p: z.number().finite().min(0).max(1).optional(),
  max_tokens: z.number().int().positive().max(1_000_000).optional(),
  max_completion_tokens: z.number().int().positive().max(1_000_000).optional(),
  stop: z.union([z.string(), z.array(z.string()).max(4)]).optional(),
  user: z.string().trim().max(128).optional(),
}).passthrough()

const chatCompletionResponseSchema = z.object({
  id: z.string(),
  object: z.string(),
  created: z.number().int().nonnegative(),
  model: z.string(),
  choices: z.array(z.unknown()),
}).passthrough()

export const gatewayModelsResponseSchema = z.object({
  object: z.literal('list'),
  data: z.array(z.object({
    id: z.string(),
    object: z.literal('model'),
    created: z.number().int().nonnegative(),
    owned_by: z.string(),
  })),
})

const capabilities = (config: GatewayConfig) => ({
  models: config.upstreamConfigured,
  chatCompletions: config.upstreamConfigured,
  // CPA owns the native Codex Responses protocol. The legacy standalone and
  // New API adapters keep their conservative chat-compatibility behavior.
  responses: config.mode === 'cpa' && config.upstreamConfigured,
  streaming: config.mode === 'cpa' && config.upstreamConfigured,
})

interface GatewayRouteOptions {
  upstream?: GatewayUpstream
  database?: PlatformDatabase
}

export function registerGatewayRoutes(app: FastifyInstance, config: GatewayConfig, options: GatewayRouteOptions = {}) {
  const upstream = options.upstream ?? createGatewayConnector(config)
  const connector = describeGatewayConnector(config)

  app.get('/gateway/health', {
    schema: { response: { 200: gatewayHealthResponseSchema } },
  }, async (request) => ({
    status: 'ok' as const,
    service: 'ai-ops-gateway' as const,
    mode: config.mode,
    provider: config.provider,
    connector,
    upstreamConfigured: config.upstreamConfigured,
    capabilities: capabilities(config),
    requestId: request.id,
  }))

  app.get('/gateway/config', {
    schema: { response: { 200: gatewayConfigResponseSchema } },
  }, async (request) => ({
    mode: config.mode,
    connector,
    upstream: {
      provider: config.provider,
      configured: config.upstreamConfigured,
    },
    routing: {
      defaultModelConfigured: Boolean(config.defaultModel),
      fallbackModelConfigured: Boolean(config.fallbackModel),
      allowFallback: config.allowFallback,
    },
    capabilities: capabilities(config),
    requestId: request.id,
  }))

  app.get('/v1/models', {
    schema: { response: { 200: gatewayModelsResponseSchema, 401: gatewayErrorSchema, 502: gatewayErrorSchema, 503: gatewayErrorSchema, 504: gatewayErrorSchema } },
  }, async (request, reply) => {
    const auth = authorizeGatewayClient(request.headers.authorization, config, options.database, request.id, reply)
    if ('error' in auth) return auth.error
    try {
      const models = await upstream.listModels()
      const visibleModels = auth.key ? models.filter((model) => auth.key?.models.includes(model.id)) : models
      const byId = new Map(visibleModels.map((model) => [model.id, model]))
      for (const [alias, target] of Object.entries(config.modelAliases)) {
        const source = byId.get(target)
        if (source && (!auth.key || auth.key.models.includes(alias) || auth.key.models.includes(target))) byId.set(alias, { ...source, id: alias })
      }
      return { object: 'list' as const, data: [...byId.values()] }
    } catch (error) {
      return sendUpstreamError(error, request.id, reply)
    }
  })

  app.post('/v1/chat/completions', {
    schema: {
      body: chatCompletionRequestSchema,
      response: { 200: chatCompletionResponseSchema, 400: gatewayErrorSchema, 401: gatewayErrorSchema, 403: gatewayErrorSchema, 429: gatewayErrorSchema, 502: gatewayErrorSchema, 503: gatewayErrorSchema, 504: gatewayErrorSchema },
    },
  }, async (request, reply) => {
    const auth = authorizeGatewayClient(request.headers.authorization, config, options.database, request.id, reply)
    if ('error' in auth) return auth.error
    const body = chatCompletionRequestSchema.parse(request.body)
    const requestedModel = body.model
    const model = resolveModel(config, requestedModel)
    const modelError = authorizeModel(auth.key, requestedModel, model, request.id, reply)
    if (modelError) return modelError
    request.log.info({ requestId: request.id, gatewayRoute: '/v1/chat/completions', model: requestedModel }, 'gateway chat completion')
    const startedAt = Date.now()
    if (body.stream) return streamChatCompletion(request, reply, upstream, { ...body, model, stream: true }, async (result) => {
      if (auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
        requestId: request.id, connector: config.mode, requestedModel, actualModel: model, protocol: 'chat_completions', streamed: true,
        request: { ...body, model }, startedAt, headers: request.headers, measurement: result.measurement,
        status: result.status, error: result.error,
      }, request.log)
    })
    try {
      const response = await chatCompletionWithFallback({
        upstream,
        config,
        key: auth.key,
        requestedModel,
        resolvedModel: model,
        requestId: request.id,
        gatewayRoute: '/v1/chat/completions',
        log: request.log,
        request: (candidateModel) => ({ ...body, model: candidateModel, stream: false }),
      })
      if (auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
        requestId: request.id, connector: config.mode, requestedModel, actualModel: modelForResponse(response, model), protocol: 'chat_completions', streamed: false,
        request: { ...body, model }, startedAt, headers: request.headers, measurement: { response }, status: 'succeeded',
      }, request.log)
      return chatCompletionResponseSchema.parse(response)
    } catch (error) {
      if (auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
        requestId: request.id, connector: config.mode, requestedModel, actualModel: model, protocol: 'chat_completions', streamed: false,
        request: { ...body, model }, startedAt, headers: request.headers, measurement: {}, status: isCancelledError(error) ? 'cancelled' : 'failed', error: gatewayErrorDetails(error),
      }, request.log)
      return sendUpstreamError(error, request.id, reply)
    }
  })

  app.post('/v1/responses', {
    schema: {
      body: responsesRequestSchema,
      response: { 200: responsesResponseSchema, 400: gatewayErrorSchema, 401: gatewayErrorSchema, 403: gatewayErrorSchema, 429: gatewayErrorSchema, 502: gatewayErrorSchema, 503: gatewayErrorSchema, 504: gatewayErrorSchema },
    },
  }, async (request, reply) => {
    const auth = authorizeGatewayClient(request.headers.authorization, config, options.database, request.id, reply)
    if ('error' in auth) return auth.error
    const body = responsesRequestSchema.parse(request.body)
    const nativeResponses = config.mode === 'cpa' && typeof upstream.responses === 'function'
    const unsupported = nativeResponses ? [] : unsupportedResponseFields(body)
    if (unsupported.length > 0) return sendGatewayError(reply, 400, 'GATEWAY_UNSUPPORTED', `Responses 字段暂不支持：${unsupported.join('、')}`, request.id)
    const requestedModel = body.model
    const model = resolveModel(config, requestedModel)
    const modelError = authorizeModel(auth.key, requestedModel, model, request.id, reply)
    if (modelError) return modelError
    request.log.info({ requestId: request.id, gatewayRoute: '/v1/responses', model: requestedModel }, 'gateway response request')
    const startedAt = Date.now()

    if (nativeResponses) {
      const nativeRequest = { ...body, model } as OpenAiResponsesRequest
      const usageRequest = toChatRequest(body, model)
      if (body.stream && typeof upstream.responsesStream === 'function') {
        return streamResponses(request, reply, upstream, nativeRequest, async (result) => {
          if (auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
            requestId: request.id, connector: config.mode, requestedModel, actualModel: model, protocol: 'responses', streamed: true,
            request: usageRequest, startedAt, headers: request.headers, measurement: result.measurement,
            status: result.status, error: result.error,
          }, request.log)
        })
      }
      if (body.stream) return sendGatewayError(reply, 502, 'GATEWAY_UPSTREAM_INVALID_RESPONSE', 'CPA 未提供 Responses 流式接口', request.id)
      try {
        const response = await upstream.responses!(nativeRequest)
        if (auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
          requestId: request.id, connector: config.mode, requestedModel, actualModel: modelForResponse(response, model), protocol: 'responses', streamed: false,
          request: usageRequest, startedAt, headers: request.headers, measurement: { response }, status: 'succeeded',
        }, request.log)
        return responsesResponseSchema.parse(response)
      } catch (error) {
        if (auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
          requestId: request.id, connector: config.mode, requestedModel, actualModel: model, protocol: 'responses', streamed: false,
          request: usageRequest, startedAt, headers: request.headers, measurement: {}, status: isCancelledError(error) ? 'cancelled' : 'failed', error: gatewayErrorDetails(error),
        }, request.log)
        return sendUpstreamError(error, request.id, reply)
      }
    }

    if (body.stream) return sendGatewayError(reply, 400, 'GATEWAY_UNSUPPORTED', '当前连接器不支持 Responses 流式输出，请使用 CPA 连接器', request.id)
    try {
      const response = await chatCompletionWithFallback({
        upstream,
        config,
        key: auth.key,
        requestedModel,
        resolvedModel: model,
        requestId: request.id,
        gatewayRoute: '/v1/responses',
        log: request.log,
        request: (candidateModel) => toChatRequest(body, candidateModel),
      })
      if (auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
        requestId: request.id, connector: config.mode, requestedModel, actualModel: modelForResponse(response, model), protocol: 'responses', streamed: false,
        request: toChatRequest(body, model), startedAt, headers: request.headers, measurement: { response }, status: 'succeeded',
      }, request.log)
      return responsesResponseSchema.parse(toResponsePayload(response))
    } catch (error) {
      if (auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
        requestId: request.id, connector: config.mode, requestedModel, actualModel: model, protocol: 'responses', streamed: false,
        request: toChatRequest(body, model), startedAt, headers: request.headers, measurement: {}, status: isCancelledError(error) ? 'cancelled' : 'failed', error: gatewayErrorDetails(error),
      }, request.log)
      return sendUpstreamError(error, request.id, reply)
    }
  })
}

function resolveModel(config: GatewayConfig, requestedModel: string) {
  return config.modelAliases[requestedModel] ?? (requestedModel === 'default' ? config.defaultModel : undefined) ?? requestedModel
}

interface FallbackRequestOptions {
  upstream: GatewayUpstream
  config: GatewayConfig
  key: PlatformGatewayKey | null
  requestedModel: string
  resolvedModel: string
  requestId: string
  gatewayRoute: string
  log: { warn: (bindings: Record<string, unknown>, message: string) => void }
  request: (model: string) => Parameters<GatewayUpstream['chatCompletion']>[0]
}

async function chatCompletionWithFallback(options: FallbackRequestOptions) {
  try {
    return await options.upstream.chatCompletion(options.request(options.resolvedModel))
  } catch (error) {
    const fallbackModel = options.config.fallbackModel ? resolveModel(options.config, options.config.fallbackModel) : undefined
    if (!fallbackModel || !options.config.allowFallback || fallbackModel === options.resolvedModel || !isFallbackEligible(error)) throw error
    if (options.key && !options.key.models.includes(options.config.fallbackModel!) && !options.key.models.includes(fallbackModel)) throw error
    options.log.warn({
      requestId: options.requestId,
      gatewayRoute: options.gatewayRoute,
      requestedModel: options.requestedModel,
      fromModel: options.resolvedModel,
      toModel: fallbackModel,
      reason: gatewayErrorDetails(error).code,
    }, 'gateway fallback route')
    return options.upstream.chatCompletion(options.request(fallbackModel))
  }
}

function isFallbackEligible(error: unknown) {
  if (!(error instanceof GatewayUpstreamError)) return false
  return error.code === 'GATEWAY_UPSTREAM_TIMEOUT'
    || error.code === 'GATEWAY_UPSTREAM_UNAVAILABLE'
    || error.code === 'GATEWAY_UPSTREAM_RATE_LIMITED'
    || error.code === 'GATEWAY_UPSTREAM_ERROR'
}

async function streamChatCompletion(
  request: FastifyRequest,
  reply: FastifyReply,
  upstream: GatewayUpstream,
  body: { model: string; messages: Array<{ role: string; content: unknown; [key: string]: unknown }>; [key: string]: unknown },
  onComplete?: (result: { status: 'succeeded' | 'failed' | 'cancelled'; error?: { code: string; message: string }; measurement: GatewayUsageMeasurement }) => Promise<void>,
) {
  const abortController = new AbortController()
  let clientClosed = false
  let status: 'succeeded' | 'failed' | 'cancelled' = 'succeeded'
  let errorDetails: { code: string; message: string } | undefined
  let firstTokenMs: number | null = null
  let usage: { inputTokens?: number; outputTokens?: number } | undefined
  let outputLength = 0
  const startedAt = Date.now()
  const onClose = () => {
    if (reply.raw.writableEnded) return
    clientClosed = true
    abortController.abort()
    void upstream.cancel(request.id).catch(() => undefined)
  }
  request.raw.once('close', onClose)
  reply.hijack()
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-request-id': request.id,
  })
  try {
    await upstream.chatCompletionStream(body, (chunk) => {
      if (firstTokenMs === null) firstTokenMs = Date.now() - startedAt
      usage = usageFromPayload(chunk) ?? usage
      outputLength += chunkTextLength(chunk)
      if (!clientClosed && !reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`)
    }, abortController.signal, request.id)
    if (!clientClosed && !reply.raw.destroyed && !reply.raw.writableEnded) {
      reply.raw.write('data: [DONE]\n\n')
      reply.raw.end()
    }
  } catch (error) {
    const details = gatewayErrorDetails(error)
    errorDetails = details
    status = clientClosed || isCancelledError(error) ? 'cancelled' : 'failed'
    if (!clientClosed && !reply.raw.destroyed && !reply.raw.writableEnded) {
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: { ...details, requestId: request.id } })}\n\n`)
      reply.raw.end()
    }
  } finally {
    request.raw.removeListener('close', onClose)
    if (!reply.raw.writableEnded && !reply.raw.destroyed) reply.raw.end()
    if (onComplete) await onComplete({ status, error: errorDetails, measurement: { usage, outputTextLength: outputLength, firstTokenMs } })
  }
}

async function streamResponses(
  request: FastifyRequest,
  reply: FastifyReply,
  upstream: GatewayUpstream,
  body: OpenAiResponsesRequest,
  onComplete?: (result: { status: 'succeeded' | 'failed' | 'cancelled'; error?: { code: string; message: string }; measurement: GatewayUsageMeasurement }) => Promise<void>,
) {
  const abortController = new AbortController()
  let clientClosed = false
  let status: 'succeeded' | 'failed' | 'cancelled' = 'succeeded'
  let errorDetails: { code: string; message: string } | undefined
  let firstTokenMs: number | null = null
  let usage: { inputTokens?: number; outputTokens?: number } | undefined
  let outputLength = 0
  const startedAt = Date.now()
  const onClose = () => {
    if (reply.raw.writableEnded) return
    clientClosed = true
    abortController.abort()
    void upstream.cancel(request.id).catch(() => undefined)
  }
  request.raw.once('close', onClose)
  reply.hijack()
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-request-id': request.id,
  })
  try {
    await upstream.responsesStream!(body, (event: OpenAiResponsesEvent) => {
      if (firstTokenMs === null) firstTokenMs = Date.now() - startedAt
      usage = usageFromPayload(event.data) ?? usage
      outputLength += chunkTextLength(event.data)
      if (!clientClosed && !reply.raw.destroyed && !reply.raw.writableEnded) {
        const prefix = event.event ? `event: ${event.event}\n` : ''
        reply.raw.write(`${prefix}data: ${JSON.stringify(event.data)}\n\n`)
      }
    }, abortController.signal, request.id)
    if (!clientClosed && !reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end()
  } catch (error) {
    const details = gatewayErrorDetails(error)
    errorDetails = details
    status = clientClosed || isCancelledError(error) ? 'cancelled' : 'failed'
    if (!clientClosed && !reply.raw.destroyed && !reply.raw.writableEnded) {
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: { ...details, requestId: request.id } })}\n\n`)
      reply.raw.end()
    }
  } finally {
    request.raw.removeListener('close', onClose)
    if (!reply.raw.writableEnded && !reply.raw.destroyed) reply.raw.end()
    if (onComplete) await onComplete({ status, error: errorDetails, measurement: { usage, outputTextLength: outputLength, firstTokenMs } })
  }
}

function modelForResponse(response: Record<string, unknown>, fallback: string) {
  return typeof response.model === 'string' && response.model ? response.model : fallback
}

function isCancelledError(error: unknown) {
  return error instanceof GatewayUpstreamError && error.code === 'GATEWAY_UPSTREAM_CANCELLED'
}

async function recordGatewayUsageSafely(
  database: PlatformDatabase,
  key: PlatformGatewayKey,
  context: Omit<Parameters<typeof recordGatewayUsage>[0], 'database' | 'key'>,
  log: { warn: (bindings: Record<string, unknown>, message: string) => void },
) {
  try {
    recordGatewayUsage({ ...context, database, key })
  } catch (error) {
    log.warn({ requestId: context.requestId, error: error instanceof Error ? error.message : 'unknown' }, 'gateway telemetry write failed')
  }
}

function authorizeGatewayClient(authorization: string | undefined, config: GatewayConfig, database: PlatformDatabase | undefined, requestId: string, reply: any): { key: PlatformGatewayKey | null } | { error: unknown } {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  if (!token) {
    reply.header('www-authenticate', 'Bearer')
    return { error: sendGatewayError(reply, 401, 'GATEWAY_AUTH_REQUIRED', '请提供网关客户端凭据', requestId) }
  }
  const key = database?.findGatewayKey(token)
  if (key) return { key }
  if (config.clientApiKey && secureEqual(token, config.clientApiKey)) return { key: null }
  reply.header('www-authenticate', 'Bearer')
  return { error: sendGatewayError(reply, 401, 'GATEWAY_AUTH_INVALID', '网关客户端凭据无效', requestId) }
}

function authorizeModel(key: PlatformGatewayKey | null, requestedModel: string, resolvedModel: string, requestId: string, reply: any) {
  if (!key || key.model === requestedModel || key.model === resolvedModel) return null
  return sendGatewayError(reply, 403, 'GATEWAY_MODEL_FORBIDDEN', `当前 Key 仅绑定模型 ${key.model}，不能调用 ${requestedModel}`, requestId)
}

function sendUpstreamError(error: unknown, requestId: string, reply: any) {
  const details = gatewayErrorDetails(error)
  return sendGatewayError(reply, details.statusCode, details.code, details.message, requestId)
}

function sendGatewayError(reply: any, statusCode: number, code: string, message: string, requestId: string) {
  return reply.status(statusCode).send({ error: { message, type: 'gateway_error', code, requestId } })
}

function gatewayErrorDetails(error: unknown) {
  if (error instanceof GatewayUpstreamError) return { statusCode: error.statusCode, code: error.code, message: error.message }
  return { statusCode: 502, code: 'GATEWAY_UPSTREAM_ERROR', message: '上游服务暂时不可用' }
}

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}
