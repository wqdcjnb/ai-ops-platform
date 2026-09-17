import { z } from 'zod'

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

export type LimitFilters = z.infer<typeof limitFiltersSchema>
export type LimitsResponse = z.infer<typeof limitsResponseSchema>
export type LimitNode = z.infer<typeof limitNodeSchema>

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
