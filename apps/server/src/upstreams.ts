import { z } from 'zod'
import type { NewApiStatus } from './new-api-status.js'
import type { PlatformProbeResult } from './platform.js'
import type { PlatformDatabase } from './platform-db.js'

export const upstreamsQuerySchema = z.object({
  search: z.string().trim().max(60).default(''),
  type: z.enum(['all', 'official_api', 'cpa_oauth']).default('all'),
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
  type: z.enum(['official_api', 'cpa_oauth']),
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
    source: z.literal('demo'),
    generatedAt: z.string().datetime(),
    notice: z.string(),
    live: z.object({
      newApi: z.enum(['healthy', 'reachable', 'auth_required', 'offline']),
      cpa: z.enum(['reachable', 'offline']),
      checkedAt: z.string().datetime(),
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

function offset(now: Date, minutes: number) { return new Date(now.getTime() + minutes * 60_000).toISOString() }

function createUpstreamItems(now: Date): UpstreamItem[] {
  return [
    {
      id: 'upstream-official-cn-1', name: 'Official CN · 主账号', provider: 'OpenAI Compatible', type: 'official_api', environment: 'production', status: 'healthy', credentialConfigured: true, credentialValidation: 'verified', models: ['gpt-5.1-mini', 'gpt-5.1'],
      health: { successRate: 99.6, latencyMs: 1_420, checkedAt: offset(now, -1) }, balance: { state: 'sufficient', label: '余额充足', updatedAt: offset(now, -12) }, capacity: { rpm: 500, tpm: 1_000_000 }, auth: null, windows: [], cooldown: null, recentError: null,
    },
    {
      id: 'upstream-official-global-1', name: 'Official Global · 分析账号', provider: 'OpenAI Compatible', type: 'official_api', environment: 'production', status: 'degraded', credentialConfigured: true, credentialValidation: 'verified', models: ['gpt-5.1'],
      health: { successRate: 96.8, latencyMs: 3_960, checkedAt: offset(now, -1) }, balance: { state: 'low', label: '余额偏低', updatedAt: offset(now, -18) }, capacity: { rpm: 180, tpm: 360_000 }, auth: null, windows: [], cooldown: null,
      recentError: { category: 'balance', summary: '余额已进入预警区间，策略分析可在官方组内降级', firstSeenAt: offset(now, -420), lastSeenAt: offset(now, -18) },
    },
    {
      id: 'upstream-official-standby', name: 'Official CN · 备用账号', provider: 'OpenAI Compatible', type: 'official_api', environment: 'production', status: 'unconfigured', credentialConfigured: false, credentialValidation: 'not_checked', models: ['gpt-5.1-mini'],
      health: { successRate: null, latencyMs: null, checkedAt: offset(now, -1_440) }, balance: { state: 'unavailable', label: '等待配置', updatedAt: null }, capacity: null, auth: null, windows: [], cooldown: null,
      recentError: { category: 'authentication', summary: '服务端尚未配置此备用账号凭据', firstSeenAt: offset(now, -1_440), lastSeenAt: offset(now, -1_440) },
    },
    {
      id: 'upstream-cpa-lab-1', name: 'CPA Pro · 实验账号 01', provider: 'CLIProxyAPI', type: 'cpa_oauth', environment: 'experiment', status: 'healthy', credentialConfigured: true, credentialValidation: 'verified', models: ['pro-oauth-lab'],
      health: { successRate: 94.5, latencyMs: 5_820, checkedAt: offset(now, -3) }, balance: { state: 'unknown', label: '按窗口管理', updatedAt: null }, capacity: null,
      auth: { expiresAt: offset(now, 15 * 24 * 60), lastRefreshedAt: offset(now, -210) }, windows: [{ id: 'five_hour', label: '5 小时窗口', usedPercent: 36, resetsAt: offset(now, 124) }, { id: 'weekly', label: '周窗口', usedPercent: 58, resetsAt: offset(now, 3 * 24 * 60) }], cooldown: { active: false, until: null, reason: null }, recentError: null,
    },
    {
      id: 'upstream-cpa-lab-2', name: 'CPA Pro · 实验账号 02', provider: 'CLIProxyAPI', type: 'cpa_oauth', environment: 'experiment', status: 'auth_required', credentialConfigured: true, credentialValidation: 'failed', models: ['pro-oauth-lab'],
      health: { successRate: 81.2, latencyMs: 7_340, checkedAt: offset(now, -6) }, balance: { state: 'unknown', label: '认证后更新', updatedAt: null }, capacity: null,
      auth: { expiresAt: offset(now, 52), lastRefreshedAt: offset(now, -1_180) }, windows: [{ id: 'five_hour', label: '5 小时窗口', usedPercent: 92, resetsAt: offset(now, 52) }, { id: 'weekly', label: '周窗口', usedPercent: 77, resetsAt: offset(now, 3 * 24 * 60) }], cooldown: { active: true, until: offset(now, 28), reason: '刷新失败后进入短时冷却' },
      recentError: { category: 'authentication', summary: 'OAuth 刷新未完成，需要通过受保护部署流程重新授权', firstSeenAt: offset(now, -41), lastSeenAt: offset(now, -6) },
    },
  ]
}

export function createDemoUpstreams(query: UpstreamsQuery, newApi: NewApiStatus, cpa: PlatformProbeResult, now = new Date(), lastChecks?: ReadonlyMap<string, string>): UpstreamsResponse {
  const all = createUpstreamItems(now).map((item) => {
    const checkedAt = lastChecks?.get(item.id)
    return checkedAt ? { ...item, health: { ...item.health, checkedAt } } : item
  })
  const search = query.search.toLocaleLowerCase('zh-CN')
  const items = all.filter((item) => {
    const matchesSearch = !search || [item.name, item.provider, ...item.models].some((value) => value.toLocaleLowerCase('zh-CN').includes(search))
    return matchesSearch && (query.type === 'all' || item.type === query.type) && (query.status === 'all' || item.status === query.status)
  })
  const newApiState = newApi.state === 'ready' ? 'healthy' : newApi.state
  const liveText = newApiState === 'healthy' ? 'New API 管理连接已验证' : newApiState === 'reachable' ? 'New API 可达但等待管理认证' : newApiState === 'auth_required' ? 'New API 管理认证未通过' : 'New API 当前离线'
  return {
    meta: { source: 'demo', generatedAt: now.toISOString(), notice: `${liveText}；账号明细在管理适配器完成前使用演示数据`, live: { newApi: newApiState, cpa: cpa.state, checkedAt: now.toISOString() } },
    summary: { total: all.length, available: all.filter((item) => item.status === 'healthy').length, needsAttention: all.filter((item) => item.status !== 'healthy').length, official: all.filter((item) => item.type === 'official_api').length, experiment: all.filter((item) => item.type === 'cpa_oauth').length, configured: all.filter((item) => item.credentialConfigured).length },
    isolation: { enforced: true, productionToExperimentFallback: false, statement: '正式业务仅使用官方账号组；CPA Pro OAuth 仅用于隔离实验，不能成为正式路由的隐式回退。' },
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
