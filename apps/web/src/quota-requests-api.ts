import { z } from 'zod'
import { withCsrfHeader } from './csrf'

const requestItemSchema = z.object({
  id: z.string(), requester: z.object({ id: z.string(), name: z.string(), department: z.string() }),
  targetPoints: z.number().int().positive(), durationHours: z.number().int().positive(), reasonLength: z.number().int().min(8).max(200),
  status: z.enum(['pending', 'approved', 'rejected', 'expired', 'cancelled']), requestedAt: z.string(), decidedAt: z.string().nullable(),
  approver: z.object({ id: z.string(), name: z.string() }).nullable(), decisionReasonLength: z.number().int().min(8).max(200).nullable(), expiresAt: z.string().nullable(), approvedPoints: z.number().int().positive().nullable(),
})
export const quotaRequestsResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), generatedAt: z.string(), notice: z.string() }),
  scope: z.object({ mode: z.enum(['global', 'department', 'self']), departmentId: z.string().nullable(), canDecide: z.boolean(), notice: z.string() }),
  summary: z.object({ total: z.number().int().nonnegative(), pending: z.number().int().nonnegative(), active: z.number().int().nonnegative(), rejected: z.number().int().nonnegative(), expired: z.number().int().nonnegative() }),
  items: z.array(requestItemSchema),
})
const actionResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), generatedAt: z.string(), completedAt: z.string(), notice: z.string() }),
  request: requestItemSchema, operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})
export const quotaRequestBodySchema = z.object({ targetPoints: z.number().int().min(1).max(1_000_000), durationHours: z.number().int().min(1).max(720), reason: z.string().trim().min(8).max(200), acknowledgeImpact: z.literal(true), idempotencyKey: z.string() })
export const quotaDecisionBodySchema = z.object({ decision: z.enum(['approve', 'reject']), reason: z.string().trim().min(8).max(200), acknowledgeImpact: z.literal(true), idempotencyKey: z.string() })
export type QuotaRequest = z.infer<typeof requestItemSchema>
export type QuotaRequestsResponse = z.infer<typeof quotaRequestsResponseSchema>
export type QuotaRequestBody = z.infer<typeof quotaRequestBodySchema>
export type QuotaDecisionBody = z.infer<typeof quotaDecisionBodySchema>
export type QuotaRequestActionResponse = z.infer<typeof actionResponseSchema>

export class QuotaRequestsApiError extends Error { constructor(message: string, readonly requestId?: string) { super(message); this.name = 'QuotaRequestsApiError' } }
async function parse<T>(response: Response, schema: z.ZodType<T>, fallback: string): Promise<T> {
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) { const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null; throw new QuotaRequestsApiError(detail?.error?.message ?? fallback, requestId) }
  const result = schema.safeParse(await response.json())
  if (!result.success) throw new QuotaRequestsApiError('临时额度申请响应格式不符合接口约定', requestId)
  return result.data
}
export function fetchQuotaRequests(status: 'all' | 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled' = 'all', signal?: AbortSignal) { return fetch(`/api/quota-requests?status=${status}`, { headers: { accept: 'application/json' }, signal }).then((response) => parse(response, quotaRequestsResponseSchema, '临时额度申请暂时无法加载')) }
export function fetchMyQuotaRequests(status: 'all' | 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled' = 'all', signal?: AbortSignal) { return fetch(`/api/me/quota-requests?status=${status}`, { headers: { accept: 'application/json' }, signal }).then((response) => parse(response, quotaRequestsResponseSchema, '我的临时额度申请暂时无法加载')) }
export function createQuotaRequest(body: QuotaRequestBody) { const value = quotaRequestBodySchema.parse(body); return fetch('/api/me/quota-requests', { method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(value) }).then((response) => parse(response, actionResponseSchema, '提交临时额度申请失败')) }
export function decideQuotaRequest(id: string, body: QuotaDecisionBody) { const value = quotaDecisionBodySchema.parse(body); return fetch(`/api/quota-requests/${encodeURIComponent(id)}/decision`, { method: 'PATCH', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(value) }).then((response) => parse(response, actionResponseSchema, '处理临时额度申请失败')) }
