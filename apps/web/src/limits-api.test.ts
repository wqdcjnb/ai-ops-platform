import { describe, expect, it } from 'vitest'
import { limitFiltersSchema, limitsResponseSchema } from './limits-api'

const rate = { limit: 60, current: 12, hits: 1 }
const periods = [
  { id: 'hour', label: '本小时', used: 1, reserved: 0, limit: 2, percent: 50, resetAt: '2026-09-15T11:00:00.000Z' },
  { id: 'day', label: '今日', used: 4, reserved: 1, limit: 10, percent: 50, resetAt: '2026-09-16T00:00:00.000Z' },
  { id: 'week', label: '本周', used: 20, reserved: 2, limit: 40, percent: 55, resetAt: '2026-09-21T00:00:00.000Z' },
  { id: 'month', label: '本月', used: 55, reserved: 5, limit: 100, percent: 60, resetAt: '2026-10-01T00:00:00.000Z' },
]

describe('limits API contracts', () => {
  it('accepts only the five supported policy levels', () => {
    expect(limitFiltersSchema.safeParse({ level: 'person', search: '' }).success).toBe(true)
    expect(limitFiltersSchema.safeParse({ level: 'tenant', search: '' }).success).toBe(false)
    expect(limitFiltersSchema.safeParse({ level: 'all', search: 'x'.repeat(61) }).success).toBe(false)
  })

  it('requires soft mode and a server-disabled hard limit state', () => {
    const value = {
      meta: { source: 'demo', generatedAt: '2026-09-15T10:00:00.000Z', timezone: 'Asia/Shanghai', notice: '演示' },
      summary: { monthlyLimit: 100, used: 55, reserved: 5, percent: 60, alertedScopes: 0, hitCount: 1 },
      hardMode: { enabled: false, blocking: false, requirements: [{ label: '并发预留', state: 'pending', detail: '待验证' }] },
      options: { levels: [{ id: 'company', label: '公司' }] },
      items: [{ id: 'company-test', parentId: null, depth: 0, level: 'company', name: '测试', descriptor: '测试公司', mode: 'soft', state: 'normal', inheritedFrom: null, periods, rates: { rpm: rate, tpm: rate, concurrent: rate } }],
      total: 1,
    }
    expect(limitsResponseSchema.safeParse(value).success).toBe(true)
    expect(limitsResponseSchema.safeParse({ ...value, hardMode: { ...value.hardMode, blocking: true } }).success).toBe(false)
    expect(limitsResponseSchema.safeParse({ ...value, meta: { ...value.meta, source: 'database' } }).success).toBe(true)
  })
})
