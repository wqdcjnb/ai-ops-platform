import { z } from 'zod'
import { SYSTEM_AUDIT_RETENTION_DAYS, type AuditChainVerification, type PlatformDatabase } from './platform-db.js'

const periodSchema = z.enum(['today', '7d', '30d'])
const actionSchema = z.enum(['login', 'logout', 'access', 'create', 'update', 'disable', 'enable', 'delete', 'rotate', 'reset', 'export', 'acknowledge', 'verify', 'view', 'sync', 'restart', 'draft', 'publish', 'rollback'])
const resourceTypeSchema = z.enum(['session', 'authorization', 'gateway_request', 'person', 'people', 'key', 'upstream', 'export', 'conversation', 'service'])
const resultStatusSchema = z.enum(['success', 'failed', 'denied'])
const sourceTypeSchema = z.enum(['web', 'api', 'system'])
const sourceSystemSchema = z.literal('ai_ops')

export const auditQuerySchema = z.object({
  period: periodSchema.default('7d'),
  search: z.string().trim().max(80).default(''),
  eventId: z.union([z.literal(''), z.string().regex(/^audit-[a-z0-9-]{1,80}$/)]).default(''),
  actor: z.string().trim().max(80).default('all'),
  action: z.union([z.literal('all'), actionSchema]).default('all'),
  resource: z.union([z.literal('all'), resourceTypeSchema]).default('all'),
  result: z.union([z.literal('all'), resultStatusSchema]).default('all'),
  source: z.union([z.literal('all'), sourceTypeSchema]).default('all'),
  sourceSystem: z.union([z.literal('all'), sourceSystemSchema]).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(50).default(10),
})

export const auditExportQuerySchema = auditQuerySchema.extend({
  pageSize: z.coerce.number().int().min(5).max(500).default(500),
})
export const auditParamsSchema = z.object({ id: z.string().regex(/^audit-[a-z0-9-]+$/) })

const changeSchema = z.object({
  field: z.string(),
  label: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
  sensitive: z.boolean(),
})

export const auditEventSchema = z.object({
  id: z.string(),
  occurredAt: z.string().datetime(),
  actor: z.object({ id: z.string(), name: z.string(), role: z.enum(['super_admin', 'admin', 'department_lead', 'finance', 'employee', 'system']) }),
  action: actionSchema,
  actionLabel: z.string(),
  resource: z.object({ type: resourceTypeSchema, id: z.string(), name: z.string() }),
  result: z.object({ status: resultStatusSchema, code: z.string() }),
  source: z.object({ type: sourceTypeSchema, label: z.string(), ipMasked: z.string().nullable(), client: z.string() }),
  requestId: z.string().regex(/^req-[a-z0-9-]+$/),
  summary: z.string(),
  changes: z.array(changeSchema),
  sourceSystem: sourceSystemSchema.optional(),
  key: z.object({ id: z.string(), masked: z.string(), owner: z.string().nullable().optional() }).optional(),
  transport: z.object({ responseCode: z.number().int().min(100).max(599), durationMs: z.number().int().nonnegative(), traceId: z.string().nullable().optional() }).optional(),
  contentAvailable: z.literal(false),
  credentialValueAvailable: z.literal(false),
})

export type AuditQuery = z.infer<typeof auditQuerySchema>
export type AuditEvent = z.infer<typeof auditEventSchema>

const actionLabels: Record<z.infer<typeof actionSchema>, string> = {
  login: '登录',
  logout: '退出登录',
  access: '权限访问',
  create: '创建',
  update: '更新',
  disable: '停用',
  enable: '启用',
  delete: '删除',
  rotate: '轮换',
  reset: '重置',
  export: '导出',
  acknowledge: '确认',
  verify: '健康检查',
  view: '查看',
  sync: '同步模型',
  restart: '重启',
  draft: '保存草稿',
  publish: '发布',
  rollback: '回滚',
}

const resourceLabels: Record<z.infer<typeof resourceTypeSchema>, string> = {
  session: '管理会话',
  authorization: '权限校验',
  gateway_request: '网关请求',
  person: '人员',
  people: '人员目录',
  key: '平台 Key',
  upstream: '第三方账号',
  export: '导出',
  conversation: '对话审计',
  service: '服务',
}

