import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLocalModelAnalytics, modelAnalyticsQuerySchema, type LocalModelAnalyticsRecord } from '../src/model-analytics.js'
import { modelAnalyticsResponseSchema as clientSchema } from '../../web/src/usage-api.js'

const now = new Date('2026-10-08T10:00:00Z')
type KeyUsage = LocalModelAnalyticsRecord & { keyId: string }
const usage = (patch: Partial<KeyUsage>): KeyUsage => ({
  requestId: 'req-example', occurredAt: '2026-10-08T09:00:00Z',
  personId: 'person-a', personName: '张三', keyId: 'key-original',
  modelId: 'model-a', inputTokens: 100, outputTokens: 50, ...patch,
})
const query = modelAnalyticsQuerySchema.parse({ days: 1 })

test('aggregates all Keys by owner, keeps namesakes separate, and ranks by total Tokens', () => {
  const result = createLocalModelAnalytics([
    usage({ requestId: 'req-old-key' }),
    usage({ requestId: 'req-new-key', keyId: 'key-rotated', modelId: 'model-b', inputTokens: 250, outputTokens: 100 }),
    usage({ requestId: 'req-namesake', personId: 'person-b', keyId: 'key-other', inputTokens: 900, outputTokens: 100 }),
  ], query, now)
  assert.deepEqual(result.people, [
    { personId: 'person-b', personName: '张三', count: 1, inputTokens: 900, outputTokens: 100, tokens: 1000 },
    { personId: 'person-a', personName: '张三', count: 2, inputTokens: 350, outputTokens: 150, tokens: 500 },
  ])
  assert.equal(result.people.reduce((sum, person) => sum + person.tokens, 0), result.summary.totalTokens)
  assert.equal(result.people.reduce((sum, person) => sum + person.count, 0), result.summary.totalCount)
  assert.deepEqual(clientSchema.parse(result).people, result.people)
  assert.ok(result.people.every((person) => !('keyId' in person)))
})

test('respects time and person filters without removing other people from the picker', () => {
  const result = createLocalModelAnalytics([
    usage({ requestId: 'req-a', occurredAt: '2026-10-07T10:00:00Z' }),
    usage({ requestId: 'req-b', personId: 'person-b', personName: '李四', occurredAt: now.toISOString() }),
    usage({ requestId: 'req-too-old', occurredAt: '2026-10-07T09:59:59Z' }),
    usage({ requestId: 'req-future', occurredAt: '2026-10-08T10:00:01Z' }),
    usage({ requestId: 'req-invalid', occurredAt: 'invalid' }),
  ], { ...query, person: 'person-a' }, now)
  assert.equal(result.people.length, 1)
  assert.equal(result.people[0]?.count, 1)
  assert.equal(result.summary.totalCount, 1)
  assert.deepEqual(new Set(result.options.people.map((person) => person.id)), new Set(['person-a', 'person-b']))
})

test('supports missing Token reports and empty results without inventing usage', () => {
  const result = createLocalModelAnalytics([
    usage({ inputTokens: undefined, outputTokens: null }),
    usage({ inputTokens: 'invalid', outputTokens: -100 }),
    usage({ inputTokens: '12', outputTokens: '8' }),
  ], query, now)
  assert.equal(result.people[0]?.tokens, 20)
  assert.equal(result.people[0]?.count, 3)
  const empty = createLocalModelAnalytics([], query, now)
  assert.deepEqual(empty.people, [])
  assert.deepEqual(empty.models, [])
  assert.equal(empty.summary.totalTokens, 0)
  assert.equal(empty.summary.totalCount, 0)
  assert.ok(clientSchema.safeParse(empty).success)
})

test('returns the complete ranking for 500 people, with deterministic ties', () => {
  const records = Array.from({ length: 500 }, (_, index) => usage({
    requestId: `req-${index}`, personId: `person-${String(index).padStart(3, '0')}`,
    personName: '测试员工', inputTokens: index % 2, outputTokens: 0,
  }))
  const result = createLocalModelAnalytics(records, query, now)
  assert.equal(result.people.length, 500)
  assert.equal(result.people[0]?.personId, 'person-001')
  assert.equal(result.people[249]?.personId, 'person-499')
  assert.equal(result.people[250]?.personId, 'person-000')
  assert.equal(result.summary.totalCount, 500)
  assert.equal(result.summary.totalTokens, 250)
})
