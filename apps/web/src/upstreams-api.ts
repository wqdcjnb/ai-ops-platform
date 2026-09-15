import { z } from 'zod'

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
