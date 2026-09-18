import { z } from 'zod'
import type { NewApiStatus } from './new-api-status.js'
import { isAlertVisible, scopeNotice, type DataScope } from './data-scope.js'
import type { PlatformDatabase } from './platform-db.js'

const severitySchema = z.enum(['critical', 'warning', 'info'])
const statusSchema = z.enum(['open', 'acknowledged', 'closed'])
const sourceSchema = z.enum(['quota', 'traffic', 'error_rate', 'balance', 'credential', 'upstream'])
const environmentSchema = z.enum(['production', 'experiment'])
const channelSchema = z.enum(['none', 'wecom', 'dingtalk'])
const notificationStateSchema = z.enum(['not_configured', 'not_sent', 'sent', 'failed'])

export const alertsQuerySchema = z.object({
  search: z.string().trim().max(80).default(''),
  subjectId: z.string().trim().max(80).regex(/^[a-z0-9-]*$/).default(''),
  alertId: z.union([z.literal(''), z.string().regex(/^alert-[a-z0-9-]{1,80}$/)]).default(''),
  severity: z.union([z.literal('all'), severitySchema]).default('all'),
  status: z.union([z.literal('all'), statusSchema]).default('all'),
  source: z.union([z.literal('all'), sourceSchema]).default('all'),
  environment: z.union([z.literal('all'), environmentSchema]).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(50).default(10),
})

export const alertParamsSchema = z.object({ id: z.string().regex(/^alert-[a-z0-9-]+$/) })
export const alertRuleParamsSchema = z.object({ id: z.string().regex(/^rule-[a-z0-9-]+$/) })
const alertActionBodySchema = z.object({ reason: z.string().trim().min(8).max(200), acknowledgeSimulation: z.literal(true) })
export const alertAcknowledgeBodySchema = alertActionBodySchema.extend({ idempotencyKey: z.string().regex(/^alert-ack-[a-z0-9-]{8,96}$/) })
export const alertCloseBodySchema = alertActionBodySchema.extend({ idempotencyKey: z.string().regex(/^alert-close-[a-z0-9-]{8,96}$/) })
export const alertRuleUpdateBodySchema = z.object({
  severity: severitySchema,
  enabled: z.boolean(),
  condition: z.string().trim().min(1).max(120),
  window: z.string().trim().min(1).max(60),
  cooldownMinutes: z.coerce.number().int().min(0).max(1_440),
  reason: z.string().trim().min(8).max(200),
  acknowledgeSimulation: z.literal(true),
  idempotencyKey: z.string().regex(/^alert-rule-[a-z0-9-]{8,96}$/),
})

const subjectSchema = z.object({
  type: z.enum(['company', 'department', 'person', 'key', 'channel', 'upstream']),
  id: z.string(),
  name: z.string(),
})
const ruleRefSchema = z.object({ id: z.string(), name: z.string(), metric: z.string(), thresholdLabel: z.string() })
const notificationSchema = z.object({ state: notificationStateSchema, channel: channelSchema, sentAt: z.string().datetime().nullable() })

export const alertEventSchema = z.object({
  id: z.string(), title: z.string(), summary: z.string(), severity: severitySchema, status: statusSchema,
  environment: environmentSchema, source: sourceSchema, subject: subjectSchema, rule: ruleRefSchema,
  trigger: z.object({ valueLabel: z.string(), comparator: z.enum(['gte', 'gt', 'lte', 'eq']) }),
  firstOccurredAt: z.string().datetime(), lastOccurredAt: z.string().datetime(), occurrences: z.number().int().positive(),
  assignee: z.object({ id: z.string(), name: z.string() }).nullable(),
  acknowledgedAt: z.string().datetime().nullable(), closedAt: z.string().datetime().nullable(),
  notification: notificationSchema, silence: z.object({ active: z.boolean(), until: z.string().datetime().nullable() }),
  relatedRequestIds: z.array(z.string().regex(/^req-[a-z0-9-]+$/)),
})

const metaSchema = z.object({ source: z.literal('database'), simulated: z.literal(true), generatedAt: z.string().datetime(), notice: z.string() })
const notificationConfigSchema = z.object({
  configured: z.literal(false),
  channels: z.array(z.object({ type: z.enum(['wecom', 'dingtalk']), state: z.literal('not_configured') })),
  notice: z.string(),
})

export const alertSummaryResponseSchema = z.object({
  meta: metaSchema,
  summary: z.object({ open: z.number().int().nonnegative(), critical: z.number().int().nonnegative(), warning: z.number().int().nonnegative(), experiment: z.number().int().nonnegative(), acknowledged: z.number().int().nonnegative(), closed: z.number().int().nonnegative() }),
  notificationConfig: notificationConfigSchema,
})

export const alertsResponseSchema = z.object({
  meta: metaSchema,
  options: z.object({ sources: z.array(z.object({ id: sourceSchema, label: z.string() })) }),
  items: z.array(alertEventSchema),
  pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }),
})

