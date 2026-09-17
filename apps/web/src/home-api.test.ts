import { describe, expect, it } from 'vitest'
import { platformStatusSchema, taskSummarySchema } from './home-api'

const time = '2026-09-15T10:00:00.000Z'

describe('home API contracts', () => {
  it('accepts a complete three-service platform matrix', () => {
    const result = platformStatusSchema.safeParse({
      meta: { source: 'live', generatedAt: time },
      services: [
        { id: 'bff', name: 'BFF', state: 'healthy', detail: '在线', checkedAt: time },
        { id: 'new-api', name: 'New API', state: 'reachable', detail: '待认证', checkedAt: time },
        { id: 'cpa', name: 'CPA', state: 'offline', detail: '离线', checkedAt: time },
      ],
      setup: [],
      links: [
        { id: 'new-api', label: 'New API', url: 'http://127.0.0.1:3000' },
        { id: 'cpa', label: 'CPA', url: 'http://127.0.0.1:8317/management.html' },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('rejects unsafe external links and secret-shaped task fields', () => {
    const platform = platformStatusSchema.safeParse({
      meta: { source: 'live', generatedAt: time },
      services: [],
      setup: [],
      links: [
        { id: 'new-api', label: 'New API', url: 'javascript:alert(1)' },
        { id: 'cpa', label: 'CPA', url: 'http://127.0.0.1:8317/management.html' },
      ],
    })
    const tasks = taskSummarySchema.safeParse({
      source: 'database', simulated: true, generatedAt: time, total: 0,
      summary: { openAlerts: 0, criticalAlerts: 0, activeKeys: 0, expiringKeys: 0 },
      items: [], accessToken: 'secret',
    })
    expect(platform.success).toBe(false)
    expect(tasks.success).toBe(true)
    if (tasks.success) expect('accessToken' in tasks.data).toBe(false)
  })
})
