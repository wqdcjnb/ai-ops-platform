import { describe, expect, it } from 'vitest'
import { createPlatformDatabase, databaseStatusSchema, seedDemoData } from './platform-db.js'

describe('platform database migrations', () => {
  it('creates the core schema in an isolated in-memory database', () => {
    const database = createPlatformDatabase({ filename: ':memory:', now: () => new Date('2026-09-17T10:00:00.000Z') })
    expect(databaseStatusSchema.parse(database.status())).toMatchObject({ state: 'ready', migrationVersion: 21, checkedAt: '2026-09-17T10:00:00.000Z', sessionCleanup: { revokedRetentionHours: 24, lastRun: null }, auditChain: { algorithm: 'sha256', verified: true, hashChainVerified: true, checkpointVerified: true, eventCount: 0, firstInvalidEventId: null } })
    expect(database.status().tables).toEqual(expect.arrayContaining(['departments', 'users', 'api_keys', 'quota_policies', 'route_policy_overrides', 'channel_health_snapshots', 'person_model_policies', 'audit_events', 'audit_chain_checkpoints', 'usage_requests', 'alert_rules', 'alert_events', 'conversation_access_events', 'conversation_audit_records', 'conversation_audit_cleanup_runs', 'conversation_audit_expiry_proofs', 'conversation_usage_links', 'system_business_rules', 'business_rule_versions', 'system_feature_flags', 'system_retention_policies', 'system_backup_status', 'user_sessions', 'session_cleanup_runs']))
    database.migrate()
    expect(database.status().migrationVersion).toBe(21)
    database.close()
  })

  it('seeds repeatable organization roles, safe configuration summaries, and conversation-access metadata', () => {
    const database = createPlatformDatabase({ filename: ':memory:', now: () => new Date('2026-09-17T10:00:00.000Z') })
    const first = seedDemoData(database, new Date('2026-09-17T10:00:00.000Z'))
    const second = seedDemoData(database, new Date('2026-09-17T10:00:00.000Z'))
    expect(first).toEqual({ departments: 6, users: 20, apiKeys: 5, quotaPolicies: 6, routePolicyOverrides: 0, channelHealthSnapshots: 0, auditEvents: 4, usageRequests: 12, alertRules: 8, alertEvents: 8, conversationAccessEvents: 0, conversationAuditRecords: 7, conversationAuditCleanupRuns: 0, conversationAuditExpiryProofs: 0, conversationUsageLinks: 7, businessRules: 5, businessRuleVersions: 1, featureFlags: 5, roleDefinitions: 5, retentionPolicies: 4, backupStatus: 1, userSessions: 0, sessionCleanupRuns: 0 })
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
    expect(database.listConversationAuditRecords()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'conv-audit-copy-01', state: 'captured', personName: '林筱雨', keyMasked: 'sk-ops••••••7F2A', contentAccessAvailable: 1 }),
      expect.objectContaining({ id: 'conv-audit-metadata-04', state: 'metadata_only', contentAccessAvailable: 0 }),
    ]))
    expect(database.getConversationUsageLink('conv-audit-copy-01')).toEqual({ usageRequestId: 'req-demo-001', linkSource: 'synthetic_seed' })
    expect(database.getConversationUsageLink('conv-audit-missing')).toBeNull()
    expect(database.getUsageConversationLink('req-demo-001')).toEqual({ recordId: 'conv-audit-copy-01', linkSource: 'synthetic_seed' })
    expect(database.getUsageConversationLink('req-demo-missing')).toBeNull()
    expect(JSON.stringify(database.listConversationAuditRecords())).not.toMatch(/rawPrompt|rawResponse|viewReason|reasonText/i)
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
    expect(database.listConversationAccessEvents('conv-audit-copy-01')).toHaveLength(1)
    expect(database.listConversationAccessEvents('conv-audit-support-02')).toEqual([])
    expect(database.status().migrationVersion).toBe(21)
    database.close()
  })

  it('keeps a locally adjusted monthly soft target when demo seeds run again', () => {
    const now = new Date('2026-09-17T10:00:00.000Z')
    const database = createPlatformDatabase({ filename: ':memory:', now: () => now })
    seedDemoData(database, now)
    const updated = database.updateMonthlySoftQuotaPolicy({ id: 'quota-content-month', level: 'department', subjectId: 'content', targetPoints: 3000 }, {
      id: 'audit-quota-update-persist-test', actorUserId: 'user-super-admin', action: 'update', resourceType: 'quota', resourceId: 'quota-content-month',
      result: 'success', requestId: 'req-quota-persist-test', summary: { idempotencyFingerprint: 'test-fingerprint', previousTargetPoints: 2600, message: '本地软目标测试调整。' },
    }, now)
    expect(updated).toMatchObject({ targetPoints: 3000, previousTargetPoints: 2600, idempotent: false })
    seedDemoData(database, now)
    expect(database.listQuotaPolicies().find((item) => item.id === 'quota-content-month')).toMatchObject({ targetPoints: 3000, mode: 'soft' })
    expect(database.verifyAuditChain(now)).toMatchObject({ verified: true, eventCount: 5 })
    database.close()
  })

  it('keeps a locally adjusted route policy when demo seeds run again', () => {
    const now = new Date('2026-09-17T10:00:00.000Z')
    const database = createPlatformDatabase({ filename: ':memory:', now: () => now })
    seedDemoData(database, now)
    const updated = database.updateRoutePolicyOverride({ routeId: 'route-copy', onTimeout: 'fallback', onRateLimit: 'retry', onServerError: 'fallback', maxRetries: 3 }, {
      id: 'audit-route-update-persist-test', actorUserId: 'user-super-admin', action: 'update', resourceType: 'route', resourceId: 'route-copy',
      result: 'success', requestId: 'req-route-persist-test', summary: { idempotencyFingerprint: 'route-test-fingerprint', message: '本地路由策略测试调整。' },
    }, now)
    expect(updated).toMatchObject({ routeId: 'route-copy', onRateLimit: 'retry', maxRetries: 3, idempotent: false })
    seedDemoData(database, now)
    expect(database.listRoutePolicyOverrides()).toEqual([expect.objectContaining({ routeId: 'route-copy', onServerError: 'fallback', maxRetries: 3 })])
    expect(database.verifyAuditChain(now)).toMatchObject({ verified: true, eventCount: 5 })
    database.close()
  })

  it('keeps a local synthetic channel health snapshot when demo seeds run again', () => {
    const now = new Date('2026-09-17T10:00:00.000Z')
    const database = createPlatformDatabase({ filename: ':memory:', now: () => now })
    seedDemoData(database, now)
    const checked = database.recordSyntheticChannelCheck({ channelId: 'channel-official-cn-1', status: 'healthy', latencyMs: 1420, successRate: 99.6 }, {
      id: 'audit-channel-check-persist-test', actorUserId: 'user-super-admin', action: 'update', resourceType: 'channel', resourceId: 'channel-official-cn-1',
      result: 'success', requestId: 'req-channel-persist-test', summary: { idempotencyFingerprint: 'channel-test-fingerprint', message: '本地模拟渠道复检。' },
    }, now)
    expect(checked).toMatchObject({ channelId: 'channel-official-cn-1', checkedAt: now.toISOString(), idempotent: false })
    seedDemoData(database, now)
    expect(database.listSyntheticChannelChecks()).toEqual([expect.objectContaining({ channelId: 'channel-official-cn-1', successRate: 99.6 })])
    expect(database.verifyAuditChain(now)).toMatchObject({ verified: true, eventCount: 5 })
    database.close()
  })

  it('keeps locally acknowledged and closed simulated alerts when demo seeds run again', () => {
    const now = new Date('2026-09-17T10:00:00.000Z')
    const database = createPlatformDatabase({ filename: ':memory:', now: () => now })
    seedDemoData(database, now)
    const acknowledged = database.applyLocalAlertAction({ id: 'alert-error-global', action: 'acknowledge', actorUserId: 'user-super-admin' }, {
      id: 'audit-alert-ack-persist-test', actorUserId: 'user-super-admin', action: 'acknowledge', resourceType: 'alert', resourceId: 'alert-error-global',
      result: 'success', requestId: 'req-alert-ack-persist-test', summary: { idempotencyFingerprint: 'alert-ack-test-fingerprint', message: '本地模拟告警确认。' },
    }, now)
    expect(acknowledged).toMatchObject({ id: 'alert-error-global', status: 'acknowledged', assigneeUserId: 'user-super-admin', acknowledgedAt: now.toISOString(), idempotent: false })
    const closed = database.applyLocalAlertAction({ id: 'alert-balance-low', action: 'close', actorUserId: 'user-super-admin' }, {
      id: 'audit-alert-close-persist-test', actorUserId: 'user-super-admin', action: 'update', resourceType: 'alert', resourceId: 'alert-balance-low',
      result: 'success', requestId: 'req-alert-close-persist-test', summary: { idempotencyFingerprint: 'alert-close-test-fingerprint', message: '本地模拟告警关闭。' },
    }, now)
    expect(closed).toMatchObject({ id: 'alert-balance-low', status: 'closed', assigneeUserId: 'user-super-admin', acknowledgedAt: now.toISOString(), closedAt: now.toISOString(), idempotent: false })
    seedDemoData(database, now)
    expect(database.listAlertEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'alert-error-global', status: 'acknowledged', assigneeUserId: 'user-super-admin' }),
      expect.objectContaining({ id: 'alert-balance-low', status: 'closed', assigneeUserId: 'user-super-admin' }),
    ]))
    expect(database.verifyAuditChain(now)).toMatchObject({ verified: true, eventCount: 6 })
    database.close()
  })

  it('marks expired synthetic metadata and records a proof without storing conversation bodies', () => {
    const now = new Date('2026-09-17T10:00:00.000Z')
    const database = createPlatformDatabase({ filename: ':memory:', now: () => now })
    seedDemoData(database, now)
    const internals = database as unknown as { db: { prepare: (sql: string) => { run: (...values: unknown[]) => unknown } } }
    internals.db.prepare('UPDATE conversation_audit_records SET policy_expires_at = ? WHERE id = ?').run(now.toISOString(), 'conv-audit-copy-01')

    expect(database.cleanupConversationAuditMetadata('startup', now)).toMatchObject({ triggeredBy: 'startup', completedAt: now.toISOString(), expiredRecords: 1, proofRecords: 2 })
    expect(database.listConversationAuditRecords()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'conv-audit-copy-01', state: 'expired', contentAccessAvailable: 0 }),
    ]))
    expect(database.getConversationAuditCleanupStatus()).toMatchObject({
      proofRecords: 2,
      lastRun: { triggeredBy: 'startup', completedAt: now.toISOString(), expiredRecords: 1, proofRecords: 2 },
    })
    expect(database.cleanupConversationAuditMetadata('startup', now)).toMatchObject({ expiredRecords: 0, proofRecords: 0 })
    expect(database.tableCounts()).toMatchObject({ conversationAuditCleanupRuns: 1, conversationAuditExpiryProofs: 2 })
    expect(JSON.stringify(database.listConversationAuditRecords())).not.toMatch(/rawPrompt|rawResponse|reasonText|正文/i)
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
