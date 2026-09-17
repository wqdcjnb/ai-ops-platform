import { describe, expect, it } from 'vitest'
import { createPlatformDatabase, databaseStatusSchema, seedDemoData } from './platform-db.js'

describe('platform database migrations', () => {
  it('creates the core schema in an isolated in-memory database', () => {
    const database = createPlatformDatabase({ filename: ':memory:', now: () => new Date('2026-09-17T10:00:00.000Z') })
    expect(databaseStatusSchema.parse(database.status())).toMatchObject({ state: 'ready', migrationVersion: 3, checkedAt: '2026-09-17T10:00:00.000Z' })
    expect(database.status().tables).toEqual(expect.arrayContaining(['departments', 'users', 'api_keys', 'quota_policies', 'audit_events', 'usage_requests']))
    database.migrate()
    expect(database.status().migrationVersion).toBe(3)
    database.close()
  })

  it('seeds repeatable demo organizations, keys, quotas, and audit events', () => {
    const database = createPlatformDatabase({ filename: ':memory:', now: () => new Date('2026-09-17T10:00:00.000Z') })
    const first = seedDemoData(database, new Date('2026-09-17T10:00:00.000Z'))
    const second = seedDemoData(database, new Date('2026-09-17T10:00:00.000Z'))
    expect(first).toEqual({ departments: 6, users: 14, apiKeys: 5, quotaPolicies: 6, auditEvents: 4, usageRequests: 12 })
    expect(second).toEqual(first)
    expect(database.findUserByUsername('demo-zhou')).toMatchObject({ id: 'person-zhou', role: 'employee', status: 'active' })
    expect(database.passwordMatches('demo-yan', 'demo-person-yan')).toBe(false)
    expect(database.listAuditEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'audit-key-rotate', resourceType: 'key', result: 'success', summary: expect.objectContaining({ sensitive: true }) }),
      expect.objectContaining({ id: 'audit-export-denied', resourceType: 'export', result: 'denied' }),
    ]))
    expect(database.listUsageRequests()).toEqual(expect.arrayContaining([
      expect.objectContaining({ requestId: 'req-demo-001', maskedValue: 'sk-ops••••••7F2A', errorSummary: null }),
      expect.objectContaining({ requestId: 'req-demo-003', status: 'failed', errorCategory: 'rate_limit' }),
    ]))
    expect(database.status().migrationVersion).toBe(3)
    database.close()
  })
})
