import { z } from 'zod'
import type { NewApiStatus } from './new-api-status.js'
import type { PlatformDatabase } from './platform-db.js'

export const limitsQuerySchema = z.object({
  level: z.enum(['all', 'company', 'department', 'person', 'purpose', 'key']).default('all'),
  search: z.string().trim().max(60).default(''),
})

const periodUsageSchema = z.object({
  id: z.enum(['hour', 'day', 'week', 'month']),
  label: z.string(),
  used: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  percent: z.number().min(0),
  resetAt: z.string().datetime(),
})

const rateMetricSchema = z.object({
  limit: z.number().int().positive(),
  current: z.number().int().nonnegative(),
  hits: z.number().int().nonnegative(),
})

export const limitNodeSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  depth: z.number().int().min(0).max(4),
  level: z.enum(['company', 'department', 'person', 'purpose', 'key']),
  name: z.string(),
  descriptor: z.string(),
  mode: z.literal('soft'),
  state: z.enum(['normal', 'near', 'reached']),
  inheritedFrom: z.string().nullable(),
  periods: z.array(periodUsageSchema).length(4),
  rates: z.object({ rpm: rateMetricSchema, tpm: rateMetricSchema, concurrent: rateMetricSchema }),
})

export const limitsResponseSchema = z.object({
  meta: z.object({ source: z.enum(['demo', 'database']), generatedAt: z.string().datetime(), timezone: z.literal('Asia/Shanghai'), notice: z.string() }),
  summary: z.object({
    monthlyLimit: z.number().int().positive(),
    used: z.number().int().nonnegative(),
    reserved: z.number().int().nonnegative(),
    percent: z.number().min(0),
    alertedScopes: z.number().int().nonnegative(),
    hitCount: z.number().int().nonnegative(),
  }),
  hardMode: z.object({
    enabled: z.literal(false),
    blocking: z.literal(false),
    requirements: z.array(z.object({ label: z.string(), state: z.literal('pending'), detail: z.string() })),
  }),
  options: z.object({ levels: z.array(z.object({ id: z.enum(['company', 'department', 'person', 'purpose', 'key']), label: z.string() })) }),
  items: z.array(limitNodeSchema),
  total: z.number().int().nonnegative(),
})

export type LimitsQuery = z.infer<typeof limitsQuerySchema>
export type LimitsResponse = z.infer<typeof limitsResponseSchema>
type LimitNode = z.infer<typeof limitNodeSchema>

interface NodeSeed {
  id: string
  parentId: string | null
  depth: number
  level: LimitNode['level']
  name: string
  descriptor: string
  monthlyLimit: number
  used: number
  reserved: number
  rpm: number
  currentRpm: number
  tpm: number
  currentTpm: number
  concurrent: number
  currentConcurrent: number
  hits: number
  inheritedFrom: string | null
}

