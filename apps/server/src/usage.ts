import { z } from 'zod'
import type { NewApiStatus } from './new-api-status.js'

const optionSchema = z.object({ id: z.string(), label: z.string() })
const costTypeSchema = z.enum(['official_actual', 'platform_estimate', 'cpa_estimate'])

export const usageQuerySchema = z.object({
  period: z.enum(['today', '7d', '30d']).default('7d'),
  search: z.string().trim().max(80).default(''),
  person: z.string().trim().max(40).default('all'),
  department: z.string().trim().max(40).default('all'),
  purpose: z.string().trim().max(40).default('all'),
  key: z.string().trim().max(40).default('all'),
  model: z.string().trim().max(40).default('all'),
  channel: z.string().trim().max(60).default('all'),
  status: z.enum(['all', 'succeeded', 'failed', 'cancelled']).default('all'),
  costType: z.union([z.literal('all'), costTypeSchema]).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(50).default(10),
})

export const usageRequestParamsSchema = z.object({ requestId: z.string().regex(/^req-[a-z0-9-]+$/) })

export const usageItemSchema = z.object({
  requestId: z.string(),
  occurredAt: z.string().datetime(),
  person: z.object({ id: z.string(), name: z.string(), department: z.object({ id: z.string(), name: z.string() }) }),
  key: z.object({ id: z.string(), masked: z.string() }),
  purpose: z.object({ id: z.string(), name: z.string(), alias: z.string() }),
  model: z.object({ id: z.string(), displayName: z.string(), actualModel: z.string() }),
  channel: z.object({ id: z.string(), name: z.string(), type: z.enum(['official_api', 'cpa_oauth']) }),
  protocol: z.enum(['chat_completions', 'responses']),
  streamed: z.boolean(),
  tokens: z.object({ input: z.number().int().nonnegative(), output: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
  points: z.number().nonnegative(),
  latency: z.object({ firstTokenMs: z.number().int().nonnegative().nullable(), totalMs: z.number().int().nonnegative() }),
  cost: z.object({ type: costTypeSchema, amountUsd: z.number().nonnegative(), label: z.string() }),
  status: z.enum(['succeeded', 'failed', 'cancelled']),
  error: z.object({ category: z.enum(['rate_limit', 'timeout', 'authentication', 'server', 'cancelled']), summary: z.string() }).nullable(),
  conversationContentAvailable: z.literal(false),
})

export const usageResponseSchema = z.object({
  meta: z.object({ source: z.literal('demo'), generatedAt: z.string().datetime(), period: z.enum(['today', '7d', '30d']), notice: z.string() }),
  summary: z.object({ requests: z.number().int().nonnegative(), tokens: z.number().int().nonnegative(), points: z.number().nonnegative(), successRate: z.number().min(0).max(100), p95LatencyMs: z.number().int().nonnegative(), costs: z.object({ officialActualUsd: z.number().nonnegative(), platformEstimateUsd: z.number().nonnegative(), cpaEstimateUsd: z.number().nonnegative() }) }),
  options: z.object({ people: z.array(optionSchema), departments: z.array(optionSchema), purposes: z.array(optionSchema), keys: z.array(optionSchema), models: z.array(optionSchema), channels: z.array(optionSchema) }),
  items: z.array(usageItemSchema),
  pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }),
})

export const usageDetailResponseSchema = z.object({
  meta: z.object({ source: z.literal('demo'), generatedAt: z.string().datetime(), notice: z.string() }),
  item: usageItemSchema,
  route: z.object({ alias: z.string(), retryCount: z.number().int().nonnegative(), requestIdPropagated: z.boolean() }),
  client: z.object({ name: z.enum(['Codex Desktop', 'WorkBuddy']), mode: z.enum(['stream', 'non_stream']) }),
  content: z.object({ stored: z.literal(false), reason: z.string() }),
})

export type UsageQuery = z.infer<typeof usageQuerySchema>
export type UsageResponse = z.infer<typeof usageResponseSchema>
export type UsageDetailResponse = z.infer<typeof usageDetailResponseSchema>
type UsageItem = z.infer<typeof usageItemSchema>

const people = {
  lin: { id: 'person-lin', name: '林筱雨', department: { id: 'content', name: '内容运营' } },
  chen: { id: 'person-chen', name: '陈宇航', department: { id: 'operations', name: '店铺运营' } },
  zhou: { id: 'person-zhou', name: '周明远', department: { id: 'growth', name: '增长投放' } },
  xu: { id: 'person-xu', name: '徐静怡', department: { id: 'customer', name: '客户体验' } },
}

