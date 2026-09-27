import { z } from 'zod'
import { withCsrfHeader } from './csrf'

const keySchema = z.object({ id: z.string(), masked: z.string(), status: z.enum(['active', 'expiring']), createdAt: z.string(), lastUsedAt: z.string().nullable() })
const deviceSetupTargetSchema = z.enum(['codex', 'workbuddy'])
const deviceSetupTicketSchema = z.object({
  id: z.string(),
  target: deviceSetupTargetSchema,
  state: z.enum(['pending', 'claimed', 'succeeded', 'failed', 'expired']),
  expiresAt: z.string(),
  completedAt: z.string().nullable().optional(),
  failureMessage: z.string().nullable().optional(),
})
export const employeePortalKeyResponseSchema = z.object({
  key: keySchema.nullable(),
  /** Present only for the signed-in employee who owns this Key. */
  secret: z.string().min(24).nullable(),
  model: z.object({ id: z.literal('ai-ops'), name: z.literal('AI OPS') }),
  gateway: z.object({ baseUrl: z.string().url() }),
  requestId: z.string(),
})
export const employeePortalKeyIssueResponseSchema = employeePortalKeyResponseSchema.extend({ secret: z.string().min(24) })
export type EmployeePortalKeyResponse = z.infer<typeof employeePortalKeyResponseSchema>
export type EmployeePortalKeyIssueResponse = z.infer<typeof employeePortalKeyIssueResponseSchema>
export type DeviceSetupTarget = z.infer<typeof deviceSetupTargetSchema>
export type DeviceSetupTicket = z.infer<typeof deviceSetupTicketSchema>

const deviceSetupTicketCreateResponseSchema = z.object({
  ticket: deviceSetupTicketSchema,
  launchUrl: z.string().startsWith('aiops://'),
  requestId: z.string(),
})
const deviceSetupTicketStatusResponseSchema = z.object({ ticket: deviceSetupTicketSchema, requestId: z.string() })

export class EmployeePortalApiError extends Error {
  constructor(message: string, readonly requestId?: string) { super(message); this.name = 'EmployeePortalApiError' }
}

async function parse<T>(response: Response, schema: z.ZodType<T>, fallback: string): Promise<T> {
  const requestId = response.headers.get('x-request-id') ?? undefined
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null
  if (!response.ok) throw new EmployeePortalApiError(body?.error?.message ?? fallback, requestId)
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new EmployeePortalApiError(`${fallback}：接口数据格式不正确`, requestId)
  return parsed.data
}

export async function fetchEmployeePortalKey(signal?: AbortSignal) {
  return parse(await fetch('/api/me/key', { headers: { accept: 'application/json' }, signal }), employeePortalKeyResponseSchema, '无法读取平台 Key')
}

function idempotencyKey(action: 'create' | 'reset') {
  return `employee-key-${action}-${crypto.randomUUID()}`
}

export async function createEmployeePortalKey() {
  return parse(await fetch('/api/me/key', { method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify({ idempotencyKey: idempotencyKey('create') }) }), employeePortalKeyIssueResponseSchema, '无法创建平台 Key')
}

export async function resetEmployeePortalKey() {
  return parse(await fetch('/api/me/key/reset', { method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify({ idempotencyKey: idempotencyKey('reset') }) }), employeePortalKeyIssueResponseSchema, '无法重置平台 Key')
}

export async function createDeviceSetupTicket(target: DeviceSetupTarget) {
  return parse(await fetch('/api/me/device-setup-tickets', {
    method: 'POST',
    headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }),
    body: JSON.stringify({ target }),
  }), deviceSetupTicketCreateResponseSchema, '无法创建本机配置请求')
}

export async function fetchDeviceSetupTicket(id: string) {
  return parse(await fetch(`/api/me/device-setup-tickets/${encodeURIComponent(id)}`, { headers: { accept: 'application/json' } }), deviceSetupTicketStatusResponseSchema, '无法读取本机配置状态')
}
