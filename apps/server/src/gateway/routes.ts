import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { gatewayModeSchema, gatewayProviderSchema, type GatewayConfig } from '../gateway-config.js'
import type { PlatformConversationAuditCompletion, PlatformDatabase, PlatformGatewayKey } from '../platform-db.js'
import { GatewayUpstreamError, type GatewayRequestContext, type GatewayUpstream, type OpenAiResponsesEvent, type OpenAiResponsesRequest } from './openai-compatible.js'
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

export const gatewayUpstreamHealthResponseSchema = z.object({
  status: z.enum(['healthy', 'empty', 'unconfigured', 'auth_required', 'offline', 'timeout', 'error']),
  mode: gatewayModeSchema,
  modelCount: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative().nullable(),
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
  // `developer` is the role newer OpenAI-compatible clients emit for system-level
  // instructions; accept it alongside the classic `system` role.
  role: z.enum(['system', 'developer', 'user', 'assistant', 'tool']),
  // OpenAI-compatible clients frequently send `content: null` or omit `content`
  // entirely on assistant messages that only carry tool_calls. Accept both and
  // normalise them to an empty string before the request reaches the upstream.
  content: z
    .union([z.string(), z.array(z.unknown()), z.null()])
    .optional()
    .transform((value) => value ?? ''),
}).passthrough()

export const chatCompletionRequestSchema = z.object({
  model: z.string().trim().min(1).max(128),
  // Agent clients replay full conversation history on every turn. A 100-message
  // ceiling breaks long sessions well before the upstream context window does,
  // so let the upstream decide where the real limit is.
  messages: z.array(chatMessageSchema).min(1).max(2_000),
  stream: z.boolean().optional().default(false),
  temperature: z.number().finite().min(0).max(2).optional(),
  top_p: z.number().finite().min(0).max(1).optional(),
  max_tokens: z.number().int().positive().max(1_000_000).optional(),
  max_completion_tokens: z.number().int().positive().max(1_000_000).optional(),
  stop: z.union([z.string(), z.array(z.string()).max(16)]).optional(),
  user: z.string().trim().max(512).optional(),
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
  // CPA owns the native Codex Responses protocol. Standalone and New API
  // connectors still expose the OpenAI-compatible Chat Completions stream.
  responses: config.mode === 'cpa' && config.upstreamConfigured,
  streaming: config.upstreamConfigured,
})

interface GatewayRouteOptions {
  upstream?: GatewayUpstream
  database?: PlatformDatabase
  /** Resolve a managed New API token without persisting its secret. */
  resolveExternalClientKey?: (secret: string) => Promise<PlatformGatewayKey | null>
}

interface GatewayAuditHandle {
  database: PlatformDatabase
  requestId: string
  recordId: string
  startedAt: number
}

type GatewayAuthorization = { key: PlatformGatewayKey | null; upstreamContext?: GatewayRequestContext }

function beginGatewayAudit(database: PlatformDatabase | undefined, key: PlatformGatewayKey | null, input: {
  requestId: string
  model: string
  endpoint: string
  body: unknown
  streamed: boolean
  startedAt: number
  httpStatus?: number | null
}, log: { warn: (bindings: Record<string, unknown>, message: string) => void }): GatewayAuditHandle | null {
  if (!database || !key) return null
  try {
    const recordId = `conv-audit-${input.requestId.replace(/^req-/u, '').replace(/[^a-z0-9-]/giu, '-').toLowerCase()}`
    const grouping = groupingForBody(input.body)
    database.startConversationAuditCapture({
      id: recordId,
      requestId: input.requestId,
      keyId: key.id,
      externalTokenId: key.externalTokenId,
      personId: key.ownerUserId,
      keyMasked: key.maskedValue,
      purpose: key.purpose,
      model: input.model,
      endpoint: input.endpoint,
      startedAt: new Date(input.startedAt).toISOString(),
      prompt: input.body,
      streamed: input.streamed,
      groupingType: grouping.type,
      groupingReliable: grouping.type === 'conversation',
      groupingLabel: grouping.label,
      httpStatus: input.httpStatus ?? null,
    })
    return { database, requestId: input.requestId, recordId, startedAt: input.startedAt }
  } catch (error) {
    log.warn({ requestId: input.requestId, error: error instanceof Error ? error.message : 'unknown' }, 'conversation audit capture start failed')
    return null
  }
}

