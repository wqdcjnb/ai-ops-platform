import { z } from 'zod'

const severitySchema = z.enum(['critical', 'warning', 'info'])
const statusSchema = z.enum(['open', 'acknowledged', 'closed'])
const sourceSchema = z.enum(['quota', 'traffic', 'error_rate', 'balance', 'credential', 'upstream'])
const environmentSchema = z.enum(['production', 'experiment'])
const channelSchema = z.enum(['none', 'wecom', 'dingtalk'])

export const alertFiltersSchema = z.object({ search: z.string().max(80), severity: z.union([z.literal('all'), severitySchema]), status: z.union([z.literal('all'), statusSchema]), source: z.union([z.literal('all'), sourceSchema]), environment: z.union([z.literal('all'), environmentSchema]), page: z.number().int().positive(), pageSize: z.number().int().min(5).max(50) })

export const alertEventSchema = z.object({
  id: z.string(), title: z.string(), summary: z.string(), severity: severitySchema, status: statusSchema, environment: environmentSchema, source: sourceSchema,
  subject: z.object({ type: z.enum(['company', 'department', 'person', 'key', 'channel', 'upstream']), id: z.string(), name: z.string() }),
  rule: z.object({ id: z.string(), name: z.string(), metric: z.string(), thresholdLabel: z.string() }),
  trigger: z.object({ valueLabel: z.string(), comparator: z.enum(['gte', 'gt', 'lte', 'eq']) }),
  firstOccurredAt: z.string().datetime(), lastOccurredAt: z.string().datetime(), occurrences: z.number().int().positive(),
  assignee: z.object({ id: z.string(), name: z.string() }).nullable(), acknowledgedAt: z.string().datetime().nullable(), closedAt: z.string().datetime().nullable(),
  notification: z.object({ state: z.enum(['not_configured', 'not_sent', 'sent', 'failed']), channel: channelSchema, sentAt: z.string().datetime().nullable() }),
  silence: z.object({ active: z.boolean(), until: z.string().datetime().nullable() }), relatedRequestIds: z.array(z.string().regex(/^req-[a-z0-9-]+$/)),
})

const metaSchema = z.object({ source: z.literal('database'), simulated: z.literal(true), generatedAt: z.string().datetime(), notice: z.string() })
const notificationConfigSchema = z.object({ configured: z.literal(false), channels: z.array(z.object({ type: z.enum(['wecom', 'dingtalk']), state: z.literal('not_configured') })), notice: z.string() })

export const alertSummaryResponseSchema = z.object({ meta: metaSchema, summary: z.object({ open: z.number().int().nonnegative(), critical: z.number().int().nonnegative(), warning: z.number().int().nonnegative(), experiment: z.number().int().nonnegative(), acknowledged: z.number().int().nonnegative(), closed: z.number().int().nonnegative() }), notificationConfig: notificationConfigSchema })
export const alertsResponseSchema = z.object({ meta: metaSchema, options: z.object({ sources: z.array(z.object({ id: sourceSchema, label: z.string() })) }), items: z.array(alertEventSchema), pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }) })
export const alertRuleSchema = z.object({ id: z.string(), name: z.string(), category: sourceSchema, severity: severitySchema, enabled: z.boolean(), environment: environmentSchema, scope: z.string(), condition: z.string(), window: z.string(), cooldownMinutes: z.number().int().nonnegative(), notification: z.object({ configured: z.literal(false), channel: channelSchema }), lastTriggeredAt: z.string().datetime().nullable(), triggerCount7d: z.number().int().nonnegative(), description: z.string() })
export const alertRulesResponseSchema = z.object({ meta: metaSchema, items: z.array(alertRuleSchema), notificationConfig: notificationConfigSchema })
export const alertDetailResponseSchema = z.object({ meta: metaSchema, item: alertEventSchema, analysis: z.object({ cause: z.string(), impact: z.string(), recommendation: z.string(), rawUpstreamBodyAvailable: z.literal(false) }), timeline: z.array(z.object({ id: z.string(), type: z.enum(['detected', 'notification', 'acknowledged', 'closed']), occurredAt: z.string().datetime(), title: z.string(), description: z.string() })) })

export type AlertFilters = z.infer<typeof alertFiltersSchema>
export type AlertEvent = z.infer<typeof alertEventSchema>
export type AlertSummary = z.infer<typeof alertSummaryResponseSchema>
export type AlertsResponse = z.infer<typeof alertsResponseSchema>
export type AlertRules = z.infer<typeof alertRulesResponseSchema>
export type AlertDetail = z.infer<typeof alertDetailResponseSchema>

export class AlertsApiError extends Error { constructor(message: string, readonly requestId?: string) { super(message) } }
async function getResource<T>(url: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> { const response = await fetch(url, { headers: { accept: 'application/json' }, signal }); const requestId = response.headers.get('x-request-id') ?? undefined; if (!response.ok) throw new AlertsApiError(response.status === 404 ? '未找到指定告警事件' : '告警中心暂时无法加载', requestId); const parsed = schema.safeParse(await response.json()); if (!parsed.success) throw new AlertsApiError('告警数据格式不符合接口约定', requestId); return parsed.data }

export function fetchAlertSummary(signal?: AbortSignal) { return getResource('/api/alerts/summary', alertSummaryResponseSchema, signal) }
export function fetchAlerts(filters: AlertFilters, signal?: AbortSignal) { const value = alertFiltersSchema.parse(filters); const params = new URLSearchParams(Object.entries(value).map(([key, item]) => [key, String(item)])); return getResource(`/api/alerts?${params}`, alertsResponseSchema, signal) }
export function fetchAlertRules(signal?: AbortSignal) { return getResource('/api/alert-rules', alertRulesResponseSchema, signal) }
export function fetchAlertDetail(id: string, signal?: AbortSignal) { return getResource(`/api/alerts/${encodeURIComponent(id)}`, alertDetailResponseSchema, signal) }
