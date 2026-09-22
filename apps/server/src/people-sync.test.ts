import { describe, expect, it, vi } from 'vitest'
import { createNewApiManagementClient } from './new-api-management.js'
import { executePeopleSync, previewPeopleSync } from './people-sync.js'
import { createPlatformDatabase } from './platform-db.js'

describe('New API people sync', () => {
  it('previews, upserts by external user id, and replays idempotently', async () => {
    const database = createPlatformDatabase({ filename: ':memory:' })
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true, data: {
      page: 1, page_size: 100, total: 2,
      items: [
        { id: 42, username: 'alice', display_name: 'Alice', status: null, group: '内容运营', created_at: 1_700_000_000, last_login_at: 1_700_000_100 },
        { id: 1, username: 'root', display_name: 'Root User', status: 1, role: 100, group: 'default' },
      ],
    } }), { status: 200 })) as unknown as typeof fetch
    const client = createNewApiManagementClient({ baseUrl: 'http://new-api.test', accessToken: 'management-secret', fetchImpl })

    const preview = await previewPeopleSync(client, database, new Date('2026-09-20T10:00:00.000Z'))
    expect(preview.preview.summary).toMatchObject({ total: 1, added: 1, changed: 0, missing: 0, unknown: 0, skipped: 1 })
    expect(database.listSyncedPeople()).toHaveLength(0)

    const audit = { id: 'audit-people-sync-test', action: 'sync', resourceType: 'people', resourceId: 'new-api', result: 'success' as const, summary: { code: 'TEST' } }
    const synced = await executePeopleSync(client, database, 'people-sync-1a2b3c4d', audit, new Date('2026-09-20T10:00:00.000Z'))
    expect(synced.operation).toMatchObject({ idempotencyKey: 'people-sync-1a2b3c4d', idempotent: false })
    expect(database.listSyncedPeople()).toMatchObject([{ externalUserId: '42', displayName: 'alice', sourceStatus: 'active', departmentName: 'Alice', sourceDisplayName: 'Alice', sourceGroup: '内容运营' }])

    const replay = await executePeopleSync(client, database, 'people-sync-1a2b3c4d', audit, new Date('2026-09-20T10:01:00.000Z'))
    expect(replay).toEqual(synced)
    expect(database.listSyncedPeople()).toHaveLength(1)
  })
})
