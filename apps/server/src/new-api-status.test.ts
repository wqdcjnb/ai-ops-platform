import { describe, expect, it, vi } from 'vitest'
import { probeNewApiStatus } from './new-api-status.js'

const now = () => new Date('2026-09-15T10:00:00.000Z')

describe('New API status probe', () => {
  it('reports a reachable public service when no management credential is configured', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
    const status = await probeNewApiStatus({ fetchImpl, now })

    expect(status).toEqual({ state: 'reachable', authConfigured: false, checkedAt: now().toISOString() })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('validates configured credentials without returning them', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 })) as unknown as typeof fetch
    const status = await probeNewApiStatus({
      accessToken: 'server-secret',
      userId: '8',
      fetchImpl,
      now,
    })

    expect(status).toEqual({ state: 'ready', authConfigured: true, checkedAt: now().toISOString() })
    expect(JSON.stringify(status)).not.toContain('server-secret')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('reports offline instead of throwing when the upstream cannot be reached', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('connection refused') }) as unknown as typeof fetch
    await expect(probeNewApiStatus({ fetchImpl, now })).resolves.toEqual({
      state: 'offline',
      authConfigured: false,
      checkedAt: now().toISOString(),
    })
  })
})
