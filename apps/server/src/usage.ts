import { z } from 'zod'
import type { NewApiStatus } from './new-api-status.js'
import type { NewApiDatabaseReader, NewApiLogRecord } from './new-api-database.js'
import { isDepartmentVisible, scopeNotice, type DataScope } from './data-scope.js'
import type { PlatformDatabase } from './platform-db.js'

const optionSchema = z.object({ id: z.string(), label: z.string() })
const costTypeSchema = z.enum(['official_actual', 'platform_estimate', 'cpa_estimate'])
const metadataSourceSchema = z.enum(['database', 'new_api'])

export const usageQuerySchema = z.object({
  period: z.enum(['today', '7d', '30d']).default('7d'),
  search: z.string().trim().max(80).default(''),
  person: z.string().trim().max(40).default('all'),
  department: z.string().trim().max(40).default('all'),
  purpose: z.string().trim().max(40).default('all'),
  key: z.string().trim().max(40).default('all'),
  model: z.string().trim().max(40).default('all'),
  channel: z.string().trim().max(60).default('all'),
  status: z.enum(['all', 'succeeded', 'failed', 'cancelled']).default('all'),
  costType: z.union([z.literal('all'), costTypeSchema]).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(50).default(10),
})

export const usageRequestParamsSchema = z.object({ requestId: z.string().regex(/^req-[a-z0-9-]+$/) })

export const usageItemSchema = z.object({
  requestId: z.string(),
  occurredAt: z.string().datetime(),
  person: z.object({ id: z.string(), name: z.string(), department: z.object({ id: z.string(), name: z.string() }) }),
  key: z.object({ id: z.string(), masked: z.string() }),
  purpose: z.object({ id: z.string(), name: z.string(), alias: z.string() }),
  model: z.object({ id: z.string(), displayName: z.string(), actualModel: z.string() }),
  channel: z.object({ id: z.string(), name: z.string(), type: z.enum(['official_api', 'cpa_oauth']) }),
  protocol: z.enum(['chat_completions', 'responses']),
  streamed: z.boolean(),
  tokens: z.object({ input: z.number().int().nonnegative(), output: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
  points: z.number().nonnegative(),
  latency: z.object({ firstTokenMs: z.number().int().nonnegative().nullable(), totalMs: z.number().int().nonnegative() }),
  cost: z.object({ type: costTypeSchema, amountUsd: z.number().nonnegative(), label: z.string() }),
  status: z.enum(['succeeded', 'failed', 'cancelled']),
  error: z.object({ category: z.enum(['rate_limit', 'timeout', 'authentication', 'server', 'cancelled']), summary: z.string() }).nullable(),
  conversationContentAvailable: z.literal(false),
})

const metaSchema = z.object({ source: metadataSourceSchema, simulated: z.boolean(), generatedAt: z.string().datetime(), notice: z.string() })

export const usageResponseSchema = z.object({
  meta: metaSchema.extend({ period: z.enum(['today', '7d', '30d']) }),
  summary: z.object({ requests: z.number().int().nonnegative(), tokens: z.number().int().nonnegative(), points: z.number().nonnegative(), successRate: z.number().min(0).max(100), p95LatencyMs: z.number().int().nonnegative(), costs: z.object({ officialActualUsd: z.number().nonnegative(), platformEstimateUsd: z.number().nonnegative(), cpaEstimateUsd: z.number().nonnegative() }) }),
  options: z.object({ people: z.array(optionSchema), departments: z.array(optionSchema), purposes: z.array(optionSchema), keys: z.array(optionSchema), models: z.array(optionSchema), channels: z.array(optionSchema) }),
  items: z.array(usageItemSchema),
  pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }),
})

export const usageDetailResponseSchema = z.object({
  meta: metaSchema,
  item: usageItemSchema,
  route: z.object({ alias: z.string(), retryCount: z.number().int().nonnegative(), requestIdPropagated: z.boolean() }),
  client: z.object({ name: z.enum(['Codex Desktop', 'WorkBuddy']), mode: z.enum(['stream', 'non_stream']) }),
  content: z.object({ stored: z.literal(false), reason: z.string() }),
  conversationAudit: z.object({
    accessible: z.boolean(),
    recordId: z.string().nullable(),
    href: z.string().nullable(),
    source: z.enum(['synthetic_seed', 'unavailable', 'not_authorized']),
    notice: z.string(),
  }),
})

export type UsageQuery = z.infer<typeof usageQuerySchema>
export type UsageResponse = z.infer<typeof usageResponseSchema>
export type UsageDetailResponse = z.infer<typeof usageDetailResponseSchema>
type UsageItem = z.infer<typeof usageItemSchema>
type UsageRecord = ReturnType<PlatformDatabase['listUsageRequests']>[number]

