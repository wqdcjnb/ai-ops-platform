import { describe, expect, it } from 'vitest'
import { settingsResponseSchema } from './settings-api'

const connection = (id: 'bff' | 'new-api' | 'cpa' | 'docs') => ({ id, name: id, category: '服务', url: `http://127.0.0.1:${id === 'bff' ? 4175 : 4173}`, state: 'reachable', credentialConfigured: false, credentialValueAvailable: false, checkedAt: '2026-09-15T10:00:00.000Z', detail: '可达' })
const version = { id: 'business-rule-v0-1', version: 'draft', status: 'published' as const, isCurrent: true, items: [{ id: 'timezone', label: '时区', value: 'Asia/Shanghai', impact: '账期', status: 'fixed' as const }], createdBy: '超级管理员', createdAt: '2026-09-15T10:00:00.000Z', publishedAt: '2026-09-15T10:00:00.000Z', rolledBackAt: null, note: '基线' }
const payload = { meta: { source: 'partial', generatedAt: '2026-09-15T10:00:00.000Z', notice: '部分实时' }, access: { currentRole: 'super_admin', serverRbacVerified: true, writeAllowed: true, notice: '本地版本' }, summary: { sections: 6, roles: 1, servicesOnline: 4, servicesTotal: 4, enabledFeatures: 0, backupsVerified: 0 }, organization: { source: 'database', company: '测试公司', departments: 1, people: 1, roles: [{ id: 'super_admin', name: '超级管理员', memberCount: 1, dataScope: '全公司', permissionSummary: '全部', highPrivilege: true }] }, businessRules: { source: 'database', version: 'draft', status: 'published' as const, currentVersionId: 'business-rule-v0-1', verified: false, items: version.items, draft: null, versions: [version] }, connections: { source: 'live', items: [connection('bff'), connection('new-api'), connection('cpa'), connection('docs')] }, retention: { source: 'database', cleanupJobVerified: false, syntheticMetadataExpiry: { mode: 'synthetic_metadata_only', automaticOnStartup: true, proofRecords: 0, lastRun: null, realContentCleanup: false, notice: '未验证' }, items: [{ id: 'metadata', label: '元数据', days: 180, appliesTo: '调用日志', cleanupState: 'unverified', minimumNecessary: true }] }, features: { source: 'database', items: [{ id: 'writes', label: '写操作', enabled: false, editable: false, reason: '未验收', risk: 'high' }] }, backup: { source: 'database', configured: false, storageTargetConfigured: false, lastBackupAt: null, lastVerifiedAt: null, lastRestoreDrillAt: null, browserDownloadAllowed: false, notice: '未配置' } }

describe('settings API contract', () => {
  it('accepts mixed live, SQLite, and explicitly unverified settings data', () => {
    expect(settingsResponseSchema.safeParse(payload).success).toBe(true)
  })

  it('rejects browser credential access and unverified backup claims', () => {
    expect(settingsResponseSchema.safeParse({ ...payload, businessRules: { ...payload.businessRules, status: 'draft' } }).success).toBe(false)
    expect(settingsResponseSchema.safeParse({ ...payload, connections: { ...payload.connections, items: payload.connections.items.map((item, index) => index ? item : { ...item, credentialValueAvailable: true }) } }).success).toBe(false)
    expect(settingsResponseSchema.safeParse({ ...payload, backup: { ...payload.backup, configured: true } }).success).toBe(false)
  })
})
