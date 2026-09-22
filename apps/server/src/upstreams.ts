import { z } from 'zod'
import type { PlatformProbeResult } from './platform.js'
import type { PlatformDatabase } from './platform-db.js'

export const upstreamsQuerySchema = z.object({
  search: z.string().trim().max(60).default(''),
  type: z.enum(['all', 'cpa_oauth']).default('all'),
  status: z.enum(['all', 'healthy', 'degraded', 'auth_required', 'offline', 'unconfigured']).default('all'),
})

const upstreamErrorSchema = z.object({
  category: z.enum(['authentication', 'rate_limit', 'timeout', 'balance', 'server', 'connection']),
  summary: z.string(),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
})

export const upstreamItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  type: z.literal('cpa_oauth'),
  environment: z.enum(['production', 'experiment']),
  status: z.enum(['healthy', 'degraded', 'auth_required', 'offline', 'unconfigured']),
  credentialConfigured: z.boolean(),
  credentialValidation: z.enum(['verified', 'failed', 'not_checked']),
  models: z.array(z.string()),
  health: z.object({
    successRate: z.number().min(0).max(100).nullable(),
    latencyMs: z.number().int().nonnegative().nullable(),
    checkedAt: z.string().datetime(),
  }),
  balance: z.object({
    state: z.enum(['sufficient', 'low', 'unknown', 'unavailable']),
    label: z.string(),
    updatedAt: z.string().datetime().nullable(),
  }),
  capacity: z.object({ rpm: z.number().int().positive(), tpm: z.number().int().positive() }).nullable(),
  auth: z.object({ expiresAt: z.string().datetime().nullable(), lastRefreshedAt: z.string().datetime().nullable() }).nullable(),
  windows: z.array(z.object({ id: z.enum(['five_hour', 'weekly']), label: z.string(), usedPercent: z.number().min(0).max(100), resetsAt: z.string().datetime() })),
  cooldown: z.object({ active: z.boolean(), until: z.string().datetime().nullable(), reason: z.string().nullable() }).nullable(),
  recentError: upstreamErrorSchema.nullable(),
})

export const upstreamsResponseSchema = z.object({
  meta: z.object({
    source: z.literal('live'),
    generatedAt: z.string().datetime(),
    notice: z.string(),
    live: z.object({
      cpa: z.enum(['reachable', 'offline']),
      checkedAt: z.string().datetime(),
      managementConfigured: z.boolean(),
    }),
  }),
  summary: z.object({
    total: z.number().int().nonnegative(),
    available: z.number().int().nonnegative(),
    needsAttention: z.number().int().nonnegative(),
    official: z.number().int().nonnegative(),
    experiment: z.number().int().nonnegative(),
    configured: z.number().int().nonnegative(),
  }),
  isolation: z.object({
    enforced: z.literal(true),
    productionToExperimentFallback: z.literal(false),
    statement: z.string(),
  }),
  items: z.array(upstreamItemSchema),
  total: z.number().int().nonnegative(),
})

export const upstreamIdParamsSchema = z.object({
  id: z.string().regex(/^upstream-[a-z0-9-]+$/),
})

export const upstreamCheckBodySchema = z.object({
  idempotencyKey: z.string().regex(/^upstream-check-[a-z0-9-]{8,96}$/),
  reason: z.string().trim().min(8).max(200),
  acknowledgeSynthetic: z.literal(true),
})

export const upstreamCheckResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), completedAt: z.string().datetime(), notice: z.string() }),
  upstream: upstreamItemSchema,
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})

export const upstreamHistoryResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), generatedAt: z.string().datetime(), notice: z.string() }),
  upstream: z.object({ id: z.string(), name: z.string() }),
  items: z.array(z.object({
    id: z.string(), checkedAt: z.string().datetime(), actorName: z.string(), actorRole: z.enum(['super_admin', 'admin', 'department_lead', 'finance', 'employee', 'system']),
    result: z.enum(['success', 'failed', 'denied']), requestId: z.string(), code: z.string(), summary: z.string(),
  })),
  total: z.number().int().nonnegative(),
})

export type UpstreamsQuery = z.infer<typeof upstreamsQuerySchema>
export type UpstreamsResponse = z.infer<typeof upstreamsResponseSchema>
type UpstreamItem = z.infer<typeof upstreamItemSchema>
export type UpstreamCheckBody = z.infer<typeof upstreamCheckBodySchema>
export type UpstreamCheckResponse = z.infer<typeof upstreamCheckResponseSchema>
export type UpstreamHistoryResponse = z.infer<typeof upstreamHistoryResponseSchema>

