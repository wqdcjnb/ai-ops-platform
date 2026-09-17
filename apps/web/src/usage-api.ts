import { z } from 'zod'

const costTypeSchema = z.enum(['official_actual', 'platform_estimate', 'cpa_estimate'])
export const usageFiltersSchema = z.object({ period: z.enum(['today', '7d', '30d']), search: z.string().max(80), person: z.string(), department: z.string(), purpose: z.string(), key: z.string(), model: z.string(), channel: z.string(), status: z.enum(['all', 'succeeded', 'failed', 'cancelled']), costType: z.union([z.literal('all'), costTypeSchema]), page: z.number().int().positive(), pageSize: z.number().int().min(5).max(50) })

const optionSchema = z.object({ id: z.string(), label: z.string() })
export const usageItemSchema = z.object({
  requestId: z.string(), occurredAt: z.string().datetime(), person: z.object({ id: z.string(), name: z.string(), department: z.object({ id: z.string(), name: z.string() }) }), key: z.object({ id: z.string(), masked: z.string() }), purpose: z.object({ id: z.string(), name: z.string(), alias: z.string() }), model: z.object({ id: z.string(), displayName: z.string(), actualModel: z.string() }), channel: z.object({ id: z.string(), name: z.string(), type: z.enum(['official_api', 'cpa_oauth']) }), protocol: z.enum(['chat_completions', 'responses']), streamed: z.boolean(), tokens: z.object({ input: z.number().int().nonnegative(), output: z.number().int().nonnegative(), total: z.number().int().nonnegative() }), points: z.number().nonnegative(), latency: z.object({ firstTokenMs: z.number().int().nonnegative().nullable(), totalMs: z.number().int().nonnegative() }), cost: z.object({ type: costTypeSchema, amountUsd: z.number().nonnegative(), label: z.string() }), status: z.enum(['succeeded', 'failed', 'cancelled']), error: z.object({ category: z.enum(['rate_limit', 'timeout', 'authentication', 'server', 'cancelled']), summary: z.string() }).nullable(), conversationContentAvailable: z.literal(false),
})

export const usageResponseSchema = z.object({ meta: z.object({ source: z.literal('database'), simulated: z.literal(true), generatedAt: z.string().datetime(), period: z.enum(['today', '7d', '30d']), notice: z.string() }), summary: z.object({ requests: z.number().int().nonnegative(), tokens: z.number().int().nonnegative(), points: z.number().nonnegative(), successRate: z.number().min(0).max(100), p95LatencyMs: z.number().int().nonnegative(), costs: z.object({ officialActualUsd: z.number().nonnegative(), platformEstimateUsd: z.number().nonnegative(), cpaEstimateUsd: z.number().nonnegative() }) }), options: z.object({ people: z.array(optionSchema), departments: z.array(optionSchema), purposes: z.array(optionSchema), keys: z.array(optionSchema), models: z.array(optionSchema), channels: z.array(optionSchema) }), items: z.array(usageItemSchema), pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }) })

export const usageDetailResponseSchema = z.object({ meta: z.object({ source: z.literal('database'), simulated: z.literal(true), generatedAt: z.string().datetime(), notice: z.string() }), item: usageItemSchema, route: z.object({ alias: z.string(), retryCount: z.number().int().nonnegative(), requestIdPropagated: z.boolean() }), client: z.object({ name: z.enum(['Codex Desktop', 'WorkBuddy']), mode: z.enum(['stream', 'non_stream']) }), content: z.object({ stored: z.literal(false), reason: z.string() }), conversationAudit: z.object({ accessible: z.boolean(), recordId: z.string().nullable(), href: z.string().nullable(), source: z.enum(['synthetic_seed', 'unavailable', 'not_authorized']), notice: z.string() }) })

export type UsageFilters = z.infer<typeof usageFiltersSchema>
export type UsageResponse = z.infer<typeof usageResponseSchema>
export type UsageItem = z.infer<typeof usageItemSchema>
export type UsageDetail = z.infer<typeof usageDetailResponseSchema>

export class UsageApiError extends Error { constructor(message: string, readonly requestId?: string) { super(message) } }
async function getResource<T>(url: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> { const response = await fetch(url, { headers: { accept: 'application/json' }, signal }); const requestId = response.headers.get('x-request-id') ?? undefined; if (!response.ok) throw new UsageApiError(response.status === 404 ? '未找到指定调用记录' : '用量与日志暂时无法加载', requestId); const parsed = schema.safeParse(await response.json()); if (!parsed.success) throw new UsageApiError('用量与日志格式不符合接口约定', requestId); return parsed.data }

export async function fetchUsage(filters: UsageFilters, signal?: AbortSignal): Promise<UsageResponse> {
  const value = usageFiltersSchema.parse(filters)
  const params = new URLSearchParams(Object.entries(value).map(([key, item]) => [key, String(item)]))
  return getResource(`/api/usage?${params}`, usageResponseSchema, signal)
}
export async function fetchUsageDetail(requestId: string, signal?: AbortSignal): Promise<UsageDetail> { return getResource(`/api/usage/${encodeURIComponent(requestId)}`, usageDetailResponseSchema, signal) }
