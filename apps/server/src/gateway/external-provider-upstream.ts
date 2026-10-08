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
import { RuntimeCoordinator, runtimeLimit } from '../runtime-coordinator.js'

const HEALTH_TTL_MS = 15_000

type RelayHealth = { latencyMs: number; checkedAt: number; failures: number; firstTokenMs?: number; circuitUntil?: number }

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
  private readonly probeTasks = new Map<string, Promise<void>>()
  private probeBatch: Promise<void> | null = null
  private firstProbeReady: Promise<void> | null = null
  private readonly maintenanceTimer: ReturnType<typeof setInterval>
  private closed = false

  constructor(
    private readonly primary: GatewayUpstream,
    private readonly providers: ExternalProviderRegistry,
    private readonly gatewayConfig: GatewayConfig,
    private readonly runtime: RuntimeCoordinator,
  ) {
    const configured = Number(process.env.AI_OPS_RELAY_PROBE_FANOUT ?? 3)
    this.probeFanout = Number.isInteger(configured) ? Math.max(2, Math.min(8, configured)) : 3
    this.maintenanceTimer = setInterval(() => {
      void this.providers.refresh().then(() => this.refreshProbes(this.providers.listPlatformRoutes())).catch(() => undefined)
    }, 10_000)
    this.maintenanceTimer.unref()
  }

  async listModels(_signal?: AbortSignal, _context?: GatewayRequestContext) {
    if(!this.providers.listPlatformRoutes().length) {
      throw new GatewayUpstreamError('GATEWAY_UPSTREAM_NOT_CONFIGURED', 503, 'AI OPS 尚未接入可用模型')
    }
    return [{ id: PUBLIC_MODEL_ID, object: 'model' as const, created: 0, owned_by: 'ai-ops-relay' }]
  }

  async chatCompletion(request: OpenAiChatRequest, signal?: AbortSignal, context?: GatewayRequestContext) {
    signal = this.deadline(signal ?? context?.signal)
    return this.withFastestRelay(request.model, 'text', signal, context, async (route) => {
      const response = await this.adapterFor(route).chatCompletion(this.rewriteChatRequest(request, route), signal)
      this.reportResponseModel(context, route, response)
      return this.rewriteResponseModel(response)
    })
  }

  async chatCompletionStream(request: OpenAiChatRequest, onChunk: (chunk: Record<string, unknown>) => void | Promise<void>, signal?: AbortSignal, requestId?: string, context?: GatewayRequestContext) {
    signal = this.deadline(signal ?? context?.signal)
    const routes = await this.rankRoutes(request.model, 'text', signal)
    let lastError: unknown
    let attempts = 0
    for(const route of routes) {
      if(attempts >= runtimeLimit('AI_OPS_RELAY_MAX_ATTEMPTS', 3, 8)) break
      const release = await this.providerSlot(route.providerId, signal)
      if(!release) continue
      attempts++
      let delivered = false
      const startedAt = Date.now()
      let firstTokenMs: number | undefined
      const adapter = this.adapterFor(route)
      this.trackAdapter(requestId, adapter)
      try {
        this.reportActualModel(context, route.upstreamModelId)
        await adapter.chatCompletionStream(this.rewriteChatRequest(request, route), async (chunk) => {
          delivered = true
          firstTokenMs ??= Date.now() - startedAt
          this.reportResponseModel(context, route, chunk)
          await onChunk(this.rewriteResponseModel(chunk))
        }, signal, requestId)
        await this.markHealthy(route.providerId, firstTokenMs ?? Date.now() - startedAt)
        return
      } catch(error) {
        if(!signal.aborted) await this.markFailure(route.providerId)
        lastError = error
        // Once content is emitted, retrying would duplicate a conversation
        // turn. Before the first chunk it is safe to fall through.
        if(delivered || !isRetryableRelayError(error)) throw error
      } finally {
        this.untrackAdapter(requestId, adapter)
        await release().catch(() => undefined)
      }
    }
    throw lastError ?? new GatewayUpstreamError('GATEWAY_UPSTREAM_RATE_LIMITED', 429, '可用服务当前繁忙，请稍后重试')
  }

  async responses(request: OpenAiResponsesRequest, signal?: AbortSignal, context?: GatewayRequestContext) {
    signal = this.deadline(signal ?? context?.signal)
    return this.withFastestRelay(request.model, 'text', signal, context, async (route) => {
      const response = await this.adapterFor(route).responses(this.rewriteResponsesRequest(request, route), signal)
      this.reportResponseModel(context, route, response)
      return this.rewriteResponseModel(response)
    })
  }

  async responsesStream(request: OpenAiResponsesRequest, onEvent: (event: OpenAiResponsesEvent) => void | Promise<void>, signal?: AbortSignal, requestId?: string, context?: GatewayRequestContext) {
    signal = this.deadline(signal ?? context?.signal)
    const routes = await this.rankRoutes(request.model, 'text', signal)
    let lastError: unknown
    let attempts = 0
    for(const route of routes) {
      if(attempts >= runtimeLimit('AI_OPS_RELAY_MAX_ATTEMPTS', 3, 8)) break
      const release = await this.providerSlot(route.providerId, signal)
      if(!release) continue
      attempts++
      let delivered = false
      const startedAt = Date.now()
      let firstTokenMs: number | undefined
      const adapter = this.adapterFor(route)
      this.trackAdapter(requestId, adapter)
      try {
        this.reportActualModel(context, route.upstreamModelId)
        await adapter.responsesStream(this.rewriteResponsesRequest(request, route), async (event) => {
          delivered = true
          firstTokenMs ??= Date.now() - startedAt
          this.reportResponseModel(context, route, event.data)
          await onEvent({ ...event, data: this.rewriteResponseModel(event.data) })
        }, signal, requestId)
        await this.markHealthy(route.providerId, firstTokenMs ?? Date.now() - startedAt)
        return
      } catch(error) {
        if(!signal.aborted) await this.markFailure(route.providerId)
        lastError = error
        if(delivered || !isRetryableRelayError(error)) throw error
      } finally {
        this.untrackAdapter(requestId, adapter)
        await release().catch(() => undefined)
      }
    }
    throw lastError ?? new GatewayUpstreamError('GATEWAY_UPSTREAM_RATE_LIMITED', 429, '可用服务当前繁忙，请稍后重试')
  }

  async media(path: '/images/generations' | '/videos' | '/audio/speech', request: OpenAiMediaRequest, signal?: AbortSignal, context?: GatewayRequestContext) {
    signal = this.deadline(signal ?? context?.signal)
    return this.withFastestRelay(request.model, modalityForMediaPath(path), signal, context, async (route) => {
      const response = await this.adapterFor(route).media(path, { ...request, model: route.upstreamModelId }, signal)
      this.reportResponseModel(context, route, response)
      return this.rewriteResponseModel(response)
    }, 1)
  }

  async cancel(requestId: string, signal?: AbortSignal) {
    const adapters = this.activeExternalRequests.get(requestId)
    if(adapters?.size) {
      await Promise.all([...adapters].map((adapter) => adapter.cancel(requestId, signal).catch(() => undefined)))
      return
    }
    return this.primary.cancel(requestId, signal)
  }

  private async withFastestRelay<T>(requestedModel: string, modality: ExternalProviderModality, signal: AbortSignal | undefined, context: GatewayRequestContext | undefined, execute: (route: ExternalProviderRoute) => Promise<T>, maxAttempts = runtimeLimit('AI_OPS_RELAY_MAX_ATTEMPTS', 3, 8)): Promise<T> {
    const routes = await this.rankRoutes(requestedModel, modality, signal)
    let lastError: unknown
    let attempts = 0
    for(const route of routes) {
      if(attempts >= maxAttempts) break
      const release = await this.providerSlot(route.providerId, signal)
      if(!release) continue
      attempts++
      const startedAt = Date.now()
      try {
        this.reportActualModel(context, route.upstreamModelId)
        const result = await execute(route)
        await this.markHealthy(route.providerId, Date.now() - startedAt)
        return result
      } catch(error) {
        if(!signal?.aborted) await this.markFailure(route.providerId)
        lastError = error
        if(!isRetryableRelayError(error)) throw error
      } finally {
        await release().catch(() => undefined)
      }
    }
    throw lastError ?? new GatewayUpstreamError('GATEWAY_UPSTREAM_RATE_LIMITED', 429, '可用服务当前繁忙，请稍后重试')
  }

  private async rankRoutes(model: string, modality: ExternalProviderModality, signal?: AbortSignal) {
    if(!isPublicModelId(model)) {
      throw new GatewayUpstreamError('GATEWAY_UPSTREAM_ERROR', 404, `仅支持 ${PUBLIC_MODEL_ID}`)
    }
    const all = this.providers.listPlatformRoutes(modality)
    if(!all.length) throw new GatewayUpstreamError('GATEWAY_UPSTREAM_NOT_CONFIGURED', 503, `AI OPS 暂无可用的${modalityLabel(modality)}模型`)
    const byProvider = new Map<string, ExternalProviderRoute[]>()
    for(const route of all) {
      const list = byProvider.get(route.providerId)
      if(list) list.push(route)
      else byProvider.set(route.providerId, [route])
    }
    const groups = [...byProvider.entries()].map(([providerId, routes]) => ({ providerId, routes }))
    const shared = await this.runtime.readHealth<RelayHealth>(groups.map(({ providerId }) => providerId))
    shared.forEach((health, index) => { if(health) this.healthByProvider.set(groups[index]!.providerId, health) })
    const refresh = this.refreshProbes(all)
    // Warm requests do not wait for discovery. Cold requests wait only for a
    // bounded first successful lightweight probe, never a full account scan.
    if(!groups.some(({ providerId }) => this.healthByProvider.has(providerId))) await refresh
    else void refresh.catch(() => undefined)
    signal?.throwIfAborted()
    const available = groups.filter(({ providerId }) => (this.healthByProvider.get(providerId)?.circuitUntil ?? 0) <= Date.now())
    if(!available.length) throw new GatewayUpstreamError('GATEWAY_UPSTREAM_UNAVAILABLE', 503, '可用服务正在恢复，请稍后重试')
    const pipeline = this.runtime.redis.pipeline()
    available.forEach(({ providerId }) => pipeline.zcard(this.runtime.namespace + 'active:provider:' + providerId))
    const loads = await pipeline.exec()
    const loadById = new Map(available.map(({ providerId }, index) => [providerId, Number(loads?.[index]?.[1] ?? 0)]))
    const ordered = available.sort((left, right) => {
      const score = (id: string) => this.scoreProvider(id) * (1 + (loadById.get(id) ?? 0))
      return score(left.providerId) - score(right.providerId)
    })
    return ordered.map(({ providerId, routes }) => this.pickModelRoute(providerId, routes))
  }

  private async refreshProbes(routes: ExternalProviderRoute[]) {
    if(this.closed) return
    if(this.probeBatch) return this.firstProbeReady
    const unique = [...new Map(routes.map((route) => [route.providerId, route])).values()]
    const stale = unique.filter(({ providerId }) => {
      const health = this.healthByProvider.get(providerId)
      return (!health || Date.now() - health.checkedAt >= HEALTH_TTL_MS) && (health?.circuitUntil ?? 0) <= Date.now()
    })
    if(!stale.length) return
    const start = this.probeCursor % stale.length
    const targets = [...stale.slice(start), ...stale.slice(0, start)].slice(0, this.probeFanout)
    this.probeCursor += targets.length
    const probes = targets.map((route) => this.probeProvider(route))
    this.probeBatch = Promise.allSettled(probes).then(() => undefined).finally(() => { this.probeBatch = null })
    this.firstProbeReady = Promise.any(probes).then(() => undefined).catch(() => undefined)
    await this.firstProbeReady
  }

  private probeProvider(route: ExternalProviderRoute) {
    const existing = this.probeTasks.get(route.providerId)
    if(existing) return existing
    const probe = (async () => {
      const release = await this.runtime.probeLock(route.providerId)
      if(!release) return
      const startedAt = Date.now()
      try {
        await this.adapterFor(route).listModels(AbortSignal.timeout(1_500))
        const health = await this.runtime.updateHealth<RelayHealth>(route.providerId, 'probe', Math.max(1, Date.now() - startedAt))
        this.healthByProvider.set(route.providerId, health)
      } catch(error) {
        await this.markFailure(route.providerId)
        throw error
      } finally { await release().catch(() => undefined) }
    })().finally(() => this.probeTasks.delete(route.providerId))
    this.probeTasks.set(route.providerId, probe)
    return probe
  }

  private deadline(signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(this.gatewayConfig.timeoutMs)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  private providerSlot(providerId: string, signal?: AbortSignal) {
    return this.runtime.acquire([{ key: 'provider:' + providerId, limit: runtimeLimit('AI_OPS_PROVIDER_CONCURRENCY', 12) }], { signal, leaseMs: Math.max(120_000, this.gatewayConfig.timeoutMs + 30_000) })
  }

  async close() {
    this.closed = true
    clearInterval(this.maintenanceTimer)
    await Promise.allSettled(this.probeTasks.values())
  }

  private scoreProvider(providerId: string) {
    const health = this.healthByProvider.get(providerId)
    if(!health) return 10_000
    return Math.max(1, health.firstTokenMs ?? health.latencyMs) + health.failures * 30_000
  }

  private pickModelRoute(providerId: string, routes: ExternalProviderRoute[]) {
    const index = this.modelCursor.get(providerId) ?? 0
    const route = routes[index % routes.length]!
    this.modelCursor.set(providerId, (index + 1) % Math.max(1, routes.length))
    return route
  }

  private async markHealthy(providerId: string, firstTokenMs: number) {
    const existing = this.healthByProvider.get(providerId)
    const health = { latencyMs: existing?.latencyMs ?? firstTokenMs, firstTokenMs: existing?.firstTokenMs === undefined ? firstTokenMs : Math.round(existing.firstTokenMs * 0.7 + firstTokenMs * 0.3), failures: 0, checkedAt: Date.now(), circuitUntil: 0 }
    this.healthByProvider.set(providerId, health)
    // Health telemetry must not turn an already successful generation into
    // an error or a retry (which could create duplicate billing).
    await this.runtime.updateHealth<RelayHealth>(providerId, 'success', firstTokenMs).then((shared) => this.healthByProvider.set(providerId, shared)).catch(() => undefined)
  }

  private async markFailure(providerId: string) {
    const existing = this.healthByProvider.get(providerId)
    const failures = Math.min(10, (existing?.failures ?? 0) + 1)
    const health = { ...existing, latencyMs: existing?.latencyMs ?? 60_000, checkedAt: Date.now(), failures, circuitUntil: failures >= 3 ? Date.now() + 30_000 : 0 }
    this.healthByProvider.set(providerId, health)
    await this.runtime.updateHealth<RelayHealth>(providerId, 'failure').then((shared) => this.healthByProvider.set(providerId, shared)).catch(() => undefined)
  }

  private trackAdapter(requestId: string | undefined, adapter: OpenAiCompatibleAdapter) {
    if(!requestId) return
    const set = this.activeExternalRequests.get(requestId) ?? new Set<OpenAiCompatibleAdapter>()
    set.add(adapter)
    this.activeExternalRequests.set(requestId, set)
  }

  private untrackAdapter(requestId: string | undefined, adapter: OpenAiCompatibleAdapter) {
    if(!requestId) return
    const set = this.activeExternalRequests.get(requestId)
    if(!set) return
    set.delete(adapter)
    if(!set.size) this.activeExternalRequests.delete(requestId)
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
    if(!normalized || isPublicModelId(normalized)) return
    // Telemetry must never turn a successful user request into a failure.
    try { context?.onActualModel?.(normalized) } catch { /* ignore observer failure */ }
  }

  private reportResponseModel(context: GatewayRequestContext | undefined, route: ExternalProviderRoute, payload: Record<string, unknown>) {
    const reported = responseModelId(payload)
    // The configured route remains the authoritative fallback when a relay
    // hides its model name or simply echoes the requested model ID.
    if(reported && reported !== route.upstreamModelId) this.reportActualModel(context, reported)
  }

  private rewriteResponseModel(payload: Record<string, unknown>) {
    return typeof payload.model === 'string' ? { ...payload, model: PUBLIC_MODEL_ID } : payload
  }
}

function responseModelId(payload: Record<string, unknown>) {
  if(typeof payload.model === 'string') return safeUpstreamModelId(payload.model)
  const response = payload.response
  if(response && typeof response === 'object' && !Array.isArray(response) && typeof (response as Record<string, unknown>).model === 'string') {
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
  if(path === '/images/generations') return 'image'
  if(path === '/videos') return 'video'
  return 'audio'
}

function modalityLabel(modality: ExternalProviderModality) {
  return ({ text: '文本', image: '图片', video: '视频', audio: '语音' })[modality]
}