function createLiveCpaItem(cpa: PlatformProbeResult): UpstreamItem {
  const models = [...new Set(cpa.models ?? [])]
  const status: UpstreamItem['status'] = cpa.authRequired
    ? 'auth_required'
    : cpa.state === 'offline'
      ? 'offline'
      : models.length > 0 ? 'healthy' : 'unconfigured'
  const credentialConfigured = cpa.credentialConfigured ?? Boolean(cpa.configured)
  const credentialValidation: UpstreamItem['credentialValidation'] = cpa.authRequired ? 'failed' : credentialConfigured ? 'verified' : 'not_checked'
  const summary = cpa.authRequired
    ? 'CPA 客户端 Key 未通过认证，请在 CPA 侧完成 Codex OAuth 登录并检查客户端 Key。'
    : cpa.state === 'offline'
      ? 'CPA 网关当前不可达，请确认服务已启动。'
      : models.length > 0 ? null : 'CPA 已连接，但 /v1/models 尚未返回可用模型。'
  return {
    id: 'upstream-cpa-gateway',
    name: 'CPA Codex OAuth',
    provider: 'CLIProxyAPI',
    type: 'cpa_oauth',
    environment: 'production',
    status,
    credentialConfigured,
    credentialValidation,
    models,
    health: { successRate: null, latencyMs: cpa.latencyMs ?? null, checkedAt: cpa.checkedAt },
    balance: { state: 'unknown', label: '由 CPA 管理', updatedAt: null },
    capacity: null,
    auth: null,
    windows: [],
    cooldown: null,
    recentError: summary ? { category: cpa.authRequired ? 'authentication' : 'connection', summary, firstSeenAt: cpa.checkedAt, lastSeenAt: cpa.checkedAt } : null,
  }
}

export function createUpstreamSnapshot(query: UpstreamsQuery, cpa: PlatformProbeResult, now = new Date(), lastChecks?: ReadonlyMap<string, string>): UpstreamsResponse {
  // This endpoint is deliberately CPA-only. New API owns model/channel
  // configuration and must not be rendered as an upstream account here.
  const cpaConfigured = Boolean(cpa.configured || cpa.credentialConfigured || process.env.AI_OPS_GATEWAY_CPA_API_KEY?.trim())
  const baseItems = cpaConfigured ? [createLiveCpaItem(cpa)] : []
  const all = baseItems.map((item) => {
    const checkedAt = lastChecks?.get(item.id)
    return checkedAt ? { ...item, health: { ...item.health, checkedAt } } : item
  })
  const search = query.search.toLocaleLowerCase('zh-CN')
  const items = all.filter((item) => {
    const matchesSearch = !search || [item.name, item.provider, ...item.models].some((value) => value.toLocaleLowerCase('zh-CN').includes(search))
    return matchesSearch && (query.type === 'all' || item.type === query.type) && (query.status === 'all' || item.status === query.status)
  })
  const cpaText = cpa.authRequired
    ? 'CPA 客户端认证未通过，请检查 CPA 客户端 Key 或账号授权'
    : cpa.state === 'reachable'
      ? cpaConfigured ? 'CPA OAuth 账号池已接入' : 'CPA 服务可达，等待配置账号池'
      : 'CPA 服务当前离线'
  return {
    meta: { source: 'live' as const, generatedAt: now.toISOString(), notice: cpaConfigured ? `${cpaText}；模型目录请前往模型目录页面查看` : `${cpaText}；当前未配置真实 CPA 账号池，本地模拟账号已移除`, live: { cpa: cpa.state, checkedAt: now.toISOString(), managementConfigured: Boolean(process.env.CPA_MANAGEMENT_KEY?.trim()) } },
    summary: { total: all.length, available: all.filter((item) => item.status === 'healthy').length, needsAttention: all.filter((item) => item.status !== 'healthy').length, official: 0, experiment: 0, configured: all.filter((item) => item.credentialConfigured).length },
    isolation: { enforced: true, productionToExperimentFallback: false, statement: 'CPA OAuth 账号只在 CPA 账号池中管理；AI OPS 只保存连接状态并分发自己的员工 Key，不展示认证文件或上游凭据。' },
    items,
    total: items.length,
  }
}

export function createDatabaseUpstreamHistory(database: PlatformDatabase, upstreamId: string, upstreamName: string, now = new Date()): UpstreamHistoryResponse {
  const items = database.listAuditEvents()
    .filter((event) => event.resourceType === 'upstream' && event.resourceId === upstreamId && event.action === 'verify')
    .map((event) => {
      const summary = event.summary
      return {
        id: event.id,
        checkedAt: event.occurredAt,
        actorName: event.actorName ?? '平台任务',
        actorRole: event.actorRole ?? ('system' as const),
        result: event.result,
        requestId: event.requestId ?? `req-${event.id.replace(/^audit-/, '')}`,
        code: typeof summary.code === 'string' ? summary.code : 'UPSTREAM_CHECK_RECORDED',
        summary: typeof summary.message === 'string' ? summary.message : '已记录本地模拟验证摘要。',
      }
    })
  return {
    meta: { source: 'database' as const, generatedAt: now.toISOString(), notice: '仅展示 SQLite 本地模拟验证摘要；不会显示验证原因原文、凭据或上游响应。' },
    upstream: { id: upstreamId, name: upstreamName },
    items,
    total: items.length,
  }
}
