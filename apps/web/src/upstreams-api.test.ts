import { describe, expect, it } from 'vitest'
import { upstreamFiltersSchema, upstreamsResponseSchema } from './upstreams-api'

const item = {
  id: 'upstream-1', name: 'Official 01', provider: 'Provider', type: 'official_api', environment: 'production', status: 'healthy', credentialConfigured: true, credentialValidation: 'verified', models: ['model-1'], health: { successRate: 99, latencyMs: 1000, checkedAt: '2026-09-15T10:00:00.000Z' }, balance: { state: 'sufficient', label: '充足', updatedAt: '2026-09-15T10:00:00.000Z' }, capacity: { rpm: 100, tpm: 100000 }, auth: null, windows: [], cooldown: null, recentError: null,
}
const response = { meta: { source: 'demo', generatedAt: '2026-09-15T10:00:00.000Z', notice: '演示', live: { newApi: 'reachable', cpa: 'reachable', checkedAt: '2026-09-15T10:00:00.000Z' } }, summary: { total: 1, available: 1, needsAttention: 0, official: 1, experiment: 0, configured: 1 }, isolation: { enforced: true, productionToExperimentFallback: false, statement: '隔离' }, items: [item], total: 1 }

describe('upstream API contract', () => {
  it('validates supported account filters', () => {
    expect(upstreamFiltersSchema.safeParse({ search: '', type: 'cpa_oauth', status: 'auth_required' }).success).toBe(true)
    expect(upstreamFiltersSchema.safeParse({ search: '', type: 'personal', status: 'healthy' }).success).toBe(false)
  })

  it('requires explicit safe credential and isolation fields', () => {
    expect(upstreamsResponseSchema.safeParse(response).success).toBe(true)
    expect(upstreamsResponseSchema.safeParse({ ...response, items: [{ ...item, credentialConfigured: 'yes' }] }).success).toBe(false)
    expect(upstreamsResponseSchema.safeParse({ ...response, isolation: { ...response.isolation, productionToExperimentFallback: true } }).success).toBe(false)
  })
})
