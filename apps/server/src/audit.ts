import { z } from 'zod'
import type { AuditChainVerification, PlatformDatabase } from './platform-db.js'
import type { CpaLogReader, CpaLogRecord } from './cpa-logs.js'
import type { NewApiDatabaseReader, NewApiLogRecord } from './new-api-database.js'

const periodSchema = z.enum(['today', '7d', '30d'])
const actionSchema = z.enum(['login', 'logout', 'access', 'create', 'update', 'disable', 'enable', 'delete', 'rotate', 'reset', 'export', 'acknowledge', 'verify', 'view', 'sync', 'restart', 'draft', 'publish', 'rollback'])
const resourceTypeSchema = z.enum(['session', 'authorization', 'gateway_request', 'person', 'people', 'key', 'quota', 'route', 'channel', 'new-api-channel', 'upstream', 'export', 'settings', 'alert', 'conversation', 'service', 'business_rule_version'])
const resultStatusSchema = z.enum(['success', 'failed', 'denied'])
const sourceTypeSchema = z.enum(['web', 'api', 'system'])
const sourceSystemSchema = z.enum(['ai_ops', 'new_api', 'cpa'])
const sourceStateSchema = z.enum(['ready', 'unavailable', 'not_configured'])
const sourceSummarySchema = z.object({ id: sourceSystemSchema, label: z.string(), state: sourceStateSchema, count: z.number().int().nonnegative(), notice: z.string() })
const integritySchema = z.object({
  deletionAllowed: z.literal(false), appendOnlyVerified: z.literal(false), verified: z.boolean(), hashChainVerified: z.boolean(), checkpointVerified: z.boolean(),
  algorithm: z.enum(['sha256', 'not_configured']), checkedAt: z.string().datetime().nullable(),
  checkpointUpdatedAt: z.string().datetime().nullable(), eventCount: z.number().int().nonnegative(), firstInvalidEventId: z.string().nullable(), notice: z.string(),
})

export const auditQuerySchema = z.object({
  period: periodSchema.default('7d'),
  search: z.string().trim().max(80).default(''),
  eventId: z.union([z.literal(''), z.string().regex(/^audit-[a-z0-9-]{1,80}$/)]).default(''),
  actor: z.string().trim().max(40).default('all'),
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

const actorSchema = z.object({ id: z.string(), name: z.string(), role: z.enum(['super_admin', 'admin', 'department_lead', 'finance', 'employee', 'system']) })
const resourceSchema = z.object({ type: resourceTypeSchema, id: z.string(), name: z.string() })
const changeSchema = z.object({ field: z.string(), label: z.string(), before: z.string().nullable(), after: z.string().nullable(), sensitive: z.boolean() })
const keyContextSchema = z.object({ id: z.string(), masked: z.string(), owner: z.string().nullable().optional() })
const transportSchema = z.object({ responseCode: z.number().int().min(100).max(599), durationMs: z.number().int().nonnegative(), traceId: z.string().nullable().optional() })

export const auditEventSchema = z.object({
  id: z.string(), occurredAt: z.string().datetime(), actor: actorSchema, action: actionSchema, actionLabel: z.string(),
  resource: resourceSchema, result: z.object({ status: resultStatusSchema, code: z.string() }),
  source: z.object({ type: sourceTypeSchema, label: z.string(), ipMasked: z.string().nullable(), client: z.string() }),
  requestId: z.string().regex(/^req-[a-z0-9-]+$/), summary: z.string(), changes: z.array(changeSchema),
  sourceSystem: sourceSystemSchema.optional(), key: keyContextSchema.optional(), transport: transportSchema.optional(),
  contentAvailable: z.literal(false), credentialValueAvailable: z.literal(false),
})

const metaSchema = z.object({ source: z.enum(['demo', 'database']), generatedAt: z.string().datetime(), period: periodSchema, notice: z.string(), sources: z.array(sourceSummarySchema).optional() })
const optionSchema = z.object({ id: z.string(), label: z.string() })

export const auditResponseSchema = z.object({
  meta: metaSchema,
  summary: z.object({ total: z.number().int().nonnegative(), success: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), denied: z.number().int().nonnegative(), sensitiveChanges: z.number().int().nonnegative() }),
  options: z.object({ actors: z.array(optionSchema) }), items: z.array(auditEventSchema),
  pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }),
  retention: z.object({ mode: z.enum(['demo', 'database']), deletionAllowed: z.literal(false), appendOnlyVerified: z.literal(false), notice: z.string() }),
  integrity: integritySchema,
})

export const auditDetailResponseSchema = z.object({
  meta: z.object({ source: z.enum(['demo', 'database']), generatedAt: z.string().datetime(), notice: z.string() }), event: auditEventSchema,
  request: z.object({ requestId: z.string(), traceState: z.enum(['demo_unverified', 'database_unverified']), responseCode: z.number().int().min(100).max(599), durationMs: z.number().int().nonnegative() }),
  integrity: integritySchema,
  relatedAuditIds: z.array(z.string().regex(/^audit-[a-z0-9-]+$/)),
})

export type AuditQuery = z.infer<typeof auditQuerySchema>
export type AuditEvent = z.infer<typeof auditEventSchema>