const demoNodes: NodeSeed[] = [
  { id: 'company-xinzhi', parentId: null, depth: 0, level: 'company', name: '新知科技', descriptor: '全公司统一预算池', monthlyLimit: 12_000, used: 6_780, reserved: 420, rpm: 900, currentRpm: 326, tpm: 1_800_000, currentTpm: 628_000, concurrent: 52, currentConcurrent: 18, hits: 19, inheritedFrom: null },
  { id: 'department-content', parentId: 'company-xinzhi', depth: 1, level: 'department', name: '内容运营', descriptor: '3 人 · 4 个 Key', monthlyLimit: 3_200, used: 2_540, reserved: 170, rpm: 240, currentRpm: 136, tpm: 480_000, currentTpm: 286_000, concurrent: 14, currentConcurrent: 8, hits: 11, inheritedFrom: '新知科技' },
  { id: 'person-lin', parentId: 'department-content', depth: 2, level: 'person', name: '林筱雨', descriptor: '资深内容运营', monthlyLimit: 860, used: 742, reserved: 54, rpm: 90, currentRpm: 61, tpm: 180_000, currentTpm: 128_000, concurrent: 6, currentConcurrent: 4, hits: 7, inheritedFrom: '内容运营' },
  { id: 'purpose-copy', parentId: 'person-lin', depth: 3, level: 'purpose', name: '商品文案', descriptor: '业务用途 · ecommerce-copy', monthlyLimit: 650, used: 584, reserved: 38, rpm: 70, currentRpm: 55, tpm: 140_000, currentTpm: 112_000, concurrent: 5, currentConcurrent: 4, hits: 6, inheritedFrom: '林筱雨' },
  { id: 'key-lin-1', parentId: 'purpose-copy', depth: 4, level: 'key', name: 'sk-ops••••••7F2A', descriptor: '内容工作站', monthlyLimit: 520, used: 472, reserved: 31, rpm: 60, currentRpm: 51, tpm: 120_000, currentTpm: 102_000, concurrent: 4, currentConcurrent: 4, hits: 6, inheritedFrom: '商品文案' },
  { id: 'purpose-temp', parentId: 'person-lin', depth: 3, level: 'purpose', name: '临时项目', descriptor: '业务用途 · ecommerce-copy', monthlyLimit: 210, used: 158, reserved: 16, rpm: 30, currentRpm: 12, tpm: 60_000, currentTpm: 26_000, concurrent: 2, currentConcurrent: 1, hits: 1, inheritedFrom: '林筱雨' },
  { id: 'key-lin-2', parentId: 'purpose-temp', depth: 4, level: 'key', name: 'sk-ops••••••3C91', descriptor: '选品项目', monthlyLimit: 210, used: 158, reserved: 16, rpm: 30, currentRpm: 12, tpm: 60_000, currentTpm: 26_000, concurrent: 2, currentConcurrent: 1, hits: 1, inheritedFrom: '临时项目' },
  { id: 'department-ads', parentId: 'company-xinzhi', depth: 1, level: 'department', name: '广告投放', descriptor: '2 人 · 3 个 Key', monthlyLimit: 2_600, used: 1_820, reserved: 106, rpm: 200, currentRpm: 94, tpm: 400_000, currentTpm: 176_000, concurrent: 12, currentConcurrent: 5, hits: 5, inheritedFrom: '新知科技' },
  { id: 'person-zhou', parentId: 'department-ads', depth: 2, level: 'person', name: '周明远', descriptor: '投放策略师', monthlyLimit: 860, used: 681, reserved: 45, rpm: 80, currentRpm: 43, tpm: 160_000, currentTpm: 91_000, concurrent: 5, currentConcurrent: 3, hits: 3, inheritedFrom: '广告投放' },
  { id: 'purpose-analysis', parentId: 'person-zhou', depth: 3, level: 'purpose', name: '策略分析', descriptor: '业务用途 · ecommerce-analysis', monthlyLimit: 860, used: 681, reserved: 45, rpm: 80, currentRpm: 43, tpm: 160_000, currentTpm: 91_000, concurrent: 5, currentConcurrent: 3, hits: 3, inheritedFrom: '周明远' },
  { id: 'key-zhou-1', parentId: 'purpose-analysis', depth: 4, level: 'key', name: 'sk-ops••••••8B14', descriptor: '投放工作站', monthlyLimit: 860, used: 681, reserved: 45, rpm: 60, currentRpm: 43, tpm: 120_000, currentTpm: 91_000, concurrent: 4, currentConcurrent: 3, hits: 3, inheritedFrom: '策略分析' },
  { id: 'department-global', parentId: 'company-xinzhi', depth: 1, level: 'department', name: '跨境运营', descriptor: '2 人 · 3 个 Key', monthlyLimit: 2_400, used: 1_410, reserved: 78, rpm: 180, currentRpm: 63, tpm: 360_000, currentTpm: 124_000, concurrent: 10, currentConcurrent: 3, hits: 2, inheritedFrom: '新知科技' },
]

function resetAt(now: Date, period: 'hour' | 'day' | 'week' | 'month') {
  const date = new Date(now)
  if (period === 'hour') date.setHours(date.getHours() + 1, 0, 0, 0)
  if (period === 'day') date.setDate(date.getDate() + 1), date.setHours(0, 0, 0, 0)
  if (period === 'week') date.setDate(date.getDate() + (8 - date.getDay()) % 7), date.setHours(0, 0, 0, 0)
  if (period === 'month') date.setMonth(date.getMonth() + 1, 1), date.setHours(0, 0, 0, 0)
  return date.toISOString()
}

function mapNode(seed: NodeSeed, now: Date): LimitNode {
  const ratio = (seed.used + seed.reserved) / seed.monthlyLimit
  const makePeriod = (id: 'hour' | 'day' | 'week' | 'month', label: string, factor: number, limitFactor: number) => {
    const used = Math.round(seed.used * factor)
    const reserved = Math.round(seed.reserved * factor)
    const limit = Math.max(1, Math.round(seed.monthlyLimit * limitFactor))
    return { id, label, used, reserved, limit, percent: Number(((used + reserved) / limit * 100).toFixed(1)), resetAt: resetAt(now, id) }
  }
  return {
    id: seed.id, parentId: seed.parentId, depth: seed.depth, level: seed.level, name: seed.name, descriptor: seed.descriptor,
    mode: 'soft', state: ratio >= 1 ? 'reached' : ratio >= 0.8 ? 'near' : 'normal', inheritedFrom: seed.inheritedFrom,
    periods: [makePeriod('hour', '本小时', 0.0018, 0.0025), makePeriod('day', '今日', 0.035, 0.05), makePeriod('week', '本周', 0.22, 0.25), makePeriod('month', '本月', 1, 1)],
    rates: {
      rpm: { limit: seed.rpm, current: seed.currentRpm, hits: seed.hits },
      tpm: { limit: seed.tpm, current: seed.currentTpm, hits: Math.max(0, seed.hits - 2) },
      concurrent: { limit: seed.concurrent, current: seed.currentConcurrent, hits: Math.max(0, seed.hits - 4) },
    },
  }
}

