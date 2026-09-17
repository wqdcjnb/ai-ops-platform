import { z } from 'zod'

const sourceStateSchema = z.enum(['live', 'demo', 'database', 'unverified'])
const serviceStateSchema = z.enum(['ready', 'reachable', 'auth_required', 'offline'])
const roleSchema = z.object({ id: z.enum(['super_admin', 'admin', 'department_lead', 'finance', 'employee']), name: z.string(), memberCount: z.number().int().nonnegative(), dataScope: z.string(), permissionSummary: z.string(), highPrivilege: z.boolean() })
const accessSchema = z.object({ currentRole: z.enum(['super_admin', 'admin', 'department_lead', 'finance', 'employee']), serverRbacVerified: z.literal(true), writeAllowed: z.literal(false), notice: z.string() })

export const settingsResponseSchema = z.object({
  meta: z.object({ source: z.literal('partial'), generatedAt: z.string().datetime(), notice: z.string() }),
  access: accessSchema,
  summary: z.object({ sections: z.literal(6), roles: z.number().int().nonnegative(), servicesOnline: z.number().int().nonnegative(), servicesTotal: z.number().int().positive(), enabledFeatures: z.number().int().nonnegative(), backupsVerified: z.literal(0) }),
  organization: z.object({ source: z.literal('database'), company: z.string(), departments: z.number().int().nonnegative(), people: z.number().int().nonnegative(), roles: z.array(roleSchema) }),
  businessRules: z.object({ source: z.literal('database'), version: z.string(), verified: z.literal(false), items: z.array(z.object({ id: z.string(), label: z.string(), value: z.string(), impact: z.string(), status: z.enum(['fixed', 'unverified']) })) }),
  connections: z.object({ source: z.literal('live'), items: z.array(z.object({ id: z.enum(['bff', 'new-api', 'cpa', 'docs']), name: z.string(), category: z.string(), url: z.string().url(), state: serviceStateSchema, credentialConfigured: z.boolean(), credentialValueAvailable: z.literal(false), checkedAt: z.string().datetime(), detail: z.string() })).length(4) }),
  retention: z.object({ source: sourceStateSchema, cleanupJobVerified: z.literal(false), items: z.array(z.object({ id: z.string(), label: z.string(), days: z.number().int().nonnegative(), appliesTo: z.string(), cleanupState: z.enum(['not_configured', 'unverified']), minimumNecessary: z.boolean() })) }),
  features: z.object({ source: z.literal('database'), items: z.array(z.object({ id: z.string(), label: z.string(), enabled: z.boolean(), editable: z.literal(false), reason: z.string(), risk: z.enum(['low', 'medium', 'high']) })) }),
  backup: z.object({ source: sourceStateSchema, configured: z.literal(false), storageTargetConfigured: z.literal(false), lastBackupAt: z.null(), lastVerifiedAt: z.null(), lastRestoreDrillAt: z.null(), browserDownloadAllowed: z.literal(false), notice: z.string() }),
})

export type SettingsResponse = z.infer<typeof settingsResponseSchema>
export type SettingsSection = 'organization' | 'business' | 'connections' | 'retention' | 'features' | 'backup'
export class SettingsApiError extends Error { constructor(message: string, readonly requestId?: string) { super(message) } }
export async function fetchSettings(signal?: AbortSignal) { const response = await fetch('/api/settings', { headers: { accept: 'application/json' }, signal }); const requestId = response.headers.get('x-request-id') ?? undefined; if (!response.ok) throw new SettingsApiError('系统设置暂时无法加载', requestId); const parsed = settingsResponseSchema.safeParse(await response.json()); if (!parsed.success) throw new SettingsApiError('系统设置格式不符合接口约定', requestId); return parsed.data }
