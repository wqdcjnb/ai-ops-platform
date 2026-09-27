import type { ExternalProviderModality, ExternalProviderRegistry, ExternalProviderRoute } from '../external-providers.js'
import type { GatewayConfig } from '../gateway-config.js'
import {
  GatewayUpstreamError,
  OpenAiCompatibleAdapter,
  type GatewayRequestContext,
  type GatewayUpstream,
  type OpenAiChatRequest,
  type OpenAiMediaRequest,
  type OpenAiResponsesEvent,
  type OpenAiResponsesRequest,
} from './openai-compatible.js'
import { isPublicModelId, PUBLIC_MODEL_ID } from '../public-model.js'

const HEALTH_TTL_MS = 15_000

type RelayHealth = { latencyMs: number; checkedAt: number; failures: number }

/**
 * The public gateway intentionally exposes one virtual model only. Before a
 * request, it sends a bounded set of parallel, cancellable /models probes to
 * candidate relays and uses the first healthy answer as the preferred route.
 * It never races actual generation requests, so a speed decision does not
 * duplicate a user's prompt, token usage, image, or video job.
 */
export class ExternalProviderGatewayUpstream implements GatewayUpstream {
  private readonly activeExternalRequests = new Map<string, Set<OpenAiCompatibleAdapter>>()
  private readonly healthByProvider = new Map<string, RelayHealth>()
  private readonly modelCursor = new Map<string, number>()
  private readonly probeFanout: number
  private probeCursor = 0

  constructor(
    private readonly primary: GatewayUpstream,
    private readonly providers: ExternalProviderRegistry,
    private readonly gatewayConfig: GatewayConfig,
  ) {
    const configured = Number(process.env.AI_OPS_RELAY_PROBE_FANOUT ?? 3)
    this.probeFanout = Number.isInteger(configured) ? Math.max(2, Math.min(8, configured)) : 3
  }

  async listModels(_signal?: AbortSignal, _context?: GatewayRequestContext) {
    if (!this.providers.listPlatformRoutes().length) {
      throw new GatewayUpstreamError('GATEWAY_UPSTREAM_NOT_CONFIGURED', 503, 'AI OPS 尚未接入可用模型')
    }
    return [{ id: PUBLIC_MODEL_ID, object: 'model' as const, created: 0, owned_by: 'ai-ops-relay' }]
  }

  async chatCompletion(request: OpenAiChatRequest, signal?: AbortSignal, context?: GatewayRequestContext) {
    return this.withFastestRelay(request.model, 'text', signal, context, async (route) => {
      const response = await this.adapterFor(route).chatCompletion(this.rewriteChatRequest(request, route), signal)
      this.reportResponseModel(context, route, response)
      return this.rewriteResponseModel(response)
    })
  }

  async chatCompletionStream(request: OpenAiChatRequest, onChunk: (chunk: Record<string, unknown>) => void, signal?: AbortSignal, requestId?: string, context?: GatewayRequestContext) {
    const routes = await this.rankRoutes(request.model, 'text', signal)
    let lastError: unknown
    for (const route of routes) {
      let delivered = false
      const adapter = this.adapterFor(route)
      this.trackAdapter(requestId, adapter)
      try {
        this.reportActualModel(context, route.upstreamModelId)
        await adapter.chatCompletionStream(this.rewriteChatRequest(request, route), (chunk) => {
          delivered = true
          this.reportResponseModel(context, route, chunk)
          onChunk(this.rewriteResponseModel(chunk))
        }, signal, requestId)
        this.markHealthy(route.providerId)
        return
      } catch (error) {
        this.markFailure(route.providerId)
        lastError = error
        // Once content is emitted, retrying would duplicate a conversation
        // turn. Before the first chunk it is safe to fall through.
        if (delivered || !isRetryableRelayError(error)) throw error
      } finally {
        this.untrackAdapter(requestId, adapter)
      }
    }
    throw lastError ?? new GatewayUpstreamError('GATEWAY_UPSTREAM_UNAVAILABLE', 502, 'AI OPS 暂时不可用')
  }

  async responses(request: OpenAiResponsesRequest, signal?: AbortSignal, context?: GatewayRequestContext) {
    return this.withFastestRelay(request.model, 'text', signal, context, async (route) => {
      const response = await this.adapterFor(route).responses(this.rewriteResponsesRequest(request, route), signal)
      this.reportResponseModel(context, route, response)
      return this.rewriteResponseModel(response)
    })
  }

  async responsesStream(request: OpenAiResponsesRequest, onEvent: (event: OpenAiResponsesEvent) => void, signal?: AbortSignal, requestId?: string, context?: GatewayRequestContext) {
    const routes = await this.rankRoutes(request.model, 'text', signal)
    let lastError: unknown
    for (const route of routes) {
      let delivered = false
      const adapter = this.adapterFor(route)
      this.trackAdapter(requestId, adapter)
      try {
        this.reportActualModel(context, route.upstreamModelId)
        await adapter.responsesStream(this.rewriteResponsesRequest(request, route), (event) => {
          delivered = true
          this.reportResponseModel(context, route, event.data)
          onEvent({ ...event, data: this.rewriteResponseModel(event.data) })
        }, signal, requestId)
        this.markHealthy(route.providerId)
        return
      } catch (error) {
        this.markFailure(route.providerId)
        lastError = error
        if (delivered || !isRetryableRelayError(error)) throw error
      } finally {
        this.untrackAdapter(requestId, adapter)
      }
    }
    throw lastError ?? new GatewayUpstreamError('GATEWAY_UPSTREAM_UNAVAILABLE', 502, 'AI OPS 暂时不可用')
  }

