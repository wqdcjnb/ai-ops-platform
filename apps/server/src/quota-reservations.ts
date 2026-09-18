import { z } from 'zod'
import type { PlatformDatabase, PlatformQuotaReservation, PlatformQuotaReservationStatus } from './platform-db.js'

export const quotaReservationQuerySchema = z.object({
  nodeId: z.string().regex(/^(company|department|person|purpose|key)-[a-z0-9-]+$/).optional(),
  status: z.enum(['all', 'reserved', 'settled', 'cancelled']).default('all'),
})

export const quotaReservationParamsSchema = z.object({ id: z.string().regex(/^quota-reservation-[a-z0-9-]+$/) })

export const quotaReservationBodySchema = z.object({
  nodeId: z.string().regex(/^(company|department|person|purpose|key)-[a-z0-9-]+$/),
  points: z.coerce.number().int().min(1).max(1_000_000),
  concurrentUnits: z.coerce.number().int().min(1).max(100),
  reason: z.string().trim().min(8).max(200),
  acknowledgeSimulation: z.literal(true),
  idempotencyKey: z.string().regex(/^quota-reservation-[a-z0-9-]{8,96}$/),
})

export const quotaReservationActionBodySchema = z.object({
  action: z.enum(['settle', 'cancel']),
  reason: z.string().trim().min(8).max(200),
  acknowledgeSimulation: z.literal(true),
  idempotencyKey: z.string().regex(/^quota-reservation-(settle|cancel)-[a-z0-9-]{8,96}$/),
})

const reservationItemSchema = z.object({
  id: z.string(), nodeId: z.string(), nodeName: z.string(), points: z.number().int().positive(), concurrentUnits: z.number().int().positive(),
  status: z.enum(['reserved', 'settled', 'cancelled']), actor: z.object({ id: z.string(), name: z.string() }).nullable(),
  requestedAt: z.string().datetime(), settledAt: z.string().datetime().nullable(), cancelledAt: z.string().datetime().nullable(),
})

export const quotaReservationsResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), generatedAt: z.string().datetime(), notice: z.string() }),
  scope: z.object({ canDecide: z.boolean() }),
  items: z.array(reservationItemSchema),
  summary: z.object({ total: z.number().int().nonnegative(), reserved: z.number().int().nonnegative(), settled: z.number().int().nonnegative(), cancelled: z.number().int().nonnegative() }),
})

export const quotaReservationActionResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), completedAt: z.string().datetime(), notice: z.string() }),
  reservation: reservationItemSchema,
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})

export type QuotaReservationQuery = z.infer<typeof quotaReservationQuerySchema>
export type QuotaReservationBody = z.infer<typeof quotaReservationBodySchema>
export type QuotaReservationActionBody = z.infer<typeof quotaReservationActionBodySchema>
export type QuotaReservationsResponse = z.infer<typeof quotaReservationsResponseSchema>
export type QuotaReservationActionResponse = z.infer<typeof quotaReservationActionResponseSchema>

export function mapQuotaReservation(item: PlatformQuotaReservation) {
  return {
    id: item.id, nodeId: item.nodeId, nodeName: item.nodeName, points: item.points, concurrentUnits: item.concurrentUnits,
    status: item.status, actor: item.actorUserId && item.actorName ? { id: item.actorUserId, name: item.actorName } : null,
    requestedAt: item.requestedAt, settledAt: item.settledAt, cancelledAt: item.cancelledAt,
  }
}

export function createQuotaReservationsResponse(database: PlatformDatabase, query: QuotaReservationQuery, scope = { canDecide: true }): QuotaReservationsResponse {
  const items = database.listQuotaReservations({ nodeId: query.nodeId, ...(query.status !== 'all' ? { status: query.status as PlatformQuotaReservationStatus } : {}) }).map(mapQuotaReservation)
  return {
    meta: { source: 'database', generatedAt: new Date().toISOString(), notice: '本地 SQLite 预留演练；不会阻断请求、调用 New API 或改变真实网关额度。' },
    scope,
    items,
    summary: {
      total: items.length,
      reserved: items.filter((item) => item.status === 'reserved').length,
      settled: items.filter((item) => item.status === 'settled').length,
      cancelled: items.filter((item) => item.status === 'cancelled').length,
    },
  }
}