function appendGatewayAuditChunk(handle: GatewayAuditHandle | null, chunk: unknown, log?: { warn: (bindings: Record<string, unknown>, message: string) => void }) {
  if (!handle) return
  try { handle.database.appendConversationAuditChunk(handle.requestId, chunk) }
  catch (error) { log?.warn({ requestId: handle.requestId, error: error instanceof Error ? error.message : 'unknown' }, 'conversation audit chunk write failed') }
}

function completeGatewayAudit(handle: GatewayAuditHandle | null, completion: Omit<PlatformConversationAuditCompletion, 'completedAt'> & { completedAt?: string }, log: { warn: (bindings: Record<string, unknown>, message: string) => void }) {
  if (!handle) return
  try {
    handle.database.completeConversationAuditCapture(handle.requestId, { ...completion, completedAt: completion.completedAt ?? new Date().toISOString() })
  } catch (error) {
    log.warn({ requestId: handle.requestId, error: error instanceof Error ? error.message : 'unknown' }, 'conversation audit capture completion failed')
  }
}

function groupingForBody(body: unknown): { type: 'conversation' | 'independent_call'; label: string } {
  if (body && typeof body === 'object') {
    const value = body as Record<string, unknown>
    const candidate = value.conversation_id ?? value.conversationId ?? (value.metadata && typeof value.metadata === 'object' ? (value.metadata as Record<string, unknown>).conversation_id : undefined)
    if (typeof candidate === 'string' && candidate.trim()) return { type: 'conversation', label: `会话 ${candidate.trim().slice(0, 120)}` }
  }
  return { type: 'independent_call', label: '独立调用' }
}

