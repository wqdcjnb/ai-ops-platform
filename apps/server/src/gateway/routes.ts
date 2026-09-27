import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { gatewayModeSchema, gatewayProviderSchema, type GatewayConfig } from '../gateway-config.js'
import type { PlatformConversationAuditCompletion, PlatformDatabase, PlatformGatewayKey } from '../platform-db.js'
import { GatewayUpstreamError, type GatewayRequestContext, type GatewayUpstream, type OpenAiMediaRequest, type OpenAiResponsesEvent, type OpenAiResponsesRequest } from './openai-compatible.js'
import { createGatewayConnector, describeGatewayConnector } from './connectors.js'
import { responsesRequestSchema, responsesResponseSchema, toChatRequest, toResponsePayload, unsupportedResponseFields } from './responses.js'
import { outputTextLength as chunkTextLength, recordGatewayUsage, usageFromPayload, type GatewayUsageMeasurement } from './telemetry.js'
import { compactChatRequest, compactResponsesRequest, type GatewayContextMetrics } from './context-optimizer.js'
import { isPublicModelId, normalizePublicModelId, PUBLIC_MODEL_ID, samePublicModel } from '../public-model.js'

const gatewayCapabilitiesSchema = z.object({
  models: z.boolean(),
  chatCompletions: z.boolean(),
  responses: z.boolean(),
  media: z.boolean(),
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
  routing: z.object({ publicModel: z.literal(PUBLIC_MODEL_ID) }),
  streaming: z.object({
    defaultEnabled: z.boolean(),
    passthrough: z.literal(true),
  }),
  context: z.object({
    enabled: z.boolean(),
    maxInputChars: z.number().int().positive(),
    maxMessages: z.number().int().positive(),
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
  stream: z.boolean().optional(),
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

const mediaRequestSchema = z.object({
  // OpenAI-compatible image/video/audio clients do not always send a model.
  // The public contract still has exactly one virtual model, so default it
  // here rather than leaking a relay-specific default to the client.
  model: z.string().trim().min(1).max(128).optional().default(PUBLIC_MODEL_ID),
}).passthrough()

const mediaResponseSchema = z.object({}).passthrough()

export const gatewayModelsResponseSchema = z.object({
  object: z.literal('list'),
  data: z.array(z.object({
    id: z.string(),
    object: z.literal('model'),
    created: z.number().int().nonnegative(),
    owned_by: z.string(),
  })),
})

const capabilities = (externalModelsAvailable = false) => ({
  models: externalModelsAvailable,
  chatCompletions: externalModelsAvailable,
  // The relay adapter forwards the native Responses contract whenever an
  // enabled third-party account is present.
  responses: externalModelsAvailable,
  media: externalModelsAvailable,
  streaming: externalModelsAvailable,
})

interface GatewayRouteOptions {
  upstream?: GatewayUpstream
  database?: PlatformDatabase
  /** True when the secure third-party provider registry has routable models. */
  hasExternalModels?: () => boolean
  /** The virtual relay model uses native Responses when supported upstream. */
  supportsNativeResponses?: (model: string) => boolean
}

interface GatewayAuditHandle {
  database: PlatformDatabase
  requestId: string
  recordId: string
  startedAt: number
}

type GatewayAuthorization = { key: PlatformGatewayKey | null; upstreamContext?: GatewayRequestContext }

/**
 * Some clients send a second model request solely to generate a new local
 * conversation title. It is a client-internal UI operation, not an employee
 * conversation turn, so it must not create a row in the conversation audit.
 */
function isInternalTopicTitleRequest(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  const request = body as Record<string, unknown>
  const metadata = request.metadata && typeof request.metadata === 'object' && !Array.isArray(request.metadata)
    ? request.metadata as Record<string, unknown>
    : null
  const isNewTopic = request.isNewTopic === true || metadata?.isNewTopic === true
  const hasTitle = typeof request.title === 'string' || typeof metadata?.title === 'string'
  return isNewTopic && hasTitle
}

function beginGatewayAudit(database: PlatformDatabase | undefined, key: PlatformGatewayKey | null, input: {
  requestId: string
  model: string
  endpoint: string
  body: unknown
  originalBody?: unknown
  streamed: boolean
  startedAt: number
  httpStatus?: number | null
}, log: { warn: (bindings: Record<string, unknown>, message: string) => void }): GatewayAuditHandle | null {
  if (!database || !key) return null
  if (isInternalTopicTitleRequest(input.originalBody ?? input.body)) return null
  try {
    const requestedRecordId = `conv-audit-${input.requestId.replace(/^req-/u, '').replace(/[^a-z0-9-]/giu, '-').toLowerCase()}`
    const grouping = groupingForBody(input.body)
    const recordId = database.startConversationAuditCapture({
      id: requestedRecordId,
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
    if (!recordId) return null
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
  const externalModelsAvailable = () => options.hasExternalModels?.() ?? false
  const connector = () => ({ ...describeGatewayConnector(config), configured: externalModelsAvailable() })

  app.get('/gateway/health', {
    schema: { response: { 200: gatewayHealthResponseSchema } },
  }, async (request) => ({
    status: 'ok' as const,
    service: 'ai-ops-gateway' as const,
    mode: config.mode,
    provider: config.provider,
    connector: connector(),
    upstreamConfigured: externalModelsAvailable(),
    capabilities: capabilities(externalModelsAvailable()),
    requestId: request.id,
  }))

  // This is deliberately separate from /gateway/health. The latter is a
  // cheap readiness check; this endpoint performs one relay /models probe
  // without exposing any relay credential.
  app.get('/gateway/upstream-health', {
    schema: { response: { 200: gatewayUpstreamHealthResponseSchema } },
  }, async (request) => {
    if (!externalModelsAvailable()) {
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
      configured: externalModelsAvailable(),
    },
    routing: { publicModel: PUBLIC_MODEL_ID },
    streaming: { defaultEnabled: config.defaultStreaming, passthrough: true as const },
    context: config.context,
    capabilities: capabilities(externalModelsAvailable()),
    requestId: request.id,
  }))

  app.get('/v1/models', {
    schema: { response: { 200: gatewayModelsResponseSchema, 401: gatewayErrorSchema, 502: gatewayErrorSchema, 503: gatewayErrorSchema, 504: gatewayErrorSchema } },
  }, async (request, reply) => {
    const auth = await authorizeGatewayClient(request.headers.authorization, options, request.id, reply)
    if ('error' in auth) return auth.error
    try {
      const models = await upstream.listModels(undefined, auth.upstreamContext)
      const gatewayKey = auth.key
      const visibleModels = gatewayKey ? models.filter((model) => keyAllowsModel(gatewayKey, model.id)) : models
      return { object: 'list' as const, data: visibleModels }
    } catch (error) {
      return sendUpstreamError(error, request.id, reply)
    }
  })

  const registerMediaRoute = (
    publicPath: '/v1/images/generations' | '/v1/videos' | '/v1/audio/speech',
    upstreamPath: '/images/generations' | '/videos' | '/audio/speech',
  ) => {
    app.post(publicPath, {
      schema: {
        body: mediaRequestSchema,
        response: { 200: mediaResponseSchema, 400: gatewayErrorSchema, 401: gatewayErrorSchema, 403: gatewayErrorSchema, 429: gatewayErrorSchema, 502: gatewayErrorSchema, 503: gatewayErrorSchema, 504: gatewayErrorSchema },
      },
    }, async (request, reply) => {
      const startedAt = Date.now()
      const auth = await authorizeGatewayClient(request.headers.authorization, options, request.id, reply)
      if ('error' in auth) return auth.error
      const body = mediaRequestSchema.parse(request.body)
      const requestedModel = body.model
      const model = normalizePublicModelId(requestedModel)
      const modelError = authorizeModel(auth.key, requestedModel, model, request.id, reply)
      if (modelError) return modelError
      if (typeof upstream.media !== 'function') return sendGatewayError(reply, 400, 'GATEWAY_UNSUPPORTED', '当前中转站未启用多模态 JSON 接口', request.id)

      const timing: GatewayRequestTiming = {
        startedAt,
        aiOpsAuthMs: Date.now() - startedAt,
        contextCompactionMs: 0,
        context: { originalChars: 0, forwardedChars: 0, droppedMessages: 0, strippedChars: 0 },
      }
      // Retain only operation metadata in the conversation audit. Image/audio
      // binary or data URLs must never be duplicated into an audit payload.
      const audit = beginGatewayAudit(options.database, auth.key, {
        requestId: request.id,
        model,
        endpoint: publicPath,
        body: { model, mediaEndpoint: publicPath, content: '[多模态输入未采集]' },
        streamed: false,
        startedAt,
      }, request.log)
      const usageRequest = mediaUsageRequest(publicPath, model)
      const modelCapture = captureActualModel(auth.upstreamContext, model)
      const upstreamStartedAt = Date.now()
      try {
        const response = await upstream.media(upstreamPath, { ...body, model } as OpenAiMediaRequest, undefined, modelCapture.upstreamContext)
        if (auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
          requestId: request.id,
          connector: config.mode,
          requestedModel,
          actualModel: modelCapture.actualModel(modelForResponse(response, model)),
          // The existing usage store classifies requests as either chat or
          // Responses. Media is recorded in the native-contract bucket while
          // its endpoint remains explicit in the conversation audit.
          protocol: 'responses',
          streamed: false,
          request: usageRequest,
          startedAt,
          headers: request.headers,
          measurement: nonStreamingMeasurement(response, timing, upstreamStartedAt),
          status: 'succeeded',
          retryCount: 0,
        }, request.log)
        completeGatewayAudit(audit, { status: 'succeeded', httpStatus: 200, response: { mediaEndpoint: publicPath, model }, totalTokens: 0, terminationReason: 'completed' }, request.log)
        return mediaResponseSchema.parse(response)
      } catch (error) {
        if (auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
          requestId: request.id,
          connector: config.mode,
          requestedModel,
          actualModel: modelCapture.actualModel(),
          protocol: 'responses',
          streamed: false,
          request: usageRequest,
          startedAt,
          headers: request.headers,
          measurement: nonStreamingMeasurement(undefined, timing, upstreamStartedAt),
          status: isCancelledError(error) ? 'cancelled' : 'failed',
          error: gatewayErrorDetails(error),
          retryCount: 0,
        }, request.log)
        const details = gatewayErrorDetails(error)
        completeGatewayAudit(audit, { status: isCancelledError(error) ? 'cancelled' : 'failed', httpStatus: details.statusCode, terminationReason: details.code, captureError: details.message }, request.log)
        return sendUpstreamError(error, request.id, reply)
      }
    })
  }

  registerMediaRoute('/v1/images/generations', '/images/generations')
  registerMediaRoute('/v1/videos', '/videos')
  registerMediaRoute('/v1/audio/speech', '/audio/speech')

  app.post('/v1/chat/completions', {
    schema: {
      body: chatCompletionRequestSchema,
      response: { 200: chatCompletionResponseSchema, 400: gatewayErrorSchema, 401: gatewayErrorSchema, 403: gatewayErrorSchema, 429: gatewayErrorSchema, 502: gatewayErrorSchema, 503: gatewayErrorSchema, 504: gatewayErrorSchema },
    },
  }, async (request, reply) => {
    const startedAt = Date.now()
    const auth = await authorizeGatewayClient(request.headers.authorization, options, request.id, reply)
    if ('error' in auth) return auth.error
    const aiOpsAuthMs = Date.now() - startedAt
    const parsedBody = chatCompletionRequestSchema.parse(request.body)
    const requestedModel = parsedBody.model
    const model = normalizePublicModelId(requestedModel)
    const modelError = authorizeModel(auth.key, requestedModel, model, request.id, reply)
    if (modelError) return modelError
    const stream = parsedBody.stream ?? config.defaultStreaming
    const compactionStartedAt = Date.now()
    const compacted = compactChatRequest({ ...parsedBody, stream }, config.context)
    const contextCompactionMs = Date.now() - compactionStartedAt
    const body = { ...parsedBody, ...compacted.request, stream }
    const timing: GatewayRequestTiming = { startedAt, aiOpsAuthMs, contextCompactionMs, context: compacted.metrics }
    request.log.info({ requestId: request.id, gatewayRoute: '/v1/chat/completions', model: requestedModel }, 'gateway chat completion')
    const audit = beginGatewayAudit(options.database, auth.key, { requestId: request.id, model, endpoint: '/v1/chat/completions', body: { ...body, model }, originalBody: parsedBody, streamed: Boolean(body.stream), startedAt }, request.log)
    const modelCapture = captureActualModel(auth.upstreamContext, model)
    let retryCount = 0
    let upstreamStartedAt = 0
    if (body.stream) return streamChatCompletion(request, reply, upstream, { ...body, model, stream: true }, timing, modelCapture.upstreamContext, async (result) => {
      if (auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
        requestId: request.id, connector: config.mode, requestedModel, actualModel: modelCapture.actualModel(), protocol: 'chat_completions', streamed: true,
        request: { ...body, model }, startedAt, headers: request.headers, measurement: result.measurement,
        status: result.status, error: result.error,
      }, request.log)
      completeGatewayAudit(audit, { status: result.status, httpStatus: result.status === 'succeeded' ? 200 : result.error ? errorStatusCode(result.error.code) : 499, terminationReason: result.error?.code ?? (result.status === 'succeeded' ? 'stop' : 'cancelled'), captureError: result.error?.message }, request.log)
    }, (chunk) => appendGatewayAuditChunk(audit, chunk, request.log))
    try {
      upstreamStartedAt = Date.now()
      const completion = await chatCompletionThroughRelay({
        upstream,
        request: () => ({ ...body, model, stream: false }),
        upstreamContext: modelCapture.upstreamContext,
      })
      const response = completion.response
      if (auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
        requestId: request.id, connector: config.mode, requestedModel, actualModel: modelCapture.actualModel(modelForResponse(response, model)), protocol: 'chat_completions', streamed: false,
        request: { ...body, model }, startedAt, headers: request.headers,
        measurement: nonStreamingMeasurement(response, timing, upstreamStartedAt), status: 'succeeded', retryCount: completion.retryCount,
      }, request.log)
      completeGatewayAudit(audit, { status: 'succeeded', httpStatus: 200, response, totalTokens: responseUsageTokens(response), terminationReason: responseFinishReason(response) }, request.log)
      return chatCompletionResponseSchema.parse(response)
    } catch (error) {
      if (auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
        requestId: request.id, connector: config.mode, requestedModel, actualModel: modelCapture.actualModel(), protocol: 'chat_completions', streamed: false,
        request: { ...body, model }, startedAt, headers: request.headers,
        measurement: nonStreamingMeasurement(undefined, timing, upstreamStartedAt || Date.now()), status: isCancelledError(error) ? 'cancelled' : 'failed', error: gatewayErrorDetails(error), retryCount,
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
    const startedAt = Date.now()
    const auth = await authorizeGatewayClient(request.headers.authorization, options, request.id, reply)
    if ('error' in auth) return auth.error
    const aiOpsAuthMs = Date.now() - startedAt
    const parsedBody = responsesRequestSchema.parse(request.body)
    const stream = parsedBody.stream ?? config.defaultStreaming
    const compactionStartedAt = Date.now()
    const compacted = compactResponsesRequest({ ...parsedBody, stream }, config.context)
    const contextCompactionMs = Date.now() - compactionStartedAt
    const body = { ...parsedBody, ...compacted.request, stream }
    const timing: GatewayRequestTiming = { startedAt, aiOpsAuthMs, contextCompactionMs, context: compacted.metrics }
    const requestedModel = body.model
    const model = normalizePublicModelId(requestedModel)
    const nativeResponses = (options.supportsNativeResponses?.(model) ?? false) && typeof upstream.responses === 'function'
    const unsupported = nativeResponses ? [] : unsupportedResponseFields(body)
    if (unsupported.length > 0) return sendGatewayError(reply, 400, 'GATEWAY_UNSUPPORTED', `Responses 字段暂不支持：${unsupported.join('、')}`, request.id)
    const modelError = authorizeModel(auth.key, requestedModel, model, request.id, reply)
    if (modelError) return modelError
    request.log.info({ requestId: request.id, gatewayRoute: '/v1/responses', model: requestedModel }, 'gateway response request')
    const audit = beginGatewayAudit(options.database, auth.key, { requestId: request.id, model, endpoint: '/v1/responses', body: { ...body, model }, originalBody: parsedBody, streamed: Boolean(body.stream), startedAt }, request.log)
    const modelCapture = captureActualModel(auth.upstreamContext, model)

    if (nativeResponses) {
      const nativeRequest = { ...body, model } as OpenAiResponsesRequest
      const usageRequest = toChatRequest(body, model)
      if (body.stream && typeof upstream.responsesStream === 'function') {
        return streamResponses(request, reply, upstream, nativeRequest, timing, modelCapture.upstreamContext, async (result) => {
          if (auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
            requestId: request.id, connector: config.mode, requestedModel, actualModel: modelCapture.actualModel(), protocol: 'responses', streamed: true,
            request: usageRequest, startedAt, headers: request.headers, measurement: result.measurement,
            status: result.status, error: result.error,
          }, request.log)
          completeGatewayAudit(audit, { status: result.status, httpStatus: result.status === 'succeeded' ? 200 : result.error ? errorStatusCode(result.error.code) : 499, terminationReason: result.error?.code ?? (result.status === 'succeeded' ? 'completed' : 'cancelled'), captureError: result.error?.message }, request.log)
        }, (event) => appendGatewayAuditChunk(audit, event, request.log))
      }
      if (body.stream) {
        completeGatewayAudit(audit, { status: 'body_unavailable', httpStatus: 502, terminationReason: 'GATEWAY_UPSTREAM_INVALID_RESPONSE', captureError: '当前上游未提供 Responses 流式接口' }, request.log)
        return sendGatewayError(reply, 502, 'GATEWAY_UPSTREAM_INVALID_RESPONSE', '当前上游未提供 Responses 流式接口', request.id)
      }
      let upstreamStartedAt = 0
      try {
        upstreamStartedAt = Date.now()
        const response = await upstream.responses!(nativeRequest, undefined, modelCapture.upstreamContext)
        if (auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
          requestId: request.id, connector: config.mode, requestedModel, actualModel: modelCapture.actualModel(modelForResponse(response, model)), protocol: 'responses', streamed: false,
          request: usageRequest, startedAt, headers: request.headers,
          measurement: nonStreamingMeasurement(response, timing, upstreamStartedAt), status: 'succeeded', retryCount: 0,
        }, request.log)
        completeGatewayAudit(audit, { status: 'succeeded', httpStatus: 200, response, totalTokens: responseUsageTokens(response), terminationReason: responseFinishReason(response) }, request.log)
        return responsesResponseSchema.parse(response)
      } catch (error) {
        if (auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
          requestId: request.id, connector: config.mode, requestedModel, actualModel: modelCapture.actualModel(), protocol: 'responses', streamed: false,
          request: usageRequest, startedAt, headers: request.headers,
          measurement: nonStreamingMeasurement(undefined, timing, upstreamStartedAt || Date.now()), status: isCancelledError(error) ? 'cancelled' : 'failed', error: gatewayErrorDetails(error), retryCount: 0,
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
        captureError: '当前连接器不支持 Responses 流式输出，请选择已启用的 Responses 兼容模型',
      }, request.log)
      return sendGatewayError(reply, 400, 'GATEWAY_UNSUPPORTED', '当前连接器不支持 Responses 流式输出，请选择已启用的 Responses 兼容模型', request.id)
    }
    let retryCount = 0
    let upstreamStartedAt = 0
    try {
      upstreamStartedAt = Date.now()
      const completion = await chatCompletionThroughRelay({
        upstream,
        request: () => toChatRequest(body, model),
        upstreamContext: modelCapture.upstreamContext,
      })
      const response = completion.response
      if (auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
        requestId: request.id, connector: config.mode, requestedModel, actualModel: modelCapture.actualModel(modelForResponse(response, model)), protocol: 'responses', streamed: false,
        request: toChatRequest(body, model), startedAt, headers: request.headers,
        measurement: nonStreamingMeasurement(response, timing, upstreamStartedAt), status: 'succeeded', retryCount: completion.retryCount,
      }, request.log)
      completeGatewayAudit(audit, { status: 'succeeded', httpStatus: 200, response: toResponsePayload(response), totalTokens: responseUsageTokens(response), terminationReason: responseFinishReason(response) }, request.log)
      return responsesResponseSchema.parse(toResponsePayload(response))
    } catch (error) {
      if (auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
        requestId: request.id, connector: config.mode, requestedModel, actualModel: modelCapture.actualModel(), protocol: 'responses', streamed: false,
        request: toChatRequest(body, model), startedAt, headers: request.headers,
        measurement: nonStreamingMeasurement(undefined, timing, upstreamStartedAt || Date.now()), status: isCancelledError(error) ? 'cancelled' : 'failed', error: gatewayErrorDetails(error), retryCount,
      }, request.log)
      const details = gatewayErrorDetails(error)
      completeGatewayAudit(audit, { status: isCancelledError(error) ? 'cancelled' : 'failed', httpStatus: details.statusCode, terminationReason: details.code, captureError: details.message }, request.log)
      return sendUpstreamError(error, request.id, reply)
    }
  })
}

