import { describe, expect, it } from 'vitest'
import { usageDetailResponseSchema, usageFiltersSchema, usageResponseSchema } from './usage-api'

const item = {
  requestId: 'req-test-1', occurredAt: '2026-09-15T10:00:00.000Z', person: { id: 'person-1', name: '人员' }, key: { id: 'key-1', masked: 'sk-aiops••••••1234' }, purpose: { id: 'ai-ops', name: 'AI OPS', alias: 'ai-ops' }, model: { id: 'ai-ops', displayName: 'AI OPS', actualModel: 'ai-ops' }, channel: { id: 'gateway-relay', name: '统一模型网关', type: 'official_api' as const }, protocol: 'responses' as const, streamed: true, tokens: { input: 10, output: 20, total: 30 }, points: 1,
  latency: { firstTokenMs: 100, totalMs: 500, aiOpsAuthMs: 10, contextCompactionMs: 0, upstreamFirstTokenMs: 90, upstreamTotalMs: 490 }, context: { originalChars: 40, forwardedChars: 40, droppedMessages: 0, strippedChars: 0 }, cost: { type: 'platform_estimate' as const, amountUsd: .01, label: '平台估算' }, status: 'succeeded' as const, error: null, conversationContentAvailable: false as const,
}
const list = { meta: { source: 'database' as const, simulated: false, generatedAt: '2026-09-15T10:00:00.000Z', period: '7d' as const, notice: '统一模型网关元数据' }, summary: { requests: 1, tokens: 30, points: 1, successRate: 100, p95LatencyMs: 500, costs: { platformEstimateUsd: .01 } }, options: { people: [], purposes: [], keys: [], models: [], channels: [] }, items: [item], pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 } }

describe('usage API contracts', () => {
  it('accepts only the platform estimate filter', () => {
    const base = { period: '7d', search: '', person: 'all', purpose: 'all', key: 'all', model: 'all', channel: 'all', status: 'all', page: 1, pageSize: 10 }
    expect(usageFiltersSchema.safeParse({ ...base, costType: 'platform_estimate' }).success).toBe(true)
    expect(usageFiltersSchema.safeParse({ ...base, costType: 'other' }).success).toBe(false)
  })

  it('validates metadata-only usage details', () => {
    expect(usageResponseSchema.safeParse(list).success).toBe(true)
    const detail = { meta: { source: 'database' as const, simulated: false, generatedAt: '2026-09-15T10:00:00.000Z', notice: '统一模型网关元数据' }, item, route: { alias: 'ai-ops', retryCount: 0, requestIdPropagated: true }, client: { name: 'Codex Desktop' as const, mode: 'stream' as const }, content: { stored: false as const, reason: '未采集正文' }, conversationAudit: { accessible: true, recordId: 'conv-audit-test-01', href: '/conversation-audit?recordId=conv-audit-test-01', source: 'gateway_capture' as const, notice: '已关联同一请求的对话审计记录。' } }
    expect(usageDetailResponseSchema.safeParse(detail).success).toBe(true)
    expect(usageDetailResponseSchema.safeParse({ ...detail, content: { stored: true, reason: '正文' } }).success).toBe(false)
  })
})