export function registerGatewayRoutes(app: FastifyInstance, config: GatewayConfig, options: GatewayRouteOptions = {}) {
  const upstream = options.upstream ?? createGatewayConnector(config)
  const connector = () => describeGatewayConnector(config)

  app.get('/gateway/health', {
    schema: { response: { 200: gatewayHealthResponseSchema } },
  }, async (request) => ({
    status: 'ok' as const,
    service: 'ai-ops-gateway' as const,
    mode: config.mode,
    provider: config.provider,
    connector: connector(),
    upstreamConfigured: config.upstreamConfigured,
    capabilities: capabilities(config),
    requestId: request.id,
  }))

  // This is deliberately separate from /gateway/health. The latter is a
  // cheap container/readiness check; this endpoint performs one real /models
  // request so operators can distinguish "configured" from "CPA is serving
  // an authenticated model catalog" without exposing any credential.
  app.get('/gateway/upstream-health', {
    schema: { response: { 200: gatewayUpstreamHealthResponseSchema } },
  }, async (request) => {
    if (!config.upstreamConfigured) {
      return { status: 'unconfigured' as const, mode: config.mode, modelCount: 0, latencyMs: null, requestId: request.id }
    }
    const startedAt = Date.now()
    try {
      const models = await upstream.listModels()
      return { status: models.length > 0 ? 'healthy' as const : 'empty' as const, mode: config.mode, modelCount: models.length, latencyMs: Date.now() - startedAt, requestId: request.id }
    } catch (error) {
      const code = error instanceof GatewayUpstreamError ? error.code : 'GATEWAY_UPSTREAM_ERROR'
      const status = code === 'GATEWAY_UPSTREAM_AUTH_FAILED'
        ? 'auth_required' as const
        : code === 'GATEWAY_UPSTREAM_TIMEOUT'
          ? 'timeout' as const
          : code === 'GATEWAY_UPSTREAM_UNAVAILABLE'
            ? 'offline' as const
            : 'error' as const
      return { status, mode: config.mode, modelCount: 0, latencyMs: Date.now() - startedAt, requestId: request.id }
    }
  })

  app.get('/gateway/config', {
    schema: { response: { 200: gatewayConfigResponseSchema } },
  }, async (request) => ({
    mode: config.mode,
    connector: connector(),
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
    const auth = await authorizeGatewayClient(request.headers.authorization, config, options, request.id, reply)
    if ('error' in auth) return auth.error
    try {
      const models = await upstream.listModels(undefined, auth.upstreamContext)
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
    const auth = await authorizeGatewayClient(request.headers.authorization, config, options, request.id, reply)
    if ('error' in auth) return auth.error
    const body = chatCompletionRequestSchema.parse(request.body)
    const requestedModel = body.model
    const model = resolveModel(config, requestedModel)
    const modelError = authorizeModel(auth.key, requestedModel, model, request.id, reply)
    if (modelError) return modelError
    request.log.info({ requestId: request.id, gatewayRoute: '/v1/chat/completions', model: requestedModel }, 'gateway chat completion')
    const startedAt = Date.now()
    const audit = beginGatewayAudit(options.database, auth.key, { requestId: request.id, model, endpoint: '/v1/chat/completions', body: { ...body, model }, streamed: Boolean(body.stream), startedAt }, request.log)
    if (body.stream) return streamChatCompletion(request, reply, upstream, { ...body, model, stream: true }, auth.upstreamContext, async (result) => {
      if (auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
        requestId: request.id, connector: config.mode, requestedModel, actualModel: model, protocol: 'chat_completions', streamed: true,
        request: { ...body, model }, startedAt, headers: request.headers, measurement: result.measurement,
        status: result.status, error: result.error,
      }, request.log)
      completeGatewayAudit(audit, { status: result.status, httpStatus: result.status === 'succeeded' ? 200 : result.error ? errorStatusCode(result.error.code) : 499, terminationReason: result.error?.code ?? (result.status === 'succeeded' ? 'stop' : 'cancelled'), captureError: result.error?.message }, request.log)
    }, (chunk) => appendGatewayAuditChunk(audit, chunk, request.log))
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
        upstreamContext: auth.upstreamContext,
      })
      if (auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
        requestId: request.id, connector: config.mode, requestedModel, actualModel: modelForResponse(response, model), protocol: 'chat_completions', streamed: false,
        request: { ...body, model }, startedAt, headers: request.headers, measurement: { response }, status: 'succeeded',
      }, request.log)
      completeGatewayAudit(audit, { status: 'succeeded', httpStatus: 200, response, totalTokens: responseUsageTokens(response), terminationReason: responseFinishReason(response) }, request.log)
      return chatCompletionResponseSchema.parse(response)
    } catch (error) {
      if (auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
        requestId: request.id, connector: config.mode, requestedModel, actualModel: model, protocol: 'chat_completions', streamed: false,
        request: { ...body, model }, startedAt, headers: request.headers, measurement: {}, status: isCancelledError(error) ? 'cancelled' : 'failed', error: gatewayErrorDetails(error),
      }, request.log)
      const details = gatewayErrorDetails(error)
      completeGatewayAudit(audit, { status: isCancelledError(error) ? 'cancelled' : 'failed', httpStatus: details.statusCode, terminationReason: details.code, captureError: details.message }, request.log)
      return sendUpstreamError(error, request.id, reply)
    }
  })

  app.post('/v1/responses', {
    schema: {
      body: responsesRequestSchema,
      response: { 200: responsesResponseSchema, 400: gatewayErrorSchema, 401: gatewayErrorSchema, 403: gatewayErrorSchema, 429: gatewayErrorSchema, 502: gatewayErrorSchema, 503: gatewayErrorSchema, 504: gatewayErrorSchema },
    },
  }, async (request, reply) => {
    const auth = await authorizeGatewayClient(request.headers.authorization, config, options, request.id, reply)
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
    const audit = beginGatewayAudit(options.database, auth.key, { requestId: request.id, model, endpoint: '/v1/responses', body: { ...body, model }, streamed: Boolean(body.stream), startedAt }, request.log)

    if (nativeResponses) {
      const nativeRequest = { ...body, model } as OpenAiResponsesRequest
      const usageRequest = toChatRequest(body, model)
      if (body.stream && typeof upstream.responsesStream === 'function') {
        return streamResponses(request, reply, upstream, nativeRequest, auth.upstreamContext, async (result) => {
          if (auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
            requestId: request.id, connector: config.mode, requestedModel, actualModel: model, protocol: 'responses', streamed: true,
            request: usageRequest, startedAt, headers: request.headers, measurement: result.measurement,
            status: result.status, error: result.error,
          }, request.log)
          completeGatewayAudit(audit, { status: result.status, httpStatus: result.status === 'succeeded' ? 200 : result.error ? errorStatusCode(result.error.code) : 499, terminationReason: result.error?.code ?? (result.status === 'succeeded' ? 'completed' : 'cancelled'), captureError: result.error?.message }, request.log)
        }, (event) => appendGatewayAuditChunk(audit, event, request.log))
      }
      if (body.stream) {
        completeGatewayAudit(audit, { status: 'body_unavailable', httpStatus: 502, terminationReason: 'GATEWAY_UPSTREAM_INVALID_RESPONSE', captureError: 'CPA 未提供 Responses 流式接口' }, request.log)
        return sendGatewayError(reply, 502, 'GATEWAY_UPSTREAM_INVALID_RESPONSE', 'CPA 未提供 Responses 流式接口', request.id)
      }
      try {
        const response = await upstream.responses!(nativeRequest, undefined, auth.upstreamContext)
        if (auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
          requestId: request.id, connector: config.mode, requestedModel, actualModel: modelForResponse(response, model), protocol: 'responses', streamed: false,
          request: usageRequest, startedAt, headers: request.headers, measurement: { response }, status: 'succeeded',
        }, request.log)
        completeGatewayAudit(audit, { status: 'succeeded', httpStatus: 200, response, totalTokens: responseUsageTokens(response), terminationReason: responseFinishReason(response) }, request.log)
        return responsesResponseSchema.parse(response)
      } catch (error) {
        if (auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
          requestId: request.id, connector: config.mode, requestedModel, actualModel: model, protocol: 'responses', streamed: false,
          request: usageRequest, startedAt, headers: request.headers, measurement: {}, status: isCancelledError(error) ? 'cancelled' : 'failed', error: gatewayErrorDetails(error),
        }, request.log)
        const details = gatewayErrorDetails(error)
        completeGatewayAudit(audit, { status: isCancelledError(error) ? 'cancelled' : 'failed', httpStatus: details.statusCode, terminationReason: details.code, captureError: details.message }, request.log)
        return sendUpstreamError(error, request.id, reply)
      }
    }

    if (body.stream) {
      completeGatewayAudit(audit, {
        status: 'body_unavailable',
        httpStatus: 400,
        terminationReason: 'GATEWAY_UNSUPPORTED',
        captureError: '当前连接器不支持 Responses 流式输出，请使用 CPA 连接器',
      }, request.log)
      return sendGatewayError(reply, 400, 'GATEWAY_UNSUPPORTED', '当前连接器不支持 Responses 流式输出，请使用 CPA 连接器', request.id)
    }
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
        upstreamContext: auth.upstreamContext,
      })
      if (auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
        requestId: request.id, connector: config.mode, requestedModel, actualModel: modelForResponse(response, model), protocol: 'responses', streamed: false,
        request: toChatRequest(body, model), startedAt, headers: request.headers, measurement: { response }, status: 'succeeded',
      }, request.log)
      completeGatewayAudit(audit, { status: 'succeeded', httpStatus: 200, response: toResponsePayload(response), totalTokens: responseUsageTokens(response), terminationReason: responseFinishReason(response) }, request.log)
      return responsesResponseSchema.parse(toResponsePayload(response))
    } catch (error) {
      if (auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
        requestId: request.id, connector: config.mode, requestedModel, actualModel: model, protocol: 'responses', streamed: false,
        request: toChatRequest(body, model), startedAt, headers: request.headers, measurement: {}, status: isCancelledError(error) ? 'cancelled' : 'failed', error: gatewayErrorDetails(error),
      }, request.log)
      const details = gatewayErrorDetails(error)
      completeGatewayAudit(audit, { status: isCancelledError(error) ? 'cancelled' : 'failed', httpStatus: details.statusCode, terminationReason: details.code, captureError: details.message }, request.log)
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
  upstreamContext?: GatewayRequestContext
}

