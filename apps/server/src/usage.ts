import { z } from 'zod'
import { isDepartmentVisible, type DataScope } from './data-scope.js'
import type { PlatformDatabase } from './platform-db.js'

const optionSchema = z.object({ id: z.string(), label: z.string() })
const costTypeSchema = z.literal('platform_estimate')

export const usageQuerySchema = z.object({
  period: z.enum(['today', '7d', '30d']).default('7d'),
  search: z.string().trim().max(80).default(''),
  person: z.string().trim().max(80).default('all'),
  department: z.string().trim().max(80).default('all'),
  purpose: z.string().trim().max(80).default('all'),
  key: z.string().trim().max(160).default('all'),
  model: z.string().trim().max(160).default('all'),
  channel: z.string().trim().max(160).default('all'),
  status: z.enum(['all', 'succeeded', 'failed', 'cancelled']).default('all'),
  costType: z.union([z.literal('all'), costTypeSchema]).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(50).default(10),
})

export const usageRequestParamsSchema = z.object({
  requestId: z.string().regex(/^req-[a-z0-9-]+$/),
})

export const usageItemSchema = z.object({
  requestId: z.string(),
  occurredAt: z.string().datetime(),
  person: z.object({ id: z.string(), name: z.string(), department: z.object({ id: z.string(), name: z.string() }) }),
  key: z.object({ id: z.string(), masked: z.string() }),
  purpose: z.object({ id: z.string(), name: z.string(), alias: z.string() }),
  model: z.object({ id: z.string(), displayName: z.string(), actualModel: z.string() }),
  channel: z.object({ id: z.string(), name: z.string(), type: z.literal('official_api') }),
  protocol: z.enum(['chat_completions', 'responses']),
  streamed: z.boolean(),
  tokens: z.object({ input: z.number().int().nonnegative(), output: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
  points: z.number().nonnegative(),
  latency: z.object({
    firstTokenMs: z.number().int().nonnegative().nullable(),
    totalMs: z.number().int().nonnegative(),
    aiOpsAuthMs: z.number().int().nonnegative(),
    contextCompactionMs: z.number().int().nonnegative(),
    upstreamFirstTokenMs: z.number().int().nonnegative().nullable(),
    upstreamTotalMs: z.number().int().nonnegative(),
  }),
  context: z.object({
    originalChars: z.number().int().nonnegative(),
    forwardedChars: z.number().int().nonnegative(),
    droppedMessages: z.number().int().nonnegative(),
    strippedChars: z.number().int().nonnegative(),
  }),
  cost: z.object({ type: costTypeSchema, amountUsd: z.number().nonnegative(), label: z.string() }),
  status: z.enum(['succeeded', 'failed', 'cancelled']),
  error: z.object({ category: z.enum(['rate_limit', 'timeout', 'authentication', 'server', 'cancelled']), summary: z.string() }).nullable(),
  conversationContentAvailable: z.literal(false),
})

export const usageResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), simulated: z.boolean(), generatedAt: z.string().datetime(), period: z.enum(['today', '7d', '30d']), notice: z.string() }),
  summary: z.object({
    requests: z.number().int().nonnegative(),
    tokens: z.number().int().nonnegative(),
    points: z.number().nonnegative(),
    successRate: z.number().min(0).max(100),
    p95LatencyMs: z.number().int().nonnegative(),
    costs: z.object({ platformEstimateUsd: z.number().nonnegative() }),
  }),
  options: z.object({ people: z.array(optionSchema), departments: z.array(optionSchema), purposes: z.array(optionSchema), keys: z.array(optionSchema), models: z.array(optionSchema), channels: z.array(optionSchema) }),
  items: z.array(usageItemSchema),
  pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }),
})

