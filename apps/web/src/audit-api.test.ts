import { describe, expect, it } from 'vitest'
import { auditDetailResponseSchema, auditFiltersSchema, auditResponseSchema } from './audit-api'

const event = { id: 'audit-test', occurredAt: '2026-09-15T10:00:00.000Z', actor: { id: 'admin-1', name: '管理员', role: 'admin' }, action: 'rotate', actionLabel: '轮换 Key', resource: { type: 'key', id: 'key-1', name: 'sk-ops••••••1234' }, result: { status: 'success', code: 'KEY_ROTATED' }, source: { type: 'api', label: '管理接口', ipMasked: '127.0.0.*', client: 'Codex Desktop' }, requestId: 'req-audit-test', summary: '仅记录变化摘要', changes: [{ field: 'secret', label: '密钥内容', before: '已变化', after: '已变化', sensitive: true }], contentAvailable: false, credentialValueAvailable: false }
const meta = { source: 'demo', generatedAt: '2026-09-15T10:00:00.000Z', period: '7d', notice: '演示' }
const demoIntegrity = { deletionAllowed: false, appendOnlyVerified: false, verified: false, hashChainVerified: false, checkpointVerified: false, algorithm: 'not_configured', checkedAt: null, checkpointUpdatedAt: null, eventCount: 0, firstInvalidEventId: null, notice: '待验证' }

describe('audit API contracts', () => {
  it('validates filters and metadata-only audit events', () => {
    expect(auditFiltersSchema.safeParse({ period: '7d', search: '', eventId: 'audit-alert-ack-1a2b3c4d', actor: 'all', action: 'rotate', resource: 'key', result: 'success', source: 'api', page: 1, pageSize: 10 }).success).toBe(true)
    expect(auditFiltersSchema.safeParse({ period: '7d', search: '', actor: 'all', action: 'access', resource: 'authorization', result: 'denied', source: 'web', page: 1, pageSize: 10 }).success).toBe(true)
    expect(auditFiltersSchema.safeParse({ period: '7d', search: '', actor: 'all', action: 'view', resource: 'conversation', result: 'success', source: 'web', page: 1, pageSize: 10 }).success).toBe(true)
    expect(auditFiltersSchema.safeParse({ period: '90d', search: '', actor: 'all', action: 'delete', resource: 'key', result: 'success', source: 'api', page: 0, pageSize: 10 }).success).toBe(false)
    expect(auditFiltersSchema.safeParse({ period: '7d', search: '', eventId: 'alert-not-an-audit-event', actor: 'all', action: 'rotate', resource: 'key', result: 'success', source: 'api', page: 1, pageSize: 10 }).success).toBe(false)
    const response = { meta, summary: { total: 1, success: 1, failed: 0, denied: 0, sensitiveChanges: 1 }, options: { actors: [] }, items: [event], pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 }, retention: { mode: 'demo', deletionAllowed: false, appendOnlyVerified: false, notice: '待验证' }, integrity: demoIntegrity }
    expect(auditResponseSchema.safeParse(response).success).toBe(true)
    expect(auditResponseSchema.safeParse({ ...response, meta: { ...response.meta, source: 'database' }, retention: { ...response.retention, mode: 'database' } }).success).toBe(true)
    expect(auditResponseSchema.safeParse({ ...response, retention: { ...response.retention, deletionAllowed: true } }).success).toBe(false)
  })

  it('accepts a safe anonymous authentication-denial event', () => {
    const securityEvent = {
      ...event,
      id: 'audit-auth-test',
      actor: { id: 'anonymous', name: '未识别身份', role: 'system' },
      action: 'access', actionLabel: '访问被拒绝',
      resource: { type: 'authorization', id: 'authorization-check', name: '权限校验' },
      result: { status: 'denied', code: 'AUTH_REQUIRED' },
      source: { type: 'web', label: '管理控制台', ipMasked: null, client: '客户端信息未采集' },
      summary: '未建立有效本地会话的访问被拒绝；不记录 Cookie、令牌、查询参数或请求正文。',
      changes: [],
    }
    const integrity = { deletionAllowed: false, appendOnlyVerified: false, verified: true, hashChainVerified: true, checkpointVerified: true, algorithm: 'sha256', checkedAt: '2026-09-15T10:00:00.000Z', checkpointUpdatedAt: '2026-09-15T10:00:00.000Z', eventCount: 1, firstInvalidEventId: null, notice: '本地校验' }
    expect(auditResponseSchema.safeParse({ meta, summary: { total: 1, success: 0, failed: 0, denied: 1, sensitiveChanges: 0 }, options: { actors: [{ id: 'anonymous', label: '未识别身份' }] }, items: [securityEvent], pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 }, retention: { mode: 'database', deletionAllowed: false, appendOnlyVerified: false, notice: '待验证' }, integrity }).success).toBe(true)
  })

  it('requires safe detail boundaries and unverified integrity states', () => {
    const detail = { meta: { source: 'demo', generatedAt: '2026-09-15T10:00:00.000Z', notice: '演示' }, event, request: { requestId: 'req-audit-test', traceState: 'demo_unverified', responseCode: 200, durationMs: 80 }, integrity: demoIntegrity, relatedAuditIds: [] }
    expect(auditDetailResponseSchema.safeParse(detail).success).toBe(true)
    expect(auditDetailResponseSchema.safeParse({ ...detail, meta: { ...detail.meta, source: 'database' }, request: { ...detail.request, traceState: 'database_unverified' } }).success).toBe(true)
    expect(auditDetailResponseSchema.safeParse({ ...detail, event: { ...event, contentAvailable: true } }).success).toBe(false)
    expect(auditDetailResponseSchema.safeParse({ ...detail, integrity: { ...detail.integrity, verified: true, hashChainVerified: true, checkpointVerified: true, algorithm: 'sha256', checkedAt: '2026-09-15T10:00:00.000Z', checkpointUpdatedAt: '2026-09-15T10:00:00.000Z', eventCount: 1 } }).success).toBe(true)
  })
})
