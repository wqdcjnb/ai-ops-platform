import { z } from 'zod'
import type { NewApiStatus } from './new-api-status.js'

export const modelsQuerySchema = z.object({
  search: z.string().trim().max(60).default(''),
  capability: z.enum(['all', 'text', 'reasoning', 'translation', 'vision', 'batch']).default('all'),
  environment: z.enum(['all', 'production', 'experiment']).default('all'),
  status: z.enum(['all', 'available', 'degraded', 'unavailable']).default('all'),
})

export const channelsQuerySchema = z.object({
  environment: z.enum(['all', 'production', 'experiment']).default('all'),
  status: z.enum(['all', 'healthy', 'degraded', 'offline']).default('all'),
})

export const modelItemSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  provider: z.string(),
  actualModel: z.string(),
  aliases: z.array(z.string()),
  capabilities: z.array(z.enum(['text', 'reasoning', 'translation', 'vision', 'batch'])),
  contextWindow: z.number().int().positive(),
  region: z.string(),
  environment: z.enum(['production', 'experiment']),
  status: z.enum(['available', 'degraded', 'unavailable']),
  pricing: z.object({ inputPerMillion: z.number().nonnegative(), outputPerMillion: z.number().nonnegative(), currency: z.literal('USD'), basis: z.enum(['official', 'estimated']), updatedAt: z.string().datetime() }),
  purposes: z.array(z.object({ name: z.string(), alias: z.string(), role: z.enum(['primary', 'fallback']) })),
  channelIds: z.array(z.string()),
})

export const channelItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  type: z.enum(['official_api', 'cpa_oauth']),
  environment: z.enum(['production', 'experiment']),
  status: z.enum(['healthy', 'degraded', 'offline']),
  modelIds: z.array(z.string()),
  latencyMs: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(100),
  balanceState: z.enum(['sufficient', 'low', 'unknown']),
  rateLimits: z.object({ rpm: z.number().int().positive(), tpm: z.number().int().positive() }),
  recentError: z.object({ category: z.enum(['rate_limit', 'timeout', 'authentication', 'server']), summary: z.string(), occurredAt: z.string().datetime() }).nullable(),
  checkedAt: z.string().datetime(),
  credentialConfigured: z.boolean(),
})

export const modelsResponseSchema = z.object({
  meta: z.object({ source: z.literal('demo'), generatedAt: z.string().datetime(), notice: z.string() }),
  summary: z.object({ total: z.number().int().nonnegative(), available: z.number().int().nonnegative(), degraded: z.number().int().nonnegative(), production: z.number().int().nonnegative(), experiment: z.number().int().nonnegative() }),
  options: z.object({ capabilities: z.array(z.object({ id: z.enum(['text', 'reasoning', 'translation', 'vision', 'batch']), label: z.string() })) }),
  items: z.array(modelItemSchema),
  total: z.number().int().nonnegative(),
})

export const channelsResponseSchema = z.object({
  meta: z.object({ source: z.literal('demo'), generatedAt: z.string().datetime(), notice: z.string(), healthCacheSeconds: z.number().int().positive() }),
  summary: z.object({ total: z.number().int().nonnegative(), healthy: z.number().int().nonnegative(), degraded: z.number().int().nonnegative(), offline: z.number().int().nonnegative() }),
  items: z.array(channelItemSchema),
  total: z.number().int().nonnegative(),
})

export type ModelsQuery = z.infer<typeof modelsQuerySchema>
export type ChannelsQuery = z.infer<typeof channelsQuerySchema>
export type ModelsResponse = z.infer<typeof modelsResponseSchema>
export type ChannelsResponse = z.infer<typeof channelsResponseSchema>
type ModelItem = z.infer<typeof modelItemSchema>
type ChannelItem = z.infer<typeof channelItemSchema>