export type NewApiUsageReader = Pick<NewApiDatabaseReader, 'listLogs'>

const costLabel = { official_actual: '官方实际', platform_estimate: '平台估算', cpa_estimate: 'CPA 估算' } as const
const periodMinutes = (period: UsageQuery['period']) => period === 'today' ? 24 * 60 : period === '7d' ? 7 * 24 * 60 : 30 * 24 * 60
const round = (value: number, digits = 2) => Number(value.toFixed(digits))

function toItem(record: UsageRecord): UsageItem {
  return {
    requestId: record.requestId,
    occurredAt: record.occurredAt,
    person: { id: record.personId, name: record.personName, department: { id: record.departmentId ?? 'unassigned', name: record.departmentName ?? '未归类' } },
    key: { id: record.keyId, masked: record.maskedValue },
    purpose: { id: record.purposeId, name: record.purposeName, alias: record.purposeAlias },
    model: { id: record.modelId, displayName: record.modelDisplayName, actualModel: record.actualModel },
    channel: { id: record.channelId, name: record.channelName, type: record.channelType },
    protocol: record.protocol,
    streamed: Boolean(record.streamed),
    tokens: { input: record.inputTokens, output: record.outputTokens, total: record.inputTokens + record.outputTokens },
    points: record.points,
    latency: { firstTokenMs: record.firstTokenMs, totalMs: record.totalLatencyMs },
    cost: { type: record.costType, amountUsd: record.costAmountUsd, label: costLabel[record.costType] },
    status: record.status,
    error: record.errorCategory && record.errorSummary ? { category: record.errorCategory, summary: record.errorSummary } : null,
    conversationContentAvailable: false,
  }
}

function newApiItem(record: NewApiLogRecord): UsageItem {
  const model = record.modelName || 'unknown-model'
  const channelId = record.channelId ?? 'unknown'
  const channelName = record.channelName || `New API channel ${channelId}`
  const channelType = channelName.toLocaleLowerCase('en-US').includes('cpa') ? 'cpa_oauth' as const : 'official_api' as const
  const status = record.type === 2 ? 'succeeded' as const : 'failed' as const
  const personId = `person-${record.userId ?? 'unknown'}`
  const keyId = `key-new-api-${record.tokenId ?? 'unknown'}`
  const purposeName = record.tokenName || record.group || 'New API'
  const totalLatencyMs = Math.max(0, Math.round(record.useTime))
  return {
    requestId: record.requestId,
    occurredAt: record.occurredAt ?? new Date(0).toISOString(),
    person: { id: personId, name: record.username || 'New API 用户', department: { id: 'unassigned', name: '未分配' } },
    key: { id: keyId, masked: record.tokenName ? `New API Token · ${record.tokenName}` : 'New API Token' },
    purpose: { id: `purpose-${encodeURIComponent(purposeName)}`, name: purposeName, alias: purposeName },
    model: { id: `new-api-model-${encodeURIComponent(model)}`, displayName: model, actualModel: model },
    channel: { id: `new-api-channel-${channelId}`, name: channelName, type: channelType },
    protocol: 'chat_completions',
    streamed: record.streamed,
    tokens: { input: record.promptTokens, output: record.completionTokens, total: record.promptTokens + record.completionTokens },
    points: record.quota,
    latency: { firstTokenMs: null, totalMs: totalLatencyMs },
    cost: { type: channelType === 'cpa_oauth' ? 'cpa_estimate' : 'official_actual', amountUsd: 0, label: channelType === 'cpa_oauth' ? costLabel.cpa_estimate : costLabel.official_actual },
    status,
    error: status === 'failed' ? { category: 'server' as const, summary: `New API request type ${record.type ?? 'unknown'}` } : null,
    conversationContentAvailable: false,
  }
}

function noticeFor(newApi: NewApiStatus, simulated: boolean) {
  const connection = newApi.state === 'ready' ? 'New API 管理连接已验证' : newApi.state === 'reachable' ? 'New API 可达，管理认证待验证' : 'New API 当前不可用'
  return simulated
    ? `当前读取 SQLite 中可重复生成的模拟调用元数据；${connection}，真实网关调用会在数据库 Key 请求完成后追加。`
    : `当前读取 SQLite 中的网关调用元数据；${connection}，仅保留请求、Token、耗时、成本和状态，不保存对话正文。`
}

function optionsFor(all: UsageItem[]) {
  const option = <T extends { id: string }>(items: T[], label: (item: T) => string) => Array.from(new Map(items.map((item) => [item.id, { id: item.id, label: label(item) }])).values())
  return {
    people: option(all.map((item) => item.person), (item) => item.name),
    departments: option(all.map((item) => item.person.department), (item) => item.name),
    purposes: option(all.map((item) => item.purpose), (item) => item.name),
    keys: option(all.map((item) => item.key), (item) => item.masked),
    models: option(all.map((item) => item.model), (item) => item.displayName),
    channels: option(all.map((item) => item.channel), (item) => item.name),
  }
}

