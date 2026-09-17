import { z } from 'zod'
import type { NewApiStatus } from './new-api-status.js'
import type { PlatformDatabase } from './platform-db.js'

export const routesQuerySchema = z.object({
  search: z.string().trim().max(60).default(''),
  category: z.enum(['all', 'copy', 'service', 'translate', 'analysis', 'automation', 'experiment']).default('all'),
  environment: z.enum(['all', 'production', 'experiment']).default('all'),
  status: z.enum(['all', 'healthy', 'degraded', 'disabled']).default('all'),
})

const routeTargetSchema = z.object({
  channel: z.string(),
  provider: z.string(),
  model: z.string(),
  group: z.enum(['production', 'experiment']),
  status: z.enum(['healthy', 'degraded', 'disabled']),
})

export const routeItemSchema = z.object({
  id: z.string(),
  category: z.enum(['copy', 'service', 'translate', 'analysis', 'automation', 'experiment']),
  categoryLabel: z.string(),
  name: z.string(),
  description: z.string(),
  alias: z.string().regex(/^ecommerce-[a-z-]+$/),
  environment: z.enum(['production', 'experiment']),
  status: z.enum(['healthy', 'degraded', 'disabled']),
  dataClass: z.enum(['internal', 'confidential', 'restricted']),
  allowedRoles: z.array(z.string()),
  primary: routeTargetSchema,
  fallbacks: z.array(routeTargetSchema),
  policy: z.object({
    timeoutSeconds: z.number().int().positive(),
    maxRetries: z.number().int().nonnegative(),
    circuitBreakSeconds: z.number().int().positive(),
    onTimeout: z.enum(['fallback', 'fail']),
    onRateLimit: z.enum(['fallback', 'retry']),
    onServerError: z.enum(['fallback', 'retry']),
    crossGroupFallback: z.literal(false),
    clientChannelOverride: z.literal(false),
  }),
  usage: z.object({ requests7d: z.number().int().nonnegative(), successRate: z.number().min(0).max(100), p95LatencyMs: z.number().int().nonnegative() }),
})

export const routesResponseSchema = z.object({
  meta: z.object({ source: z.enum(['demo', 'database']), generatedAt: z.string().datetime(), notice: z.string() }),
  summary: z.object({ total: z.number().int().nonnegative(), production: z.number().int().nonnegative(), experiment: z.number().int().nonnegative(), degraded: z.number().int().nonnegative() }),
  options: z.object({ categories: z.array(z.object({ id: z.enum(['copy', 'service', 'translate', 'analysis', 'automation', 'experiment']), label: z.string() })) }),
  isolation: z.object({ enforced: z.literal(true), productionGroup: z.literal('official'), experimentGroup: z.literal('cpa-lab'), message: z.string() }),
  items: z.array(routeItemSchema),
  total: z.number().int().nonnegative(),
})

export type RoutesQuery = z.infer<typeof routesQuerySchema>
export type RoutesResponse = z.infer<typeof routesResponseSchema>
export type RouteItem = z.infer<typeof routeItemSchema>

export const routeIdParamsSchema = z.object({
  id: z.string().regex(/^route-[a-z-]+$/),
})

export const routePolicyUpdateBodySchema = z.object({
  onTimeout: z.enum(['fallback', 'fail']),
  onRateLimit: z.enum(['fallback', 'retry']),
  onServerError: z.enum(['fallback', 'retry']),
  maxRetries: z.coerce.number().int().min(0).max(3),
  idempotencyKey: z.string().regex(/^route-update-[a-z0-9-]{8,96}$/),
  reason: z.string().trim().min(8).max(200),
  acknowledgeImpact: z.literal(true),
})

export const routePolicyUpdateResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), completedAt: z.string().datetime(), notice: z.string() }),
  route: routeItemSchema,
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})

export type RoutePolicyUpdateBody = z.infer<typeof routePolicyUpdateBodySchema>
export type RoutePolicyUpdateResponse = z.infer<typeof routePolicyUpdateResponseSchema>

const policy: RouteItem['policy'] = {
  timeoutSeconds: 45,
  maxRetries: 2,
  circuitBreakSeconds: 60,
  onTimeout: 'fallback',
  onRateLimit: 'fallback',
  onServerError: 'retry',
  crossGroupFallback: false,
  clientChannelOverride: false,
}