function mediaUsageRequest(endpoint: string, model: string) {
  return {
    model,
    // Do not put a prompt, image URL, binary payload, or audio text into the
    // telemetry approximation. The endpoint is retained in the audit record
    // and this harmless marker is enough to keep Key last-used metadata and
    // high-level traffic accounting correct.
    messages: [{ role: 'user', content: `${endpoint} 多模态调用` }],
  }
}

/**
 * The public API deliberately continues to return only `ai-ops`.  This
 * request-scoped observer is the separate, server-side path used to retain
 * the actual upstream model for administrator analytics.  It has no shared
 * mutable state, so concurrent gateway calls cannot overwrite one another.
 */
function captureActualModel(upstreamContext: GatewayRequestContext | undefined, fallback: string) {
  let selectedModel: string | null = null
  const previousObserver = upstreamContext?.onActualModel
  return {
    upstreamContext: {
      ...upstreamContext,
      onActualModel(modelId: string) {
        const normalized = validActualModel(modelId)
        if (normalized) selectedModel = normalized
        // An observability listener must never affect the user request.
        try { previousObserver?.(modelId) } catch { /* ignore observer failure */ }
      },
    } satisfies GatewayRequestContext,
    actualModel(reportedModel?: string) {
      return selectedModel ?? validActualModel(reportedModel) ?? fallback
    },
  }
}

