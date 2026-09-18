import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from './app.js'

const apps: ReturnType<typeof buildApp>[] = []
const reachableNewApi = async () => ({ state: 'reachable' as const, authConfigured: false, checkedAt: '2026-09-18T10:00:00.000Z' })

function cookieValues(setCookie: string | string[] | undefined) {
  return Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
}

function cookieHeader(setCookie: string | string[] | undefined) {
  return cookieValues(setCookie).map((value) => value.split(';')[0]).join('; ')
}

function cookieValue(setCookie: string | string[] | undefined, name: string) {
  return cookieHeader(setCookie).split('; ').find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? ''
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('people monthly soft goal', () => {
  it('updates demo and newly created people, then persists the target in detail reads', async () => {
    const app = buildApp({ databasePath: ':memory:', probeNewApi: reachableNewApi })
    apps.push(app)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-demo' } })
    const cookie = cookieHeader(login.headers['set-cookie'])
    const csrfToken = cookieValue(login.headers['set-cookie'], 'ai_ops_csrf')
    const body = { targetPoints: 1000, idempotencyKey: 'quota-update-person-1a2b3c4d', reason: '本地演示活动需要提高人员提示阈值', acknowledgeImpact: true }

    const updated = await app.inject({ method: 'PATCH', url: '/api/people/person-lin/goal', headers: { cookie, 'x-csrf-token': csrfToken }, payload: body })
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toMatchObject({ policy: { nodeId: 'person-lin', level: 'person', targetPoints: 1000 }, impact: { previousTargetPoints: 860, used: 742 }, operation: { idempotent: false } })

    const detail = await app.inject({ method: 'GET', url: '/api/people/person-lin', headers: { cookie } })
    expect(detail.statusCode).toBe(200)
    expect(detail.json().profile.goal).toMatchObject({ limit: 1000, used: 742, percent: 74 })

    const created = await app.inject({ method: 'POST', url: '/api/people', headers: { cookie, 'x-csrf-token': csrfToken }, payload: { username: 'goal-demo', displayName: '目标演示员', departmentId: 'content', password: 'goal-demo-pass' } })
    expect(created.statusCode).toBe(201)
    const createdId = created.json().person.id as string
    const createdUpdate = await app.inject({ method: 'PATCH', url: `/api/people/${createdId}/goal`, headers: { cookie, 'x-csrf-token': csrfToken }, payload: { ...body, targetPoints: 750, idempotencyKey: 'quota-update-person-5e6f7g8h' } })
    expect(createdUpdate.statusCode).toBe(200)
    expect(createdUpdate.json()).toMatchObject({ policy: { nodeId: createdId, targetPoints: 750 }, impact: { previousTargetPoints: 500, used: 0 } })
    expect(JSON.stringify(createdUpdate.json())).not.toContain(body.reason)
  })
})
