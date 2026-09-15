import { z } from 'zod'
import type { NewApiStatus } from './new-api-status.js'

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
  source: z.literal('configuration'),
  generatedAt: z.string().datetime(),
  total: z.number().int().nonnegative(),
  items: z.array(z.object({
    id: z.string(),
    level: z.enum(['warning', 'experiment', 'info']),
    title: z.string(),
    detail: z.string(),
    target: z.enum(['settings', 'upstreams', 'docs']),
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

export function createTaskSummary(now = new Date()): TaskSummary {
  const items: TaskSummary['items'] = []
  if (!process.env.NEW_API_ACCESS_TOKEN?.trim()) {
    items.push({ id: 'new-api-auth', level: 'warning', title: '配置 New API 管理认证', detail: '服务已可达，但人员、Key 和用量接口尚未授权', target: 'settings' })
  }
  if (!process.env.CPA_MANAGEMENT_KEY?.trim()) {
    items.push({ id: 'cpa-auth', level: 'experiment', title: '连接 CPA 隔离实验服务', detail: '仅用于 ecommerce-pro-lab，不得作为正式渠道回退', target: 'upstreams' })
  }
  if (process.env.CLIENT_VALIDATION_COMPLETE !== 'true') {
    items.push({ id: 'client-validation', level: 'info', title: '完成客户端最小链路验证', detail: '依次验证普通请求、流式、工具调用、取消与重启', target: 'docs' })
  }
  return { source: 'configuration', generatedAt: now.toISOString(), total: items.length, items }
}