function noticeFor(newApi: NewApiStatus) {
  if (newApi.state === 'ready') return 'New API 管理连接已验证；额度字段映射完成前，本页仍使用演示策略'
  if (newApi.state === 'reachable') return 'New API 服务可达但尚未配置管理认证；额度与限流为演示策略'
  if (newApi.state === 'auth_required') return 'New API 管理认证未通过；额度与限流为演示策略'
  return 'New API 当前离线；额度与限流为演示策略'
}

export function createDemoLimits(query: LimitsQuery, newApi: NewApiStatus, now = new Date()): LimitsResponse {
  const all = demoNodes.map((node) => mapNode(node, now))
  const search = query.search.toLocaleLowerCase('zh-CN')
  const items = all.filter((node) => (query.level === 'all' || node.level === query.level) && (!search || [node.name, node.descriptor, node.inheritedFrom ?? ''].some((value) => value.toLocaleLowerCase('zh-CN').includes(search))))
  const company = all[0]!
  const month = company.periods.find((period) => period.id === 'month')!
  return {
    meta: { source: 'demo', generatedAt: now.toISOString(), timezone: 'Asia/Shanghai', notice: noticeFor(newApi) },
    summary: { monthlyLimit: month.limit, used: month.used, reserved: month.reserved, percent: month.percent, alertedScopes: all.filter((node) => node.state !== 'normal').length, hitCount: company.rates.rpm.hits },
    hardMode: {
      enabled: false, blocking: false,
      requirements: [
        { label: '并发预留', state: 'pending', detail: '请求开始时预留，结束后按实际用量结算' },
        { label: '取消与重试', state: 'pending', detail: '验证取消释放、幂等重试和重复请求扣减' },
        { label: '统计故障', state: 'pending', detail: '验证计量服务不可用时执行保守策略' },
      ],
    },
    options: { levels: [{ id: 'company', label: '公司' }, { id: 'department', label: '部门' }, { id: 'person', label: '人员' }, { id: 'purpose', label: '用途' }, { id: 'key', label: 'Key' }] },
    items, total: items.length,
  }
}

function policySubject(node: LimitNode) {
  if (node.level === 'company') return node.id
  if (node.level === 'department') return node.id.replace(/^department-/, '')
  if (node.level === 'person') return node.id
  if (node.level === 'purpose') return node.id === 'purpose-copy' ? 'ecommerce-copy' : node.id === 'purpose-analysis' ? 'ecommerce-analysis' : 'ecommerce-copy'
  return node.id
}

function quotaNotice(newApi: NewApiStatus) {
  if (newApi.state === 'ready') return '软额度目标已从平台 SQLite 读取；用量账本和硬额度仍待接入'
  if (newApi.state === 'reachable') return '软额度目标来自平台 SQLite；New API 服务可达但尚未配置管理认证'
  if (newApi.state === 'auth_required') return '软额度目标来自平台 SQLite；New API 管理认证未通过'
  return '软额度目标来自平台 SQLite；New API 当前离线'
}

export function createDatabaseLimits(database: PlatformDatabase, query: LimitsQuery, newApi: NewApiStatus, now = new Date()): LimitsResponse {
  const demo = createDemoLimits({ level: 'all', search: '' }, newApi, now)
  const policies = database.listQuotaPolicies()
  const all = demo.items.map((node) => {
    const policy = policies.find((item) => item.level === node.level && item.subjectId === policySubject(node) && item.period === 'month')
    if (!policy) return node
    const periods = node.periods.map((period) => period.id === 'month'
      ? { ...period, limit: policy.targetPoints, percent: Number(((period.used + period.reserved) / policy.targetPoints * 100).toFixed(1)) }
      : period)
    const month = periods.find((period) => period.id === 'month')!
    const state = (month.used + month.reserved) / month.limit >= 1 ? 'reached' : (month.used + month.reserved) / month.limit >= 0.8 ? 'near' : 'normal'
    return { ...node, mode: 'soft' as const, state: state as LimitNode['state'], periods }
  })
  const search = query.search.toLocaleLowerCase('zh-CN')
  const items = all.filter((node) => (query.level === 'all' || node.level === query.level) && (!search || [node.name, node.descriptor, node.inheritedFrom ?? ''].some((value) => value.toLocaleLowerCase('zh-CN').includes(search))))
  const company = all[0]!
  const month = company.periods.find((period) => period.id === 'month')!
  return { ...demo, meta: { ...demo.meta, source: 'database', notice: quotaNotice(newApi) }, summary: { monthlyLimit: month.limit, used: month.used, reserved: month.reserved, percent: month.percent, alertedScopes: all.filter((node) => node.state !== 'normal').length, hitCount: company.rates.rpm.hits }, items, total: items.length }
}
