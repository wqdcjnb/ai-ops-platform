import { z } from 'zod'

/** The management catalog is relay-only. Employees never call these raw IDs. */
export const modelFiltersSchema = z.object({
  source: z.literal('owned').default('owned'),
  search: z.string().max(60),
  capability: z.literal('all').default('all'),
  environment: z.enum(['all', 'production']).default('all'),
  status: z.enum(['all', 'available', 'unavailable']).default('all'),
  cacheMode: z.enum(['default', 'refresh']).default('default'),
})

export const modelItemSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  provider: z.string(),
  actualModel: z.string(),
  aliases: z.array(z.string()),
  // Discovery never guesses modality capabilities.
  capabilities: z.array(z.never()),
  contextWindow: z.number().int().positive().nullable(),
  region: z.string(),
  environment: z.literal('production'),
  status: z.enum(['available', 'unavailable']),
  pricing: z.null(),
  purposes: z.array(z.unknown()),
  channelIds: z.array(z.string()),
  channels: z.array(z.object({
    id: z.string(),
    name: z.string(),
    provider: z.string().optional(),
    source: z.literal('external_provider').optional(),
  })).optional(),
})

export const modelsResponseSchema = z.object({
  meta: z.object({ source: z.literal('owned'), generatedAt: z.string().datetime(), notice: z.string() }),
  summary: z.object({ total: z.number().int().nonnegative(), available: z.number().int().nonnegative(), degraded: z.literal(0), production: z.number().int().nonnegative(), experiment: z.literal(0) }),
  options: z.object({ capabilities: z.array(z.never()) }),
  items: z.array(modelItemSchema),
  total: z.number().int().nonnegative(),
})

export type ModelFilters = z.input<typeof modelFiltersSchema>
export type ModelItem = z.infer<typeof modelItemSchema>
export type ModelsResponse = z.infer<typeof modelsResponseSchema>

export class ModelsApiError extends Error {
  constructor(message: string, readonly requestId?: string) { super(message); this.name = 'ModelsApiError' }
}

export async function fetchModels(filters: ModelFilters, signal?: AbortSignal): Promise<ModelsResponse> {
  const value = modelFiltersSchema.parse(filters)
  const response = await fetch(`/api/models?${new URLSearchParams(value)}`, { headers: { accept: 'application/json' }, signal })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new ModelsApiError(body?.error?.message ?? '中转站模型目录暂时无法加载，请重试。', requestId)
  }
  const parsed = modelsResponseSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new ModelsApiError('中转站模型目录格式不符合接口约定', requestId)
  return parsed.data
}
