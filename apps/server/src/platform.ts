import { z } from 'zod'
import type { NewApiStatus } from './new-api-status.js'
import { isDepartmentVisible, type DataScope } from './data-scope.js'
import type { PlatformDatabase } from './platform-db.js'
import { dockerServiceIdSchema, type DockerServiceSnapshot } from './docker-control.js'

export const platformServiceStateSchema = z.enum(['healthy', 'reachable', 'auth_required', 'offline'])

const platformServiceSchema = z.object({
  id: z.enum(['bff', 'new-api', 'cpa']),
  name: z.string(),
  state: platformServiceStateSchema,
  detail: z.string(),
  checkedAt: z.string().datetime(),
})

const dockerServiceSchema = z.object({
  id: dockerServiceIdSchema,
  name: z.string(),
  role: z.string(),
  state: z.enum(['healthy', 'reachable', 'offline']),
  detail: z.string(),
  checkedAt: z.string().datetime(),
  container: z.object({
    id: z.string(),
    name: z.string(),
    image: z.string(),
    state: z.string(),
    status: z.string(),
    health: z.enum(['healthy', 'unhealthy', 'starting', 'none', 'unknown']),
  }).nullable(),
})

const setupItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  state: z.enum(['done', 'pending']),
  detail: z.string(),
})

export const platformStatusSchema = z.object({
  meta: z.object({
    source: z.literal('live'),
    generatedAt: z.string().datetime(),
  }),
  services: z.array(platformServiceSchema).length(3),
  // Keep the legacy logical probes above for existing API consumers. The
  // unified entry page renders this Compose-level four-service matrix.
  dockerServices: z.array(dockerServiceSchema).length(4).optional(),
  dockerControl: z.object({
    enabled: z.boolean(),
    available: z.boolean(),
    projectName: z.string(),
    notice: z.string(),
  }).optional(),
  setup: z.array(setupItemSchema),
  links: z.array(z.object({
    id: z.enum(['new-api', 'cpa']),
    label: z.string(),
    url: z.string().url(),
  })).length(2),
})

export type PlatformStatus = z.infer<typeof platformStatusSchema>
export type PlatformServiceState = z.infer<typeof platformServiceStateSchema>

export const taskSummarySchema = z.object({
  source: z.literal('database'),
  simulated: z.literal(true),
  generatedAt: z.string().datetime(),
  total: z.number().int().nonnegative(),
  summary: z.object({
    activeKeys: z.number().int().nonnegative(),
    expiringKeys: z.number().int().nonnegative(),
  }),
  items: z.array(z.object({
    id: z.string(),
    level: z.enum(['critical', 'warning', 'info']),
    title: z.string(),
    detail: z.string(),
    target: z.literal('keys'),
  })),
})

export type TaskSummary = z.infer<typeof taskSummarySchema>

export interface PlatformProbeResult {
  state: 'reachable' | 'offline'
  checkedAt: string
  /** Optional live catalog details used by the CPA upstream summary. */
  configured?: boolean
  /** Whether AI OPS has a server-side CPA client credential to probe with. */
  credentialConfigured?: boolean
  authRequired?: boolean
  models?: string[]
  latencyMs?: number
}

export interface CreatePlatformStatusOptions {
  newApi: NewApiStatus
  cpa: PlatformProbeResult
  now?: Date
  newApiUrl?: string
  cpaUrl?: string
  dockerServices?: DockerServiceSnapshot[]
  dockerControl?: {
    enabled: boolean
    available: boolean
    projectName: string
    notice: string
  }
}