export const alertRuleSchema = z.object({
  id: z.string(), name: z.string(), category: sourceSchema, severity: severitySchema, enabled: z.boolean(), environment: environmentSchema,
  scope: z.string(), condition: z.string(), window: z.string(), cooldownMinutes: z.number().int().nonnegative(),
  notification: z.object({ configured: z.literal(false), channel: channelSchema }),
  lastTriggeredAt: z.string().datetime().nullable(), triggerCount7d: z.number().int().nonnegative(), description: z.string(),
})

export const alertRulesResponseSchema = z.object({ meta: metaSchema, items: z.array(alertRuleSchema), notificationConfig: notificationConfigSchema })

export const alertDetailResponseSchema = z.object({
  meta: metaSchema,
  item: alertEventSchema,
  analysis: z.object({ cause: z.string(), impact: z.string(), recommendation: z.string(), rawUpstreamBodyAvailable: z.literal(false) }),
  timeline: z.array(z.object({ id: z.string(), type: z.enum(['detected', 'notification', 'acknowledged', 'closed']), occurredAt: z.string().datetime(), title: z.string(), description: z.string() })),
})

export const alertActionResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), completedAt: z.string().datetime(), notice: z.string() }),
  item: alertEventSchema,
  operation: z.object({ action: z.enum(['acknowledge', 'close']), idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})
export const alertRuleUpdateResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), completedAt: z.string().datetime(), notice: z.string() }),
  rule: alertRuleSchema,
  operation: z.object({ action: z.literal('update'), idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})

export type AlertsQuery = z.infer<typeof alertsQuerySchema>
export type AlertEvent = z.infer<typeof alertEventSchema>
export type AlertRule = z.infer<typeof alertRuleSchema>
export type AlertAcknowledgeBody = z.infer<typeof alertAcknowledgeBodySchema>
export type AlertCloseBody = z.infer<typeof alertCloseBodySchema>
export type AlertActionResponse = z.infer<typeof alertActionResponseSchema>
export type AlertRuleUpdateBody = z.infer<typeof alertRuleUpdateBodySchema>
export type AlertRuleUpdateResponse = z.infer<typeof alertRuleUpdateResponseSchema>

const notificationConfig = {
  configured: false as const,
  channels: [{ type: 'wecom' as const, state: 'not_configured' as const }, { type: 'dingtalk' as const, state: 'not_configured' as const }],
  notice: '企业微信与钉钉通知尚未配置；当前页面只读取本地模拟告警，不会向外发送消息。',
}

function noticeFor(newApi: NewApiStatus) {
  if (newApi.state === 'ready') return '当前读取 SQLite 可重复模拟告警；New API 管理连接已验证，真实事件采集与通知仍未接入'
  if (newApi.state === 'reachable') return '当前读取 SQLite 可重复模拟告警；New API 可达但等待管理认证'
  if (newApi.state === 'auth_required') return '当前读取 SQLite 可重复模拟告警；New API 管理认证未通过'
  return '当前读取 SQLite 可重复模拟告警；New API 当前离线'
}

function meta(newApi: NewApiStatus, now: Date, scope: DataScope) { return { source: 'database' as const, simulated: true as const, generatedAt: now.toISOString(), notice: `${noticeFor(newApi)}${scopeNotice(scope)}` } }

function databaseEvents(database: PlatformDatabase, scope: DataScope): AlertEvent[] {
  return database.listAlertEvents().filter((item) => isAlertVisible(database, scope, { type: item.subjectType, id: item.subjectId })).map((item) => ({
    id: item.id, title: item.title, summary: item.summary, severity: item.severity, status: item.status,
    environment: item.environment, source: item.source,
    subject: { type: item.subjectType, id: item.subjectId, name: item.subjectName },
    rule: { id: item.ruleId, name: item.ruleName, metric: item.ruleMetric, thresholdLabel: item.thresholdLabel },
    trigger: { valueLabel: item.triggerValueLabel, comparator: item.triggerComparator },
    firstOccurredAt: item.firstOccurredAt, lastOccurredAt: item.lastOccurredAt, occurrences: item.occurrences,
    assignee: item.assigneeUserId && item.assigneeName ? { id: item.assigneeUserId, name: item.assigneeName } : null,
    acknowledgedAt: item.acknowledgedAt, closedAt: item.closedAt,
    notification: { state: item.notificationState, channel: item.notificationChannel, sentAt: item.notificationSentAt },
    silence: { active: Boolean(item.silenceActive), until: item.silenceUntil }, relatedRequestIds: item.relatedRequestIds,
  }))
}

