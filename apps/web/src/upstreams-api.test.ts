import { describe, expect, it } from 'vitest'
import { upstreamFiltersSchema, upstreamsResponseSchema } from './upstreams-api'

const item = {
  id: 'upstream-1', name: 'CPA OAuth', provider: 'CLIProxyAPI', type: 'cpa_oauth', environment: 'production', status: 'healthy', credentialConfigured: true, credentialValidation: 'verified', models: ['model-1'], health: { successRate: 99, latencyMs: 1000, checkedAt: '2026-09-15T10:00:00.000Z' }, balance: { state: 'unknown', label: '由 CPA 管理', updatedAt: null }, capacity: null, auth: null, windows: [], cooldown: null, recentError: null,
}
const response = { meta: { source: 'live', generatedAt: '2026-09-15T10:00:00.000Z', notice: '实时', live: { cpa: 'reachable', checkedAt: '2026-09-15T10:00:00.000Z', managementConfigured: true } }, summary: { total: 1, available: 1, needsAttention: 0, official: 0, experiment: 0, configured: 1 }, isolation: { enforced: true, productionToExperimentFallback: false, statement: '隔离' }, items: [item], total: 1 }

describe('upstream API contract', () => {
  it('validates supported account filters', () => {
    expect(upstreamFiltersSchema.safeParse({ search: '', type: 'cpa_oauth', status: 'auth_required' }).success).toBe(true)
    expect(upstreamFiltersSchema.safeParse({ search: '', type: 'official_api', status: 'healthy' }).success).toBe(false)
  })

  it('requires explicit safe credential and isolation fields', () => {
    expect(upstreamsResponseSchema.safeParse(response).success).toBe(true)
    expect(upstreamsResponseSchema.safeParse({ ...response, items: [{ ...item, credentialConfigured: 'yes' }] }).success).toBe(false)
    expect(upstreamsResponseSchema.safeParse({ ...response, isolation: { ...response.isolation, productionToExperimentFallback: true } }).success).toBe(false)
  })
})