const pricedAt = '2026-09-15T00:00:00.000Z'
const demoModels: ModelItem[] = [
  { id: 'model-mini', displayName: '通用轻量模型', provider: 'OpenAI Compatible', actualModel: 'gpt-5.1-mini', aliases: ['ecommerce-copy', 'ecommerce-service', 'ecommerce-general'], capabilities: ['text', 'translation', 'batch'], contextWindow: 128_000, region: '中国区', environment: 'production', status: 'available', pricing: { inputPerMillion: 0.25, outputPerMillion: 2, currency: 'USD', basis: 'official', updatedAt: pricedAt }, purposes: [{ name: '商品文案', alias: 'ecommerce-copy', role: 'primary' }, { name: '客服回复', alias: 'ecommerce-service', role: 'primary' }, { name: '策略分析', alias: 'ecommerce-analysis', role: 'fallback' }], channelIds: ['channel-official-cn-1', 'channel-official-cn-2'] },
  { id: 'model-general', displayName: '通用高能力模型', provider: 'OpenAI Compatible', actualModel: 'gpt-5.1', aliases: ['ecommerce-analysis', 'ecommerce-translate'], capabilities: ['text', 'reasoning', 'translation'], contextWindow: 256_000, region: '全球区', environment: 'production', status: 'degraded', pricing: { inputPerMillion: 1.25, outputPerMillion: 10, currency: 'USD', basis: 'official', updatedAt: pricedAt }, purposes: [{ name: '策略分析', alias: 'ecommerce-analysis', role: 'primary' }, { name: '多语翻译', alias: 'ecommerce-translate', role: 'primary' }], channelIds: ['channel-official-global-1'] },
  { id: 'model-vision', displayName: '视觉检查模型', provider: 'OpenAI Compatible', actualModel: 'gpt-5.1-vision', aliases: ['ecommerce-image-check'], capabilities: ['text', 'vision'], contextWindow: 128_000, region: '中国区', environment: 'production', status: 'available', pricing: { inputPerMillion: 1.5, outputPerMillion: 8, currency: 'USD', basis: 'official', updatedAt: pricedAt }, purposes: [{ name: '图片检查', alias: 'ecommerce-image-check', role: 'primary' }], channelIds: ['channel-official-vision-1'] },
  { id: 'model-lab', displayName: 'CPA 高能力实验', provider: 'CLIProxyAPI', actualModel: 'pro-oauth-lab', aliases: ['ecommerce-pro-lab'], capabilities: ['text', 'reasoning'], contextWindow: 200_000, region: '隔离实验区', environment: 'experiment', status: 'available', pricing: { inputPerMillion: 0, outputPerMillion: 0, currency: 'USD', basis: 'estimated', updatedAt: pricedAt }, purposes: [{ name: '高能力实验', alias: 'ecommerce-pro-lab', role: 'primary' }], channelIds: ['channel-cpa-lab-1'] },
]