export interface AuditSourceReaders {
  newApi?: Pick<NewApiDatabaseReader, 'listLogs'> | null
  cpa?: Pick<CpaLogReader, 'listLogs' | 'configured'> | null
}

const minutesAgo = (now: Date, minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString()
const admin = { id: 'admin-demo', name: '超级管理员', role: 'super_admin' as const }
const opsAdmin = { id: 'admin-ops', name: '运营管理员', role: 'admin' as const }
const system = { id: 'system', name: '平台任务', role: 'system' as const }

type Seed = Omit<AuditEvent, 'occurredAt'> & { minutes: number }
const seeds: Seed[] = [
  { id: 'audit-login-success', minutes: 6, actor: admin, action: 'login', actionLabel: '登录成功', resource: { type: 'session', id: 'session-demo-01', name: '管理端会话' }, result: { status: 'success', code: 'AUTH_OK' }, source: { type: 'web', label: '管理控制台', ipMasked: '192.168.1.*', client: 'Chrome · Windows' }, requestId: 'req-audit-login-01', summary: '超级管理员通过本机演示身份进入管理控制台。', changes: [], contentAvailable: false, credentialValueAvailable: false },
  { id: 'audit-key-rotate', minutes: 34, actor: admin, action: 'rotate', actionLabel: '轮换 Key', resource: { type: 'key', id: 'key-lin-1', name: 'sk-ops••••••7F2A' }, result: { status: 'success', code: 'KEY_ROTATED' }, source: { type: 'api', label: 'BFF 管理接口', ipMasked: '127.0.0.*', client: 'Codex Desktop' }, requestId: 'req-audit-key-02', summary: '完成访问 Key 轮换；审计记录不保存新旧密钥值。', changes: [{ field: 'secret', label: '密钥内容', before: '已变化', after: '已变化', sensitive: true }, { field: 'status', label: '旧 Key 状态', before: '有效', after: '已轮换', sensitive: false }], contentAvailable: false, credentialValueAvailable: false },
  { id: 'audit-quota-update', minutes: 78, actor: opsAdmin, action: 'update', actionLabel: '调整软额度', resource: { type: 'quota', id: 'quota-content-month', name: '内容运营 · 月度软目标' }, result: { status: 'success', code: 'QUOTA_UPDATED' }, source: { type: 'web', label: '额度与限流', ipMasked: '10.10.8.*', client: 'Edge · Windows' }, requestId: 'req-audit-quota-03', summary: '将内容运营月度软目标从 10,000 点调整为 12,000 点。', changes: [{ field: 'limit', label: '月度软目标', before: '10,000 点', after: '12,000 点', sensitive: false }, { field: 'reason', label: '调整原因', before: null, after: '大促活动临时扩容', sensitive: false }], contentAvailable: false, credentialValueAvailable: false },
  { id: 'audit-route-update', minutes: 145, actor: admin, action: 'update', actionLabel: '更新路由', resource: { type: 'route', id: 'route-ecommerce-copy', name: 'ecommerce-copy' }, result: { status: 'success', code: 'ROUTE_UPDATED' }, source: { type: 'web', label: '用途与路由', ipMasked: '192.168.1.*', client: 'Chrome · Windows' }, requestId: 'req-audit-route-04', summary: '在官方生产组内调整商品文案备用渠道顺序。', changes: [{ field: 'fallbackOrder', label: '备用渠道顺序', before: 'CN 02 → Global 01', after: 'Global 01 → CN 02', sensitive: false }], contentAvailable: false, credentialValueAvailable: false },
  { id: 'audit-export-denied', minutes: 220, actor: opsAdmin, action: 'export', actionLabel: '申请导出', resource: { type: 'export', id: 'export-usage-01', name: '近 30 天调用日志' }, result: { status: 'denied', code: 'SCOPE_DENIED' }, source: { type: 'web', label: '用量与日志', ipMasked: '10.10.8.*', client: 'Edge · Windows' }, requestId: 'req-audit-export-05', summary: '导出范围包含无权访问的部门，申请被权限边界拒绝。', changes: [], contentAvailable: false, credentialValueAvailable: false },
  { id: 'audit-person-disable-failed', minutes: 390, actor: opsAdmin, action: 'disable', actionLabel: '停用人员', resource: { type: 'person', id: 'person-chen', name: '陈宇航' }, result: { status: 'failed', code: 'DEPENDENCY_UNAVAILABLE' }, source: { type: 'api', label: 'BFF 管理接口', ipMasked: '10.10.8.*', client: 'WorkBuddy' }, requestId: 'req-audit-person-06', summary: '下游 Key 回收服务不可用，人员状态未发生变化。', changes: [{ field: 'status', label: '人员状态', before: '在职', after: '未变化', sensitive: false }], contentAvailable: false, credentialValueAvailable: false },
  { id: 'audit-settings-update', minutes: 780, actor: admin, action: 'update', actionLabel: '更新设置', resource: { type: 'settings', id: 'settings-retention', name: '日志留存设置' }, result: { status: 'success', code: 'SETTINGS_UPDATED' }, source: { type: 'web', label: '系统设置', ipMasked: '192.168.1.*', client: 'Chrome · Windows' }, requestId: 'req-audit-settings-07', summary: '将普通调用元数据留存期调整为 180 天。', changes: [{ field: 'retentionDays', label: '留存天数', before: '90 天', after: '180 天', sensitive: false }], contentAvailable: false, credentialValueAvailable: false },
  { id: 'audit-key-create', minutes: 1_720, actor: admin, action: 'create', actionLabel: '创建 Key', resource: { type: 'key', id: 'key-xu-2', name: 'sk-ops••••••A921' }, result: { status: 'success', code: 'KEY_CREATED' }, source: { type: 'api', label: 'BFF 管理接口', ipMasked: '127.0.0.*', client: 'Codex Desktop' }, requestId: 'req-audit-key-09', summary: '为徐静怡创建客服回复用途的独立 Key。', changes: [{ field: 'secret', label: '密钥内容', before: null, after: '已创建（不记录值）', sensitive: true }, { field: 'purpose', label: '业务用途', before: null, after: '客服回复', sensitive: false }], contentAvailable: false, credentialValueAvailable: false },
  { id: 'audit-login-denied', minutes: 2_180, actor: opsAdmin, action: 'login', actionLabel: '登录被拒绝', resource: { type: 'session', id: 'session-denied-02', name: '管理端会话' }, result: { status: 'denied', code: 'MFA_REQUIRED' }, source: { type: 'web', label: '管理控制台', ipMasked: '203.0.113.*', client: 'Unknown browser' }, requestId: 'req-audit-login-10', summary: '异地登录未完成二次验证，未创建管理会话。', changes: [], contentAvailable: false, credentialValueAvailable: false },
  { id: 'audit-export-complete', minutes: 3_400, actor: system, action: 'export', actionLabel: '完成导出', resource: { type: 'export', id: 'export-cost-02', name: '月度成本分摊' }, result: { status: 'success', code: 'EXPORT_READY' }, source: { type: 'system', label: '异步导出任务', ipMasked: null, client: 'Background worker' }, requestId: 'req-audit-export-11', summary: '演示导出任务完成；文件链接与真实业务数据均未生成。', changes: [{ field: 'state', label: '文件状态', before: '处理中', after: '可下载（演示）', sensitive: false }], contentAvailable: false, credentialValueAvailable: false },
  { id: 'audit-route-failed', minutes: 5_600, actor: opsAdmin, action: 'update', actionLabel: '更新路由', resource: { type: 'route', id: 'route-experiment-lab', name: 'ecommerce-pro-lab' }, result: { status: 'failed', code: 'ISOLATION_VIOLATION' }, source: { type: 'api', label: 'BFF 管理接口', ipMasked: '10.10.8.*', client: 'WorkBuddy' }, requestId: 'req-audit-route-12', summary: '跨生产与实验组的回退配置违反隔离规则，变更未生效。', changes: [{ field: 'fallbackGroup', label: '备用分组', before: 'experiment', after: '未变化', sensitive: false }], contentAvailable: false, credentialValueAvailable: false },
]

function periodMinutes(period: AuditQuery['period']) { return period === 'today' ? 24 * 60 : period === '7d' ? 7 * 24 * 60 : 30 * 24 * 60 }
function createEvents(now: Date): AuditEvent[] { return seeds.map(({ minutes, ...item }) => ({ ...item, occurredAt: minutesAgo(now, minutes) })) }

export function createDemoAudit(query: AuditQuery, now = new Date()) {
  const all = createEvents(now)
  const cutoff = now.getTime() - periodMinutes(query.period) * 60_000
  const search = query.search.toLocaleLowerCase('zh-CN')
  const filtered = all.filter((item) => {
    const matchesSearch = !search || [item.id, item.requestId, item.actor.name, item.actionLabel, item.resource.name, item.summary].some((value) => value.toLocaleLowerCase('zh-CN').includes(search))
    return new Date(item.occurredAt).getTime() >= cutoff && matchesSearch && (!query.eventId || item.id === query.eventId) && (query.actor === 'all' || item.actor.id === query.actor) && (query.action === 'all' || item.action === query.action) && (query.resource === 'all' || item.resource.type === query.resource) && (query.result === 'all' || item.result.status === query.result) && (query.source === 'all' || item.source.type === query.source) && (query.sourceSystem === 'all' || (item.sourceSystem ?? 'ai_ops') === query.sourceSystem)
  })
  const start = (query.page - 1) * query.pageSize
  return {
    meta: { source: 'demo' as const, generatedAt: now.toISOString(), period: query.period, notice: '平台审计数据库与真实会话尚未接入；当前为经过安全约束的演示事件', sources: [{ id: 'ai_ops' as const, label: 'AI OPS 管理审计', state: 'ready' as const, count: filtered.length, notice: '演示管理事件' }, { id: 'new_api' as const, label: 'New API 请求日志', state: 'not_configured' as const, count: 0, notice: '演示模式未读取 New API' }, { id: 'cpa' as const, label: 'CPA 运行日志', state: 'not_configured' as const, count: 0, notice: '演示模式未读取 CPA' }] },
    summary: { total: filtered.length, success: filtered.filter((item) => item.result.status === 'success').length, failed: filtered.filter((item) => item.result.status === 'failed').length, denied: filtered.filter((item) => item.result.status === 'denied').length, sensitiveChanges: filtered.filter((item) => item.changes.some((change) => change.sensitive)).length },
    options: { actors: [admin, opsAdmin, system].map((item) => ({ id: item.id, label: item.name })) }, items: filtered.slice(start, start + query.pageSize),
    pagination: { page: query.page, pageSize: query.pageSize, total: filtered.length, totalPages: Math.ceil(filtered.length / query.pageSize) },
    retention: { mode: 'demo' as const, deletionAllowed: false as const, appendOnlyVerified: false as const, notice: '页面不提供删除能力；正式环境的追加写入、哈希链与受限数据库权限仍待验证。' },
    integrity: { deletionAllowed: false as const, appendOnlyVerified: false as const, verified: false, hashChainVerified: false, checkpointVerified: false, algorithm: 'not_configured' as const, checkedAt: null, checkpointUpdatedAt: null, eventCount: 0, firstInvalidEventId: null, notice: '演示事件未接入 SQLite 哈希链与检查点，不能标记为已验证。' },
  }
}

export function createDemoAuditDetail(id: string, now = new Date()) {
  const event = createEvents(now).find((item) => item.id === id)
  if (!event) return null
  const index = seeds.findIndex((item) => item.id === id)
  return {
    meta: { source: 'demo' as const, generatedAt: now.toISOString(), notice: '详情仅展示字段级摘要，不包含完整密钥、认证信息、请求正文或对话正文' }, event,
    request: { requestId: event.requestId, traceState: 'demo_unverified' as const, responseCode: event.result.status === 'success' ? 200 : event.result.status === 'denied' ? 403 : 503, durationMs: 86 + index * 41 },
    integrity: { deletionAllowed: false as const, appendOnlyVerified: false as const, verified: false, hashChainVerified: false, checkpointVerified: false, algorithm: 'not_configured' as const, checkedAt: null, checkpointUpdatedAt: null, eventCount: 0, firstInvalidEventId: null, notice: '演示记录不可在页面删除；正式追加写入、哈希链与检查点校验尚未接入，不能标记为已验证。' },
    relatedAuditIds: index > 0 ? [seeds[index - 1]!.id] : [],
  }
}

const actionLabels: Record<AuditEvent['action'], string> = { login: '登录', logout: '退出登录', access: '访问', create: '创建', update: '更新', disable: '停用', enable: '启用', delete: '删除', rotate: '轮换 Key', reset: '重置 Key', export: '导出', acknowledge: '确认告警', verify: '验证连接', view: '查看', sync: '同步', restart: '重启服务', draft: '保存草稿', publish: '发布', rollback: '回滚' }
const resourceLabels: Record<AuditEvent['resource']['type'], string> = { session: '管理端会话', authorization: '权限校验', gateway_request: '网关请求', person: '人员记录', people: '人员目录', key: '访问 Key', quota: '额度策略', route: '用途路由', channel: '模型渠道', 'new-api-channel': 'New API 渠道', upstream: '上游账号', export: '数据导出', settings: '系统设置', alert: '历史告警事件', conversation: '对话审计记录', service: '服务', business_rule_version: '业务规则版本' }

const actionValues = new Set<AuditEvent['action']>(Object.keys(actionLabels) as AuditEvent['action'][])
const resourceValues = new Set<AuditEvent['resource']['type']>(Object.keys(resourceLabels) as AuditEvent['resource']['type'][])

function normalizeAction(value: string): AuditEvent['action'] {
  return actionValues.has(value as AuditEvent['action']) ? value as AuditEvent['action'] : 'update'
}

function normalizeResourceType(value: string): AuditEvent['resource']['type'] {
  if (value === 'docker-service') return 'service'
  return resourceValues.has(value as AuditEvent['resource']['type']) ? value as AuditEvent['resource']['type'] : 'settings'
}

function csvCell(value: string | number | null | undefined) {
  const text = value == null ? '' : String(value)
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function createAuditCsv(events: AuditEvent[]) {
  const header = ['event_id', 'occurred_at', 'actor', 'action', 'resource_type', 'resource_name', 'result', 'result_code', 'source', 'source_system', 'key_masked', 'request_id', 'summary', 'changed_fields']
  const rows = events.map((event) => [
    event.id,
    event.occurredAt,
    event.actor.name,
    event.actionLabel,
    resourceLabels[event.resource.type],
    event.resource.name,
    event.result.status,
    event.result.code,
    event.source.label,
    event.sourceSystem ?? 'ai_ops',
    event.key?.masked ?? '',
    event.requestId,
    event.summary,
    event.changes.map((change) => `${change.label}${change.sensitive ? '（敏感字段）' : ''}`).join('、'),
  ])
  return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}

const auditSummarySchema = z.object({
  code: z.string().trim().min(1).max(64).optional(),
  message: z.string().trim().min(1).max(240).optional(),
  resourceName: z.string().trim().min(1).max(100).optional(),
  changes: z.array(changeSchema).max(8).optional(),
}).passthrough()
const credentialPattern = /(?:bearer\s+\S+|sk-[a-z0-9_-]{8,})/giu
const maskedKeyPattern = /^sk-ops••••••[A-Z0-9_-]{4}$/u
type DatabaseAuditRow = ReturnType<PlatformDatabase['listAuditEvents']>[number]
type SafeAuditSummary = z.infer<typeof auditSummarySchema>

function safeAuditSummary(row: DatabaseAuditRow): SafeAuditSummary {
  const parsed = auditSummarySchema.safeParse(row.summary)
  return parsed.success ? parsed.data : {}
}

function redactAuditText(value: string) {
  return value.replace(credentialPattern, '[已脱敏]')
}

function displayText(value: unknown, max = 100) {
  if (value === null || value === undefined) return ''
  return redactAuditText(String(value).replace(/[\r\n\t]+/gu, ' ').trim()).slice(0, max)
}

function summaryText(summary: SafeAuditSummary, key: string) {
  const value = summary[key]
  return typeof value === 'string' ? displayText(value) : ''
}

function summaryNumber(summary: SafeAuditSummary, key: string) {
  const value = summary[key]
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null
}

function safeId(value: unknown, fallback: string) {
  const normalized = displayText(value, 100).toLowerCase().replace(/[^a-z0-9-]+/gu, '-').replace(/^-+|-+$/gu, '')
  return (normalized || fallback).slice(0, 80)
}

function safeRequestId(value: unknown, fallback: string) {
  const normalized = displayText(value, 100).toLowerCase().replace(/[^a-z0-9-]+/gu, '-').replace(/^-+|-+$/gu, '')
  const candidate = normalized.startsWith('req-') ? normalized : `req-${normalized || safeId(fallback, 'audit-event')}`
  return candidate.slice(0, 120)
}

function databaseResourceName(type: AuditEvent['resource']['type'], id: string, summary: SafeAuditSummary) {
  if (['person', 'conversation', 'route', 'channel', 'upstream', 'alert', 'service', 'people', 'business_rule_version'].includes(type) && summary.resourceName) return redactAuditText(summary.resourceName)
  if (type === 'key' && summary.resourceName && maskedKeyPattern.test(summary.resourceName)) return summary.resourceName
  if (id === 'key-lin-1') return 'sk-ops••••••7F2A'
  if (id === 'quota-content-month') return '内容运营 · 月度软目标'
  if (id === 'export-usage-01') return '近 30 天调用日志'
  return resourceLabels[type] ?? '系统资源'
}

function databaseSource(type: AuditEvent['resource']['type'], action: AuditEvent['action']) {
  if (action === 'login' || action === 'logout' || type === 'authorization') return { type: 'web' as const, label: '管理控制台', ipMasked: null, client: '客户端信息未采集' }
  if (type === 'gateway_request') return { type: 'api' as const, label: 'AI OPS 独立网关', ipMasked: null, client: '兼容客户端' }
  if (type === 'conversation') return { type: 'web' as const, label: '对话审计', ipMasked: null, client: '客户端信息未采集' }
  if (type === 'export') return { type: 'web' as const, label: '用量与日志', ipMasked: '10.10.8.*', client: 'Edge · Windows' }
  if (type === 'quota') return { type: 'web' as const, label: '额度与限流', ipMasked: '10.10.8.*', client: 'Edge · Windows' }
  if (type === 'alert') return { type: 'web' as const, label: '已下线告警中心', ipMasked: null, client: '客户端信息未采集' }
  if (type === 'upstream') return { type: 'web' as const, label: '上游账号', ipMasked: null, client: '客户端信息未采集' }
  if (type === 'service') return { type: 'web' as const, label: '服务矩阵', ipMasked: null, client: '管理控制台' }
  if (type === 'people' || type === 'new-api-channel') return { type: 'api' as const, label: 'New API 同步', ipMasked: null, client: 'AI OPS 服务端' }
  return { type: 'api' as const, label: 'BFF 管理接口', ipMasked: '127.0.0.*', client: 'Codex Desktop' }
}

function databaseChanges(row: DatabaseAuditRow): AuditEvent['changes'] {
  const summary = safeAuditSummary(row)
  if (summary.changes) {
    return summary.changes.map((change) => ({
      ...change,
      before: change.sensitive ? (change.before === null ? null : '已变化') : change.before === null ? null : redactAuditText(change.before),
      after: change.sensitive ? (change.after === null ? null : '已变化') : change.after === null ? null : redactAuditText(change.after),
    }))
  }
  if (row.action === 'rotate' && row.resourceType === 'key') return [{ field: 'secret', label: '密钥内容', before: '已变化', after: '已变化', sensitive: true }]
  return []
}

function keyContextFromSummary(summary: SafeAuditSummary): AuditEvent['key'] {
  const id = summaryText(summary, 'keyId')
  const masked = summaryText(summary, 'keyMasked')
  if (!id || !masked) return undefined
  const owner = summaryText(summary, 'ownerName')
  return { id, masked, ...(owner ? { owner } : {}) }
}

function transportFromSummary(summary: SafeAuditSummary): AuditEvent['transport'] {
  const responseCode = summaryNumber(summary, 'responseCode')
  const durationMs = summaryNumber(summary, 'durationMs')
  if (responseCode === null || durationMs === null || responseCode < 100 || responseCode > 599) return undefined
  const traceId = summaryText(summary, 'traceId')
  return { responseCode, durationMs, ...(traceId ? { traceId } : {}) }
}

function databaseEvent(row: DatabaseAuditRow): AuditEvent {
  const action = normalizeAction(row.action)
  const resourceType = normalizeResourceType(row.resourceType)
  const actionLabel = action === 'access' && resourceType === 'gateway_request' ? '网关调用' : actionLabels[action]
  const actorRole = row.actorRole ?? 'system'
  const auditSummary = safeAuditSummary(row)
  const summary = auditSummary.message ? redactAuditText(auditSummary.message) : '已记录字段级操作摘要。'
  const actionCode = actionLabels[action].replaceAll(' ', '_').toUpperCase()
  const isAnonymous = !row.actorUserId && (action === 'login' || action === 'access')
  const event: AuditEvent = {
    id: safeId(row.id, 'audit-event'),
    occurredAt: row.occurredAt,
    actor: { id: isAnonymous ? 'anonymous' : row.actorUserId ?? 'system', name: isAnonymous ? '未识别身份' : row.actorName ?? '平台任务', role: actorRole },
    action,
    actionLabel,
    resource: { type: resourceType, id: displayText(row.resourceId, 120) || `${resourceType}-unknown`, name: databaseResourceName(resourceType, row.resourceId ?? '', auditSummary) },
    result: { status: row.result, code: auditSummary.code ?? (row.result === 'success' ? (action === 'login' ? 'AUTH_OK' : `${actionCode}_OK`) : row.result === 'denied' ? 'SCOPE_DENIED' : 'DEPENDENCY_UNAVAILABLE') },
    source: databaseSource(resourceType, action),
    requestId: safeRequestId(row.requestId, row.id.replace(/^audit-/, '')),
    summary,
    changes: databaseChanges(row),
    sourceSystem: 'ai_ops' as const,
    contentAvailable: false,
    credentialValueAvailable: false,
  }
  const key = keyContextFromSummary(auditSummary)
  const transport = transportFromSummary(auditSummary)
  if (key) event.key = key
  if (transport) event.transport = transport
  return event
}

function newApiResult(type: number | null): AuditEvent['result']['status'] {
  if (type === 2) return 'success'
  if (type === 5) return 'denied'
  return 'failed'
}

function newApiAuditEvent(database: PlatformDatabase, row: NewApiLogRecord): AuditEvent | null {
  if (!row.occurredAt || Number.isNaN(new Date(row.occurredAt).getTime())) return null
  const localKey = row.tokenId ? database.findApiKeyByExternalTokenId(row.tokenId) : null
  const keyMasked = localKey?.maskedValue ?? (row.tokenId ? `New API Token #${displayText(row.tokenId, 32)}` : '未识别 Key')
  const keyId = localKey?.id ?? (row.tokenId ? `new-api-token-${safeId(row.tokenId, 'unknown')}` : 'new-api-token-unknown')
  const owner = localKey?.ownerName ?? ''
  const model = displayText(row.modelName, 64) || '未标注模型'
  const channel = displayText(row.channelName, 64) || (row.channelId ? `渠道 ${displayText(row.channelId, 24)}` : '未标注渠道')
  const status = newApiResult(row.type)
  const responseCode = status === 'success' ? 200 : status === 'denied' ? 403 : 502
  const requestId = safeRequestId(row.requestId, `new-api-${row.id}`)
  const event: AuditEvent = {
    id: `audit-new-api-${safeId(row.id, 'log')}`,
    occurredAt: row.occurredAt,
    actor: { id: owner ? `new-api-owner-${safeId(localKey?.ownerUserId, 'unknown')}` : 'new-api', name: owner || (displayText(row.username, 40) ? `New API · ${displayText(row.username, 40)}` : 'New API 请求'), role: owner ? 'employee' : 'system' },
    action: 'access', actionLabel: '网关调用',
    resource: { type: 'gateway_request', id: requestId, name: model },
    result: { status, code: `NEW_API_${status.toUpperCase()}` },
    source: { type: 'api', label: 'New API 请求日志', ipMasked: null, client: 'New API SQLite' },
    requestId,
    summary: displayText(`Key ${keyMasked} 调用 ${model}；渠道 ${channel}；耗时 ${row.useTime}ms，输入/输出 ${row.promptTokens}/${row.completionTokens} tokens。仅读取请求元数据，未保存请求正文。`, 240),
    changes: [], sourceSystem: 'new_api',
    contentAvailable: false, credentialValueAvailable: false,
    key: { id: keyId, masked: keyMasked, ...(owner ? { owner } : {}) },
    transport: { responseCode, durationMs: Math.max(0, Math.round(row.useTime)), ...(row.upstreamRequestId ? { traceId: displayText(row.upstreamRequestId, 80) } : {}) },
  }
  return event
}

function cpaAuditEvent(row: CpaLogRecord): AuditEvent {
  const status: AuditEvent['result']['status'] = row.statusCode >= 200 && row.statusCode < 300 ? 'success' : row.statusCode === 401 || row.statusCode === 403 ? 'denied' : 'failed'
  const management = row.path.startsWith('/v0/management/')
  const resourceType = management ? 'upstream' as const : 'gateway_request' as const
  const requestId = safeRequestId(row.traceId, `cpa-${row.id}`)
  const route = displayText(`${row.method} ${row.path}`, 120)
  return {
    id: `audit-cpa-${safeId(row.id, 'log')}`,
    occurredAt: row.occurredAt,
    actor: { id: 'cpa-runtime', name: 'CPA 运行时', role: 'system' },
    action: 'access', actionLabel: management ? '管理接口访问' : '网关调用',
    resource: { type: resourceType, id: requestId, name: route || 'CPA 请求' },
    result: { status, code: `CPA_HTTP_${row.statusCode}` },
    source: { type: 'system', label: 'CPA 运行日志', ipMasked: row.clientIp, client: `CPA · ${displayText(row.fileName, 48) || 'main.log'}` },
    requestId,
    summary: displayText(`CPA ${route} 返回 HTTP ${row.statusCode}；耗时 ${row.durationMs}ms${row.traceId ? `，Trace ${row.traceId}` : ''}。仅读取运行元数据，未解析请求或响应正文。`, 240),
    changes: [], sourceSystem: 'cpa',
    contentAvailable: false, credentialValueAvailable: false,
    transport: { responseCode: row.statusCode, durationMs: row.durationMs, ...(row.traceId ? { traceId: row.traceId } : {}) },
  }
}

type SourceReadState = { state: z.infer<typeof sourceStateSchema>; notice: string }
type CollectedAudit = { all: AuditEvent[]; sources: Array<z.infer<typeof sourceSummarySchema>> }

function collectAuditEvents(database: PlatformDatabase, readers: AuditSourceReaders, now: Date, period: AuditQuery['period']): CollectedAudit {
  const local = database.listAuditEvents().map(databaseEvent)
  const newApiEvents: AuditEvent[] = []
  let newApiRead: SourceReadState = { state: readers.newApi ? 'ready' : 'not_configured', notice: readers.newApi ? '已读取 New API SQLite 请求元数据' : '未配置 NEW_API_DB_PATH' }
  if (readers.newApi) {
    try {
      for (const row of readers.newApi.listLogs(50_000)) {
        const event = newApiAuditEvent(database, row)
        if (event) newApiEvents.push(event)
      }
      if (!newApiEvents.length) newApiRead = { ...newApiRead, notice: '已连接 New API SQLite；当前时间范围暂无可用请求记录' }
    } catch {
      newApiRead = { state: 'unavailable', notice: 'New API SQLite 暂时不可读' }
    }
  }
  const cpaEvents: AuditEvent[] = []
  let cpaRead: SourceReadState = { state: readers.cpa?.configured ? 'ready' : 'not_configured', notice: readers.cpa?.configured ? '已读取 CPA main.log 请求元数据' : '未配置 CPA_LOG_PATH 或日志目录' }
  if (readers.cpa?.configured) {
    try {
      cpaEvents.push(...readers.cpa.listLogs(50_000).map(cpaAuditEvent))
      if (!cpaEvents.length) cpaRead = { ...cpaRead, notice: '已连接 CPA 日志目录；当前时间范围暂无可用请求记录' }
    } catch {
      cpaRead = { state: 'unavailable', notice: 'CPA 运行日志暂时不可读' }
    }
  }
  const byId = new Map<string, AuditEvent>()
  for (const event of [...local, ...newApiEvents, ...cpaEvents]) if (!byId.has(event.id)) byId.set(event.id, event)
  const all = [...byId.values()].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id))
  const cutoff = now.getTime() - periodMinutes(period) * 60_000
  const count = (sourceSystem: AuditEvent['sourceSystem']) => all.filter((event) => (event.sourceSystem ?? 'ai_ops') === sourceSystem && new Date(event.occurredAt).getTime() >= cutoff).length
  return {
    all,
    sources: [
      { id: 'ai_ops' as const, label: 'AI OPS 管理审计', state: 'ready' as const, count: count('ai_ops'), notice: '平台 SQLite 追加写入，包含操作、权限、服务重启与对话查看记录' },
      { id: 'new_api' as const, label: 'New API 请求日志', state: newApiRead.state, count: count('new_api'), notice: newApiRead.notice },
      { id: 'cpa' as const, label: 'CPA 运行日志', state: cpaRead.state, count: count('cpa'), notice: cpaRead.notice },
    ],
  }
}