export const usageDetailResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), simulated: z.boolean(), generatedAt: z.string().datetime(), notice: z.string() }),
  item: usageItemSchema,
  route: z.object({ alias: z.string(), retryCount: z.number().int().nonnegative(), requestIdPropagated: z.boolean() }),
  client: z.object({ name: z.enum(['Codex Desktop', 'WorkBuddy']), mode: z.enum(['stream', 'non_stream']) }),
  content: z.object({ stored: z.literal(false), reason: z.string() }),
  conversationAudit: z.object({
    accessible: z.boolean(),
    recordId: z.string().nullable(),
    href: z.string().nullable(),
    source: z.enum(['gateway_capture', 'unavailable', 'not_authorized']),
    notice: z.string(),
  }),
})

export type UsageQuery = z.infer<typeof usageQuerySchema>
export type UsageResponse = z.infer<typeof usageResponseSchema>
export type UsageDetailResponse = z.infer<typeof usageDetailResponseSchema>
type UsageItem = z.infer<typeof usageItemSchema>
type UsageRecord = ReturnType<PlatformDatabase['listUsageRequests']>[number]

const costLabels = { platform_estimate: '平台估算' } as const

function toItem(record: UsageRecord): UsageItem {
  return {
    requestId: record.requestId,
    occurredAt: record.occurredAt,
    person: { id: record.personId, name: record.personName, department: { id: record.departmentId ?? 'unassigned', name: record.departmentName ?? '未分配' } },
    key: { id: record.keyId, masked: record.maskedValue },
    purpose: { id: record.purposeId, name: record.purposeName, alias: record.purposeAlias },
    model: { id: record.modelId, displayName: record.modelDisplayName, actualModel: record.actualModel },
    channel: { id: record.channelId, name: record.channelName, type: 'official_api' },
    protocol: record.protocol,
    streamed: Boolean(record.streamed),
    tokens: { input: record.inputTokens, output: record.outputTokens, total: record.inputTokens + record.outputTokens },
    points: record.points,
    latency: {
      firstTokenMs: record.firstTokenMs,
      totalMs: record.totalLatencyMs,
      aiOpsAuthMs: record.aiOpsAuthMs,
      contextCompactionMs: record.contextCompactionMs,
      upstreamFirstTokenMs: record.upstreamFirstTokenMs,
      upstreamTotalMs: record.upstreamTotalMs,
    },
    context: {
      originalChars: record.contextOriginalChars,
      forwardedChars: record.contextForwardedChars,
      droppedMessages: record.contextDroppedMessages,
      strippedChars: record.contextStrippedChars,
    },
    // The final gateway records one platform-level estimate. Historic rows
    // are normalized at read time so they cannot recreate retired cost views.
    cost: { type: 'platform_estimate', amountUsd: record.costAmountUsd, label: costLabels.platform_estimate },
    status: record.status,
    error: record.errorCategory && record.errorSummary ? { category: record.errorCategory, summary: record.errorSummary } : null,
    conversationContentAvailable: false,
  }
}

function periodMs(period: UsageQuery['period']) {
  return period === 'today' ? 86_400_000 : period === '7d' ? 604_800_000 : 2_592_000_000
}

function optionsFor(items: UsageItem[]) {
  const unique = <T extends { id: string }>(records: T[], label: (item: T) => string) => [...new Map(records.map((item) => [item.id, { id: item.id, label: label(item) }])).values()]
  return {
    people: unique(items.map((item) => item.person), (item) => item.name),
    departments: unique(items.map((item) => item.person.department), (item) => item.name),
    purposes: unique(items.map((item) => item.purpose), (item) => item.name),
    keys: unique(items.map((item) => item.key), (item) => item.masked),
    models: unique(items.map((item) => item.model), (item) => item.displayName),
    channels: unique(items.map((item) => item.channel), (item) => item.name),
  }
}

