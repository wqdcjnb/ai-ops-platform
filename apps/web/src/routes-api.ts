import { z } from 'zod'
import { withCsrfHeader } from './csrf'

export const routeFiltersSchema = z.object({
  search: z.string().max(60),
  category: z.enum(['all', 'copy', 'service', 'translate', 'analysis', 'automation', 'experiment']),
  environment: z.enum(['all', 'production', 'experiment']),
  status: z.enum(['all', 'healthy', 'degraded', 'disabled']),
})

const routeTargetSchema = z.object({ channel: z.string(), provider: z.string(), model: z.string(), group: z.enum(['production', 'experiment']), status: z.enum(['healthy', 'degraded', 'disabled']) })
export const routeItemSchema = z.object({
  id: z.string(), category: z.enum(['copy', 'service', 'translate', 'analysis', 'automation', 'experiment']), categoryLabel: z.string(), name: z.string(), description: z.string(), alias: z.string(),
  environment: z.enum(['production', 'experiment']), status: z.enum(['healthy', 'degraded', 'disabled']), dataClass: z.enum(['internal', 'confidential', 'restricted']), allowedRoles: z.array(z.string()),
  primary: routeTargetSchema, fallbacks: z.array(routeTargetSchema),
  policy: z.object({ timeoutSeconds: z.number().int().positive(), maxRetries: z.number().int().nonnegative(), circuitBreakSeconds: z.number().int().positive(), onTimeout: z.enum(['fallback', 'fail']), onRateLimit: z.enum(['fallback', 'retry']), onServerError: z.enum(['fallback', 'retry']), crossGroupFallback: z.literal(false), clientChannelOverride: z.literal(false) }),
  usage: z.object({ requests7d: z.number().int().nonnegative(), successRate: z.number().min(0).max(100), p95LatencyMs: z.number().int().nonnegative() }),
})

export const routesResponseSchema = z.object({
  meta: z.object({ source: z.enum(['demo', 'database']), generatedAt: z.string(), notice: z.string() }),
  summary: z.object({ total: z.number().int().nonnegative(), production: z.number().int().nonnegative(), experiment: z.number().int().nonnegative(), degraded: z.number().int().nonnegative() }),
  options: z.object({ categories: z.array(z.object({ id: z.enum(['copy', 'service', 'translate', 'analysis', 'automation', 'experiment']), label: z.string() })) }),
  isolation: z.object({ enforced: z.literal(true), productionGroup: z.literal('official'), experimentGroup: z.literal('cpa-lab'), message: z.string() }),
  items: z.array(routeItemSchema), total: z.number().int().nonnegative(),
})

export const routePolicyUpdateBodySchema = z.object({
  onTimeout: z.enum(['fallback', 'fail']), onRateLimit: z.enum(['fallback', 'retry']), onServerError: z.enum(['fallback', 'retry']),
  maxRetries: z.number().int().min(0).max(3), idempotencyKey: z.string().regex(/^route-update-[a-z0-9-]{8,96}$/),
  reason: z.string().trim().min(8).max(200), acknowledgeImpact: z.literal(true),
})

export const routePolicyUpdateResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), completedAt: z.string(), notice: z.string() }),
  route: routeItemSchema,
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})

export type RouteFilters = z.infer<typeof routeFiltersSchema>
export type RoutesResponse = z.infer<typeof routesResponseSchema>
export type RouteItem = z.infer<typeof routeItemSchema>
export type RoutePolicyUpdateBody = z.infer<typeof routePolicyUpdateBodySchema>
export type RoutePolicyUpdateResponse = z.infer<typeof routePolicyUpdateResponseSchema>

export class RoutesApiError extends Error {
  constructor(message: string, readonly requestId?: string) { super(message); this.name = 'RoutesApiError' }
}

export async function fetchRoutes(filters: RouteFilters, signal?: AbortSignal): Promise<RoutesResponse> {
  const value = routeFiltersSchema.parse(filters)
  const response = await fetch(`/api/routes?${new URLSearchParams(value)}`, { headers: { accept: 'application/json' }, signal })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw new RoutesApiError('用途与路由暂时无法加载', requestId)
  const result = routesResponseSchema.safeParse(await response.json())
  if (!result.success) throw new RoutesApiError('用途与路由格式不符合接口约定', requestId)
  return result.data
}

export async function updateLocalRoutePolicy(id: string, payload: RoutePolicyUpdateBody): Promise<RoutePolicyUpdateResponse> {
  const body = routePolicyUpdateBodySchema.parse(payload)
  const response = await fetch(`/api/routes/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(body),
  })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new RoutesApiError(detail?.error?.message ?? '保存本地路由策略失败', requestId)
  }
  const result = routePolicyUpdateResponseSchema.safeParse(await response.json())
  if (!result.success) throw new RoutesApiError('本地路由策略响应格式不符合接口约定', requestId)
  return result.data
}