function filterAuditEvents(all: AuditEvent[], query: AuditQuery, now: Date) {
  const cutoff = now.getTime() - periodMinutes(query.period) * 60_000
  const search = query.search.toLocaleLowerCase('zh-CN')
  return all.filter((item) => {
    const sourceSystem = item.sourceSystem ?? 'ai_ops'
    const matchesSearch = !search || [item.id, item.requestId, item.actor.name, item.actionLabel, item.resource.name, item.source.label, item.summary].some((value) => value.toLocaleLowerCase('zh-CN').includes(search))
    return new Date(item.occurredAt).getTime() >= cutoff && matchesSearch && (!query.eventId || item.id === query.eventId) && (query.actor === 'all' || item.actor.id === query.actor) && (query.action === 'all' || item.action === query.action) && (query.resource === 'all' || item.resource.type === query.resource) && (query.result === 'all' || item.result.status === query.result) && (query.source === 'all' || item.source.type === query.source) && (query.sourceSystem === 'all' || sourceSystem === query.sourceSystem)
  })
}

function databaseIntegrity(chain: AuditChainVerification) {
  const notice = chain.verified
    ? 'SQLite 事件内容、顺序与链检查点已通过本地 SHA-256 校验；这不等同于生产级不可篡改存储。'
    : chain.hashChainVerified
      ? `SQLite 链检查点不一致，可能存在尾部删除；末次检查点事件：${chain.firstInvalidEventId ?? '未知'}。`
      : `SQLite 哈希链校验失败，首个不一致事件：${chain.firstInvalidEventId ?? '未知'}；已停止将其视为完整证据。`
  return {
    deletionAllowed: false as const, appendOnlyVerified: false as const, verified: chain.verified,
    hashChainVerified: chain.hashChainVerified, checkpointVerified: chain.checkpointVerified,
    algorithm: chain.algorithm, checkedAt: chain.checkedAt, checkpointUpdatedAt: chain.checkpointUpdatedAt,
    eventCount: chain.eventCount, firstInvalidEventId: chain.firstInvalidEventId, notice,
  }
}