export function createDatabaseUsage(database: PlatformDatabase, query: UsageQuery, now = new Date(), scope: DataScope = { mode: 'global' }): UsageResponse {
  const all = database.listUsageRequests().map(toItem).filter((item) => isDepartmentVisible(scope, item.person.department.id))
  const cutoff = now.getTime() - periodMs(query.period)
  const search = query.search.toLocaleLowerCase('zh-CN')
  const filtered = all.filter((item) => {
    const matchesSearch = !search || [item.requestId, item.person.name, item.key.masked, item.model.actualModel].some((value) => value.toLocaleLowerCase('zh-CN').includes(search))
    return new Date(item.occurredAt).getTime() >= cutoff
      && matchesSearch
      && (query.person === 'all' || item.person.id === query.person)
      && (query.department === 'all' || item.person.department.id === query.department)
      && (query.purpose === 'all' || item.purpose.id === query.purpose)
      && (query.key === 'all' || item.key.id === query.key)
      && (query.model === 'all' || item.model.id === query.model)
      && (query.channel === 'all' || item.channel.id === query.channel)
      && (query.status === 'all' || item.status === query.status)
      && (query.costType === 'all' || item.cost.type === query.costType)
  })
  const latency = filtered.map((item) => item.latency.totalMs).sort((left, right) => left - right)
  const p95LatencyMs = latency.length ? latency[Math.min(latency.length - 1, Math.ceil(latency.length * 0.95) - 1)]! : 0
  const costFor = (type: UsageItem['cost']['type']) => Number(filtered.filter((item) => item.cost.type === type).reduce((sum, item) => sum + item.cost.amountUsd, 0).toFixed(5))
  const start = (query.page - 1) * query.pageSize
  return {
    meta: {
      source: 'database',
      simulated: false,
      generatedAt: now.toISOString(),
      period: query.period,
      notice: '当前读取统一模型网关的脱敏调用元数据；不保存完整 Key 或对话正文。',
    },
    summary: {
      requests: filtered.length,
      tokens: filtered.reduce((sum, item) => sum + item.tokens.total, 0),
      points: Number(filtered.reduce((sum, item) => sum + item.points, 0).toFixed(1)),
      successRate: filtered.length ? Number((filtered.filter((item) => item.status === 'succeeded').length * 100 / filtered.length).toFixed(1)) : 0,
      p95LatencyMs,
      costs: {
        platformEstimateUsd: costFor('platform_estimate'),
      },
    },
    options: optionsFor(all),
    items: filtered.slice(start, start + query.pageSize),
    pagination: { page: query.page, pageSize: query.pageSize, total: filtered.length, totalPages: Math.ceil(filtered.length / query.pageSize) },
  }
}

export function createDatabaseUsageDetail(
  database: PlatformDatabase,
  requestId: string,
  now = new Date(),
  scope: DataScope = { mode: 'global' },
  canAccessConversationAudit = false,
): UsageDetailResponse | null {
  const record = database.listUsageRequests().find((item) => item.requestId === requestId)
  if (!record || !isDepartmentVisible(scope, record.departmentId)) return null
  const link = canAccessConversationAudit ? database.getUsageConversationLink(record.requestId) : null
  return {
    meta: { source: 'database', simulated: false, generatedAt: now.toISOString(), notice: '当前读取统一模型网关的脱敏调用元数据。' },
    item: toItem(record),
    route: { alias: record.routeAlias, retryCount: record.retryCount, requestIdPropagated: Boolean(record.requestIdPropagated) },
    client: { name: record.clientName, mode: record.clientMode },
    content: { stored: false, reason: '调用日志不保存认证 Header、完整 Key 或完整对话正文。' },
    conversationAudit: link
      ? { accessible: true, recordId: link.recordId, href: '/conversation-audit?recordId=' + encodeURIComponent(link.recordId), source: link.linkSource, notice: '已关联同一请求的对话审计记录。' }
      : {
          accessible: false,
          recordId: null,
          href: null,
          source: canAccessConversationAudit ? 'unavailable' : 'not_authorized',
          notice: canAccessConversationAudit ? '该调用尚未关联对话审计记录。' : '当前身份没有对话审计权限。',
        },
  }
}
