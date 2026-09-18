import { z } from 'zod'
import { withCsrfHeader } from './csrf'

export const upstreamFiltersSchema = z.object({ search: z.string().max(60), type: z.enum(['all', 'official_api', 'cpa_oauth']), status: z.enum(['all', 'healthy', 'degraded', 'auth_required', 'offline', 'unconfigured']) })

const upstreamItemSchema = z.object({
  id: z.string(), name: z.string(), provider: z.string(), type: z.enum(['official_api', 'cpa_oauth']), environment: z.enum(['production', 'experiment']), status: z.enum(['healthy', 'degraded', 'auth_required', 'offline', 'unconfigured']), credentialConfigured: z.boolean(), credentialValidation: z.enum(['verified', 'failed', 'not_checked']), models: z.array(z.string()),
  health: z.object({ successRate: z.number().min(0).max(100).nullable(), latencyMs: z.number().int().nonnegative().nullable(), checkedAt: z.string().datetime() }),
  balance: z.object({ state: z.enum(['sufficient', 'low', 'unknown', 'unavailable']), label: z.string(), updatedAt: z.string().datetime().nullable() }),
  capacity: z.object({ rpm: z.number().int().positive(), tpm: z.number().int().positive() }).nullable(),
  auth: z.object({ expiresAt: z.string().datetime().nullable(), lastRefreshedAt: z.string().datetime().nullable() }).nullable(),
  windows: z.array(z.object({ id: z.enum(['five_hour', 'weekly']), label: z.string(), usedPercent: z.number().min(0).max(100), resetsAt: z.string().datetime() })),
  cooldown: z.object({ active: z.boolean(), until: z.string().datetime().nullable(), reason: z.string().nullable() }).nullable(),
  recentError: z.object({ category: z.enum(['authentication', 'rate_limit', 'timeout', 'balance', 'server', 'connection']), summary: z.string(), firstSeenAt: z.string().datetime(), lastSeenAt: z.string().datetime() }).nullable(),
})

export const upstreamsResponseSchema = z.object({
  meta: z.object({ source: z.literal('demo'), generatedAt: z.string().datetime(), notice: z.string(), live: z.object({ newApi: z.enum(['healthy', 'reachable', 'auth_required', 'offline']), cpa: z.enum(['reachable', 'offline']), checkedAt: z.string().datetime() }) }),
  summary: z.object({ total: z.number().int().nonnegative(), available: z.number().int().nonnegative(), needsAttention: z.number().int().nonnegative(), official: z.number().int().nonnegative(), experiment: z.number().int().nonnegative(), configured: z.number().int().nonnegative() }),
  isolation: z.object({ enforced: z.literal(true), productionToExperimentFallback: z.literal(false), statement: z.string() }),
  items: z.array(upstreamItemSchema), total: z.number().int().nonnegative(),
})

export type UpstreamFilters = z.infer<typeof upstreamFiltersSchema>
export type UpstreamsResponse = z.infer<typeof upstreamsResponseSchema>
export type UpstreamItem = z.infer<typeof upstreamItemSchema>

export const upstreamCheckBodySchema = z.object({
  idempotencyKey: z.string().regex(/^upstream-check-[a-z0-9-]{8,96}$/),
  reason: z.string().trim().min(8).max(200),
  acknowledgeSynthetic: z.literal(true),
})

export const upstreamCheckResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), completedAt: z.string().datetime(), notice: z.string() }),
  upstream: upstreamItemSchema,
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})

export type UpstreamCheckBody = z.infer<typeof upstreamCheckBodySchema>
export type UpstreamCheckResponse = z.infer<typeof upstreamCheckResponseSchema>

export class UpstreamsApiError extends Error { constructor(message: string, readonly requestId?: string) { super(message) } }

export async function fetchUpstreams(filters: UpstreamFilters, signal?: AbortSignal): Promise<UpstreamsResponse> {
  const value = upstreamFiltersSchema.parse(filters)
  const response = await fetch(`/api/upstreams?${new URLSearchParams(value)}`, { headers: { accept: 'application/json' }, signal })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw new UpstreamsApiError('上游账号暂时无法加载', requestId)
  const parsed = upstreamsResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new UpstreamsApiError('上游账号格式不符合接口约定', requestId)
  return parsed.data
}

export async function checkUpstream(id: string, payload: UpstreamCheckBody): Promise<UpstreamCheckResponse> {
  const body = upstreamCheckBodySchema.parse(payload)
  const response = await fetch(`/api/upstreams/${encodeURIComponent(id)}/check`, {
    method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(body),
  })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new UpstreamsApiError(detail?.error?.message ?? '验证上游账号失败', requestId)
  }
  const parsed = upstreamCheckResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new UpstreamsApiError('上游验证响应格式不符合接口约定', requestId)
  return parsed.data
}