const validActions = new Set(Object.keys(actionLabels))
const validResources = new Set(Object.keys(resourceLabels))

function normalizeAction(value: string): z.infer<typeof actionSchema> {
  return validActions.has(value) ? value as z.infer<typeof actionSchema> : 'update'
}

function normalizeResource(value: string): z.infer<typeof resourceTypeSchema> {
  if (value === 'docker-service') return 'service'
  return validResources.has(value) ? value as z.infer<typeof resourceTypeSchema> : 'service'
}

function safeText(value: unknown, max = 240) {
  if (typeof value !== 'string') return ''
  return value.replace(/(?:bearer\s+\S+|sk-[a-z0-9_-]{8,})/giu, '[已脱敏]').replace(/[\r\n\t]+/gu, ' ').trim().slice(0, max)
}

function safeChanges(value: unknown) {
  const parsed = z.array(changeSchema).max(8).safeParse(value)
  return parsed.success ? parsed.data.map((item) => ({
    ...item,
    before: item.before ? safeText(item.before, 100) : null,
    after: item.after ? safeText(item.after, 100) : null,
  })) : []
}

type DatabaseAuditRow = ReturnType<PlatformDatabase['listAuditEvents']>[number]

function eventFromDatabase(row: DatabaseAuditRow): AuditEvent {
  const summary = row.summary
  const action = normalizeAction(row.action)
  const resourceType = normalizeResource(row.resourceType)
  const systemActor = !row.actorUserId
  const actorRole = systemActor ? 'system' as const : row.actorRole ?? 'employee'
  const requestId = row.requestId && /^req-[a-z0-9-]+$/u.test(row.requestId)
    ? row.requestId
    : 'req-' + row.id.replace(/^audit-/u, '').replace(/[^a-z0-9-]/giu, '-').toLocaleLowerCase('en-US')
  const code = safeText(summary.code, 64) || 'AUDIT_RECORDED'
  const resourceName = safeText(summary.resourceName, 100) || resourceLabels[resourceType]
  const result = row.result
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    actor: {
      id: row.actorUserId ?? 'system',
      name: row.actorName ?? '平台任务',
      role: actorRole,
    },
    action,
    actionLabel: actionLabels[action],
    resource: { type: resourceType, id: row.resourceId ?? resourceType, name: resourceName },
    result: { status: result, code },
    source: {
      type: systemActor ? 'system' : 'api',
      label: systemActor ? 'AI OPS 平台任务' : 'AI OPS 管理接口',
      ipMasked: null,
      client: systemActor ? 'Background worker' : '管理控制台',
    },
    requestId,
    summary: safeText(summary.message, 240) || '已记录平台操作审计事件。',
    changes: safeChanges(summary.changes),
    sourceSystem: 'ai_ops',
    contentAvailable: false,
    credentialValueAvailable: false,
  }
}

function integrity(chain: AuditChainVerification) {
  return {
    deletionAllowed: false as const,
    appendOnlyVerified: false as const,
    verified: chain.verified,
    hashChainVerified: chain.hashChainVerified,
    checkpointVerified: chain.checkpointVerified,
    algorithm: chain.algorithm,
    checkedAt: chain.checkedAt,
    checkpointUpdatedAt: chain.checkpointUpdatedAt,
    eventCount: chain.eventCount,
    firstInvalidEventId: chain.firstInvalidEventId,
    notice: chain.verified
      ? '本地 SQLite 审计哈希链与检查点校验通过。'
      : '本地 SQLite 审计哈希链或检查点尚未通过校验。',
  }
}

function cutoffFor(period: AuditQuery['period'], now: Date) {
  const duration = period === 'today' ? 86_400_000 : period === '7d' ? 604_800_000 : 2_592_000_000
  return now.getTime() - duration
}