function validActualModel(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized || normalized.length > 160 || /[\u0000-\u001f\u007f]/.test(normalized) || isPublicModelId(normalized)) return null
  return normalized
}

interface GatewayCompletionOptions {
  upstream: GatewayUpstream
  request: () => Parameters<GatewayUpstream['chatCompletion']>[0]
  upstreamContext?: GatewayRequestContext
}

async function chatCompletionThroughRelay(options: GatewayCompletionOptions) {
  return {
    response: await options.upstream.chatCompletion(options.request(), undefined, options.upstreamContext),
    // Relay selection and safe retry-before-output are owned by
    // ExternalProviderGatewayUpstream. A second gateway-level fallback would
    // risk sending the same real generation twice.
    retryCount: 0,
  }
}

interface GatewayRequestTiming {
  startedAt: number
  aiOpsAuthMs: number
  contextCompactionMs: number
  context: GatewayContextMetrics
}

function nonStreamingMeasurement(response: Record<string, unknown> | undefined, timing: GatewayRequestTiming, upstreamStartedAt: number): GatewayUsageMeasurement {
  return {
    ...(response ? { response } : {}),
    aiOpsAuthMs: timing.aiOpsAuthMs,
    contextCompactionMs: timing.contextCompactionMs,
    context: timing.context,
    upstreamFirstTokenMs: null,
    upstreamTotalMs: Math.max(0, Date.now() - upstreamStartedAt),
  }
}

