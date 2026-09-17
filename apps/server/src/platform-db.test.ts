import { describe, expect, it } from 'vitest'
import { createPlatformDatabase, databaseStatusSchema, seedDemoData } from './platform-db.js'

describe('platform database migrations', () => {
  it('creates the core schema in an isolated in-memory database', () => {
    const database = createPlatformDatabase({ filename: ':memory:', now: () => new Date('2026-09-17T10:00:00.000Z') })
    expect(databaseStatusSchema.parse(database.status())).toMatchObject({ state: 'ready', migrationVersion: 1, checkedAt: '2026-09-17T10:00:00.000Z' })
    expect(database.status().tables).toEqual(expect.arrayContaining(['departments', 'users', 'api_keys', 'quota_policies', 'audit_events']))
    database.migrate()
    expect(database.status().migrationVersion).toBe(1)
    database.close()
  })

  it('seeds repeatable demo organizations, keys, quotas, and audit events', () => {
    const database = createPlatformDatabase({ filename: ':memory:', now: () => new Date('2026-09-17T10:00:00.000Z') })
    const first = seedDemoData(database)
    const second = seedDemoData(database)
    expect(first).toEqual({ departments: 6, users: 14, apiKeys: 5, quotaPolicies: 6, auditEvents: 4 })
    expect(second).toEqual(first)
    expect(database.findUserByUsername('demo-zhou')).toMatchObject({ id: 'person-zhou', role: 'employee', status: 'active' })
    expect(database.passwordMatches('demo-yan', 'demo-person-yan')).toBe(false)
    expect(database.status().migrationVersion).toBe(1)
    database.close()
  })
})