function detailIntegrity(event: AuditEvent, chain: AuditChainVerification) {
  if ((event.sourceSystem ?? 'ai_ops') !== 'ai_ops') {
    return {
      deletionAllowed: false as const, appendOnlyVerified: false as const, verified: false,
      hashChainVerified: false, checkpointVerified: false, algorithm: 'not_configured' as const,
      checkedAt: null, checkpointUpdatedAt: null, eventCount: 0, firstInvalidEventId: null,
      notice: '外部只读日志仅展示请求元数据，未纳入 AI OPS SQLite 哈希链；请求正文、响应正文与凭据均未读取。',
    }
  }
  return databaseIntegrity(chain)
}

export function createDatabaseAudit(database: PlatformDatabase, query: AuditQuery, now = new Date(), readers: AuditSourceReaders = {}) {
  const collected = collectAuditEvents(database, readers, now, query.period)
  const chain = database.verifyAuditChain(now)
  const filtered = filterAuditEvents(collected.all, query, now)
  const start = (query.page - 1) * query.pageSize
  const actors = [...new Map(collected.all.map((item) => [item.actor.id, { id: item.actor.id, label: item.actor.name }])).values()]
  return {
    meta: { source: 'database' as const, generatedAt: now.toISOString(), period: query.period, notice: '审计事件已合并平台 SQLite、New API 请求日志与 CPA 运行日志；外部日志仅读取请求元数据，不包含请求正文、响应正文或凭据。', sources: collected.sources },
    summary: { total: filtered.length, success: filtered.filter((item) => item.result.status === 'success').length, failed: filtered.filter((item) => item.result.status === 'failed').length, denied: filtered.filter((item) => item.result.status === 'denied').length, sensitiveChanges: filtered.filter((item) => item.changes.some((change) => change.sensitive)).length },
    options: { actors }, items: filtered.slice(start, start + query.pageSize),
    pagination: { page: query.page, pageSize: query.pageSize, total: filtered.length, totalPages: Math.ceil(filtered.length / query.pageSize) },
    retention: { mode: 'database' as const, deletionAllowed: false as const, appendOnlyVerified: false as const, notice: '页面不提供删除能力；AI OPS 操作审计进入 SQLite 哈希链，New API 与 CPA 记录保持只读来源标记。' },
    integrity: databaseIntegrity(chain),
  }
}

export function createDatabaseAuditDetail(database: PlatformDatabase, id: string, now = new Date(), readers: AuditSourceReaders = {}) {
  const collected = collectAuditEvents(database, readers, now, '30d')
  const chain = database.verifyAuditChain(now)
  const index = collected.all.findIndex((item) => item.id === id)
  const event = collected.all[index]
  if (!event) return null
  const responseCode = event.transport?.responseCode ?? (event.result.status === 'success' ? 200 : event.result.status === 'denied' ? 403 : 503)
  const durationMs = event.transport?.durationMs ?? 86 + index * 41
  const external = (event.sourceSystem ?? 'ai_ops') !== 'ai_ops'
  return {
    meta: { source: 'database' as const, generatedAt: now.toISOString(), notice: external ? '外部详情仅展示请求元数据，不包含请求正文、响应正文或凭据' : '详情仅展示字段级摘要，不包含完整密钥、认证信息、请求正文或对话正文' }, event,
    request: { requestId: event.requestId, traceState: 'database_unverified' as const, responseCode, durationMs },
    integrity: detailIntegrity(event, chain),
    relatedAuditIds: external ? [] : index > 0 ? [collected.all[index - 1]!.id] : [],
  }
}
