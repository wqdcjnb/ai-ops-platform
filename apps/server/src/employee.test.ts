import { describe, expect, it } from 'vitest'
import { createDemoEmployeeModels, createDemoEmployeeUsage, employeeModelsResponseSchema, employeeUsageResponseSchema } from './employee.js'

describe('employee self-service contracts', () => {
  it('keeps usage in self-only demo scope and hides provider routing', () => {
    const now = new Date('2026-09-15T10:00:00.000Z')
    const usage = createDemoEmployeeUsage('30d', now)
    const models = createDemoEmployeeModels(now)
    expect(employeeUsageResponseSchema.safeParse(usage).success).toBe(true)
    expect(usage.trend).toHaveLength(30)
    expect(usage.scope).toMatchObject({ currentUserVerified: true, serverRbacVerified: true, otherPeopleAvailable: false })
    expect(usage.summary).toMatchObject({ softTarget: true, requestBlockingEnabled: false })
    expect(employeeModelsResponseSchema.safeParse(models).success).toBe(true)
    expect(models.items.every((item) => !item.providerAvailable && !item.actualModelAvailable && !item.channelAvailable)).toBe(true)
  })
})
