import { z } from 'zod'
import { createNewApiManagementClient, type NewApiManagementResult } from './new-api-management.js'
import { channelsResponseSchema, modelsResponseSchema, type ChannelItem, type ChannelsQuery, type ModelItem, type ModelsQuery } from './models.js'

// Only named configuration fields enter the catalog. Keys, URLs, settings,
// response bodies and free-form upstream error details are deliberately omitted.
const metadataSchema = z.object({
  id: z.number().int().positive(), model_name: z.string().trim().min(1).max(256),
  status: z.number().int().optional(), name_rule: z.number().int().optional(),
})
const upstreamChannelSchema = z.object({
  id: z.number().int().positive(), name: z.string().trim().min(1).max(256),
  status: z.number().int(), models: z.string().max(100_000).nullish(),
})

export class CatalogError extends Error {
  constructor(readonly code: 'NEW_API_AUTH_REQUIRED' | 'NEW_API_UNAVAILABLE' | 'NEW_API_INVALID_DATA' | 'NEW_API_CATALOG_LIMIT') {
    super({
      NEW_API_AUTH_REQUIRED: 'New API 管理认证未配置或未通过，请检查服务端连接配置。',
      NEW_API_UNAVAILABLE: 'New API 暂时不可用，请确认服务已启动、管理令牌有效后重试。',
      NEW_API_INVALID_DATA: 'New API 返回的数据格式不受支持，未展示不完整列表，请联系管理员检查版本兼容性。',
      NEW_API_CATALOG_LIMIT: 'New API 目录超过当前读取上限，请联系管理员调整分页接入。',
    }[code])
  }
}

export interface CatalogReader {
  getModelMetadata(page?: number, pageSize?: number): Promise<NewApiManagementResult<unknown>>
  getChannels(page?: number, pageSize?: number): Promise<NewApiManagementResult<unknown>>
}

async function readPages<T extends { id: number }>(read: (page: number, size: number) => Promise<NewApiManagementResult<unknown>>, schema: z.ZodType<T>) {
  const items: T[] = []
  const ids = new Set<number>()
  let expectedTotal: number | undefined
  const pageSchema = z.object({ items: z.array(schema), total: z.number().int().nonnegative(), page: z.number().int().positive().optional() })
  for (let page = 1; page <= 20; page++) {
    const response = await read(page, 100)
    if (response.state !== 'ready') throw new CatalogError(response.state === 'auth_required' ? 'NEW_API_AUTH_REQUIRED' : 'NEW_API_UNAVAILABLE')
    const result = Array.isArray(response.data)
      ? pageSchema.safeParse({ items: response.data, total: response.data.length })
      : pageSchema.safeParse(response.data)
    if (!result.success) throw new CatalogError('NEW_API_INVALID_DATA')
    const data = result.data
    if (data.total > 2_000) throw new CatalogError('NEW_API_CATALOG_LIMIT')
    if ((data.page !== undefined && data.page !== page) || (expectedTotal !== undefined && data.total !== expectedTotal)) throw new CatalogError('NEW_API_INVALID_DATA')
    expectedTotal = data.total
    for (const item of data.items) {
      if (ids.has(item.id)) throw new CatalogError('NEW_API_INVALID_DATA')
      ids.add(item.id)
      items.push(item)
    }
    if (items.length > data.total || (!data.items.length && items.length < data.total)) throw new CatalogError('NEW_API_INVALID_DATA')
    if (items.length === data.total) return items
  }
  throw new CatalogError('NEW_API_CATALOG_LIMIT')
}

const modelId = (name: string) => `new-api-model-${encodeURIComponent(name)}`
const channelId = (id: number) => `new-api-channel-${id}`
const notice = 'New API 配置只读快照；价格、能力、业务用途、环境与健康指标未接入时显示未提供或待验证。渠道启用不代表实际调用成功。'

