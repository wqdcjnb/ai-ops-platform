import { describe, expect, it } from 'vitest'
import { conversationAccessHistoryResponseSchema, conversationAccessResponseSchema, conversationAuditFiltersSchema, conversationAuditResponseSchema, conversationDeleteBodySchema, conversationDeleteResponseSchema, conversationRecordSchema } from './conversation-audit-api'

const record = { id: 'conv-audit-test-01', requestId: 'req-conv-test-01', capturedAt: '2026-09-15T10:00:00.000Z', person: { id: 'person-1', name: '测试人员' }, key: { id: 'key-1', masked: 'sk-ops••••••1234' }, purpose: { id: 'purpose-1', label: '测试用途' }, model: { id: 'model-1', label: '测试模型', actualModel: 'gpt-4.1-2025-04-14' }, policy: { id: 'policy-1', label: '测试策略', scope: '指定 Key', expiresAt: '2026-09-16T10:00:00.000Z' }, state: 'captured', grouping: { type: 'conversation', reliable: true, label: '会话 test' }, metrics: { turns: 2, toolCalls: 0, totalTokens: 100 }, contentAccess: { available: true, requiresReason: true, requiredRole: 'super_admin' } }

describe('conversation audit API contracts', () => {
  it('validates the simplified list filters and content references', () => {
    expect(conversationAuditFiltersSchema.safeParse({ period: '7d', search: '', person: 'all', key: 'all', purpose: 'all', model: 'all', policy: 'all', page: 1, pageSize: 10 }).success).toBe(true)
    expect(conversationAuditFiltersSchema.safeParse({ period: '90d', search: '', person: 'all', key: 'all', purpose: 'all', model: 'all', policy: 'all', page: 0, pageSize: 10 }).success).toBe(false)
    expect(conversationRecordSchema.safeParse(record).success).toBe(true)
    expect(conversationRecordSchema.safeParse({ ...record, promptAvailable: true }).success).toBe(false)
    const response = { meta: { source: 'database', generatedAt: '2026-09-15T10:00:00.000Z', period: '7d', notice: '当前无正文' }, accessControl: { currentRole: 'super_admin', serverRbacVerified: true, contentRequiresReason: true, notice: '已验证' }, summary: { total: 1, captured: 1, metadataOnly: 0, expiringSoon: 0, independentCalls: 0 }, scope: { defaultCaptureEnabled: false, activePolicies: 0, nearestExpiryAt: '2026-09-16T10:00:00.000Z', storageEncryptedVerified: false, accessAuditPersisted: true, retention: { mode: 'metadata_only', proofRecords: 0, lastRunAt: null, notice: '待验证' }, notice: '待验证' }, options: { people: [], keys: [], purposes: [], models: [], policies: [] }, items: [record], pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 } }
    expect(conversationAuditResponseSchema.safeParse(response).success).toBe(true)
    expect(conversationAuditResponseSchema.safeParse({ ...response, meta: { ...response.meta, source: 'other' } }).success).toBe(false)
    expect(conversationAuditResponseSchema.safeParse({ ...response, scope: { ...response.scope, defaultCaptureEnabled: true } }).success).toBe(false)
  })

  it('accepts encrypted real access results and blocks malformed content', () => {
    const access = { meta: { source: 'database', generatedAt: '2026-09-15T10:00:00.000Z', notice: '真实采集' }, record, access: { accessRecordId: 'access-test-01', auditEventId: 'audit-conversation-test-01', reasonAccepted: true, persisted: true, authorizedByServerRbac: true, copyAllowed: true, exportAllowed: true, deleteAllowed: false }, content: { decrypted: true, conversationTitle: '真实会话', messages: [{ id: 'msg-1', role: 'user', label: '用户输入', occurredAt: '2026-09-15T10:00:00.000Z', text: '已脱敏内容', tool: null }] }, retention: { expiresAt: '2026-09-16T10:00:00.000Z', cleanupState: 'scheduled', deletionProofAvailable: false, notice: '待验证' }, linkedUsage: { auditRequestId: 'req-conv-test-01', usageRequestId: 'req-usage-001', metadataEndpoint: '/api/usage/req-usage-001', linkVerified: true, source: 'gateway_capture', notice: '真实映射' } }
    expect(conversationAccessResponseSchema.safeParse(access).success).toBe(true)
    expect(conversationAccessResponseSchema.safeParse({ ...access, content: { ...access.content, decrypted: false } }).success).toBe(false)
    expect(conversationAccessResponseSchema.safeParse({ ...access, linkedUsage: { ...access.linkedUsage, source: 'other' } }).success).toBe(false)

    const deletePayload = { idempotencyKey: 'conversation-delete-test-12345678', acknowledgeImpact: true }
    expect(conversationDeleteBodySchema.safeParse(deletePayload).success).toBe(true)
    expect(conversationDeleteBodySchema.safeParse({ ...deletePayload, acknowledgeImpact: false }).success).toBe(false)
    expect(conversationDeleteResponseSchema.safeParse({ meta: { source: 'database', completedAt: '2026-09-15T10:03:00.000Z', notice: '已删除' }, record: { id: record.id, requestId: record.requestId, state: 'deleted' }, operation: { idempotencyKey: deletePayload.idempotencyKey, idempotent: false, auditEventId: 'audit-conversation-delete-test-01' } }).success).toBe(true)

    const history = { meta: { source: 'database', generatedAt: '2026-09-15T10:00:00.000Z', notice: '访问记录' }, record: { id: record.id, requestId: record.requestId }, items: [{ id: 'access-test-01', actorName: '超级管理员', requestId: record.requestId, action: 'view', reasonProvided: true, reasonLength: 18, acknowledgedSensitiveScope: true, occurredAt: '2026-09-15T10:02:00.000Z' }] }
    expect(conversationAccessHistoryResponseSchema.safeParse(history).success).toBe(true)
    expect(conversationAccessHistoryResponseSchema.safeParse({ ...history, items: [{ ...history.items[0], reasonLength: -1 }] }).success).toBe(false)
    expect(conversationAccessHistoryResponseSchema.safeParse({ ...history, items: Array.from({ length: 6 }, (_, index) => ({ ...history.items[0], id: `access-${index}` })) }).success).toBe(false)
  })
})
