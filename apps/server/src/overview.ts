import { z } from 'zod'
import type { NewApiStatus } from './new-api-status.js'
import { isDepartmentVisible, scopeNotice, type DataScope } from './data-scope.js'
import type { NewApiDatabaseReader, NewApiLogRecord } from './new-api-database.js'
import type { PlatformDatabase } from './platform-db.js'

export const periodSchema = z.enum(['7d', '30d'])
export type Period = z.infer<typeof periodSchema>

const trendPointSchema = z.object({ date: z.string(), requests: z.number().int().nonnegative() })
const personSchema = z.object({ id: z.string(), name: z.string(), initials: z.string(), department: z.string(), purpose: z.string(), requests: z.number().int().nonnegative(), tokens: z.number().int().nonnegative(), tone: z.enum(['coral', 'blue', 'violet', 'green', 'amber']) })
const channelSchema = z.object({ id: z.string(), name: z.string(), model: z.string(), type: z.enum(['production', 'experiment']), status: z.enum(['healthy', 'auth_required']), latencyMs: z.number().int().nonnegative().nullable(), successRate: z.number().min(0).max(100), requests: z.number().int().nonnegative() })

export const overviewResponseSchema = z.object({
  meta: z.object({ source: z.enum(['database', 'new_api']), simulated: z.boolean(), generatedAt: z.string().datetime(), timezone: z.literal('Asia/Shanghai'), period: periodSchema, notice: z.string() }),
  service: z.object({ bff: z.literal('healthy'), newApi: z.object({ state: z.enum(['offline', 'reachable', 'auth_required', 'ready']), authConfigured: z.boolean(), checkedAt: z.string().datetime() }) }),
  metrics: z.object({
    todayRequests: z.number().int().nonnegative(), todayRequestDeltaPercent: z.number(), inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), tokenDeltaPercent: z.number(), successRate: z.number().min(0).max(100), successDeltaPercent: z.number(), p95LatencyMs: z.number().int().nonnegative(), p95LatencyDeltaMs: z.number(), firstTokenLatencyMs: z.number().int().nonnegative(),
  }),
  trend: z.array(trendPointSchema), people: z.array(personSchema), channels: z.array(channelSchema), limits: z.object({ mode: z.literal('soft'), blocking: z.literal(false) }),
})

export type OverviewResponse = z.infer<typeof overviewResponseSchema>

const tones = ['coral', 'blue', 'violet', 'green', 'amber'] as const

function shanghaiDate(value: Date | string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function datesFor(period: Period, now: Date) {
  const length = period === '7d' ? 7 : 30
  return Array.from({ length }, (_, index) => {
    const date = new Date(now.getTime() - (length - index - 1) * 86_400_000)
    const key = shanghaiDate(date)
    return { key, label: `${key.slice(5, 7)}/${key.slice(8, 10)}` }
  })
}

function sum<T>(items: T[], read: (item: T) => number) { return items.reduce((total, item) => total + read(item), 0) }
function rounded(value: number) { return Math.max(0, Math.round(value)) }
function percentageDelta(current: number, previous: number) { return previous === 0 ? 0 : Math.round(((current - previous) / previous) * 1_000) / 10 }
function percentile(values: number[], quantile: number) {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))] ?? 0
}
function rate(items: Array<{ status: string }>) { return items.length ? Math.round((items.filter((item) => item.status === 'succeeded').length / items.length) * 1_000) / 10 : 100 }

