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

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('BFF', () => {
  it('runs the platform database migration and reports its schema status', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/platform/database' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.state).toBe('ready')
    expect(body.migrationVersion).toBe(1)
    expect(body.tables).toEqual(expect.arrayContaining(['schema_migrations', 'users', 'api_keys', 'quota_policies', 'audit_events']))
  })

  it('requires a session for protected resources', async () => {
    const app = buildApp({ databasePath: ':memory:', probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const response = await app.inject({ method: 'GET', url: '/api/overview' })
    expect(response.statusCode).toBe(401)
    expect(response.json().error.code).toBe('AUTH_REQUIRED')
  })

  it('issues an HttpOnly session cookie and enforces role boundaries', async () => {
    const app = buildApp({ probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-demo' } })
    expect(login.statusCode).toBe(200)
    expect(login.headers['set-cookie']).toMatch(/ai_ops_session=.*HttpOnly/i)
    const cookie = login.headers['set-cookie']
    const settings = await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } })
    expect(settings.statusCode).toBe(200)

    const employeeLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'employee', password: 'employee-demo' } })
    const employeeCookie = employeeLogin.headers['set-cookie']
    const employeeAdminResource = await app.inject({ method: 'GET', url: '/api/people', headers: { cookie: employeeCookie } })
    expect(employeeAdminResource.statusCode).toBe(403)
    const employeeResource = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: employeeCookie } })
    expect(employeeResource.statusCode).toBe(200)
  })

  it('rejects invalid credentials without creating a session', async () => {
    const app = buildApp({ probeNewApi: reachableNewApi, probeCpa: reachableService, probeDocs: reachableService })
    apps.push(app)
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'wrong-password' } })
    expect(response.statusCode).toBe(401)
    expect(response.json().error.code).toBe('AUTH_INVALID')
    expect(response.headers['set-cookie']).toBeUndefined()
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
    expect(response.headers['x-request-id']).toBeTruthy()
  })

  it('returns a validated seven-day demo overview by default', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/overview' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.meta.source).toBe('demo')
    expect(body.meta.period).toBe('7d')
    expect(body.service).toEqual({ bff: 'healthy', newApi: await reachableNewApi() })
    expect(body.trend).toHaveLength(7)
    expect(body.limits).toEqual({ mode: 'soft', blocking: false })
  })

  it('reports the upstream integration state without exposing credentials', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/integrations/new-api/status' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(await reachableNewApi())
    expect(JSON.stringify(response.json())).not.toContain('token')
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

  it('returns configuration tasks without secret values', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/tasks/summary' })
    expect(response.statusCode).toBe(200)
    expect(response.json().source).toBe('configuration')
    expect(JSON.stringify(response.json())).not.toContain('Bearer')
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
    const cookie = login.headers['set-cookie']
    const created = await app.inject({ method: 'POST', url: '/api/people', headers: { cookie }, payload: { username: 'demo-new-person', displayName: '王小明', departmentId: 'content', password: 'demo-password-1' } })
    expect(created.statusCode).toBe(201)
    expect(created.json().person.displayName).toBe('王小明')

    const listed = await app.inject({ method: 'GET', url: '/api/people?search=王小明', headers: { cookie } })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().items[0]).toMatchObject({ name: '王小明', department: { id: 'content', name: '内容运营' }, title: '新加入成员' })

    const duplicate = await app.inject({ method: 'POST', url: '/api/people', headers: { cookie }, payload: { username: 'demo-new-person', displayName: '王小明二号', departmentId: 'content', password: 'demo-password-2' } })
    expect(duplicate.statusCode).toBe(409)
    expect(duplicate.json().error.code).toBe('USERNAME_CONFLICT')

    const employeeLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'employee', password: 'employee-demo' } })
    const employeeCreate = await app.inject({ method: 'POST', url: '/api/people', headers: { cookie: employeeLogin.headers['set-cookie'] }, payload: { username: 'employee-attempt', displayName: '越权员工', departmentId: 'content', password: 'demo-password-3' } })
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
    expect(body.meta.source).toBe('demo')
    expect(body.items).toHaveLength(2)
    expect(body.items.every((key: { masked: string; owner: { id: string } }) => key.owner.id === 'person-lin' && key.masked.includes('••••••'))).toBe(true)
    expect(JSON.stringify(body)).not.toMatch(/Bearer|accessToken|managementKey/i)
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
    expect(body.meta.source).toBe('demo')
    expect(new Set(body.items.map((item: { level: string }) => item.level))).toEqual(new Set(['company', 'department', 'person', 'purpose', 'key']))
    expect(body.items.every((item: { mode: string; periods: unknown[] }) => item.mode === 'soft' && item.periods.length === 4)).toBe(true)
    expect(body.hardMode).toMatchObject({ enabled: false, blocking: false })
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
    expect(body.meta).toMatchObject({ source: 'demo', period: '7d' })
    expect(body.items.length).toBeGreaterThan(0)
    expect(body.items.every((item: { status: string; conversationContentAvailable: boolean }) => item.status === 'failed' && item.conversationContentAvailable === false)).toBe(true)
    expect(body.summary.costs).toEqual(expect.objectContaining({ officialActualUsd: expect.any(Number), platformEstimateUsd: expect.any(Number), cpaEstimateUsd: expect.any(Number) }))
    expect(JSON.stringify(body)).not.toMatch(/Bearer|accessToken|managementKey|apiKey|oauthToken/i)

    const invalid = await createApp().inject({ method: 'GET', url: '/api/usage?costType=mixed&page=0' })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error.code).toBe('INVALID_REQUEST')
  })

  it('returns metadata-only usage detail and a stable missing-record error', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/usage/req-260915-8f31' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.item).toMatchObject({ requestId: 'req-260915-8f31', conversationContentAvailable: false })
    expect(body.content).toMatchObject({ stored: false })
    expect(body.route.requestIdPropagated).toBe(true)
    expect(body.item.key.masked).toContain('••••••')

    const missing = await createApp().inject({ method: 'GET', url: '/api/usage/req-missing-1' })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error.code).toBe('USAGE_NOT_FOUND')
    expect(missing.json().error.requestId).toBe(missing.headers['x-request-id'])
  })

  it('returns filterable alert events and explicit notification configuration state', async () => {
    const summary = await createApp().inject({ method: 'GET', url: '/api/alerts/summary' })
    expect(summary.statusCode).toBe(200)
    expect(summary.json().summary).toMatchObject({ open: 4, critical: 1, warning: 3, experiment: 2 })
    expect(summary.json().notificationConfig).toMatchObject({ configured: false })

    const response = await createApp().inject({ method: 'GET', url: '/api/alerts?severity=warning&status=open&environment=experiment&pageSize=10' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ id: 'alert-cpa-upstream', severity: 'warning', status: 'open', environment: 'experiment' })
    expect(JSON.stringify(body)).not.toMatch(/Bearer|accessToken|managementKey|apiKey|oauthToken|rawUpstreamBody/i)

    const invalid = await createApp().inject({ method: 'GET', url: '/api/alerts?severity=fatal' })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error.code).toBe('INVALID_REQUEST')
  })

  it('returns read-only alert rules and safe event details with stable missing errors', async () => {
    const rules = await createApp().inject({ method: 'GET', url: '/api/alert-rules' })
    expect(rules.statusCode).toBe(200)
    expect(rules.json().items).toHaveLength(6)
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
    expect(body.meta).toMatchObject({ source: 'demo', period: '7d' })
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ id: 'audit-key-rotate', contentAvailable: false, credentialValueAvailable: false })
    expect(body.items[0].changes[0]).toMatchObject({ before: '已变化', after: '已变化', sensitive: true })
    expect(body.retention).toMatchObject({ deletionAllowed: false, appendOnlyVerified: false })
    expect(JSON.stringify(body)).not.toMatch(/Bearer|accessToken|managementKey|apiKey|oauthToken|sk-[A-Za-z0-9_-]{8,}/i)

    const invalid = await createApp().inject({ method: 'GET', url: '/api/audit-events?action=delete&period=90d' })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error.code).toBe('INVALID_REQUEST')
  })

  it('returns audit detail without content or credentials and stable missing errors', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/audit-events/audit-route-failed' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.event).toMatchObject({ id: 'audit-route-failed', result: { status: 'failed' }, contentAvailable: false, credentialValueAvailable: false })
    expect(body.request).toMatchObject({ requestId: 'req-audit-route-12', traceState: 'demo_unverified' })
    expect(body.integrity).toMatchObject({ deletionAllowed: false, appendOnlyVerified: false, hashChainVerified: false })
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
    expect(body.meta).toMatchObject({ source: 'demo', period: '7d' })
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ id: 'conv-audit-independent-03', state: 'captured', grouping: { type: 'independent_call', reliable: false } })
    expect(body.items[0].redaction.rawContentAvailable).toBe(false)
    expect(body.scope).toMatchObject({ defaultCaptureEnabled: false, storageEncryptedVerified: false, accessAuditPersisted: false })
    expect(JSON.stringify(body)).not.toMatch(/Bearer|accessToken|managementKey|apiKey|oauthToken|rawPrompt|rawResponse/i)

    const invalid = await createApp().inject({ method: 'GET', url: '/api/conversation-audits?state=deleted&period=90d' })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error.code).toBe('INVALID_REQUEST')
  })

  it('requires a reason before returning synthetic redacted demo turns', async () => {
    const denied = await createApp().inject({ method: 'POST', url: '/api/conversation-audits/conv-audit-copy-01/access', payload: { reason: '太短', acknowledgeSensitiveScope: true } })
    expect(denied.statusCode).toBe(400)
    expect(denied.json().error.code).toBe('INVALID_REQUEST')

    const response = await createApp().inject({ method: 'POST', url: '/api/conversation-audits/conv-audit-copy-01/access', payload: { reason: '复核客户投诉关联请求与脱敏结果', acknowledgeSensitiveScope: true } })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.content).toMatchObject({ synthetic: true, decrypted: false })
    expect(body.access).toMatchObject({ reasonAccepted: true, persisted: false, authorizedByServerRbac: true, copyAllowed: false, exportAllowed: false, deleteAllowed: false })
    expect(body.content.messages.some((item: { redacted: boolean }) => item.redacted)).toBe(true)
    expect(JSON.stringify(body)).not.toContain('复核客户投诉关联请求与脱敏结果')

    const unavailable = await createApp().inject({ method: 'POST', url: '/api/conversation-audits/conv-audit-expired-05/access', payload: { reason: '复核历史记录的到期清理状态', acknowledgeSensitiveScope: true } })
    expect(unavailable.statusCode).toBe(404)
    expect(unavailable.json().error.code).toBe('CONVERSATION_CONTENT_UNAVAILABLE')
  })

  it('returns mixed-source read-only settings without credential values', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/api/settings' })
    const body = response.json()
    expect(response.statusCode).toBe(200)
    expect(body.meta.source).toBe('partial')
    expect(body.summary).toMatchObject({ sections: 6, roles: 5, servicesTotal: 4, enabledFeatures: 0, backupsVerified: 0 })
    expect(body.connections).toMatchObject({ source: 'live' })
    expect(body.connections.items.every((item: { credentialValueAvailable: boolean }) => item.credentialValueAvailable === false)).toBe(true)
    expect(body.features.items.every((item: { enabled: boolean; editable: boolean }) => item.enabled === false && item.editable === false)).toBe(true)
    expect(body.backup).toMatchObject({ configured: false, browserDownloadAllowed: false })
    expect(JSON.stringify(body)).not.toMatch(/Bearer|accessToken|managementKey|apiKey|oauthToken|password/i)
  })

  it('returns a self-scoped employee profile and masked personal Keys', async () => {
    const profile = await createApp().inject({ method: 'GET', url: '/api/me' })
    const keys = await createApp().inject({ method: 'GET', url: '/api/me/keys' })
    expect(profile.statusCode).toBe(200)
    expect(profile.json().scope).toMatchObject({ mode: 'self_demo', currentUserVerified: true, serverRbacVerified: true, otherPeopleAvailable: false })
    expect(profile.json().person).toMatchObject({ id: 'person-lin', role: 'employee' })
    expect(keys.statusCode).toBe(200)
    expect(keys.json().items).toHaveLength(2)
    expect(keys.json().items.every((item: { secretAvailable: boolean; rotateAvailable: boolean; masked: string }) => !item.secretAvailable && !item.rotateAvailable && item.masked.includes('••••••'))).toBe(true)
    expect(keys.json().connection).toMatchObject({ upstreamDetailsAvailable: false })
    expect(JSON.stringify({ profile: profile.json(), keys: keys.json() })).not.toMatch(/Bearer|accessToken|managementKey|apiKey|oauthToken|sk-[A-Za-z0-9_-]{8,}/i)
  })

  it('returns personal usage and business aliases while rejecting invalid periods', async () => {
    const usage = await createApp().inject({ method: 'GET', url: '/api/me/usage?period=30d' })
    const models = await createApp().inject({ method: 'GET', url: '/api/me/models' })
    expect(usage.statusCode).toBe(200)
    expect(usage.json().trend).toHaveLength(30)
    expect(usage.json().summary).toMatchObject({ softTarget: true, requestBlockingEnabled: false })
    expect(models.statusCode).toBe(200)
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
