import type { FastifyInstance } from 'fastify'
import type { GatewayConfig } from '../gateway-config.js'
import { createGatewayConnector, describeGatewayConnector } from './connectors.js'
import { compactChatRequest, compactResponsesRequest } from './context-optimizer.js'
import { GatewayUpstreamError, type OpenAiMediaRequest, type OpenAiResponsesRequest } from './openai-compatible.js'
import { responsesRequestSchema, responsesResponseSchema, toChatRequest, toResponsePayload, unsupportedResponseFields } from './responses.js'
import { normalizePublicModelId, PUBLIC_MODEL_ID } from '../public-model.js'

import type { GatewayRouteOptions } from './schemas.js'
import { chatCompletionRequestSchema, chatCompletionResponseSchema, gatewayConfigResponseSchema, gatewayErrorSchema, gatewayHealthResponseSchema, gatewayModelsResponseSchema, gatewayUpstreamHealthResponseSchema, mediaRequestSchema, mediaResponseSchema } from './schemas.js'
import { capabilities } from './catalog.js'
import { appendGatewayAuditChunk, beginGatewayAudit, completeGatewayAudit } from './audit-capture.js'
import { captureActualModel, chatCompletionThroughRelay, mediaUsageRequest, nonStreamingMeasurement, recordGatewayUsageSafely, responseFinishReason, responseUsageTokens, type GatewayRequestTiming } from './completion.js'
import { authorizeGatewayClient, authorizeModel, errorStatusCode, gatewayErrorDetails, keyAllowsModel, sendGatewayError, sendUpstreamError } from './authorization.js'
import { isCancelledError, modelForResponse, streamChatCompletion, streamResponses } from './streaming.js'

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
    if(!externalModelsAvailable()) {
      return { status: 'unconfigured' as const, mode: config.mode, modelCount: 0, latencyMs: null, requestId: request.id }
    }
    const startedAt = Date.now()
    try {
      const models = await upstream.listModels()
      return { status: models.length > 0 ? 'healthy' as const : 'empty' as const, mode: config.mode, modelCount: models.length, latencyMs: Date.now() - startedAt, requestId: request.id }
    } catch(error) {
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
    if('error' in auth) return auth.error
    try {
      const models = await upstream.listModels(undefined, auth.upstreamContext)
      const gatewayKey = auth.key
      const visibleModels = gatewayKey ? models.filter((model) => keyAllowsModel(gatewayKey, model.id)) : models
      return { object: 'list' as const, data: visibleModels }
    } catch(error) {
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
      if('error' in auth) return auth.error
      const body = mediaRequestSchema.parse(request.body)
      const requestedModel = body.model
      const model = normalizePublicModelId(requestedModel)
      const modelError = authorizeModel(auth.key, requestedModel, model, request.id, reply)
      if(modelError) return modelError
      if(typeof upstream.media !== 'function') return sendGatewayError(reply, 400, 'GATEWAY_UNSUPPORTED', '当前中转站未启用多模态 JSON 接口', request.id)

      const timing: GatewayRequestTiming = {
        startedAt,
        aiOpsAuthMs: Date.now() - startedAt,
        contextCompactionMs: 0,
        context: { originalChars: 0, forwardedChars: 0, droppedMessages: 0, strippedChars: 0 },
      }
      // Retain only operation metadata in the conversation audit. Image/audio
      // binary or data URLs must never be duplicated into an audit payload.
      const audit = (await beginGatewayAudit(options.database, auth.key, {
        requestId: request.id,
        model,
        endpoint: publicPath,
        body: { model, mediaEndpoint: publicPath, content: '[多模态输入未采集]' },
        streamed: false,
        startedAt,
      }, request.log))
      const usageRequest = mediaUsageRequest(publicPath, model)
      const modelCapture = captureActualModel(auth.upstreamContext, model)
      const upstreamStartedAt = Date.now()
      try {
        const response = await upstream.media(upstreamPath, { ...body, model } as OpenAiMediaRequest, undefined, modelCapture.upstreamContext)
        if(auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
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
        await completeGatewayAudit(audit, { status: 'succeeded', httpStatus: 200, response: { mediaEndpoint: publicPath, model }, totalTokens: 0, terminationReason: 'completed' }, request.log)
        return mediaResponseSchema.parse(response)
      } catch(error) {
        if(auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
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
        await completeGatewayAudit(audit, { status: isCancelledError(error) ? 'cancelled' : 'failed', httpStatus: details.statusCode, terminationReason: details.code, captureError: details.message }, request.log)
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
    if('error' in auth) return auth.error
    const aiOpsAuthMs = Date.now() - startedAt
    const parsedBody = chatCompletionRequestSchema.parse(request.body)
    const requestedModel = parsedBody.model
    const model = normalizePublicModelId(requestedModel)
    const modelError = authorizeModel(auth.key, requestedModel, model, request.id, reply)
    if(modelError) return modelError
    const stream = parsedBody.stream ?? config.defaultStreaming
    const compactionStartedAt = Date.now()
    const compacted = compactChatRequest({ ...parsedBody, stream }, config.context)
    const contextCompactionMs = Date.now() - compactionStartedAt
    const body = { ...parsedBody, ...compacted.request, stream }
    const timing: GatewayRequestTiming = { startedAt, aiOpsAuthMs, contextCompactionMs, context: compacted.metrics }
    request.log.info({ requestId: request.id, gatewayRoute: '/v1/chat/completions', model: requestedModel }, 'gateway chat completion')
    const audit = (await beginGatewayAudit(options.database, auth.key, { requestId: request.id, model, endpoint: '/v1/chat/completions', body: { ...body, model }, originalBody: parsedBody, streamed: Boolean(body.stream), startedAt }, request.log))
    const modelCapture = captureActualModel(auth.upstreamContext, model)
    let retryCount = 0
    let upstreamStartedAt = 0
    if(body.stream) return streamChatCompletion(request, reply, upstream, { ...body, model, stream: true }, timing, modelCapture.upstreamContext, async (result) => {
      if(auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
        requestId: request.id, connector: config.mode, requestedModel, actualModel: modelCapture.actualModel(), protocol: 'chat_completions', streamed: true,
        request: { ...body, model }, startedAt, headers: request.headers, measurement: result.measurement,
        status: result.status, error: result.error,
      }, request.log)
      await completeGatewayAudit(audit, { status: result.status, httpStatus: result.status === 'succeeded' ? 200 : result.error ? errorStatusCode(result.error.code) : 499, response: result.measurement.response, terminationReason: result.error?.code ?? (result.status === 'succeeded' ? 'stop' : 'cancelled'), captureError: result.error?.message }, request.log)
    }, (chunk) => appendGatewayAuditChunk(audit, chunk, request.log))
    try {
      upstreamStartedAt = Date.now()
      const completion = await chatCompletionThroughRelay({
        upstream,
        request: () => ({ ...body, model, stream: false }),
        upstreamContext: modelCapture.upstreamContext,
      })
      const response = completion.response
      if(auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
        requestId: request.id, connector: config.mode, requestedModel, actualModel: modelCapture.actualModel(modelForResponse(response, model)), protocol: 'chat_completions', streamed: false,
        request: { ...body, model }, startedAt, headers: request.headers,
        measurement: nonStreamingMeasurement(response, timing, upstreamStartedAt), status: 'succeeded', retryCount: completion.retryCount,
      }, request.log)
      await completeGatewayAudit(audit, { status: 'succeeded', httpStatus: 200, response, totalTokens: responseUsageTokens(response), terminationReason: responseFinishReason(response) }, request.log)
      return chatCompletionResponseSchema.parse(response)
    } catch(error) {
      if(auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
        requestId: request.id, connector: config.mode, requestedModel, actualModel: modelCapture.actualModel(), protocol: 'chat_completions', streamed: false,
        request: { ...body, model }, startedAt, headers: request.headers,
        measurement: nonStreamingMeasurement(undefined, timing, upstreamStartedAt || Date.now()), status: isCancelledError(error) ? 'cancelled' : 'failed', error: gatewayErrorDetails(error), retryCount,
      }, request.log)
      const details = gatewayErrorDetails(error)
      await completeGatewayAudit(audit, { status: isCancelledError(error) ? 'cancelled' : 'failed', httpStatus: details.statusCode, terminationReason: details.code, captureError: details.message }, request.log)
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
    if('error' in auth) return auth.error
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
    if(unsupported.length > 0) return sendGatewayError(reply, 400, 'GATEWAY_UNSUPPORTED', `Responses 字段暂不支持：${unsupported.join('、')}`, request.id)
    const modelError = authorizeModel(auth.key, requestedModel, model, request.id, reply)
    if(modelError) return modelError
    request.log.info({ requestId: request.id, gatewayRoute: '/v1/responses', model: requestedModel }, 'gateway response request')
    const audit = (await beginGatewayAudit(options.database, auth.key, { requestId: request.id, model, endpoint: '/v1/responses', body: { ...body, model }, originalBody: parsedBody, streamed: Boolean(body.stream), startedAt }, request.log))
    const modelCapture = captureActualModel(auth.upstreamContext, model)

    if(nativeResponses) {
      const nativeRequest = { ...body, model } as OpenAiResponsesRequest
      const usageRequest = toChatRequest(body, model)
      if(body.stream && typeof upstream.responsesStream === 'function') {
        return streamResponses(request, reply, upstream, nativeRequest, timing, modelCapture.upstreamContext, async (result) => {
          if(auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
            requestId: request.id, connector: config.mode, requestedModel, actualModel: modelCapture.actualModel(), protocol: 'responses', streamed: true,
            request: usageRequest, startedAt, headers: request.headers, measurement: result.measurement,
            status: result.status, error: result.error,
          }, request.log)
          await completeGatewayAudit(audit, { status: result.status, httpStatus: result.status === 'succeeded' ? 200 : result.error ? errorStatusCode(result.error.code) : 499, response: result.measurement.response, terminationReason: result.error?.code ?? (result.status === 'succeeded' ? 'completed' : 'cancelled'), captureError: result.error?.message }, request.log)
        }, (event) => appendGatewayAuditChunk(audit, event, request.log))
      }
      if(body.stream) {
        await completeGatewayAudit(audit, { status: 'body_unavailable', httpStatus: 502, terminationReason: 'GATEWAY_UPSTREAM_INVALID_RESPONSE', captureError: '当前上游未提供 Responses 流式接口' }, request.log)
        return sendGatewayError(reply, 502, 'GATEWAY_UPSTREAM_INVALID_RESPONSE', '当前上游未提供 Responses 流式接口', request.id)
      }
      let upstreamStartedAt = 0
      try {
        upstreamStartedAt = Date.now()
        const response = await upstream.responses!(nativeRequest, undefined, modelCapture.upstreamContext)
        if(auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
          requestId: request.id, connector: config.mode, requestedModel, actualModel: modelCapture.actualModel(modelForResponse(response, model)), protocol: 'responses', streamed: false,
          request: usageRequest, startedAt, headers: request.headers,
          measurement: nonStreamingMeasurement(response, timing, upstreamStartedAt), status: 'succeeded', retryCount: 0,
        }, request.log)
        await completeGatewayAudit(audit, { status: 'succeeded', httpStatus: 200, response, totalTokens: responseUsageTokens(response), terminationReason: responseFinishReason(response) }, request.log)
        return responsesResponseSchema.parse(response)
      } catch(error) {
        if(auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
          requestId: request.id, connector: config.mode, requestedModel, actualModel: modelCapture.actualModel(), protocol: 'responses', streamed: false,
          request: usageRequest, startedAt, headers: request.headers,
          measurement: nonStreamingMeasurement(undefined, timing, upstreamStartedAt || Date.now()), status: isCancelledError(error) ? 'cancelled' : 'failed', error: gatewayErrorDetails(error), retryCount: 0,
        }, request.log)
        const details = gatewayErrorDetails(error)
        await completeGatewayAudit(audit, { status: isCancelledError(error) ? 'cancelled' : 'failed', httpStatus: details.statusCode, terminationReason: details.code, captureError: details.message }, request.log)
        return sendUpstreamError(error, request.id, reply)
      }
    }

    if(body.stream) {
      await completeGatewayAudit(audit, {
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
      if(auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
        requestId: request.id, connector: config.mode, requestedModel, actualModel: modelCapture.actualModel(modelForResponse(response, model)), protocol: 'responses', streamed: false,
        request: toChatRequest(body, model), startedAt, headers: request.headers,
        measurement: nonStreamingMeasurement(response, timing, upstreamStartedAt), status: 'succeeded', retryCount: completion.retryCount,
      }, request.log)
      await completeGatewayAudit(audit, { status: 'succeeded', httpStatus: 200, response: toResponsePayload(response), totalTokens: responseUsageTokens(response), terminationReason: responseFinishReason(response) }, request.log)
      return responsesResponseSchema.parse(toResponsePayload(response))
    } catch(error) {
      if(auth.key && options.database) await recordGatewayUsageSafely(options.database, auth.key, {
        requestId: request.id, connector: config.mode, requestedModel, actualModel: modelCapture.actualModel(), protocol: 'responses', streamed: false,
        request: toChatRequest(body, model), startedAt, headers: request.headers,
        measurement: nonStreamingMeasurement(undefined, timing, upstreamStartedAt || Date.now()), status: isCancelledError(error) ? 'cancelled' : 'failed', error: gatewayErrorDetails(error), retryCount,
      }, request.log)
      const details = gatewayErrorDetails(error)
      await completeGatewayAudit(audit, { status: isCancelledError(error) ? 'cancelled' : 'failed', httpStatus: details.statusCode, terminationReason: details.code, captureError: details.message }, request.log)
      return sendUpstreamError(error, request.id, reply)
    }
  })
}