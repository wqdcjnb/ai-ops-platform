import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import pg from 'pg'
import { createPlatformDatabase, encryptPlatformApiKey, FINAL_SCHEMA, hashPlatformApiKey, type PlatformDatabase, type PlatformUsageRequestSeed } from '../src/platform-db.js'
import { createDatabaseModelAnalytics, createLocalModelAnalytics, modelAnalyticsQuerySchema } from '../src/model-analytics.js'
import { createExternalProviderRegistry } from '../src/external-providers.js'
import { ProviderStore } from '../src/provider-store.js'
import { RuntimeCoordinator } from '../src/runtime-coordinator.js'
import { buildApp } from '../src/app.js'

// Only explicit TEST_* URLs are accepted; tests never target live storage.
const testUrl = process.env.TEST_DATABASE_URL
const testRedis = process.env.TEST_REDIS_URL
const run = testUrl && testRedis ? test : test.skip
const rootPool = testUrl ? new pg.Pool({ connectionString: testUrl }) : null
after(async () => { await rootPool?.end() })

async function fixture(work: (db: PlatformDatabase, connectionString: string) => Promise<void>, filename = '__no_legacy_test_database__') {
  const schema = 'test_aiops_' + randomUUID().replaceAll('-', '')
  await rootPool!.query(`CREATE SCHEMA ${schema}`)
  const url = new URL(testUrl!); url.searchParams.set('options', '-c search_path=' + schema)
  let db: PlatformDatabase | undefined
  try {
    db = await createPlatformDatabase({ connectionString: url.toString(), filename })
    await work(db, url.toString())
  } finally {
    await db?.close()
    assert.match(schema, /^test_aiops_[a-f0-9]{32}$/)
    await rootPool!.query(`DROP SCHEMA ${schema} CASCADE`)
  }
}
const employee = { id: 'person-test', username: 'employee@example.test', displayName: '测试员工', role: 'employee' as const, roleLabel: '员工', password: 'test-only-password' }
function usage(id: string, overrides: Partial<PlatformUsageRequestSeed> = {}): PlatformUsageRequestSeed {
  return { requestId: id, occurredAt: new Date().toISOString(), ownerUserId: employee.id, apiKeyId: 'key-test', purpose: { id: 'test', name: 'test', alias: 'test' }, model: { id: 'model-test', displayName: 'model-test', actualModel: 'model-test' }, channel: { id: 'provider-test', name: '测试账号', type: 'official_api' }, tokens: { input: 100, output: 50 }, points: 0, latency: { firstTokenMs: 20, totalMs: 50 }, cost: { type: 'platform_estimate', amountUsd: 0 }, status: 'succeeded', routeAlias: 'ai-ops', client: { name: 'WorkBuddy', mode: 'non_stream' }, ...overrides }
}
function audit(id: string) { return { id: 'audit-' + id, action: 'access', resourceType: 'test', result: 'success' as const, summary: { test: true } } }

run('PostgreSQL concurrent transactions, audit hash chain, rollback and SQL usage aggregation', async () => fixture(async (db) => {
  await db.seedUser(employee)
  await db.seedApiKey({ id: 'key-test', ownerUserId: employee.id, maskedValue: 'sk-test••••', purpose: 'test', status: 'active', secretValue: 'test-key' })
  assert.equal((await db.findGatewayKey('test-key'))?.ownerUserId, employee.id)
  await Promise.all(Array.from({ length: 50 }, (_, i) => db.recordGatewayUsage(usage('req-test-' + i), audit('request-' + i))))
  assert.equal((await db.tableCounts()).usageRequests, 50)
  assert.equal((await db.verifyAuditChain()).verified, true)
  await assert.rejects(db.db.transaction(async () => { await db.seedUsageRequest(usage('req-rollback')); throw new Error('rollback') }))
  assert.equal((await db.tableCounts()).usageRequests, 50)
  const query = modelAnalyticsQuerySchema.parse({ days: 1 })
  const now = new Date()
  const records = await db.listUsageRequests()
  const expected = createLocalModelAnalytics(records.map((r) => ({ ...r, modelId: r.actualModel })), query, now)
  assert.deepEqual(await createDatabaseModelAnalytics(db, query, now), expected)
}))