const demoRoutes: RouteItem[] = [
  {
    id: 'route-copy', category: 'copy', categoryLabel: '文案', name: '商品文案', description: '商品标题、卖点与详情页文案生成', alias: 'ecommerce-copy', environment: 'production', status: 'healthy', dataClass: 'confidential', allowedRoles: ['内容运营', '商品运营'],
    primary: { channel: 'Official CN · 01', provider: 'OpenAI Compatible', model: 'gpt-5.1-mini', group: 'production', status: 'healthy' },
    fallbacks: [{ channel: 'Official CN · 02', provider: 'OpenAI Compatible', model: 'gpt-5.1-mini', group: 'production', status: 'healthy' }], policy, usage: { requests7d: 3_842, successRate: 99.3, p95LatencyMs: 2_140 },
  },
  {
    id: 'route-service', category: 'service', categoryLabel: '客服', name: '客服回复', description: '售前咨询、售后解释与回复建议', alias: 'ecommerce-service', environment: 'production', status: 'healthy', dataClass: 'restricted', allowedRoles: ['客服专员', '客服主管'],
    primary: { channel: 'Official CN · 02', provider: 'OpenAI Compatible', model: 'gpt-5.1-mini', group: 'production', status: 'healthy' },
    fallbacks: [{ channel: 'Official CN · 01', provider: 'OpenAI Compatible', model: 'gpt-5.1-mini', group: 'production', status: 'healthy' }], policy: { ...policy, timeoutSeconds: 30 }, usage: { requests7d: 2_976, successRate: 99.6, p95LatencyMs: 1_620 },
  },
  {
    id: 'route-translate', category: 'translate', categoryLabel: '翻译', name: '多语翻译', description: '跨境商品信息和运营素材本地化', alias: 'ecommerce-translate', environment: 'production', status: 'healthy', dataClass: 'confidential', allowedRoles: ['跨境运营', '本地化专员'],
    primary: { channel: 'Official Global · 01', provider: 'OpenAI Compatible', model: 'gpt-5.1', group: 'production', status: 'healthy' },
    fallbacks: [{ channel: 'Official CN · 01', provider: 'OpenAI Compatible', model: 'gpt-5.1-mini', group: 'production', status: 'healthy' }], policy, usage: { requests7d: 2_214, successRate: 98.9, p95LatencyMs: 2_480 },
  },
  {
    id: 'route-analysis', category: 'analysis', categoryLabel: '分析', name: '策略分析', description: '竞品、投放与选品策略推理', alias: 'ecommerce-analysis', environment: 'production', status: 'degraded', dataClass: 'confidential', allowedRoles: ['运营主管', '投放策略师'],
    primary: { channel: 'Official Global · 01', provider: 'OpenAI Compatible', model: 'gpt-5.1', group: 'production', status: 'degraded' },
    fallbacks: [{ channel: 'Official CN · 02', provider: 'OpenAI Compatible', model: 'gpt-5.1-mini', group: 'production', status: 'healthy' }], policy: { ...policy, timeoutSeconds: 60, maxRetries: 1 }, usage: { requests7d: 1_486, successRate: 96.8, p95LatencyMs: 4_920 },
  },
  {
    id: 'route-general', category: 'automation', categoryLabel: '自动化', name: '通用运营', description: '低风险整理、分类与批处理任务', alias: 'ecommerce-general', environment: 'production', status: 'healthy', dataClass: 'internal', allowedRoles: ['全部试点岗位'],
    primary: { channel: 'Official CN · 01', provider: 'OpenAI Compatible', model: 'gpt-5.1-mini', group: 'production', status: 'healthy' },
    fallbacks: [{ channel: 'Official CN · 02', provider: 'OpenAI Compatible', model: 'gpt-5.1-mini', group: 'production', status: 'healthy' }], policy: { ...policy, timeoutSeconds: 30 }, usage: { requests7d: 4_932, successRate: 99.5, p95LatencyMs: 1_410 },
  },
  {
    id: 'route-image-check', category: 'automation', categoryLabel: '自动化', name: '图片检查', description: '商品图片基础合规和内容检查', alias: 'ecommerce-image-check', environment: 'production', status: 'healthy', dataClass: 'confidential', allowedRoles: ['商品运营', '质检专员'],
    primary: { channel: 'Official Vision · 01', provider: 'OpenAI Compatible', model: 'gpt-5.1-vision', group: 'production', status: 'healthy' },
    fallbacks: [], policy: { ...policy, onTimeout: 'fail', onRateLimit: 'retry' }, usage: { requests7d: 824, successRate: 98.4, p95LatencyMs: 3_780 },
  },
  {
    id: 'route-pro-lab', category: 'experiment', categoryLabel: '实验', name: '高能力实验', description: '隔离环境中的短期能力验证，不承载正式业务', alias: 'ecommerce-pro-lab', environment: 'experiment', status: 'healthy', dataClass: 'internal', allowedRoles: ['超级管理员', '指定测试人员'],
    primary: { channel: 'CPA Lab · 01', provider: 'CLIProxyAPI', model: 'pro-oauth-lab', group: 'experiment', status: 'healthy' },
    fallbacks: [], policy: { ...policy, timeoutSeconds: 90, maxRetries: 0, onTimeout: 'fail', onRateLimit: 'retry', onServerError: 'retry' }, usage: { requests7d: 146, successRate: 94.5, p95LatencyMs: 6_820 },
  },
]

