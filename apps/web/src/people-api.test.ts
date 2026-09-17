import { describe, expect, it } from 'vitest'
import { peopleFilterSchema, peopleResponseSchema, personDetailResponseSchema, personDisableBodySchema, personDisableResponseSchema } from './people-api'

describe('people API contracts', () => {
  it('rejects unsafe pagination values', () => {
    expect(peopleFilterSchema.safeParse({ search: '', department: 'all', status: 'all', goal: 'all', page: 0, pageSize: 20 }).success).toBe(false)
    expect(peopleFilterSchema.safeParse({ search: '', department: 'all', status: 'all', goal: 'all', page: 1, pageSize: 51 }).success).toBe(false)
  })

  it('accepts database/demo sources but rejects unverified live data', () => {
    const result = peopleResponseSchema.safeParse({
      meta: { source: 'live', generatedAt: '2026-09-15T10:00:00.000Z', timezone: 'Asia/Shanghai', notice: '' },
      summary: { total: 0, active: 0, disabled: 0, offboarding: 0, departments: 0 },
      departments: [], items: [], page: 1, pageSize: 20, total: 0,
    })
    expect(result.success).toBe(false)

    const databaseResult = peopleResponseSchema.safeParse({
      meta: { source: 'database', generatedAt: '2026-09-15T10:00:00.000Z', timezone: 'Asia/Shanghai', notice: '' },
      summary: { total: 0, active: 0, disabled: 0, offboarding: 0, departments: 0 },
      departments: [], items: [], page: 1, pageSize: 20, total: 0,
    })
    expect(databaseResult.success).toBe(true)
  })

  it('rejects detail keys that omit their masked representation', () => {
    const result = personDetailResponseSchema.safeParse({
      meta: { source: 'demo', generatedAt: '2026-09-15T10:00:00.000Z', timezone: 'Asia/Shanghai', notice: '' },
      profile: {}, metrics: {}, keys: [{ id: 'key-1', purpose: '测试', status: 'active', models: [], expiresAt: '2027-01-01T00:00:00.000Z', lastUsedAt: null }], models: [],
    })
    expect(result.success).toBe(false)
  })

  it('requires acknowledgement and an operation number to disable a local person', () => {
    expect(personDisableBodySchema.safeParse({ idempotencyKey: 'person-disable-1a2b3c4d', reason: '本地演示账号已完成测试，需要停用', acknowledgeImpact: true }).success).toBe(true)
    expect(personDisableBodySchema.safeParse({ idempotencyKey: 'short', reason: '太短', acknowledgeImpact: false }).success).toBe(false)
    expect(personDisableResponseSchema.safeParse({ meta: { source: 'database', completedAt: '2026-09-17T10:00:00.000Z', notice: '本地演示' }, person: { id: 'person-lin', name: '林筱雨', status: 'disabled' }, keysDisabled: 2, operation: { idempotencyKey: 'person-disable-1a2b3c4d', idempotent: false, auditEventId: 'audit-person-disable-1a2b3c4d' } }).success).toBe(true)
  })
})