function databaseRules(database: PlatformDatabase): AlertRule[] {
  return database.listAlertRules().map((item) => ({
    id: item.id, name: item.name, category: item.category, severity: item.severity, enabled: Boolean(item.enabled),
    environment: item.environment, scope: item.scope, condition: item.condition, window: item.window,
    cooldownMinutes: item.cooldownMinutes, notification: { configured: false, channel: item.notificationChannel },
    lastTriggeredAt: item.lastTriggeredAt, triggerCount7d: item.triggerCount7d, description: item.description,
  }))
}

export function createDatabaseAlertSummary(database: PlatformDatabase, newApi: NewApiStatus, now = new Date(), scope: DataScope = { mode: 'global' }) {
  const events = databaseEvents(database, scope)
  return { meta: meta(newApi, now, scope), summary: { open: events.filter((item) => item.status === 'open').length, critical: events.filter((item) => item.status === 'open' && item.severity === 'critical').length, warning: events.filter((item) => item.status === 'open' && item.severity === 'warning').length, experiment: events.filter((item) => item.status !== 'closed' && item.environment === 'experiment').length, acknowledged: events.filter((item) => item.status === 'acknowledged').length, closed: events.filter((item) => item.status === 'closed').length }, notificationConfig }
}

export function createDatabaseAlerts(database: PlatformDatabase, query: AlertsQuery, newApi: NewApiStatus, now = new Date(), scope: DataScope = { mode: 'global' }) {
  const events = databaseEvents(database, scope)
  const search = query.search.toLocaleLowerCase('zh-CN')
  const subjectId = query.subjectId
  const alertId = query.alertId
  const filtered = events.filter((item) => {
    const matchesSearch = !search || [item.id, item.title, item.summary, item.subject.name, item.rule.name].some((value) => value.toLocaleLowerCase('zh-CN').includes(search))
    const matchesSubject = !subjectId || item.subject.id === subjectId
    const matchesAlert = !alertId || item.id === alertId
    return matchesSearch && matchesSubject && matchesAlert && (query.severity === 'all' || item.severity === query.severity) && (query.status === 'all' || item.status === query.status) && (query.source === 'all' || item.source === query.source) && (query.environment === 'all' || item.environment === query.environment)
  })
  const start = (query.page - 1) * query.pageSize
  return { meta: meta(newApi, now, scope), options: { sources: [{ id: 'quota' as const, label: '额度' }, { id: 'traffic' as const, label: '流量' }, { id: 'error_rate' as const, label: '错误率' }, { id: 'balance' as const, label: '余额' }, { id: 'credential' as const, label: '凭证' }, { id: 'upstream' as const, label: '上游' }] }, items: filtered.slice(start, start + query.pageSize), pagination: { page: query.page, pageSize: query.pageSize, total: filtered.length, totalPages: Math.ceil(filtered.length / query.pageSize) } }
}

export function createDatabaseAlertRules(database: PlatformDatabase, newApi: NewApiStatus, now = new Date(), scope: DataScope = { mode: 'global' }) { return { meta: meta(newApi, now, scope), items: scope.mode === 'global' ? databaseRules(database) : [], notificationConfig } }

export function createDatabaseAlertDetail(database: PlatformDatabase, id: string, newApi: NewApiStatus, now = new Date(), scope: DataScope = { mode: 'global' }) {
  const item = databaseEvents(database, scope).find((event) => event.id === id)
  if (!item) return null
  const timeline: z.infer<typeof alertDetailResponseSchema>['timeline'] = [
    { id: `${id}-detected`, type: 'detected' as const, occurredAt: item.firstOccurredAt, title: '检测到事件', description: `${item.rule.name}触发：${item.trigger.valueLabel}（阈值 ${item.rule.thresholdLabel}）。` },
    { id: `${id}-notification`, type: 'notification' as const, occurredAt: item.firstOccurredAt, title: '外部通知未发送', description: '企业微信与钉钉尚未配置，事件仅保留在站内。' },
  ]
  if (item.acknowledgedAt) timeline.push({ id: `${id}-ack`, type: 'acknowledged', occurredAt: item.acknowledgedAt, title: '事件已确认', description: `${item.assignee?.name ?? '管理员'}已接手处理。` })
  if (item.closedAt) timeline.push({ id: `${id}-closed`, type: 'closed', occurredAt: item.closedAt, title: '事件已关闭', description: '指标已恢复或演示事件完成处置。' })
  return { meta: meta(newApi, now, scope), item, analysis: { cause: item.summary, impact: item.environment === 'experiment' ? '影响限定在 CPA 实验组，不会跨组回退至生产路径。' : '可能影响对应生产范围；当前软额度告警不会阻断请求。', recommendation: item.source === 'balance' ? '核对供应商账单并安排充值，完成真实通知配置后再启用自动提醒。' : item.source === 'credential' ? '在凭证管理系统中续期并重新验证，不要在页面或日志中粘贴凭证。' : '可确认或关闭本地 SQLite 模拟事件并留下审计摘要；静默、外部通知和真实事件处置仍未开放。', rawUpstreamBodyAvailable: false as const }, timeline }
}
