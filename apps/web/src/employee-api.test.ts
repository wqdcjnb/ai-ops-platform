import { describe, expect, it } from 'vitest'
import { employeeKeysResponseSchema, employeeModelsResponseSchema, employeeProfileResponseSchema, employeeUsageResponseSchema } from './employee-api'

const databaseMeta = { source: 'database' as const, generatedAt: '2026-09-15T10:00:00.000Z', notice: 'SQLite 模拟数据' }
const demoMeta = { source: 'demo' as const, generatedAt: '2026-09-15T10:00:00.000Z', notice: '演示模型目录' }
const scope = { mode: 'self_database' as const, currentUserVerified: true, serverRbacVerified: true, otherPeopleAvailable: false, notice: '会话已验证' }

describe('employee API contracts', () => {
  it('accepts only self-scoped profiles and masked Keys', () => {
    const profile = { meta: databaseMeta, scope, person: { id: 'person-lin', name: '林梓雨', initials: '林', employeeCode: 'OPS-017', department: '内容运营', role: 'employee', status: 'active', manager: '负责人', joinedAt: '2025-03-17' }, support: { contact: '联系管理员', serviceHours: '工作日', temporaryQuotaRequestAvailable: false, notice: '二期' }, commonErrors: [{ code: 'AUTH_INVALID', title: '鉴权失败', explanation: 'Key 无效', action: '检查配置', internalDetailAvailable: false }] }
    expect(employeeProfileResponseSchema.safeParse(profile).success).toBe(true)
    expect(employeeProfileResponseSchema.safeParse({ ...profile, scope: { ...scope, otherPeopleAvailable: true } }).success).toBe(false)
    const keys = { meta: databaseMeta, scope, items: [{ id: 'key-1', masked: 'sk-ops••••••1234', purpose: '文案', alias: 'copy', allowedModels: ['文案模型'], status: 'active', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z', lastUsedAt: null, secretAvailable: false, rotateAvailable: false }], connection: { baseUrl: 'http://127.0.0.1:3000/v1', credentialDelivery: '受控交付', upstreamDetailsAvailable: false, guides: [{ id: 'codex', name: 'Codex', description: '连接', steps: ['配置'] }] } }
    expect(employeeKeysResponseSchema.safeParse(keys).success).toBe(true)
    expect(employeeKeysResponseSchema.safeParse({ ...keys, items: [{ ...keys.items[0], secretAvailable: true }] }).success).toBe(false)
  })

  it('rejects hard blocking and exposed model internals', () => {
    const usage = { meta: { ...databaseMeta, period: '7d' }, scope, summary: { pointsUsed: 100, pointsTarget: 1000, pointsRemaining: 900, usagePercent: 10, requests: 5, tokens: 1000, successRate: 100, softTarget: true, requestBlockingEnabled: false }, trend: [{ date: '2026-09-15', points: 100, requests: 5 }], purposes: [{ id: 'copy', name: '文案', points: 100, percent: 100 }] }
    expect(employeeUsageResponseSchema.safeParse(usage).success).toBe(true)
    expect(employeeUsageResponseSchema.safeParse({ ...usage, summary: { ...usage.summary, requestBlockingEnabled: true } }).success).toBe(false)
    const models = { meta: demoMeta, scope, items: [{ id: 'model-1', alias: 'copy', name: '文案模型', purpose: '文案', description: '说明', capabilityTags: ['中文'], contextLabel: '长文本', status: 'available', useAdvice: '不含隐私', providerAvailable: false, actualModelAvailable: false, channelAvailable: false }] }
    expect(employeeModelsResponseSchema.safeParse(models).success).toBe(true)
    expect(employeeModelsResponseSchema.safeParse({ ...models, items: [{ ...models.items[0], providerAvailable: true }] }).success).toBe(false)
  })
})