run('Key rotation, session persistence and device ticket single claim across concurrent requests', async () => fixture(async (db, connectionString) => {
  await db.seedUser(employee)
  await db.seedApiKey({ id: 'key-test', ownerUserId: employee.id, maskedValue: 'old••••', purpose: 'test', status: 'active', secretValue: 'old-key' })
  await db.resetApiKey('key-test', { maskedValue: 'new••••', secretValue: 'new-key', secretHash: hashPlatformApiKey('new-key') }, { ...audit('reset'), resourceId: 'key-test' })
  assert.equal(await db.findGatewayKey('old-key'), null)
  assert.equal(await db.readApiKeySecret('key-test'), 'new-key')
  await db.createAuthSession({ id: 'session-test', userId: employee.id, tokenHash: 'session-hash', csrfTokenHash: 'csrf-hash', expiresAt: new Date(Date.now() + 60_000).toISOString() })
  const second = await createPlatformDatabase({ connectionString, filename: '__no_legacy_test_database__' })
  try { assert.equal((await second.findAuthSession('session-hash'))?.user.id, employee.id) } finally { await second.close() }
  await db.createDeviceSetupTicket({ id: 'ticket-test', tokenHash: 'ticket-hash', ownerUserId: employee.id, apiKeyId: 'key-test', target: 'workbuddy', expiresAt: new Date(Date.now() + 60_000).toISOString() })
  const claims = await Promise.all(Array.from({ length: 12 }, () => db.claimDeviceSetupTicket('ticket-hash')))
  assert.equal(claims.filter((r) => r.state === 'claimed').length, 1)
  assert.equal(claims.filter((r) => r.secret).length, 1)
}))

run('Provider rows preserve other accounts and reject lost updates/deleted account resurrection', async () => fixture(async (db) => {
  const a = new ProviderStore<{ id: string; name: string }>(db.db)
  await a.save({ id: 'a', name: 'first' })
  await a.save({ id: 'b', name: 'second' })
  await a.save({ id: 'a', name: 'updated' }, 1)
  await assert.rejects(a.save({ id: 'a', name: 'stale' }, 1), /CONCURRENT/)
  await a.remove('a', 2)
  await assert.rejects(a.save({ id: 'a', name: 'resurrect' }, 2), /CONCURRENT/)
  assert.deepEqual((await a.list()).map((r) => r.configuration), [{ id: 'b', name: 'second' }])
}))

run('SQLite and encrypted provider migration preserves data and is repeatable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aiops-migration-test-'))
  const filename = join(directory, 'platform.sqlite')
  const { DatabaseSync } = await import('node:sqlite')
  const sqlite = new DatabaseSync(filename)
  sqlite.exec(FINAL_SCHEMA.replaceAll('INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY', 'INTEGER PRIMARY KEY AUTOINCREMENT').replaceAll('DOUBLE PRECISION', 'REAL'))
  const now = new Date().toISOString()
  sqlite.prepare('INSERT INTO schema_migrations VALUES (1,?,?)').run('final_ai_ops_schema_20260927', now)
  sqlite.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)').run(employee.id, employee.username, employee.displayName, 'employee', 'legacy-password-hash', 'active', now, now)
  sqlite.prepare('INSERT INTO api_keys VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('key-test', employee.id, 'sk••••', hashPlatformApiKey('preserved-key'), encryptPlatformApiKey('preserved-key'), 'test', 'active', null, null, now, now)
  sqlite.close()
  const providersFile = join(directory, 'external-providers.json')
  await writeFile(providersFile, JSON.stringify({ version: 1, providers: [{ id: 'test-provider', name: '测试供应商', baseUrl: 'https://example.test/v1', apiKey: encryptPlatformApiKey('provider-secret'), enabled: true, models: [{ upstreamId: 'text-model', publicId: 'text-model', modalities: ['text'] }], createdAt: now, updatedAt: now }], updatedAt: now }))
  try {
    await fixture(async (db, connectionString) => {
      assert.equal(await db.readApiKeySecret('key-test'), 'preserved-key')
      assert.equal((await db.findPerson(employee.id))?.displayName, employee.displayName)
      const registry = await createExternalProviderRegistry({ database: db.db, filePath: providersFile })
      assert.equal(registry.list().length, 1)
      assert.equal(registry.listPlatformRoutes()[0]?.apiKey, 'provider-secret')
      const reopened = await createPlatformDatabase({ connectionString, filename })
      try { assert.equal((await reopened.tableCounts()).users, 1) } finally { await reopened.close() }
      assert.equal((await db.db.query('SELECT COUNT(*) AS count FROM external_providers')).rows[0].count, '1')
    }, filename)
    const source = new DatabaseSync(filename, { readOnly: true })
    try { assert.equal(source.prepare('SELECT COUNT(*) AS count FROM users').get()!.count, 1) } finally { source.close() }
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir())))
    assert.match(directory.split(/[\\/]/).at(-1)!, /^aiops-migration-test-/)
    await rm(directory, { recursive: true })
  }
})

