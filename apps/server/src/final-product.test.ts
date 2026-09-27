import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from './app.js'

function cookieHeader(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value : value ? [value] : []).map((item) => item.split(';', 1)[0]).join('; ')
}

function cookieValue(value: string | string[] | undefined, name: string) {
  return cookieHeader(value).split('; ').find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) ?? ''
}

describe('final relay-account product boundaries', () => {
  const apps: Array<ReturnType<typeof buildApp>> = []
  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })

  it('allows self-registration and one employee-owned platform Key while preventing admin account/Key creation', async () => {
    const app = buildApp({ databasePath: ':memory:' })
    apps.push(app)

    const registration = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { realName: '李测试', email: 'li@example.com', password: 'secure-password-1' },
    })
    expect(registration.statusCode).toBe(201)
    expect(registration.json().user).toMatchObject({ role: 'employee', email: 'li@example.com' })
    const employeeCookie = cookieHeader(registration.headers['set-cookie'])
    const employeeCsrf = cookieValue(registration.headers['set-cookie'], 'ai_ops_csrf')

    expect((await app.inject({ method: 'GET', url: '/api/me/key', headers: { cookie: employeeCookie } })).json()).toMatchObject({ key: null, secret: null, model: { id: 'ai-ops' } })
    const issued = await app.inject({
      method: 'POST', url: '/api/me/key', headers: { cookie: employeeCookie, 'x-csrf-token': employeeCsrf }, payload: { idempotencyKey: 'employee-key-create-12345678' },
    })
    expect(issued.statusCode).toBe(201)
    const employeeSecret = issued.json().secret as string
    expect(employeeSecret).toMatch(/^sk-aiops-/)

    const adminLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@aiops.local', password: 'test-admin-password' } })
    expect(adminLogin.statusCode).toBe(200)
    const adminCookie = cookieHeader(adminLogin.headers['set-cookie'])
    const adminCsrf = cookieValue(adminLogin.headers['set-cookie'], 'ai_ops_csrf')
    const people = await app.inject({ method: 'GET', url: '/api/people', headers: { cookie: adminCookie } })
    const employee = people.json().items.find((item: { username: string }) => item.username === 'li@example.com') as { id: string; apiKeyMasked: string }
    expect(employee.apiKeyMasked).toContain('sk-aiops')

    const reset = await app.inject({
      method: 'POST', url: `/api/people/${employee.id}/reset-key`, headers: { cookie: adminCookie, 'x-csrf-token': adminCsrf }, payload: { idempotencyKey: 'person-key-reset-12345678', acknowledgeImpact: true },
    })
    expect(reset.statusCode).toBe(200)
    expect(reset.json().secret).toBeUndefined()
    expect((await app.inject({ method: 'GET', url: '/v1/models', headers: { authorization: `Bearer ${employeeSecret}` } })).statusCode).toBe(401)
    const employeeKeyAfterAdminReset = await app.inject({ method: 'GET', url: '/api/me/key', headers: { cookie: employeeCookie } })
    expect(employeeKeyAfterAdminReset.statusCode).toBe(200)
    expect(employeeKeyAfterAdminReset.json().secret).toMatch(/^sk-aiops-/)
    expect(employeeKeyAfterAdminReset.json().secret).not.toBe(employeeSecret)

    const retiredAdminCreate = await app.inject({ method: 'POST', url: '/api/people', headers: { cookie: adminCookie, 'x-csrf-token': adminCsrf }, payload: { displayName: '不应创建', departmentId: 'unassigned' } })
    expect(retiredAdminCreate.statusCode).toBe(410)
  })
})