export function createDatabaseUsage(database: PlatformDatabase, query: UsageQuery, newApi: NewApiStatus, now = new Date(), scope: DataScope = { mode: 'global' }): UsageResponse {
  const all = database.listUsageRequests().map(toItem).filter((item) => isDepartmentVisible(scope, item.person.department.id))
  const simulated = all.every((item) => item.requestId.startsWith('req-demo-'))
  const cutoff = now.getTime() - periodMinutes(query.period) * 60_000
  const search = query.search.toLocaleLowerCase('zh-CN')
  const filtered = all.filter((item) => {
    const matchesSearch = !search || [item.requestId, item.key.masked, item.person.name, item.purpose.alias].some((value) => value.toLocaleLowerCase('zh-CN').includes(search))
    return new Date(item.occurredAt).getTime() >= cutoff && matchesSearch &&
      (query.person === 'all' || item.person.id === query.person) &&
      (query.department === 'all' || item.person.department.id === query.department) &&
      (query.purpose === 'all' || item.purpose.id === query.purpose) &&
      (query.key === 'all' || item.key.id === query.key) &&
      (query.model === 'all' || item.model.id === query.model) &&
      (query.channel === 'all' || item.channel.id === query.channel) &&
      (query.status === 'all' || item.status === query.status) &&
      (query.costType === 'all' || item.cost.type === query.costType)
  })
  const latency = filtered.map((item) => item.latency.totalMs).sort((a, b) => a - b)
  const p95 = latency.length ? latency[Math.min(latency.length - 1, Math.ceil(latency.length * .95) - 1)]! : 0
  const start = (query.page - 1) * query.pageSize
  const costs = (type: UsageItem['cost']['type']) => round(filtered.filter((item) => item.cost.type === type).reduce((sum, item) => sum + item.cost.amountUsd, 0), 5)
  return usageResponseSchema.parse({
    meta: { source: 'database', simulated, generatedAt: now.toISOString(), period: query.period, notice: `${noticeFor(newApi, simulated)}${scopeNotice(scope)}` },
    summary: {
      requests: filtered.length,
      tokens: filtered.reduce((sum, item) => sum + item.tokens.total, 0),
      points: round(filtered.reduce((sum, item) => sum + item.points, 0), 1),
      successRate: filtered.length ? round(filtered.filter((item) => item.status === 'succeeded').length / filtered.length * 100, 1) : 0,
      p95LatencyMs: p95,
      costs: { officialActualUsd: costs('official_actual'), platformEstimateUsd: costs('platform_estimate'), cpaEstimateUsd: costs('cpa_estimate') },
    },
    options: optionsFor(all),
    items: filtered.slice(start, start + query.pageSize),
    pagination: { page: query.page, pageSize: query.pageSize, total: filtered.length, totalPages: Math.ceil(filtered.length / query.pageSize) },
  })
}

export function createDatabaseUsageDetail(database: PlatformDatabase, requestId: string, newApi: NewApiStatus, now = new Date(), scope: DataScope = { mode: 'global' }, canAccessConversationAudit = false): UsageDetailResponse | null {
  const record = database.listUsageRequests().find((item) => item.requestId === requestId)
  if (!record || !isDepartmentVisible(scope, record.departmentId)) return null
  const simulated = record.requestId.startsWith('req-demo-')
  const conversationLink = canAccessConversationAudit ? database.getUsageConversationLink(record.requestId) : null
  const conversationAudit = !canAccessConversationAudit
    ? { accessible: false, recordId: null, href: null, source: 'not_authorized' as const, notice: '当前角色没有对话审计权限，因此不返回可能关联的对话审计记录。' }
    : conversationLink
      ? { accessible: true, recordId: conversationLink.recordId, href: `/conversation-audit?recordId=${encodeURIComponent(conversationLink.recordId)}`, source: conversationLink.linkSource, notice: '已关联 SQLite 中明确保存的合成对话审计映射；不代表真实网关链路。' }
      : { accessible: false, recordId: null, href: null, source: 'unavailable' as const, notice: '当前模拟调用未关联对话审计记录。' }
  return usageDetailResponseSchema.parse({
    meta: { source: 'database', simulated, generatedAt: now.toISOString(), notice: `${noticeFor(newApi, simulated)}${scopeNotice(scope)}` },
    item: toItem(record),
    route: { alias: record.routeAlias, retryCount: record.retryCount, requestIdPropagated: Boolean(record.requestIdPropagated) },
    client: { name: record.clientName, mode: record.clientMode },
    content: { stored: false, reason: '调用日志仅保存模拟的脱敏元数据；不保存认证 Header、完整 Key、请求正文或对话正文。' },
    conversationAudit,
  })
}

