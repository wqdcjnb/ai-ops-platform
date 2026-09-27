import { describe, expect, it } from 'vitest'
import { PlatformDatabase } from './platform-db.js'

function captureInput(requestId: string, startedAt: string, prompt = '重复请求') {
  return {
    id: `conv-audit-${requestId.replace(/^req-/u, '')}`,
    requestId,
    keyId: 'key-deduplication',
    externalTokenId: null,
    personId: 'person-deduplication',
    keyMasked: 'sk-test••••dedupe',
    purpose: '去重测试',
    model: 'ai-ops',
    endpoint: '/v1/chat/completions',
    startedAt,
    prompt: { model: 'ai-ops', messages: [{ role: 'user', content: prompt }], stream: true },
    streamed: true,
  }
}

describe('conversation audit retry deduplication', () => {
  it('keeps one audit record for a near-immediate identical retry, while retaining a later intentional repeat', () => {
    const database = new PlatformDatabase({ filename: ':memory:' })
    try {
      database.seedDepartment({ id: 'dept-deduplication', name: '去重测试部' })
      database.seedUser({
        id: 'person-deduplication',
        username: 'deduplication@example.com',
        displayName: '去重测试员',
        role: 'employee',
        roleLabel: '员工',
        password: 'test-password',
        departmentId: 'dept-deduplication',
      })
      database.seedApiKey({
        id: 'key-deduplication',
        ownerUserId: 'person-deduplication',
        maskedValue: 'sk-test••••dedupe',
        purpose: '去重测试',
        status: 'active',
        expiresAt: null,
        models: ['ai-ops'],
      })

      const firstStartedAt = '2026-09-27T08:00:00.000Z'
      const first = database.startConversationAuditCapture(captureInput('req-deduplication-first', firstStartedAt))
      const retry = database.startConversationAuditCapture(captureInput('req-deduplication-retry', '2026-09-27T08:00:05.000Z'))
      const distinct = database.startConversationAuditCapture(captureInput('req-deduplication-distinct', '2026-09-27T08:00:06.000Z', '这是另一条消息'))
      const laterRepeat = database.startConversationAuditCapture(captureInput('req-deduplication-later', '2026-09-27T08:00:16.000Z'))

      expect(first).toBe('conv-audit-deduplication-first')
      expect(retry).toBeNull()
      expect(distinct).toBe('conv-audit-deduplication-distinct')
      expect(laterRepeat).toBe('conv-audit-deduplication-later')
      expect(database.listConversationAuditRecords()).toHaveLength(3)
    } finally {
      database.close()
    }
  })

  it('retains a retry after the earlier identical request has completed with a failure', () => {
    const database = new PlatformDatabase({ filename: ':memory:' })
    try {
      database.seedDepartment({ id: 'dept-deduplication', name: '去重测试部' })
      database.seedUser({
        id: 'person-deduplication',
        username: 'deduplication@example.com',
        displayName: '去重测试员',
        role: 'employee',
        roleLabel: '员工',
        password: 'test-password',
        departmentId: 'dept-deduplication',
      })
      database.seedApiKey({
        id: 'key-deduplication',
        ownerUserId: 'person-deduplication',
        maskedValue: 'sk-test••••dedupe',
        purpose: '去重测试',
        status: 'active',
        expiresAt: null,
        models: ['ai-ops'],
      })

      const first = database.startConversationAuditCapture(captureInput('req-deduplication-failed', '2026-09-27T08:10:00.000Z'))
      database.completeConversationAuditCapture('req-deduplication-failed', {
        status: 'failed',
        completedAt: '2026-09-27T08:10:01.000Z',
        httpStatus: 502,
        captureError: '上游暂时不可用',
      })
      const retry = database.startConversationAuditCapture(captureInput('req-deduplication-recovered', '2026-09-27T08:10:05.000Z'))

      expect(first).toBe('conv-audit-deduplication-failed')
      expect(retry).toBe('conv-audit-deduplication-recovered')
      expect(database.listConversationAuditRecords()).toHaveLength(2)
    } finally {
      database.close()
    }
  })
})
