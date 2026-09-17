import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from './app.js'
import { CatalogError, createModelCatalog, type CatalogReader } from './model-catalog.js'
import { channelsQuerySchema, modelsQuerySchema } from './models.js'
import { createNewApiManagementClient } from './new-api-management.js'

const now = '2026-09-17T10:00:00.000Z'
const modelQuery = modelsQuerySchema.parse({ source: 'new_api' })
const channelQuery = channelsQuerySchema.parse({ source: 'new_api' })
const metadata = [{ id: 11, model_name: 'mock-text', status: 1 }, { id: 12, model_name: 'mock-disabled', status: 0 }]
const channels = [
  { id: 21, name: 'Mock enabled', models: 'mock-text, mock-channel-only, mock-text', status: 1, type: 1, key: 'upstream-private-sentinel', base_url: 'https://private.invalid/secret', header_override: 'private-header', response_time: 12, test_time: 1234 },
  { id: 22, name: 'Mock disabled', models: 'mock-disabled', status: 3, settings: 'private-settings' },
]
const ready = (data: unknown) => ({ state: 'ready' as const, data, statusCode: 200, message: null })
function readerFor(models: unknown = metadata, entries: unknown = channels) {
  return { getModelMetadata: vi.fn(async () => ready(models)), getChannels: vi.fn(async () => ready(entries)) }
}
const apps: ReturnType<typeof buildApp>[] = []
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })

describe('New API catalog mapping with simulated upstream responses', () => {
  it('maps configuration and relations without inventing health, price or business data', async () => {
    const fetchImpl = vi.fn(async (url: string) => new Response(JSON.stringify({ success: true, data: url.includes('/api/models/') ? { items: metadata, total: 2 } : { items: channels, total: 2 } }))) as unknown as typeof fetch
    const reader = createNewApiManagementClient({ baseUrl: 'http://new-api.test', accessToken: 'fixture-management-secret', fetchImpl })
    const catalog = createModelCatalog(reader, () => new Date(now))
    const [models, result] = await Promise.all([catalog.models(modelQuery), catalog.channels(channelQuery)])
    expect(models).toMatchObject({ meta: { source: 'new_api', generatedAt: now }, total: 3 })
    expect(models.items.find((item) => item.actualModel === 'mock-text')).toMatchObject({ status: 'unverified', contextWindow: null, pricing: null, aliases: [], purposes: [], environment: 'unassigned', channelIds: ['new-api-channel-21'] })
    expect(models.items.find((item) => item.actualModel === 'mock-disabled')?.status).toBe('unavailable')
    expect(result.items[0]).toMatchObject({ status: 'unverified', latencyMs: null, successRate: null, credentialConfigured: null, checkedAt: null, rateLimits: { rpm: null, tpm: null } })
    expect(result.items[1]?.status).toBe('offline')
    expect(result.summary.healthy).toBe(0)
    expect(result.items[0]?.modelIds).toHaveLength(2)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(JSON.stringify({ models, result })).not.toMatch(/private-sentinel|private.invalid|private-header|private-settings|fixture-management-secret|response_time|header_override/)
  })

  it('keeps an empty real catalog empty instead of falling back to demo fixtures', async () => {
    const catalog = createModelCatalog(readerFor({ items: [], total: 0 }, { items: [], total: 0 }))
    expect(await catalog.models(modelQuery)).toMatchObject({ meta: { source: 'new_api' }, items: [], total: 0, summary: { total: 0 } })
    expect(await catalog.channels(channelQuery)).toMatchObject({ items: [], total: 0 })
  })

  it('reads all pages before applying filters and shares one normalized snapshot', async () => {
    const reader: CatalogReader = {
      getModelMetadata: vi.fn(async (page = 1) => ready({ page, items: [metadata[page - 1]], total: 2 })),
      getChannels: vi.fn(async (page = 1) => ready({ page, items: [channels[page - 1]], total: 2 })),
    }
    const catalog = createModelCatalog(reader)
    const result = await catalog.models({ ...modelQuery, search: 'DISABLED' })
    expect(result.total).toBe(1)
    expect(result.summary.total).toBe(3)
    expect(await catalog.channels({ ...channelQuery, status: 'offline' })).toMatchObject({ total: 1, summary: { total: 2 } })
    expect(reader.getModelMetadata).toHaveBeenNthCalledWith(2, 2, 100)
    expect(reader.getChannels).toHaveBeenCalledTimes(2)
    expect((await catalog.models({ ...modelQuery, search: 'no-match' })).items).toEqual([])
    expect((await catalog.models({ ...modelQuery, capability: 'vision' })).items).toEqual([])
  })

  it.each([
    { data: {}, code: 'NEW_API_INVALID_DATA' },
    { data: { items: [{ model_name: 'missing-id' }], total: 1 }, code: 'NEW_API_INVALID_DATA' },
    { data: { items: [], total: 1 }, code: 'NEW_API_INVALID_DATA' },
    { data: { items: metadata, total: 1 }, code: 'NEW_API_INVALID_DATA' },
    { data: { items: [metadata[0], metadata[0]], total: 2 }, code: 'NEW_API_INVALID_DATA' },
    { data: { items: [], total: 2001 }, code: 'NEW_API_CATALOG_LIMIT' },
  ])('rejects malformed or incomplete pages: $code', async ({ data, code }) => {
    await expect(createModelCatalog(readerFor(data, [])).models(modelQuery)).rejects.toMatchObject({ code })
  })

  it('does not serve stale success after cache expiry and recovers on retry', async () => {
    let time = new Date(now)
    const reader = readerFor()
    const catalog = createModelCatalog(reader, () => time)
    await catalog.models(modelQuery)
    time = new Date(time.getTime() + 31_000)
    reader.getChannels.mockRejectedValueOnce(new Error('private-network-error'))
    await expect(catalog.channels(channelQuery)).rejects.toEqual(new CatalogError('NEW_API_UNAVAILABLE'))
    expect((await catalog.channels(channelQuery)).total).toBe(2)
  })

  it('returns a safe upstream error at the BFF without silently returning demo data', async () => {
    const reader = readerFor()
    const failing: CatalogReader = { ...reader, getModelMetadata: async () => ({ state: 'auth_required', data: null, statusCode: 401, message: 'private-upstream-error' }) }
    const app = buildApp({ authMode: 'disabled', catalogReader: failing })
    apps.push(app)
    const response = await app.inject('/api/models?source=new_api')
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ error: { code: 'NEW_API_AUTH_REQUIRED' } })
    expect(response.body).not.toContain('private-upstream-error')
    expect(response.json().items).toBeUndefined()
  })

  it('keeps default demo mode independent of management access and enforces live admin access', async () => {
    const reader = readerFor()
    const app = buildApp({ databasePath: ':memory:', catalogReader: reader, probeNewApi: async () => ({ state: 'offline', authConfigured: false, checkedAt: now }), authService: {
      authenticate: () => ({ id: 'lead', username: 'lead', displayName: 'Lead', role: 'department_lead', roleLabel: '负责人' }),
      login: () => null, revoke() {}, setSessionCookie() {}, clearSessionCookie() {},
    } })
    apps.push(app)
    expect((await app.inject('/api/models')).json()).toMatchObject({ meta: { source: 'demo' }, total: 4 })
    expect((await app.inject('/api/channels?source=new_api')).statusCode).toBe(403)
    expect(reader.getChannels).not.toHaveBeenCalled()
  })
})
