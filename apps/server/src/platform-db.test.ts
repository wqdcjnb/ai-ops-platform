import { describe, expect, it } from 'vitest'
import { createPlatformDatabase, databaseStatusSchema, seedDemoData } from './platform-db.js'

describe('platform database migrations', () => {
  it('creates the core schema in an isolated in-memory database', () => {
    const database = createPlatformDatabase({ filename: ':memory:', now: () => new Date('2026-09-17T10:00:00.000Z') })
    expect(databaseStatusSchema.parse(database.status())).toMatchObject({ state: 'ready', migrationVersion: 9, checkedAt: '2026-09-17T10:00:00.000Z' })
    expect(database.status().tables).toEqual(expect.arrayContaining(['departments', 'users', 'api_keys', 'quota_policies', 'audit_events', 'usage_requests', 'alert_rules', 'alert_events', 'conversation_access_events', 'system_business_rules', 'system_feature_flags', 'system_role_definitions', 'system_retention_policies', 'system_backup_status']))
    database.migrate()
    expect(database.status().migrationVersion).toBe(9)
    database.close()
  })

  it('seeds repeatable organization roles, safe configuration summaries, and conversation-access metadata', () => {
    const database = createPlatformDatabase({ filename: ':memory:', now: () => new Date('2026-09-17T10:00:00.000Z') })
    const first = seedDemoData(database, new Date('2026-09-17T10:00:00.000Z'))
    const second = seedDemoData(database, new Date('2026-09-17T10:00:00.000Z'))
    expect(first).toEqual({ departments: 6, users: 20, apiKeys: 5, quotaPolicies: 6, auditEvents: 4, usageRequests: 12, alertRules: 8, alertEvents: 8, conversationAccessEvents: 0, businessRules: 5, featureFlags: 5, roleDefinitions: 5, retentionPolicies: 4, backupStatus: 1 })
    expect(second).toEqual(first)
    expect(database.findUserByUsername('demo-zhou')).toMatchObject({ id: 'person-zhou', role: 'employee', status: 'active' })
    expect(database.passwordMatches('demo-yan', 'demo-person-yan')).toBe(false)
    expect(database.listAuditEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'audit-key-rotate', resourceType: 'key', result: 'success', summary: expect.objectContaining({ sensitive: true }) }),
      expect.objectContaining({ id: 'audit-export-denied', resourceType: 'export', result: 'denied' }),
    ]))
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
    expect(database.status().migrationVersion).toBe(9)
    database.close()
  })
})
