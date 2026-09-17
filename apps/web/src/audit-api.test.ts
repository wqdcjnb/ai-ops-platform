import { describe, expect, it } from 'vitest'
import { auditDetailResponseSchema, auditFiltersSchema, auditResponseSchema } from './audit-api'

const event = { id: 'audit-test', occurredAt: '2026-09-15T10:00:00.000Z', actor: { id: 'admin-1', name: '管理员', role: 'admin' }, action: 'rotate', actionLabel: '轮换 Key', resource: { type: 'key', id: 'key-1', name: 'sk-ops••••••1234' }, result: { status: 'success', code: 'KEY_ROTATED' }, source: { type: 'api', label: '管理接口', ipMasked: '127.0.0.*', client: 'Codex Desktop' }, requestId: 'req-audit-test', summary: '仅记录变化摘要', changes: [{ field: 'secret', label: '密钥内容', before: '已变化', after: '已变化', sensitive: true }], contentAvailable: false, credentialValueAvailable: false }
const meta = { source: 'demo', generatedAt: '2026-09-15T10:00:00.000Z', period: '7d', notice: '演示' }

describe('audit API contracts', () => {
  it('validates filters and metadata-only audit events', () => {
    expect(auditFiltersSchema.safeParse({ period: '7d', search: '', actor: 'all', action: 'rotate', resource: 'key', result: 'success', source: 'api', page: 1, pageSize: 10 }).success).toBe(true)
    expect(auditFiltersSchema.safeParse({ period: '90d', search: '', actor: 'all', action: 'delete', resource: 'key', result: 'success', source: 'api', page: 0, pageSize: 10 }).success).toBe(false)
    const response = { meta, summary: { total: 1, success: 1, failed: 0, denied: 0, sensitiveChanges: 1 }, options: { actors: [] }, items: [event], pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 }, retention: { mode: 'demo', deletionAllowed: false, appendOnlyVerified: false, notice: '待验证' } }
    expect(auditResponseSchema.safeParse(response).success).toBe(true)
    expect(auditResponseSchema.safeParse({ ...response, meta: { ...response.meta, source: 'database' }, retention: { ...response.retention, mode: 'database' } }).success).toBe(true)
    expect(auditResponseSchema.safeParse({ ...response, retention: { ...response.retention, deletionAllowed: true } }).success).toBe(false)
  })

  it('requires safe detail boundaries and unverified integrity states', () => {
    const detail = { meta: { source: 'demo', generatedAt: '2026-09-15T10:00:00.000Z', notice: '演示' }, event, request: { requestId: 'req-audit-test', traceState: 'demo_unverified', responseCode: 200, durationMs: 80 }, integrity: { deletionAllowed: false, appendOnlyVerified: false, hashChainVerified: false, notice: '待验证' }, relatedAuditIds: [] }
    expect(auditDetailResponseSchema.safeParse(detail).success).toBe(true)
    expect(auditDetailResponseSchema.safeParse({ ...detail, meta: { ...detail.meta, source: 'database' }, request: { ...detail.request, traceState: 'database_unverified' } }).success).toBe(true)
    expect(auditDetailResponseSchema.safeParse({ ...detail, event: { ...event, contentAvailable: true } }).success).toBe(false)
    expect(auditDetailResponseSchema.safeParse({ ...detail, integrity: { ...detail.integrity, hashChainVerified: true } }).success).toBe(false)
  })
})