const purposes = {
  copy: { id: 'copy', name: '商品文案', alias: 'ecommerce-copy' },
  service: { id: 'service', name: '客服回复', alias: 'ecommerce-service' },
  analysis: { id: 'analysis', name: '策略分析', alias: 'ecommerce-analysis' },
  translate: { id: 'translate', name: '多语翻译', alias: 'ecommerce-translate' },
  experiment: { id: 'experiment', name: '高能力实验', alias: 'ecommerce-pro-lab' },
}

type Seed = {
  id: string; minutes: number; person: keyof typeof people; purpose: keyof typeof purposes; key: 'key-lin-1' | 'key-chen-1' | 'key-zhou-1' | 'key-xu-1'; masked: string; model: 'mini' | 'general' | 'lab'; channel: 'cn1' | 'cn2' | 'global' | 'cpa'; input: number; output: number; points: number; first: number | null; total: number; costType: z.infer<typeof costTypeSchema>; cost: number; status: UsageItem['status']; error?: UsageItem['error']; protocol?: UsageItem['protocol']; streamed?: boolean
}

const modelMap = {
  mini: { id: 'model-mini', displayName: '通用轻量模型', actualModel: 'gpt-5.1-mini' },
  general: { id: 'model-general', displayName: '通用高能力模型', actualModel: 'gpt-5.1' },
  lab: { id: 'model-lab', displayName: 'CPA 高能力实验', actualModel: 'pro-oauth-lab' },
}
const channelMap = {
  cn1: { id: 'channel-official-cn-1', name: 'Official CN · 01', type: 'official_api' as const },
  cn2: { id: 'channel-official-cn-2', name: 'Official CN · 02', type: 'official_api' as const },
  global: { id: 'channel-official-global-1', name: 'Official Global · 01', type: 'official_api' as const },
  cpa: { id: 'channel-cpa-lab-1', name: 'CPA Lab · 01', type: 'cpa_oauth' as const },
}
const costLabel = { official_actual: '官方实际', platform_estimate: '平台估算', cpa_estimate: 'CPA 估算' }

