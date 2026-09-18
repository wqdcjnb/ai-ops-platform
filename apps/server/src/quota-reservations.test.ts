import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from './app.js'

const apps: ReturnType<typeof buildApp>[] = []
const reachableNewApi = async () => ({ state: 'reachable' as const, authConfigured: false, checkedAt: '2026-09-18T10:00:00.000Z' })
const reachableService = async () => ({ state: 'reachable' as const, checkedAt: '2026-09-18T10:00:00.000Z' })

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })

describe('local quota reservation rehearsal', () => {
  it('creates, settles, replays and lists a reservation without enabling hard blocking', async () => {
    const app = buildApp({ authMode: 'disabled', databasePath: ':memory:', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const body = { nodeId: 'key-lin-1', points: 24, concurrentUnits: 2, reason: '验证本地并发预留和结算路径', acknowledgeSimulation: true, idempotencyKey: 'quota-reservation-test-12345678' }
    const created = await app.inject({ method: 'POST', url: '/api/quota-reservations', payload: body })
    expect(created.statusCode).toBe(200)
    expect(created.json()).toMatchObject({ reservation: { nodeId: 'key-lin-1', status: 'reserved', points: 24, concurrentUnits: 2 }, operation: { idempotent: false } })
    const reservationId = created.json().reservation.id as string

    const replay = await app.inject({ method: 'POST', url: '/api/quota-reservations', payload: body })
    expect(replay.statusCode).toBe(200)
    expect(replay.json()).toMatchObject({ reservation: { id: reservationId, status: 'reserved' }, operation: { idempotent: true, auditEventId: 'audit-quota-reservation-test-12345678' } })

    const settled = await app.inject({ method: 'PATCH', url: `/api/quota-reservations/${reservationId}`, payload: { action: 'settle', reason: '本次演练已收到模拟结算结果', acknowledgeSimulation: true, idempotencyKey: 'quota-reservation-settle-test-12345678' } })
    expect(settled.statusCode).toBe(200)
    expect(settled.json()).toMatchObject({ reservation: { id: reservationId, status: 'settled' }, operation: { idempotent: false } })

    const list = await app.inject({ method: 'GET', url: '/api/quota-reservations?nodeId=key-lin-1' })
    expect(list.statusCode).toBe(200)
    expect(list.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ id: reservationId, status: 'settled' })]))
    expect(list.json().summary.settled).toBeGreaterThanOrEqual(1)
    expect((await app.inject({ method: 'GET', url: '/api/limits' })).json().hardMode.blocking).toBe(false)
  })

  it('cancels a reservation and rejects duplicate state changes', async () => {
    const app = buildApp({ authMode: 'disabled', databasePath: ':memory:', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const created = await app.inject({ method: 'POST', url: '/api/quota-reservations', payload: { nodeId: 'person-lin', points: 12, concurrentUnits: 1, reason: '验证取消时释放本地演练占用', acknowledgeSimulation: true, idempotencyKey: 'quota-reservation-cancel-12345678' } })
    const id = created.json().reservation.id as string
    const cancelled = await app.inject({ method: 'PATCH', url: `/api/quota-reservations/${id}`, payload: { action: 'cancel', reason: '模拟上游失败后回滚本地预留', acknowledgeSimulation: true, idempotencyKey: 'quota-reservation-cancel-action-12345678' } })
    expect(cancelled.statusCode).toBe(200)
    expect(cancelled.json().reservation.status).toBe('cancelled')
    const duplicate = await app.inject({ method: 'PATCH', url: `/api/quota-reservations/${id}`, payload: { action: 'settle', reason: '不应再次结算已取消预留', acknowledgeSimulation: true, idempotencyKey: 'quota-reservation-settle-after-cancel-12345678' } })
    expect(duplicate.statusCode).toBe(409)
    expect(duplicate.json().error.code).toBe('QUOTA_RESERVATION_NOT_RESERVED')
  })
})
