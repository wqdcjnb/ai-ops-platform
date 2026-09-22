import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from './app.js'
import type { CpaLogReader } from './cpa-logs.js'
import { createNewApiManagementClient } from './new-api-management.js'
import type { NewApiDatabaseReader } from './new-api-database.js'
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
    expect(body.migrationVersion).toBe(31)
    expect(body.tables).toEqual(expect.arrayContaining(['schema_migrations', 'users', 'api_keys', 'quota_policies', 'temporary_quota_requests', 'quota_reservations', 'route_policy_overrides', 'channel_health_snapshots', 'person_model_policies', 'audit_events', 'audit_chain_checkpoints', 'usage_requests', 'conversation_access_events', 'conversation_audit_records', 'conversation_audit_cleanup_runs', 'conversation_audit_expiry_proofs', 'conversation_usage_links', 'system_business_rules', 'business_rule_versions', 'system_feature_flags', 'system_role_definitions', 'system_retention_policies', 'system_backup_status', 'user_sessions', 'session_cleanup_runs']))
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

  it('bootstraps the local super-admin session without exposing credentials to the browser', async () => {
    const app = createApp()
    const bootstrap = await app.inject({ method: 'POST', url: '/api/auth/bootstrap' })
    expect(bootstrap.statusCode).toBe(200)
    expect(bootstrap.json()).toMatchObject({ authenticated: true, user: { role: 'super_admin' } })
    const cookie = cookieHeader(bootstrap.headers['set-cookie'])
    const overview = await app.inject({ method: 'GET', url: '/api/overview', headers: { cookie } })
    expect(overview.statusCode).toBe(200)
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
    expect(body.metrics).toMatchObject({ todayRequests: expect.any(Number), successRate: expect.any(Number), p95LatencyMs: expect.any(Number) })
    expect(body.trend.every((point: { points?: unknown }) => !('points' in point))).toBe(true)
    expect(body.people.every((person: { tokens: number }) => typeof person.tokens === 'number')).toBe(true)
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
    expect(body).toMatchObject({ source: 'database', simulated: true, summary: { activeKeys: expect.any(Number), expiringKeys: expect.any(Number) } })
    expect(body.items.map((item: { target: string }) => item.target)).toEqual(expect.arrayContaining(['keys']))
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

  it('mirrors New API Tokens before rendering the people Key count', async () => {
    const database = createPlatformDatabase({ filename: ':memory:' })
    database.seedDepartment({ id: 'department-remote-test', name: '远程测试部门' })
    database.createPerson({ id: 'person-123', username: 'remote-person', displayName: '远程测试人员', departmentId: 'department-remote-test', password: 'not-used', externalUserId: '123' })
    const ready = <T>(data: T) => ({ state: 'ready' as const, statusCode: 200, data, message: null })
    const token = {
      id: 456, user_id: 123, name: 'AIOPS-remote-test-copy', key: 'sk-remote-test-secret-1234567890', status: 1,
      unlimited_quota: true, expired_time: -1, model_limits_enabled: true, model_limits: ['ecommerce-copy'], group: '', created_time: Math.floor(Date.now() / 1000), accessed_time: 0,
    }
    const newApiTokenClient = {
      authConfigured: true,
      listTokens: async () => ready({ items: [token], total: 1 }),
      getToken: async () => ready(token),
      createToken: async () => ready(token),
      updateTokenStatus: async () => ready({ id: 456, status: 0 }),
    }
    const app = buildApp({
      authMode: 'disabled',
      database,
      peopleManagementClient: createNewApiManagementClient({ baseUrl: 'http://new-api.test' }),
      newApiTokenClient,
      probeNewApi: reachableNewApi,
      probeCpa: reachableService,
      probeDocs: reachableService,
    })
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/api/people?search=远程测试人员&status=all' })
    expect(response.statusCode).toBe(200)
    expect(response.json().items[0]).toMatchObject({ name: '远程测试人员', keyCount: 1 })
    expect(database.listApiKeysForOwner('person-123')).toHaveLength(1)
    expect(database.findApiKeyByExternalTokenId('456')).toMatchObject({ externalTokenId: '456', ownerUserId: 'person-123', status: 'active' })
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
    expect(body.metrics.monthTokens).toBe(body.metrics.monthInputTokens + body.metrics.monthOutputTokens)
    expect(body.keys.find((key: { id: string }) => key.id === 'key-lin-1').usage).toMatchObject({ requests: 2, inputTokens: 4250, outputTokens: 1716, totalTokens: 5966 })
    expect(body.keys.find((key: { id: string }) => key.id === 'key-lin-2').usage).toMatchObject({ requests: 1, inputTokens: 3260, outputTokens: 1420, totalTokens: 4680 })
    expect(body.metrics.monthTokens).toBe(10646)
    expect(body.keys.reduce((total: number, key: { usage: { totalTokens: number } }) => total + key.usage.totalTokens, 0)).toBe(body.metrics.monthTokens)
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
    expect(created.json().operation.auditEventId).toBe(`audit-${created.json().person.id}-create`)

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
    expect(usage.json().summary).toMatchObject({ requests: 3, inputTokens: 7510, outputTokens: 3136, totalTokens: 10646 })
    expect(usage.json().items.reduce((total: number, item: { tokens: number }) => total + item.tokens, 0)).toBe(10646)
    expect(usage.json().breakdown).toEqual(expect.arrayContaining([
      expect.objectContaining({ keyId: 'key-lin-1', alias: 'ecommerce-copy', requests: 2, inputTokens: 4250, outputTokens: 1716, totalTokens: 5966 }),
      expect.objectContaining({ keyId: 'key-lin-2', alias: 'ecommerce-translate', requests: 1, inputTokens: 3260, outputTokens: 1420, totalTokens: 4680 }),
    ]))

    const missing = await createApp().inject({ method: 'GET', url: '/api/people/person-missing' })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error.code).toBe('PERSON_NOT_FOUND')
    expect(missing.json().error.requestId).toBe(missing.headers['x-request-id'])
  })

  it('imports people atomically, supports idempotent replay, and rolls back username conflicts', async () => {
    const app = buildApp({ databasePath: ':memory:', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-demo' } })
    const cookie = cookieHeader(login.headers['set-cookie'])
    const csrfToken = cookieValue(login.headers['set-cookie'], 'ai_ops_csrf')
    const payload = {
      idempotencyKey: 'people-import-1a2b3c4d',
      items: [
        { username: 'batch-one', displayName: '批量一号', departmentId: 'content', password: 'batch-pass-1' },
        { displayName: '批量二号', departmentId: 'ads' },
      ],
    }
    const created = await app.inject({ method: 'POST', url: '/api/people/batch', headers: { cookie, 'x-csrf-token': csrfToken }, payload })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ meta: { createdCount: 2 }, operation: { idempotencyKey: payload.idempotencyKey, idempotent: false } })
    expect(JSON.stringify(created.json())).not.toContain('batch-pass-1')
    expect(created.json().people[1].username).toMatch(/^person-/)

    const replay = await app.inject({ method: 'POST', url: '/api/people/batch', headers: { cookie, 'x-csrf-token': csrfToken }, payload })
    expect(replay.statusCode).toBe(201)
    expect(replay.json()).toMatchObject({ meta: { createdCount: 2 }, operation: { idempotent: true, auditEventId: created.json().operation.auditEventId } })

    const audit = await app.inject({ method: 'GET', url: `/api/audit-events?period=7d&eventId=${created.json().operation.auditEventId}`, headers: { cookie } })
    expect(audit.statusCode).toBe(200)
    expect(audit.json().items).toHaveLength(1)
    expect(audit.json().items[0]).toMatchObject({ resource: { type: 'person', name: '批量添加人员（2 条）' }, changes: expect.arrayContaining([expect.objectContaining({ field: 'password', sensitive: true })]) })

    const conflict = await app.inject({ method: 'POST', url: '/api/people/batch', headers: { cookie, 'x-csrf-token': csrfToken }, payload: { idempotencyKey: 'people-import-5e6f7g8h', items: [{ username: 'batch-three', displayName: '批量三号', departmentId: 'content', password: 'batch-pass-3' }, { username: 'batch-one', displayName: '冲突人员', departmentId: 'content', password: 'batch-pass-4' }] } })
    expect(conflict.statusCode).toBe(409)
    expect(conflict.json().error.code).toBe('BATCH_USERNAME_CONFLICT')
    const rolledBack = await app.inject({ method: 'GET', url: '/api/people?search=batch-three', headers: { cookie } })
    expect(rolledBack.json().items).toHaveLength(0)
  })

  it('synchronizes enable, disable, and delete actions with New API before updating the local mirror', async () => {
    const database = createPlatformDatabase({ filename: ':memory:' })
    const departmentId = database.ensureDepartment('远程状态部门')
    for (const externalUserId of ['42', '43']) {
      database.upsertSyncedPerson({
        externalUserId,
        username: `remote-${externalUserId}`,
        displayName: `远程人员 ${externalUserId}`,
        departmentId,
        departmentName: '远程状态部门',
        status: 'active',
        createdAt: null,
        lastUsedAt: null,
      })
    }
    const calls: Array<{ url: string; method: string; body?: unknown }> = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })
    }) as unknown as typeof fetch
    const app = buildApp({
      authMode: 'disabled',
      database,
      peopleManagementClient: createNewApiManagementClient({ baseUrl: 'http://new-api.test', accessToken: 'management-secret', fetchImpl }),
      probeNewApi: reachableNewApi,
      probeCpa: reachableService,
      probeDocs: reachableService,
    })
    apps.push(app)

    const personIdFor = (externalUserId: string) => database.listPeople().find((person) => person.externalUserId === externalUserId)?.id ?? ''
    const firstPersonId = personIdFor('42')
    const secondPersonId = personIdFor('43')
    expect(firstPersonId).not.toBe('')
    expect(secondPersonId).not.toBe('')

    const disabled = await app.inject({ method: 'POST', url: `/api/people/${firstPersonId}/disable`, payload: { idempotencyKey: 'person-disable-remote-42', acknowledgeImpact: true } })
    expect(disabled.statusCode).toBe(200)
    expect(disabled.json().person.status).toBe('disabled')

    const enabled = await app.inject({ method: 'POST', url: `/api/people/${firstPersonId}/enable`, payload: { idempotencyKey: 'person-enable-remote-42', acknowledgeImpact: true } })
    expect(enabled.statusCode).toBe(200)
    expect(enabled.json().person.status).toBe('active')

    const disabledForDelete = await app.inject({ method: 'POST', url: `/api/people/${secondPersonId}/disable`, payload: { idempotencyKey: 'person-disable-remote-43', acknowledgeImpact: true } })
    expect(disabledForDelete.statusCode).toBe(200)
    const deleted = await app.inject({ method: 'POST', url: `/api/people/${secondPersonId}/delete`, payload: { idempotencyKey: 'person-delete-remote-43', acknowledgeImpact: true } })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json().person.status).toBe('deleted')

    expect(calls).toEqual([
      { url: 'http://new-api.test/api/user/manage', method: 'POST', body: { id: 42, action: 'disable' } },
      { url: 'http://new-api.test/api/user/manage', method: 'POST', body: { id: 42, action: 'enable' } },
      { url: 'http://new-api.test/api/user/manage', method: 'POST', body: { id: 43, action: 'disable' } },
      { url: 'http://new-api.test/api/user/manage', method: 'POST', body: { id: 43, action: 'delete' } },
    ])
    expect(database.listSyncedPeople()).not.toEqual(expect.arrayContaining([expect.objectContaining({ externalUserId: '43' })]))
  })

  it('keeps the local person enabled when New API rejects a status mutation', async () => {
    const database = createPlatformDatabase({ filename: ':memory:' })
    const departmentId = database.ensureDepartment('远程失败部门')
    database.upsertSyncedPerson({
      externalUserId: '44',
      username: 'remote-44',
      displayName: '远程人员 44',
      departmentId,
      departmentName: '远程失败部门',
      status: 'active',
      createdAt: null,
      lastUsedAt: null,
    })
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: false, message: '管理接口拒绝操作' }), { status: 503 })) as unknown as typeof fetch
    const app = buildApp({
      authMode: 'disabled',
      database,
      peopleManagementClient: createNewApiManagementClient({ baseUrl: 'http://new-api.test', accessToken: 'management-secret', fetchImpl }),
      probeNewApi: reachableNewApi,
      probeCpa: reachableService,
      probeDocs: reachableService,
    })
    apps.push(app)

    const personId = database.listPeople().find((person) => person.externalUserId === '44')?.id ?? ''
    const response = await app.inject({ method: 'POST', url: `/api/people/${personId}/disable`, payload: { idempotencyKey: 'person-disable-remote-44', acknowledgeImpact: true } })
    expect(response.statusCode).toBe(502)
    expect(response.json().error.code).toBe('NEW_API_UNAVAILABLE')
    expect(database.listPeople().find((person) => person.id === personId)?.status).toBe('active')
  })

  it('disables a local person and atomically revokes their active Keys without requiring a reason', async () => {
    const app = buildApp({ databasePath: ':memory:', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-demo' } })
    const cookie = cookieHeader(login.headers['set-cookie'])
    const csrfToken = cookieValue(login.headers['set-cookie'], 'ai_ops_csrf')
    const body = { idempotencyKey: 'person-disable-1a2b3c4d', acknowledgeImpact: true }
    const disabled = await app.inject({ method: 'POST', url: '/api/people/person-lin/disable', headers: { cookie, 'x-csrf-token': csrfToken }, payload: body })
    expect(disabled.statusCode).toBe(200)
    expect(disabled.json()).toMatchObject({ meta: { source: 'database' }, person: { id: 'person-lin', name: '林筱雨', status: 'disabled' }, keysDisabled: 2, operation: { idempotencyKey: body.idempotencyKey, idempotent: false, auditEventId: 'audit-person-disable-1a2b3c4d' } })

    const people = await app.inject({ method: 'GET', url: '/api/people', headers: { cookie } })
    expect(people.statusCode).toBe(200)
    expect(people.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'person-lin', status: 'disabled' })]))

    const person = await app.inject({ method: 'GET', url: '/api/people/person-lin', headers: { cookie } })
    const keys = await app.inject({ method: 'GET', url: '/api/keys?owner=person-lin&status=disabled', headers: { cookie } })
    expect(person.json().profile.status).toBe('disabled')
    expect(person.json().keys.every((key: { status: string }) => key.status === 'disabled')).toBe(true)
    expect(keys.json().items).toHaveLength(2)
    expect(keys.json().items.every((key: { status: string }) => key.status === 'disabled')).toBe(true)
    const employeeLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'employee', password: 'employee-demo' } })
    expect(employeeLogin.statusCode).toBe(401)

    const replay = await app.inject({ method: 'POST', url: '/api/people/person-lin/disable', headers: { cookie, 'x-csrf-token': csrfToken }, payload: body })
    expect(replay.statusCode).toBe(200)
    expect(replay.json()).toMatchObject({ keysDisabled: 2, operation: { idempotent: true } })
    const reused = await app.inject({ method: 'POST', url: '/api/people/person-zhou/disable', headers: { cookie, 'x-csrf-token': csrfToken }, payload: body })
    expect(reused.statusCode).toBe(409)
    expect(reused.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED')

    const audit = await app.inject({ method: 'GET', url: '/api/audit-events?period=7d&action=disable&resource=person', headers: { cookie } })
    expect(audit.statusCode).toBe(200)
    expect(audit.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'disable', resource: expect.objectContaining({ id: 'person-lin', name: '林筱雨' }), changes: expect.arrayContaining([expect.objectContaining({ field: 'status', before: '在职', after: '停用' }), expect.objectContaining({ field: 'keys' })]) })]))

    const withoutCsrf = await app.inject({ method: 'POST', url: '/api/people/person-zhou/disable', headers: { cookie }, payload: { ...body, idempotencyKey: 'person-disable-5e6f7g8h' } })
    expect(withoutCsrf.statusCode).toBe(403)
  })

  it('enables a disabled person and restores only the Keys reclaimed by that disable operation', async () => {
    const app = buildApp({ databasePath: ':memory:', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-demo' } })
    const cookie = cookieHeader(login.headers['set-cookie'])
    const csrfToken = cookieValue(login.headers['set-cookie'], 'ai_ops_csrf')

    const disabled = await app.inject({
      method: 'POST',
      url: '/api/people/person-lin/disable',
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { idempotencyKey: 'person-disable-enable-1a2b3c4d', acknowledgeImpact: true },
    })
    expect(disabled.statusCode).toBe(200)

    const body = { idempotencyKey: 'person-enable-1a2b3c4d', acknowledgeImpact: true }
    const enabled = await app.inject({ method: 'POST', url: '/api/people/person-lin/enable', headers: { cookie, 'x-csrf-token': csrfToken }, payload: body })
    expect(enabled.statusCode).toBe(200)
    expect(enabled.json()).toMatchObject({ meta: { source: 'database' }, person: { id: 'person-lin', name: '林筱雨', status: 'active' }, keysEnabled: 2, operation: { idempotencyKey: body.idempotencyKey, idempotent: false, auditEventId: 'audit-person-enable-1a2b3c4d' } })

    const person = await app.inject({ method: 'GET', url: '/api/people/person-lin', headers: { cookie } })
    expect(person.statusCode).toBe(200)
    expect(person.json().profile.status).toBe('active')
    expect(person.json().keys.every((key: { status: string }) => key.status === 'active')).toBe(true)
    const expiringKeys = await app.inject({ method: 'GET', url: '/api/keys?owner=person-lin&status=expiring', headers: { cookie } })
    expect(expiringKeys.statusCode).toBe(200)
    expect(expiringKeys.json().items).toHaveLength(1)

    const replay = await app.inject({ method: 'POST', url: '/api/people/person-lin/enable', headers: { cookie, 'x-csrf-token': csrfToken }, payload: body })
    expect(replay.statusCode).toBe(200)
    expect(replay.json()).toMatchObject({ keysEnabled: 2, operation: { idempotent: true } })
    const alreadyEnabled = await app.inject({ method: 'POST', url: '/api/people/person-lin/enable', headers: { cookie, 'x-csrf-token': csrfToken }, payload: { ...body, idempotencyKey: 'person-enable-5e6f7g8h' } })
    expect(alreadyEnabled.statusCode).toBe(409)
    expect(alreadyEnabled.json().error.code).toBe('PERSON_ALREADY_ENABLED')

    const audit = await app.inject({ method: 'GET', url: '/api/audit-events?period=7d&action=enable&resource=person', headers: { cookie } })
    expect(audit.statusCode).toBe(200)
    expect(audit.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'enable', resource: expect.objectContaining({ id: 'person-lin', name: '林筱雨' }), changes: expect.arrayContaining([expect.objectContaining({ field: 'status', before: '停用', after: '在职' }), expect.objectContaining({ field: 'keys' })]) })]))

    const disabledBefore = await app.inject({ method: 'POST', url: '/api/people/person-xu/disable', headers: { cookie, 'x-csrf-token': csrfToken }, payload: { idempotencyKey: 'person-disable-pre-revoked-1a2b3c4d', acknowledgeImpact: true } })
    expect(disabledBefore.json()).toMatchObject({ keysDisabled: 0 })
    const enabledAfter = await app.inject({ method: 'POST', url: '/api/people/person-xu/enable', headers: { cookie, 'x-csrf-token': csrfToken }, payload: { idempotencyKey: 'person-enable-pre-revoked-1a2b3c4d', acknowledgeImpact: true } })
    expect(enabledAfter.json()).toMatchObject({ keysEnabled: 0 })
    const revokedKey = await app.inject({ method: 'GET', url: '/api/keys/key-xu-1', headers: { cookie } })
    expect(revokedKey.statusCode).toBe(200)
    expect(revokedKey.json().key.status).toBe('disabled')
  })

  it('deletes only a disabled person, hides the directory records, and replays idempotently', async () => {
    const app = buildApp({ databasePath: ':memory:', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-demo' } })
    const cookie = cookieHeader(login.headers['set-cookie'])
    const csrfToken = cookieValue(login.headers['set-cookie'], 'ai_ops_csrf')

    const disabled = await app.inject({
      method: 'POST',
      url: '/api/people/person-lin/disable',
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { idempotencyKey: 'person-disable-7a8b9c0d', acknowledgeImpact: true },
    })
    expect(disabled.statusCode).toBe(200)

    const body = { idempotencyKey: 'person-delete-1a2b3c4d', acknowledgeImpact: true }
    const deleted = await app.inject({ method: 'POST', url: '/api/people/person-lin/delete', headers: { cookie, 'x-csrf-token': csrfToken }, payload: body })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json()).toMatchObject({ meta: { source: 'database' }, person: { id: 'person-lin', name: '林筱雨', status: 'deleted' }, operation: { idempotencyKey: body.idempotencyKey, idempotent: false, auditEventId: 'audit-person-delete-1a2b3c4d' } })

    const person = await app.inject({ method: 'GET', url: '/api/people/person-lin', headers: { cookie } })
    expect(person.statusCode).toBe(404)
    expect(person.json().error.code).toBe('PERSON_NOT_FOUND')
    const people = await app.inject({ method: 'GET', url: `/api/people?search=${encodeURIComponent('林筱雨')}`, headers: { cookie } })
    expect(people.statusCode).toBe(200)
    expect(people.json().items).toHaveLength(0)
    const keys = await app.inject({ method: 'GET', url: '/api/keys?owner=person-lin', headers: { cookie } })
    expect(keys.statusCode).toBe(200)
    expect(keys.json().items).toHaveLength(0)

    const replay = await app.inject({ method: 'POST', url: '/api/people/person-lin/delete', headers: { cookie, 'x-csrf-token': csrfToken }, payload: body })
    expect(replay.statusCode).toBe(200)
    expect(replay.json()).toMatchObject({ person: { status: 'deleted' }, operation: { idempotent: true, auditEventId: deleted.json().operation.auditEventId } })

    const activeDelete = await app.inject({ method: 'POST', url: '/api/people/person-zhou/delete', headers: { cookie, 'x-csrf-token': csrfToken }, payload: { ...body, idempotencyKey: 'person-delete-5e6f7g8h' } })
    expect(activeDelete.statusCode).toBe(409)
    expect(activeDelete.json().error.code).toBe('PERSON_MUST_BE_DISABLED')

    const audit = await app.inject({ method: 'GET', url: '/api/audit-events?period=7d&action=delete&resource=person', headers: { cookie } })
    expect(audit.statusCode).toBe(200)
    expect(audit.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'delete', resource: expect.objectContaining({ id: 'person-lin', name: '林筱雨' }), changes: expect.arrayContaining([expect.objectContaining({ field: 'directory', before: '已停用', after: '已删除' })]) })]))
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

  it('allows administrators to create, view, and audit a locally encrypted Key', async () => {
    const app = buildApp({ databasePath: ':memory:', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-demo' } })
    const cookie = cookieHeader(login.headers['set-cookie'])
    const csrfToken = cookieValue(login.headers['set-cookie'], 'ai_ops_csrf')
    const created = await app.inject({ method: 'POST', url: '/api/keys', headers: { cookie, 'x-csrf-token': csrfToken }, payload: { ownerId: 'person-lin', purpose: '大促文案', model: 'ecommerce-copy', expiresInDays: 30, deviceNote: '本地演示设备' } })
    expect(created.statusCode).toBe(201)
    expect(created.json().secret).toMatch(/^sk-ops-/)
    expect(created.json().key.masked).toContain('••••••')
    expect(created.json().key.masked).not.toContain(created.json().secret)
    expect(created.json().operation.auditEventId).toBe(`audit-${created.json().key.id}-create`)

    const listed = await app.inject({ method: 'GET', url: `/api/keys?search=${encodeURIComponent('大促文案')}`, headers: { cookie } })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().items[0]).toMatchObject({ purpose: '大促文案', model: 'ecommerce-copy', models: ['ecommerce-copy'] })
    expect(listed.json().items[0].secretAvailable).toBe(true)
    expect(JSON.stringify(listed.json())).not.toContain(created.json().secret)

    const detail = await app.inject({ method: 'GET', url: `/api/keys/${created.json().key.id}`, headers: { cookie } })
    expect(detail.statusCode).toBe(200)
    expect(detail.json().key.secretAvailable).toBe(true)
    const viewed = await app.inject({ method: 'GET', url: `/api/keys/${created.json().key.id}/secret`, headers: { cookie } })
    expect(viewed.statusCode).toBe(200)
    expect(viewed.json().secret).toBe(created.json().secret)

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

    const viewAudit = await app.inject({ method: 'GET', url: `/api/audit-events/${viewed.json().operation.auditEventId}`, headers: { cookie } })
    expect(viewAudit.statusCode).toBe(200)
    expect(viewAudit.json().event).toMatchObject({ action: 'view', resource: { type: 'key', id: created.json().key.id }, credentialValueAvailable: false })
    expect(JSON.stringify(viewAudit.json())).not.toContain(created.json().secret)

    const employeeLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'employee', password: 'employee-demo' } })
    const employeeCreate = await app.inject({ method: 'POST', url: '/api/keys', headers: { cookie: cookieHeader(employeeLogin.headers['set-cookie']) }, payload: { ownerId: 'person-lin', purpose: '越权 Key', model: 'ecommerce-general', expiresInDays: 30, deviceNote: '测试' } })
    expect(employeeCreate.statusCode).toBe(403)
    const employeeView = await app.inject({ method: 'GET', url: `/api/keys/${created.json().key.id}/secret`, headers: { cookie: cookieHeader(employeeLogin.headers['set-cookie']) } })
    expect(employeeView.statusCode).toBe(403)
  })

  it('creates an admin-owned New API Key while keeping the selected person as its AI OPS display owner', async () => {
    const database = createPlatformDatabase({ filename: ':memory:' })
    database.seedDepartment({ id: 'department-remote-test', name: '远程测试部门' })
    database.createPerson({ id: 'person-123', username: 'remote-person', displayName: '远程测试人员', departmentId: 'department-remote-test', password: 'not-used', externalUserId: '123' })
    const createCalls: unknown[] = []
    const statusCalls: Array<{ id: string; status: 0 | 1 }> = []
    const fullSecret = 'remote-test-secret-1234567890'
    let tokenName = ''
    const token = {
      id: '123', user_id: '1', name: 'AIOPS-remote-test-abc12345', key: 'sk-**********7890', status: 1,
      unlimited_quota: true, expired_time: -1, model_limits_enabled: true, model_limits: ['ecommerce-copy'], group: '', created_time: Math.floor(Date.now() / 1000), accessed_time: 0,
    }
    const ready = <T>(data: T) => ({ state: 'ready' as const, statusCode: 200, data, message: null })
    const newApiTokenClient = {
      authConfigured: true,
      listTokens: async (_page?: number, _pageSize?: number, userId?: string) => { expect(userId).toBe('1'); return ready({ items: [{ ...token, name: tokenName }], total: 1 }) },
      getToken: async (_id?: string, userId?: string) => { expect(userId).toBe('1'); return ready(token) },
      getTokenKey: async (_id?: string, userId?: string) => { expect(userId).toBe('1'); return ready({ key: fullSecret }) },
      createToken: async (input: unknown) => { createCalls.push(input); tokenName = (input as { name: string }).name; return ready({ success: true, message: '' }) },
      updateTokenStatus: async (id: string, status: 0 | 1, _userId?: string) => { statusCalls.push({ id, status }); return ready({ id, status }) },
    }
    const app = buildApp({ authMode: 'disabled', database, newApiTokenClient, cpaModelReader: async () => ['ecommerce-copy'], probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)

    const idempotencyKey = 'key-create-remote-123456'
    const created = await app.inject({ method: 'POST', url: '/api/keys', headers: { 'idempotency-key': idempotencyKey }, payload: { personId: '123', purpose: 'Codex 开发', model: 'ecommerce-copy' } })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ meta: { source: 'new_api' }, key: { owner: { id: 'person-123', department: '远程测试部门' }, purpose: 'Codex 开发', model: 'ecommerce-copy', expiresAt: null } })
    expect(created.json().secret).toBe(`sk-${fullSecret}`)
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0]).toMatchObject({ user_id: '1', name: 'Codex 开发', model_limits: 'ecommerce-copy' })
    expect(database.listApiKeys()).toEqual(expect.arrayContaining([expect.objectContaining({ externalTokenId: '123', quotaMode: 'unlimited', expiresAt: null, secretAvailable: false })]))
    expect(database.readApiKeySecret(created.json().key.id)).toBeNull()
    expect(JSON.stringify(database.listAuditEvents())).not.toContain(fullSecret)

    const listed = await app.inject({ method: 'GET', url: '/api/keys?pageSize=50' })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.json().key.id, owner: expect.objectContaining({ id: 'person-123', name: '远程测试人员' }) })]))

    const replay = await app.inject({ method: 'POST', url: '/api/keys', headers: { 'idempotency-key': idempotencyKey }, payload: { personId: '123', purpose: 'Codex 开发', model: 'ecommerce-copy' } })
    expect(replay.statusCode).toBe(409)
    expect(replay.json().error.code).toBe('TOKEN_ALREADY_CREATED')
    expect(createCalls).toHaveLength(1)

    const secret = await app.inject({ method: 'GET', url: `/api/keys/${created.json().key.id}/secret` })
    expect(secret.statusCode).toBe(200)
    expect(secret.json().meta.source).toBe('new_api')
    expect(secret.json().secret).toBe(`sk-${fullSecret}`)
    expect(JSON.stringify(secret.json())).toContain(`sk-${fullSecret}`)
    const secretAudit = await app.inject({ method: 'GET', url: `/api/audit-events/${secret.json().operation.auditEventId}` })
    expect(secretAudit.statusCode).toBe(200)
    expect(secretAudit.json().event).toMatchObject({ action: 'view', resource: { type: 'key', id: created.json().key.id }, credentialValueAvailable: false })
    expect(JSON.stringify(secretAudit.json())).not.toContain(fullSecret)

    const disabled = await app.inject({ method: 'POST', url: `/api/keys/${created.json().key.id}/disable`, payload: { idempotencyKey: 'key-disable-remote-123456', acknowledgeImpact: true } })
    expect(disabled.statusCode).toBe(200)
    expect(disabled.json()).toMatchObject({ meta: { source: 'new_api' }, key: { status: 'disabled' } })
    expect(statusCalls).toEqual([{ id: '123', status: 0 }])
    database.close()
  })

  it('disables only a local demo Key with CSRF, idempotency, and a safe audit summary', async () => {
    const app = buildApp({ databasePath: ':memory:', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-demo' } })
    const cookie = cookieHeader(login.headers['set-cookie'])
    const csrfToken = cookieValue(login.headers['set-cookie'], 'ai_ops_csrf')
    const body = { idempotencyKey: 'key-disable-1a2b3c4d', acknowledgeImpact: true }
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

    const withoutCsrf = await app.inject({ method: 'POST', url: '/api/keys/key-zhou-1/disable', headers: { cookie }, payload: { ...body, idempotencyKey: 'key-disable-5e6f7g8h' } })
    expect(withoutCsrf.statusCode).toBe(403)
  })

  it('resets a Key in place without a reason and keeps the new value viewable', async () => {
    const app = buildApp({ databasePath: ':memory:', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-demo' } })
    const cookie = cookieHeader(login.headers['set-cookie'])
    const csrfToken = cookieValue(login.headers['set-cookie'], 'ai_ops_csrf')
    const body = { idempotencyKey: 'key-reset-1a2b3c4d', acknowledgeImpact: true }
    const reset = await app.inject({ method: 'POST', url: '/api/keys/key-lin-1/reset', headers: { cookie, 'x-csrf-token': csrfToken }, payload: body })
    expect(reset.statusCode).toBe(200)
    expect(reset.json()).toMatchObject({ key: { id: 'key-lin-1' }, operation: { idempotent: false, idempotencyKey: body.idempotencyKey } })
    expect(reset.json().secret).toMatch(/^sk-ops-/)

    const detail = await app.inject({ method: 'GET', url: '/api/keys/key-lin-1', headers: { cookie } })
    expect(detail.json().key).toMatchObject({ id: 'key-lin-1', secretAvailable: true, model: 'ecommerce-copy' })
    expect(detail.json().key.masked).toBe(reset.json().key.masked)
    const viewed = await app.inject({ method: 'GET', url: '/api/keys/key-lin-1/secret', headers: { cookie } })
    expect(viewed.json().secret).toBe(reset.json().secret)

    const replay = await app.inject({ method: 'POST', url: '/api/keys/key-lin-1/reset', headers: { cookie, 'x-csrf-token': csrfToken }, payload: body })
    expect(replay.statusCode).toBe(200)
    expect(replay.json()).toMatchObject({ key: { id: 'key-lin-1', masked: reset.json().key.masked }, secret: reset.json().secret, operation: { idempotent: true } })
    const reused = await app.inject({ method: 'POST', url: '/api/keys/key-zhou-1/reset', headers: { cookie, 'x-csrf-token': csrfToken }, payload: body })
    expect(reused.statusCode).toBe(409)
    expect(reused.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED')

    const audit = await app.inject({ method: 'GET', url: '/api/audit-events?period=7d&action=reset&resource=key', headers: { cookie } })
    expect(audit.statusCode).toBe(200)
    expect(audit.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'reset', resource: expect.objectContaining({ id: 'key-lin-1' }), changes: expect.arrayContaining([expect.objectContaining({ field: 'secret', sensitive: true })]) })]))
    expect(JSON.stringify(audit.json())).not.toContain(reset.json().secret)
    const withoutCsrf = await app.inject({ method: 'POST', url: '/api/keys/key-zhou-1/reset', headers: { cookie }, payload: { ...body, idempotencyKey: 'key-reset-5e6f7g8h' } })
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
    expect(newDetail.json().key.owner.initials).toBe('筱雨')
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
    expect(body.connection.baseUrl).toBe('http://127.0.0.1:4175/v1')
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

  it('adjusts only a local monthly soft quota with CSRF, idempotency, and a safe audit summary', async () => {
    const app = buildApp({ databasePath: ':memory:', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-demo' } })
    const cookie = cookieHeader(login.headers['set-cookie'])
    const csrfToken = cookieValue(login.headers['set-cookie'], 'ai_ops_csrf')
    const body = { targetPoints: 3000, idempotencyKey: 'quota-update-1a2b3c4d', reason: '本地演示大促活动需要提高月度提示阈值', acknowledgeImpact: true }
    const updated = await app.inject({ method: 'PATCH', url: '/api/limits/department-content', headers: { cookie, 'x-csrf-token': csrfToken }, payload: body })
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toMatchObject({
      meta: { source: 'database' }, policy: { id: 'quota-content-month', nodeId: 'department-content', level: 'department', targetPoints: 3000, mode: 'soft' },
      impact: { previousTargetPoints: 2600, used: 2540, reserved: 170, projectedPercent: 90.3 },
      operation: { idempotencyKey: body.idempotencyKey, idempotent: false, auditEventId: 'audit-quota-update-1a2b3c4d' },
    })

    const listed = await app.inject({ method: 'GET', url: '/api/limits', headers: { cookie } })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().items.find((item: { id: string }) => item.id === 'department-content').periods.find((period: { id: string }) => period.id === 'month')).toMatchObject({ limit: 3000, percent: 90.3 })
    expect(listed.json().hardMode).toMatchObject({ enabled: false, blocking: false })

    const replay = await app.inject({ method: 'PATCH', url: '/api/limits/department-content', headers: { cookie, 'x-csrf-token': csrfToken }, payload: body })
    expect(replay.statusCode).toBe(200)
    expect(replay.json()).toMatchObject({ impact: { previousTargetPoints: 2600, projectedPercent: 90.3 }, operation: { idempotent: true } })
    const changedTarget = await app.inject({ method: 'PATCH', url: '/api/limits/department-content', headers: { cookie, 'x-csrf-token': csrfToken }, payload: { ...body, targetPoints: 3100 } })
    expect(changedTarget.statusCode).toBe(409)
    expect(changedTarget.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    const reused = await app.inject({ method: 'PATCH', url: '/api/limits/department-ads', headers: { cookie, 'x-csrf-token': csrfToken }, payload: body })
    expect(reused.statusCode).toBe(409)
    expect(reused.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED')

    const audit = await app.inject({ method: 'GET', url: '/api/audit-events?period=7d&action=update&resource=quota', headers: { cookie } })
    expect(audit.statusCode).toBe(200)
    expect(audit.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'update', resource: expect.objectContaining({ id: 'quota-content-month', name: '内容运营 · 月度软目标' }), changes: [expect.objectContaining({ field: 'targetPoints', before: '2,600 点', after: '3,000 点', sensitive: false })] })]))
    expect(JSON.stringify({ updated: updated.json(), audit: audit.json() })).not.toContain(body.reason)

    const withoutCsrf = await app.inject({ method: 'PATCH', url: '/api/limits/department-ads', headers: { cookie }, payload: { ...body, idempotencyKey: 'quota-update-5e6f7g8h' } })
    expect(withoutCsrf.statusCode).toBe(403)
    const employeeLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'employee', password: 'employee-demo' } })
    const employeeWrite = await app.inject({ method: 'PATCH', url: '/api/limits/department-content', headers: { cookie: cookieHeader(employeeLogin.headers['set-cookie']), 'x-csrf-token': cookieValue(employeeLogin.headers['set-cookie'], 'ai_ops_csrf') }, payload: { ...body, idempotencyKey: 'quota-update-9i0j1k2l' } })
    expect(employeeWrite.statusCode).toBe(403)
  })

  it('returns isolated purpose routes without credential material', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/routes' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.meta.source).toBe('database')
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

  it('adjusts only local simulated route policy with CSRF, idempotency, audit, and group boundaries', async () => {
    const app = buildApp({ databasePath: ':memory:', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-demo' } })
    const cookie = cookieHeader(login.headers['set-cookie'])
    const csrfToken = cookieValue(login.headers['set-cookie'], 'ai_ops_csrf')
    const body = { onTimeout: 'fallback', onRateLimit: 'retry', onServerError: 'fallback', maxRetries: 3, idempotencyKey: 'route-update-1a2b3c4d', reason: '本地演示商品文案需要验证更稳妥的重试策略', acknowledgeImpact: true }
    const updated = await app.inject({ method: 'PATCH', url: '/api/routes/route-copy', headers: { cookie, 'x-csrf-token': csrfToken }, payload: body })
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toMatchObject({ meta: { source: 'database' }, route: { id: 'route-copy', policy: { onTimeout: 'fallback', onRateLimit: 'retry', onServerError: 'fallback', maxRetries: 3, crossGroupFallback: false, clientChannelOverride: false } }, operation: { idempotencyKey: body.idempotencyKey, idempotent: false, auditEventId: 'audit-route-update-1a2b3c4d' } })

    const listed = await app.inject({ method: 'GET', url: '/api/routes', headers: { cookie } })
    expect(listed.json().items.find((item: { id: string }) => item.id === 'route-copy')).toMatchObject({ policy: { onRateLimit: 'retry', onServerError: 'fallback', maxRetries: 3 }, primary: { group: 'production' }, fallbacks: [expect.objectContaining({ group: 'production' })] })
    const replay = await app.inject({ method: 'PATCH', url: '/api/routes/route-copy', headers: { cookie, 'x-csrf-token': csrfToken }, payload: body })
    expect(replay.statusCode).toBe(200)
    expect(replay.json().operation.idempotent).toBe(true)
    const changed = await app.inject({ method: 'PATCH', url: '/api/routes/route-copy', headers: { cookie, 'x-csrf-token': csrfToken }, payload: { ...body, maxRetries: 2 } })
    expect(changed.statusCode).toBe(409)
    expect(changed.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    const unavailableFallback = await app.inject({ method: 'PATCH', url: '/api/routes/route-pro-lab', headers: { cookie, 'x-csrf-token': csrfToken }, payload: { ...body, idempotencyKey: 'route-update-5e6f7g8h' } })
    expect(unavailableFallback.statusCode).toBe(400)
    expect(unavailableFallback.json().error.code).toBe('ROUTE_FALLBACK_UNAVAILABLE')
    const audit = await app.inject({ method: 'GET', url: '/api/audit-events?period=7d&action=update&resource=route', headers: { cookie } })
    expect(audit.statusCode).toBe(200)
    expect(audit.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ resource: expect.objectContaining({ id: 'route-copy', name: '商品文案 · ecommerce-copy' }), changes: expect.arrayContaining([expect.objectContaining({ field: 'maxRetries', before: '2 次', after: '3 次' })]) })]))
    expect(JSON.stringify({ updated: updated.json(), audit: audit.json() })).not.toContain(body.reason)

    const withoutCsrf = await app.inject({ method: 'PATCH', url: '/api/routes/route-service', headers: { cookie }, payload: { ...body, idempotencyKey: 'route-update-9i0j1k2l' } })
    expect(withoutCsrf.statusCode).toBe(403)
    const employeeLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'employee', password: 'employee-demo' } })
    const employeeWrite = await app.inject({ method: 'PATCH', url: '/api/routes/route-service', headers: { cookie: cookieHeader(employeeLogin.headers['set-cookie']), 'x-csrf-token': cookieValue(employeeLogin.headers['set-cookie'], 'ai_ops_csrf') }, payload: { ...body, idempotencyKey: 'route-update-3m4n5p6q' } })
    expect(employeeWrite.statusCode).toBe(403)
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

  it('records only a local synthetic channel check with CSRF, idempotency, and a safe audit summary', async () => {
    const app = buildApp({ databasePath: ':memory:', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-demo' } })
    const cookie = cookieHeader(login.headers['set-cookie'])
    const csrfToken = cookieValue(login.headers['set-cookie'], 'ai_ops_csrf')
    const body = { idempotencyKey: 'channel-check-1a2b3c4d', reason: '确认本地演示渠道健康状态与复检时间展示', acknowledgeSynthetic: true }
    const checked = await app.inject({ method: 'POST', url: '/api/channels/channel-official-cn-1/check', headers: { cookie, 'x-csrf-token': csrfToken }, payload: body })
    expect(checked.statusCode).toBe(200)
    expect(checked.json()).toMatchObject({ meta: { source: 'database' }, channel: { id: 'channel-official-cn-1', status: 'healthy', latencyMs: 1420, successRate: 99.6 }, operation: { idempotencyKey: body.idempotencyKey, idempotent: false, auditEventId: 'audit-channel-check-1a2b3c4d' } })
    expect(checked.json().channel.checkedAt).toMatch(/^2026-/)

    const listed = await app.inject({ method: 'GET', url: '/api/channels', headers: { cookie } })
    expect(listed.json().meta.notice).toContain('SQLite 本地模拟复检快照')
    expect(listed.json().items.find((item: { id: string }) => item.id === 'channel-official-cn-1')).toMatchObject({ checkedAt: checked.json().channel.checkedAt, status: 'healthy' })
    const replay = await app.inject({ method: 'POST', url: '/api/channels/channel-official-cn-1/check', headers: { cookie, 'x-csrf-token': csrfToken }, payload: body })
    expect(replay.statusCode).toBe(200)
    expect(replay.json().operation.idempotent).toBe(true)
    const reused = await app.inject({ method: 'POST', url: '/api/channels/channel-official-cn-2/check', headers: { cookie, 'x-csrf-token': csrfToken }, payload: body })
    expect(reused.statusCode).toBe(409)
    expect(reused.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    const audit = await app.inject({ method: 'GET', url: '/api/audit-events?period=7d&action=update&resource=channel', headers: { cookie } })
    expect(audit.statusCode).toBe(200)
    expect(audit.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ resource: expect.objectContaining({ id: 'channel-official-cn-1', name: 'Official CN · 01' }), result: { status: 'success', code: 'SYNTHETIC_CHECK_COMPLETED' } })]))
    expect(JSON.stringify({ checked: checked.json(), audit: audit.json() })).not.toContain(body.reason)

    const withoutCsrf = await app.inject({ method: 'POST', url: '/api/channels/channel-official-cn-2/check', headers: { cookie }, payload: { ...body, idempotencyKey: 'channel-check-5e6f7g8h' } })
    expect(withoutCsrf.statusCode).toBe(403)
    const employeeLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'employee', password: 'employee-demo' } })
    const employeeWrite = await app.inject({ method: 'POST', url: '/api/channels/channel-official-cn-2/check', headers: { cookie: cookieHeader(employeeLogin.headers['set-cookie']), 'x-csrf-token': cookieValue(employeeLogin.headers['set-cookie'], 'ai_ops_csrf') }, payload: { ...body, idempotencyKey: 'channel-check-9i0j1k2l' } })
    expect(employeeWrite.statusCode).toBe(403)
  })

  it('does not return removed simulated upstream accounts', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/upstreams' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.meta).toMatchObject({ source: 'live', live: { cpa: 'reachable' } })
    expect(body.summary).toMatchObject({ total: 0, available: 0, needsAttention: 0, official: 0, experiment: 0, configured: 0 })
    expect(body.items).toEqual([])
    expect(body.isolation).toMatchObject({ enforced: true, productionToExperimentFallback: false })
    expect(body.meta.notice).toContain('本地模拟账号已移除')
    expect(JSON.stringify(body)).not.toContain('New API')
    expect(JSON.stringify(body)).not.toMatch(/Bearer|accessToken|managementKey|apiKey|oauthToken|sk-[A-Za-z0-9_-]{8,}/i)
  })

  it('exposes the configured CPA gateway as a production upstream snapshot', async () => {
    const app = buildApp({
      authMode: 'disabled',
      databasePath: ':memory:',
      probeNewApi: reachableNewApi,
      probeCpa: async () => ({ state: 'reachable' as const, configured: true, models: ['gpt-5-codex'], latencyMs: 42, checkedAt: '2026-09-15T10:00:00.000Z' }),
      probeDocs: reachableService,
    })
    apps.push(app)
    const response = await app.inject({ method: 'GET', url: '/api/upstreams?type=cpa_oauth' })
    expect(response.statusCode).toBe(200)
    expect(response.json().meta.source).toBe('live')
    expect(response.json().items).toEqual([expect.objectContaining({
      id: 'upstream-cpa-gateway', name: 'CPA Codex OAuth', environment: 'production', status: 'healthy', models: ['gpt-5-codex'],
      health: expect.objectContaining({ latencyMs: 42 }), credentialConfigured: true,
    })])
    expect(response.json().summary).toMatchObject({ experiment: 0 })
  })

  it('filters upstream accounts and rejects unsupported account states', async () => {
    const filtered = await createApp().inject({ method: 'GET', url: '/api/upstreams?type=cpa_oauth&status=auth_required' })
    expect(filtered.statusCode).toBe(200)
    expect(filtered.json().items).toHaveLength(0)

    const invalid = await createApp().inject({ method: 'GET', url: '/api/upstreams?status=expired' })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error.code).toBe('INVALID_REQUEST')
  })

  it('does not expose operations for removed simulated upstream accounts', async () => {
    const app = buildApp({ databasePath: ':memory:', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-demo' } })
    const cookie = cookieHeader(login.headers['set-cookie'])
    const csrfToken = cookieValue(login.headers['set-cookie'], 'ai_ops_csrf')
    const body = { idempotencyKey: 'upstream-check-1a2b3c4d', reason: '确认真实上游账号状态与最近检查时间', acknowledgeSynthetic: true }
    const checked = await app.inject({ method: 'POST', url: '/api/upstreams/upstream-official-cn-1/check', headers: { cookie, 'x-csrf-token': csrfToken }, payload: body })
    expect(checked.statusCode).toBe(404)
    expect(checked.json().error.code).toBe('UPSTREAM_NOT_FOUND')
    const history = await app.inject({ method: 'GET', url: '/api/upstreams/upstream-official-cn-1/history', headers: { cookie } })
    expect(history.statusCode).toBe(404)
    expect(history.json().error.code).toBe('UPSTREAM_NOT_FOUND')
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

    const invalidEventId = await createApp().inject({ method: 'GET', url: '/api/audit-events?eventId=alert-not-an-audit-event' })
    expect(invalidEventId.statusCode).toBe(400)
    expect(invalidEventId.json().error.code).toBe('INVALID_REQUEST')
  })

  it('exports the current local audit view as a redacted CSV and records the export', async () => {
    const app = createApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/audit-events/export',
      payload: { period: '7d', search: '', eventId: '', actor: 'all', action: 'all', resource: 'all', result: 'all', source: 'all', page: 1, pageSize: 10 },
    })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toMatch(/text\/csv/i)
    expect(response.headers['content-disposition']).toMatch(/audit-export-\d{8}\.csv/)
    expect(response.body.startsWith('\uFEFFevent_id,occurred_at,actor')).toBe(true)
    expect(response.body).toContain('changed_fields')
    expect(response.body).not.toMatch(/Bearer|accessToken|managementKey|apiKey|oauthToken|密码|原因原文/i)

    const singleEvent = await app.inject({
      method: 'POST',
      url: '/api/audit-events/export',
      payload: { period: '7d', search: '', eventId: 'audit-key-rotate', actor: 'all', action: 'all', resource: 'all', result: 'all', source: 'all', page: 1, pageSize: 10 },
    })
    expect(singleEvent.statusCode).toBe(200)
    expect(singleEvent.headers['content-disposition']).toMatch(/audit-event-key-rotate-\d{8}\.csv/)
    expect(singleEvent.body).toContain('audit-key-rotate')

    const audit = await app.inject({ method: 'GET', url: '/api/audit-events?period=7d&action=export&resource=export&pageSize=50' })
    expect(audit.statusCode).toBe(200)
    expect(audit.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'export', resource: expect.objectContaining({ id: 'local-audit-csv' }), result: { status: 'success', code: 'AUDIT_CSV_EXPORTED' } }),
    ]))

    const secured = buildApp({ databasePath: ':memory:', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(secured)
    const adminLogin = await secured.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-demo' } })
    const adminCookie = cookieHeader(adminLogin.headers['set-cookie'])
    const missingCsrf = await secured.inject({ method: 'POST', url: '/api/audit-events/export', headers: { cookie: adminCookie }, payload: { period: '7d' } })
    expect(missingCsrf.statusCode).toBe(403)
    expect(missingCsrf.json().error.code).toBe('CSRF_INVALID')
    const employeeLogin = await secured.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'employee', password: 'employee-demo' } })
    const employeeCookie = cookieHeader(employeeLogin.headers['set-cookie'])
    const employeeExport = await secured.inject({ method: 'POST', url: '/api/audit-events/export', headers: { cookie: employeeCookie, 'x-csrf-token': cookieValue(employeeLogin.headers['set-cookie'], 'ai_ops_csrf') }, payload: { period: '7d' } })
    expect(employeeExport.statusCode).toBe(403)
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

  it('opens metadata-only details for CPA and New API events', async () => {
    const occurredAt = new Date().toISOString()
    const cpaLogReader: CpaLogReader = {
      path: 'fixture', configured: true,
      listLogs: () => [{ id: 'cpa-fixture-1', occurredAt, traceId: 'trace-cpa-fixture', statusCode: 200, durationMs: 18, clientIp: '10.20.30.*', method: 'GET', path: '/v1/models', fileName: 'main.log' }],
    }
    const newApiDatabase = {
      available: true as const, filename: 'fixture',
      listLogs: () => [{ id: 'new-api-fixture-1', userId: null, occurredAt, type: 2, username: 'fixture-user', tokenName: null, modelName: 'fixture-model', quota: 0, promptTokens: 3, completionTokens: 4, useTime: 21, streamed: false, channelId: '1', channelName: 'fixture-channel', tokenId: null, group: null, requestId: 'fixture-request', upstreamRequestId: 'trace-new-api-fixture' }],
    } as unknown as NewApiDatabaseReader
    const app = buildApp({ authMode: 'disabled', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService, cpaLogReader, newApiDatabase })
    apps.push(app)

    const listing = await app.inject({ method: 'GET', url: '/api/audit-events?period=today&sourceSystem=cpa&pageSize=10' })
    expect(listing.statusCode).toBe(200)
    const cpaEvent = listing.json().items[0]
    expect(cpaEvent).toMatchObject({ sourceSystem: 'cpa', contentAvailable: false, credentialValueAvailable: false })
    const cpaDetail = await app.inject({ method: 'GET', url: `/api/audit-events/${encodeURIComponent(cpaEvent.id)}` })
    expect(cpaDetail.statusCode).toBe(200)
    expect(cpaDetail.json()).toMatchObject({ event: { id: cpaEvent.id, sourceSystem: 'cpa', contentAvailable: false, credentialValueAvailable: false, transport: { traceId: 'trace-cpa-fixture' } }, integrity: { verified: false, algorithm: 'not_configured' }, relatedAuditIds: [] })
    expect(JSON.stringify(cpaDetail.json())).not.toMatch(/request body|response body|fixture-secret|Bearer/i)

    const cpaExport = await app.inject({
      method: 'POST', url: '/api/audit-events/export',
      payload: { period: 'today', search: '', eventId: cpaEvent.id, actor: 'all', action: 'all', resource: 'all', result: 'all', source: 'all', sourceSystem: 'cpa', page: 1, pageSize: 10 },
    })
    expect(cpaExport.statusCode).toBe(200)
    expect(cpaExport.headers['content-disposition']).toMatch(/audit-event-cpa-cpa-fixture-1-\d{8}\.csv/)
    expect(cpaExport.body).toContain(cpaEvent.id)
    expect(cpaExport.body).not.toMatch(/request body|response body|fixture-secret|Bearer/i)

    const newApiListing = await app.inject({ method: 'GET', url: '/api/audit-events?period=today&sourceSystem=new_api&pageSize=10' })
    expect(newApiListing.statusCode).toBe(200)
    const newApiEvent = newApiListing.json().items[0]
    expect(newApiEvent).toMatchObject({ sourceSystem: 'new_api', contentAvailable: false, credentialValueAvailable: false })
    const newApiDetail = await app.inject({ method: 'GET', url: `/api/audit-events/${encodeURIComponent(newApiEvent.id)}` })
    expect(newApiDetail.statusCode).toBe(200)
    expect(newApiDetail.json()).toMatchObject({ event: { id: newApiEvent.id, sourceSystem: 'new_api', contentAvailable: false, credentialValueAvailable: false, transport: { traceId: 'trace-new-api-fixture' } }, integrity: { verified: false, algorithm: 'not_configured' }, relatedAuditIds: [] })

    const newApiExport = await app.inject({
      method: 'POST', url: '/api/audit-events/export',
      payload: { period: 'today', search: '', eventId: newApiEvent.id, actor: 'all', action: 'all', resource: 'all', result: 'all', source: 'all', sourceSystem: 'new_api', page: 1, pageSize: 10 },
    })
    expect(newApiExport.statusCode).toBe(200)
    expect(newApiExport.headers['content-disposition']).toMatch(/audit-event-new-api-new-api-fixture-1-\d{8}\.csv/)
    expect(newApiExport.body).toContain(newApiEvent.id)
    expect(newApiExport.body).not.toMatch(/request body|response body|fixture-secret|Bearer/i)
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

  it('opens synthetic redacted turns directly and records the access', async () => {
    const app = createApp()
    const response = await app.inject({ method: 'POST', url: '/api/conversation-audits/conv-audit-copy-01/access', payload: {} })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.content).toMatchObject({ synthetic: true, decrypted: false })
    expect(body.access).toMatchObject({ reasonAccepted: true, persisted: true, authorizedByServerRbac: true, copyAllowed: false, exportAllowed: false, deleteAllowed: false, auditEventId: expect.stringMatching(/^audit-conversation-/) })
    expect(body.linkedUsage).toMatchObject({ auditRequestId: 'req-260915-8f31', usageRequestId: 'req-demo-001', metadataEndpoint: '/api/usage/req-demo-001', linkVerified: true, source: 'synthetic_seed' })
    expect(body.linkedUsage.notice).toMatch(/合成用量映射/)
    expect(body.content.messages.some((item: { redacted: boolean }) => item.redacted)).toBe(true)
    expect(JSON.stringify(body)).not.toContain('复核客户投诉关联请求与脱敏结果')

    const accessHistory = await app.inject({ method: 'GET', url: '/api/conversation-audits/conv-audit-copy-01/access-events' })
    expect(accessHistory.statusCode).toBe(200)
    expect(accessHistory.json()).toMatchObject({
      meta: { source: 'database' },
      record: { id: 'conv-audit-copy-01', requestId: 'req-260915-8f31' },
      items: [expect.objectContaining({ action: 'view_synthetic', reasonProvided: false, reasonLength: 0, acknowledgedSensitiveScope: false })],
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
    expect(accessAudit.id).toBe(body.access.auditEventId)
    expect(accessAudit.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'accessMode', after: '直接查看（超级管理员）', sensitive: false }),
      expect.objectContaining({ field: 'contentMode', after: '合成且预先脱敏', sensitive: false }),
    ]))

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

  it('supports local business-rule preview, draft, publish, rollback, and safe audit summaries', async () => {
    const database = createPlatformDatabase({ filename: ':memory:' })
    const app = buildApp({ database, authMode: 'disabled', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const initial = await app.inject({ method: 'GET', url: '/api/settings' })
    const state = initial.json().businessRules
    const values = state.items.map((item: { id: string; value: string }) => ({ id: item.id, value: item.id === 'currency' ? 'CNY · 额度点数' : item.value }))
    const preview = await app.inject({ method: 'POST', url: '/api/settings/business-rules/preview', payload: { values } })
    expect(preview.statusCode).toBe(200)
    expect(preview.json()).toMatchObject({ baseVersion: 'draft-v0.1', changedCount: 1, changes: [expect.objectContaining({ id: 'currency', before: 'CNY · 点数', after: 'CNY · 额度点数' })] })
    const draft = await app.inject({ method: 'POST', url: '/api/settings/business-rules/drafts', payload: { values, reason: '统一预算展示口径', acknowledgeSimulation: true, idempotencyKey: 'settings-business-draft-test-001' } })
    expect(draft.statusCode).toBe(200)
    expect(draft.json()).toMatchObject({ version: { status: 'draft', isCurrent: false, items: expect.arrayContaining([expect.objectContaining({ id: 'currency', value: 'CNY · 额度点数' })]) }, operation: { action: 'draft', idempotent: false } })
    const repeatDraft = await app.inject({ method: 'POST', url: '/api/settings/business-rules/drafts', payload: { values, reason: '统一预算展示口径', acknowledgeSimulation: true, idempotencyKey: 'settings-business-draft-test-001' } })
    expect(repeatDraft.statusCode).toBe(200)
    expect(repeatDraft.json().operation.idempotent).toBe(true)
    const draftId = draft.json().version.id as string
    const published = await app.inject({ method: 'POST', url: '/api/settings/business-rules/publish', payload: { versionId: draftId, reason: '评审通过预算展示口径', acknowledgeSimulation: true, idempotencyKey: 'settings-business-publish-test-001' } })
    expect(published.statusCode).toBe(200)
    expect(published.json()).toMatchObject({ version: { status: 'published', isCurrent: true }, operation: { action: 'publish', idempotent: false } })
    const rollback = await app.inject({ method: 'POST', url: '/api/settings/business-rules/rollback', payload: { versionId: 'business-rule-v0-1', reason: '回退到已验证的基础业务口径', acknowledgeSimulation: true, idempotencyKey: 'settings-business-rollback-test-001' } })
    expect(rollback.statusCode).toBe(200)
    expect(rollback.json()).toMatchObject({ version: { id: 'business-rule-v0-1', isCurrent: true, status: 'published' }, operation: { action: 'rollback' } })
    const finalSettings = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(finalSettings.json().businessRules).toMatchObject({ version: 'draft-v0.1', currentVersionId: 'business-rule-v0-1', items: expect.arrayContaining([expect.objectContaining({ id: 'currency', value: 'CNY · 点数' })]) })
    expect(database.tableCounts().businessRuleVersions).toBe(2)
    expect(JSON.stringify(database.listAuditEvents())).not.toContain('统一预算展示口径')
    expect(database.listAuditEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'draft', resourceType: 'business_rule_version', summary: expect.objectContaining({ reasonLength: 8, acknowledgedSimulation: true }) }),
      expect.objectContaining({ action: 'publish', resourceType: 'business_rule_version' }),
      expect.objectContaining({ action: 'rollback', resourceType: 'business_rule_version' }),
    ]))
    database.close()
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