export function createDatabaseOverview(period: Period, database: PlatformDatabase, now = new Date(), newApi: NewApiStatus = { state: 'offline', authConfigured: false, checkedAt: now.toISOString() }, scope: DataScope = { mode: 'global' }): OverviewResponse {
  const records = database.listUsageRequests().filter((item) => isDepartmentVisible(scope, item.departmentId))
  const todayKey = shanghaiDate(now)
  const yesterdayKey = shanghaiDate(new Date(now.getTime() - 86_400_000))
  const monthStart = `${todayKey.slice(0, 7)}-01`
  const today = records.filter((item) => shanghaiDate(item.occurredAt) === todayKey)
  const yesterday = records.filter((item) => shanghaiDate(item.occurredAt) === yesterdayKey)
  const month = records.filter((item) => shanghaiDate(item.occurredAt) >= monthStart)
  const todayTokens = sum(today, (item) => item.inputTokens + item.outputTokens)
  const yesterdayTokens = sum(yesterday, (item) => item.inputTokens + item.outputTokens)
  const todayLatency = today.map((item) => item.totalLatencyMs)
  const yesterdayLatency = yesterday.map((item) => item.totalLatencyMs)
  const todayFirstToken = today.map((item) => item.firstTokenMs).filter((item): item is number => item !== null)
  const dates = datesFor(period, now)
  const visibleDates = new Set(dates.map((item) => item.key))
  const visibleRecords = records.filter((item) => visibleDates.has(shanghaiDate(item.occurredAt)))
  const trend = dates.map(({ key, label }) => {
    const items = visibleRecords.filter((item) => shanghaiDate(item.occurredAt) === key)
    return { date: label, requests: items.length }
  })

  const peopleById = new Map(database.listPeople().filter((person) => isDepartmentVisible(scope, person.departmentId)).map((person) => [person.id, person]))
  const people = [...peopleById.values()].map((person) => {
    const items = month.filter((item) => item.personId === person.id)
    const purposes = new Map<string, { name: string; count: number }>()
    for (const item of items) {
      const current = purposes.get(item.purposeId) ?? { name: item.purposeName, count: 0 }
      current.count += 1
      purposes.set(item.purposeId, current)
    }
    const mainPurpose = [...purposes.values()].sort((left, right) => right.count - left.count)[0]?.name ?? '暂无调用'
    const tokens = sum(items, (item) => item.inputTokens + item.outputTokens)
    return { id: person.id, name: person.displayName, initials: person.displayName.slice(0, 1) || '我', department: person.departmentName ?? '未分配部门', purpose: mainPurpose, requests: items.length, tokens, tone: tones[0] }
  }).filter((person) => person.requests > 0).sort((left, right) => right.requests - left.requests || right.tokens - left.tokens).slice(0, 5).map((person, index) => ({ ...person, tone: tones[index % tones.length] ?? 'coral' }))

  const channelGroups = new Map<string, typeof visibleRecords>()
  for (const item of visibleRecords) channelGroups.set(item.channelId, [...(channelGroups.get(item.channelId) ?? []), item])
  const channels = [...channelGroups.entries()].map(([id, items]) => {
    const aliases = new Map<string, number>()
    for (const item of items) aliases.set(item.routeAlias, (aliases.get(item.routeAlias) ?? 0) + 1)
    const successRate = rate(items)
    const type = items[0]?.channelType === 'cpa_oauth' ? 'experiment' as const : 'production' as const
    return {
      id,
      name: items[0]?.channelName ?? id,
      model: [...aliases.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? '未分配别名',
      type,
      status: type === 'experiment' && successRate < 100 ? 'auth_required' as const : 'healthy' as const,
      latencyMs: rounded(percentile(items.map((item) => item.totalLatencyMs), .95)),
      successRate,
      requests: items.length,
    }
  }).sort((left, right) => right.requests - left.requests)

  const currentP95 = rounded(percentile(todayLatency, .95))
  const previousP95 = rounded(percentile(yesterdayLatency, .95))
  return {
    meta: {
      source: 'database', simulated: true, generatedAt: now.toISOString(), timezone: 'Asia/Shanghai', period,
      notice: `核心指标、趋势、人员排行和渠道摘要来自 SQLite 可重复模拟记录；不等同于实时网关健康状态、真实调用日志或供应商账单。${scopeNotice(scope)}`,
    },
    service: { bff: 'healthy', newApi },
    metrics: {
      todayRequests: today.length,
      todayRequestDeltaPercent: percentageDelta(today.length, yesterday.length),
      inputTokens: sum(today, (item) => item.inputTokens),
      outputTokens: sum(today, (item) => item.outputTokens),
      tokenDeltaPercent: percentageDelta(todayTokens, yesterdayTokens),
      successRate: rate(today),
      successDeltaPercent: rate(today) - rate(yesterday),
      p95LatencyMs: currentP95,
      p95LatencyDeltaMs: currentP95 - previousP95,
      firstTokenLatencyMs: rounded(sum(todayFirstToken, (item) => item) / Math.max(1, todayFirstToken.length)),
    },
    trend,
    people,
    channels,
    limits: { mode: 'soft', blocking: false },
  }
}

type NewApiOverviewRecord = {
  occurredAt: string
  status: 'succeeded' | 'failed'
  inputTokens: number
  outputTokens: number
  latencyMs: number
  userId: string
  userName: string
  model: string
  channelId: string
  channelName: string
  channelType: 'production' | 'experiment'
}

function newApiOverviewRecord(record: NewApiLogRecord): NewApiOverviewRecord {
  const channelName = record.channelName || `New API channel ${record.channelId ?? 'unknown'}`
  const cpa = channelName.toLocaleLowerCase('en-US').includes('cpa')
  return {
    occurredAt: record.occurredAt ?? new Date(0).toISOString(),
    status: record.type === 2 ? 'succeeded' : 'failed',
    inputTokens: record.promptTokens,
    outputTokens: record.completionTokens,
    latencyMs: Math.max(0, Math.round(record.useTime)),
    userId: record.userId ?? 'unknown',
    userName: record.username ?? 'New API 用户',
    model: record.modelName || 'unknown-model',
    channelId: record.channelId ?? 'unknown',
    channelName,
    channelType: cpa ? 'experiment' : 'production',
  }
}

export function createNewApiOverview(period: Period, reader: Pick<NewApiDatabaseReader, 'listLogs'>, now = new Date(), newApi: NewApiStatus = { state: 'ready', authConfigured: false, checkedAt: now.toISOString() }, scope: DataScope = { mode: 'global' }): OverviewResponse {
  const records = reader.listLogs().map(newApiOverviewRecord).filter((item) => isDepartmentVisible(scope, 'unassigned'))
  const todayKey = shanghaiDate(now)
  const yesterdayKey = shanghaiDate(new Date(now.getTime() - 86_400_000))
  const monthStart = `${todayKey.slice(0, 7)}-01`
  const today = records.filter((item) => shanghaiDate(item.occurredAt) === todayKey)
  const yesterday = records.filter((item) => shanghaiDate(item.occurredAt) === yesterdayKey)
  const month = records.filter((item) => shanghaiDate(item.occurredAt) >= monthStart)
  const todayTokens = sum(today, (item) => item.inputTokens + item.outputTokens)
  const yesterdayTokens = sum(yesterday, (item) => item.inputTokens + item.outputTokens)
  const todayLatency = today.map((item) => item.latencyMs)
  const yesterdayLatency = yesterday.map((item) => item.latencyMs)
  const dates = datesFor(period, now)
  const visibleDates = new Set(dates.map((item) => item.key))
  const visibleRecords = records.filter((item) => visibleDates.has(shanghaiDate(item.occurredAt)))
  const trend = dates.map(({ key, label }) => ({ date: label, requests: visibleRecords.filter((item) => shanghaiDate(item.occurredAt) === key).length }))

  const people = [...new Map(month.map((item) => [item.userId, item])).values()].map((person) => {
    const items = month.filter((item) => item.userId === person.userId)
    return {
      id: `person-${person.userId}`,
      name: person.userName,
      initials: person.userName.slice(0, 1) || '用',
      department: '未分配',
      purpose: items[0]?.model ?? '暂无调用',
      requests: items.length,
      tokens: sum(items, (item) => item.inputTokens + item.outputTokens),
      tone: tones[0],
    }
  }).filter((person) => person.requests > 0).sort((left, right) => right.requests - left.requests).slice(0, 5).map((person, index) => ({ ...person, tone: tones[index % tones.length] ?? 'coral' }))

  const channels = [...new Map(visibleRecords.map((item) => [item.channelId, item])).keys()].map((id) => {
    const items = visibleRecords.filter((item) => item.channelId === id)
    const successRate = rate(items)
    const type = items[0]?.channelType ?? 'production'
    return {
      id: `new-api-channel-${id}`,
      name: items[0]?.channelName ?? id,
      model: items[0]?.model ?? 'unknown-model',
      type,
      status: type === 'experiment' && successRate < 100 ? 'auth_required' as const : 'healthy' as const,
      latencyMs: rounded(percentile(items.map((item) => item.latencyMs), .95)),
      successRate,
      requests: items.length,
    }
  }).sort((left, right) => right.requests - left.requests)

  const currentP95 = rounded(percentile(todayLatency, .95))
  const previousP95 = rounded(percentile(yesterdayLatency, .95))
  return overviewResponseSchema.parse({
    meta: { source: 'new_api', simulated: false, generatedAt: now.toISOString(), timezone: 'Asia/Shanghai', period, notice: `核心指标、趋势、人员排行和渠道摘要来自 New API SQLite 网关日志；对话正文和审计记录仍由 AI OPS 本地库保存。${scopeNotice(scope)}` },
    service: { bff: 'healthy', newApi },
    metrics: {
      todayRequests: today.length,
      todayRequestDeltaPercent: percentageDelta(today.length, yesterday.length),
      inputTokens: sum(today, (item) => item.inputTokens),
      outputTokens: sum(today, (item) => item.outputTokens),
      tokenDeltaPercent: percentageDelta(todayTokens, yesterdayTokens),
      successRate: rate(today),
      successDeltaPercent: rate(today) - rate(yesterday),
      p95LatencyMs: currentP95,
      p95LatencyDeltaMs: currentP95 - previousP95,
      firstTokenLatencyMs: 0,
    },
    trend,
    people,
    channels,
    limits: { mode: 'soft', blocking: false },
  })
}
