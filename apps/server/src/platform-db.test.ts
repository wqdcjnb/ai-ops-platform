import { describe, expect, it } from 'vitest'
import { createPlatformDatabase, databaseStatusSchema, seedDemoData } from './platform-db.js'

describe('platform database migrations', () => {
  it('creates the core schema in an isolated in-memory database', () => {
    const database = createPlatformDatabase({ filename: ':memory:', now: () => new Date('2026-09-17T10:00:00.000Z') })
    expect(databaseStatusSchema.parse(database.status())).toMatchObject({ state: 'ready', migrationVersion: 14, checkedAt: '2026-09-17T10:00:00.000Z', sessionCleanup: { revokedRetentionHours: 24, lastRun: null }, auditChain: { algorithm: 'sha256', verified: true, hashChainVerified: true, checkpointVerified: true, eventCount: 0, firstInvalidEventId: null } })
    expect(database.status().tables).toEqual(expect.arrayContaining(['departments', 'users', 'api_keys', 'quota_policies', 'audit_events', 'audit_chain_checkpoints', 'usage_requests', 'alert_rules', 'alert_events', 'conversation_access_events', 'system_business_rules', 'system_feature_flags', 'system_role_definitions', 'system_retention_policies', 'system_backup_status', 'user_sessions', 'session_cleanup_runs']))
    database.migrate()
    expect(database.status().migrationVersion).toBe(14)
    database.close()
  })

  it('seeds repeatable organization roles, safe configuration summaries, and conversation-access metadata', () => {
    const database = createPlatformDatabase({ filename: ':memory:', now: () => new Date('2026-09-17T10:00:00.000Z') })
    const first = seedDemoData(database, new Date('2026-09-17T10:00:00.000Z'))
    const second = seedDemoData(database, new Date('2026-09-17T10:00:00.000Z'))
    expect(first).toEqual({ departments: 6, users: 20, apiKeys: 5, quotaPolicies: 6, auditEvents: 4, usageRequests: 12, alertRules: 8, alertEvents: 8, conversationAccessEvents: 0, businessRules: 5, featureFlags: 5, roleDefinitions: 5, retentionPolicies: 4, backupStatus: 1, userSessions: 0, sessionCleanupRuns: 0 })
    expect(second).toEqual(first)
    expect(database.findUserByUsername('demo-zhou')).toMatchObject({ id: 'person-zhou', role: 'employee', status: 'active' })
    expect(database.passwordMatches('demo-yan', 'demo-person-yan')).toBe(false)
    expect(database.listAuditEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'audit-key-rotate', resourceType: 'key', result: 'success', summary: expect.objectContaining({ sensitive: true }) }),
      expect.objectContaining({ id: 'audit-export-denied', resourceType: 'export', result: 'denied' }),
    ]))
    expect(database.verifyAuditChain()).toMatchObject({ algorithm: 'sha256', verified: true, hashChainVerified: true, checkpointVerified: true, eventCount: 4, firstInvalidEventId: null })
    expect(database.listUsageRequests()).toEqual(expect.arrayContaining([
      expect.objectContaining({ requestId: 'req-demo-001', maskedValue: 'sk-ops••••••7F2A', errorSummary: null }),
      expect.objectContaining({ requestId: 'req-demo-003', status: 'failed', errorCategory: 'rate_limit' }),
    ]))
    expect(database.listAlertEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'alert-error-global', status: 'open', source: 'error_rate', relatedRequestIds: [] }),
      expect.objectContaining({ id: 'alert-cpa-upstream', environment: 'experiment', source: 'upstream' }),
    ]))
    expect(database.listAlertRules()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'rule-upstream-failure', category: 'upstream', enabled: 1 }),
    ]))
    expect(database.listBusinessRules()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'timezone', version: 'draft-v0.1', status: 'fixed' }),
    ]))
    expect(database.listFeatureFlags()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'management-writes', enabled: 0, risk: 'high' }),
    ]))
    expect(database.getOrganizationSummary()).toMatchObject({ company: '新知科技', departments: 5, people: 12, roles: [
      expect.objectContaining({ id: 'super_admin', memberCount: 1, highPrivilege: true }),
      expect.objectContaining({ id: 'admin', memberCount: 2, highPrivilege: true }),
      expect.objectContaining({ id: 'department_lead', memberCount: 4, highPrivilege: false }),
      expect.objectContaining({ id: 'finance', memberCount: 1, highPrivilege: false }),
      expect.objectContaining({ id: 'employee', memberCount: 12, highPrivilege: false }),
    ] })
    expect(database.listRetentionPolicies()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'operation-audit', days: 365, cleanupState: 'unverified', minimumNecessary: 1 }),
      expect.objectContaining({ id: 'conversation-content', days: 7, cleanupState: 'not_configured', minimumNecessary: 1 }),
    ]))
    expect(database.getBackupStatus()).toMatchObject({
      configured: false, storageTargetConfigured: false, lastBackupAt: null, lastVerifiedAt: null,
      lastRestoreDrillAt: null, browserDownloadAllowed: false,
    })
    const access = database.recordConversationAccess({
      id: 'access-demo-test-01', actorUserId: 'user-super-admin', recordId: 'conv-audit-copy-01', requestId: 'req-conv-test-01',
      action: 'view_synthetic', reasonProvided: true, reasonLength: 18, acknowledgedSensitiveScope: true,
    }, new Date('2026-09-17T10:01:00.000Z'))
    expect(access).toMatchObject({ id: 'access-demo-test-01', occurredAt: '2026-09-17T10:01:00.000Z' })
    expect(database.listConversationAccessEvents()).toEqual([expect.objectContaining({
      id: 'access-demo-test-01', actorUserId: 'user-super-admin', recordId: 'conv-audit-copy-01', requestId: 'req-conv-test-01',
      action: 'view_synthetic', reasonProvided: 1, reasonLength: 18, acknowledgedSensitiveScope: 1,
    })])
    expect(database.listConversationAccessEvents()[0]).not.toHaveProperty('reason')
    expect(database.status().migrationVersion).toBe(14)
    database.close()
  })

  it('detects changes to the local audit hash chain and refuses new audit events', () => {
    const now = new Date('2026-09-17T10:00:00.000Z')
    const database = createPlatformDatabase({ filename: ':memory:', now: () => now })
    seedDemoData(database, now)
    database.appendAuditEvent({ id: 'audit-chain-append', actorUserId: 'user-super-admin', action: 'create', resourceType: 'person', resourceId: 'person-chain', result: 'success', requestId: 'req-audit-chain-01', summary: { message: '哈希链测试事件。' } }, now)
    const events = database.listAuditEvents()
    expect(events.find((event) => event.id === 'audit-chain-append')).toMatchObject({ previousHash: expect.stringMatching(/^[a-f0-9]{64}$/), eventHash: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(database.verifyAuditChain(now)).toMatchObject({ verified: true, hashChainVerified: true, checkpointVerified: true, eventCount: 5, firstInvalidEventId: null })

    const internals = database as unknown as { db: { prepare: (sql: string) => { run: (...values: unknown[]) => unknown } } }
    internals.db.prepare('UPDATE audit_events SET summary_json = ? WHERE id = ?').run('{invalid-json', 'audit-chain-append')
    expect(database.verifyAuditChain(now)).toMatchObject({ verified: false, hashChainVerified: false, checkpointVerified: true, eventCount: 5, firstInvalidEventId: 'audit-chain-append' })
    expect(database.listAuditEvents().find((event) => event.id === 'audit-chain-append')?.summary).toEqual({})
    expect(() => database.appendAuditEvent({ id: 'audit-chain-blocked', action: 'create', resourceType: 'person', result: 'success', requestId: 'req-audit-chain-02', summary: { message: '不应写入。' } }, now)).toThrow('AUDIT_CHAIN_INVALID:audit-chain-append')
    database.close()
  })

  it('commits synthetic conversation access metadata and its unified audit event together', () => {
    const now = new Date('2026-09-17T10:00:00.000Z')
    const database = createPlatformDatabase({ filename: ':memory:', now: () => now })
    seedDemoData(database, now)

    expect(() => database.recordConversationAccess({
      id: 'access-demo-atomic-01', actorUserId: 'user-super-admin', recordId: 'conv-audit-copy-01', requestId: 'req-conv-atomic-01',
      action: 'view_synthetic', reasonProvided: true, reasonLength: 18, acknowledgedSensitiveScope: true,
    }, now, {
      id: 'audit-login-success', actorUserId: 'user-super-admin', action: 'view', resourceType: 'conversation', resourceId: 'conv-audit-copy-01',
      result: 'success', requestId: 'req-audit-atomic-01', summary: { message: '重复审计 ID 使事务回滚。' },
    })).toThrow()

    expect(database.listConversationAccessEvents()).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'access-demo-atomic-01' }),
    ]))
    database.close()
  })

  it('detects deletion of the latest local audit event through the checkpoint', () => {
    const now = new Date('2026-09-17T10:00:00.000Z')
    const database = createPlatformDatabase({ filename: ':memory:', now: () => now })
    seedDemoData(database, now)
    database.appendAuditEvent({ id: 'audit-chain-tail', actorUserId: 'user-super-admin', action: 'create', resourceType: 'person', resourceId: 'person-tail', result: 'success', requestId: 'req-audit-tail-01', summary: { message: '尾部检查点测试事件。' } }, now)
    const internals = database as unknown as { db: { prepare: (sql: string) => { run: (...values: unknown[]) => unknown } } }
    internals.db.prepare('DELETE FROM audit_events WHERE id = ?').run('audit-chain-tail')
    expect(database.verifyAuditChain(now)).toMatchObject({ verified: false, hashChainVerified: true, checkpointVerified: false, eventCount: 4, firstInvalidEventId: 'audit-chain-tail' })
    expect(() => database.appendAuditEvent({ id: 'audit-chain-after-tail-delete', action: 'create', resourceType: 'person', result: 'success', requestId: 'req-audit-tail-02', summary: { message: '不应写入。' } }, now)).toThrow('AUDIT_CHAIN_INVALID:audit-chain-tail')
    database.close()
  })

  it('removes expired and old revoked session hashes while retaining active sessions', () => {
    const now = new Date('2026-09-18T12:00:00.000Z')
    const database = createPlatformDatabase({ filename: ':memory:', now: () => now })
    seedDemoData(database, now)
    const hash = (character: string) => character.repeat(64)
    database.createAuthSession({ id: 'session-expired', userId: 'user-super-admin', tokenHash: hash('a'), csrfTokenHash: hash('b'), expiresAt: '2026-09-18T11:59:59.000Z' }, now)
    database.createAuthSession({ id: 'session-revoked', userId: 'user-super-admin', tokenHash: hash('c'), csrfTokenHash: hash('d'), expiresAt: '2026-09-19T12:00:00.000Z' }, now)
    database.revokeAuthSession(hash('c'), new Date('2026-09-17T11:00:00.000Z'))
    database.createAuthSession({ id: 'session-active', userId: 'user-super-admin', tokenHash: hash('e'), csrfTokenHash: hash('f'), expiresAt: '2026-09-19T12:00:00.000Z' }, now)

    const cleanup = database.cleanupAuthSessions('startup', now)
    expect(cleanup).toMatchObject({ triggeredBy: 'startup', deletedExpired: 1, deletedRevoked: 1, revokedRetentionHours: 24 })
    expect(database.tableCounts()).toMatchObject({ userSessions: 1, sessionCleanupRuns: 1 })
    expect(database.findAuthSession(hash('e'), now)?.user.id).toBe('user-super-admin')
    expect(database.status().sessionCleanup).toMatchObject({ revokedRetentionHours: 24, lastRun: { triggeredBy: 'startup', deletedExpired: 1, deletedRevoked: 1 } })
    database.close()
  })
})