function filterEvents(events: AuditEvent[], query: AuditQuery, now: Date) {
  const search = query.search.toLocaleLowerCase('zh-CN')
  return events.filter((event) => {
    const match = !search || [event.id, event.requestId, event.actor.name, event.resource.name, event.summary].some((value) => value.toLocaleLowerCase('zh-CN').includes(search))
    return new Date(event.occurredAt).getTime() >= cutoffFor(query.period, now)
      && match
      && (!query.eventId || event.id === query.eventId)
      && (query.actor === 'all' || event.actor.id === query.actor)
      && (query.action === 'all' || event.action === query.action)
      && (query.resource === 'all' || event.resource.type === query.resource)
      && (query.result === 'all' || event.result.status === query.result)
      && (query.source === 'all' || event.source.type === query.source)
      && (query.sourceSystem === 'all' || event.sourceSystem === query.sourceSystem)
  })
}

export function createDatabaseAudit(database: PlatformDatabase, query: AuditQuery, now = new Date()) {
  const all = database.listAuditEvents().map(eventFromDatabase)
  const filtered = filterEvents(all, query, now)
  const start = (query.page - 1) * query.pageSize
  return {
    meta: {
      source: 'database' as const,
      generatedAt: now.toISOString(),
      period: query.period,
      notice: '审计日志仅来自当前平台的员工、Key、第三方账号和统一模型网关操作。',
      sources: [{ id: 'ai_ops' as const, label: 'AI OPS 审计', state: 'ready' as const, count: all.length, notice: '统一模型网关与管理端操作' }],
    },
    summary: {
      total: filtered.length,
      success: filtered.filter((item) => item.result.status === 'success').length,
      failed: filtered.filter((item) => item.result.status === 'failed').length,
      denied: filtered.filter((item) => item.result.status === 'denied').length,
      sensitiveChanges: filtered.filter((item) => item.changes.some((change) => change.sensitive)).length,
    },
    options: { actors: [...new Map(all.map((item) => [item.actor.id, { id: item.actor.id, label: item.actor.name }])).values()] },
    items: filtered.slice(start, start + query.pageSize),
    pagination: { page: query.page, pageSize: query.pageSize, total: filtered.length, totalPages: Math.ceil(filtered.length / query.pageSize) },
    retention: {
      mode: 'database' as const,
      deletionAllowed: false as const,
      appendOnlyVerified: false as const,
      notice: `系统审计日志最多保留 ${SYSTEM_AUDIT_RETENTION_DAYS} 天；服务端启动后及每小时自动清理到期记录，并重建保留记录的本地哈希链。`,
    },
    integrity: integrity(database.verifyAuditChain(now)),
  }
}

export function createDatabaseAuditDetail(database: PlatformDatabase, id: string, now = new Date()) {
  const all = database.listAuditEvents().map(eventFromDatabase)
  const index = all.findIndex((item) => item.id === id)
  if (index < 0) return null
  const event = all[index]!
  return {
    meta: { source: 'database' as const, generatedAt: now.toISOString(), notice: '详情仅显示脱敏的字段级摘要，不包含完整 Key、凭据或对话正文。' },
    event,
    request: {
      requestId: event.requestId,
      traceState: 'database_unverified' as const,
      responseCode: event.result.status === 'success' ? 200 : event.result.status === 'denied' ? 403 : 503,
      durationMs: 0,
    },
    integrity: integrity(database.verifyAuditChain(now)),
    relatedAuditIds: index > 0 ? [all[index - 1]!.id] : [],
  }
}

function csvCell(value: string | number | null | undefined) {
  const text = value == null ? '' : String(value)
  return /[",\r\n]/u.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text
}

export function createAuditCsv(events: AuditEvent[]) {
  const header = ['event_id', 'occurred_at', 'actor', 'action', 'resource_type', 'resource_name', 'result', 'result_code', 'request_id', 'summary', 'changed_fields']
  const rows = events.map((event) => [
    event.id,
    event.occurredAt,
    event.actor.name,
    event.actionLabel,
    resourceLabels[event.resource.type],
    event.resource.name,
    event.result.status,
    event.result.code,
    event.requestId,
    event.summary,
    event.changes.map((change) => change.label + (change.sensitive ? '（敏感字段）' : '')).join('、'),
  ])
  return '\uFEFF' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
