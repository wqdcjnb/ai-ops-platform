import { describe, expect, it } from 'vitest'
import { createNewApiKeys } from './keys.js'
import { stableNewApiPersonId } from './platform-db.js'
import type { NormalizedNewApiPerson } from './people-sync.js'

function person(overrides: Partial<NormalizedNewApiPerson> = {}): NormalizedNewApiPerson {
  return {
    externalUserId: '4',
    username: '王庆典',
    displayName: '王庆典',
    departmentId: 'department-tech',
    departmentName: '技术部',
    status: 'active',
    createdAt: null,
    lastUsedAt: null,
    sourceDisplayName: '技术部',
    sourceGroup: 'default',
    sourceRole: '1',
    ...overrides,
  }
}

describe('New API Key owner options', () => {
  it('shows active users without an existing Token and excludes disabled users', () => {
    const response = createNewApiKeys(
      [],
      [
        person(),
        person({ externalUserId: '5', username: '李广超', displayName: '李广超', departmentId: 'department-operations', departmentName: '运营部', status: 'disabled', sourceDisplayName: '运营部' }),
      ],
      { search: '', owner: 'all', purpose: 'all', model: 'all', status: 'all', page: 1, pageSize: 20 },
      new Date('2026-09-21T00:00:00.000Z'),
    )

    expect(response.options.owners).toEqual([
      { id: stableNewApiPersonId('4'), name: '王庆典', department: '技术部' },
    ])
    expect(response.connection.baseUrl).toBe('http://127.0.0.1:4175/v1')
  })
})
