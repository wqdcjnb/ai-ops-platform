import { z } from 'zod'
import { withCsrfHeader } from './csrf'

export const catalogSourceSchema = z.enum(['demo', 'new_api', 'cpa'])
export const modelFiltersSchema = z.object({ source: catalogSourceSchema.default('demo'), search: z.string().max(60), capability: z.enum(['all', 'text', 'reasoning', 'translation', 'vision', 'batch']), environment: z.enum(['all', 'production', 'experiment', 'unassigned']), status: z.enum(['all', 'available', 'degraded', 'unavailable', 'unverified']) })
export const channelFiltersSchema = z.object({ source: catalogSourceSchema.default('demo'), environment: z.enum(['all', 'production', 'experiment', 'unassigned']), status: z.enum(['all', 'healthy', 'degraded', 'offline', 'unverified']) })
export const modelItemSchema = z.object({
  id: z.string(), displayName: z.string(), provider: z.string(), actualModel: z.string(), aliases: z.array(z.string()), capabilities: z.array(z.enum(['text', 'reasoning', 'translation', 'vision', 'batch'])), contextWindow: z.number().int().positive().nullable(), region: z.string(), environment: z.enum(['production', 'experiment', 'unassigned']), status: z.enum(['available', 'degraded', 'unavailable', 'unverified']),
  pricing: z.object({ inputPerMillion: z.number().nonnegative(), outputPerMillion: z.number().nonnegative(), currency: z.literal('USD'), basis: z.enum(['official', 'estimated']), updatedAt: z.string() }).nullable(),
  purposes: z.array(z.object({ name: z.string(), alias: z.string(), role: z.enum(['primary', 'fallback']) })), channelIds: z.array(z.string()),
  channels: z.array(z.object({ id: z.string(), name: z.string(), provider: z.string().optional(), source: z.enum(['cpa_auth_file', 'new_api']).optional() })).optional(),
  testResult: z.object({ status: z.enum(['passed', 'failed', 'not_tested', 'unavailable']), latencyMs: z.number().int().nonnegative().nullable(), testedAt: z.string().datetime().nullable(), channelId: z.string().nullable(), message: z.string().nullable(), testPath: z.string().nullable() }).optional(),
})
export const channelItemSchema = z.object({
  id: z.string(), name: z.string(), provider: z.string(), type: z.enum(['official_api', 'cpa_oauth', 'unknown']), environment: z.enum(['production', 'experiment', 'unassigned']), status: z.enum(['healthy', 'degraded', 'offline', 'unverified']), modelIds: z.array(z.string()), latencyMs: z.number().int().nonnegative().nullable(), successRate: z.number().min(0).max(100).nullable(), balanceState: z.enum(['sufficient', 'low', 'unknown']), rateLimits: z.object({ rpm: z.number().int().positive().nullable(), tpm: z.number().int().positive().nullable() }), recentError: z.object({ category: z.enum(['rate_limit', 'timeout', 'authentication', 'server']), summary: z.string(), occurredAt: z.string() }).nullable(), checkedAt: z.string().nullable(), credentialConfigured: z.boolean().nullable(),
})
export const modelsResponseSchema = z.object({ meta: z.object({ source: catalogSourceSchema, generatedAt: z.string().datetime(), notice: z.string() }), summary: z.object({ total: z.number().int().nonnegative(), available: z.number().int().nonnegative(), degraded: z.number().int().nonnegative(), production: z.number().int().nonnegative(), experiment: z.number().int().nonnegative() }), options: z.object({ capabilities: z.array(z.object({ id: z.enum(['text', 'reasoning', 'translation', 'vision', 'batch']), label: z.string() })) }), items: z.array(modelItemSchema), total: z.number().int().nonnegative() })
export const channelsResponseSchema = z.object({ meta: z.object({ source: catalogSourceSchema, generatedAt: z.string().datetime(), notice: z.string(), healthCacheSeconds: z.number().int().nonnegative() }), summary: z.object({ total: z.number().int().nonnegative(), healthy: z.number().int().nonnegative(), degraded: z.number().int().nonnegative(), offline: z.number().int().nonnegative() }), items: z.array(channelItemSchema), total: z.number().int().nonnegative() })
export const channelCheckBodySchema = z.object({ idempotencyKey: z.string().regex(/^channel-check-[a-z0-9-]{8,96}$/), reason: z.string().trim().min(8).max(200), acknowledgeSynthetic: z.literal(true) })
export const channelCheckResponseSchema = z.object({ meta: z.object({ source: z.literal('database'), completedAt: z.string(), notice: z.string() }), channel: channelItemSchema, operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }) })
export const channelSyncPreviewSchema = z.object({
  cpa: z.object({ state: z.enum(['ready', 'auth_required', 'unavailable', 'invalid_response', 'not_configured']), baseUrl: z.string(), modelIds: z.array(z.string()), credentialConfigured: z.boolean(), checkedAt: z.string().datetime() }),
  target: z.object({ marker: z.literal('ai-ops:cpa:codex'), externalChannelId: z.string().nullable(), action: z.enum(['create', 'update', 'enable', 'blocked', 'unchanged']) }),
  changes: z.array(z.string()), canApply: z.boolean(), requestId: z.string(),
})
export const channelSyncBodySchema = z.object({ idempotencyKey: z.string().regex(/^channel-sync-[A-Za-z0-9._:-]{8,96}$/) })
export const channelSyncResponseSchema = channelSyncPreviewSchema.extend({ status: z.enum(['succeeded', 'unchanged']), operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }) })
export const modelTestBodySchema = z.object({ model: z.string().trim().min(1).max(256), channelId: z.string().trim().min(1).max(128).optional() })
export const modelTestResponseSchema = z.object({
  meta: z.object({ source: z.literal('new_api'), completedAt: z.string().datetime(), notice: z.string() }),
  result: z.object({ model: z.string(), channelId: z.string(), channelName: z.string(), status: z.enum(['passed', 'failed', 'unavailable']), latencyMs: z.number().int().nonnegative().nullable(), testedAt: z.string().datetime(), message: z.string().nullable(), testPath: z.string().nullable() }),
  requestId: z.string(),
})