const maximumCapturedStreamTextChars = 250_000

function streamText(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const payload = value as Record<string, unknown>
  if (typeof payload.delta === 'string') return payload.delta
  if (typeof payload.output_text === 'string') return payload.output_text
  if (typeof payload.text === 'string') return payload.text
  const choices = Array.isArray(payload.choices) ? payload.choices : []
  return choices.map((choice) => {
    if (!choice || typeof choice !== 'object') return ''
    const item = choice as Record<string, unknown>
    const message = item.delta && typeof item.delta === 'object' ? item.delta : item.message && typeof item.message === 'object' ? item.message : item
    return typeof (message as Record<string, unknown>).content === 'string' ? (message as Record<string, unknown>).content as string : ''
  }).join('')
}

function appendCapturedStreamText(current: string, value: unknown) {
  if (current.length >= maximumCapturedStreamTextChars) return current
  const next = streamText(value)
  if (!next) return current
  return `${current}${next.slice(0, maximumCapturedStreamTextChars - current.length)}`
}

async function streamChatCompletion(
  request: FastifyRequest,
  reply: FastifyReply,
  upstream: GatewayUpstream,
  body: { model: string; messages: Array<{ role: string; content: unknown; [key: string]: unknown }>; [key: string]: unknown },
  timing: GatewayRequestTiming,
  upstreamContext?: GatewayRequestContext,
  onComplete?: (result: { status: 'succeeded' | 'failed' | 'cancelled'; error?: { code: string; message: string }; measurement: GatewayUsageMeasurement }) => Promise<void>,
  onChunk?: (chunk: Record<string, unknown>) => void,
) {
  const abortController = new AbortController()
  let clientClosed = false
  let status: 'succeeded' | 'failed' | 'cancelled' = 'succeeded'
  let errorDetails: { code: string; message: string } | undefined
  let firstTokenMs: number | null = null
  let upstreamFirstTokenMs: number | null = null
  let usage: { inputTokens?: number; outputTokens?: number } | undefined
  let outputLength = 0
  let capturedText = ''
  let upstreamStartedAt = 0
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
    'x-accel-buffering': 'no',
    'x-request-id': request.id,
  })
  reply.raw.flushHeaders()
  try {
    upstreamStartedAt = Date.now()
    await upstream.chatCompletionStream(body, (chunk) => {
      onChunk?.(chunk)
      capturedText = appendCapturedStreamText(capturedText, chunk)
      const textLength = chunkTextLength(chunk)
      if (firstTokenMs === null && textLength > 0) {
        firstTokenMs = Date.now() - timing.startedAt
        upstreamFirstTokenMs = Date.now() - upstreamStartedAt
      }
      usage = usageFromPayload(chunk) ?? usage
      outputLength += textLength
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
    if (onComplete) await onComplete({ status, error: errorDetails, measurement: {
      usage, response: capturedText ? { output_text: capturedText } : undefined, outputTextLength: outputLength, firstTokenMs,
      upstreamFirstTokenMs,
      upstreamTotalMs: upstreamStartedAt ? Math.max(0, Date.now() - upstreamStartedAt) : 0,
      aiOpsAuthMs: timing.aiOpsAuthMs, contextCompactionMs: timing.contextCompactionMs, context: timing.context,
    } })
  }
}

async function streamResponses(
  request: FastifyRequest,
  reply: FastifyReply,
  upstream: GatewayUpstream,
  body: OpenAiResponsesRequest,
  timing: GatewayRequestTiming,
  upstreamContext?: GatewayRequestContext,
  onComplete?: (result: { status: 'succeeded' | 'failed' | 'cancelled'; error?: { code: string; message: string }; measurement: GatewayUsageMeasurement }) => Promise<void>,
  onEvent?: (event: OpenAiResponsesEvent) => void,
) {
  const abortController = new AbortController()
  let clientClosed = false
  let status: 'succeeded' | 'failed' | 'cancelled' = 'succeeded'
  let errorDetails: { code: string; message: string } | undefined
  let firstTokenMs: number | null = null
  let upstreamFirstTokenMs: number | null = null
  let usage: { inputTokens?: number; outputTokens?: number } | undefined
  let outputLength = 0
  let capturedText = ''
  let upstreamStartedAt = 0
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
    'x-accel-buffering': 'no',
    'x-request-id': request.id,
  })
  reply.raw.flushHeaders()
  try {
    upstreamStartedAt = Date.now()
    await upstream.responsesStream!(body, (event: OpenAiResponsesEvent) => {
      onEvent?.(event)
      capturedText = appendCapturedStreamText(capturedText, event.data)
      const textLength = chunkTextLength(event.data)
      if (firstTokenMs === null && textLength > 0) {
        firstTokenMs = Date.now() - timing.startedAt
        upstreamFirstTokenMs = Date.now() - upstreamStartedAt
      }
      usage = usageFromPayload(event.data) ?? usage
      outputLength += textLength
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
    if (onComplete) await onComplete({ status, error: errorDetails, measurement: {
      usage, response: capturedText ? { output_text: capturedText } : undefined, outputTextLength: outputLength, firstTokenMs,
      upstreamFirstTokenMs,
      upstreamTotalMs: upstreamStartedAt ? Math.max(0, Date.now() - upstreamStartedAt) : 0,
      aiOpsAuthMs: timing.aiOpsAuthMs, contextCompactionMs: timing.contextCompactionMs, context: timing.context,
    } })
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

async function authorizeGatewayClient(authorization: string | undefined, options: GatewayRouteOptions, requestId: string, reply: any): Promise<GatewayAuthorization | { error: unknown }> {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  if (!token) {
    reply.header('www-authenticate', 'Bearer')
    return { error: sendGatewayError(reply, 401, 'GATEWAY_AUTH_REQUIRED', '请提供网关客户端凭据', requestId) }
  }
  const key = options.database?.findGatewayKey(token)
  if (key) return { key }
  // Platform Keys are the only accepted client credential. Relay account
  // credentials remain encrypted server-side and are never used for client
  // authentication.
  reply.header('www-authenticate', 'Bearer')
  return { error: sendGatewayError(reply, 401, 'GATEWAY_AUTH_INVALID', '网关客户端凭据无效', requestId) }
}

function keyAllowsModel(key: PlatformGatewayKey, model: string) {
  return key.models.some((allowed) => samePublicModel(allowed, model)) || samePublicModel(key.model, model)
}

function authorizeModel(key: PlatformGatewayKey | null, requestedModel: string, resolvedModel: string, requestId: string, reply: any) {
  if (!key || keyAllowsModel(key, requestedModel) || keyAllowsModel(key, resolvedModel)) return null
  return sendGatewayError(reply, 403, 'GATEWAY_MODEL_FORBIDDEN', `当前 Key 未获准调用 ${requestedModel}`, requestId)
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
