import { z } from 'zod'
import type { NewApiStatus } from './new-api-status.js'
import type { PlatformProbeResult } from './platform.js'
import type { AppRole } from './auth.js'
import type { PlatformDatabase } from './platform-db.js'

const serviceStateSchema = z.enum(['ready', 'reachable', 'auth_required', 'offline'])
export const businessRuleItemSchema = z.object({ id: z.string(), label: z.string(), value: z.string(), impact: z.string(), status: z.enum(['fixed', 'unverified']) })
export const businessRuleVersionSchema = z.object({
  id: z.string(), version: z.string(), status: z.enum(['draft', 'published', 'rolled_back']), isCurrent: z.boolean(),
  items: z.array(businessRuleItemSchema), createdBy: z.string().nullable(), createdAt: z.string().datetime(),
  publishedAt: z.string().datetime().nullable(), rolledBackAt: z.string().datetime().nullable(), note: z.string(),
})
const businessRuleValuesSchema = z.object({ values: z.array(z.object({ id: z.string().min(1).max(80), value: z.string().trim().min(1).max(240) })).min(1).max(20) })
const settingsMutationFields = {
  reason: z.string().trim().min(8).max(200),
  acknowledgeSimulation: z.literal(true),
}
export const businessRulePreviewBodySchema = businessRuleValuesSchema
export const businessRuleDraftBodySchema = businessRuleValuesSchema.extend({
  ...settingsMutationFields,
  idempotencyKey: z.string().regex(/^settings-business-draft-[a-z0-9-]{8,96}$/),
})
export const businessRulePublishBodySchema = z.object({
  versionId: z.string().regex(/^business-rule-[a-z0-9-]{1,120}$/),
  ...settingsMutationFields,
  idempotencyKey: z.string().regex(/^settings-business-publish-[a-z0-9-]{8,96}$/),
})
export const businessRuleRollbackBodySchema = z.object({
  versionId: z.string().regex(/^business-rule-[a-z0-9-]{1,120}$/),
  ...settingsMutationFields,
  idempotencyKey: z.string().regex(/^settings-business-rollback-[a-z0-9-]{8,96}$/),
})
export const businessRulePreviewResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), generatedAt: z.string().datetime(), notice: z.string() }),
  baseVersion: z.string(), current: z.array(businessRuleItemSchema), proposed: z.array(businessRuleItemSchema),
  changes: z.array(z.object({ id: z.string(), label: z.string(), impact: z.string(), before: z.string(), after: z.string() })),
  changedCount: z.number().int().nonnegative(),
})
export const businessRuleVersionActionResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), completedAt: z.string().datetime(), notice: z.string() }),
  version: businessRuleVersionSchema,
  operation: z.object({ action: z.enum(['draft', 'publish', 'rollback']), idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})

export const settingsResponseSchema = z.object({
  meta: z.object({ source: z.literal('partial'), generatedAt: z.string().datetime(), notice: z.string() }),
  access: z.object({ currentRole: z.enum(['super_admin', 'admin', 'department_lead', 'finance', 'employee']), serverRbacVerified: z.literal(true), writeAllowed: z.boolean(), notice: z.string() }),
  summary: z.object({ sections: z.literal(6), roles: z.number().int().nonnegative(), servicesOnline: z.number().int().nonnegative(), servicesTotal: z.number().int().positive(), enabledFeatures: z.number().int().nonnegative(), backupsVerified: z.literal(0) }),
  organization: z.object({ source: z.literal('database'), company: z.string(), departments: z.number().int().nonnegative(), people: z.number().int().nonnegative(), roles: z.array(z.object({ id: z.enum(['super_admin', 'admin', 'department_lead', 'finance', 'employee']), name: z.string(), memberCount: z.number().int().nonnegative(), dataScope: z.string(), permissionSummary: z.string(), highPrivilege: z.boolean() })) }),
  businessRules: z.object({ source: z.literal('database'), version: z.string(), status: z.literal('published'), currentVersionId: z.string().nullable(), verified: z.literal(false), items: z.array(businessRuleItemSchema), draft: businessRuleVersionSchema.nullable(), versions: z.array(businessRuleVersionSchema) }),
  connections: z.object({ source: z.literal('live'), items: z.array(z.object({ id: z.enum(['bff', 'new-api', 'cpa', 'docs']), name: z.string(), category: z.string(), url: z.string().url(), state: serviceStateSchema, credentialConfigured: z.boolean(), credentialValueAvailable: z.literal(false), checkedAt: z.string().datetime(), detail: z.string() })).length(4) }),
  retention: z.object({ source: z.literal('database'), cleanupJobVerified: z.literal(false), syntheticMetadataExpiry: z.object({ mode: z.literal('synthetic_metadata_only'), automaticOnStartup: z.literal(true), proofRecords: z.number().int().nonnegative(), lastRun: z.object({ triggeredBy: z.literal('startup'), completedAt: z.string().datetime(), expiredRecords: z.number().int().nonnegative(), proofRecords: z.number().int().nonnegative() }).nullable(), realContentCleanup: z.literal(false), notice: z.string() }), items: z.array(z.object({ id: z.string(), label: z.string(), days: z.number().int().nonnegative(), appliesTo: z.string(), cleanupState: z.enum(['not_configured', 'unverified']), minimumNecessary: z.boolean() })) }),
  features: z.object({ source: z.literal('database'), items: z.array(z.object({ id: z.string(), label: z.string(), enabled: z.boolean(), editable: z.literal(false), reason: z.string(), risk: z.enum(['low', 'medium', 'high']) })) }),
  backup: z.object({ source: z.literal('database'), configured: z.literal(false), storageTargetConfigured: z.literal(false), lastBackupAt: z.null(), lastVerifiedAt: z.null(), lastRestoreDrillAt: z.null(), browserDownloadAllowed: z.literal(false), notice: z.string() }),
})

