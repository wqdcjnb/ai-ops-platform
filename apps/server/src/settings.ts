import { z } from 'zod'
import type { NewApiStatus } from './new-api-status.js'
import type { PlatformProbeResult } from './platform.js'
import type { AppRole } from './auth.js'

const sourceStateSchema = z.enum(['live', 'demo', 'unverified'])
const serviceStateSchema = z.enum(['ready', 'reachable', 'auth_required', 'offline'])

export const settingsResponseSchema = z.object({
  meta: z.object({ source: z.literal('partial'), generatedAt: z.string().datetime(), notice: z.string() }),
  access: z.object({ currentRole: z.enum(['super_admin', 'admin', 'department_lead', 'finance', 'employee']), serverRbacVerified: z.literal(true), writeAllowed: z.literal(false), notice: z.string() }),
  summary: z.object({ sections: z.literal(6), roles: z.number().int().nonnegative(), servicesOnline: z.number().int().nonnegative(), servicesTotal: z.number().int().positive(), enabledFeatures: z.number().int().nonnegative(), backupsVerified: z.literal(0) }),
  organization: z.object({ source: sourceStateSchema, company: z.string(), departments: z.number().int().nonnegative(), people: z.number().int().nonnegative(), roles: z.array(z.object({ id: z.enum(['super_admin', 'admin', 'department_lead', 'finance', 'employee']), name: z.string(), memberCount: z.number().int().nonnegative(), dataScope: z.string(), permissionSummary: z.string(), highPrivilege: z.boolean() })) }),
  businessRules: z.object({ source: sourceStateSchema, version: z.string(), verified: z.literal(false), items: z.array(z.object({ id: z.string(), label: z.string(), value: z.string(), impact: z.string(), status: z.enum(['fixed', 'unverified']) })) }),
  connections: z.object({ source: z.literal('live'), items: z.array(z.object({ id: z.enum(['bff', 'new-api', 'cpa', 'docs']), name: z.string(), category: z.string(), url: z.string().url(), state: serviceStateSchema, credentialConfigured: z.boolean(), credentialValueAvailable: z.literal(false), checkedAt: z.string().datetime(), detail: z.string() })).length(4) }),
  retention: z.object({ source: sourceStateSchema, cleanupJobVerified: z.literal(false), items: z.array(z.object({ id: z.string(), label: z.string(), days: z.number().int().nonnegative(), appliesTo: z.string(), cleanupState: z.enum(['not_configured', 'unverified']), minimumNecessary: z.boolean() })) }),
  features: z.object({ source: z.literal('configuration'), items: z.array(z.object({ id: z.string(), label: z.string(), enabled: z.boolean(), editable: z.literal(false), reason: z.string(), risk: z.enum(['low', 'medium', 'high']) })) }),
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

export function createSettings(newApi: NewApiStatus, cpa: PlatformProbeResult, docs: PlatformProbeResult, now = new Date(), currentRole: AppRole = 'super_admin') {
  const newApiState = newApi.state === 'ready' ? 'ready' as const : newApi.state
  const connections = [
    { id: 'bff' as const, name: '运营控制台 BFF', category: '本机服务', url: 'http://127.0.0.1:4175', state: 'ready' as const, credentialConfigured: false, credentialValueAvailable: false as const, checkedAt: now.toISOString(), detail: '当前页面由 BFF 提供并已通过请求 ID 与禁用缓存检查。' },
    { id: 'new-api' as const, name: 'New API', category: '统一网关', url: safeHttpUrl(process.env.NEW_API_BASE_URL, 'http://127.0.0.1:3000'), state: newApiState, credentialConfigured: newApi.authConfigured, credentialValueAvailable: false as const, checkedAt: newApi.checkedAt, detail: newApi.state === 'ready' ? '管理认证已验证。' : newApi.state === 'reachable' ? '服务可达，管理认证尚未配置。' : newApi.state === 'auth_required' ? '管理凭据已配置，但验证失败。' : '服务当前不可达。' },
    { id: 'cpa' as const, name: 'CLIProxyAPI', category: 'Pro OAuth 隔离实验', url: safeHttpUrl(process.env.CPA_BASE_URL, 'http://127.0.0.1:8317/management.html'), state: probeState(cpa.state), credentialConfigured: false, credentialValueAvailable: false as const, checkedAt: cpa.checkedAt, detail: cpa.state === 'reachable' ? '管理页面可达；账号认证与窗口字段仍待验证。' : '实验服务当前不可达。' },
    { id: 'docs' as const, name: '项目文档', category: 'VitePress', url: safeHttpUrl(process.env.DOCS_BASE_URL, 'http://127.0.0.1:4173'), state: probeState(docs.state), credentialConfigured: false, credentialValueAvailable: false as const, checkedAt: docs.checkedAt, detail: docs.state === 'reachable' ? '文档中心可达。' : '文档中心当前不可达。' },
  ]
  return {
    meta: { source: 'partial' as const, generatedAt: now.toISOString(), notice: '服务连通状态为实时探测；组织、口径、留存和备份为明确标注的演示或未验证配置。' },
    access: { currentRole, serverRbacVerified: true as const, writeAllowed: false as const, notice: '当前会话已通过服务端 RBAC 校验；设置写操作、二次确认与变更审计仍未接入。' },
    summary: { sections: 6 as const, roles: 5, servicesOnline: connections.filter((item) => item.state !== 'offline').length, servicesTotal: connections.length, enabledFeatures: 0, backupsVerified: 0 as const },
    organization: { source: 'demo' as const, company: '新知科技', departments: 4, people: 12, roles: [
      { id: 'super_admin' as const, name: '超级管理员', memberCount: 1, dataScope: '全公司', permissionSummary: '组织、服务、策略与敏感审计', highPrivilege: true },
      { id: 'admin' as const, name: '运营管理员', memberCount: 2, dataScope: '全公司运营数据', permissionSummary: '人员、Key、额度、路由与告警', highPrivilege: true },
      { id: 'department_lead' as const, name: '部门负责人', memberCount: 4, dataScope: '本部门', permissionSummary: '人员、Key、用量与额度只读', highPrivilege: false },
      { id: 'finance' as const, name: '财务只读', memberCount: 1, dataScope: '全公司汇总', permissionSummary: '成本、额度和用量只读', highPrivilege: false },
      { id: 'employee' as const, name: '员工', memberCount: 12, dataScope: '本人', permissionSummary: '个人 Key、模型与用量', highPrivilege: false },
    ] },
    businessRules: { source: 'demo' as const, version: 'draft-v0.1', verified: false as const, items: [
      { id: 'timezone', label: '业务时区', value: 'Asia/Shanghai (UTC+8)', impact: '账期、告警窗口和日志展示', status: 'fixed' as const },
      { id: 'currency', label: '预算单位', value: 'CNY · 点数', impact: '预算、分摊与软目标展示', status: 'unverified' as const },
      { id: 'billing-cycle', label: '用量周期', value: '自然月 · 每月 1 日重置', impact: '个人、用途与公司软目标', status: 'fixed' as const },
      { id: 'failed-billing', label: '失败请求计费', value: '不计点数', impact: '失败、取消及上游异常', status: 'unverified' as const },
      { id: 'retry-billing', label: '重试计费', value: '按最终成功请求记一次', impact: '网关自动重试与成本归集', status: 'unverified' as const },
    ] },
    connections: { source: 'live' as const, items: connections },
    retention: { source: 'demo' as const, cleanupJobVerified: false as const, items: [
      { id: 'usage-metadata', label: '调用元数据', days: 180, appliesTo: '请求 ID、Token、耗时、成本与状态', cleanupState: 'unverified' as const, minimumNecessary: true },
      { id: 'conversation-content', label: '对话审计正文', days: 7, appliesTo: '仅限获准策略采集的脱敏内容', cleanupState: 'not_configured' as const, minimumNecessary: true },
      { id: 'operation-audit', label: '操作审计', days: 365, appliesTo: '管理员操作与访问原因证明', cleanupState: 'unverified' as const, minimumNecessary: true },
      { id: 'export-files', label: '导出文件', days: 7, appliesTo: '异步生成的受控下载文件', cleanupState: 'not_configured' as const, minimumNecessary: true },
    ] },
    features: { source: 'configuration' as const, items: [
      { id: 'management-writes', label: '管理写操作', enabled: false, editable: false as const, reason: '登录、RBAC、幂等、审计和回滚未完成', risk: 'high' as const },
      { id: 'conversation-capture', label: '对话正文采集', enabled: false, editable: false as const, reason: '独立存储、加密、脱敏和到期清理未完成', risk: 'high' as const },
      { id: 'hard-quota', label: '硬额度阻断', enabled: false, editable: false as const, reason: '并发预留、结算和恢复路径未验收', risk: 'high' as const },
      { id: 'data-export', label: '数据导出', enabled: false, editable: false as const, reason: '数据范围、敏感扫描和导出审计未完成', risk: 'medium' as const },
      { id: 'employee-portal', label: '员工自助入口', enabled: false, editable: false as const, reason: '本人数据范围与接入说明尚未完成', risk: 'medium' as const },
    ] },
    backup: { source: 'unverified' as const, configured: false as const, storageTargetConfigured: false as const, lastBackupAt: null, lastVerifiedAt: null, lastRestoreDrillAt: null, browserDownloadAllowed: false as const, notice: '尚未配置平台数据库备份作业；页面不允许直接下载数据库、密钥或认证文件。' },
  }
}
