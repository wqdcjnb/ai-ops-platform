import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import { createPlatformDatabase } from './platform-db.js'

const apps: ReturnType<typeof buildApp>[] = []
const reachableNewApi = async () => ({
  state: 'reachable' as const,
  authConfigured: false,
  checkedAt: '2026-09-15T10:00:00.000Z',
})
const reachableService = async () => ({ state: 'reachable' as const, checkedAt: '2026-09-15T10:00:00.000Z' })
const createApp = () => {
  const app = buildApp({ authMode: 'disabled', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
  apps.push(app)
  return app
}

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

describe('BFF', () => {
  it('runs the platform database migration and reports its schema status', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/platform/database' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.state).toBe('ready')
    expect(body.migrationVersion).toBe(17)
    expect(body.tables).toEqual(expect.arrayContaining(['schema_migrations', 'users', 'api_keys', 'quota_policies', 'audit_events', 'audit_chain_checkpoints', 'usage_requests', 'conversation_access_events', 'conversation_audit_records', 'conversation_audit_cleanup_runs', 'conversation_audit_expiry_proofs', 'conversation_usage_links', 'system_business_rules', 'system_feature_flags', 'system_role_definitions', 'system_retention_policies', 'system_backup_status', 'user_sessions', 'session_cleanup_runs']))
    expect(body.sessionCleanup).toMatchObject({ revokedRetentionHours: 24, lastRun: { triggeredBy: 'startup' } })
    expect(body.auditChain).toMatchObject({ algorithm: 'sha256', verified: true, hashChainVerified: true, checkpointVerified: true, firstInvalidEventId: null })
  })

  it('requires a session for protected resources', async () => {
    const app = buildApp({ databasePath: ':memory:', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const response = await app.inject({ method: 'GET', url: '/api/overview' })
    expect(response.statusCode).toBe(401)
    expect(response.json().error.code).toBe('AUTH_REQUIRED')
  })

  it('issues an HttpOnly session cookie and enforces role boundaries', async () => {
    const app = buildApp({ databasePath: ':memory:', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-demo' } })
    expect(login.statusCode).toBe(200)
    expect(cookieValues(login.headers['set-cookie']).join('\n')).toMatch(/ai_ops_session=.*HttpOnly.*SameSite=Strict/i)
    expect(cookieValues(login.headers['set-cookie']).join('\n')).toMatch(/ai_ops_csrf=.*SameSite=Strict/i)
    const cookie = cookieHeader(login.headers['set-cookie'])
    const csrfToken = cookieValue(login.headers['set-cookie'], 'ai_ops_csrf')
    expect(csrfToken).not.toBe('')
    const settings = await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } })
    expect(settings.statusCode).toBe(200)

    const missingCsrf = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } })
    expect(missingCsrf.statusCode).toBe(403)
    expect(missingCsrf.json().error.code).toBe('CSRF_INVALID')
    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie, 'x-csrf-token': csrfToken } })
    expect(logout.statusCode).toBe(204)
    const revoked = await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } })
    expect(revoked.statusCode).toBe(401)

    const employeeLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'employee', password: 'employee-demo' } })
    const employeeCookie = cookieHeader(employeeLogin.headers['set-cookie'])
    const employeeAdminResource = await app.inject({ method: 'GET', url: '/api/people', headers: { cookie: employeeCookie } })
    expect(employeeAdminResource.statusCode).toBe(403)
    const employeeResource = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: employeeCookie } })
    expect(employeeResource.statusCode).toBe(200)
  })

  it('limits department leaders to their own SQLite department data', async () => {
    const app = buildApp({ databasePath: ':memory:', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'lead-content', password: 'demo-lead-content' } })
    expect(login.statusCode).toBe(200)
    expect(login.json().user).toMatchObject({ role: 'department_lead', departmentId: 'content' })
    const cookie = cookieHeader(login.headers['set-cookie'])

    const people = await app.inject({ method: 'GET', url: '/api/people?pageSize=50', headers: { cookie } })
    expect(people.statusCode).toBe(200)
    expect(people.json().summary).toMatchObject({ total: 3, departments: 1 })
    expect(people.json().items.every((item: { department: { id: string } }) => item.department.id === 'content')).toBe(true)
    const otherPerson = await app.inject({ method: 'GET', url: '/api/people/person-zhou', headers: { cookie } })
    expect(otherPerson.statusCode).toBe(404)

    const keys = await app.inject({ method: 'GET', url: '/api/keys?pageSize=50', headers: { cookie } })
    expect(keys.statusCode).toBe(200)
    expect(keys.json().items).not.toHaveLength(0)
    expect(keys.json().items.every((item: { owner: { name: string } }) => ['林筱雨', '何沐晨', '严可欣'].includes(item.owner.name))).toBe(true)
    const otherKey = await app.inject({ method: 'GET', url: '/api/keys/key-zhou-1', headers: { cookie } })
    expect(otherKey.statusCode).toBe(404)

    const usage = await app.inject({ method: 'GET', url: '/api/usage?period=30d&pageSize=50', headers: { cookie } })
    expect(usage.statusCode).toBe(200)
    expect(usage.json().items.every((item: { person: { department: { id: string } } }) => item.person.department.id === 'content')).toBe(true)
    const otherUsage = await app.inject({ method: 'GET', url: '/api/usage/req-demo-003', headers: { cookie } })
    expect(otherUsage.statusCode).toBe(404)

    const limits = await app.inject({ method: 'GET', url: '/api/limits', headers: { cookie } })
    expect(limits.statusCode).toBe(200)
    expect(limits.json().items[0]).toMatchObject({ id: 'department-content', parentId: null, depth: 0 })
    expect(limits.json().items.every((item: { id: string }) => !item.id.includes('zhou') && !item.id.includes('ads'))).toBe(true)

    const alerts = await app.inject({ method: 'GET', url: '/api/alerts?pageSize=50', headers: { cookie } })
    expect(alerts.statusCode).toBe(200)
    expect(alerts.json().items.every((item: { subject: { type: string } }) => ['department', 'person', 'key'].includes(item.subject.type))).toBe(true)
    const globalAlert = await app.inject({ method: 'GET', url: '/api/alerts/alert-error-global', headers: { cookie } })
    expect(globalAlert.statusCode).toBe(404)
    const rules = await app.inject({ method: 'GET', url: '/api/alert-rules', headers: { cookie } })
    expect(rules.statusCode).toBe(200)
    expect(rules.json().items).toEqual([])

    const overview = await app.inject({ method: 'GET', url: '/api/overview?period=30d', headers: { cookie } })
    expect(overview.statusCode).toBe(200)
    expect(overview.json().people.every((item: { department: string }) => item.department === '内容运营')).toBe(true)
    const tasks = await app.inject({ method: 'GET', url: '/api/tasks/summary', headers: { cookie } })
    expect(tasks.statusCode).toBe(200)
    expect(tasks.json().summary.activeKeys).toBe(keys.json().items.filter((item: { status: string }) => item.status === 'active').length)
  })

  it('rejects invalid credentials without creating a session', async () => {
    const app = buildApp({ databasePath: ':memory:', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'wrong-password' } })
    expect(response.statusCode).toBe(401)
    expect(response.json().error.code).toBe('AUTH_INVALID')
    expect(response.headers['set-cookie']).toBeUndefined()
  })

  it('appends safe authentication and access-denial audit summaries', async () => {
    const database = createPlatformDatabase({ filename: ':memory:' })
    const app = buildApp({ database, probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    try {
      const wrongPassword = 'audit-test-wrong-password'
      const invalidLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: wrongPassword } })
      expect(invalidLogin.statusCode).toBe(401)

      const adminLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-demo' } })
      const adminCookie = cookieHeader(adminLogin.headers['set-cookie'])
      const csrfToken = cookieValue(adminLogin.headers['set-cookie'], 'ai_ops_csrf')
      const sessionToken = cookieValue(adminLogin.headers['set-cookie'], 'ai_ops_session')
      const employeeLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'employee', password: 'employee-demo' } })
      const roleDenied = await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie: cookieHeader(employeeLogin.headers['set-cookie']) } })
      expect(roleDenied.statusCode).toBe(403)
      const csrfDenied = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: adminCookie } })
      expect(csrfDenied.statusCode).toBe(403)
      const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: adminCookie, 'x-csrf-token': csrfToken } })
      expect(logout.statusCode).toBe(204)

      const events = database.listAuditEvents()
      expect(events.find((item) => item.requestId === invalidLogin.headers['x-request-id'])).toMatchObject({ actorUserId: null, action: 'login', resourceType: 'session', result: 'failed', summary: { code: 'AUTH_INVALID' } })
      expect(events.find((item) => item.requestId === roleDenied.headers['x-request-id'])).toMatchObject({ action: 'access', resourceType: 'authorization', result: 'denied', summary: { code: 'AUTH_FORBIDDEN' } })
      expect(events.find((item) => item.requestId === csrfDenied.headers['x-request-id'])).toMatchObject({ action: 'access', resourceType: 'authorization', result: 'denied', summary: { code: 'CSRF_INVALID' } })
      expect(events.find((item) => item.requestId === logout.headers['x-request-id'])).toMatchObject({ action: 'logout', resourceType: 'session', result: 'success', summary: { code: 'LOGOUT_OK' } })
      const serializedEvents = JSON.stringify(events)
      expect(serializedEvents).not.toContain(wrongPassword)
      expect(serializedEvents).not.toContain(sessionToken)
      expect(serializedEvents).not.toContain(csrfToken)

      const auditLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-demo' } })
      const auditResponse = await app.inject({ method: 'GET', url: '/api/audit-events?period=7d&action=access&resource=authorization&result=denied', headers: { cookie: cookieHeader(auditLogin.headers['set-cookie']) } })
      expect(auditResponse.statusCode).toBe(200)
      expect(auditResponse.json().items).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: 'access', resource: expect.objectContaining({ type: 'authorization' }), result: expect.objectContaining({ code: 'AUTH_FORBIDDEN' }) }),
        expect.objectContaining({ action: 'access', resource: expect.objectContaining({ type: 'authorization' }), result: expect.objectContaining({ code: 'CSRF_INVALID' }) }),
      ]))
    } finally {
      await app.close()
      database.close()
    }
  })

  it('keeps a hashed SQLite session valid after the BFF restarts', async () => {
    const database = createPlatformDatabase({ filename: ':memory:' })
    const first = buildApp({ database, probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    try {
      const login = await first.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-demo' } })
      const cookie = cookieHeader(login.headers['set-cookie'])
      expect(database.tableCounts().userSessions).toBe(1)
      await first.close()

      const restarted = buildApp({ database, probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
      try {
        const restored = await restarted.inject({ method: 'GET', url: '/api/settings', headers: { cookie } })
        expect(restored.statusCode).toBe(200)
        expect(JSON.stringify(database.listAuditEvents())).not.toContain(cookieValue(login.headers['set-cookie'], 'ai_ops_session'))
      } finally {
        await restarted.close()
      }
    } finally {
      database.close()
    }
  })

  it('authenticates users seeded in the platform database', async () => {
    const database = createPlatformDatabase({ filename: ':memory:' })
    const app = buildApp({ database, probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    try {
      const seeded = database.findUserByUsername('admin')
      expect(seeded).toMatchObject({ username: 'admin', role: 'super_admin', status: 'active' })
      expect(JSON.stringify(seeded)).not.toContain('password')
      expect(database.passwordMatches('admin', 'admin-demo')).toBe(true)

      const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-demo' } })
      expect(login.statusCode).toBe(200)
      expect(login.json().user.roleLabel).toBe('超级管理员')
    } finally {
      await app.close()
      database.close()
    }
  })

  it('reports health without caching', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok', service: 'ai-ops-bff' })
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['x-request-id']).toMatch(/^req-[a-z0-9-]+$/)
  })

  it('returns a validated seven-day SQLite overview by default', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/overview' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.meta).toMatchObject({ source: 'database', simulated: true, period: '7d' })
    expect(body.meta.period).toBe('7d')
    expect(body.service).toEqual({ bff: 'healthy', newApi: await reachableNewApi() })
    expect(body.trend).toHaveLength(7)
    expect(body.metrics).toMatchObject({ todayRequests: expect.any(Number), monthPoints: expect.any(Number) })
    expect(body.people.every((person: { targetConfigured: boolean }) => typeof person.targetConfigured === 'boolean')).toBe(true)
    expect(body.limits).toEqual({ mode: 'soft', blocking: false })
    expect(JSON.stringify(body)).not.toMatch(/actualModel|accessToken|managementKey|apiKey|password/i)
  })

  it('reports the upstream integration state without exposing credentials', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/integrations/new-api/status' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(await reachableNewApi())
    expect(JSON.stringify(response.json())).not.toContain('token')
  })

  it('protects the New API management adapter and exposes only capability state', async () => {
    const app = buildApp({ authMode: 'disabled', probeNewApi: reachableNewApi, probeNewApiManagement: async () => ({ state: 'not_configured', authConfigured: false, checkedAt: '2026-09-15T10:00:00.000Z', capabilities: { models: 'unavailable', channels: 'unavailable' }, notice: '未配置' }) })
    apps.push(app)
    const response = await app.inject({ method: 'GET', url: '/api/integrations/new-api/management' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ state: 'not_configured', authConfigured: false, capabilities: { models: 'unavailable', channels: 'unavailable' } })
    expect(JSON.stringify(response.json())).not.toMatch(/Bearer|accessToken|management-secret/i)
  })

  it('returns the live platform service matrix for the unified entry page', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/platform/status' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.meta.source).toBe('live')
    expect(body.services.map((service: { id: string }) => service.id)).toEqual(['bff', 'new-api', 'cpa'])
    expect(body.links).toHaveLength(2)
    expect(body.links.map((link: { id: string }) => link.id)).toEqual(['new-api', 'cpa'])
    expect(JSON.stringify(body)).not.toContain('ACCESS_TOKEN')
  })

  it('returns SQLite operational tasks without secret values', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/tasks/summary' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body).toMatchObject({ source: 'database', simulated: true, summary: { openAlerts: 4, criticalAlerts: 1 } })
    expect(body.items.map((item: { target: string }) => item.target)).toEqual(expect.arrayContaining(['alerts', 'keys']))
    expect(JSON.stringify(body)).not.toMatch(/Bearer|accessToken|managementKey|apiKey|sk-[A-Za-z0-9_-]{8,}/i)
  })

  it('filters the demo people list using validated query parameters', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/people?department=content&status=active&pageSize=10' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.meta.source).toBe('database')
    expect(body.summary.total).toBe(12)
    expect(body.items).toHaveLength(2)
    expect(body.items.every((person: { department: { id: string }; status: string }) => person.department.id === 'content' && person.status === 'active')).toBe(true)
    expect(JSON.stringify(body)).not.toMatch(/accessToken|Bearer|managementKey/i)
  })

  it('rejects invalid people pagination with the shared error envelope', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/people?page=0&pageSize=500' })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('INVALID_REQUEST')
  })

  it('returns a person detail with masked keys only', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/people/person-lin' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.profile.name).toBe('林筱雨')
    expect(body.keys).toHaveLength(body.profile.keyCount)
    expect(body.keys.every((key: { masked: string }) => key.masked.includes('••••••'))).toBe(true)
    expect(JSON.stringify(body)).not.toMatch(/Bearer|accessToken|managementKey/i)
  })

  it('allows administrators to add a person to SQLite and blocks duplicate usernames', async () => {
    const app = buildApp({ databasePath: ':memory:', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-demo' } })
    const cookie = cookieHeader(login.headers['set-cookie'])
    const csrfToken = cookieValue(login.headers['set-cookie'], 'ai_ops_csrf')
    const created = await app.inject({ method: 'POST', url: '/api/people', headers: { cookie, 'x-csrf-token': csrfToken }, payload: { username: 'demo-new-person', displayName: '王小明', departmentId: 'content', password: 'demo-password-1' } })
    expect(created.statusCode).toBe(201)
    expect(created.json().person.displayName).toBe('王小明')

    const listed = await app.inject({ method: 'GET', url: '/api/people?search=王小明', headers: { cookie } })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().items[0]).toMatchObject({ name: '王小明', department: { id: 'content', name: '内容运营' }, title: '新加入成员' })

    const audit = await app.inject({ method: 'GET', url: `/api/audit-events?period=7d&action=create&resource=person&search=${encodeURIComponent('王小明')}`, headers: { cookie } })
    expect(audit.statusCode).toBe(200)
    expect(audit.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'create',
        resource: expect.objectContaining({ type: 'person', name: '王小明' }),
        changes: expect.arrayContaining([
          expect.objectContaining({ field: 'username', after: 'demo-new-person', sensitive: false }),
          expect.objectContaining({ field: 'password', after: '已变化', sensitive: true }),
        ]),
      }),
    ]))
    expect(JSON.stringify(audit.json())).not.toContain('demo-password-1')

    const duplicate = await app.inject({ method: 'POST', url: '/api/people', headers: { cookie, 'x-csrf-token': csrfToken }, payload: { username: 'demo-new-person', displayName: '王小明二号', departmentId: 'content', password: 'demo-password-2' } })
    expect(duplicate.statusCode).toBe(409)
    expect(duplicate.json().error.code).toBe('USERNAME_CONFLICT')

    const employeeLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'employee', password: 'employee-demo' } })
    const employeeCreate = await app.inject({ method: 'POST', url: '/api/people', headers: { cookie: cookieHeader(employeeLogin.headers['set-cookie']) }, payload: { username: 'employee-attempt', displayName: '越权员工', departmentId: 'content', password: 'demo-password-3' } })
    expect(employeeCreate.statusCode).toBe(403)
  })

  it('supports person usage periods and stable not-found errors', async () => {
    const usage = await createApp().inject({ method: 'GET', url: '/api/people/person-lin/usage?period=30d' })
    expect(usage.statusCode).toBe(200)
    expect(usage.json().items).toHaveLength(30)

    const missing = await createApp().inject({ method: 'GET', url: '/api/people/person-missing' })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error.code).toBe('PERSON_NOT_FOUND')
    expect(missing.json().error.requestId).toBe(missing.headers['x-request-id'])
  })

  it('returns a filterable masked Key list without secret material', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/keys?owner=person-lin&status=active&pageSize=10' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.meta.source).toBe('database')
    expect(body.items).toHaveLength(2)
    expect(body.items.every((key: { masked: string; owner: { id: string } }) => key.owner.id === 'person-lin' && key.masked.includes('••••••'))).toBe(true)
    expect(JSON.stringify(body)).not.toMatch(/Bearer|accessToken|managementKey/i)
  })

  it('allows administrators to create a masked Key and shows the secret only once', async () => {
    const app = buildApp({ databasePath: ':memory:', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-demo' } })
    const cookie = cookieHeader(login.headers['set-cookie'])
    const csrfToken = cookieValue(login.headers['set-cookie'], 'ai_ops_csrf')
    const created = await app.inject({ method: 'POST', url: '/api/keys', headers: { cookie, 'x-csrf-token': csrfToken }, payload: { ownerId: 'person-lin', purpose: '大促文案', models: ['ecommerce-copy', 'ecommerce-general'], expiresInDays: 30, deviceNote: '本地演示设备' } })
    expect(created.statusCode).toBe(201)
    expect(created.json().secret).toMatch(/^sk-ops-/)
    expect(created.json().key.masked).toContain('••••••')
    expect(created.json().key.masked).not.toContain(created.json().secret)

    const listed = await app.inject({ method: 'GET', url: `/api/keys?search=${encodeURIComponent('大促文案')}`, headers: { cookie } })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().items[0]).toMatchObject({ purpose: '大促文案', models: ['ecommerce-copy', 'ecommerce-general'] })
    expect(JSON.stringify(listed.json())).not.toContain(created.json().secret)

    const audit = await app.inject({ method: 'GET', url: '/api/audit-events?period=7d&action=create&resource=key', headers: { cookie } })
    expect(audit.statusCode).toBe(200)
    expect(audit.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'create',
        resource: expect.objectContaining({ type: 'key', name: created.json().key.masked }),
        changes: expect.arrayContaining([
          expect.objectContaining({ field: 'secret', after: '已变化', sensitive: true }),
          expect.objectContaining({ field: 'purpose', after: '大促文案', sensitive: false }),
        ]),
      }),
    ]))
    expect(JSON.stringify(audit.json())).not.toContain(created.json().secret)

    const employeeLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'employee', password: 'employee-demo' } })
    const employeeCreate = await app.inject({ method: 'POST', url: '/api/keys', headers: { cookie: cookieHeader(employeeLogin.headers['set-cookie']) }, payload: { ownerId: 'person-lin', purpose: '越权 Key', models: ['ecommerce-general'], expiresInDays: 30, deviceNote: '测试' } })
    expect(employeeCreate.statusCode).toBe(403)
  })

  it('disables only a local demo Key with CSRF, idempotency, and a safe audit summary', async () => {
    const app = buildApp({ databasePath: ':memory:', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-demo' } })
    const cookie = cookieHeader(login.headers['set-cookie'])
    const csrfToken = cookieValue(login.headers['set-cookie'], 'ai_ops_csrf')
    const body = { idempotencyKey: 'key-disable-1a2b3c4d', reason: '复核疑似泄露的本地演示设备', acknowledgeImpact: true }
    const disabled = await app.inject({ method: 'POST', url: '/api/keys/key-lin-1/disable', headers: { cookie, 'x-csrf-token': csrfToken }, payload: body })
    expect(disabled.statusCode).toBe(200)
    expect(disabled.json()).toMatchObject({ meta: { source: 'database' }, key: { id: 'key-lin-1', masked: 'sk-ops••••••7F2A', status: 'disabled' }, operation: { idempotencyKey: body.idempotencyKey, idempotent: false, auditEventId: 'audit-key-disable-1a2b3c4d' } })

    const replay = await app.inject({ method: 'POST', url: '/api/keys/key-lin-1/disable', headers: { cookie, 'x-csrf-token': csrfToken }, payload: body })
    expect(replay.statusCode).toBe(200)
    expect(replay.json().operation.idempotent).toBe(true)
    const reused = await app.inject({ method: 'POST', url: '/api/keys/key-zhou-1/disable', headers: { cookie, 'x-csrf-token': csrfToken }, payload: body })
    expect(reused.statusCode).toBe(409)
    expect(reused.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED')

    const listed = await app.inject({ method: 'GET', url: '/api/keys?status=disabled', headers: { cookie } })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'key-lin-1', status: 'disabled' })]))
    const audit = await app.inject({ method: 'GET', url: '/api/audit-events?period=7d&action=disable&resource=key', headers: { cookie } })
    expect(audit.statusCode).toBe(200)
    expect(audit.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'disable', resource: expect.objectContaining({ id: 'key-lin-1', name: 'sk-ops••••••7F2A' }), changes: [expect.objectContaining({ field: 'status', before: '启用', after: '停用' })] })]))
    expect(JSON.stringify({ disabled: disabled.json(), audit: audit.json() })).not.toContain(body.reason)

    const withoutCsrf = await app.inject({ method: 'POST', url: '/api/keys/key-zhou-1/disable', headers: { cookie }, payload: { ...body, idempotencyKey: 'key-disable-5e6f7g8h' } })
    expect(withoutCsrf.statusCode).toBe(403)
  })

  it('rotates a local demo Key atomically and only returns the replacement secret once', async () => {
    const app = buildApp({ databasePath: ':memory:', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-demo' } })
    const cookie = cookieHeader(login.headers['set-cookie'])
    const csrfToken = cookieValue(login.headers['set-cookie'], 'ai_ops_csrf')
    const body = { idempotencyKey: 'key-rotate-1a2b3c4d', reason: '本地演示 Key 即将到期，按周期轮换', expiresInDays: 90, acknowledgeImpact: true }
    const rotated = await app.inject({ method: 'POST', url: '/api/keys/key-lin-1/rotate', headers: { cookie, 'x-csrf-token': csrfToken }, payload: body })
    expect(rotated.statusCode).toBe(200)
    const first = rotated.json()
    expect(first).toMatchObject({ meta: { source: 'database', secretAvailable: true }, oldKey: { id: 'key-lin-1', masked: 'sk-ops••••••7F2A', status: 'disabled' }, operation: { idempotencyKey: body.idempotencyKey, idempotent: false, auditEventId: 'audit-key-rotate-1a2b3c4d' } })
    expect(first.key.id).toMatch(/^key-lin-rotate-[a-f0-9]{11}-[0-9]$/)
    expect(first.secret).toMatch(/^sk-ops-/)
    expect(first.key.masked).not.toContain(first.secret)

    const oldDetail = await app.inject({ method: 'GET', url: '/api/keys/key-lin-1', headers: { cookie } })
    const newDetail = await app.inject({ method: 'GET', url: `/api/keys/${first.key.id}`, headers: { cookie } })
    expect(oldDetail.json().key.status).toBe('disabled')
    expect(newDetail.json().key).toMatchObject({ status: 'active', owner: { id: 'person-lin' }, purpose: '商品文案' })
    const replay = await app.inject({ method: 'POST', url: '/api/keys/key-lin-1/rotate', headers: { cookie, 'x-csrf-token': csrfToken }, payload: body })
    expect(replay.statusCode).toBe(200)
    expect(replay.json()).toMatchObject({ meta: { secretAvailable: false }, key: { id: first.key.id }, secret: null, operation: { idempotent: true } })
    const reused = await app.inject({ method: 'POST', url: '/api/keys/key-zhou-1/rotate', headers: { cookie, 'x-csrf-token': csrfToken }, payload: body })
    expect(reused.statusCode).toBe(409)
    expect(reused.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    const changedExpiry = await app.inject({ method: 'POST', url: '/api/keys/key-lin-1/rotate', headers: { cookie, 'x-csrf-token': csrfToken }, payload: { ...body, expiresInDays: 30 } })
    expect(changedExpiry.statusCode).toBe(409)
    expect(changedExpiry.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED')

    const audit = await app.inject({ method: 'GET', url: '/api/audit-events?period=7d&action=rotate&resource=key', headers: { cookie } })
    expect(audit.statusCode).toBe(200)
    expect(audit.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'rotate', resource: expect.objectContaining({ id: 'key-lin-1', name: 'sk-ops••••••7F2A' }), changes: expect.arrayContaining([expect.objectContaining({ field: 'status', before: '启用', after: '停用' }), expect.objectContaining({ field: 'secret', sensitive: true })]) })]))
    expect(JSON.stringify({ rotated: first, audit: audit.json() })).not.toContain(body.reason)
    expect(JSON.stringify(audit.json())).not.toContain(first.secret)

    const withoutCsrf = await app.inject({ method: 'POST', url: '/api/keys/key-zhou-1/rotate', headers: { cookie }, payload: { ...body, idempotencyKey: 'key-rotate-5e6f7g8h' } })
    expect(withoutCsrf.statusCode).toBe(403)
  })

  it('returns safe Key detail configuration and stable not-found errors', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/keys/key-lin-1' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.key.masked).toBe('sk-ops••••••7F2A')
    expect(body.connection.baseUrl).toBe('http://127.0.0.1:3000/v1')
    expect(JSON.stringify(body)).not.toMatch(/sk-[A-Za-z0-9_-]{20,}/)

    const missing = await createApp().inject({ method: 'GET', url: '/api/keys/key-missing-1' })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error.code).toBe('KEY_NOT_FOUND')
  })

  it('returns five-level soft quota policies with hard blocking disabled', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/limits' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.meta.source).toBe('database')
    expect(new Set(body.items.map((item: { level: string }) => item.level))).toEqual(new Set(['company', 'department', 'person', 'purpose', 'key']))
    expect(body.items.every((item: { mode: string; periods: unknown[] }) => item.mode === 'soft' && item.periods.length === 4)).toBe(true)
    expect(body.hardMode).toMatchObject({ enabled: false, blocking: false })
    expect(body.items.find((item: { id: string }) => item.id === 'department-content').periods.find((period: { id: string }) => period.id === 'month').limit).toBe(2600)
    expect(JSON.stringify(body)).not.toMatch(/Bearer|accessToken|managementKey/i)
  })

  it('filters quota policies by validated level and search text', async () => {
    const filtered = await createApp().inject({ method: 'GET', url: '/api/limits?level=key&search=7F2A' })
    expect(filtered.statusCode).toBe(200)
    expect(filtered.json().items).toHaveLength(1)
    expect(filtered.json().items[0]).toMatchObject({ id: 'key-lin-1', level: 'key', name: 'sk-ops••••••7F2A' })

    const invalid = await createApp().inject({ method: 'GET', url: '/api/limits?level=tenant' })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error.code).toBe('INVALID_REQUEST')
  })

  it('returns isolated purpose routes without credential material', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/routes' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.meta.source).toBe('demo')
    expect(body.items).toHaveLength(7)
    expect(body.isolation).toMatchObject({ enforced: true, productionGroup: 'official', experimentGroup: 'cpa-lab' })
    expect(body.items.every((item: { policy: { crossGroupFallback: boolean; clientChannelOverride: boolean } }) => !item.policy.crossGroupFallback && !item.policy.clientChannelOverride)).toBe(true)
    expect(body.items.filter((item: { environment: string }) => item.environment === 'production').every((item: { primary: { group: string }; fallbacks: { group: string }[] }) => item.primary.group === 'production' && item.fallbacks.every((target) => target.group === 'production'))).toBe(true)
    expect(JSON.stringify(body)).not.toMatch(/Bearer|accessToken|managementKey|apiKey/i)
  })

  it('filters purpose routes and rejects unsupported route parameters', async () => {
    const filtered = await createApp().inject({ method: 'GET', url: '/api/routes?environment=experiment&category=experiment' })
    expect(filtered.statusCode).toBe(200)
    expect(filtered.json().items).toHaveLength(1)
    expect(filtered.json().items[0]).toMatchObject({ alias: 'ecommerce-pro-lab', environment: 'experiment', primary: { group: 'experiment' } })

    const invalid = await createApp().inject({ method: 'GET', url: '/api/routes?environment=staging' })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error.code).toBe('INVALID_REQUEST')
  })

  it('returns a filterable model catalog with explicit price basis', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/models?capability=vision&environment=production' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ id: 'model-vision', environment: 'production', pricing: { basis: 'official' } })
    expect(body.items[0].capabilities).toContain('vision')

    const experiment = await createApp().inject({ method: 'GET', url: '/api/models?environment=experiment' })
    expect(experiment.json().items[0].pricing.basis).toBe('estimated')
  })

  it('returns safe channel health summaries and validates channel filters', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/channels?status=degraded' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ id: 'channel-official-global-1', status: 'degraded', balanceState: 'low', credentialConfigured: true })
    expect(JSON.stringify(body)).not.toMatch(/Bearer|accessToken|managementKey|apiKey|oauthToken/i)

    const invalid = await createApp().inject({ method: 'GET', url: '/api/channels?status=unknown' })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error.code).toBe('INVALID_REQUEST')
  })

  it('returns upstream accounts with live probes and no credential material', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/upstreams' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.meta).toMatchObject({ source: 'demo', live: { newApi: 'reachable', cpa: 'reachable' } })
    expect(body.summary).toMatchObject({ total: 5, official: 3, experiment: 2, configured: 4 })
    expect(body.isolation).toMatchObject({ enforced: true, productionToExperimentFallback: false })
    expect(body.items.every((item: { credentialConfigured: boolean }) => typeof item.credentialConfigured === 'boolean')).toBe(true)
    expect(JSON.stringify(body)).not.toMatch(/Bearer|accessToken|managementKey|apiKey|oauthToken|sk-[A-Za-z0-9_-]{8,}/i)
  })

  it('filters upstream accounts and rejects unsupported account states', async () => {
    const filtered = await createApp().inject({ method: 'GET', url: '/api/upstreams?type=cpa_oauth&status=auth_required' })
    expect(filtered.statusCode).toBe(200)
    expect(filtered.json().items).toHaveLength(1)
    expect(filtered.json().items[0]).toMatchObject({ id: 'upstream-cpa-lab-2', environment: 'experiment', credentialValidation: 'failed' })

    const invalid = await createApp().inject({ method: 'GET', url: '/api/upstreams?status=expired' })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error.code).toBe('INVALID_REQUEST')
  })

  it('returns filterable usage metadata with separate cost bases', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/usage?period=7d&status=failed&pageSize=10' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.meta).toMatchObject({ source: 'database', simulated: true, period: '7d' })
    expect(body.items.length).toBeGreaterThan(0)
    expect(body.items.every((item: { status: string; conversationContentAvailable: boolean }) => item.status === 'failed' && item.conversationContentAvailable === false)).toBe(true)
    expect(body.summary.costs).toEqual(expect.objectContaining({ officialActualUsd: expect.any(Number), platformEstimateUsd: expect.any(Number), cpaEstimateUsd: expect.any(Number) }))
    expect(JSON.stringify(body)).not.toMatch(/Bearer|accessToken|managementKey|apiKey|oauthToken/i)

    const invalid = await createApp().inject({ method: 'GET', url: '/api/usage?costType=mixed&page=0' })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error.code).toBe('INVALID_REQUEST')
  })

  it('returns metadata-only usage detail and a stable missing-record error', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/usage/req-demo-001' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.item).toMatchObject({ requestId: 'req-demo-001', conversationContentAvailable: false })
    expect(body.content).toMatchObject({ stored: false })
    expect(body.route.requestIdPropagated).toBe(true)
    expect(body.item.key.masked).toContain('••••••')
    expect(body.conversationAudit).toMatchObject({ accessible: true, recordId: 'conv-audit-copy-01', href: '/conversation-audit?recordId=conv-audit-copy-01', source: 'synthetic_seed' })

    const missing = await createApp().inject({ method: 'GET', url: '/api/usage/req-missing-1' })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error.code).toBe('USAGE_NOT_FOUND')
    expect(missing.json().error.requestId).toBe(missing.headers['x-request-id'])
  })

  it('does not return conversation-audit mappings to roles without conversation-audit access', async () => {
    const app = buildApp({ databasePath: ':memory:', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'lead-content', password: 'demo-lead-content' } })
    const cookie = cookieHeader(login.headers['set-cookie'])
    const response = await app.inject({ method: 'GET', url: '/api/usage/req-demo-001', headers: { cookie } })
    expect(response.statusCode).toBe(200)
    expect(response.json().conversationAudit).toEqual({
      accessible: false, recordId: null, href: null, source: 'not_authorized',
      notice: '当前角色没有对话审计权限，因此不返回可能关联的对话审计记录。',
    })
  })

  it('returns filterable alert events and explicit notification configuration state', async () => {
    const summary = await createApp().inject({ method: 'GET', url: '/api/alerts/summary' })
    expect(summary.statusCode).toBe(200)
    expect(summary.json().meta).toMatchObject({ source: 'database', simulated: true })
    expect(summary.json().summary).toMatchObject({ open: 4, critical: 1, warning: 3, experiment: 2 })
    expect(summary.json().notificationConfig).toMatchObject({ configured: false })

    const response = await createApp().inject({ method: 'GET', url: '/api/alerts?severity=warning&status=open&environment=experiment&pageSize=10' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.items).toHaveLength(1)
    expect(body.meta).toMatchObject({ source: 'database', simulated: true })
    expect(body.items[0]).toMatchObject({ id: 'alert-cpa-upstream', severity: 'warning', status: 'open', environment: 'experiment' })
    expect(JSON.stringify(body)).not.toMatch(/Bearer|accessToken|managementKey|apiKey|oauthToken|rawUpstreamBody/i)

    const invalid = await createApp().inject({ method: 'GET', url: '/api/alerts?severity=fatal' })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error.code).toBe('INVALID_REQUEST')
  })

  it('returns read-only alert rules and safe event details with stable missing errors', async () => {
    const rules = await createApp().inject({ method: 'GET', url: '/api/alert-rules' })
    expect(rules.statusCode).toBe(200)
    expect(rules.json().meta).toMatchObject({ source: 'database', simulated: true })
    expect(rules.json().items).toHaveLength(8)
    expect(rules.json().items.every((item: { notification: { configured: boolean } }) => item.notification.configured === false)).toBe(true)

    const response = await createApp().inject({ method: 'GET', url: '/api/alerts/alert-error-global' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.item).toMatchObject({ id: 'alert-error-global', severity: 'critical' })
    expect(body.analysis.rawUpstreamBodyAvailable).toBe(false)
    expect(body.timeline.some((item: { type: string }) => item.type === 'notification')).toBe(true)
    expect(JSON.stringify(body)).not.toMatch(/Bearer|accessToken|managementKey|apiKey|oauthToken/i)

    const missing = await createApp().inject({ method: 'GET', url: '/api/alerts/alert-missing' })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error.code).toBe('ALERT_NOT_FOUND')
    expect(missing.json().error.requestId).toBe(missing.headers['x-request-id'])
  })

  it('returns filterable audit events with safe sensitive-field summaries', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/audit-events?period=7d&action=rotate&resource=key&result=success&pageSize=10' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.meta).toMatchObject({ source: 'database', period: '7d' })
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ id: 'audit-key-rotate', contentAvailable: false, credentialValueAvailable: false })
    expect(body.items[0].changes[0]).toMatchObject({ before: '已变化', after: '已变化', sensitive: true })
    expect(body.retention).toMatchObject({ mode: 'database', deletionAllowed: false, appendOnlyVerified: false })
    expect(body.integrity).toMatchObject({ algorithm: 'sha256', verified: true, hashChainVerified: true, checkpointVerified: true, firstInvalidEventId: null })
    expect(JSON.stringify(body)).not.toMatch(/Bearer|accessToken|managementKey|apiKey|oauthToken|sk-[A-Za-z0-9_-]{8,}/i)

    const invalid = await createApp().inject({ method: 'GET', url: '/api/audit-events?action=delete&period=90d' })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error.code).toBe('INVALID_REQUEST')
  })

  it('returns audit detail without content or credentials and stable missing errors', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/audit-events/audit-key-rotate' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.event).toMatchObject({ id: 'audit-key-rotate', result: { status: 'success' }, contentAvailable: false, credentialValueAvailable: false })
    expect(body.request).toMatchObject({ requestId: 'req-audit-key-02', traceState: 'database_unverified' })
    expect(body.integrity).toMatchObject({ deletionAllowed: false, appendOnlyVerified: false, verified: true, hashChainVerified: true, checkpointVerified: true, algorithm: 'sha256', firstInvalidEventId: null })
    expect(JSON.stringify(body)).not.toMatch(/Bearer|accessToken|managementKey|apiKey|oauthToken/i)

    const missing = await createApp().inject({ method: 'GET', url: '/api/audit-events/audit-missing' })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error.code).toBe('AUDIT_EVENT_NOT_FOUND')
    expect(missing.json().error.requestId).toBe(missing.headers['x-request-id'])
  })

  it('returns filterable conversation-audit metadata without raw content', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/conversation-audits?period=7d&state=captured&grouping=independent_call&pageSize=10' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.meta).toMatchObject({ source: 'database', period: '7d' })
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ id: 'conv-audit-independent-03', state: 'captured', grouping: { type: 'independent_call', reliable: false } })
    expect(body.items[0].redaction.rawContentAvailable).toBe(false)
    expect(body.scope).toMatchObject({ defaultCaptureEnabled: false, storageEncryptedVerified: false, accessAuditPersisted: true, retention: { mode: 'metadata_only', proofRecords: 1, lastRunAt: expect.any(String) } })
    expect(JSON.stringify(body)).not.toMatch(/Bearer|accessToken|managementKey|apiKey|oauthToken|rawPrompt|rawResponse/i)

    const invalid = await createApp().inject({ method: 'GET', url: '/api/conversation-audits?state=deleted&period=90d' })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error.code).toBe('INVALID_REQUEST')
  })

  it('requires a reason before returning synthetic redacted demo turns', async () => {
    const app = createApp()
    const denied = await app.inject({ method: 'POST', url: '/api/conversation-audits/conv-audit-copy-01/access', payload: { reason: '太短', acknowledgeSensitiveScope: true } })
    expect(denied.statusCode).toBe(400)
    expect(denied.json().error.code).toBe('INVALID_REQUEST')

    const response = await app.inject({ method: 'POST', url: '/api/conversation-audits/conv-audit-copy-01/access', payload: { reason: '复核客户投诉关联请求与脱敏结果', acknowledgeSensitiveScope: true } })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.content).toMatchObject({ synthetic: true, decrypted: false })
    expect(body.access).toMatchObject({ reasonAccepted: true, persisted: true, authorizedByServerRbac: true, copyAllowed: false, exportAllowed: false, deleteAllowed: false })
    expect(body.linkedUsage).toMatchObject({ auditRequestId: 'req-260915-8f31', usageRequestId: 'req-demo-001', metadataEndpoint: '/api/usage/req-demo-001', linkVerified: true, source: 'synthetic_seed' })
    expect(body.linkedUsage.notice).toMatch(/合成用量映射/)
    expect(body.content.messages.some((item: { redacted: boolean }) => item.redacted)).toBe(true)
    expect(JSON.stringify(body)).not.toContain('复核客户投诉关联请求与脱敏结果')

    const accessHistory = await app.inject({ method: 'GET', url: '/api/conversation-audits/conv-audit-copy-01/access-events' })
    expect(accessHistory.statusCode).toBe(200)
    expect(accessHistory.json()).toMatchObject({
      meta: { source: 'database' },
      record: { id: 'conv-audit-copy-01', requestId: 'req-260915-8f31' },
      items: [expect.objectContaining({ action: 'view_synthetic', reasonProvided: true, reasonLength: 15, acknowledgedSensitiveScope: true })],
    })
    expect(JSON.stringify(accessHistory.json())).not.toMatch(/actorUserId|reasonText|复核客户投诉关联请求与脱敏结果/i)

    const missingHistory = await app.inject({ method: 'GET', url: '/api/conversation-audits/conv-audit-missing/access-events' })
    expect(missingHistory.statusCode).toBe(404)
    expect(missingHistory.json().error.code).toBe('CONVERSATION_AUDIT_NOT_FOUND')

    const audit = await app.inject({ method: 'GET', url: '/api/audit-events?period=7d&action=view&resource=conversation&result=success' })
    expect(audit.statusCode).toBe(200)
    expect(audit.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'view',
        resource: { type: 'conversation', id: 'conv-audit-copy-01', name: '预先脱敏合成轮次' },
        result: { status: 'success', code: 'CONVERSATION_ACCESS_RECORDED' },
        requestId: response.headers['x-request-id'],
        source: { type: 'web', label: '对话审计', ipMasked: null, client: '客户端信息未采集' },
      }),
    ]))
    const accessAudit = audit.json().items.find((item: { resource: { type: string } }) => item.resource.type === 'conversation')
    expect(accessAudit.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'reason', after: '已变化', sensitive: true }),
      expect.objectContaining({ field: 'contentMode', after: '合成且预先脱敏', sensitive: false }),
    ]))
    expect(JSON.stringify(audit.json())).not.toContain('复核客户投诉关联请求与脱敏结果')

    const unavailable = await app.inject({ method: 'POST', url: '/api/conversation-audits/conv-audit-expired-05/access', payload: { reason: '复核历史记录的到期清理状态', acknowledgeSensitiveScope: true } })
    expect(unavailable.statusCode).toBe(404)
    expect(unavailable.json().error.code).toBe('CONVERSATION_CONTENT_UNAVAILABLE')
  })

  it('returns mixed-source read-only settings without credential values', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/settings' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.meta.source).toBe('partial')
    expect(body.summary).toMatchObject({ sections: 6, roles: 5, servicesTotal: 4, enabledFeatures: 0, backupsVerified: 0 })
    expect(body.organization).toMatchObject({ source: 'database', company: '新知科技', departments: 5, people: 12 })
    expect(body.businessRules).toMatchObject({ source: 'database', version: 'draft-v0.1' })
    expect(body.retention).toMatchObject({ source: 'database', cleanupJobVerified: false, syntheticMetadataExpiry: { mode: 'synthetic_metadata_only', automaticOnStartup: true, proofRecords: 1, lastRun: { triggeredBy: 'startup', expiredRecords: 0, proofRecords: 1 }, realContentCleanup: false } })
    expect(body.connections).toMatchObject({ source: 'live' })
    expect(body.connections.items.every((item: { credentialValueAvailable: boolean }) => item.credentialValueAvailable === false)).toBe(true)
    expect(body.features.source).toBe('database')
    expect(body.features.items.every((item: { enabled: boolean; editable: boolean }) => item.enabled === false && item.editable === false)).toBe(true)
    expect(body.backup).toMatchObject({ source: 'database', configured: false, browserDownloadAllowed: false })
    expect(JSON.stringify(body)).not.toMatch(/Bearer|accessToken|managementKey|apiKey|oauthToken|password/i)
  })

  it('returns a self-scoped employee profile and masked personal Keys', async () => {
    const profile = await createApp().inject({ method: 'GET', url: '/api/me' })
    const keys = await createApp().inject({ method: 'GET', url: '/api/me/keys' })
    expect(profile.statusCode).toBe(200)
    expect(profile.json()).toMatchObject({ meta: { source: 'database' }, scope: { mode: 'self_database', currentUserVerified: true, serverRbacVerified: true, otherPeopleAvailable: false } })
    expect(profile.json().person).toMatchObject({ id: 'person-lin', role: 'employee' })
    expect(keys.statusCode).toBe(200)
    expect(keys.json().meta.source).toBe('database')
    expect(keys.json().items).toHaveLength(2)
    expect(keys.json().items.every((item: { secretAvailable: boolean; rotateAvailable: boolean; masked: string }) => !item.secretAvailable && !item.rotateAvailable && item.masked.includes('••••••'))).toBe(true)
    expect(keys.json().connection).toMatchObject({ upstreamDetailsAvailable: false })
    expect(JSON.stringify({ profile: profile.json(), keys: keys.json() })).not.toMatch(/Bearer|accessToken|managementKey|apiKey|oauthToken|sk-[A-Za-z0-9_-]{8,}/i)
  })

  it('returns personal usage and business aliases while rejecting invalid periods', async () => {
    const usage = await createApp().inject({ method: 'GET', url: '/api/me/usage?period=30d' })
    const models = await createApp().inject({ method: 'GET', url: '/api/me/models' })
    expect(usage.statusCode).toBe(200)
    expect(usage.json().meta).toMatchObject({ source: 'database', period: '30d' })
    expect(usage.json().trend).toHaveLength(30)
    expect(usage.json().summary).toMatchObject({ softTarget: true, requestBlockingEnabled: false })
    expect(models.statusCode).toBe(200)
    expect(models.json().meta.source).toBe('demo')
    expect(models.json().items).toHaveLength(3)
    expect(models.json().items.every((item: { providerAvailable: boolean; actualModelAvailable: boolean; channelAvailable: boolean }) => !item.providerAvailable && !item.actualModelAvailable && !item.channelAvailable)).toBe(true)
    const invalid = await createApp().inject({ method: 'GET', url: '/api/me/usage?period=90d' })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error.code).toBe('INVALID_REQUEST')
  })

  it('supports the thirty-day period', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/overview?period=30d' })
    expect(response.statusCode).toBe(200)
    expect(response.json().trend).toHaveLength(30)
  })

  it('returns a stable error envelope for invalid periods', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/overview?period=90d' })
    const body = response.json()
    expect(response.statusCode).toBe(400)
    expect(body.error.code).toBe('INVALID_REQUEST')
    expect(body.error.requestId).toBe(response.headers['x-request-id'])
  })
})
