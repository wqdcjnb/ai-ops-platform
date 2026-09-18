import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from './app.js'

const apps: ReturnType<typeof buildApp>[] = []
const reachableNewApi = async () => ({ state: 'reachable' as const, authConfigured: false, checkedAt: '2026-09-18T10:00:00.000Z' })
const reachableService = async () => ({ state: 'reachable' as const, checkedAt: '2026-09-18T10:00:00.000Z' })

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })

describe('temporary quota requests', () => {
  it('creates, lists, approves and reflects a local soft grant', async () => {
    const app = buildApp({ authMode: 'disabled', databasePath: ':memory:', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const created = await app.inject({ method: 'POST', url: '/api/me/quota-requests', payload: { targetPoints: 900, durationHours: 48, reason: '大促商品文案批次需要短期额度', acknowledgeImpact: true, idempotencyKey: 'quota-request-test-12345678' } })
    expect(created.statusCode).toBe(200)
    expect(created.json()).toMatchObject({ request: { status: 'pending', targetPoints: 900, durationHours: 48 }, operation: { idempotent: false } })
    const requestId = created.json().request.id as string

    const listed = await app.inject({ method: 'GET', url: '/api/quota-requests?status=pending' })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ id: requestId, requester: expect.objectContaining({ id: 'person-lin' }) })]))

    const approved = await app.inject({ method: 'PATCH', url: `/api/quota-requests/${requestId}/decision`, payload: { decision: 'approve', reason: '已确认活动范围和预计用量，批准短期软目标', acknowledgeImpact: true, idempotencyKey: 'quota-decision-test-12345678' } })
    expect(approved.statusCode).toBe(200)
    expect(approved.json()).toMatchObject({ request: { status: 'approved', approvedPoints: 900 }, operation: { idempotent: false } })

    const replay = await app.inject({ method: 'POST', url: '/api/me/quota-requests', payload: { targetPoints: 900, durationHours: 48, reason: '大促商品文案批次需要短期额度', acknowledgeImpact: true, idempotencyKey: 'quota-request-test-12345678' } })
    expect(replay.statusCode).toBe(200)
    expect(replay.json().operation).toMatchObject({ idempotent: true })

    const limits = await app.inject({ method: 'GET', url: '/api/limits?level=person&search=林筱雨' })
    expect(limits.statusCode).toBe(200)
    expect(limits.json().items.find((item: { id: string }) => item.id === 'person-lin').periods[3].limit).toBe(1760)
    const usage = await app.inject({ method: 'GET', url: '/api/me/usage?period=7d' })
    expect(usage.statusCode).toBe(200)
    expect(usage.json().summary.pointsTarget).toBe(1760)
  })

  it('automatically marks an approved request expired after its local end time', async () => {
    let now = new Date('2026-09-18T10:00:00.000Z')
    const { createPlatformDatabase, seedDemoData } = await import('./platform-db.js')
    const database = createPlatformDatabase({ filename: ':memory:', now: () => now })
    seedDemoData(database, now)
    const created = database.createTemporaryQuotaRequest({ id: 'quota-request-expiry-test', requesterUserId: 'person-lin', departmentId: 'content', targetPoints: 100, durationHours: 1, reasonLength: 12, idempotencyKey: 'quota-request-expiry-12345678' }, { id: 'audit-quota-request-expiry-12345678', actorUserId: 'person-lin', action: 'create', resourceType: 'quota', resourceId: 'quota-request-expiry-test', result: 'success', summary: { code: 'TEST_REQUEST' } }, now)
    database.decideTemporaryQuotaRequest({ id: created.request.id, decision: 'approve', approverUserId: 'user-super-admin', reasonLength: 12, idempotencyKey: 'quota-decision-expiry-12345678' }, { id: 'audit-quota-decision-expiry-12345678', actorUserId: 'user-super-admin', action: 'update', resourceType: 'quota', resourceId: created.request.id, result: 'success', summary: { code: 'TEST_APPROVE' } }, now)
    now = new Date('2026-09-18T12:00:00.000Z')
    expect(database.listTemporaryQuotaRequests({ requesterUserId: 'person-lin' }).find((item) => item.id === created.request.id)?.status).toBe('expired')
    database.close()
  })
})
