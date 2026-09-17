import { describe, expect, it } from 'vitest'
import { conversationAccessResponseSchema, conversationAuditFiltersSchema, conversationAuditResponseSchema, conversationRecordSchema } from './conversation-audit-api'

const record = { id: 'conv-audit-test-01', requestId: 'req-conv-test-01', capturedAt: '2026-09-15T10:00:00.000Z', person: { id: 'person-1', name: '测试人员', department: '测试部门' }, key: { id: 'key-1', masked: 'sk-ops••••••1234' }, purpose: { id: 'purpose-1', label: '测试用途' }, model: { id: 'model-1', label: '测试模型' }, policy: { id: 'policy-1', label: '测试策略', scope: '指定 Key', expiresAt: '2026-09-16T10:00:00.000Z' }, state: 'captured', redaction: { status: 'passed', findings: 2, rawContentAvailable: false }, grouping: { type: 'conversation', reliable: true, label: '会话 test' }, metrics: { turns: 2, toolCalls: 0, totalTokens: 100 }, contentAccess: { available: true, requiresReason: true, requiredRole: 'super_admin' } }

describe('conversation audit API contracts', () => {
  it('validates metadata-only list boundaries and filters', () => {
    expect(conversationAuditFiltersSchema.safeParse({ period: '7d', search: '', person: 'all', key: 'all', purpose: 'all', model: 'all', policy: 'all', state: 'captured', redaction: 'passed', grouping: 'conversation', page: 1, pageSize: 10 }).success).toBe(true)
    expect(conversationAuditFiltersSchema.safeParse({ period: '90d', search: '', person: 'all', key: 'all', purpose: 'all', model: 'all', policy: 'all', state: 'deleted', redaction: 'passed', grouping: 'conversation', page: 0, pageSize: 10 }).success).toBe(false)
    expect(conversationRecordSchema.safeParse(record).success).toBe(true)
    expect(conversationRecordSchema.safeParse({ ...record, redaction: { ...record.redaction, rawContentAvailable: true } }).success).toBe(false)
    const response = { meta: { source: 'demo', generatedAt: '2026-09-15T10:00:00.000Z', period: '7d', notice: '演示' }, accessControl: { currentRole: 'super_admin', serverRbacVerified: true, contentRequiresReason: true, notice: '已验证' }, summary: { total: 1, captured: 1, metadataOnly: 0, expiringSoon: 0, independentCalls: 0, reviewRequired: 0 }, scope: { defaultCaptureEnabled: false, activePolicies: 1, nearestExpiryAt: '2026-09-16T10:00:00.000Z', storageEncryptedVerified: false, accessAuditPersisted: true, retention: { mode: 'metadata_only', proofRecords: 0, lastRunAt: null, notice: '待验证' }, notice: '待验证' }, options: { people: [], keys: [], purposes: [], models: [], policies: [] }, items: [record], pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 } }
    expect(conversationAuditResponseSchema.safeParse(response).success).toBe(true)
    expect(conversationAuditResponseSchema.safeParse({ ...response, meta: { ...response.meta, source: 'database' } }).success).toBe(true)
    expect(conversationAuditResponseSchema.safeParse({ ...response, scope: { ...response.scope, defaultCaptureEnabled: true } }).success).toBe(false)
  })

  it('accepts only synthetic redacted access results with risky actions disabled', () => {
    const access = { meta: { source: 'demo', generatedAt: '2026-09-15T10:00:00.000Z', notice: '演示' }, record, access: { accessRecordId: 'access-demo-test-01', reasonAccepted: true, persisted: true, authorizedByServerRbac: true, copyAllowed: false, exportAllowed: false, deleteAllowed: false }, content: { synthetic: true, decrypted: false, redactionPassed: true, conversationTitle: '演示会话', messages: [{ id: 'msg-1', role: 'user', label: '用户输入', occurredAt: '2026-09-15T10:00:00.000Z', text: '手机号已替换为 [PHONE_REDACTED]', redacted: true, redactionLabels: ['手机号'], tool: null }] }, retention: { expiresAt: '2026-09-16T10:00:00.000Z', cleanupState: 'scheduled', deletionProofAvailable: false, notice: '待验证' }, linkedUsage: { requestId: 'req-conv-test-01', metadataEndpoint: '/api/usage/req-conv-test-01', requestIdVerified: false } }
    expect(conversationAccessResponseSchema.safeParse(access).success).toBe(true)
    expect(conversationAccessResponseSchema.safeParse({ ...access, content: { ...access.content, decrypted: true } }).success).toBe(false)
    expect(conversationAccessResponseSchema.safeParse({ ...access, access: { ...access.access, copyAllowed: true } }).success).toBe(false)
  })
})
