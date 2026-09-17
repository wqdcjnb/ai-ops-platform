import { describe, expect, it } from 'vitest'
import { createSettings, settingsResponseSchema } from './settings.js'
import { createPlatformDatabase, seedDemoData } from './platform-db.js'

describe('settings contract', () => {
  it('keeps risky capabilities disabled and credential values unavailable', () => {
    const database = createPlatformDatabase({ filename: ':memory:', now: () => new Date('2026-09-15T10:00:00.000Z') })
    seedDemoData(database, new Date('2026-09-15T10:00:00.000Z'))
    const value = createSettings(
      { state: 'ready', authConfigured: true, checkedAt: '2026-09-15T10:00:00.000Z' },
      { state: 'reachable', checkedAt: '2026-09-15T10:00:00.000Z' },
      { state: 'reachable', checkedAt: '2026-09-15T10:00:00.000Z' },
      database,
      new Date('2026-09-15T10:00:00.000Z'),
    )
    expect(settingsResponseSchema.safeParse(value).success).toBe(true)
    expect(value.access).toMatchObject({ serverRbacVerified: true, writeAllowed: false })
    expect(value.organization).toMatchObject({ source: 'database', company: '新知科技', departments: 5, people: 12 })
    expect(value.connections.items.every((item) => item.credentialValueAvailable === false)).toBe(true)
    expect(value.businessRules).toMatchObject({ source: 'database', version: 'draft-v0.1' })
    expect(value.features.source).toBe('database')
    expect(value.features.items.every((item) => item.enabled === false && item.editable === false)).toBe(true)
    expect(value.retention).toMatchObject({ source: 'database', cleanupJobVerified: false, syntheticMetadataExpiry: { mode: 'synthetic_metadata_only', automaticOnStartup: true, proofRecords: 0, lastRun: null, realContentCleanup: false } })
    expect(value.retention.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'operation-audit', days: 365, minimumNecessary: true }),
    ]))
    expect(value.backup).toMatchObject({ source: 'database', configured: false, browserDownloadAllowed: false })
    database.close()
  })
})