export type ModelFilters = z.input<typeof modelFiltersSchema>
export type ChannelFilters = z.input<typeof channelFiltersSchema>
export type CatalogSource = z.infer<typeof catalogSourceSchema>
export type ModelsResponse = z.infer<typeof modelsResponseSchema>
export type ChannelsResponse = z.infer<typeof channelsResponseSchema>
export type ModelItem = z.infer<typeof modelItemSchema>
export type ChannelItem = z.infer<typeof channelItemSchema>
export type ChannelCheckBody = z.infer<typeof channelCheckBodySchema>
export type ChannelCheckResponse = z.infer<typeof channelCheckResponseSchema>
export type ChannelSyncPreview = z.infer<typeof channelSyncPreviewSchema>
export type ChannelSyncBody = z.infer<typeof channelSyncBodySchema>
export type ChannelSyncResponse = z.infer<typeof channelSyncResponseSchema>
export type ModelTestBody = z.infer<typeof modelTestBodySchema>
export type ModelTestResponse = z.infer<typeof modelTestResponseSchema>

export class ModelsApiError extends Error {
  constructor(message: string, readonly requestId?: string) { super(message); this.name = 'ModelsApiError' }
}

async function getResource<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' }, signal })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const messages: Record<string, string> = {
      AUTH_REQUIRED: '登录已过期，请重新登录后重试。', AUTH_FORBIDDEN: '当前身份无权读取 New API 管理目录。',
      NEW_API_AUTH_REQUIRED: 'New API 管理认证未配置或未通过，请检查服务端连接配置。',
      NEW_API_UNAVAILABLE: 'New API 暂时不可用，请确认服务已启动、管理令牌有效后重试。',
      NEW_API_INVALID_DATA: 'New API 数据格式不受支持，请检查版本兼容性。',
      NEW_API_CATALOG_LIMIT: 'New API 目录超过读取上限，请联系管理员。',
      CPA_NOT_ACTIVE: '当前网关不是 CPA 模式，请检查服务端配置。',
      CPA_NOT_CONFIGURED: 'CPA 尚未配置，请填写 CPA Base URL 和客户端 Key。',
      CPA_AUTH_REQUIRED: 'CPA 模型目录认证失败，请检查 CPA 的 Codex OAuth 登录和客户端 Key。',
      CPA_UNAVAILABLE: 'CPA 暂时不可用，请确认 CPA 已启动并完成 Codex OAuth 登录。',
      CPA_INVALID_DATA: 'CPA 返回的模型目录格式无效，请检查 CPA 版本。',
    }
    throw new ModelsApiError(messages[body?.error?.code] ?? '模型目录暂时无法加载，请重试。', requestId)
  }
  const parsed = schema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new ModelsApiError('模型目录格式不符合接口约定', requestId)
  return parsed.data
}