function atMinutesAgo(now: Date, minutes: number) { return new Date(now.getTime() - minutes * 60_000).toISOString() }
function createChannels(now: Date): ChannelItem[] {
  return [
    { id: 'channel-official-cn-1', name: 'Official CN · 01', provider: 'OpenAI Compatible', type: 'official_api', environment: 'production', status: 'healthy', modelIds: ['model-mini'], latencyMs: 1_420, successRate: 99.6, balanceState: 'sufficient', rateLimits: { rpm: 500, tpm: 1_000_000 }, recentError: null, checkedAt: atMinutesAgo(now, 1), credentialConfigured: true },
    { id: 'channel-official-cn-2', name: 'Official CN · 02', provider: 'OpenAI Compatible', type: 'official_api', environment: 'production', status: 'healthy', modelIds: ['model-mini'], latencyMs: 1_680, successRate: 99.2, balanceState: 'sufficient', rateLimits: { rpm: 400, tpm: 800_000 }, recentError: { category: 'rate_limit', summary: '一次短时 429，已按退避策略恢复', occurredAt: atMinutesAgo(now, 74) }, checkedAt: atMinutesAgo(now, 1), credentialConfigured: true },
    { id: 'channel-official-global-1', name: 'Official Global · 01', provider: 'OpenAI Compatible', type: 'official_api', environment: 'production', status: 'degraded', modelIds: ['model-general'], latencyMs: 3_960, successRate: 96.8, balanceState: 'low', rateLimits: { rpm: 180, tpm: 360_000 }, recentError: { category: 'timeout', summary: 'P95 延迟升高，策略分析已允许组内降级', occurredAt: atMinutesAgo(now, 18) }, checkedAt: atMinutesAgo(now, 1), credentialConfigured: true },
    { id: 'channel-official-vision-1', name: 'Official Vision · 01', provider: 'OpenAI Compatible', type: 'official_api', environment: 'production', status: 'healthy', modelIds: ['model-vision'], latencyMs: 3_240, successRate: 98.4, balanceState: 'sufficient', rateLimits: { rpm: 80, tpm: 240_000 }, recentError: null, checkedAt: atMinutesAgo(now, 2), credentialConfigured: true },
    { id: 'channel-cpa-lab-1', name: 'CPA Lab · 01', provider: 'CLIProxyAPI', type: 'cpa_oauth', environment: 'experiment', status: 'healthy', modelIds: ['model-lab'], latencyMs: 5_820, successRate: 94.5, balanceState: 'unknown', rateLimits: { rpm: 30, tpm: 100_000 }, recentError: { category: 'server', summary: '实验渠道曾返回 5xx，未影响正式业务', occurredAt: atMinutesAgo(now, 230) }, checkedAt: atMinutesAgo(now, 3), credentialConfigured: true },
  ]
}

function noticeFor(newApi: NewApiStatus, subject: string) {
  if (newApi.state === 'ready') return `New API 管理连接已验证；${subject}字段映射完成前仍使用演示数据`
  if (newApi.state === 'reachable') return `New API 服务可达但尚未配置管理认证；${subject}为演示数据`
  if (newApi.state === 'auth_required') return `New API 管理认证未通过；${subject}为演示数据`
  return `New API 当前离线；${subject}为演示数据`
}

export function createDemoModels(query: ModelsQuery, newApi: NewApiStatus, now = new Date()): ModelsResponse {
  const search = query.search.toLocaleLowerCase('zh-CN')
  const items = demoModels.filter((item) => {
    const matchesSearch = !search || [item.displayName, item.provider, item.actualModel, item.region, ...item.aliases, ...item.purposes.flatMap((purpose) => [purpose.name, purpose.alias])].some((value) => value.toLocaleLowerCase('zh-CN').includes(search))
    return matchesSearch && (query.capability === 'all' || item.capabilities.includes(query.capability)) && (query.environment === 'all' || item.environment === query.environment) && (query.status === 'all' || item.status === query.status)
  })
  return { meta: { source: 'demo', generatedAt: now.toISOString(), notice: noticeFor(newApi, '模型目录') }, summary: { total: demoModels.length, available: demoModels.filter((item) => item.status === 'available').length, degraded: demoModels.filter((item) => item.status === 'degraded').length, production: demoModels.filter((item) => item.environment === 'production').length, experiment: demoModels.filter((item) => item.environment === 'experiment').length }, options: { capabilities: [{ id: 'text', label: '文本' }, { id: 'reasoning', label: '推理' }, { id: 'translation', label: '翻译' }, { id: 'vision', label: '视觉' }, { id: 'batch', label: '批处理' }] }, items, total: items.length }
}

export function createDemoChannels(query: ChannelsQuery, newApi: NewApiStatus, now = new Date()): ChannelsResponse {
  const all = createChannels(now)
  const items = all.filter((item) => (query.environment === 'all' || item.environment === query.environment) && (query.status === 'all' || item.status === query.status))
  return { meta: { source: 'demo', generatedAt: now.toISOString(), notice: noticeFor(newApi, '渠道健康'), healthCacheSeconds: 30 }, summary: { total: all.length, healthy: all.filter((item) => item.status === 'healthy').length, degraded: all.filter((item) => item.status === 'degraded').length, offline: all.filter((item) => item.status === 'offline').length }, items, total: items.length }
}
