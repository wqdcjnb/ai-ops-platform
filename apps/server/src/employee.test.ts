import { describe, expect, it } from 'vitest'
import { createDatabaseEmployeeUsage, createDemoEmployeeModels, employeeModelsResponseSchema, employeeUsageResponseSchema } from './employee.js'
import { createPlatformDatabase, seedDemoData } from './platform-db.js'

describe('employee self-service contracts', () => {
  it('keeps SQLite usage scoped to the current employee and hides provider routing', () => {
    const now = new Date('2026-09-15T10:00:00.000Z')
    const database = createPlatformDatabase({ filename: ':memory:', now: () => now })
    seedDemoData(database, now)
    const usage = createDatabaseEmployeeUsage(database, 'person-lin', '30d', now)
    const models = createDemoEmployeeModels(now)
    expect(employeeUsageResponseSchema.safeParse(usage).success).toBe(true)
    expect(usage.trend).toHaveLength(30)
    expect(usage.meta.source).toBe('database')
    expect(usage.scope).toMatchObject({ mode: 'self_database', currentUserVerified: true, serverRbacVerified: true, otherPeopleAvailable: false })
    expect(usage.summary).toMatchObject({ softTarget: true, requestBlockingEnabled: false })
    expect(employeeModelsResponseSchema.safeParse(models).success).toBe(true)
    expect(models.meta.source).toBe('demo')
    expect(models.items.every((item) => !item.providerAvailable && !item.actualModelAvailable && !item.channelAvailable)).toBe(true)
    database.close()
  })
})
