import { describe, expect, it } from 'vitest'
import { keyCreateResponseSchema, keyDetailResponseSchema, keyDisableBodySchema, keyDisableResponseSchema, keyFiltersSchema, keyRotateBodySchema, keyRotateResponseSchema, keysResponseSchema } from './keys-api'

describe('Key API contracts', () => {
  it('rejects invalid list filters', () => {
    expect(keyFiltersSchema.safeParse({ search: '', owner: 'all', purpose: 'all', model: 'all', status: 'unknown', page: 1, pageSize: 20 }).success).toBe(false)
    expect(keyFiltersSchema.safeParse({ search: '', owner: 'all', purpose: 'all', model: 'all', status: 'all', page: 1, pageSize: 100 }).success).toBe(false)
  })

  it('does not accept a detail without a masked Key field', () => {
    const result = keyDetailResponseSchema.safeParse({ meta: { source: 'demo', generatedAt: '', timezone: 'Asia/Shanghai' }, key: { id: 'key-1' }, connection: {} })
    expect(result.success).toBe(false)
  })

  it('accepts a database list and one-time create response with a masked list value', () => {
    const list = keysResponseSchema.safeParse({ meta: { source: 'database', generatedAt: '', timezone: 'Asia/Shanghai', notice: '' }, summary: { total: 0, active: 0, disabled: 0, expiring: 0 }, options: { owners: [], purposes: [], models: [] }, connection: { baseUrl: 'http://127.0.0.1:3000/v1', note: '' }, items: [], page: 1, pageSize: 20, total: 0 })
    expect(list.success).toBe(true)
    const created = keyCreateResponseSchema.safeParse({ meta: { source: 'database', createdAt: '', notice: '' }, key: { id: 'key-lin-123', masked: 'sk-ops••••••ABCD', owner: { id: 'person-lin', name: '林筱雨', department: '内容运营' }, purpose: '商品文案', model: 'ecommerce-copy', models: ['ecommerce-copy'], expiresAt: '2026-12-31T00:00:00.000Z' }, secret: 'sk-ops-demo-secret-value-123456', operation: { auditEventId: 'audit-key-lin-123-create' } })
    expect(created.success).toBe(true)
  })

  it('requires a reason, acknowledgement, and idempotency key to disable a Key', () => {
    expect(keyDisableBodySchema.safeParse({ idempotencyKey: 'key-disable-1a2b3c4d', reason: '复核疑似泄露的本地演示设备', acknowledgeImpact: true }).success).toBe(true)
    expect(keyDisableBodySchema.safeParse({ idempotencyKey: 'short', reason: '太短', acknowledgeImpact: false }).success).toBe(false)
    expect(keyDisableResponseSchema.safeParse({ meta: { source: 'database', completedAt: '2026-09-17T10:00:00.000Z', notice: '本地演示' }, key: { id: 'key-lin-1', masked: 'sk-ops••••••7F2A', status: 'disabled' }, operation: { idempotencyKey: 'key-disable-1a2b3c4d', idempotent: false, auditEventId: 'audit-key-disable-1a2b3c4d' } }).success).toBe(true)
  })

  it('accepts a one-time local Key rotation response and rejects an invalid acknowledgement', () => {
    expect(keyRotateBodySchema.safeParse({ idempotencyKey: 'key-rotate-1a2b3c4d', reason: '本地演示 Key 即将到期，按周期轮换', expiresInDays: 90, acknowledgeImpact: true }).success).toBe(true)
    expect(keyRotateBodySchema.safeParse({ idempotencyKey: 'key-rotate-short', reason: '太短', expiresInDays: 0, acknowledgeImpact: false }).success).toBe(false)
    expect(keyRotateResponseSchema.safeParse({ meta: { source: 'database', completedAt: '2026-09-17T10:00:00.000Z', notice: '本地演示', secretAvailable: true }, oldKey: { id: 'key-lin-1', masked: 'sk-ops••••••7F2A', status: 'disabled' }, key: { id: 'key-lin-rotate-abcdef12345-6', masked: 'sk-ops••••••ABCD', owner: { id: 'person-lin', name: '林筱雨', department: '内容运营' }, purpose: '商品文案', model: 'ecommerce-copy', models: ['ecommerce-copy'], expiresAt: '2026-12-31T00:00:00.000Z' }, secret: 'sk-ops-demo-secret-value-123456', operation: { idempotencyKey: 'key-rotate-1a2b3c4d', idempotent: false, auditEventId: 'audit-key-rotate-1a2b3c4d' } }).success).toBe(true)
  })
})
