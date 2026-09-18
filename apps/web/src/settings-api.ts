import { z } from 'zod'
import { withCsrfHeader } from './csrf'

const serviceStateSchema = z.enum(['ready', 'reachable', 'auth_required', 'offline'])
const roleSchema = z.object({ id: z.enum(['super_admin', 'admin', 'department_lead', 'finance', 'employee']), name: z.string(), memberCount: z.number().int().nonnegative(), dataScope: z.string(), permissionSummary: z.string(), highPrivilege: z.boolean() })
const accessSchema = z.object({ currentRole: z.enum(['super_admin', 'admin', 'department_lead', 'finance', 'employee']), serverRbacVerified: z.literal(true), writeAllowed: z.boolean(), notice: z.string() })
export const businessRuleItemSchema = z.object({ id: z.string(), label: z.string(), value: z.string(), impact: z.string(), status: z.enum(['fixed', 'unverified']) })
export const businessRuleVersionSchema = z.object({ id: z.string(), version: z.string(), status: z.enum(['draft', 'published', 'rolled_back']), isCurrent: z.boolean(), items: z.array(businessRuleItemSchema), createdBy: z.string().nullable(), createdAt: z.string().datetime(), publishedAt: z.string().datetime().nullable(), rolledBackAt: z.string().datetime().nullable(), note: z.string() })

export const settingsResponseSchema = z.object({
  meta: z.object({ source: z.literal('partial'), generatedAt: z.string().datetime(), notice: z.string() }),
  access: accessSchema,
  summary: z.object({ sections: z.literal(6), roles: z.number().int().nonnegative(), servicesOnline: z.number().int().nonnegative(), servicesTotal: z.number().int().positive(), enabledFeatures: z.number().int().nonnegative(), backupsVerified: z.literal(0) }),
  organization: z.object({ source: z.literal('database'), company: z.string(), departments: z.number().int().nonnegative(), people: z.number().int().nonnegative(), roles: z.array(roleSchema) }),
  businessRules: z.object({ source: z.literal('database'), version: z.string(), status: z.literal('published'), currentVersionId: z.string().nullable(), verified: z.literal(false), items: z.array(businessRuleItemSchema), draft: businessRuleVersionSchema.nullable(), versions: z.array(businessRuleVersionSchema) }),
  connections: z.object({ source: z.literal('live'), items: z.array(z.object({ id: z.enum(['bff', 'new-api', 'cpa', 'docs']), name: z.string(), category: z.string(), url: z.string().url(), state: serviceStateSchema, credentialConfigured: z.boolean(), credentialValueAvailable: z.literal(false), checkedAt: z.string().datetime(), detail: z.string() })).length(4) }),
  retention: z.object({ source: z.literal('database'), cleanupJobVerified: z.literal(false), syntheticMetadataExpiry: z.object({ mode: z.literal('synthetic_metadata_only'), automaticOnStartup: z.literal(true), proofRecords: z.number().int().nonnegative(), lastRun: z.object({ triggeredBy: z.literal('startup'), completedAt: z.string().datetime(), expiredRecords: z.number().int().nonnegative(), proofRecords: z.number().int().nonnegative() }).nullable(), realContentCleanup: z.literal(false), notice: z.string() }), items: z.array(z.object({ id: z.string(), label: z.string(), days: z.number().int().nonnegative(), appliesTo: z.string(), cleanupState: z.enum(['not_configured', 'unverified']), minimumNecessary: z.boolean() })) }),
  features: z.object({ source: z.literal('database'), items: z.array(z.object({ id: z.string(), label: z.string(), enabled: z.boolean(), editable: z.literal(false), reason: z.string(), risk: z.enum(['low', 'medium', 'high']) })) }),
  backup: z.object({ source: z.literal('database'), configured: z.literal(false), storageTargetConfigured: z.literal(false), lastBackupAt: z.null(), lastVerifiedAt: z.null(), lastRestoreDrillAt: z.null(), browserDownloadAllowed: z.literal(false), notice: z.string() }),
})

export type SettingsResponse = z.infer<typeof settingsResponseSchema>
export type BusinessRuleItem = z.infer<typeof businessRuleItemSchema>
export type BusinessRuleVersion = z.infer<typeof businessRuleVersionSchema>
export const businessRulePreviewResponseSchema = z.object({ meta: z.object({ source: z.literal('database'), generatedAt: z.string().datetime(), notice: z.string() }), baseVersion: z.string(), current: z.array(businessRuleItemSchema), proposed: z.array(businessRuleItemSchema), changes: z.array(z.object({ id: z.string(), label: z.string(), impact: z.string(), before: z.string(), after: z.string() })), changedCount: z.number().int().nonnegative() })
export type BusinessRulePreview = z.infer<typeof businessRulePreviewResponseSchema>
export const businessRuleVersionActionResponseSchema = z.object({ meta: z.object({ source: z.literal('database'), completedAt: z.string().datetime(), notice: z.string() }), version: businessRuleVersionSchema, operation: z.object({ action: z.enum(['draft', 'publish', 'rollback']), idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }) })
export type BusinessRuleVersionActionResponse = z.infer<typeof businessRuleVersionActionResponseSchema>
export type SettingsSection = 'organization' | 'business' | 'connections' | 'retention' | 'features' | 'backup'
export class SettingsApiError extends Error { constructor(message: string, readonly requestId?: string) { super(message) } }
export async function fetchSettings(signal?: AbortSignal) { const response = await fetch('/api/settings', { headers: { accept: 'application/json' }, signal }); const requestId = response.headers.get('x-request-id') ?? undefined; if (!response.ok) throw new SettingsApiError('系统设置暂时无法加载', requestId); const parsed = settingsResponseSchema.safeParse(await response.json()); if (!parsed.success) throw new SettingsApiError('系统设置格式不符合接口约定', requestId); return parsed.data }
async function postBusinessRule<T>(url: string, body: unknown, schema: z.ZodType<T>, fallback: string): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(body) })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new SettingsApiError(detail?.error?.message ?? fallback, requestId)
  }
  const parsed = schema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new SettingsApiError('业务口径版本响应格式不符合接口约定', requestId)
  return parsed.data
}
export function previewBusinessRules(values: Array<Pick<BusinessRuleItem, 'id' | 'value'>>) { return postBusinessRule('/api/settings/business-rules/preview', { values }, businessRulePreviewResponseSchema, '业务口径预览失败') }
export function createBusinessRuleDraft(values: Array<Pick<BusinessRuleItem, 'id' | 'value'>>, reason: string, idempotencyKey: string) { return postBusinessRule('/api/settings/business-rules/drafts', { values, reason, acknowledgeSimulation: true, idempotencyKey }, businessRuleVersionActionResponseSchema, '本地业务口径草稿保存失败') }
export function publishBusinessRuleVersion(versionId: string, reason: string, idempotencyKey: string) { return postBusinessRule('/api/settings/business-rules/publish', { versionId, reason, acknowledgeSimulation: true, idempotencyKey }, businessRuleVersionActionResponseSchema, '本地业务口径发布失败') }
export function rollbackBusinessRuleVersion(versionId: string, reason: string, idempotencyKey: string) { return postBusinessRule('/api/settings/business-rules/rollback', { versionId, reason, acknowledgeSimulation: true, idempotencyKey }, businessRuleVersionActionResponseSchema, '本地业务口径回滚失败') }