function safeHttpUrl(value: string | undefined, fallback: string) {
  try {
    const url = new URL(value ?? fallback)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch { return fallback }
}

function probeState(value: PlatformProbeResult['state']) { return value === 'reachable' ? 'reachable' as const : 'offline' as const }

export function createSettings(newApi: NewApiStatus, cpa: PlatformProbeResult, docs: PlatformProbeResult, database: PlatformDatabase, now = new Date(), currentRole: AppRole = 'super_admin') {
  const newApiState = newApi.state === 'ready' ? 'ready' as const : newApi.state
  const organization = database.getOrganizationSummary()
  const businessRuleState = database.getBusinessRuleState()
  const featureItems = database.listFeatureFlags().map((item) => ({ ...item, enabled: item.enabled === 1, editable: false as const }))
  const retentionItems = database.listRetentionPolicies().map((item) => ({ ...item, minimumNecessary: item.minimumNecessary === 1 }))
  const conversationCleanup = database.getConversationAuditCleanupStatus()
  const backupStatus = database.getBackupStatus()
  if (!backupStatus) throw new Error('系统备份状态尚未初始化')
  const connections = [
    { id: 'bff' as const, name: '运营控制台 BFF', category: '本机服务', url: 'http://127.0.0.1:4175', state: 'ready' as const, credentialConfigured: false, credentialValueAvailable: false as const, checkedAt: now.toISOString(), detail: '当前页面由 BFF 提供并已通过请求 ID 与禁用缓存检查。' },
    { id: 'new-api' as const, name: 'New API', category: '统一网关', url: safeHttpUrl(process.env.AI_OPS_PUBLIC_NEW_API_BASE_URL, 'http://127.0.0.1:3000/v1'), state: newApiState, credentialConfigured: newApi.authConfigured, credentialValueAvailable: false as const, checkedAt: newApi.checkedAt, detail: newApi.state === 'ready' ? '管理认证已验证。' : newApi.state === 'reachable' ? '服务可达，管理认证尚未配置。' : newApi.state === 'auth_required' ? '管理凭据已配置，但验证失败。' : '服务当前不可达。' },
    { id: 'cpa' as const, name: 'CLIProxyAPI', category: 'CPA Codex OAuth 上游', url: 'http://127.0.0.1:4174/upstreams', state: probeState(cpa.state), credentialConfigured: Boolean(cpa.configured), credentialValueAvailable: false as const, checkedAt: cpa.checkedAt, detail: cpa.state === 'reachable' ? 'CPA OpenAI 兼容入口可达；凭据可在 AI OPS 上游账号页维护。' : 'CPA 上游当前不可达；请在 AI OPS 上游账号页配置或检查。' },
    { id: 'docs' as const, name: '项目文档', category: 'VitePress', url: safeHttpUrl(process.env.DOCS_BASE_URL, 'http://127.0.0.1:4173'), state: probeState(docs.state), credentialConfigured: false, credentialValueAvailable: false as const, checkedAt: docs.checkedAt, detail: docs.state === 'reachable' ? '文档中心可达。' : '文档中心当前不可达。' },
  ]
  return {
    meta: { source: 'partial' as const, generatedAt: now.toISOString(), notice: '服务连通状态为实时探测；组织与角色、业务口径、功能开关、留存策略和备份安全状态读取 SQLite 模拟配置。' },
    access: { currentRole, serverRbacVerified: true as const, writeAllowed: currentRole === 'super_admin' || currentRole === 'admin', notice: '业务口径支持本地 SQLite 草稿、预览、发布、回滚和审计；其他设置仍保持只读。' },
    summary: { sections: 6 as const, roles: organization.roles.length, servicesOnline: connections.filter((item) => item.state !== 'offline').length, servicesTotal: connections.length, enabledFeatures: featureItems.filter((item) => item.enabled).length, backupsVerified: 0 as const },
    organization: { source: 'database' as const, ...organization },
    businessRules: { source: 'database' as const, ...businessRuleState, verified: false as const },
    connections: { source: 'live' as const, items: connections },
    retention: {
      source: 'database' as const,
      cleanupJobVerified: false as const,
      syntheticMetadataExpiry: {
        mode: 'synthetic_metadata_only' as const,
        automaticOnStartup: true as const,
        proofRecords: conversationCleanup.proofRecords,
        lastRun: conversationCleanup.lastRun,
        realContentCleanup: false as const,
        notice: conversationCleanup.lastRun
          ? '启动时已检查合成对话元数据；证明仅表示 SQLite 从未存储正文，不是实际正文删除证明。'
          : '启动时到期检查已启用；尚无需要记录的合成元数据到期证明。',
      },
      items: retentionItems,
    },
    features: { source: 'database' as const, items: featureItems },
    backup: { source: 'database' as const, ...backupStatus },
  }
}