const seeds: Seed[] = [
  { id: 'req-260915-8f31', minutes: 8, person: 'lin', purpose: 'copy', key: 'key-lin-1', masked: 'sk-ops••••••7F2A', model: 'mini', channel: 'cn1', input: 1840, output: 726, points: 2.6, first: 620, total: 2180, costType: 'official_actual', cost: .00191, status: 'succeeded', protocol: 'responses', streamed: true },
  { id: 'req-260915-2a77', minutes: 19, person: 'chen', purpose: 'analysis', key: 'key-chen-1', masked: 'sk-ops••••••3C91', model: 'general', channel: 'global', input: 6230, output: 2140, points: 8.4, first: 1680, total: 8940, costType: 'platform_estimate', cost: .02919, status: 'succeeded', protocol: 'chat_completions', streamed: true },
  { id: 'req-260915-c412', minutes: 31, person: 'xu', purpose: 'service', key: 'key-xu-1', masked: 'sk-ops••••••8B14', model: 'mini', channel: 'cn2', input: 960, output: 188, points: 1.2, first: null, total: 3840, costType: 'official_actual', cost: .00062, status: 'failed', error: { category: 'rate_limit', summary: '上游短时 429，已记录且未返回完整响应' } },
  { id: 'req-260915-55ed', minutes: 47, person: 'zhou', purpose: 'experiment', key: 'key-zhou-1', masked: 'sk-ops••••••94D0', model: 'lab', channel: 'cpa', input: 4820, output: 1680, points: 6.5, first: 2420, total: 11320, costType: 'cpa_estimate', cost: .0184, status: 'succeeded', protocol: 'responses', streamed: true },
  { id: 'req-260915-773b', minutes: 73, person: 'lin', purpose: 'translate', key: 'key-lin-1', masked: 'sk-ops••••••7F2A', model: 'mini', channel: 'cn1', input: 3260, output: 1420, points: 4.7, first: 810, total: 4260, costType: 'official_actual', cost: .00366, status: 'succeeded', streamed: true },
  { id: 'req-260915-a096', minutes: 126, person: 'chen', purpose: 'analysis', key: 'key-chen-1', masked: 'sk-ops••••••3C91', model: 'general', channel: 'global', input: 7120, output: 1830, points: 9, first: null, total: 12000, costType: 'platform_estimate', cost: .0272, status: 'failed', error: { category: 'timeout', summary: '总耗时超过路由阈值，已在官方组内结束请求' } },
  { id: 'req-260915-f5c0', minutes: 184, person: 'xu', purpose: 'service', key: 'key-xu-1', masked: 'sk-ops••••••8B14', model: 'mini', channel: 'cn1', input: 1280, output: 640, points: 1.9, first: 540, total: 1980, costType: 'official_actual', cost: .0016, status: 'succeeded', protocol: 'responses', streamed: true },
  { id: 'req-260915-9dd2', minutes: 265, person: 'zhou', purpose: 'experiment', key: 'key-zhou-1', masked: 'sk-ops••••••94D0', model: 'lab', channel: 'cpa', input: 2290, output: 0, points: 2.3, first: null, total: 1320, costType: 'cpa_estimate', cost: .0062, status: 'cancelled', error: { category: 'cancelled', summary: '客户端主动取消流式响应' }, protocol: 'responses', streamed: true },
  { id: 'req-260914-14ac', minutes: 1_580, person: 'lin', purpose: 'copy', key: 'key-lin-1', masked: 'sk-ops••••••7F2A', model: 'mini', channel: 'cn2', input: 2410, output: 990, points: 3.4, first: 730, total: 3120, costType: 'official_actual', cost: .00258, status: 'succeeded', streamed: true },
  { id: 'req-260914-673e', minutes: 1_940, person: 'chen', purpose: 'analysis', key: 'key-chen-1', masked: 'sk-ops••••••3C91', model: 'general', channel: 'global', input: 8640, output: 3210, points: 11.9, first: 1920, total: 10480, costType: 'platform_estimate', cost: .0429, status: 'succeeded', protocol: 'responses', streamed: true },
  { id: 'req-260913-2f83', minutes: 3_080, person: 'xu', purpose: 'service', key: 'key-xu-1', masked: 'sk-ops••••••8B14', model: 'mini', channel: 'cn1', input: 770, output: 430, points: 1.2, first: 510, total: 1690, costType: 'official_actual', cost: .00105, status: 'succeeded', streamed: true },
  { id: 'req-260912-bc16', minutes: 4_330, person: 'zhou', purpose: 'experiment', key: 'key-zhou-1', masked: 'sk-ops••••••94D0', model: 'lab', channel: 'cpa', input: 5560, output: 1940, points: 7.5, first: 2840, total: 13620, costType: 'cpa_estimate', cost: .0212, status: 'succeeded', streamed: true },
  { id: 'req-260911-80d1', minutes: 5_720, person: 'lin', purpose: 'translate', key: 'key-lin-1', masked: 'sk-ops••••••7F2A', model: 'mini', channel: 'cn2', input: 3890, output: 1780, points: 5.7, first: 890, total: 4740, costType: 'official_actual', cost: .00453, status: 'succeeded', streamed: true },
  { id: 'req-260910-11e7', minutes: 7_100, person: 'chen', purpose: 'analysis', key: 'key-chen-1', masked: 'sk-ops••••••3C91', model: 'general', channel: 'global', input: 4930, output: 0, points: 4.9, first: null, total: 8200, costType: 'platform_estimate', cost: .00616, status: 'failed', error: { category: 'server', summary: '上游返回 5xx，正文未保留' } },
  { id: 'req-260905-984a', minutes: 14_300, person: 'xu', purpose: 'service', key: 'key-xu-1', masked: 'sk-ops••••••8B14', model: 'mini', channel: 'cn1', input: 1120, output: 520, points: 1.6, first: 570, total: 1880, costType: 'official_actual', cost: .00132, status: 'succeeded', streamed: true },
  { id: 'req-260901-aa52', minutes: 20_400, person: 'zhou', purpose: 'experiment', key: 'key-zhou-1', masked: 'sk-ops••••••94D0', model: 'lab', channel: 'cpa', input: 6120, output: 2480, points: 8.6, first: 3040, total: 15120, costType: 'cpa_estimate', cost: .0251, status: 'succeeded', protocol: 'responses', streamed: true },
]

function createRecords(now: Date): UsageItem[] {
  return seeds.map((seed) => ({ requestId: seed.id, occurredAt: new Date(now.getTime() - seed.minutes * 60_000).toISOString(), person: people[seed.person], key: { id: seed.key, masked: seed.masked }, purpose: purposes[seed.purpose], model: modelMap[seed.model], channel: channelMap[seed.channel], protocol: seed.protocol ?? 'chat_completions', streamed: seed.streamed ?? false, tokens: { input: seed.input, output: seed.output, total: seed.input + seed.output }, points: seed.points, latency: { firstTokenMs: seed.first, totalMs: seed.total }, cost: { type: seed.costType, amountUsd: seed.cost, label: costLabel[seed.costType] }, status: seed.status, error: seed.error ?? null, conversationContentAvailable: false }))
}

