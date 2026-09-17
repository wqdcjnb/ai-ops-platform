import { z } from 'zod'
import type { NewApiStatus } from './new-api-status.js'
import { isAlertVisible, isDepartmentVisible, type DataScope } from './data-scope.js'
import type { PlatformDatabase } from './platform-db.js'

export const platformServiceStateSchema = z.enum(['healthy', 'reachable', 'auth_required', 'offline'])

const platformServiceSchema = z.object({
  id: z.enum(['bff', 'new-api', 'cpa']),
  name: z.string(),
  state: platformServiceStateSchema,
  detail: z.string(),
  checkedAt: z.string().datetime(),
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
    openAlerts: z.number().int().nonnegative(),
    criticalAlerts: z.number().int().nonnegative(),
    activeKeys: z.number().int().nonnegative(),
    expiringKeys: z.number().int().nonnegative(),
  }),
  items: z.array(z.object({
    id: z.string(),
    level: z.enum(['critical', 'warning', 'info']),
    title: z.string(),
    detail: z.string(),
    target: z.enum(['alerts', 'keys']),
  })),
})

export type TaskSummary = z.infer<typeof taskSummarySchema>

export interface PlatformProbeResult {
  state: 'reachable' | 'offline'
  checkedAt: string
}

export interface CreatePlatformStatusOptions {
  newApi: NewApiStatus
  cpa: PlatformProbeResult
  now?: Date
  newApiUrl?: string
  cpaUrl?: string
}

function safeHttpUrl(value: string, fallback: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback
    return url.toString().replace(/\/$/, '')
  } catch {
    return fallback
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

export function createPlatformStatus(options: CreatePlatformStatusOptions): PlatformStatus {
  const now = options.now ?? new Date()
  const generatedAt = now.toISOString()
  const newApiState: PlatformServiceState = options.newApi.state === 'ready'
    ? 'healthy'
    : options.newApi.state

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
      { id: 'cpa', name: 'CPA 实验服务', state: options.cpa.state, detail: options.cpa.state === 'reachable' ? '隔离实验入口可达' : '实验服务未响应', checkedAt: options.cpa.checkedAt },
    ],
    setup: [
      { id: 'new-api-service', label: 'New API 服务', state: newApiState === 'offline' ? 'pending' : 'done', detail: newApiState === 'offline' ? '启动本机 New API' : '公开状态接口已连通' },
      { id: 'new-api-auth', label: 'New API 管理认证', state: newApiState === 'healthy' ? 'done' : 'pending', detail: newApiState === 'healthy' ? '管理连接已验证' : '需要服务端管理凭据' },
      { id: 'cpa-service', label: 'CPA 隔离实验服务', state: options.cpa.state === 'reachable' ? 'done' : 'pending', detail: options.cpa.state === 'reachable' ? '实验入口已连通' : '尚未启动或配置' },
      { id: 'client-validation', label: '客户端链路验证', state: process.env.CLIENT_VALIDATION_COMPLETE === 'true' ? 'done' : 'pending', detail: process.env.CLIENT_VALIDATION_COMPLETE === 'true' ? '验证记录已确认' : 'Codex Desktop / WorkBuddy 尚待验证' },
    ],
    links: [
      { id: 'new-api', label: 'New API 管理后台', url: safeHttpUrl(options.newApiUrl ?? '', 'http://127.0.0.1:3000') },
      { id: 'cpa', label: 'CPA 管理后台', url: safeHttpUrl(options.cpaUrl ?? '', 'http://127.0.0.1:8317/management.html') },
    ],
  }
}

export function createTaskSummary(database: PlatformDatabase, now = new Date(), scope: DataScope = { mode: 'global' }): TaskSummary {
  const timestamp = now.getTime()
  const openAlerts = database.listAlertEvents().filter((event) => event.status === 'open' && isAlertVisible(database, scope, { type: event.subjectType, id: event.subjectId }))
  const criticalAlerts = openAlerts.filter((event) => event.severity === 'critical')
  const keys = database.listApiKeys().filter((key) => isDepartmentVisible(scope, key.departmentId))
  const activeKeys = keys.filter((key) => key.status !== 'revoked')
  const expiringKeys = activeKeys.filter((key) => {
    if (key.status === 'expiring') return true
    const expiresAt = key.expiresAt ? new Date(key.expiresAt).getTime() : Number.NaN
    return Number.isFinite(expiresAt) && expiresAt >= timestamp && expiresAt - timestamp <= 30 * 86_400_000
  })
  const items: TaskSummary['items'] = []

  if (criticalAlerts.length) {
    items.push({
      id: 'critical-alerts',
      level: 'critical',
      title: '处理严重告警',
      detail: `${criticalAlerts.length} 项严重事件待跟进；先在告警中心查看脱敏摘要和关联请求。`,
      target: 'alerts',
    })
  }
  const nonCriticalAlerts = openAlerts.filter((event) => event.severity !== 'critical')
  if (nonCriticalAlerts.length) {
    items.push({
      id: 'open-alerts',
      level: 'warning',
      title: '跟进待处理告警',
      detail: `${nonCriticalAlerts.length} 项警告或提示事件仍处于待处理状态；当前不开放确认或关闭操作。`,
      target: 'alerts',
    })
  }
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
    summary: { openAlerts: openAlerts.length, criticalAlerts: criticalAlerts.length, activeKeys: activeKeys.length, expiringKeys: expiringKeys.length },
    items,
  }
}
