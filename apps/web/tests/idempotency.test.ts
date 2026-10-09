import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { createIdempotencyKey } from '../src/idempotency.js'
import { createEmployeePortalKey, resetEmployeePortalKey } from '../src/employee-portal-api.js'
import { disablePerson, enablePerson, deletePerson, resetPersonPassword, resetPersonKey } from '../src/people-api.js'
import { personDisableBodySchema, personEnableBodySchema, personDeleteBodySchema, personPasswordResetBodySchema } from '../../server/src/people.js'

const nativeCrypto = globalThis.crypto
const uuidV4 = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'

function useLanHttpCrypto(t: TestContext) {
  // A regular HTTP LAN origin has getRandomValues, but no randomUUID method.
  t.mock.getter(globalThis, 'crypto', () => ({
    getRandomValues: nativeCrypto.getRandomValues.bind(nativeCrypto),
  }) as typeof globalThis.crypto)
}

test('HTTPS/localhost keeps the native UUID method and its Crypto receiver', (t) => {
  const uuid = '12345678-1234-4234-9234-123456789abc'
  const secureCrypto = {
    randomUUID() {
      assert.equal(this, secureCrypto)
      return uuid
    },
    getRandomValues() { assert.fail('Native UUID should be preferred') },
  }
  t.mock.getter(globalThis, 'crypto', () => secureCrypto as unknown as typeof globalThis.crypto)
  assert.equal(createIdempotencyKey('employee-key-create'), `employee-key-create-${uuid}`)
})

test('LAN HTTP creates unique UUID v4 request IDs without randomUUID or Math.random', (t) => {
  useLanHttpCrypto(t)
  t.mock.method(Math, 'random', () => { assert.fail('Must use cryptographically secure random bytes') })
  assert.equal(typeof globalThis.crypto.randomUUID, 'undefined')
  const keys = Array.from({ length: 1000 }, () => createIdempotencyKey('employee-key-create'))
  assert.equal(new Set(keys).size, keys.length)
  for (const key of keys) assert.match(key, new RegExp(`^employee-key-create-${uuidV4}$`))
})

test('LAN HTTP fallback sets version/variant bits and preserves leading zeroes', (t) => {
  t.mock.getter(globalThis, 'crypto', () => ({
    getRandomValues(bytes: Uint8Array) { return bytes.fill(0xff) },
  }) as unknown as typeof globalThis.crypto)
  assert.equal(createIdempotencyKey('test'), 'test-ffffffff-ffff-4fff-bfff-ffffffffffff')
  t.mock.restoreAll()
  t.mock.getter(globalThis, 'crypto', () => ({
    getRandomValues(bytes: Uint8Array) { return bytes.fill(0) },
  }) as unknown as typeof globalThis.crypto)
  assert.equal(createIdempotencyKey('test'), 'test-00000000-0000-4000-8000-000000000000')
})

test('unavailable secure randomness fails explicitly instead of using a weak fallback', (t) => {
  t.mock.getter(globalThis, 'crypto', () => undefined as unknown as typeof globalThis.crypto)
  assert.throws(() => createIdempotencyKey('employee-key-create'), /浏览器不支持安全随机数/)
})

test('employee create/reset really reach POST with valid request IDs on LAN HTTP', async (t) => {
  useLanHttpCrypto(t)
  const calls: Array<{ path: string; idempotencyKey: string }> = []
  const fixtureSecret = 'fixture-only-employee-api-key'
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    assert.equal(init?.method, 'POST')
    const path = String(input)
    const body = JSON.parse(String(init?.body)) as { idempotencyKey: string }
    assert.match(body.idempotencyKey, /^employee-key-(?:create|reset)-[A-Za-z0-9._:-]{8,96}$/)
    calls.push({ path, idempotencyKey: body.idempotencyKey })
    return Response.json({
      key: { id: 'key-fixture', masked: 'fixture-mask', status: 'active', createdAt: '2026-10-09T00:00:00Z', lastUsedAt: null },
      secret: fixtureSecret,
      model: { id: 'ai-ops', name: 'AI OPS' },
      gateway: { baseUrl: 'http://192.0.2.1:4175/v1' },
      requestId: 'req-fixture',
    }, { status: path.endsWith('/reset') ? 200 : 201 })
  })
  assert.equal((await createEmployeePortalKey()).secret, fixtureSecret)
  assert.equal((await resetEmployeePortalKey()).secret, fixtureSecret)
  assert.deepEqual(calls.map((call) => call.path), ['/api/me/key', '/api/me/key/reset'])
  assert.match(calls[0]!.idempotencyKey, new RegExp(`^employee-key-create-${uuidV4}$`))
  assert.match(calls[1]!.idempotencyKey, new RegExp(`^employee-key-reset-${uuidV4}$`))
  assert.notEqual(calls[0]!.idempotencyKey, calls[1]!.idempotencyKey)
})

test('all administrator personnel actions accept the LAN HTTP request IDs', async (t) => {
  useLanHttpCrypto(t)
  const calls: string[] = []
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    assert.equal(init?.method, 'POST')
    const path = String(input)
    const body = JSON.parse(String(init?.body))
    assert.match(body.idempotencyKey, new RegExp(`^person-(?:enable|disable|delete|password-reset|key-reset)-${uuidV4}$`))
    assert.equal(body.acknowledgeImpact, true)
    if (path.endsWith('/enable')) personEnableBodySchema.parse(body)
    if (path.endsWith('/disable')) personDisableBodySchema.parse(body)
    if (path.endsWith('/delete')) personDeleteBodySchema.parse(body)
    if (path.endsWith('/reset-password')) personPasswordResetBodySchema.parse(body)
    calls.push(path)
    return Response.json({
      meta: { source: 'database', completedAt: '2026-10-09T00:00:00Z', notice: 'fixture' },
      person: { id: 'person-fixture', name: '测试员工' },
      operation: { idempotencyKey: body.idempotencyKey, idempotent: false, auditEventId: 'audit-fixture' },
    })
  })
  const body = (prefix: string) => ({ idempotencyKey: createIdempotencyKey(prefix), acknowledgeImpact: true as const })
  await enablePerson('person-fixture', body('person-enable'))
  await disablePerson('person-fixture', body('person-disable'))
  await deletePerson('person-fixture', { ...body('person-delete'), reason: '' })
  await resetPersonPassword('person-fixture', body('person-password-reset'))
  await resetPersonKey('person-fixture', body('person-key-reset'))
  assert.deepEqual(calls, [
    '/api/people/person-fixture/enable', '/api/people/person-fixture/disable',
    '/api/people/person-fixture/delete', '/api/people/person-fixture/reset-password',
    '/api/people/person-fixture/reset-key',
  ])
})
