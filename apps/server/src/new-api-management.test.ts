import { describe, expect, it, vi } from 'vitest'
import { createNewApiManagementClient, newApiManagementResponseSchema, probeNewApiManagement } from './new-api-management.js'

describe('New API management adapter', () => {
  it.each(['<html>login</html>', '{"message":"private-error"}', '{"success":false,"message":"private-error"}', '{"success":true,"data":null}'])('rejects an invalid HTTP 200 envelope', async (body) => {
    const fetchImpl = vi.fn(async () => new Response(body)) as unknown as typeof fetch
    const result = await createNewApiManagementClient({ accessToken: 'fixture-token', fetchImpl }).getChannels()
    expect(result).toMatchObject({ state: 'unavailable', data: null })
    expect(result.message).not.toContain('private-error')
  })
  it('does not make a network request without a management credential', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const result = await createNewApiManagementClient({ fetchImpl }).getChannels()
    expect(result).toMatchObject({ state: 'auth_required', statusCode: 401, data: null })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('adds server-only authentication headers and reads the documented endpoints', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: 'Bearer management-secret', 'New-Api-User': '7' })
      return new Response(JSON.stringify({ success: true, data: { items: [{ id: 1 }] } }), { status: 200 })
    }) as unknown as typeof fetch
    const client = createNewApiManagementClient({ baseUrl: 'http://new-api.test/', accessToken: 'management-secret', userId: '7', fetchImpl })
    const result = await client.getChannels()
    expect(fetchImpl).toHaveBeenCalledWith('http://new-api.test/api/channel/?p=1&page_size=100&id_sort=false&tag_mode=false&status=all', expect.any(Object))
    expect(result).toMatchObject({ state: 'ready', statusCode: 200, data: { items: [{ id: 1 }] } })
  })

  it('reads and minimizes the New API user list without returning credential fields', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true, data: {
      page: 1, page_size: 100, total: 1,
      items: [{ id: 7, username: 'alice', display_name: 'Alice', status: 1, group: '运营', created_at: 1_700_000_000, last_login_at: 1_700_000_100, password: 'should-not-leave-adapter' }],
    } }), { status: 200 })) as unknown as typeof fetch
    const result = await createNewApiManagementClient({ accessToken: 'management-secret', fetchImpl }).listUsers()
    expect(result).toMatchObject({ state: 'ready', data: { page: 1, total: 1, items: [{ id: '7', username: 'alice', displayName: 'Alice', status: 1, group: '运营' }] } })
    expect(JSON.stringify(result)).not.toContain('should-not-leave-adapter')
  })

  it('reads the authenticated New API user for managed Token ownership', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('http://new-api.test/api/user/self')
      return new Response(JSON.stringify({ success: true, data: { id: 1, username: 'admin', status: 1, role: 100 } }), { status: 200 })
    }) as unknown as typeof fetch
    const result = await createNewApiManagementClient({ baseUrl: 'http://new-api.test', accessToken: 'management-secret', fetchImpl }).getSelfUser()
    expect(result).toMatchObject({ state: 'ready', data: { id: '1', username: 'admin', status: 1, role: 100 } })
  })

  it('creates an ordinary New API user with the shared name/department mapping', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('http://new-api.test/api/user/')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({ username: '王庆典', role: 1, display_name: '技术部', password: 'fixture-password' })
      return new Response(JSON.stringify({ success: true, data: { id: 9, username: '王庆典', display_name: '技术部', role: 1, status: 1 } }), { status: 200 })
    }) as unknown as typeof fetch
    const result = await createNewApiManagementClient({ baseUrl: 'http://new-api.test', accessToken: 'management-secret', fetchImpl }).createUser({ username: '王庆典', displayName: '技术部', password: 'fixture-password' })
    expect(result).toMatchObject({ state: 'ready', data: { id: '9', username: '王庆典', displayName: '技术部', role: 1, status: 1 } })
  })

  it('maps token creation, detail reads, and status updates to the documented endpoints', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/token/')) expect(init?.headers).toMatchObject({ 'New-Api-User': '42' })
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return new Response(JSON.stringify({ success: true, data: { id: 12, key: 'sk-token-value', status: 1 } }), { status: 200 })
    }) as unknown as typeof fetch
    const client = createNewApiManagementClient({ baseUrl: 'http://new-api.test', accessToken: 'management-secret', userId: '7', fetchImpl })
    await client.createToken({ user_id: '42', name: 'AIOPS-person-model-12345678', expired_time: -1, remain_quota: 0, unlimited_quota: true, model_limits_enabled: true, model_limits: 'ecommerce-copy', group: '' })
    await client.getToken('12', '42')
    await client.getTokenKey('12', '42')
    await client.updateTokenStatus('12', 0, '42')
    await client.enableUser('42')
    await client.disableUser('42')
    await client.deleteUser('42')
    expect(calls).toEqual([
      { url: 'http://new-api.test/api/token/', method: 'POST', body: { name: 'AIOPS-person-model-12345678', expired_time: -1, remain_quota: 0, unlimited_quota: true, model_limits_enabled: true, model_limits: 'ecommerce-copy', group: '' } },
      { url: 'http://new-api.test/api/token/12', method: 'GET' },
      { url: 'http://new-api.test/api/token/12/key', method: 'POST' },
      { url: 'http://new-api.test/api/token/?status_only=true', method: 'PUT', body: { id: 12, status: 0 } },
      { url: 'http://new-api.test/api/user/manage', method: 'POST', body: { id: 42, action: 'enable' } },
      { url: 'http://new-api.test/api/user/manage', method: 'POST', body: { id: 42, action: 'disable' } },
      { url: 'http://new-api.test/api/user/manage', method: 'POST', body: { id: 42, action: 'delete' } },
    ])
  })

  it('normalizes channel pages and maps create, update, and status writes without returning the channel key', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (init?.method === 'GET') {
        return new Response(JSON.stringify({ success: true, data: {
          page: 1, page_size: 100, total: 1,
          items: [{ id: 7, name: 'AI OPS · CPA Codex', type: 1, status: 1, base_url: 'http://cpa:8317/v1/', models: 'gpt-codex, gpt-codex', group: 'default', tag: 'ai-ops:cpa:codex', key: 'cpa-secret-should-not-leave-adapter' }],
        } }), { status: 200 })
      }
      return new Response(JSON.stringify({ success: true, data: { id: 7, name: 'AI OPS · CPA Codex', type: 1, status: 1, base_url: 'http://cpa:8317/v1', models: 'gpt-codex', tag: 'ai-ops:cpa:codex' } }), { status: 200 })
    }) as unknown as typeof fetch
    const client = createNewApiManagementClient({ baseUrl: 'http://new-api.test', accessToken: 'management-secret', fetchImpl })
    const listed = await client.listChannels()
    expect(listed).toMatchObject({ state: 'ready', data: { items: [{ id: '7', baseUrl: 'http://cpa:8317/v1', models: ['gpt-codex'], marker: 'ai-ops:cpa:codex', enabled: true, keyConfigured: true }] } })
    expect(JSON.stringify(listed)).not.toContain('cpa-secret-should-not-leave-adapter')
    await client.createChannel({ name: 'AI OPS · CPA Codex', type: 1, key: 'cpa-client-secret', baseUrl: 'http://cpa:8317/v1', models: ['gpt-codex'], tag: 'ai-ops:cpa:codex' })
    await client.updateChannel('7', { name: 'AI OPS · CPA Codex', type: 1, key: 'cpa-client-secret', baseUrl: 'http://cpa:8317/v1', models: ['gpt-codex'], tag: 'ai-ops:cpa:codex' })
    await client.updateChannelStatus('7', 0)
    expect(calls).toEqual(expect.arrayContaining([
      { url: 'http://new-api.test/api/channel/', method: 'POST', body: { mode: 'single', channel: { name: 'AI OPS · CPA Codex', type: 1, key: 'cpa-client-secret', base_url: 'http://cpa:8317/v1', models: 'gpt-codex', group: 'default', priority: 10, weight: 100, status: 1, tag: 'ai-ops:cpa:codex' } } },
      { url: 'http://new-api.test/api/channel/', method: 'PUT', body: { id: 7, name: 'AI OPS · CPA Codex', type: 1, key: 'cpa-client-secret', base_url: 'http://cpa:8317/v1', models: 'gpt-codex', group: 'default', priority: 10, weight: 100, status: 1, tag: 'ai-ops:cpa:codex' } },
      { url: 'http://new-api.test/api/channel/7/status', method: 'POST', body: { status: 0 } },
    ]))
  })

  it('keeps a valid channel probe failure as a test result instead of an adapter error', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('http://new-api.test/api/channel/test/7?model=gpt-image-2.5-flare')
      return new Response(JSON.stringify({ success: false, error_code: 'internal_server_error', message: 'model is only supported on /v1/images/generations', time: 0 }), { status: 200 })
    }) as unknown as typeof fetch
    const result = await createNewApiManagementClient({ baseUrl: 'http://new-api.test', accessToken: 'management-secret', fetchImpl }).testChannel('7', 'gpt-image-2.5-flare')
    expect(result).toMatchObject({ state: 'ready', data: { success: false, latencyMs: 0, message: 'model is only supported on /v1/images/generations' } })
  })

  it('reports capability state without returning upstream response bodies', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })) as unknown as typeof fetch
    const response = await probeNewApiManagement({ accessToken: 'management-secret', fetchImpl, now: () => new Date('2026-09-17T10:00:00.000Z') })
    expect(newApiManagementResponseSchema.parse(response)).toMatchObject({ state: 'ready', authConfigured: true, checkedAt: '2026-09-17T10:00:00.000Z', capabilities: { models: 'available', channels: 'available' } })
    expect(JSON.stringify(response)).not.toContain('management-secret')
  })

  it('fails closed when the management base URL is invalid', async () => {
    await expect(probeNewApiManagement({ baseUrl: 'file:///private', accessToken: 'management-secret' })).resolves.toMatchObject({ state: 'unavailable', authConfigured: true, capabilities: { models: 'unavailable', channels: 'unavailable' } })
  })
})