  async media(path: '/images/generations' | '/videos' | '/audio/speech', request: OpenAiMediaRequest, signal?: AbortSignal, context?: GatewayRequestContext) {
    return this.withFastestRelay(request.model, modalityForMediaPath(path), signal, context, async (route) => {
      const response = await this.adapterFor(route).media(path, { ...request, model: route.upstreamModelId }, signal)
      this.reportResponseModel(context, route, response)
      return this.rewriteResponseModel(response)
    })
  }

  async cancel(requestId: string, signal?: AbortSignal) {
    const adapters = this.activeExternalRequests.get(requestId)
    if (adapters?.size) {
      await Promise.all([...adapters].map((adapter) => adapter.cancel(requestId, signal).catch(() => undefined)))
      return
    }
    return this.primary.cancel(requestId, signal)
  }

  private async withFastestRelay<T>(requestedModel: string, modality: ExternalProviderModality, signal: AbortSignal | undefined, context: GatewayRequestContext | undefined, execute: (route: ExternalProviderRoute) => Promise<T>): Promise<T> {
    const routes = await this.rankRoutes(requestedModel, modality, signal)
    let lastError: unknown
    for (const route of routes) {
      try {
        this.reportActualModel(context, route.upstreamModelId)
        const result = await execute(route)
        this.markHealthy(route.providerId)
        return result
      } catch (error) {
        this.markFailure(route.providerId)
        lastError = error
        if (!isRetryableRelayError(error)) throw error
      }
    }
    throw lastError ?? new GatewayUpstreamError('GATEWAY_UPSTREAM_UNAVAILABLE', 502, 'AI OPS 暂时不可用')
  }

  private async rankRoutes(model: string, modality: ExternalProviderModality, signal?: AbortSignal) {
    if (!isPublicModelId(model)) {
      throw new GatewayUpstreamError('GATEWAY_UPSTREAM_ERROR', 404, `仅支持 ${PUBLIC_MODEL_ID}`)
    }
    const all = this.providers.listPlatformRoutes(modality)
    if (!all.length) throw new GatewayUpstreamError('GATEWAY_UPSTREAM_NOT_CONFIGURED', 503, `AI OPS 暂无可用的${modalityLabel(modality)}模型`)
    const byProvider = new Map<string, ExternalProviderRoute[]>()
    for (const route of all) byProvider.set(route.providerId, [...(byProvider.get(route.providerId) ?? []), route])
    const groups = [...byProvider.entries()].map(([providerId, routes]) => ({ providerId, routes }))
    const now = Date.now()
    const stale = groups.filter(({ providerId }) => {
      const health = this.healthByProvider.get(providerId)
      return !health || now - health.checkedAt >= HEALTH_TTL_MS
    })
    if (stale.length) {
      // Rotate the sample between requests. With more relays than the
      // fan-out ceiling, this prevents the alphabetically-first accounts from
      // monopolising every speed race while retaining bounded concurrency.
      const start = this.probeCursor % stale.length
      const probeTargets = [...stale.slice(start), ...stale.slice(0, start)].slice(0, this.probeFanout)
      this.probeCursor = (start + probeTargets.length) % stale.length
      await this.raceRelayProbes(probeTargets, signal)
    }
    const ordered = [...groups].sort((left, right) => this.scoreProvider(left.providerId) - this.scoreProvider(right.providerId))
    return ordered.map(({ providerId, routes }) => this.pickModelRoute(providerId, routes))
  }

  private async raceRelayProbes(groups: Array<{ providerId: string; routes: ExternalProviderRoute[] }>, signal?: AbortSignal) {
    const controllers = groups.map(() => new AbortController())
    const relayAbort = () => controllers.forEach((controller) => controller.abort())
    signal?.addEventListener('abort', relayAbort, { once: true })
    try {
      const probes = groups.map(({ providerId, routes }, index) => (async () => {
        const startedAt = Date.now()
        try {
          await this.adapterFor(this.pickModelRoute(providerId, routes)).listModels(controllers[index]!.signal)
          const latencyMs = Math.max(1, Date.now() - startedAt)
          this.healthByProvider.set(providerId, { latencyMs, checkedAt: Date.now(), failures: 0 })
          return providerId
        } catch (error) {
          // A losing probe is expected to be aborted once another relay wins;
          // do not penalise it as a failed route in that case.
          if (!controllers[index]!.signal.aborted) this.markFailure(providerId)
          throw error
        }
      })())
      // All candidates start together; first successful response wins. The
      // remaining probes are cancelled immediately to cut needless waiting.
      await Promise.any(probes)
    } catch {
      // Failed probes do not block a request forever. Actual calls will still
      // attempt candidates in existing score order and record their outcome.
    } finally {
      controllers.forEach((controller) => controller.abort())
      signal?.removeEventListener('abort', relayAbort)
    }
  }