export async function probeHttpService(url: string, timeoutMs = 1_200): Promise<PlatformProbeResult> {
  const checkedAt = new Date().toISOString()
  try {
    const response = await fetch(url, {
      headers: { accept: 'text/html,application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
    return { state: response.status < 500 ? 'reachable' : 'offline', checkedAt }
  } catch {
    return { state: 'offline', checkedAt }
  }
}

/** Probe CPA's OpenAI-compatible data endpoint without exposing its API key. */
export async function probeCpaFromEnvironment(timeoutMs = 1_500): Promise<PlatformProbeResult> {
  const checkedAt = new Date().toISOString()
  const gatewayMode = process.env.AI_OPS_GATEWAY_MODE?.trim() || 'cpa'
  const genericGatewayBase = process.env.AI_OPS_GATEWAY_UPSTREAM_BASE_URL?.trim()
  const cpaGatewayBase = process.env.AI_OPS_GATEWAY_CPA_BASE_URL?.trim()
  // CPA remains the account-pool source even when employee traffic is routed
  // through New API. Do not gate this probe on the active data-plane mode.
  const gatewayBase = cpaGatewayBase || (gatewayMode === 'cpa' ? genericGatewayBase : undefined)
  const configuredBase = gatewayBase?.trim() || (gatewayMode === 'cpa' ? 'http://127.0.0.1:8317/v1' : undefined)
  const legacyBase = process.env.CPA_BASE_URL?.trim()
  const baseUrl = configuredBase || legacyBase || 'http://127.0.0.1:8317/management.html'
  const url = configuredBase
    ? `${configuredBase.replace(/\/$/, '')}/models`
    : baseUrl
  const genericGatewayKey = process.env.AI_OPS_GATEWAY_UPSTREAM_API_KEY?.trim()
  const cpaGatewayKey = process.env.AI_OPS_GATEWAY_CPA_API_KEY?.trim()
  const configuredApiKey = gatewayBase
    ? (genericGatewayKey || cpaGatewayKey)
    : undefined
  const configured = Boolean(configuredBase)
  const credentialConfigured = Boolean(configuredBase && configuredApiKey)
  const startedAt = Date.now()
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        ...(configuredApiKey ? { authorization: `Bearer ${configuredApiKey}` } : {}),
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
    const payload = configuredBase ? await response.json().catch(() => null) as { data?: unknown } | null : null
    const models = Array.isArray(payload?.data)
      ? payload.data.flatMap((item) => typeof item === 'object' && item !== null && typeof (item as { id?: unknown }).id === 'string' ? [(item as { id: string }).id] : [])
      : []
    return {
      state: response.status < 500 ? 'reachable' : 'offline',
      checkedAt,
      configured,
      credentialConfigured,
      authRequired: response.status === 401 || response.status === 403,
      models,
      latencyMs: Date.now() - startedAt,
    }
  } catch {
    return { state: 'offline', checkedAt, configured, credentialConfigured, models: [], latencyMs: Date.now() - startedAt }
  }
}

export function createPlatformStatus(options: CreatePlatformStatusOptions): PlatformStatus {
  const now = options.now ?? new Date()
  const generatedAt = now.toISOString()
  const upstreamConfigUrl = 'http://127.0.0.1:4174/upstreams'
  const newApiState: PlatformServiceState = options.newApi.state === 'ready'
    ? 'healthy'
    : options.newApi.state
  const dockerServices = options.dockerServices?.map(({ container, ...service }) => ({
    ...service,
    container: container ? {
      id: container.id,
      name: container.name,
      image: container.image,
      state: container.state,
      status: container.status,
      health: container.health,
    } : null,
  })) ?? [
    { id: 'web' as const, name: 'AI OPS Web', role: '管理界面', state: 'healthy' as const, detail: '前端由 Docker Compose 管理', checkedAt: generatedAt, container: null },
    { id: 'server' as const, name: 'AI OPS Server', role: 'BFF 与网关', state: 'healthy' as const, detail: '当前管理请求正在此服务处理', checkedAt: generatedAt, container: null },
    { id: 'new-api' as const, name: 'New API', role: 'Token 与渠道管理', state: (newApiState === 'offline' ? 'offline' : 'healthy') as 'healthy' | 'offline', detail: newApiState === 'healthy' ? '管理连接已验证' : newApiState === 'offline' ? '服务未响应' : '服务可达，等待管理认证', checkedAt: options.newApi.checkedAt, container: null },
    { id: 'cpa' as const, name: 'CPA Codex OAuth', role: '账号池与模型上游', state: options.cpa.state === 'offline' ? 'offline' as const : 'healthy' as const, detail: options.cpa.authRequired ? '服务可达，但客户端认证未通过' : options.cpa.state === 'reachable' ? 'OAuth 数据入口可达' : 'OAuth 账号池已连接', checkedAt: options.cpa.checkedAt, container: null },
  ]

  return {
    meta: { source: 'live', generatedAt },
    services: [
      { id: 'bff', name: '运营平台 BFF', state: 'healthy', detail: '页面数据与权限边界服务', checkedAt: generatedAt },
      {
        id: 'new-api',
        name: 'New API',
        state: newApiState,
        detail: newApiState === 'healthy' ? '管理连接已验证' : newApiState === 'reachable' ? '服务可达，等待管理认证' : newApiState === 'auth_required' ? '管理认证未通过' : '本机服务未响应',
        checkedAt: options.newApi.checkedAt,
      },
      { id: 'cpa', name: 'CPA Codex OAuth', state: options.cpa.state, detail: options.cpa.authRequired ? 'CPA 客户端认证未通过，请检查 OAuth 登录和客户端 Key' : options.cpa.state === 'reachable' ? 'OAuth 数据入口可达' : 'CPA 服务未响应', checkedAt: options.cpa.checkedAt },
    ],
    dockerServices,
    dockerControl: options.dockerControl ?? { enabled: false, available: false, projectName: 'ai-ops-platform', notice: 'Docker 控制未启用' },
    setup: [
      { id: 'new-api-service', label: 'New API 服务', state: newApiState === 'offline' ? 'pending' : 'done', detail: newApiState === 'offline' ? '启动本机 New API' : '公开状态接口已连通' },
      { id: 'new-api-auth', label: 'New API 员工网关', state: newApiState === 'healthy' ? 'done' : 'pending', detail: newApiState === 'healthy' ? '员工请求入口已验证' : '需要在上游账号中配置并验证' },
      { id: 'cpa-service', label: 'CPA OAuth 账号池', state: options.cpa.state === 'reachable' && !options.cpa.authRequired ? 'done' : 'pending', detail: options.cpa.authRequired ? '服务可达，但客户端认证未通过' : options.cpa.state === 'reachable' ? 'OAuth 账号池入口已连通' : '尚未启动或配置' },
      { id: 'client-validation', label: '客户端链路验证', state: process.env.CLIENT_VALIDATION_COMPLETE === 'true' ? 'done' : 'pending', detail: process.env.CLIENT_VALIDATION_COMPLETE === 'true' ? '验证记录已确认' : 'Codex Desktop / WorkBuddy 尚待验证' },
    ],
    links: [
      { id: 'new-api', label: '配置 CPA 账号池 → New API 员工网关', url: upstreamConfigUrl },
      { id: 'cpa', label: '验证 CPA OAuth 账号池', url: upstreamConfigUrl },
    ],
  }
}

export function createTaskSummary(database: PlatformDatabase, now = new Date(), scope: DataScope = { mode: 'global' }): TaskSummary {
  const timestamp = now.getTime()
  const keys = database.listApiKeys().filter((key) => isDepartmentVisible(scope, key.departmentId))
  const activeKeys = keys.filter((key) => key.status !== 'revoked')
  const expiringKeys = activeKeys.filter((key) => {
    if (key.status === 'expiring') return true
    const expiresAt = key.expiresAt ? new Date(key.expiresAt).getTime() : Number.NaN
    return Number.isFinite(expiresAt) && expiresAt >= timestamp && expiresAt - timestamp <= 30 * 86_400_000
  })
  const items: TaskSummary['items'] = []

  if (expiringKeys.length) {
    items.push({
      id: 'expiring-keys',
      level: 'info',
      title: '核查临期 Key',
      detail: `${expiringKeys.length} 个有效 Key 将在 30 天内到期；列表仅显示掩码，不回显完整凭据。`,
      target: 'keys',
    })
  }

  return {
    source: 'database',
    simulated: true,
    generatedAt: now.toISOString(),
    total: items.length,
    summary: { activeKeys: activeKeys.length, expiringKeys: expiringKeys.length },
    items,
  }
}
