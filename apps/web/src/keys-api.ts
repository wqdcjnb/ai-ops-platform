import { z } from 'zod'

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
  meta: z.object({ source: z.literal('demo'), generatedAt: z.string(), timezone: z.literal('Asia/Shanghai'), notice: z.string() }),
  summary: z.object({ total: z.number().int().nonnegative(), active: z.number().int().nonnegative(), disabled: z.number().int().nonnegative(), expiring: z.number().int().nonnegative() }),
  options: z.object({ owners: z.array(z.object({ id: z.string(), name: z.string() })), purposes: z.array(z.string()), models: z.array(z.string()) }),
  connection: connectionSchema,
  items: z.array(keyListItemSchema), page: z.number().int().positive(), pageSize: z.number().int().positive(), total: z.number().int().nonnegative(),
})

export const keyDetailResponseSchema = z.object({
  meta: z.object({ source: z.literal('demo'), generatedAt: z.string(), timezone: z.literal('Asia/Shanghai') }),
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
