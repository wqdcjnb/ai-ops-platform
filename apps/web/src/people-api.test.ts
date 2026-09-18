import { describe, expect, it } from 'vitest'
import { peopleFilterSchema, peopleResponseSchema, personBatchCreateBodySchema, personBatchCreateResponseSchema, personDetailResponseSchema, personDisableBodySchema, personDisableResponseSchema, personModelsUpdateBodySchema, personModelsUpdateResponseSchema } from './people-api'

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

  it('requires a bounded idempotency key for batch person creation', () => {
    expect(personBatchCreateBodySchema.safeParse({ idempotencyKey: 'people-import-1a2b3c4d', items: [{ username: 'new.user', displayName: '王小明', departmentId: 'content', password: 'local-pass-1' }] }).success).toBe(true)
    expect(personBatchCreateBodySchema.safeParse({ idempotencyKey: 'batch', items: [] }).success).toBe(false)
    expect(personBatchCreateResponseSchema.safeParse({ meta: { source: 'database', createdAt: '2026-09-18T10:00:00.000Z', notice: '本地演示', createdCount: 1 }, people: [{ id: 'person-demo', username: 'new.user', displayName: '王小明', department: { id: 'content', name: '内容运营' } }], operation: { idempotencyKey: 'people-import-1a2b3c4d', idempotent: false, auditEventId: 'audit-people-import-1a2b3c4d' } }).success).toBe(true)
  })

  it('requires an acknowledged, unique model whitelist for local updates', () => {
    expect(personModelsUpdateBodySchema.safeParse({ idempotencyKey: 'person-models-1a2b3c4d', models: ['ecommerce-copy', 'ecommerce-pro-lab'], reason: '本地演示需要开放实验模型', acknowledgeImpact: true }).success).toBe(true)
    expect(personModelsUpdateBodySchema.safeParse({ idempotencyKey: 'person-models-1a2b3c4d', models: ['ecommerce-copy', 'ecommerce-copy'], reason: '本地演示需要开放实验模型', acknowledgeImpact: true }).success).toBe(false)
    expect(personModelsUpdateBodySchema.safeParse({ idempotencyKey: 'short', models: ['ecommerce-copy'], reason: '太短', acknowledgeImpact: false }).success).toBe(false)
    expect(personModelsUpdateResponseSchema.safeParse({ meta: { source: 'database', completedAt: '2026-09-18T10:00:00.000Z', notice: '本地演示' }, person: { id: 'person-lin', name: '林筱雨' }, models: [{ alias: 'ecommerce-copy', name: '电商文案', purpose: '内容生产', type: 'production', allowed: true }], keysUpdated: 2, operation: { idempotencyKey: 'person-models-1a2b3c4d', idempotent: false, auditEventId: 'audit-person-models-1a2b3c4d' } }).success).toBe(true)
  })
})
