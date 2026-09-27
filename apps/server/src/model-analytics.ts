import { z } from 'zod'
import { isDepartmentVisible, type DataScope } from './data-scope.js'

/**
 * Model-call analytics deliberately contains only gateway metadata. The
 * contract has no prompt, response, API-key, or provider-secret fields.
 */
export const modelAnalyticsGranularitySchema = z.enum(['hour', 'day', 'week'])

export const modelAnalyticsQuerySchema = z.object({
  days: z.coerce.number().int().refine((value) => [1, 7, 14, 29].includes(value), 'days must be one of 1, 7, 14, or 29').default(1),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  // Keep these aliases so an old bookmarked dashboard query remains harmless.
  start_timestamp: z.coerce.number().finite().optional(),
  end_timestamp: z.coerce.number().finite().optional(),
  timeGranularity: modelAnalyticsGranularitySchema.default('hour'),
  time_granularity: modelAnalyticsGranularitySchema.optional(),
  person: z.string().trim().max(96).default('all'),
  // Retained only so old bookmarked dashboard URLs remain harmless.
  username: z.string().trim().max(80).default(''),
})

const optionSchema = z.object({ id: z.string(), label: z.string() })
const modelAnalyticsModelSchema = z.object({
  modelName: z.string(),
  count: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
})
const modelAnalyticsSeriesSchema = z.object({
  bucket: z.string().datetime(),
  modelName: z.string(),
  count: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
})

export const modelAnalyticsResponseSchema = z.object({
  meta: z.object({
    source: z.literal('ai_ops_local'),
    generatedAt: z.string().datetime(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    timeGranularity: modelAnalyticsGranularitySchema,
    person: z.string(),
    notice: z.string(),
  }),
  summary: z.object({
    totalCount: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    averageRpm: z.number().nonnegative(),
    averageTpm: z.number().nonnegative(),
  }),
  options: z.object({ people: z.array(optionSchema) }),
  models: z.array(modelAnalyticsModelSchema),
  series: z.array(modelAnalyticsSeriesSchema),
})

export type ModelAnalyticsQuery = z.infer<typeof modelAnalyticsQuerySchema>
export type ModelAnalyticsResponse = z.infer<typeof modelAnalyticsResponseSchema>

/** The safe, minimum shape read from AI OPS's own gateway_requests table. */
export interface LocalModelAnalyticsRecord {
  requestId: string
  occurredAt: string
  personId: string
  personName: string
  departmentId: string | null
  modelId: string
  inputTokens: number | string | null | undefined
  outputTokens: number | string | null | undefined
}

type Aggregate = { count: number; tokens: number }

function validDate(value: string | null | undefined) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
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
  if (granularity === 'hour') {
    result.setUTCMinutes(0, 0, 0)
    return result
  }
  if (granularity === 'day') {
    result.setUTCHours(0, 0, 0, 0)
    return result
  }
  result.setUTCHours(0, 0, 0, 0)
  result.setUTCDate(result.getUTCDate() - ((result.getUTCDay() + 6) % 7))
  return result
}

export function resolveModelAnalyticsWindow(query: ModelAnalyticsQuery, now = new Date()) {
  const end = validDate(query.endAt) ?? epochDate(query.end_timestamp) ?? now
  const requestedStart = validDate(query.startAt) ?? epochDate(query.start_timestamp)
  const start = requestedStart ?? new Date(end.getTime() - query.days * 24 * 60 * 60 * 1000)
  return start.getTime() <= end.getTime() ? { start, end } : { start: end, end: start }
}

function finishAnalytics(
  records: Array<{ occurredAt: Date; modelName: string; personId: string; personName: string; tokens: number }>,
  query: ModelAnalyticsQuery,
  now: Date,
  source: 'ai_ops_local',
  notice: string,
) {
  const granularity = query.time_granularity ?? query.timeGranularity
  const { start, end } = resolveModelAnalyticsWindow(query, now)
  const allPeople = new Map<string, string>()
  for (const record of records) allPeople.set(record.personId, record.personName)
  const selectedPerson = query.person.trim() || 'all'
  const visible = selectedPerson === 'all' ? records : records.filter((record) => record.personId === selectedPerson)
  const modelTotals = new Map<string, Aggregate>()
  const seriesTotals = new Map<string, { bucket: string; modelName: string; count: number; tokens: number }>()
  for (const record of visible) {
    const model = modelTotals.get(record.modelName) ?? { count: 0, tokens: 0 }
    model.count += 1
    model.tokens += record.tokens
    modelTotals.set(record.modelName, model)
    const bucket = startOfBucket(record.occurredAt, granularity).toISOString()
    const key = `${bucket}\u0000${record.modelName}`
    const point = seriesTotals.get(key) ?? { bucket, modelName: record.modelName, count: 0, tokens: 0 }
    point.count += 1
    point.tokens += record.tokens
    seriesTotals.set(key, point)
  }
  const models = [...modelTotals.entries()]
    .map(([modelName, item]) => ({ modelName, ...item }))
    .sort((left, right) => right.count - left.count || right.tokens - left.tokens || left.modelName.localeCompare(right.modelName))
  const series = [...seriesTotals.values()]
    .sort((left, right) => left.bucket.localeCompare(right.bucket) || right.count - left.count || left.modelName.localeCompare(right.modelName))
  const totalCount = models.reduce((sum, item) => sum + item.count, 0)
  const totalTokens = models.reduce((sum, item) => sum + item.tokens, 0)
  const elapsedMinutes = Math.max(1, (end.getTime() - start.getTime()) / 60_000)
  return modelAnalyticsResponseSchema.parse({
    meta: {
      source,
      generatedAt: now.toISOString(),
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      timeGranularity: granularity,
      person: selectedPerson,
      notice,
    },
    summary: {
      totalCount,
      totalTokens,
      averageRpm: Number((totalCount / elapsedMinutes).toFixed(2)),
      averageTpm: Number((totalTokens / elapsedMinutes).toFixed(2)),
    },
    options: {
      people: [...allPeople.entries()]
        .map(([id, label]) => ({ id, label }))
        .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN')),
    },
    models,
    series,
  })
}

/** Aggregates only records emitted by this AI OPS instance's gateway. */
export function createLocalModelAnalytics(
  input: readonly LocalModelAnalyticsRecord[],
  query: ModelAnalyticsQuery,
  now = new Date(),
  scope: DataScope = { mode: 'global' },
): ModelAnalyticsResponse {
  const { start, end } = resolveModelAnalyticsWindow(query, now)
  const records = input.flatMap((record) => {
    if (!isDepartmentVisible(scope, record.departmentId)) return []
    const occurredAt = validDate(record.occurredAt)
    if (!occurredAt || occurredAt < start || occurredAt > end) return []
    const modelName = record.modelId.trim()
    if (!modelName) return []
    return [{
      occurredAt,
      modelName,
      personId: record.personId,
      personName: record.personName.trim() || '未命名人员',
      tokens: numeric(record.inputTokens) + numeric(record.outputTokens),
    }]
  })
  return finishAnalytics(
    records,
    query,
    now,
    'ai_ops_local',
    '数据源：AI OPS 统一模型网关已采集的真实调用元数据；新采集调用按实际上游模型聚合，不含提示词、回答或凭据。历史上仅保留 ai-ops 别名的记录无法反推具体模型。',
  )
}