async function chatCompletionWithFallback(options: FallbackRequestOptions) {
  try {
    return await options.upstream.chatCompletion(options.request(options.resolvedModel), undefined, options.upstreamContext)
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
    return options.upstream.chatCompletion(options.request(fallbackModel), undefined, options.upstreamContext)
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
  upstreamContext?: GatewayRequestContext,
  onComplete?: (result: { status: 'succeeded' | 'failed' | 'cancelled'; error?: { code: string; message: string }; measurement: GatewayUsageMeasurement }) => Promise<void>,
  onChunk?: (chunk: Record<string, unknown>) => void,
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
      onChunk?.(chunk)
      if (firstTokenMs === null) firstTokenMs = Date.now() - startedAt
      usage = usageFromPayload(chunk) ?? usage
      outputLength += chunkTextLength(chunk)
      if (!clientClosed && !reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`)
    }, abortController.signal, request.id, upstreamContext)
    if (clientClosed) status = 'cancelled'
    else if (!reply.raw.destroyed && !reply.raw.writableEnded) {
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
  upstreamContext?: GatewayRequestContext,
  onComplete?: (result: { status: 'succeeded' | 'failed' | 'cancelled'; error?: { code: string; message: string }; measurement: GatewayUsageMeasurement }) => Promise<void>,
  onEvent?: (event: OpenAiResponsesEvent) => void,
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
      onEvent?.(event)
      if (firstTokenMs === null) firstTokenMs = Date.now() - startedAt
      usage = usageFromPayload(event.data) ?? usage
      outputLength += chunkTextLength(event.data)
      if (!clientClosed && !reply.raw.destroyed && !reply.raw.writableEnded) {
        const prefix = event.event ? `event: ${event.event}\n` : ''
        reply.raw.write(`${prefix}data: ${JSON.stringify(event.data)}\n\n`)
      }
    }, abortController.signal, request.id, upstreamContext)
    if (clientClosed) status = 'cancelled'
    else if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end()
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

async function authorizeGatewayClient(authorization: string | undefined, config: GatewayConfig, options: GatewayRouteOptions, requestId: string, reply: any): Promise<GatewayAuthorization | { error: unknown }> {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  if (!token) {
    reply.header('www-authenticate', 'Bearer')
    return { error: sendGatewayError(reply, 401, 'GATEWAY_AUTH_REQUIRED', '请提供网关客户端凭据', requestId) }
  }
  const key = options.database?.findGatewayKey(token)
  if (key) return { key }
  if (config.mode === 'new_api') {
    try {
      const externalKey = await options.resolveExternalClientKey?.(token)
      if (externalKey) return { key: externalKey, upstreamContext: { authorization: `Bearer ${token}` } }
    } catch {
      // External credential lookup is fail-closed. It must never turn an
      // upstream auth/storage problem into a 5xx or leak implementation detail.
    }
  }
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

function errorStatusCode(code: string) {
  if (code.includes('CANCEL')) return 499
  if (code.includes('RATE_LIMIT')) return 429
  if (code.includes('TIMEOUT')) return 504
  if (code.includes('AUTH')) return 502
  return 502
}

function responseUsageTokens(response: Record<string, unknown>) {
  const usage = response.usage
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return 0
  const value = usage as Record<string, unknown>
  const input = Number(value.prompt_tokens ?? value.input_tokens ?? 0)
  const output = Number(value.completion_tokens ?? value.output_tokens ?? 0)
  return Number.isFinite(input) && Number.isFinite(output) ? Math.max(0, Math.floor(input + output)) : 0
}

function responseFinishReason(response: Record<string, unknown>) {
  const choices = Array.isArray(response.choices) ? response.choices : []
  const first = choices[0]
  if (first && typeof first === 'object' && typeof (first as Record<string, unknown>).finish_reason === 'string') return (first as Record<string, unknown>).finish_reason as string
  if (typeof response.status === 'string') return response.status
  return null
}

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}
