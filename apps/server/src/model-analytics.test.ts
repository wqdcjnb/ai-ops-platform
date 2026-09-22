import { describe, expect, it } from 'vitest'
import { createNewApiModelAnalytics, modelAnalyticsQuerySchema } from './model-analytics.js'
import type { NewApiLogRecord } from './new-api-database.js'

function log(overrides: Partial<NewApiLogRecord> = {}): NewApiLogRecord {
  return {
    id: '1', userId: 'u-1', occurredAt: '2026-09-21T10:15:00.000Z', type: 2, username: 'alice', tokenName: 'demo', modelName: 'gpt-5.5', quota: 12, promptTokens: 10, completionTokens: 4, useTime: 20, streamed: true, channelId: '1', channelName: 'CPA Codex', tokenId: 't-1', group: 'default', requestId: 'req-new-api-1', upstreamRequestId: null, ...overrides,
  }
}

describe('New API model analytics', () => {
  it('aggregates model calls by bucket and excludes administrative logs', () => {
    const result = createNewApiModelAnalytics({ listLogs: () => [
      log(),
      log({ id: '2', modelName: 'gpt-6-astra', occurredAt: '2026-09-21T10:59:00.000Z', quota: 3, promptTokens: 20, completionTokens: 5 }),
      log({ id: '3', type: 5, occurredAt: '2026-09-21T11:01:00.000Z', quota: 1, promptTokens: 0, completionTokens: 0 }),
      log({ id: '4', type: 1, modelName: null, occurredAt: '2026-09-21T11:02:00.000Z' }),
    ] }, modelAnalyticsQuerySchema.parse({ days: 1, timeGranularity: 'hour', username: '' }), new Date('2026-09-21T12:00:00.000Z'))

    expect(result.summary).toMatchObject({ totalCount: 3, totalQuota: 16, totalTokens: 39 })
    expect(result.models.map((item) => [item.modelName, item.count])).toEqual([['gpt-5.5', 2], ['gpt-6-astra', 1]])
    expect(result.series.map((item) => [item.bucket, item.modelName, item.count])).toEqual([
      ['2026-09-21T10:00:00.000Z', 'gpt-5.5', 1],
      ['2026-09-21T10:00:00.000Z', 'gpt-6-astra', 1],
      ['2026-09-21T11:00:00.000Z', 'gpt-5.5', 1],
    ])
  })

  it('supports a username filter and New API range values', () => {
    const query = modelAnalyticsQuerySchema.parse({ days: 7, timeGranularity: 'day', username: 'bob' })
    const result = createNewApiModelAnalytics({ listLogs: () => [
      log({ username: 'alice' }),
      log({ id: '2', username: 'Bob', occurredAt: '2026-09-20T10:15:00.000Z' }),
    ] }, query, new Date('2026-09-21T12:00:00.000Z'))

    expect(result.summary.totalCount).toBe(1)
    expect(result.meta.timeGranularity).toBe('day')
    expect(modelAnalyticsQuerySchema.safeParse({ days: 3, timeGranularity: 'hour', username: '' }).success).toBe(false)
  })
})
