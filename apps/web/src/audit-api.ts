import { z } from 'zod'

const periodSchema = z.enum(['today', '7d', '30d'])
const actionSchema = z.enum(['login', 'logout', 'access', 'create', 'update', 'disable', 'rotate', 'export', 'acknowledge', 'verify', 'view'])
const resourceTypeSchema = z.enum(['session', 'authorization', 'person', 'key', 'quota', 'route', 'channel', 'upstream', 'export', 'settings', 'alert', 'conversation'])
const resultStatusSchema = z.enum(['success', 'failed', 'denied'])
const sourceTypeSchema = z.enum(['web', 'api', 'system'])
const integritySchema = z.object({ deletionAllowed: z.literal(false), appendOnlyVerified: z.literal(false), verified: z.boolean(), hashChainVerified: z.boolean(), checkpointVerified: z.boolean(), algorithm: z.enum(['sha256', 'not_configured']), checkedAt: z.string().datetime().nullable(), checkpointUpdatedAt: z.string().datetime().nullable(), eventCount: z.number().int().nonnegative(), firstInvalidEventId: z.string().nullable(), notice: z.string() })

export const auditFiltersSchema = z.object({ period: periodSchema, search: z.string().max(80), eventId: z.union([z.literal(''), z.string().regex(/^audit-[a-z0-9-]{1,80}$/)]).default(''), actor: z.string(), action: z.union([z.literal('all'), actionSchema]), resource: z.union([z.literal('all'), resourceTypeSchema]), result: z.union([z.literal('all'), resultStatusSchema]), source: z.union([z.literal('all'), sourceTypeSchema]), page: z.number().int().positive(), pageSize: z.number().int().min(5).max(50) })

const changeSchema = z.object({ field: z.string(), label: z.string(), before: z.string().nullable(), after: z.string().nullable(), sensitive: z.boolean() })
export const auditEventSchema = z.object({
  id: z.string(), occurredAt: z.string().datetime(), actor: z.object({ id: z.string(), name: z.string(), role: z.enum(['super_admin', 'admin', 'department_lead', 'finance', 'employee', 'system']) }), action: actionSchema, actionLabel: z.string(),
  resource: z.object({ type: resourceTypeSchema, id: z.string(), name: z.string() }), result: z.object({ status: resultStatusSchema, code: z.string() }),
  source: z.object({ type: sourceTypeSchema, label: z.string(), ipMasked: z.string().nullable(), client: z.string() }), requestId: z.string().regex(/^req-[a-z0-9-]+$/), summary: z.string(), changes: z.array(changeSchema), contentAvailable: z.literal(false), credentialValueAvailable: z.literal(false),
})
const metaSchema = z.object({ source: z.enum(['demo', 'database']), generatedAt: z.string().datetime(), period: periodSchema, notice: z.string() })
export const auditResponseSchema = z.object({ meta: metaSchema, summary: z.object({ total: z.number().int().nonnegative(), success: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), denied: z.number().int().nonnegative(), sensitiveChanges: z.number().int().nonnegative() }), options: z.object({ actors: z.array(z.object({ id: z.string(), label: z.string() })) }), items: z.array(auditEventSchema), pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }), retention: z.object({ mode: z.enum(['demo', 'database']), deletionAllowed: z.literal(false), appendOnlyVerified: z.literal(false), notice: z.string() }), integrity: integritySchema })
export const auditDetailResponseSchema = z.object({ meta: z.object({ source: z.enum(['demo', 'database']), generatedAt: z.string().datetime(), notice: z.string() }), event: auditEventSchema, request: z.object({ requestId: z.string(), traceState: z.enum(['demo_unverified', 'database_unverified']), responseCode: z.number().int().min(100).max(599), durationMs: z.number().int().nonnegative() }), integrity: integritySchema, relatedAuditIds: z.array(z.string().regex(/^audit-[a-z0-9-]+$/)) })

export type AuditFilters = z.infer<typeof auditFiltersSchema>
export type AuditEvent = z.infer<typeof auditEventSchema>
export type AuditResponse = z.infer<typeof auditResponseSchema>
export type AuditDetail = z.infer<typeof auditDetailResponseSchema>

export class AuditApiError extends Error { constructor(message: string, readonly requestId?: string) { super(message) } }
async function getResource<T>(url: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> { const response = await fetch(url, { headers: { accept: 'application/json' }, signal }); const requestId = response.headers.get('x-request-id') ?? undefined; if (!response.ok) throw new AuditApiError(response.status === 404 ? '未找到指定审计事件' : '审计日志暂时无法加载', requestId); const parsed = schema.safeParse(await response.json()); if (!parsed.success) throw new AuditApiError('审计数据格式不符合接口约定', requestId); return parsed.data }

export function fetchAuditEvents(filters: AuditFilters, signal?: AbortSignal) { const value = auditFiltersSchema.parse(filters); const params = new URLSearchParams(Object.entries(value).map(([key, item]) => [key, String(item)])); return getResource(`/api/audit-events?${params}`, auditResponseSchema, signal) }
export function fetchAuditDetail(id: string, signal?: AbortSignal) { return getResource(`/api/audit-events/${encodeURIComponent(id)}`, auditDetailResponseSchema, signal) }
