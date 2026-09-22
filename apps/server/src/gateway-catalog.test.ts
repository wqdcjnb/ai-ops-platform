import { describe, expect, it, vi } from 'vitest'
import { loadGatewayConfig } from './gateway-config.js'
import { CpaCatalogError, createCpaCatalog } from './gateway-catalog.js'
import type { GatewayUpstream } from './gateway/openai-compatible.js'

const now = new Date('2026-09-19T10:00:00.000Z')

function upstream(models = [{ id: 'gpt-5-codex', object: 'model' as const, created: 1, owned_by: 'cpa' }]): GatewayUpstream {
  return {
    listModels: vi.fn(async () => models),
    chatCompletion: vi.fn(),
    chatCompletionStream: vi.fn(),
    cancel: vi.fn(async () => undefined),
  }
}

describe('CPA live model catalog', () => {
  it('maps CPA models to production-only catalog entries and business aliases', async () => {
    const source = upstream()
    const catalog = createCpaCatalog(source, loadGatewayConfig({
      AI_OPS_GATEWAY_MODE: 'cpa',
      AI_OPS_GATEWAY_CPA_BASE_URL: 'http://127.0.0.1:8317/v1',
      AI_OPS_GATEWAY_CPA_API_KEY: 'server-key',
      AI_OPS_GATEWAY_MODEL_ALIASES: 'ecommerce-general=gpt-5-codex',
    }), () => now)

    const [models, channels] = await Promise.all([
      catalog.models({ source: 'cpa', search: '', capability: 'all', environment: 'production', status: 'all' }),
      catalog.channels({ source: 'cpa', environment: 'production', status: 'all' }),
    ])

    expect(models).toMatchObject({ meta: { source: 'cpa', generatedAt: now.toISOString() }, summary: { total: 1, production: 1, experiment: 0 }, total: 1 })
    expect(models.items[0]).toMatchObject({ actualModel: 'gpt-5-codex', environment: 'production', aliases: ['ecommerce-general'], purposes: [{ name: '通用运营', alias: 'ecommerce-general' }] })
    expect(channels).toMatchObject({ meta: { source: 'cpa' }, summary: { total: 1, healthy: 1 }, total: 1 })
    expect(channels.items[0]).toMatchObject({ id: 'channel-cpa-gateway', name: 'CPA Codex OAuth', environment: 'production', credentialConfigured: true })
    expect(source.listModels).toHaveBeenCalledTimes(1)
  })

  it('does not invent a catalog when CPA is not configured', async () => {
    const catalog = createCpaCatalog(upstream(), loadGatewayConfig({ AI_OPS_GATEWAY_MODE: 'cpa' }), () => now)
    await expect(catalog.models({ source: 'cpa', search: '', capability: 'all', environment: 'production', status: 'all' })).rejects.toEqual(new CpaCatalogError('CPA_NOT_CONFIGURED'))
  })
})
