import { z } from 'zod'
import type { PlatformDatabase, TemporaryQuotaRequestStatus } from './platform-db.js'

const databaseMetaSchema = z.object({ source: z.literal('database'), generatedAt: z.string().datetime(), notice: z.string() })
const requestItemSchema = z.object({
  id: z.string(), requester: z.object({ id: z.string(), name: z.string(), department: z.string() }),
  targetPoints: z.number().int().positive(), durationHours: z.number().int().positive(), reasonLength: z.number().int().min(8).max(200),
  status: z.enum(['pending', 'approved', 'rejected', 'expired', 'cancelled']), requestedAt: z.string().datetime(), decidedAt: z.string().datetime().nullable(),
  approver: z.object({ id: z.string(), name: z.string() }).nullable(), decisionReasonLength: z.number().int().min(8).max(200).nullable(),
  expiresAt: z.string().datetime().nullable(), approvedPoints: z.number().int().positive().nullable(),
})

export const quotaRequestQuerySchema = z.object({ status: z.enum(['all', 'pending', 'approved', 'rejected', 'expired', 'cancelled']).default('all') })
export const quotaRequestBodySchema = z.object({
  targetPoints: z.coerce.number().int().min(1).max(1_000_000),
  durationHours: z.coerce.number().int().min(1).max(720),
  reason: z.string().trim().min(8).max(200),
  acknowledgeImpact: z.literal(true),
  idempotencyKey: z.string().regex(/^quota-request-[a-z0-9-]{8,96}$/),
})
export const quotaDecisionBodySchema = z.object({
  decision: z.enum(['approve', 'reject']), reason: z.string().trim().min(8).max(200), acknowledgeImpact: z.literal(true),
  idempotencyKey: z.string().regex(/^quota-decision-[a-z0-9-]{8,96}$/),
})
export const quotaRequestParamsSchema = z.object({ id: z.string().regex(/^quota-request-[a-z0-9-]+$/) })

export const quotaRequestsResponseSchema = z.object({
  meta: databaseMetaSchema,
  scope: z.object({ mode: z.enum(['global', 'department', 'self']), departmentId: z.string().nullable(), canDecide: z.boolean(), notice: z.string() }),
  summary: z.object({ total: z.number().int().nonnegative(), pending: z.number().int().nonnegative(), active: z.number().int().nonnegative(), rejected: z.number().int().nonnegative(), expired: z.number().int().nonnegative() }),
  items: z.array(requestItemSchema),
})
export const quotaRequestActionResponseSchema = z.object({
  meta: databaseMetaSchema.extend({ completedAt: z.string().datetime() }), request: requestItemSchema,
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})

export type QuotaRequestQuery = z.infer<typeof quotaRequestQuerySchema>
export type QuotaRequestBody = z.infer<typeof quotaRequestBodySchema>
export type QuotaDecisionBody = z.infer<typeof quotaDecisionBodySchema>
export type QuotaRequestsResponse = z.infer<typeof quotaRequestsResponseSchema>
export type QuotaRequestActionResponse = z.infer<typeof quotaRequestActionResponseSchema>

function toItem(item: ReturnType<PlatformDatabase['listTemporaryQuotaRequests']>[number]) {
  return {
    id: item.id,
    requester: { id: item.requesterUserId, name: item.requesterName, department: item.departmentName },
    targetPoints: item.targetPoints, durationHours: item.durationHours, reasonLength: item.reasonLength, status: item.status,
    requestedAt: item.requestedAt, decidedAt: item.decidedAt,
    approver: item.approverUserId && item.approverName ? { id: item.approverUserId, name: item.approverName } : null,
    decisionReasonLength: item.decisionReasonLength, expiresAt: item.expiresAt, approvedPoints: item.approvedPoints,
  }
}

export function createQuotaRequestsResponse(database: PlatformDatabase, filter: { requesterUserId?: string; departmentId?: string; status?: TemporaryQuotaRequestStatus }, scope: { mode: 'global' | 'department' | 'self'; departmentId: string | null; canDecide: boolean }, now = new Date()): QuotaRequestsResponse {
  const items = database.listTemporaryQuotaRequests(filter, now)
  const active = items.filter((item) => item.status === 'approved' && item.expiresAt && new Date(item.expiresAt).getTime() > now.getTime()).length
  return {
    meta: { source: 'database', generatedAt: now.toISOString(), notice: '临时额度申请、审批和到期状态仅写入本地 SQLite；批准不会开启硬额度拦截或调用 New API。' },
    scope: { ...scope, notice: scope.mode === 'self' ? '仅展示当前登录员工自己的申请。' : scope.mode === 'department' ? '仅展示当前部门的申请；审批结果仍记录在本地审计链。' : scope.canDecide ? '展示全公司本地申请；审批原因只保存长度，不保存原文。' : '当前身份只读查看全公司申请；审批操作需管理员或部门负责人。' },
    summary: {
      total: items.length, pending: items.filter((item) => item.status === 'pending').length, active,
      rejected: items.filter((item) => item.status === 'rejected').length, expired: items.filter((item) => item.status === 'expired').length,
    },
    items: items.map(toItem),
  }
}
