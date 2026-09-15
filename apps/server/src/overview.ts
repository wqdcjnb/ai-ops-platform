import { z } from 'zod'
import { newApiStatusSchema, type NewApiStatus } from './new-api-status.js'

export const periodSchema = z.enum(['7d', '30d'])
export type Period = z.infer<typeof periodSchema>

const trendPointSchema = z.object({
  date: z.string(),
  requests: z.number().int().nonnegative(),
  points: z.number().int().nonnegative(),
})

const alertSchema = z.object({
  id: z.string(),
  level: z.enum(['warning', 'danger', 'experiment']),
  title: z.string(),
  detail: z.string(),
  occurredAt: z.string().datetime(),
  action: z.string(),
})

const personSchema = z.object({
  id: z.string(),
  name: z.string(),
  initials: z.string(),
  department: z.string(),
  purpose: z.string(),
  requests: z.number().int().nonnegative(),
  usagePercent: z.number().min(0),
  points: z.number().int().nonnegative(),
  tone: z.enum(['coral', 'blue', 'violet', 'green', 'amber']),
})

const channelSchema = z.object({
  id: z.string(),
  name: z.string(),
  model: z.string(),
  type: z.enum(['production', 'experiment']),
  status: z.enum(['healthy', 'auth_required']),
  latencyMs: z.number().int().nonnegative().nullable(),
  successRate: z.number().min(0).max(100),
  requests: z.number().int().nonnegative(),
})

export const overviewResponseSchema = z.object({
  meta: z.object({
    source: z.literal('demo'),
    generatedAt: z.string().datetime(),
    timezone: z.literal('Asia/Shanghai'),
    period: periodSchema,
    notice: z.string(),
  }),
  service: z.object({
    bff: z.literal('healthy'),
    newApi: newApiStatusSchema,
  }),
  metrics: z.object({
    todayRequests: z.number().int().nonnegative(),
    todayRequestDeltaPercent: z.number(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    tokenDeltaPercent: z.number(),
    monthPoints: z.number().int().nonnegative(),
    monthPointLimit: z.number().int().positive(),
    successRate: z.number().min(0).max(100),
    successDeltaPercent: z.number(),
    p95LatencyMs: z.number().int().nonnegative(),
    p95LatencyDeltaMs: z.number(),
    firstTokenLatencyMs: z.number().int().nonnegative(),
  }),
  trend: z.array(trendPointSchema),
  alerts: z.array(alertSchema),
  people: z.array(personSchema),
  channels: z.array(channelSchema),
  limits: z.object({ mode: z.literal('soft'), blocking: z.literal(false) }),
})

export type OverviewResponse = z.infer<typeof overviewResponseSchema>

function trendFor(period: Period) {
  if (period === '7d') {
    return [
      { date: '09/09', requests: 1260, points: 198 },
      { date: '09/10', requests: 1480, points: 224 },
      { date: '09/11', requests: 1395, points: 216 },
      { date: '09/12', requests: 1720, points: 268 },
      { date: '09/13', requests: 1910, points: 294 },
      { date: '09/14', requests: 1768, points: 279 },
      { date: '09/15', requests: 2146, points: 326 },
    ]
  }

  return Array.from({ length: 30 }, (_, index) => {
    const day = index + 17
    const date = new Date(2026, 7, day)
    const wave = Math.sin(index / 3) * 280
    const requests = Math.round(1180 + index * 26 + wave + (index % 5) * 42)
    return {
      date: `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`,
      requests,
      points: Math.round(requests * 0.153),
    }
  })
}

export function createDemoOverview(
  period: Period,
  now = new Date(),
  newApi: NewApiStatus = { state: 'offline', authConfigured: false, checkedAt: now.toISOString() },
): OverviewResponse {
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString()

  return {
    meta: {
      source: 'demo',
      generatedAt: now.toISOString(),
      timezone: 'Asia/Shanghai',
      period,
      notice: newApi.state === 'ready'
        ? 'New API 管理连接已验证；本页业务指标仍为演示数据，下一步开始映射真实人员与用量'
        : newApi.state === 'reachable'
          ? 'New API 服务可达，但尚未配置 BFF 管理凭据；本页业务指标仍为演示数据'
          : newApi.state === 'auth_required'
            ? 'New API 服务可达，但 BFF 管理凭据未通过验证；本页业务指标仍为演示数据'
            : 'New API 服务当前离线；本页业务指标仍为 BFF 演示数据',
    },
    service: { bff: 'healthy', newApi },
    metrics: {
      todayRequests: 2146,
      todayRequestDeltaPercent: 18.4,
      inputTokens: 6_180_000,
      outputTokens: 2_240_000,
      tokenDeltaPercent: 9.7,
      monthPoints: 7890,
      monthPointLimit: 12_400,
      successRate: 99.2,
      successDeltaPercent: 0.6,
      p95LatencyMs: 3800,
      p95LatencyDeltaMs: -400,
      firstTokenLatencyMs: 1100,
    },
    trend: trendFor(period),
    alerts: [
      { id: 'alert-soft-limit', level: 'warning', title: '林筱雨达到月度目标 86%', detail: '内容运营 · ecommerce-copy', occurredAt: minutesAgo(8), action: '查看人员' },
      { id: 'alert-upstream-5xx', level: 'danger', title: '官方渠道连续出现 5xx', detail: '近 10 分钟 7 次，当前已恢复', occurredAt: minutesAgo(24), action: '查看日志' },
      { id: 'alert-cpa-auth', level: 'experiment', title: 'CPA 实验账号需要重新认证', detail: '仅影响 ecommerce-pro-lab', occurredAt: minutesAgo(60), action: '检查账号' },
    ],
    people: [
      { id: 'person-lin', name: '林筱雨', initials: 'LY', department: '内容运营', purpose: '商品文案', requests: 1684, usagePercent: 86, points: 742, tone: 'coral' },
      { id: 'person-zhou', name: '周明远', initials: 'ZM', department: '广告投放', purpose: '策略分析', requests: 976, usagePercent: 79, points: 681, tone: 'blue' },
      { id: 'person-chen', name: '陈安琪', initials: 'CA', department: '跨境运营', purpose: '多语翻译', requests: 2210, usagePercent: 63, points: 543, tone: 'violet' },
      { id: 'person-xu', name: '许嘉禾', initials: 'XJ', department: '客户服务', purpose: '回复建议', requests: 2538, usagePercent: 51, points: 438, tone: 'green' },
      { id: 'person-tang', name: '唐语宁', initials: 'TY', department: '商品运营', purpose: '图片检查', requests: 744, usagePercent: 42, points: 361, tone: 'amber' },
    ],
    channels: [
      { id: 'channel-official-cn', name: 'Official CN', model: 'ecommerce-copy', type: 'production', status: 'healthy', latencyMs: 1200, successRate: 99.8, requests: 6284 },
      { id: 'channel-official-global', name: 'Official Global', model: 'ecommerce-analysis', type: 'production', status: 'healthy', latencyMs: 2800, successRate: 99.4, requests: 3719 },
      { id: 'channel-cpa-lab', name: 'CPA Lab 01', model: 'ecommerce-pro-lab', type: 'experiment', status: 'auth_required', latencyMs: null, successRate: 94.1, requests: 428 },
    ],
    limits: { mode: 'soft', blocking: false },
  }
}
