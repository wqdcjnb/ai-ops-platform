import { z } from 'zod'

export const modelFiltersSchema = z.object({ search: z.string().max(60), capability: z.enum(['all', 'text', 'reasoning', 'translation', 'vision', 'batch']), environment: z.enum(['all', 'production', 'experiment']), status: z.enum(['all', 'available', 'degraded', 'unavailable']) })
export const channelFiltersSchema = z.object({ environment: z.enum(['all', 'production', 'experiment']), status: z.enum(['all', 'healthy', 'degraded', 'offline']) })
export const modelItemSchema = z.object({
  id: z.string(), displayName: z.string(), provider: z.string(), actualModel: z.string(), aliases: z.array(z.string()), capabilities: z.array(z.enum(['text', 'reasoning', 'translation', 'vision', 'batch'])), contextWindow: z.number().int().positive(), region: z.string(), environment: z.enum(['production', 'experiment']), status: z.enum(['available', 'degraded', 'unavailable']),
  pricing: z.object({ inputPerMillion: z.number().nonnegative(), outputPerMillion: z.number().nonnegative(), currency: z.literal('USD'), basis: z.enum(['official', 'estimated']), updatedAt: z.string() }),
  purposes: z.array(z.object({ name: z.string(), alias: z.string(), role: z.enum(['primary', 'fallback']) })), channelIds: z.array(z.string()),
})
export const channelItemSchema = z.object({
  id: z.string(), name: z.string(), provider: z.string(), type: z.enum(['official_api', 'cpa_oauth']), environment: z.enum(['production', 'experiment']), status: z.enum(['healthy', 'degraded', 'offline']), modelIds: z.array(z.string()), latencyMs: z.number().int().nonnegative(), successRate: z.number().min(0).max(100), balanceState: z.enum(['sufficient', 'low', 'unknown']), rateLimits: z.object({ rpm: z.number().int().positive(), tpm: z.number().int().positive() }), recentError: z.object({ category: z.enum(['rate_limit', 'timeout', 'authentication', 'server']), summary: z.string(), occurredAt: z.string() }).nullable(), checkedAt: z.string(), credentialConfigured: z.boolean(),
})
export const modelsResponseSchema = z.object({ meta: z.object({ source: z.literal('demo'), generatedAt: z.string(), notice: z.string() }), summary: z.object({ total: z.number().int().nonnegative(), available: z.number().int().nonnegative(), degraded: z.number().int().nonnegative(), production: z.number().int().nonnegative(), experiment: z.number().int().nonnegative() }), options: z.object({ capabilities: z.array(z.object({ id: z.enum(['text', 'reasoning', 'translation', 'vision', 'batch']), label: z.string() })) }), items: z.array(modelItemSchema), total: z.number().int().nonnegative() })
export const channelsResponseSchema = z.object({ meta: z.object({ source: z.literal('demo'), generatedAt: z.string(), notice: z.string(), healthCacheSeconds: z.number().int().positive() }), summary: z.object({ total: z.number().int().nonnegative(), healthy: z.number().int().nonnegative(), degraded: z.number().int().nonnegative(), offline: z.number().int().nonnegative() }), items: z.array(channelItemSchema), total: z.number().int().nonnegative() })

export type ModelFilters = z.infer<typeof modelFiltersSchema>
export type ChannelFilters = z.infer<typeof channelFiltersSchema>
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
  if (!response.ok) throw new ModelsApiError('模型与渠道暂时无法加载', requestId)
  const parsed = schema.safeParse(await response.json())
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
