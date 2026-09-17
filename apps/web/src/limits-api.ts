import { z } from 'zod'
import { withCsrfHeader } from './csrf'

export const limitFiltersSchema = z.object({
  level: z.enum(['all', 'company', 'department', 'person', 'purpose', 'key']),
  search: z.string().max(60),
})

const periodUsageSchema = z.object({
  id: z.enum(['hour', 'day', 'week', 'month']), label: z.string(), used: z.number().int().nonnegative(), reserved: z.number().int().nonnegative(),
  limit: z.number().int().positive(), percent: z.number().min(0), resetAt: z.string(),
})

export const limitNodeSchema = z.object({
  id: z.string(), parentId: z.string().nullable(), depth: z.number().int().min(0).max(4), level: z.enum(['company', 'department', 'person', 'purpose', 'key']),
  name: z.string(), descriptor: z.string(), mode: z.literal('soft'), state: z.enum(['normal', 'near', 'reached']), inheritedFrom: z.string().nullable(),
  periods: z.array(periodUsageSchema).length(4),
  rates: z.object({
    rpm: z.object({ limit: z.number().int().positive(), current: z.number().int().nonnegative(), hits: z.number().int().nonnegative() }),
    tpm: z.object({ limit: z.number().int().positive(), current: z.number().int().nonnegative(), hits: z.number().int().nonnegative() }),
    concurrent: z.object({ limit: z.number().int().positive(), current: z.number().int().nonnegative(), hits: z.number().int().nonnegative() }),
  }),
})

export const limitsResponseSchema = z.object({
  meta: z.object({ source: z.enum(['demo', 'database']), generatedAt: z.string(), timezone: z.literal('Asia/Shanghai'), notice: z.string() }),
  summary: z.object({ monthlyLimit: z.number().int().positive(), used: z.number().int().nonnegative(), reserved: z.number().int().nonnegative(), percent: z.number().min(0), alertedScopes: z.number().int().nonnegative(), hitCount: z.number().int().nonnegative() }),
  hardMode: z.object({ enabled: z.literal(false), blocking: z.literal(false), requirements: z.array(z.object({ label: z.string(), state: z.literal('pending'), detail: z.string() })) }),
  options: z.object({ levels: z.array(z.object({ id: z.enum(['company', 'department', 'person', 'purpose', 'key']), label: z.string() })) }),
  items: z.array(limitNodeSchema), total: z.number().int().nonnegative(),
})

export const quotaUpdateBodySchema = z.object({
  targetPoints: z.number().int().min(1).max(1_000_000),
  idempotencyKey: z.string().regex(/^quota-update-[a-z0-9-]{8,96}$/),
  reason: z.string().trim().min(8).max(200),
  acknowledgeImpact: z.literal(true),
})

export const quotaUpdateResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), completedAt: z.string(), notice: z.string() }),
  policy: z.object({
    id: z.string(), nodeId: z.string(), level: z.enum(['company', 'department', 'person', 'purpose', 'key']),
    targetPoints: z.number().int().positive(), mode: z.literal('soft'),
  }),
  impact: z.object({ previousTargetPoints: z.number().int().positive(), used: z.number().int().nonnegative(), reserved: z.number().int().nonnegative(), projectedPercent: z.number().min(0) }),
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})

export type LimitFilters = z.infer<typeof limitFiltersSchema>
export type LimitsResponse = z.infer<typeof limitsResponseSchema>
export type LimitNode = z.infer<typeof limitNodeSchema>
export type QuotaUpdateBody = z.infer<typeof quotaUpdateBodySchema>
export type QuotaUpdateResponse = z.infer<typeof quotaUpdateResponseSchema>

export class LimitsApiError extends Error {
  constructor(message: string, readonly requestId?: string) { super(message); this.name = 'LimitsApiError' }
}

export async function fetchLimits(filters: LimitFilters, signal?: AbortSignal): Promise<LimitsResponse> {
  const value = limitFiltersSchema.parse(filters)
  const response = await fetch(`/api/limits?${new URLSearchParams(value)}`, { headers: { accept: 'application/json' }, signal })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw new LimitsApiError('额度策略暂时无法加载', requestId)
  const result = limitsResponseSchema.safeParse(await response.json())
  if (!result.success) throw new LimitsApiError('额度策略格式不符合接口约定', requestId)
  return result.data
}

export async function updateMonthlySoftQuota(id: string, payload: QuotaUpdateBody): Promise<QuotaUpdateResponse> {
  const body = quotaUpdateBodySchema.parse(payload)
  const response = await fetch(`/api/limits/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(body),
  })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new LimitsApiError(detail?.error?.message ?? '调整月度软目标失败', requestId)
  }
  const result = quotaUpdateResponseSchema.safeParse(await response.json())
  if (!result.success) throw new LimitsApiError('调整月度软目标响应格式不符合接口约定', requestId)
  return result.data
}