function noticeFor(newApi: NewApiStatus) {
  if (newApi.state === 'ready') return 'New API 管理连接已验证；路由字段映射完成前，本页仍使用演示配置'
  if (newApi.state === 'reachable') return 'New API 服务可达但尚未配置管理认证；用途与路由为演示配置'
  if (newApi.state === 'auth_required') return 'New API 管理认证未通过；用途与路由为演示配置'
  return 'New API 当前离线；用途与路由为演示配置'
}

export function createDemoRoutes(query: RoutesQuery, newApi: NewApiStatus, now = new Date()): RoutesResponse {
  return createRoutes(query, newApi, demoRoutes, 'demo', now)
}

export function createDatabaseRoutes(database: PlatformDatabase, query: RoutesQuery, newApi: NewApiStatus, now = new Date()): RoutesResponse {
  const overrides = new Map(database.listRoutePolicyOverrides().map((item) => [item.routeId, item]))
  const items = demoRoutes.map((item) => {
    const override = overrides.get(item.id)
    return override
      ? { ...item, policy: { ...item.policy, onTimeout: override.onTimeout, onRateLimit: override.onRateLimit, onServerError: override.onServerError, maxRetries: override.maxRetries } }
      : { ...item, policy: { ...item.policy } }
  })
  return createRoutes(query, newApi, items, 'database', now)
}

function createRoutes(query: RoutesQuery, newApi: NewApiStatus, source: RouteItem[], sourceKind: 'demo' | 'database', now: Date): RoutesResponse {
  const search = query.search.toLocaleLowerCase('zh-CN')
  const items = source.filter((item) => {
    const matchesSearch = !search || [item.name, item.description, item.alias, item.primary.channel, item.primary.model, ...item.allowedRoles].some((value) => value.toLocaleLowerCase('zh-CN').includes(search))
    return matchesSearch && (query.category === 'all' || item.category === query.category) && (query.environment === 'all' || item.environment === query.environment) && (query.status === 'all' || item.status === query.status)
  })
  return {
    meta: {
      source: sourceKind,
      generatedAt: now.toISOString(),
      notice: sourceKind === 'database'
        ? `${noticeFor(newApi)}；本地 SQLite 可保存降级与重试策略，未调用 New API 或实际路由。`
        : noticeFor(newApi),
    },
    summary: { total: source.length, production: source.filter((item) => item.environment === 'production').length, experiment: source.filter((item) => item.environment === 'experiment').length, degraded: source.filter((item) => item.status === 'degraded').length },
    options: { categories: [{ id: 'copy', label: '文案' }, { id: 'service', label: '客服' }, { id: 'translate', label: '翻译' }, { id: 'analysis', label: '分析' }, { id: 'automation', label: '自动化' }, { id: 'experiment', label: '实验' }] },
    isolation: { enforced: true, productionGroup: 'official', experimentGroup: 'cpa-lab', message: '正式路由只能在官方渠道组内回退；CPA 实验渠道禁止承接正式业务流量。' },
    items, total: items.length,
  }
}
