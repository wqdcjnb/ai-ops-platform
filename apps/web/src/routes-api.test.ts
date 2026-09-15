import { describe, expect, it } from 'vitest'
import { routeFiltersSchema, routesResponseSchema } from './routes-api'

const target = { channel: 'Official 01', provider: 'OpenAI Compatible', model: 'model-1', group: 'production', status: 'healthy' }
const item = {
  id: 'route-copy', category: 'copy', categoryLabel: '文案', name: '商品文案', description: '描述', alias: 'ecommerce-copy', environment: 'production', status: 'healthy', dataClass: 'confidential', allowedRoles: ['内容运营'],
  primary: target, fallbacks: [target], policy: { timeoutSeconds: 45, maxRetries: 2, circuitBreakSeconds: 60, onTimeout: 'fallback', onRateLimit: 'fallback', onServerError: 'retry', crossGroupFallback: false, clientChannelOverride: false },
  usage: { requests7d: 100, successRate: 99.5, p95LatencyMs: 1200 },
}

describe('routes API contracts', () => {
  it('validates route filters', () => {
    expect(routeFiltersSchema.safeParse({ search: '', category: 'all', environment: 'production', status: 'healthy' }).success).toBe(true)
    expect(routeFiltersSchema.safeParse({ search: '', category: 'all', environment: 'staging', status: 'healthy' }).success).toBe(false)
    expect(routeFiltersSchema.safeParse({ search: 'x'.repeat(61), category: 'all', environment: 'all', status: 'all' }).success).toBe(false)
  })

  it('requires enforced isolation and disabled cross-group fallback', () => {
    const value = { meta: { source: 'demo', generatedAt: '2026-09-15T10:00:00.000Z', notice: '演示' }, summary: { total: 1, production: 1, experiment: 0, degraded: 0 }, options: { categories: [{ id: 'copy', label: '文案' }] }, isolation: { enforced: true, productionGroup: 'official', experimentGroup: 'cpa-lab', message: '隔离' }, items: [item], total: 1 }
    expect(routesResponseSchema.safeParse(value).success).toBe(true)
    expect(routesResponseSchema.safeParse({ ...value, items: [{ ...item, policy: { ...item.policy, crossGroupFallback: true } }] }).success).toBe(false)
    expect(routesResponseSchema.safeParse({ ...value, isolation: { ...value.isolation, enforced: false } }).success).toBe(false)
  })
})
