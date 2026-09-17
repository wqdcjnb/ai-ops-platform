import { describe, expect, it } from 'vitest'
import { createPlatformDatabase, databaseStatusSchema } from './platform-db.js'

describe('platform database migrations', () => {
  it('creates the core schema in an isolated in-memory database', () => {
    const database = createPlatformDatabase({ filename: ':memory:', now: () => new Date('2026-09-17T10:00:00.000Z') })
    expect(databaseStatusSchema.parse(database.status())).toMatchObject({ state: 'ready', migrationVersion: 1, checkedAt: '2026-09-17T10:00:00.000Z' })
    expect(database.status().tables).toEqual(expect.arrayContaining(['departments', 'users', 'api_keys', 'quota_policies', 'audit_events']))
    database.migrate()
    expect(database.status().migrationVersion).toBe(1)
    database.close()
  })
})
