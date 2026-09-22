import { z } from 'zod'
import type { NewApiDatabaseReader, NewApiLogRecord } from './new-api-database.js'

/**
 * The model analytics view intentionally has a smaller contract than the
 * request-log view.  It mirrors the fields used by New API's dashboard and
 * never exposes prompt/response content or credentials.
 */
export const modelAnalyticsGranularitySchema = z.enum(['hour', 'day', 'week'])

export const modelAnalyticsQuerySchema = z.object({
  days: z.coerce.number().int().refine((value) => [1, 7, 14, 29].includes(value), 'days must be one of 1, 7, 14, or 29').default(1),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  // Accept New API's native snake_case names as well as the UI-friendly
  // aliases used by the BFF client.
  start_timestamp: z.coerce.number().finite().optional(),
  end_timestamp: z.coerce.number().finite().optional(),
  timeGranularity: modelAnalyticsGranularitySchema.default('hour'),
  time_granularity: modelAnalyticsGranularitySchema.optional(),
  username: z.string().trim().max(80).default(''),
})

const modelAnalyticsModelSchema = z.object({
  modelName: z.string(),
  count: z.number().int().nonnegative(),
  quota: z.number().nonnegative(),
  tokens: z.number().int().nonnegative(),
})

const modelAnalyticsSeriesSchema = z.object({
  bucket: z.string().datetime(),
  modelName: z.string(),
  count: z.number().int().nonnegative(),
  quota: z.number().nonnegative(),
  tokens: z.number().int().nonnegative(),
})

export const modelAnalyticsResponseSchema = z.object({
  meta: z.object({
    source: z.literal('new_api'),
    generatedAt: z.string().datetime(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    timeGranularity: modelAnalyticsGranularitySchema,
    username: z.string(),
    notice: z.string(),
  }),
  summary: z.object({
    totalCount: z.number().int().nonnegative(),
    totalQuota: z.number().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    averageRpm: z.number().nonnegative(),
    averageTpm: z.number().nonnegative(),
  }),
  models: z.array(modelAnalyticsModelSchema),
  series: z.array(modelAnalyticsSeriesSchema),
})

export type ModelAnalyticsQuery = z.infer<typeof modelAnalyticsQuerySchema>
export type ModelAnalyticsResponse = z.infer<typeof modelAnalyticsResponseSchema>

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
  const day = result.getUTCDay()
  const daysSinceMonday = (day + 6) % 7
  result.setUTCDate(result.getUTCDate() - daysSinceMonday)
  return result
}

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

function isModelCall(record: NewApiLogRecord) {
  // New API uses type 1 for administrative events, type 2 for successful
  // calls, and type 5 for failed calls.  Keep failures in the analysis so the
  // call count agrees with the dashboard's log-based view.
  return Boolean(record.modelName?.trim()) && record.type !== 1
}

function aggregateRecord(record: NewApiLogRecord) {
  return {
    modelName: record.modelName!.trim(),
    count: 1,
    quota: Math.max(0, Number.isFinite(record.quota) ? record.quota : 0),
    tokens: Math.max(0, Math.round(record.promptTokens + record.completionTokens)),
  }
}

/** Build New API-compatible model call analytics from the read-only SQLite adapter. */
export function createNewApiModelAnalytics(
  reader: Pick<NewApiDatabaseReader, 'listLogs'>,
  query: ModelAnalyticsQuery,
  now = new Date(),
): ModelAnalyticsResponse {
  const granularity = query.time_granularity ?? query.timeGranularity
  const end = validDate(query.endAt) ?? epochDate(query.end_timestamp) ?? now
  const requestedStart = validDate(query.startAt) ?? epochDate(query.start_timestamp)
  const start = requestedStart ?? new Date(end.getTime() - query.days * 24 * 60 * 60 * 1000)
  const lower = start.getTime() <= end.getTime() ? start : end
  const upper = start.getTime() <= end.getTime() ? end : start
  const username = query.username.trim().toLocaleLowerCase('en-US')
  const modelTotals = new Map<string, { count: number; quota: number; tokens: number }>()
  const seriesTotals = new Map<string, { bucket: string; modelName: string; count: number; quota: number; tokens: number }>()

  for (const record of reader.listLogs(50_000)) {
    if (!isModelCall(record)) continue
    const occurredAt = validDate(record.occurredAt)
    if (!occurredAt || occurredAt < lower || occurredAt > upper) continue
    if (username && !(record.username ?? '').toLocaleLowerCase('en-US').includes(username)) continue
    const item = aggregateRecord(record)
    const model = modelTotals.get(item.modelName) ?? { count: 0, quota: 0, tokens: 0 }
    model.count += item.count
    model.quota += item.quota
    model.tokens += item.tokens
    modelTotals.set(item.modelName, model)

    const bucket = startOfBucket(occurredAt, granularity).toISOString()
    const seriesKey = `${bucket}\u0000${item.modelName}`
    const point = seriesTotals.get(seriesKey) ?? { bucket, modelName: item.modelName, count: 0, quota: 0, tokens: 0 }
    point.count += item.count
    point.quota += item.quota
    point.tokens += item.tokens
    seriesTotals.set(seriesKey, point)
  }

  const models = [...modelTotals.entries()]
    .map(([modelName, value]) => ({ modelName, count: value.count, quota: Number(value.quota.toFixed(2)), tokens: value.tokens }))
    .sort((left, right) => right.count - left.count || right.tokens - left.tokens || left.modelName.localeCompare(right.modelName))
  const series = [...seriesTotals.values()]
    .map((value) => ({ ...value, quota: Number(value.quota.toFixed(2)) }))
    .sort((left, right) => left.bucket.localeCompare(right.bucket) || right.count - left.count || left.modelName.localeCompare(right.modelName))
  const totalCount = models.reduce((sum, item) => sum + item.count, 0)
  const totalQuota = Number(models.reduce((sum, item) => sum + item.quota, 0).toFixed(2))
  const totalTokens = models.reduce((sum, item) => sum + item.tokens, 0)
  const elapsedMinutes = Math.max(1, (upper.getTime() - lower.getTime()) / 60_000)

  return modelAnalyticsResponseSchema.parse({
    meta: {
      source: 'new_api',
      generatedAt: now.toISOString(),
      startAt: lower.toISOString(),
      endAt: upper.toISOString(),
      timeGranularity: granularity,
      username: query.username,
      notice: '数据源：New API SQLite 日志；仅统计模型调用元数据，不读取 AI OPS 本地用量镜像或对话正文。',
    },
    summary: {
      totalCount,
      totalQuota,
      totalTokens,
      averageRpm: Number((totalCount / elapsedMinutes).toFixed(2)),
      averageTpm: Number((totalTokens / elapsedMinutes).toFixed(2)),
    },
    models,
    series,
  })
}
