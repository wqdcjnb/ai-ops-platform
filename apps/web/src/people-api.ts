import { z } from 'zod'
import { withCsrfHeader } from './csrf'

const keyMaskSchema = z.string().nullable().optional()
export const personSchema = z.object({
  id: z.string(),
  name: z.string(),
  initials: z.string(),
  title: z.string(),
  manager: z.string(),
  status: z.enum(['active', 'disabled', 'offboarding', 'unknown', 'external_missing']),
  username: z.string().nullable().optional(),
  createdAt: z.string().datetime().nullable().optional(),
  lastUsedAt: z.string().datetime().nullable().optional(),
  apiKeyMasked: keyMaskSchema,
  keyCount: z.number().int().nonnegative(),
  goal: z.object({ used: z.number(), limit: z.number(), percent: z.number(), state: z.literal('normal') }),
  lastActiveAt: z.string().datetime().nullable(),
  tone: z.enum(['coral', 'blue', 'violet', 'green', 'amber']),
})

export const peopleFiltersSchema = z.object({
  search: z.string().trim().max(60).default(''),
  status: z.enum(['all', 'active', 'disabled']).default('all'),
  goal: z.literal('all').default('all'),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
})

export const peopleResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), generatedAt: z.string().datetime(), timezone: z.literal('Asia/Shanghai'), notice: z.string() }),
  summary: z.object({ total: z.number().int().nonnegative(), active: z.number().int().nonnegative(), disabled: z.number().int().nonnegative(), offboarding: z.number().int().nonnegative() }),
  items: z.array(personSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
})

const actionBodySchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
  acknowledgeImpact: z.literal(true),
})
const deleteBodySchema = actionBodySchema.extend({ reason: z.literal('').default('') })
const actionResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), completedAt: z.string().datetime(), notice: z.string() }),
  person: z.object({ id: z.string(), name: z.string(), apiKeyMasked: z.string().nullable().optional() }).passthrough(),
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
}).passthrough()

export type PeopleFilters = z.input<typeof peopleFiltersSchema>
export type PeopleResponse = z.infer<typeof peopleResponseSchema>
export type Person = z.infer<typeof personSchema>
export type PersonActionBody = z.infer<typeof actionBodySchema>
export type PersonDeleteBody = z.infer<typeof deleteBodySchema>

export class PeopleApiError extends Error {
  constructor(message: string, readonly requestId?: string) { super(message); this.name = 'PeopleApiError' }
}

async function parse<T>(response: Response, schema: z.ZodType<T>, fallback: string): Promise<T> {
  const requestId = response.headers.get('x-request-id') ?? undefined
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null
  if (!response.ok) throw new PeopleApiError(body?.error?.message ?? fallback, requestId)
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new PeopleApiError(`${fallback}：接口数据格式不正确`, requestId)
  return parsed.data
}

export async function fetchPeople(filters: PeopleFilters, signal?: AbortSignal): Promise<PeopleResponse> {
  const value = peopleFiltersSchema.parse(filters)
  return parse(await fetch(`/api/people?${new URLSearchParams(Object.entries(value).map(([key, item]) => [key, String(item)]))}`, { headers: { accept: 'application/json' }, signal }), peopleResponseSchema, '人员信息暂时无法加载')
}

async function personAction(path: string, body: PersonActionBody | PersonDeleteBody, fallback: string) {
  const value = path.endsWith('/delete') ? deleteBodySchema.parse(body) : actionBodySchema.parse(body)
  return parse(await fetch(path, { method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(value) }), actionResponseSchema, fallback)
}

export const disablePerson = (id: string, body: PersonActionBody) => personAction(`/api/people/${encodeURIComponent(id)}/disable`, body, '无法停用员工')
export const enablePerson = (id: string, body: PersonActionBody) => personAction(`/api/people/${encodeURIComponent(id)}/enable`, body, '无法启用员工')
export const deletePerson = (id: string, body: PersonDeleteBody) => personAction(`/api/people/${encodeURIComponent(id)}/delete`, body, '无法删除员工')
export const resetPersonPassword = (id: string, body: PersonActionBody) => personAction(`/api/people/${encodeURIComponent(id)}/reset-password`, body, '无法重置登录密码')
export const resetPersonKey = (id: string, body: PersonActionBody) => personAction(`/api/people/${encodeURIComponent(id)}/reset-key`, body, '无法重置平台 Key')
