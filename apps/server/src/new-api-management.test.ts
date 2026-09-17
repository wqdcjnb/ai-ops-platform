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