export function createModelCatalog(reader?: CatalogReader, now: () => Date = () => new Date()) {
  type Snapshot = { models: ModelItem[]; channels: ChannelItem[]; generatedAt: string }
  let cached: { snapshot: Snapshot; expires: number } | undefined
  let pending: Promise<Snapshot> | undefined

  async function load(): Promise<Snapshot> {
    let client: CatalogReader
    try {
      client = reader ?? createNewApiManagementClient({ baseUrl: process.env.NEW_API_BASE_URL, accessToken: process.env.NEW_API_ACCESS_TOKEN, userId: process.env.NEW_API_USER_ID })
    } catch { throw new CatalogError('NEW_API_UNAVAILABLE') }
    const [metadata, rawChannels] = await Promise.all([
      readPages((page, size) => client.getModelMetadata(page, size), metadataSchema),
      readPages((page, size) => client.getChannels(page, size), upstreamChannelSchema),
    ])
    const channelModels = new Map(rawChannels.map((channel) => [channel.id, [...new Set((channel.models ?? '').split(',').map((value) => value.trim()).filter(Boolean))]]))
    const metadataByName = new Map(metadata.map((model) => [model.model_name, model]))
    if (metadataByName.size !== metadata.length) throw new CatalogError('NEW_API_INVALID_DATA')
    const names = [...new Set([...metadataByName.keys(), ...[...channelModels.values()].flat()])]
    if (names.length > 2_000 || names.some((name) => name.length > 256)) throw new CatalogError('NEW_API_CATALOG_LIMIT')
    const channels: ChannelItem[] = rawChannels.map((channel) => ({
      id: channelId(channel.id), name: channel.name, provider: 'New API', type: 'unknown', environment: 'unassigned',
      status: channel.status === 2 || channel.status === 3 ? 'offline' : 'unverified',
      modelIds: (channelModels.get(channel.id) ?? []).map(modelId),
      latencyMs: null, successRate: null, balanceState: 'unknown', rateLimits: { rpm: null, tpm: null },
      recentError: null, checkedAt: null, credentialConfigured: null,
    }))
    const models: ModelItem[] = names.map((name) => {
      const metadataItem = metadataByName.get(name)
      // Pattern metadata does not establish an exact model/channel association.
      const related = metadataItem?.name_rule ? [] : channels.filter((channel) => channel.modelIds.includes(modelId(name)))
      return {
        id: modelId(name), displayName: name, actualModel: name, provider: '未提供', aliases: [], capabilities: [],
        contextWindow: null, region: '未提供', environment: 'unassigned',
        status: metadataItem?.status === 0 || metadataItem?.status === 2 || (related.length > 0 && related.every((channel) => channel.status === 'offline')) ? 'unavailable' : 'unverified',
        pricing: null, purposes: [], channelIds: related.map((channel) => channel.id),
      }
    })
    return { models, channels, generatedAt: now().toISOString() }
  }

  async function snapshot() {
    if (cached && cached.expires > now().getTime()) return cached.snapshot
    if (!pending) {
      pending = load().then((value) => {
        cached = { snapshot: value, expires: now().getTime() + 30_000 }
        return value
      }).catch((error: unknown) => {
        cached = undefined
        throw error instanceof CatalogError ? error : new CatalogError('NEW_API_UNAVAILABLE')
      }).finally(() => { pending = undefined })
    }
    return pending
  }

  return {
    async models(query: ModelsQuery) {
      const data = await snapshot()
      const search = query.search.toLocaleLowerCase('zh-CN')
      const items = data.models.filter((item) => (!search || item.displayName.toLocaleLowerCase('zh-CN').includes(search)) && (query.capability === 'all' || item.capabilities.includes(query.capability)) && (query.environment === 'all' || item.environment === query.environment) && (query.status === 'all' || item.status === query.status))
      return modelsResponseSchema.parse({
        meta: { source: 'new_api', generatedAt: data.generatedAt, notice },
        summary: { total: data.models.length, available: 0, degraded: 0, production: 0, experiment: 0 },
        options: { capabilities: [] }, items, total: items.length,
      })
    },
    async channels(query: ChannelsQuery) {
      const data = await snapshot()
      const items = data.channels.filter((item) => (query.environment === 'all' || item.environment === query.environment) && (query.status === 'all' || item.status === query.status))
      return channelsResponseSchema.parse({
        meta: { source: 'new_api', generatedAt: data.generatedAt, notice, healthCacheSeconds: 30 },
        summary: { total: data.channels.length, healthy: 0, degraded: 0, offline: data.channels.filter((item) => item.status === 'offline').length },
        items, total: items.length,
      })
    },
  }
}
