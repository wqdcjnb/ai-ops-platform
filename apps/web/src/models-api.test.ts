import { describe, expect, it } from 'vitest'
import { channelFiltersSchema, channelsResponseSchema, modelFiltersSchema, modelsResponseSchema } from './models-api'

const model = { id: 'model-1', displayName: '模型', provider: 'Provider', actualModel: 'model-1', aliases: ['ecommerce-copy'], capabilities: ['text'], contextWindow: 128000, region: '中国区', environment: 'production', status: 'available', pricing: { inputPerMillion: 1, outputPerMillion: 2, currency: 'USD', basis: 'official', updatedAt: '2026-09-15T00:00:00.000Z' }, purposes: [{ name: '文案', alias: 'ecommerce-copy', role: 'primary' }], channelIds: ['channel-1'] }
const channel = { id: 'channel-1', name: 'Official 01', provider: 'Provider', type: 'official_api', environment: 'production', status: 'healthy', modelIds: ['model-1'], latencyMs: 1000, successRate: 99, balanceState: 'sufficient', rateLimits: { rpm: 100, tpm: 100000 }, recentError: null, checkedAt: '2026-09-15T10:00:00.000Z', credentialConfigured: true }

describe('model and channel API contracts', () => {
  it('validates model and channel filters', () => {
    expect(modelFiltersSchema.safeParse({ search: '', capability: 'vision', environment: 'production', status: 'available' }).success).toBe(true)
    expect(modelFiltersSchema.safeParse({ search: '', capability: 'audio', environment: 'production', status: 'available' }).success).toBe(false)
    expect(channelFiltersSchema.safeParse({ environment: 'experiment', status: 'healthy' }).success).toBe(true)
    expect(channelFiltersSchema.safeParse({ environment: 'all', status: 'unknown' }).success).toBe(false)
  })

  it('requires explicit pricing basis and safe channel credential state', () => {
    const models = { meta: { source: 'demo', generatedAt: '2026-09-15T10:00:00.000Z', notice: '演示' }, summary: { total: 1, available: 1, degraded: 0, production: 1, experiment: 0 }, options: { capabilities: [{ id: 'text', label: '文本' }] }, items: [model], total: 1 }
    const channels = { meta: { source: 'demo', generatedAt: '2026-09-15T10:00:00.000Z', notice: '演示', healthCacheSeconds: 30 }, summary: { total: 1, healthy: 1, degraded: 0, offline: 0 }, items: [channel], total: 1 }
    expect(modelsResponseSchema.safeParse(models).success).toBe(true)
    expect(channelsResponseSchema.safeParse(channels).success).toBe(true)
    expect(modelsResponseSchema.safeParse({ ...models, items: [{ ...model, pricing: { ...model.pricing, basis: 'guess' } }] }).success).toBe(false)
    expect(channelsResponseSchema.safeParse({ ...channels, items: [{ ...channel, credentialConfigured: 'yes' }] }).success).toBe(false)
  })
})
