import { z } from 'zod'
import type { NewApiStatus } from './new-api-status.js'
import type { PlatformProbeResult } from './platform.js'
import type { AppRole } from './auth.js'
import type { PlatformDatabase } from './platform-db.js'

const sourceStateSchema = z.enum(['live', 'demo', 'database', 'unverified'])
const serviceStateSchema = z.enum(['ready', 'reachable', 'auth_required', 'offline'])

export const settingsResponseSchema = z.object({
  meta: z.object({ source: z.literal('partial'), generatedAt: z.string().datetime(), notice: z.string() }),
  access: z.object({ currentRole: z.enum(['super_admin', 'admin', 'department_lead', 'finance', 'employee']), serverRbacVerified: z.literal(true), writeAllowed: z.literal(false), notice: z.string() }),
  summary: z.object({ sections: z.literal(6), roles: z.number().int().nonnegative(), servicesOnline: z.number().int().nonnegative(), servicesTotal: z.number().int().positive(), enabledFeatures: z.number().int().nonnegative(), backupsVerified: z.literal(0) }),
  organization: z.object({ source: z.literal('database'), company: z.string(), departments: z.number().int().nonnegative(), people: z.number().int().nonnegative(), roles: z.array(z.object({ id: z.enum(['super_admin', 'admin', 'department_lead', 'finance', 'employee']), name: z.string(), memberCount: z.number().int().nonnegative(), dataScope: z.string(), permissionSummary: z.string(), highPrivilege: z.boolean() })) }),
  businessRules: z.object({ source: z.literal('database'), version: z.string(), verified: z.literal(false), items: z.array(z.object({ id: z.string(), label: z.string(), value: z.string(), impact: z.string(), status: z.enum(['fixed', 'unverified']) })) }),
  connections: z.object({ source: z.literal('live'), items: z.array(z.object({ id: z.enum(['bff', 'new-api', 'cpa', 'docs']), name: z.string(), category: z.string(), url: z.string().url(), state: serviceStateSchema, credentialConfigured: z.boolean(), credentialValueAvailable: z.literal(false), checkedAt: z.string().datetime(), detail: z.string() })).length(4) }),
  retention: z.object({ source: z.literal('database'), cleanupJobVerified: z.literal(false), items: z.array(z.object({ id: z.string(), label: z.string(), days: z.number().int().nonnegative(), appliesTo: z.string(), cleanupState: z.enum(['not_configured', 'unverified']), minimumNecessary: z.boolean() })) }),
  features: z.object({ source: z.literal('database'), items: z.array(z.object({ id: z.string(), label: z.string(), enabled: z.boolean(), editable: z.literal(false), reason: z.string(), risk: z.enum(['low', 'medium', 'high']) })) }),
  backup: z.object({ source: sourceStateSchema, configured: z.literal(false), storageTargetConfigured: z.literal(false), lastBackupAt: z.null(), lastVerifiedAt: z.null(), lastRestoreDrillAt: z.null(), browserDownloadAllowed: z.literal(false), notice: z.string() }),
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
  const businessRuleItems = database.listBusinessRules()
  const featureItems = database.listFeatureFlags().map((item) => ({ ...item, enabled: item.enabled === 1, editable: false as const }))
  const retentionItems = database.listRetentionPolicies().map((item) => ({ ...item, minimumNecessary: item.minimumNecessary === 1 }))
  const businessRuleVersion = businessRuleItems[0]?.version ?? 'unavailable'
  const connections = [
    { id: 'bff' as const, name: '运营控制台 BFF', category: '本机服务', url: 'http://127.0.0.1:4175', state: 'ready' as const, credentialConfigured: false, credentialValueAvailable: false as const, checkedAt: now.toISOString(), detail: '当前页面由 BFF 提供并已通过请求 ID 与禁用缓存检查。' },
    { id: 'new-api' as const, name: 'New API', category: '统一网关', url: safeHttpUrl(process.env.NEW_API_BASE_URL, 'http://127.0.0.1:3000'), state: newApiState, credentialConfigured: newApi.authConfigured, credentialValueAvailable: false as const, checkedAt: newApi.checkedAt, detail: newApi.state === 'ready' ? '管理认证已验证。' : newApi.state === 'reachable' ? '服务可达，管理认证尚未配置。' : newApi.state === 'auth_required' ? '管理凭据已配置，但验证失败。' : '服务当前不可达。' },
    { id: 'cpa' as const, name: 'CLIProxyAPI', category: 'Pro OAuth 隔离实验', url: safeHttpUrl(process.env.CPA_BASE_URL, 'http://127.0.0.1:8317/management.html'), state: probeState(cpa.state), credentialConfigured: false, credentialValueAvailable: false as const, checkedAt: cpa.checkedAt, detail: cpa.state === 'reachable' ? '管理页面可达；账号认证与窗口字段仍待验证。' : '实验服务当前不可达。' },
    { id: 'docs' as const, name: '项目文档', category: 'VitePress', url: safeHttpUrl(process.env.DOCS_BASE_URL, 'http://127.0.0.1:4173'), state: probeState(docs.state), credentialConfigured: false, credentialValueAvailable: false as const, checkedAt: docs.checkedAt, detail: docs.state === 'reachable' ? '文档中心可达。' : '文档中心当前不可达。' },
  ]
  return {
    meta: { source: 'partial' as const, generatedAt: now.toISOString(), notice: '服务连通状态为实时探测；组织与角色、业务口径、功能开关和留存策略读取 SQLite 模拟配置；备份仍明确标注为未验证。' },
    access: { currentRole, serverRbacVerified: true as const, writeAllowed: false as const, notice: '当前会话已通过服务端 RBAC 校验；设置写操作、二次确认与变更审计仍未接入。' },
    summary: { sections: 6 as const, roles: organization.roles.length, servicesOnline: connections.filter((item) => item.state !== 'offline').length, servicesTotal: connections.length, enabledFeatures: featureItems.filter((item) => item.enabled).length, backupsVerified: 0 as const },
    organization: { source: 'database' as const, ...organization },
    businessRules: { source: 'database' as const, version: businessRuleVersion, verified: false as const, items: businessRuleItems },
    connections: { source: 'live' as const, items: connections },
    retention: { source: 'database' as const, cleanupJobVerified: false as const, items: retentionItems },
    features: { source: 'database' as const, items: featureItems },
    backup: { source: 'unverified' as const, configured: false as const, storageTargetConfigured: false as const, lastBackupAt: null, lastVerifiedAt: null, lastRestoreDrillAt: null, browserDownloadAllowed: false as const, notice: '尚未配置平台数据库备份作业；页面不允许直接下载数据库、密钥或认证文件。' },
  }
}
