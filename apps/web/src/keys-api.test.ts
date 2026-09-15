import { describe, expect, it } from 'vitest'
import { keyDetailResponseSchema, keyFiltersSchema } from './keys-api'

describe('Key API contracts', () => {
  it('rejects invalid list filters', () => {
    expect(keyFiltersSchema.safeParse({ search: '', owner: 'all', purpose: 'all', model: 'all', status: 'unknown', page: 1, pageSize: 20 }).success).toBe(false)
    expect(keyFiltersSchema.safeParse({ search: '', owner: 'all', purpose: 'all', model: 'all', status: 'all', page: 1, pageSize: 100 }).success).toBe(false)
  })

  it('does not accept a detail without a masked Key field', () => {
    const result = keyDetailResponseSchema.safeParse({ meta: { source: 'demo', generatedAt: '', timezone: 'Asia/Shanghai' }, key: { id: 'key-1' }, connection: {} })
    expect(result.success).toBe(false)
  })
})