  private scoreProvider(providerId: string) {
    const health = this.healthByProvider.get(providerId)
    if (!health) return Number.MAX_SAFE_INTEGER / 2
    return health.latencyMs + health.failures * 30_000
  }

  private pickModelRoute(providerId: string, routes: ExternalProviderRoute[]) {
    const index = this.modelCursor.get(providerId) ?? 0
    const route = routes[index % routes.length]!
    this.modelCursor.set(providerId, (index + 1) % Math.max(1, routes.length))
    return route
  }

  private markHealthy(providerId: string) {
    const existing = this.healthByProvider.get(providerId)
    if (existing) this.healthByProvider.set(providerId, { ...existing, failures: 0, checkedAt: Date.now() })
  }

  private markFailure(providerId: string) {
    const existing = this.healthByProvider.get(providerId)
    this.healthByProvider.set(providerId, {
      latencyMs: existing?.latencyMs ?? 60_000,
      checkedAt: Date.now(),
      failures: Math.min(10, (existing?.failures ?? 0) + 1),
    })
  }

  private trackAdapter(requestId: string | undefined, adapter: OpenAiCompatibleAdapter) {
    if (!requestId) return
    const set = this.activeExternalRequests.get(requestId) ?? new Set<OpenAiCompatibleAdapter>()
    set.add(adapter)
    this.activeExternalRequests.set(requestId, set)
  }

  private untrackAdapter(requestId: string | undefined, adapter: OpenAiCompatibleAdapter) {
    if (!requestId) return
    const set = this.activeExternalRequests.get(requestId)
    if (!set) return
    set.delete(adapter)
    if (!set.size) this.activeExternalRequests.delete(requestId)
  }

  private adapterFor(route: ExternalProviderRoute) {
    return new OpenAiCompatibleAdapter({
      ...this.gatewayConfig,
      mode: 'relay',
      provider: 'openai_compatible',
      baseUrl: route.baseUrl,
      upstreamApiKey: route.apiKey,
      upstreamConfigured: true,
    })
  }

  private rewriteChatRequest(request: OpenAiChatRequest, route: ExternalProviderRoute): OpenAiChatRequest {
    return { ...request, model: route.upstreamModelId }
  }

  private rewriteResponsesRequest(request: OpenAiResponsesRequest, route: ExternalProviderRoute): OpenAiResponsesRequest {
    return { ...request, model: route.upstreamModelId }
  }

  private reportActualModel(context: GatewayRequestContext | undefined, model: string) {
    const normalized = safeUpstreamModelId(model)
    if (!normalized || isPublicModelId(normalized)) return
    // Telemetry must never turn a successful user request into a failure.
    try { context?.onActualModel?.(normalized) } catch { /* ignore observer failure */ }
  }

  private reportResponseModel(context: GatewayRequestContext | undefined, route: ExternalProviderRoute, payload: Record<string, unknown>) {
    const reported = responseModelId(payload)
    // The configured route remains the authoritative fallback when a relay
    // hides its model name or simply echoes the requested model ID.
    if (reported && reported !== route.upstreamModelId) this.reportActualModel(context, reported)
  }

  private rewriteResponseModel(payload: Record<string, unknown>) {
    return typeof payload.model === 'string' ? { ...payload, model: PUBLIC_MODEL_ID } : payload
  }
}

function responseModelId(payload: Record<string, unknown>) {
  if (typeof payload.model === 'string') return safeUpstreamModelId(payload.model)
  const response = payload.response
  if (response && typeof response === 'object' && !Array.isArray(response) && typeof (response as Record<string, unknown>).model === 'string') {
    return safeUpstreamModelId((response as Record<string, unknown>).model as string)
  }
  return null
}

function safeUpstreamModelId(value: string) {
  const normalized = value.trim()
  return normalized && normalized.length <= 160 && !/[\u0000-\u001f\u007f]/.test(normalized) ? normalized : null
}

function isRetryableRelayError(error: unknown) {
  return error instanceof GatewayUpstreamError && [
    'GATEWAY_UPSTREAM_TIMEOUT',
    'GATEWAY_UPSTREAM_UNAVAILABLE',
    'GATEWAY_UPSTREAM_RATE_LIMITED',
    'GATEWAY_UPSTREAM_CREDIT_EXHAUSTED',
    'GATEWAY_UPSTREAM_ERROR',
  ].includes(error.code)
}

function modalityForMediaPath(path: '/images/generations' | '/videos' | '/audio/speech'): ExternalProviderModality {
  if (path === '/images/generations') return 'image'
  if (path === '/videos') return 'video'
  return 'audio'
}

function modalityLabel(modality: ExternalProviderModality) {
  return ({ text: '文本', image: '图片', video: '视频', audio: '语音' })[modality]
}
