import { z } from 'zod'

export const catalogSourceSchema = z.enum(['demo', 'new_api'])
export const modelFiltersSchema = z.object({ source: catalogSourceSchema.default('demo'), search: z.string().max(60), capability: z.enum(['all', 'text', 'reasoning', 'translation', 'vision', 'batch']), environment: z.enum(['all', 'production', 'experiment', 'unassigned']), status: z.enum(['all', 'available', 'degraded', 'unavailable', 'unverified']) })
export const channelFiltersSchema = z.object({ source: catalogSourceSchema.default('demo'), environment: z.enum(['all', 'production', 'experiment', 'unassigned']), status: z.enum(['all', 'healthy', 'degraded', 'offline', 'unverified']) })
export const modelItemSchema = z.object({
  id: z.string(), displayName: z.string(), provider: z.string(), actualModel: z.string(), aliases: z.array(z.string()), capabilities: z.array(z.enum(['text', 'reasoning', 'translation', 'vision', 'batch'])), contextWindow: z.number().int().positive().nullable(), region: z.string(), environment: z.enum(['production', 'experiment', 'unassigned']), status: z.enum(['available', 'degraded', 'unavailable', 'unverified']),
  pricing: z.object({ inputPerMillion: z.number().nonnegative(), outputPerMillion: z.number().nonnegative(), currency: z.literal('USD'), basis: z.enum(['official', 'estimated']), updatedAt: z.string() }).nullable(),
  purposes: z.array(z.object({ name: z.string(), alias: z.string(), role: z.enum(['primary', 'fallback']) })), channelIds: z.array(z.string()),
})
export const channelItemSchema = z.object({
  id: z.string(), name: z.string(), provider: z.string(), type: z.enum(['official_api', 'cpa_oauth', 'unknown']), environment: z.enum(['production', 'experiment', 'unassigned']), status: z.enum(['healthy', 'degraded', 'offline', 'unverified']), modelIds: z.array(z.string()), latencyMs: z.number().int().nonnegative().nullable(), successRate: z.number().min(0).max(100).nullable(), balanceState: z.enum(['sufficient', 'low', 'unknown']), rateLimits: z.object({ rpm: z.number().int().positive().nullable(), tpm: z.number().int().positive().nullable() }), recentError: z.object({ category: z.enum(['rate_limit', 'timeout', 'authentication', 'server']), summary: z.string(), occurredAt: z.string() }).nullable(), checkedAt: z.string().nullable(), credentialConfigured: z.boolean().nullable(),
})
export const modelsResponseSchema = z.object({ meta: z.object({ source: catalogSourceSchema, generatedAt: z.string().datetime(), notice: z.string() }), summary: z.object({ total: z.number().int().nonnegative(), available: z.number().int().nonnegative(), degraded: z.number().int().nonnegative(), production: z.number().int().nonnegative(), experiment: z.number().int().nonnegative() }), options: z.object({ capabilities: z.array(z.object({ id: z.enum(['text', 'reasoning', 'translation', 'vision', 'batch']), label: z.string() })) }), items: z.array(modelItemSchema), total: z.number().int().nonnegative() })
export const channelsResponseSchema = z.object({ meta: z.object({ source: catalogSourceSchema, generatedAt: z.string().datetime(), notice: z.string(), healthCacheSeconds: z.number().int().nonnegative() }), summary: z.object({ total: z.number().int().nonnegative(), healthy: z.number().int().nonnegative(), degraded: z.number().int().nonnegative(), offline: z.number().int().nonnegative() }), items: z.array(channelItemSchema), total: z.number().int().nonnegative() })

export type ModelFilters = z.input<typeof modelFiltersSchema>
export type ChannelFilters = z.input<typeof channelFiltersSchema>
export type CatalogSource = z.infer<typeof catalogSourceSchema>
export type ModelsResponse = z.infer<typeof modelsResponseSchema>
export type ChannelsResponse = z.infer<typeof channelsResponseSchema>
export type ModelItem = z.infer<typeof modelItemSchema>
export type ChannelItem = z.infer<typeof channelItemSchema>

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
      NEW_API_UNAVAILABLE: 'New API 暂时不可用，请稍后重试，或切换到模拟数据。',
      NEW_API_INVALID_DATA: 'New API 数据格式不受支持，请检查版本兼容性。',
      NEW_API_CATALOG_LIMIT: 'New API 目录超过读取上限，请联系管理员。',
    }
    throw new ModelsApiError(messages[body?.error?.code] ?? '模型与渠道暂时无法加载，请重试。', requestId)
  }
  const parsed = schema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new ModelsApiError('模型与渠道格式不符合接口约定', requestId)
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
