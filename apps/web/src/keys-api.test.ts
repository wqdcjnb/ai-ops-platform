import { describe, expect, it } from 'vitest'
import { keyCreateResponseSchema, keyDetailResponseSchema, keyFiltersSchema, keysResponseSchema } from './keys-api'

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
    const created = keyCreateResponseSchema.safeParse({ meta: { source: 'database', createdAt: '', notice: '' }, key: { id: 'key-lin-123', masked: 'sk-ops••••••ABCD', owner: { id: 'person-lin', name: '林筱雨', department: '内容运营' }, purpose: '商品文案', models: ['ecommerce-copy'], expiresAt: '2026-12-31T00:00:00.000Z' }, secret: 'sk-ops-demo-secret-value-123456' })
    expect(created.success).toBe(true)
  })
})