export function createNewApiUsage(reader: NewApiUsageReader, query: UsageQuery, now = new Date(), scope: DataScope = { mode: 'global' }): UsageResponse {
  const all = reader.listLogs().map(newApiItem).filter((item) => isDepartmentVisible(scope, item.person.department.id))
  const cutoff = now.getTime() - periodMinutes(query.period) * 60_000
  const search = query.search.toLocaleLowerCase('zh-CN')
  const filtered = all.filter((item) => {
    const matchesSearch = !search || [item.requestId, item.key.masked, item.person.name, item.purpose.alias, item.model.actualModel].some((value) => value.toLocaleLowerCase('zh-CN').includes(search))
    return new Date(item.occurredAt).getTime() >= cutoff && matchesSearch &&
      (query.person === 'all' || item.person.id === query.person) &&
      (query.department === 'all' || item.person.department.id === query.department) &&
      (query.purpose === 'all' || item.purpose.id === query.purpose) &&
      (query.key === 'all' || item.key.id === query.key) &&
      (query.model === 'all' || item.model.id === query.model) &&
      (query.channel === 'all' || item.channel.id === query.channel) &&
      (query.status === 'all' || item.status === query.status) &&
      (query.costType === 'all' || item.cost.type === query.costType)
  })
  const latency = filtered.map((item) => item.latency.totalMs).sort((a, b) => a - b)
  const p95 = latency.length ? latency[Math.min(latency.length - 1, Math.ceil(latency.length * .95) - 1)]! : 0
  const start = (query.page - 1) * query.pageSize
  const costs = (type: UsageItem['cost']['type']) => round(filtered.filter((item) => item.cost.type === type).reduce((sum, item) => sum + item.cost.amountUsd, 0), 5)
  return usageResponseSchema.parse({
    meta: { source: 'new_api', simulated: false, generatedAt: now.toISOString(), period: query.period, notice: `当前读取 New API SQLite 中的真实网关日志；不读取 AI OPS 本地用量镜像。${scopeNotice(scope)}` },
    summary: {
      requests: filtered.length,
      tokens: filtered.reduce((sum, item) => sum + item.tokens.total, 0),
      points: round(filtered.reduce((sum, item) => sum + item.points, 0), 1),
      successRate: filtered.length ? round(filtered.filter((item) => item.status === 'succeeded').length / filtered.length * 100, 1) : 0,
      p95LatencyMs: p95,
      costs: { officialActualUsd: costs('official_actual'), platformEstimateUsd: costs('platform_estimate'), cpaEstimateUsd: costs('cpa_estimate') },
    },
    options: optionsFor(all),
    items: filtered.slice(start, start + query.pageSize),
    pagination: { page: query.page, pageSize: query.pageSize, total: filtered.length, totalPages: Math.ceil(filtered.length / query.pageSize) },
  })
}

export function createNewApiUsageDetail(reader: NewApiUsageReader, database: PlatformDatabase, requestId: string, now = new Date(), canAccessConversationAudit = false): UsageDetailResponse | null {
  const record = reader.listLogs().find((item) => item.requestId === requestId)
  if (!record) return null
  const item = newApiItem(record)
  const conversationLink = canAccessConversationAudit ? database.getUsageConversationLink(requestId) : null
  const conversationAudit = !canAccessConversationAudit
    ? { accessible: false, recordId: null, href: null, source: 'not_authorized' as const, notice: '当前角色没有对话审计权限。' }
    : conversationLink
      ? { accessible: true, recordId: conversationLink.recordId, href: `/conversation-audit?recordId=${encodeURIComponent(conversationLink.recordId)}`, source: conversationLink.linkSource, notice: '对话审计映射仍保存在 AI OPS 本地审计库。' }
      : { accessible: false, recordId: null, href: null, source: 'unavailable' as const, notice: '当前 New API 日志没有关联的对话审计记录。' }
  return usageDetailResponseSchema.parse({
    meta: { source: 'new_api', simulated: false, generatedAt: now.toISOString(), notice: '当前读取 New API SQLite 中的真实网关日志；对话正文不保存。' },
    item,
    route: { alias: item.model.actualModel, retryCount: 0, requestIdPropagated: Boolean(record.upstreamRequestId) },
    client: { name: 'WorkBuddy', mode: item.streamed ? 'stream' : 'non_stream' },
    content: { stored: false, reason: 'New API 日志只提供脱敏用量字段，不返回请求 Header、完整 Key 或对话正文。' },
    conversationAudit,
  })
}
