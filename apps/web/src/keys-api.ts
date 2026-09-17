import { z } from 'zod'
import { withCsrfHeader } from './csrf'

export const keyFiltersSchema = z.object({
  search: z.string(), owner: z.string(), purpose: z.string(), model: z.string(),
  status: z.enum(['all', 'active', 'disabled', 'expiring']), page: z.number().int().positive(), pageSize: z.number().int().positive().max(50),
})

const keyListItemSchema = z.object({
  id: z.string(), masked: z.string(), owner: z.object({ id: z.string(), name: z.string(), department: z.string(), initials: z.string() }),
  purpose: z.string(), models: z.array(z.string()), status: z.enum(['active', 'disabled']), expiryState: z.enum(['normal', 'expiring', 'expired']),
  expiresAt: z.string(), lastUsedAt: z.string().nullable(), usage: z.object({ requests: z.number().int().nonnegative(), points: z.number().int().nonnegative() }),
})

const connectionSchema = z.object({ baseUrl: z.string().url(), note: z.string() })

export const keysResponseSchema = z.object({
  meta: z.object({ source: z.enum(['demo', 'database']), generatedAt: z.string(), timezone: z.literal('Asia/Shanghai'), notice: z.string() }),
  summary: z.object({ total: z.number().int().nonnegative(), active: z.number().int().nonnegative(), disabled: z.number().int().nonnegative(), expiring: z.number().int().nonnegative() }),
  options: z.object({ owners: z.array(z.object({ id: z.string(), name: z.string() })), purposes: z.array(z.string()), models: z.array(z.string()) }),
  connection: connectionSchema,
  items: z.array(keyListItemSchema), page: z.number().int().positive(), pageSize: z.number().int().positive(), total: z.number().int().nonnegative(),
})

export const keyDetailResponseSchema = z.object({
  meta: z.object({ source: z.enum(['demo', 'database']), generatedAt: z.string(), timezone: z.literal('Asia/Shanghai') }),
  key: keyListItemSchema.extend({
    createdAt: z.string(), deviceNote: z.string(), allowedIps: z.array(z.string()),
    limits: z.object({ rpm: z.number().int().positive(), tpm: z.number().int().positive(), concurrent: z.number().int().positive() }),
  }),
  connection: connectionSchema.extend({ instructions: z.array(z.string()) }),
})

export type KeyFilters = z.infer<typeof keyFiltersSchema>
export type KeysResponse = z.infer<typeof keysResponseSchema>
export type KeyListItem = KeysResponse['items'][number]
export type KeyDetailResponse = z.infer<typeof keyDetailResponseSchema>
export const keyCreateBodySchema = z.object({
  ownerId: z.string().regex(/^person-[a-z0-9-]+$/).max(96),
  purpose: z.string().trim().min(2).max(40),
  models: z.array(z.string().trim().min(2).max(64)).min(1).max(8),
  expiresInDays: z.number().int().min(1).max(365),
  deviceNote: z.string().trim().max(120),
})
export const keyCreateResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), createdAt: z.string(), notice: z.string() }),
  key: z.object({ id: z.string(), masked: z.string(), owner: z.object({ id: z.string(), name: z.string(), department: z.string() }), purpose: z.string(), models: z.array(z.string()), expiresAt: z.string() }),
  secret: z.string().min(20),
})
export const keyDisableBodySchema = z.object({
  idempotencyKey: z.string().regex(/^key-disable-[a-z0-9-]{8,96}$/),
  reason: z.string().trim().min(8).max(200),
  acknowledgeImpact: z.literal(true),
})
export const keyDisableResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), completedAt: z.string(), notice: z.string() }),
  key: z.object({ id: z.string(), masked: z.string(), status: z.literal('disabled') }),
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})
export const keyRotateBodySchema = z.object({
  idempotencyKey: z.string().regex(/^key-rotate-[a-z0-9-]{8,96}$/),
  reason: z.string().trim().min(8).max(200),
  expiresInDays: z.number().int().min(1).max(365),
  acknowledgeImpact: z.literal(true),
})
export const keyRotateResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), completedAt: z.string(), notice: z.string(), secretAvailable: z.boolean() }),
  oldKey: z.object({ id: z.string(), masked: z.string(), status: z.literal('disabled') }),
  key: z.object({ id: z.string(), masked: z.string(), owner: z.object({ id: z.string(), name: z.string(), department: z.string() }), purpose: z.string(), models: z.array(z.string()), expiresAt: z.string() }),
  secret: z.string().min(20).nullable(),
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})
export type KeyCreateBody = z.infer<typeof keyCreateBodySchema>
export type KeyCreateResponse = z.infer<typeof keyCreateResponseSchema>
export type KeyDisableBody = z.infer<typeof keyDisableBodySchema>
export type KeyDisableResponse = z.infer<typeof keyDisableResponseSchema>
export type KeyRotateBody = z.infer<typeof keyRotateBodySchema>
export type KeyRotateResponse = z.infer<typeof keyRotateResponseSchema>

export class KeysApiError extends Error {
  constructor(message: string, readonly requestId?: string) { super(message); this.name = 'KeysApiError' }
}

async function getResource<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' }, signal })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (response.status === 404) throw new KeysApiError('未找到指定 Key', requestId)
  if (!response.ok) throw new KeysApiError('Key 数据暂时无法加载', requestId)
  const result = schema.safeParse(await response.json())
  if (!result.success) throw new KeysApiError('Key 数据格式不符合接口约定', requestId)
  return result.data
}

export function fetchKeys(filters: KeyFilters, signal?: AbortSignal) {
  const value = keyFiltersSchema.parse(filters)
  const query = new URLSearchParams({ ...value, page: String(value.page), pageSize: String(value.pageSize) })
  return getResource(`/api/keys?${query}`, keysResponseSchema, signal)
}

export function fetchKeyDetail(id: string, signal?: AbortSignal) {
  return getResource(`/api/keys/${encodeURIComponent(id)}`, keyDetailResponseSchema, signal)
}

export async function createKey(payload: KeyCreateBody): Promise<KeyCreateResponse> {
  const body = keyCreateBodySchema.parse(payload)
  const response = await fetch('/api/keys', { method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(body) })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new KeysApiError(detail?.error?.message ?? '创建 Key 失败', requestId)
  }
  const result = keyCreateResponseSchema.safeParse(await response.json())
  if (!result.success) throw new KeysApiError('创建 Key 响应格式不符合接口约定', requestId)
  return result.data
}

export async function disableKey(id: string, payload: KeyDisableBody): Promise<KeyDisableResponse> {
  const body = keyDisableBodySchema.parse(payload)
  const response = await fetch(`/api/keys/${encodeURIComponent(id)}/disable`, { method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(body) })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new KeysApiError(detail?.error?.message ?? '停用 Key 失败', requestId)
  }
  const result = keyDisableResponseSchema.safeParse(await response.json())
  if (!result.success) throw new KeysApiError('停用 Key 响应格式不符合接口约定', requestId)
  return result.data
}

export async function rotateKey(id: string, payload: KeyRotateBody): Promise<KeyRotateResponse> {
  const body = keyRotateBodySchema.parse(payload)
  const response = await fetch(`/api/keys/${encodeURIComponent(id)}/rotate`, { method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(body) })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new KeysApiError(detail?.error?.message ?? '轮换 Key 失败', requestId)
  }
  const result = keyRotateResponseSchema.safeParse(await response.json())
  if (!result.success) throw new KeysApiError('轮换 Key 响应格式不符合接口约定', requestId)
  return result.data
}
