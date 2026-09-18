import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import { createDatabaseSearch } from './search.js'
import { createPlatformDatabase, seedDemoData } from './platform-db.js'

const apps: ReturnType<typeof buildApp>[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('global search', () => {
  it('groups people, masked keys and requests without exposing secrets', () => {
    const database = createPlatformDatabase({ filename: ':memory:' })
    seedDemoData(database, new Date('2026-09-18T10:00:00.000Z'))

    const people = createDatabaseSearch(database, { q: '林筱雨' }, { mode: 'global' })
    expect(people.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'people', items: expect.arrayContaining([expect.objectContaining({ title: '林筱雨', href: '/people/person-lin' })]) }),
      expect.objectContaining({ id: 'keys', items: expect.arrayContaining([expect.objectContaining({ title: 'sk-ops••••••7F2A' })]) }),
    ]))
    expect(JSON.stringify(people)).not.toContain('sk-live-')

    const request = createDatabaseSearch(database, { q: 'req-demo-001' }, { mode: 'global' })
    expect(request.total).toBe(1)
    expect(request.groups[0]).toMatchObject({ id: 'requests', items: [{ id: 'req-demo-001' }] })
    database.close()
  })

  it('serves the protected BFF endpoint and applies department scope', async () => {
    const database = createPlatformDatabase({ filename: ':memory:' })
    seedDemoData(database, new Date('2026-09-18T10:00:00.000Z'))
    const app = buildApp({ authMode: 'disabled', database })
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/api/search?q=req-demo-001' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ meta: { source: 'database', simulated: true }, total: 1, query: 'req-demo-001' })

    const scoped = createDatabaseSearch(database, { q: 'req-demo-001' }, { mode: 'department', departmentId: 'customer-service' })
    expect(scoped.total).toBe(0)
    database.close()
  })
})