async function getChannelSyncResource(signal?: AbortSignal): Promise<ChannelSyncPreview> {
  const response = await fetch('/api/integrations/new-api/channel/sync/preview', { headers: { accept: 'application/json' }, signal })
  const requestId = response.headers.get('x-request-id') ?? undefined
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | ChannelSyncPreview | null
  if (!response.ok) throw new ModelsApiError((body && 'error' in body ? body.error?.message : undefined) ?? 'New API CPA 渠道预览未完成，请稍后重试', requestId)
  const parsed = channelSyncPreviewSchema.safeParse(body)
  if (!parsed.success) throw new ModelsApiError('New API CPA 渠道预览响应格式不符合接口约定', requestId)
  return parsed.data
}

export function fetchModels(filters: ModelFilters, signal?: AbortSignal) {
  const value = modelFiltersSchema.parse(filters)
  return getResource(`/api/models?${new URLSearchParams(value)}`, modelsResponseSchema, signal)
}
export function fetchChannels(filters: ChannelFilters, signal?: AbortSignal) {
  const value = channelFiltersSchema.parse(filters)
  return getResource(`/api/channels?${new URLSearchParams(value)}`, channelsResponseSchema, signal)
}

export function fetchChannelSyncPreview(signal?: AbortSignal) {
  return getChannelSyncResource(signal)
}

export async function syncCpaChannel(payload: ChannelSyncBody): Promise<ChannelSyncResponse> {
  const body = channelSyncBodySchema.parse(payload)
  const response = await fetch('/api/integrations/new-api/channel/sync', {
    method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(body),
  })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new ModelsApiError(detail?.error?.message ?? 'New API CPA 渠道同步未完成，请稍后重试', requestId)
  }
  const parsed = channelSyncResponseSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new ModelsApiError('New API CPA 渠道同步响应格式不符合接口约定', requestId)
  return parsed.data
}

export async function testModel(payload: ModelTestBody, signal?: AbortSignal): Promise<ModelTestResponse> {
  const body = modelTestBodySchema.parse(payload)
  const response = await fetch('/api/models/test', {
    method: 'POST',
    headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }),
    body: JSON.stringify(body),
    signal,
  })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new ModelsApiError(detail?.error?.message ?? '模型测试未完成，请稍后重试', requestId)
  }
  const parsed = modelTestResponseSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new ModelsApiError('模型测试响应格式不符合接口约定', requestId)
  return parsed.data
}

export async function checkSyntheticChannel(id: string, payload: ChannelCheckBody): Promise<ChannelCheckResponse> {
  const body = channelCheckBodySchema.parse(payload)
  const response = await fetch(`/api/channels/${encodeURIComponent(id)}/check`, {
    method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(body),
  })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new ModelsApiError(detail?.error?.message ?? '本地模拟复检失败', requestId)
  }
  const parsed = channelCheckResponseSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new ModelsApiError('本地模拟复检响应格式不符合接口约定', requestId)
  return parsed.data
}
