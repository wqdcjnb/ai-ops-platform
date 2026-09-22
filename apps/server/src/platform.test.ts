import { describe, expect, it } from 'vitest'
import { createTaskSummary } from './platform.js'
import { createPlatformDatabase, seedDemoData } from './platform-db.js'

describe('unified entry operational task summary', () => {
  it('aggregates only safe SQLite Key state', () => {
    const now = new Date('2026-09-15T10:00:00.000Z')
    const database = createPlatformDatabase({ filename: ':memory:', now: () => now })
    try {
      seedDemoData(database, now)
      const summary = createTaskSummary(database, now)

      expect(summary).toMatchObject({
        source: 'database',
        simulated: true,
        summary: { activeKeys: expect.any(Number), expiringKeys: expect.any(Number) },
      })
      expect(summary.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'expiring-keys', target: 'keys' }),
      ]))
      expect(JSON.stringify(summary)).not.toMatch(/Bearer|accessToken|managementKey|apiKey|sk-[A-Za-z0-9_-]{8,}/i)
    } finally {
      database.close()
    }
  })
})
