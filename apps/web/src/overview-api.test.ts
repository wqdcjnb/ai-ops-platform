import { describe, expect, it } from 'vitest'
import { overviewResponseSchema } from './overview-api'

const validOverview = {
  meta: { source: 'demo', generatedAt: '2026-09-15T10:00:00.000Z', timezone: 'Asia/Shanghai', period: '7d', notice: '演示数据' },
  service: {
    bff: 'healthy',
    newApi: { state: 'reachable', authConfigured: false, checkedAt: '2026-09-15T10:00:00.000Z' },
  },
  metrics: {
    todayRequests: 1,
    todayRequestDeltaPercent: 1,
    inputTokens: 2,
    outputTokens: 3,
    tokenDeltaPercent: 1,
    monthPoints: 4,
    monthPointLimit: 10,
    successRate: 99,
    successDeltaPercent: 1,
    p95LatencyMs: 1000,
    p95LatencyDeltaMs: -100,
    firstTokenLatencyMs: 500,
  },
  trend: [{ date: '09/15', requests: 1, points: 1 }],
  alerts: [],
  people: [],
  channels: [],
  limits: { mode: 'soft', blocking: false },
} as const

describe('overview API contract', () => {
  it('accepts the stable BFF response shape', () => {
    expect(overviewResponseSchema.safeParse(validOverview).success).toBe(true)
  })

  it('rejects a response that claims hard blocking is active', () => {
    const result = overviewResponseSchema.safeParse({ ...validOverview, limits: { mode: 'hard', blocking: true } })
    expect(result.success).toBe(false)
  })

  it('rejects an unlabelled upstream source', () => {
    const result = overviewResponseSchema.safeParse({ ...validOverview, meta: { ...validOverview.meta, source: 'live' } })
    expect(result.success).toBe(false)
  })
})
