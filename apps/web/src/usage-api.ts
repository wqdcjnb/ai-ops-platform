import { z } from 'zod'

const costTypeSchema = z.literal('platform_estimate')
const metadataSourceSchema = z.literal('database')
export const usageFiltersSchema = z.object({ period: z.enum(['today', '7d', '30d']), search: z.string().max(80), person: z.string(), purpose: z.string(), key: z.string(), model: z.string(), channel: z.string(), status: z.enum(['all', 'succeeded', 'failed', 'cancelled']), costType: z.union([z.literal('all'), costTypeSchema]), page: z.number().int().positive(), pageSize: z.number().int().min(5).max(50) })

const optionSchema = z.object({ id: z.string(), label: z.string() })
export const usageItemSchema = z.object({
  requestId: z.string(), occurredAt: z.string().datetime(), person: z.object({ id: z.string(), name: z.string() }), key: z.object({ id: z.string(), masked: z.string() }), purpose: z.object({ id: z.string(), name: z.string(), alias: z.string() }), model: z.object({ id: z.string(), displayName: z.string(), actualModel: z.string() }), channel: z.object({ id: z.string(), name: z.string(), type: z.literal('official_api') }), protocol: z.enum(['chat_completions', 'responses']), streamed: z.boolean(), tokens: z.object({ input: z.number().int().nonnegative(), output: z.number().int().nonnegative(), total: z.number().int().nonnegative() }), points: z.number().nonnegative(),
  latency: z.object({
    firstTokenMs: z.number().int().nonnegative().nullable(), totalMs: z.number().int().nonnegative(),
    aiOpsAuthMs: z.number().int().nonnegative().default(0), contextCompactionMs: z.number().int().nonnegative().default(0),
    upstreamFirstTokenMs: z.number().int().nonnegative().nullable().default(null), upstreamTotalMs: z.number().int().nonnegative().default(0),
  }),
  context: z.object({
    originalChars: z.number().int().nonnegative().default(0), forwardedChars: z.number().int().nonnegative().default(0),
    droppedMessages: z.number().int().nonnegative().default(0), strippedChars: z.number().int().nonnegative().default(0),
  }).default({ originalChars: 0, forwardedChars: 0, droppedMessages: 0, strippedChars: 0 }),
  cost: z.object({ type: costTypeSchema, amountUsd: z.number().nonnegative(), label: z.string() }), status: z.enum(['succeeded', 'failed', 'cancelled']), error: z.object({ category: z.enum(['rate_limit', 'timeout', 'authentication', 'server', 'cancelled']), summary: z.string() }).nullable(), conversationContentAvailable: z.literal(false),
})

export const usageResponseSchema = z.object({ meta: z.object({ source: metadataSourceSchema, simulated: z.boolean(), generatedAt: z.string().datetime(), period: z.enum(['today', '7d', '30d']), notice: z.string() }), summary: z.object({ requests: z.number().int().nonnegative(), tokens: z.number().int().nonnegative(), points: z.number().nonnegative(), successRate: z.number().min(0).max(100), p95LatencyMs: z.number().int().nonnegative(), costs: z.object({ platformEstimateUsd: z.number().nonnegative() }) }), options: z.object({ people: z.array(optionSchema), purposes: z.array(optionSchema), keys: z.array(optionSchema), models: z.array(optionSchema), channels: z.array(optionSchema) }), items: z.array(usageItemSchema), pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }) })

export const usageDetailResponseSchema = z.object({ meta: z.object({ source: metadataSourceSchema, simulated: z.boolean(), generatedAt: z.string().datetime(), notice: z.string() }), item: usageItemSchema, route: z.object({ alias: z.string(), retryCount: z.number().int().nonnegative(), requestIdPropagated: z.boolean() }), client: z.object({ name: z.enum(['Codex Desktop', 'WorkBuddy']), mode: z.enum(['stream', 'non_stream']) }), content: z.object({ stored: z.literal(false), reason: z.string() }), conversationAudit: z.object({ accessible: z.boolean(), recordId: z.string().nullable(), href: z.string().nullable(), source: z.enum(['gateway_capture', 'unavailable', 'not_authorized']), notice: z.string() }) })

export const modelAnalyticsQuerySchema = z.object({
  days: z.union([z.literal(1), z.literal(7), z.literal(14), z.literal(29)]),
  timeGranularity: z.enum(['hour', 'day', 'week']),
  person: z.string().max(96),
})

export const modelAnalyticsResponseSchema = z.object({
  meta: z.object({ source: z.literal('ai_ops_local'), generatedAt: z.string().datetime(), startAt: z.string().datetime(), endAt: z.string().datetime(), timeGranularity: z.enum(['hour', 'day', 'week']), person: z.string(), notice: z.string() }),
  summary: z.object({ totalCount: z.number().int().nonnegative(), totalTokens: z.number().int().nonnegative(), averageRpm: z.number().nonnegative(), averageTpm: z.number().nonnegative() }),
  options: z.object({ people: z.array(optionSchema) }),
  models: z.array(z.object({ modelName: z.string(), count: z.number().int().nonnegative(), tokens: z.number().int().nonnegative() })),
  series: z.array(z.object({ bucket: z.string().datetime(), modelName: z.string(), count: z.number().int().nonnegative(), tokens: z.number().int().nonnegative() })),
})

export type UsageFilters = z.infer<typeof usageFiltersSchema>
export type UsageResponse = z.infer<typeof usageResponseSchema>
export type UsageItem = z.infer<typeof usageItemSchema>
export type UsageDetail = z.infer<typeof usageDetailResponseSchema>
export type ModelAnalyticsQuery = z.infer<typeof modelAnalyticsQuerySchema>
export type ModelAnalyticsResponse = z.infer<typeof modelAnalyticsResponseSchema>

export class UsageApiError extends Error { constructor(message: string, readonly requestId?: string) { super(message) } }
async function getResource<T>(url: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal })
  const requestId = response.headers.get('x-request-id') ?? undefined
  const analytics = url.startsWith('/api/usage/model-analytics')
  if (!response.ok) throw new UsageApiError(response.status === 404 ? '未找到指定调用记录' : analytics ? '模型调用分析暂时无法加载' : '用量与日志暂时无法加载', requestId)
  const parsed = schema.safeParse(await response.json())
  if (!parsed.success) throw new UsageApiError(analytics ? '模型调用分析格式不符合接口约定' : '用量与日志格式不符合接口约定', requestId)
  return parsed.data
}

export async function fetchUsage(filters: UsageFilters, signal?: AbortSignal): Promise<UsageResponse> {
  const value = usageFiltersSchema.parse(filters)
  const params = new URLSearchParams(Object.entries(value).map(([key, item]) => [key, String(item)]))
  return getResource(`/api/usage?${params}`, usageResponseSchema, signal)
}
export async function fetchUsageDetail(requestId: string, signal?: AbortSignal): Promise<UsageDetail> { return getResource(`/api/usage/${encodeURIComponent(requestId)}`, usageDetailResponseSchema, signal) }

export async function fetchModelAnalytics(filters: ModelAnalyticsQuery, signal?: AbortSignal): Promise<ModelAnalyticsResponse> {
  const value = modelAnalyticsQuerySchema.parse(filters)
  const params = new URLSearchParams(Object.entries(value).map(([key, item]) => [key, String(item)]))
  return getResource(`/api/usage/model-analytics?${params}`, modelAnalyticsResponseSchema, signal)
}
