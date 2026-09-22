import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import { createNewApiManagementClient } from './new-api-management.js'
import type { GatewayConfig } from './gateway-config.js'

const apps: ReturnType<typeof buildApp>[] = []
const reachableNewApi = async () => ({ state: 'reachable' as const, authConfigured: false, checkedAt: '2026-09-15T10:00:00.000Z' })
const reachableService = async () => ({ state: 'reachable' as const, checkedAt: '2026-09-15T10:00:00.000Z' })

const gatewayConfig: GatewayConfig = {
  mode: 'cpa',
  provider: 'openai_compatible',
  baseUrl: 'http://cpa:8317/v1',
  upstreamApiKey: 'cpa-client-secret',
  timeoutMs: 2_000,
  allowFallback: false,
  modelAliases: {},
  upstreamConfigured: true,
}

function managementFetch() {
  let channels: Array<Record<string, unknown>> = []
  let nextId = 91
  let createCount = 0
  let lastChannelPayload: Record<string, unknown> | undefined
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname
    if (path === '/api/channel/' && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({ success: true, data: { page: 1, page_size: 100, total: channels.length, items: channels } }), { status: 200 })
    }
    if (path === '/api/channel/' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { channel: Record<string, unknown> }
      lastChannelPayload = body.channel
      const channel = { id: nextId++, ...body.channel, key: body.channel.key }
      channels = [...channels, channel]
      createCount += 1
      return new Response(JSON.stringify({ success: true, data: { id: channel.id } }), { status: 200 })
    }
    if (path === '/api/channel/' && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      channels = channels.map((channel) => channel.id === body.id ? { ...channel, ...body } : channel)
      return new Response(JSON.stringify({ success: true, data: { id: body.id } }), { status: 200 })
    }
    const statusMatch = /^\/api\/channel\/(\d+)\/status$/.exec(path)
    if (statusMatch && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { status: number }
      channels = channels.map((channel) => channel.id === Number(statusMatch[1]) ? { ...channel, status: body.status } : channel)
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    }
    return new Response(JSON.stringify({ success: false }), { status: 404 })
  }
  return { fetchImpl: fetchImpl as typeof fetch, get createCount() { return createCount }, get lastChannelPayload() { return lastChannelPayload }, seed(value: Array<Record<string, unknown>>) { channels = value } }
}

function createChannelApp(fetchImpl: typeof fetch, modelReader: () => Promise<readonly string[]> = async () => ['gpt-codex']) {
  const app = buildApp({
    authMode: 'disabled',
    gatewayConfig,
    newApiManagementClient: createNewApiManagementClient({ baseUrl: 'http://new-api.test', accessToken: 'management-secret', fetchImpl }),
    cpaModelReader: modelReader,
    probeNewApi: reachableNewApi,
    probeCpa: reachableService,
    probeDocs: reachableService,
  })
  apps.push(app)
  return app
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('New API CPA channel sync', () => {
  it('previews, creates, verifies, and idempotently replays the managed channel', async () => {
    const fixture = managementFetch()
    const app = createChannelApp(fixture.fetchImpl)

    const preview = await app.inject({ method: 'GET', url: '/api/integrations/new-api/channel/sync/preview' })
    expect(preview.statusCode).toBe(200)
    expect(preview.json()).toMatchObject({ cpa: { state: 'ready', modelIds: ['gpt-codex'], baseUrl: 'http://cpa:8317/v1' }, target: { marker: 'ai-ops:cpa:codex', externalChannelId: null, action: 'create' }, canApply: true })
    expect(JSON.stringify(preview.json())).not.toContain('cpa-client-secret')

    const body = { idempotencyKey: 'channel-sync-12345678' }
    const created = await app.inject({ method: 'POST', url: '/api/integrations/new-api/channel/sync', payload: body })
    expect(created.statusCode).toBe(200)
    expect(created.json()).toMatchObject({ status: 'succeeded', target: { externalChannelId: '91', action: 'create' }, operation: { idempotent: false } })
    expect(fixture.createCount).toBe(1)
    expect(fixture.lastChannelPayload?.base_url).toBe('http://cpa:8317')
    expect(JSON.stringify(created.json())).not.toContain('cpa-client-secret')

    const replay = await app.inject({ method: 'POST', url: '/api/integrations/new-api/channel/sync', payload: body })
    expect(replay.statusCode).toBe(200)
    expect(replay.json()).toMatchObject({ status: 'succeeded', operation: { idempotent: true } })
    expect(fixture.createCount).toBe(1)

    const unchanged = await app.inject({ method: 'POST', url: '/api/integrations/new-api/channel/sync', payload: { idempotencyKey: 'channel-sync-87654321' } })
    expect(unchanged.statusCode).toBe(200)
    expect(unchanged.json()).toMatchObject({ status: 'unchanged', target: { externalChannelId: '91', action: 'unchanged' } })
    expect(fixture.createCount).toBe(1)
  })

  it('stops on duplicate markers and blocks writes when CPA has no models', async () => {
    const fixture = managementFetch()
    fixture.seed([
      { id: 1, name: 'AI OPS · CPA Codex', type: 1, status: 1, base_url: 'http://cpa:8317/v1', models: 'gpt-codex', tag: 'ai-ops:cpa:codex', key: 'masked' },
      { id: 2, name: 'AI OPS · CPA Codex duplicate', type: 1, status: 1, base_url: 'http://cpa:8317/v1', models: 'gpt-codex', tag: 'ai-ops:cpa:codex', key: 'masked' },
    ])
    const app = createChannelApp(fixture.fetchImpl)
    const conflict = await app.inject({ method: 'GET', url: '/api/integrations/new-api/channel/sync/preview' })
    expect(conflict.statusCode).toBe(409)
    expect(conflict.json().error.code).toBe('NEW_API_CHANNEL_MARKER_CONFLICT')

    const blockedFixture = managementFetch()
    const blockedApp = createChannelApp(blockedFixture.fetchImpl, async () => [])
    const blockedPreview = await blockedApp.inject({ method: 'GET', url: '/api/integrations/new-api/channel/sync/preview' })
    expect(blockedPreview.statusCode).toBe(200)
    expect(blockedPreview.json()).toMatchObject({ cpa: { state: 'ready', modelIds: [] }, target: { action: 'blocked' }, canApply: false })
    const blockedWrite = await blockedApp.inject({ method: 'POST', url: '/api/integrations/new-api/channel/sync', payload: { idempotencyKey: 'channel-sync-blocked1' } })
    expect(blockedWrite.statusCode).toBe(503)
    expect(blockedWrite.json().error.code).toBe('CPA_CHANNEL_SOURCE_NOT_READY')
    expect(blockedFixture.createCount).toBe(0)
  })

  it('returns a stable authentication error before reading or writing New API channels', async () => {
    const fixture = managementFetch()
    const app = buildApp({
      authMode: 'disabled',
      gatewayConfig,
      newApiManagementClient: createNewApiManagementClient({ baseUrl: 'http://new-api.test', fetchImpl: fixture.fetchImpl }),
      cpaModelReader: async () => ['gpt-codex'],
      probeNewApi: reachableNewApi,
      probeCpa: reachableService,
      probeDocs: reachableService,
    })
    apps.push(app)
    const response = await app.inject({ method: 'GET', url: '/api/integrations/new-api/channel/sync/preview' })
    expect(response.statusCode).toBe(503)
    expect(response.json().error.code).toBe('NEW_API_AUTH_REQUIRED')
    expect(fixture.createCount).toBe(0)
  })
})
