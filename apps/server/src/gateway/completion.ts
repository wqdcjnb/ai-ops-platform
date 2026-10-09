import { isPublicModelId } from '../public-model.js'
import type { PlatformDatabase, PlatformGatewayKey } from '../platform-db.js'
import type { GatewayRequestContext, GatewayUpstream } from './openai-compatible.js'
import type { GatewayContextMetrics } from './context-optimizer.js'
import { recordGatewayUsage, type GatewayUsageMeasurement } from './telemetry.js'

export function mediaUsageRequest(endpoint: string, model: string) {
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
export function captureActualModel(upstreamContext: GatewayRequestContext | undefined, fallback: string) {
  let selectedModel: string | null = null
  const previousObserver = upstreamContext?.onActualModel
  return {
    upstreamContext: {
      ...upstreamContext,
      onActualModel(modelId: string) {
        const normalized = validActualModel(modelId)
        if(normalized) selectedModel = normalized
        // An observability listener must never affect the user request.
        try { previousObserver?.(modelId) } catch { /* ignore observer failure */ }
      },
    } satisfies GatewayRequestContext,
    actualModel(reportedModel?: string) {
      return selectedModel ?? validActualModel(reportedModel) ?? fallback
    },
  }
}

export function validActualModel(value: unknown) {
  if(typeof value !== 'string') return null
  const normalized = value.trim()
  if(!normalized || normalized.length > 160 || /[\u0000-\u001f\u007f]/.test(normalized) || isPublicModelId(normalized)) return null
  return normalized
}

export interface GatewayCompletionOptions {
  upstream: GatewayUpstream
  request: () => Parameters<GatewayUpstream['chatCompletion']>[0]
  upstreamContext?: GatewayRequestContext
}

export async function chatCompletionThroughRelay(options: GatewayCompletionOptions) {
  return {
    response: await options.upstream.chatCompletion(options.request(), undefined, options.upstreamContext),
    // Relay selection and safe retry-before-output are owned by
    // ExternalProviderGatewayUpstream. A second gateway-level fallback would
    // risk sending the same real generation twice.
    retryCount: 0,
  }
}

export interface GatewayRequestTiming {
  startedAt: number
  aiOpsAuthMs: number
  contextCompactionMs: number
  context: GatewayContextMetrics
}

export function nonStreamingMeasurement(response: Record<string, unknown> | undefined, timing: GatewayRequestTiming, upstreamStartedAt: number): GatewayUsageMeasurement {
  return {
    ...(response ? { response } : {}),
    aiOpsAuthMs: timing.aiOpsAuthMs,
    contextCompactionMs: timing.contextCompactionMs,
    context: timing.context,
    upstreamFirstTokenMs: null,
    upstreamTotalMs: Math.max(0, Date.now() - upstreamStartedAt),
  }
}

export async function recordGatewayUsageSafely(
  database: PlatformDatabase,
  key: PlatformGatewayKey,
  context: Omit<Parameters<typeof recordGatewayUsage>[0], 'database' | 'key'>,
  log: { warn: (bindings: Record<string, unknown>, message: string) => void },
) {
  try {
    await recordGatewayUsage({ ...context, database, key })
  } catch(error) {
    log.warn({ requestId: context.requestId, error: error instanceof Error ? error.message : 'unknown' }, 'gateway telemetry write failed')
  }
}

export function responseUsageTokens(response: Record<string, unknown>) {
  const usage = response.usage
  if(!usage || typeof usage !== 'object' || Array.isArray(usage)) return 0
  const value = usage as Record<string, unknown>
  const input = Number(value.prompt_tokens ?? value.input_tokens ?? 0)
  const output = Number(value.completion_tokens ?? value.output_tokens ?? 0)
  return Number.isFinite(input) && Number.isFinite(output) ? Math.max(0, Math.floor(input + output)) : 0
}

export function responseFinishReason(response: Record<string, unknown>) {
  const choices = Array.isArray(response.choices) ? response.choices : []
  const first = choices[0]
  if(first && typeof first === 'object' && typeof (first as Record<string, unknown>).finish_reason === 'string') return (first as Record<string, unknown>).finish_reason as string
  if(typeof response.status === 'string') return response.status
  return null
}
