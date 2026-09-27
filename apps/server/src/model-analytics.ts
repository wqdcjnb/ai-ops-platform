import { z } from 'zod'

export const modelAnalyticsGranularitySchema = z.enum(['hour', 'day', 'week'])
export const modelAnalyticsQuerySchema = z.object({
  days: z.coerce.number().int().refine((value) => [1, 7, 14, 29].includes(value), 'days must be one of 1, 7, 14, or 29').default(1),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  start_timestamp: z.coerce.number().finite().optional(),
  end_timestamp: z.coerce.number().finite().optional(),
  timeGranularity: modelAnalyticsGranularitySchema.default('hour'),
  time_granularity: modelAnalyticsGranularitySchema.optional(),
  person: z.string().trim().max(96).default('all'),
  username: z.string().trim().max(80).default(''),
})
const optionSchema = z.object({ id: z.string(), label: z.string() })
const modelSchema = z.object({ modelName: z.string(), count: z.number().int().nonnegative(), tokens: z.number().int().nonnegative() })
const seriesSchema = z.object({ bucket: z.string().datetime(), modelName: z.string(), count: z.number().int().nonnegative(), tokens: z.number().int().nonnegative() })
export const modelAnalyticsResponseSchema = z.object({
  meta: z.object({ source: z.literal('ai_ops_local'), generatedAt: z.string().datetime(), startAt: z.string().datetime(), endAt: z.string().datetime(), timeGranularity: modelAnalyticsGranularitySchema, person: z.string(), notice: z.string() }),
  summary: z.object({ totalCount: z.number().int().nonnegative(), totalTokens: z.number().int().nonnegative(), averageRpm: z.number().nonnegative(), averageTpm: z.number().nonnegative() }),
  options: z.object({ people: z.array(optionSchema) }),
  models: z.array(modelSchema),
  series: z.array(seriesSchema),
})
export type ModelAnalyticsQuery = z.infer<typeof modelAnalyticsQuerySchema>
export type ModelAnalyticsResponse = z.infer<typeof modelAnalyticsResponseSchema>
export interface LocalModelAnalyticsRecord {
  requestId: string
  occurredAt: string
  personId: string
  personName: string
  modelId: string
  inputTokens: number | string | null | undefined
  outputTokens: number | string | null | undefined
}

function dateValue(value: string | undefined) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
function epochDate(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return null
  const date = new Date(value < 1_000_000_000_000 ? value * 1_000 : value)
  return Number.isNaN(date.getTime()) ? null : date
}
function numeric(value: number | string | null | undefined) {
  const result = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(result) ? Math.max(0, Math.floor(result)) : 0
}
function startOfBucket(value: Date, granularity: ModelAnalyticsQuery['timeGranularity']) {
  const result = new Date(value)
  if (granularity === 'hour') result.setUTCMinutes(0, 0, 0)
  else if (granularity === 'day') result.setUTCHours(0, 0, 0, 0)
  else {
    result.setUTCHours(0, 0, 0, 0)
    result.setUTCDate(result.getUTCDate() - ((result.getUTCDay() + 6) % 7))
  }
  return result
}
export function resolveModelAnalyticsWindow(query: ModelAnalyticsQuery, now = new Date()) {
  const end = dateValue(query.endAt) ?? epochDate(query.end_timestamp) ?? now
  const requestedStart = dateValue(query.startAt) ?? epochDate(query.start_timestamp)
  const start = requestedStart ?? new Date(end.getTime() - query.days * 86_400_000)
  return start.getTime() <= end.getTime() ? { start, end } : { start: end, end: start }
}
export function createLocalModelAnalytics(input: readonly LocalModelAnalyticsRecord[], query: ModelAnalyticsQuery, now = new Date()): ModelAnalyticsResponse {
  const { start, end } = resolveModelAnalyticsWindow(query, now)
  const granularity = query.time_granularity ?? query.timeGranularity
  const selectedPerson = query.person.trim() || 'all'
  const records = input.flatMap((record) => {
    const occurredAt = dateValue(record.occurredAt)
    if (!occurredAt || occurredAt < start || occurredAt > end || (selectedPerson !== 'all' && selectedPerson !== record.personId)) return []
    const modelName = record.modelId.trim()
    if (!modelName) return []
    return [{ occurredAt, modelName, personId: record.personId, personName: record.personName.trim() || '未命名人员', tokens: numeric(record.inputTokens) + numeric(record.outputTokens) }]
  })
  const people = new Map<string, string>()
  const models = new Map<string, { count: number; tokens: number }>()
  const series = new Map<string, { bucket: string; modelName: string; count: number; tokens: number }>()
  for (const record of records) {
    people.set(record.personId, record.personName)
    const model = models.get(record.modelName) ?? { count: 0, tokens: 0 }
    model.count += 1
    model.tokens += record.tokens
    models.set(record.modelName, model)
    const bucket = startOfBucket(record.occurredAt, granularity).toISOString()
    const key = bucket + '\u0000' + record.modelName
    const point = series.get(key) ?? { bucket, modelName: record.modelName, count: 0, tokens: 0 }
    point.count += 1
    point.tokens += record.tokens
    series.set(key, point)
  }
  const modelItems = [...models.entries()].map(([modelName, value]) => ({ modelName, ...value })).sort((left, right) => right.count - left.count || left.modelName.localeCompare(right.modelName))
  const totalCount = modelItems.reduce((sum, item) => sum + item.count, 0)
  const totalTokens = modelItems.reduce((sum, item) => sum + item.tokens, 0)
  const elapsedMinutes = Math.max(1, (end.getTime() - start.getTime()) / 60_000)
  return modelAnalyticsResponseSchema.parse({
    meta: { source: 'ai_ops_local', generatedAt: now.toISOString(), startAt: start.toISOString(), endAt: end.toISOString(), timeGranularity: granularity, person: selectedPerson, notice: '数据来自 AI OPS 网关已采集的调用元数据，按实际上游模型汇总。' },
    summary: { totalCount, totalTokens, averageRpm: Number((totalCount / elapsedMinutes).toFixed(2)), averageTpm: Number((totalTokens / elapsedMinutes).toFixed(2)) },
    options: { people: [...people.entries()].map(([id, label]) => ({ id, label })).sort((left, right) => left.label.localeCompare(right.label, 'zh-CN')) },
    models: modelItems,
    series: [...series.values()].sort((left, right) => left.bucket.localeCompare(right.bucket) || left.modelName.localeCompare(right.modelName)),
  })
}