function noticeFor(newApi: NewApiStatus) {
  if (newApi.state === 'ready') return 'New API 管理连接已验证；日志字段映射完成前仍使用演示数据'
  if (newApi.state === 'reachable') return 'New API 可达但等待管理认证；调用记录为演示数据'
  if (newApi.state === 'auth_required') return 'New API 管理认证未通过；调用记录为演示数据'
  return 'New API 当前离线；调用记录为演示数据'
}

function periodMinutes(period: UsageQuery['period']) { return period === 'today' ? 24 * 60 : period === '7d' ? 7 * 24 * 60 : 30 * 24 * 60 }
function round(value: number, digits = 2) { return Number(value.toFixed(digits)) }

export function createDemoUsage(query: UsageQuery, newApi: NewApiStatus, now = new Date()): UsageResponse {
  const all = createRecords(now)
  const cutoff = now.getTime() - periodMinutes(query.period) * 60_000
  const search = query.search.toLocaleLowerCase('zh-CN')
  const filtered = all.filter((item) => {
    const matchesSearch = !search || [item.requestId, item.key.masked, item.person.name, item.purpose.alias].some((value) => value.toLocaleLowerCase('zh-CN').includes(search))
    return new Date(item.occurredAt).getTime() >= cutoff && matchesSearch && (query.person === 'all' || item.person.id === query.person) && (query.department === 'all' || item.person.department.id === query.department) && (query.purpose === 'all' || item.purpose.id === query.purpose) && (query.key === 'all' || item.key.id === query.key) && (query.model === 'all' || item.model.id === query.model) && (query.channel === 'all' || item.channel.id === query.channel) && (query.status === 'all' || item.status === query.status) && (query.costType === 'all' || item.cost.type === query.costType)
  })
  const succeeded = filtered.filter((item) => item.status === 'succeeded').length
  const sortedLatency = filtered.map((item) => item.latency.totalMs).sort((a, b) => a - b)
  const p95 = sortedLatency.length ? (sortedLatency[Math.min(sortedLatency.length - 1, Math.ceil(sortedLatency.length * .95) - 1)] ?? 0) : 0
  const start = (query.page - 1) * query.pageSize
  const option = <T extends { id: string }>(items: T[], label: (item: T) => string) => Array.from(new Map(items.map((item) => [item.id, { id: item.id, label: label(item) }])).values())
  return {
    meta: { source: 'demo', generatedAt: now.toISOString(), period: query.period, notice: noticeFor(newApi) },
    summary: { requests: filtered.length, tokens: filtered.reduce((sum, item) => sum + item.tokens.total, 0), points: round(filtered.reduce((sum, item) => sum + item.points, 0), 1), successRate: filtered.length ? round(succeeded / filtered.length * 100, 1) : 0, p95LatencyMs: p95, costs: { officialActualUsd: round(filtered.filter((item) => item.cost.type === 'official_actual').reduce((sum, item) => sum + item.cost.amountUsd, 0), 5), platformEstimateUsd: round(filtered.filter((item) => item.cost.type === 'platform_estimate').reduce((sum, item) => sum + item.cost.amountUsd, 0), 5), cpaEstimateUsd: round(filtered.filter((item) => item.cost.type === 'cpa_estimate').reduce((sum, item) => sum + item.cost.amountUsd, 0), 5) } },
    options: { people: option(all.map((item) => item.person), (item) => item.name), departments: option(all.map((item) => item.person.department), (item) => item.name), purposes: option(all.map((item) => item.purpose), (item) => item.name), keys: option(all.map((item) => item.key), (item) => item.masked), models: option(all.map((item) => item.model), (item) => item.displayName), channels: option(all.map((item) => item.channel), (item) => item.name) },
    items: filtered.slice(start, start + query.pageSize),
    pagination: { page: query.page, pageSize: query.pageSize, total: filtered.length, totalPages: Math.ceil(filtered.length / query.pageSize) },
  }
}

export function createDemoUsageDetail(requestId: string, newApi: NewApiStatus, now = new Date()): UsageDetailResponse | null {
  const item = createRecords(now).find((record) => record.requestId === requestId)
  if (!item) return null
  const index = seeds.findIndex((seed) => seed.id === requestId)
  return { meta: { source: 'demo', generatedAt: now.toISOString(), notice: noticeFor(newApi) }, item, route: { alias: item.purpose.alias, retryCount: item.status === 'failed' ? 1 : 0, requestIdPropagated: true }, client: { name: index % 2 === 0 ? 'Codex Desktop' : 'WorkBuddy', mode: item.streamed ? 'stream' : 'non_stream' }, content: { stored: false, reason: '调用日志仅保存脱敏元数据；对话正文属于独立审计系统，当前记录未采集正文。' } }
}
