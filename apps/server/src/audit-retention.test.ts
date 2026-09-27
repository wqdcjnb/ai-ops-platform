import { describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import { PlatformDatabase } from './platform-db.js'

function seedEmployee(database: PlatformDatabase) {
  database.seedUser({
    id: 'person-audit-retention',
    username: 'audit-retention@example.com',
    displayName: '审计保留测试员',
    role: 'employee',
    roleLabel: '员工',
    password: 'test-password',
    status: 'disabled',
  })
  database.seedApiKey({
    id: 'key-audit-retention',
    ownerUserId: 'person-audit-retention',
    maskedValue: 'sk-test••••retention',
    purpose: '审计保留测试',
    status: 'active',
    secretValue: 'audit-retention-key',
  })
}

describe('system audit retention', () => {
  it('removes events older than 30 days, reseals the retained chain, and preserves deletion state', () => {
    const database = new PlatformDatabase({ filename: ':memory:' })
    try {
      seedEmployee(database)
      database.seedAuditEvent({
        id: 'audit-retention-old',
        actorUserId: null,
        action: 'verify',
        resourceType: 'service',
        resourceId: 'old-check',
        result: 'success',
        requestId: 'req-retention-old',
        summary: { message: '旧记录' },
      }, new Date('2026-08-01T00:00:00.000Z'))
      database.seedAuditEvent({
        id: 'audit-retention-recent',
        actorUserId: null,
        action: 'verify',
        resourceType: 'service',
        resourceId: 'recent-check',
        result: 'success',
        requestId: 'req-retention-recent',
        summary: { message: '近期记录' },
      }, new Date('2026-09-20T00:00:00.000Z'))

      const deletion = database.deletePerson('person-audit-retention', {
        id: 'audit-delete-person-retention',
        actorUserId: null,
        action: 'delete',
        resourceType: 'person',
        resourceId: 'person-audit-retention',
        result: 'success',
        requestId: 'req-delete-person-retention',
        summary: { message: '删除测试人员' },
      }, new Date('2026-09-20T00:00:00.000Z'))
      expect(deletion?.state).toBe('deleted')

      const cleanup = database.cleanupAuditEvents('startup', new Date('2026-09-27T00:00:00.000Z'))
      expect(cleanup).toMatchObject({ deletedEvents: 1, retainedEvents: 2 })
      const retainedIds = database.listAuditEvents().map((event) => event.id)
      expect(retainedIds).toHaveLength(2)
      expect(retainedIds).toEqual(expect.arrayContaining([
        'audit-delete-person-retention',
        'audit-retention-recent',
      ]))
      expect(database.verifyAuditChain().verified).toBe(true)

      database.clearAuditEvents()
      expect(database.listAuditEvents()).toEqual([])
      expect(database.verifyAuditChain().verified).toBe(true)
      expect(database.listPeople()).not.toContainEqual(expect.objectContaining({ id: 'person-audit-retention' }))
      expect(database.listApiKeys()).not.toContainEqual(expect.objectContaining({ id: 'key-audit-retention' }))
    } finally {
      database.close()
    }
  })

  it('purges every local conversation-audit relationship before an explicit cutoff', () => {
    const database = new PlatformDatabase({ filename: ':memory:' })
    try {
      seedEmployee(database)
      const capture = (id: string, requestId: string, startedAt: string) => {
        database.startConversationAuditCapture({
          id,
          requestId,
          keyId: 'key-audit-retention',
          personId: 'person-audit-retention',
          keyMasked: 'sk-test••••retention',
          purpose: '审计保留测试',
          model: 'ai-ops',
          endpoint: '/v1/chat/completions',
          startedAt,
          prompt: { messages: [{ role: 'user', content: '保留测试' }] },
          streamed: false,
        })
        database.completeConversationAuditCapture(requestId, {
          status: 'succeeded',
          completedAt: new Date(new Date(startedAt).getTime() + 1_000).toISOString(),
          httpStatus: 200,
          response: { choices: [{ message: { role: 'assistant', content: '完成' } }] },
        })
      }

      capture('conv-audit-retention-old', 'req-conversation-retention-old', '2026-09-26T15:59:00.000Z')
      capture('conv-audit-retention-new', 'req-conversation-retention-new', '2026-09-26T16:00:00.000Z')

      const result = database.purgeConversationAuditRecordsBefore('2026-09-26T16:00:00.000Z')
      expect(result).toMatchObject({ deletedRecords: 1, deletedContents: 1 })
      expect(database.listConversationAuditRecords().map((record) => record.id)).toEqual(['conv-audit-retention-new'])
      expect(database.getConversationAuditContent('conv-audit-retention-old')).toBeNull()
    } finally {
      database.close()
    }
  })

  it('runs audit retention during application startup', async () => {
    const database = new PlatformDatabase({ filename: ':memory:' })
    database.seedAuditEvent({
      id: 'audit-startup-expired',
      actorUserId: null,
      action: 'verify',
      resourceType: 'service',
      resourceId: 'startup-check',
      result: 'success',
      requestId: 'req-startup-expired',
      summary: { message: '启动前到期记录' },
    }, new Date('2000-01-01T00:00:00.000Z'))
    const app = buildApp({ database, authMode: 'disabled' })
    try {
      expect(database.listAuditEvents()).toEqual([])
    } finally {
      await app.close()
      database.close()
    }
  })
})
