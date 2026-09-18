import { z } from 'zod'
import { withCsrfHeader } from './csrf'

const reservationItemSchema = z.object({
  id: z.string(), nodeId: z.string(), nodeName: z.string(), points: z.number().int().positive(), concurrentUnits: z.number().int().positive(),
  status: z.enum(['reserved', 'settled', 'cancelled']), actor: z.object({ id: z.string(), name: z.string() }).nullable(),
  requestedAt: z.string(), settledAt: z.string().nullable(), cancelledAt: z.string().nullable(),
})
export const quotaReservationsResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), generatedAt: z.string(), notice: z.string() }),
  scope: z.object({ canDecide: z.boolean() }),
  items: z.array(reservationItemSchema),
  summary: z.object({ total: z.number().int().nonnegative(), reserved: z.number().int().nonnegative(), settled: z.number().int().nonnegative(), cancelled: z.number().int().nonnegative() }),
})
export const quotaReservationBodySchema = z.object({
  nodeId: z.string(), points: z.number().int().min(1).max(1_000_000), concurrentUnits: z.number().int().min(1).max(100),
  reason: z.string().trim().min(8).max(200), acknowledgeSimulation: z.literal(true), idempotencyKey: z.string(),
})
export const quotaReservationActionBodySchema = z.object({
  action: z.enum(['settle', 'cancel']), reason: z.string().trim().min(8).max(200), acknowledgeSimulation: z.literal(true), idempotencyKey: z.string(),
})
export const quotaReservationActionResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), completedAt: z.string(), notice: z.string() }), reservation: reservationItemSchema,
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})

export type QuotaReservation = z.infer<typeof reservationItemSchema>
export type QuotaReservationsResponse = z.infer<typeof quotaReservationsResponseSchema>
export type QuotaReservationBody = z.infer<typeof quotaReservationBodySchema>
export type QuotaReservationActionBody = z.infer<typeof quotaReservationActionBodySchema>
export type QuotaReservationActionResponse = z.infer<typeof quotaReservationActionResponseSchema>

export class QuotaReservationsApiError extends Error { constructor(message: string, readonly requestId?: string) { super(message); this.name = 'QuotaReservationsApiError' } }
async function parse<T>(response: Response, schema: z.ZodType<T>, fallback: string): Promise<T> {
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) { const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null; throw new QuotaReservationsApiError(detail?.error?.message ?? fallback, requestId) }
  const result = schema.safeParse(await response.json())
  if (!result.success) throw new QuotaReservationsApiError('并发预留演练响应格式不符合接口约定', requestId)
  return result.data
}

export function fetchQuotaReservations(nodeId: string, signal?: AbortSignal) {
  return fetch(`/api/quota-reservations?${new URLSearchParams({ nodeId })}`, { headers: { accept: 'application/json' }, signal }).then((response) => parse(response, quotaReservationsResponseSchema, '并发预留演练暂时无法加载'))
}
export function createQuotaReservation(body: QuotaReservationBody) {
  const value = quotaReservationBodySchema.parse(body)
  return fetch('/api/quota-reservations', { method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(value) }).then((response) => parse(response, quotaReservationActionResponseSchema, '创建并发预留演练失败'))
}
export function updateQuotaReservation(id: string, body: QuotaReservationActionBody) {
  const value = quotaReservationActionBodySchema.parse(body)
  return fetch(`/api/quota-reservations/${encodeURIComponent(id)}`, { method: 'PATCH', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(value) }).then((response) => parse(response, quotaReservationActionResponseSchema, '更新并发预留演练失败'))
}
