import { z } from 'zod'
import type { ExternalProviderPublic } from './external-providers.js'

/**
 * The administration catalog is a relay-inventory view. It intentionally
 * never guesses whether a discovered upstream ID supports text, image, video
 * or audio; one employee-facing virtual model owns that routing decision.
 */
export const modelsQuerySchema = z.object({
  source: z.literal('owned').default('owned'),
  search: z.string().trim().max(60).default(''),
  capability: z.literal('all').default('all'),
  environment: z.enum(['all', 'production']).default('all'),
  status: z.enum(['all', 'available', 'unavailable']).default('all'),
  cacheMode: z.enum(['default', 'refresh']).default('default'),
})

const relayChannelSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string().optional(),
  source: z.literal('external_provider').optional(),
})

export const modelItemSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  provider: z.literal('中转站聚合'),
  actualModel: z.string(),
  aliases: z.array(z.string()),
  capabilities: z.array(z.never()),
  contextWindow: z.null(),
  region: z.literal('第三方中转站'),
  environment: z.literal('production'),
  status: z.enum(['available', 'unavailable']),
  pricing: z.null(),
  purposes: z.array(z.never()),
  channelIds: z.array(z.string()),
  channels: z.array(relayChannelSchema),
})

export const modelsResponseSchema = z.object({
  meta: z.object({ source: z.literal('owned'), generatedAt: z.string().datetime(), notice: z.string() }),
  summary: z.object({
    total: z.number().int().nonnegative(),
    available: z.number().int().nonnegative(),
    degraded: z.literal(0),
    production: z.number().int().nonnegative(),
    experiment: z.literal(0),
  }),
  options: z.object({ capabilities: z.array(z.never()) }),
  items: z.array(modelItemSchema),
  total: z.number().int().nonnegative(),
})

export type ModelsQuery = z.infer<typeof modelsQuerySchema>
export type ModelsResponse = z.infer<typeof modelsResponseSchema>

function catalogItems(providers: readonly ExternalProviderPublic[]) {
  type Aggregate = {
    displayName: string
    available: boolean
    channels: Array<{ id: string; name: string; provider: string; source: 'external_provider' }>
  }

  const records = new Map<string, Aggregate>()
  for (const provider of providers) {
    const available = provider.enabled && provider.credentialConfigured
    for (const model of provider.models) {
      const upstreamId = model.upstreamId.trim()
      if (!upstreamId) continue
      const key = upstreamId.toLocaleLowerCase('en-US')
      const aggregate = records.get(key) ?? { displayName: upstreamId, available: false, channels: [] }
      aggregate.available ||= available
      if (!aggregate.channels.some((channel) => channel.id === 'external-provider-' + provider.id)) {
        aggregate.channels.push({
          id: 'external-provider-' + provider.id,
          name: provider.name,
          provider: provider.name,
          source: 'external_provider',
        })
      }
      records.set(key, aggregate)
    }
  }

  return [...records.values()]
    .map((item) => ({
      id: 'relay-model-' + encodeURIComponent(item.displayName.toLocaleLowerCase('en-US')),
      displayName: item.displayName,
      provider: '中转站聚合' as const,
      actualModel: item.displayName,
      aliases: [],
      capabilities: [],
      contextWindow: null,
      region: '第三方中转站' as const,
      environment: 'production' as const,
      status: item.available ? 'available' as const : 'unavailable' as const,
      pricing: null,
      purposes: [],
      channelIds: item.channels.map((channel) => channel.id),
      channels: item.channels.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
    }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-CN'))
}

export function createOwnedModels(query: ModelsQuery, providers: readonly ExternalProviderPublic[], now = new Date()): ModelsResponse {
  const all = catalogItems(providers)
  const search = query.search.toLocaleLowerCase('zh-CN')
  const items = all.filter((item) => {
    const match = !search || [item.displayName, item.actualModel, item.provider].some((value) => value.toLocaleLowerCase('zh-CN').includes(search))
    return match
      && (query.environment === 'all' || item.environment === query.environment)
      && (query.status === 'all' || item.status === query.status)
  })
  const routable = providers.filter((provider) => provider.enabled && provider.credentialConfigured).length
  return {
    meta: {
      source: 'owned',
      generatedAt: now.toISOString(),
      notice: all.length
        ? '已登记 ' + providers.length + ' 个第三方账号，其中 ' + routable + ' 个可路由；同名模型已合并全部来源。员工 Key 只调用 AI OPS。'
        : '暂未同步任何中转站模型；请先在“第三方账号”接入账号并同步全部模型。',
    },
    summary: {
      total: all.length,
      available: all.filter((item) => item.status === 'available').length,
      degraded: 0,
      production: all.length,
      experiment: 0,
    },
    options: { capabilities: [] },
    items,
    total: items.length,
  }
}