run('Redis enforces shared concurrency atomically, releases leases and shares RPM counters', async () => {
  const a = new RuntimeCoordinator(testRedis), b = new RuntimeCoordinator(testRedis)
  await Promise.all([a.initialize(), b.initialize()])
  const key = 'test-' + randomUUID()
  try {
    const leases = await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 ? a : b).acquire([{ key, limit: 3 }])))
    assert.equal(leases.filter(Boolean).length, 3)
    await Promise.all(leases.filter(Boolean).map((release) => release!()))
    const again = await b.acquire([{ key, limit: 3 }]); assert.ok(again); await again()
    assert.equal(await a.rateLimit(key, 1, 1000), true)
    assert.equal(await b.rateLimit(key, 1, 1000), false)
  } finally { await Promise.all([a.close(), b.close()]) }
})

run('Existing HTTP contracts: registration, login, employee Key and administrator pages', async () => fixture(async (db) => {
  process.env.NODE_ENV = 'test'
  process.env.REDIS_URL = testRedis
  const app = await buildApp({ database: db, authMode: 'required' })
  try {
    assert.equal((await app.inject('/health')).statusCode, 200)
    const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { realName: employee.displayName, email: employee.username, password: employee.password } })
    assert.equal(registered.statusCode, 201, registered.body)
    const cookies = registered.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
    const me = await app.inject({ url: '/api/me/key', headers: { cookie: cookies } })
    assert.equal(me.statusCode, 200, me.body)
    const employeeHeaders = { cookie: cookies, 'x-csrf-token': registered.cookies.find((cookie) => cookie.name === 'ai_ops_csrf')!.value }
    const issued = await app.inject({ method: 'POST', url: '/api/me/key', headers: employeeHeaders, payload: { idempotencyKey: 'employee-key-create-' + randomUUID() } })
    assert.equal(issued.statusCode, 201, issued.body)
    const oldSecret = issued.json().secret
    assert.ok(await db.findGatewayKey(oldSecret))
    const reset = await app.inject({ method: 'POST', url: '/api/me/key/reset', headers: employeeHeaders, payload: { idempotencyKey: 'employee-key-reset-' + randomUUID() } })
    assert.equal(reset.statusCode, 200, reset.body)
    assert.equal(await db.findGatewayKey(oldSecret), null)
    assert.ok(await db.findGatewayKey(reset.json().secret))
    assert.equal((await app.inject({ url: '/api/people', headers: { cookie: cookies } })).statusCode, 403)
    const admin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@aiops.local', password: 'test-admin-password' } })
    assert.equal(admin.statusCode, 200, admin.body)
    const adminCookies = admin.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
    const resetByAdmin = await app.inject({ method: 'POST', url: `/api/people/${registered.json().user.id}/reset-key`, headers: { cookie: adminCookies, 'x-csrf-token': admin.cookies.find((cookie) => cookie.name === 'ai_ops_csrf')!.value }, payload: { idempotencyKey: 'person-key-reset-' + randomUUID(), acknowledgeImpact: true } })
    assert.equal(resetByAdmin.statusCode, 200, resetByAdmin.body)
    assert.equal(await db.findGatewayKey(reset.json().secret), null)
    const shownAgain = await app.inject({ url: '/api/me/key', headers: { cookie: cookies } })
    assert.ok(await db.findGatewayKey(shownAgain.json().secret), 'Key remains readable after administrator rotation')
    for(const url of ['/api/people', '/api/usage/model-analytics', '/api/audit-events', '/api/conversation-audits', '/api/external-providers', '/api/system/status']) {
      const response = await app.inject({ url, headers: { cookie: adminCookies } })
      assert.equal(response.statusCode, 200, url + ': ' + response.body)
    }
  } finally { await app.close() }
}))

run('Real HTTP streaming, actual-model audit, title suppression, media retry safety and provider refresh', async () => fixture(async (db) => {
  process.env.NODE_ENV = 'test'
  process.env.REDIS_URL = testRedis
  let generated = 0, mediaCalls = 0
  const upstream = createServer(async (request, response) => {
    if(request.url === '/v1/models') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'mock-text', capabilities: ['text'] }, { id: 'mock-image', capabilities: ['image'] }] })); return }
    const parts: Buffer[] = []
    for await(const part of request) parts.push(Buffer.from(part))
    const payload = JSON.parse(Buffer.concat(parts).toString())
    if(request.url === '/v1/images/generations') { mediaCalls++; response.statusCode = 500; response.end('{}'); return }
    if(request.url !== '/v1/chat/completions') { response.statusCode = 404; response.end('{}'); return }
    generated++
    assert.equal(payload.model, 'mock-text')
    if(payload.stream) {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for(const text of ['测试', '回复']) { response.write(`data: ${JSON.stringify({ id: 'mock', model: 'actual-model', choices: [{ delta: { content: text } }] })}\n\n`); await delay(10) }
      response.end('data: [DONE]\n\n')
    } else {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ id: 'mock', object: 'chat.completion', created: 1, model: 'actual-model', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '测试回复' } }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }))
    }
  })
  await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done))
  const address = upstream.address() as { port: number }
  const registry = await createExternalProviderRegistry({ database: db.db, allowInsecureLoopback: true, filePath: '__no_providers_fixture__' })
  let app: Awaited<ReturnType<typeof buildApp>> | undefined
  try {
    const provider = await registry.createVerified({ name: '本机测试账号', baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'fixture-upstream-key', modelIds: ['mock-text', 'mock-image'], enabled: true })
    await db.seedUser(employee)
    await db.seedApiKey({ id: 'key-test', ownerUserId: employee.id, maskedValue: 'sk-test••••', purpose: 'test', status: 'active', secretValue: 'fixture-platform-key' })
    app = await buildApp({ database: db, externalProviderRegistry: registry })
    const base = await app.listen({ host: '127.0.0.1', port: 0 })
    const call = (stream: boolean, messages: unknown[], path = '/v1/chat/completions') => fetch(base + path, { method: 'POST', headers: { authorization: 'Bearer fixture-platform-key', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'ai-ops', messages, stream, prompt: 'test' }) })
    const stream = await call(true, [{ role: 'user', content: 'stream fixture' }])
    assert.equal(stream.status, 200)
    const output = await stream.text()
    assert.ok(output.includes('测试') && output.includes('回复') && output.includes('[DONE]'), output)
    assert.ok(output.includes('ai-ops') && !output.includes('actual-model'))
    for(let attempt = 0;attempt < 100;attempt++) {
      if((await db.listConversationAuditRecords())[0]?.auditStatus === 'succeeded') break
      await delay(10)
    }
    let records = await db.listConversationAuditRecords()
    assert.equal(records.length, 1)
    assert.equal(records[0]?.actualModel, 'actual-model')
    assert.equal(records[0]?.auditStatus, 'succeeded')
    assert.equal((await db.getConversationAuditContent(records[0]!.id))?.chunks.length, 2)
    const title = await call(false, [{ role: 'system', content: 'Generate a title and return JSON with isNewTopic and title.' }, { role: 'user', content: 'title fixture' }])
    assert.equal(title.status, 200, await title.text())
    assert.equal((await db.listConversationAuditRecords()).length, 1)
    await (await call(false, [], '/v1/images/generations')).text()
    assert.equal(mediaCalls, 1, 'Failed media jobs must not be automatically duplicated')
    assert.equal(generated, 2)
    const other = await createExternalProviderRegistry({ database: db.db, allowInsecureLoopback: true, filePath: '__no_providers_fixture__' })
    await other.setEnabled(provider.id, false)
    await registry.refresh(true)
    assert.equal(registry.listPlatformRoutes().length, 0)
    assert.equal((await db.verifyAuditChain()).verified, true)
  } finally {
    await app?.close()
    await new Promise<void>((done, reject) => upstream.close((error) => error ? reject(error) : done()))
  }
}))

run('Concurrent duplicate captures stay singular and deleted/expired content cannot be recreated', async () => fixture(async (db) => {
  await db.seedUser(employee)
  await db.seedApiKey({ id: 'key-test', ownerUserId: employee.id, maskedValue: 'sk-test••••', purpose: 'test', status: 'active', secretValue: 'fixture-platform-key' })
  const inputs = Array.from({ length: 10 }, (_, i) => ({ id: 'conv-audit-test-' + i, requestId: 'req-test-' + i, personId: employee.id, keyId: 'key-test', keyMasked: 'sk-test••••', purpose: 'test', model: 'ai-ops', endpoint: '/v1/chat/completions', prompt: { messages: [{ role: 'user', content: 'same prompt' }] }, streamed: true, startedAt: new Date().toISOString() }))
  const captures = await Promise.all(inputs.map((input) => db.startConversationAuditCapture(input)))
  assert.equal(captures.filter(Boolean).length, 1)
  const record = captures.find(Boolean)!
  await db.deleteConversationAuditRecord(record.id, { ...audit('delete-capture'), actorUserId: employee.id })
  assert.equal(await db.completeConversationAuditCapture(record.requestId, { status: 'succeeded', completedAt: new Date().toISOString(), response: 'late response' }), null)
  await db.checkpointConversationChunks(record.id, [{ text: 'late checkpoint' }])
  assert.equal((await db.db.query('SELECT count(*) AS count FROM conversation_audit_contents')).rows[0].count, '0')
  const expired = await db.startConversationAuditCapture({ ...inputs[0]!, id: 'conv-audit-expired', requestId: 'req-expired', retentionUntil: new Date(Date.now() - 1000).toISOString() })
  const cleanup = await db.cleanupConversationAuditMetadata('scheduled')
  assert.equal(cleanup.expiredRecords, 1)
  assert.equal(await db.completeConversationAuditCapture(expired!.requestId, { status: 'succeeded', completedAt: new Date().toISOString(), response: 'late response' }), null)
}))
