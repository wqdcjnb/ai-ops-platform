import { z } from 'zod'

export const peopleFilterSchema = z.object({
  search: z.string(),
  department: z.string(),
  status: z.enum(['all', 'active', 'disabled', 'offboarding']),
  goal: z.enum(['all', 'normal', 'near', 'reached']),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(50),
})

export const peopleResponseSchema = z.object({
  meta: z.object({
    source: z.literal('demo'),
    generatedAt: z.string(),
    timezone: z.literal('Asia/Shanghai'),
    notice: z.string(),
  }),
  summary: z.object({
    total: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    disabled: z.number().int().nonnegative(),
    offboarding: z.number().int().nonnegative(),
    departments: z.number().int().nonnegative(),
  }),
  departments: z.array(z.object({
    id: z.string(),
    name: z.string(),
    people: z.number().int().nonnegative(),
    activeKeys: z.number().int().nonnegative(),
    usagePercent: z.number().min(0),
  })),
  items: z.array(z.object({
    id: z.string(),
    name: z.string(),
    initials: z.string(),
    department: z.object({ id: z.string(), name: z.string() }),
    title: z.string(),
    manager: z.string(),
    status: z.enum(['active', 'disabled', 'offboarding']),
    keyCount: z.number().int().nonnegative(),
    purpose: z.string(),
    goal: z.object({
      used: z.number().int().nonnegative(),
      limit: z.number().int().positive(),
      percent: z.number().min(0),
      state: z.enum(['normal', 'near', 'reached']),
    }),
    lastActiveAt: z.string().nullable(),
    tone: z.enum(['coral', 'blue', 'violet', 'green', 'amber']),
  })),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
})

export const personDetailResponseSchema = z.object({
  meta: z.object({ source: z.literal('demo'), generatedAt: z.string(), timezone: z.literal('Asia/Shanghai'), notice: z.string() }),
  profile: z.object({
    id: z.string(), name: z.string(), initials: z.string(), department: z.object({ id: z.string(), name: z.string() }), title: z.string(), manager: z.string(),
    status: z.enum(['active', 'disabled', 'offboarding']), keyCount: z.number().int().nonnegative(), purpose: z.string(),
    goal: z.object({ used: z.number().int().nonnegative(), limit: z.number().int().positive(), percent: z.number().min(0), state: z.enum(['normal', 'near', 'reached']) }),
    lastActiveAt: z.string().nullable(), tone: z.enum(['coral', 'blue', 'violet', 'green', 'amber']),
  }),
  metrics: z.object({
    todayRequests: z.number().int().nonnegative(), monthTokens: z.number().int().nonnegative(), monthPoints: z.number().int().nonnegative(),
    monthPointLimit: z.number().int().positive(), successRate: z.number().min(0).max(100), p95LatencyMs: z.number().int().nonnegative(),
  }),
  keys: z.array(z.object({
    id: z.string(), masked: z.string(), purpose: z.string(), status: z.enum(['active', 'disabled']), models: z.array(z.string()), expiresAt: z.string(), lastUsedAt: z.string().nullable(),
  })),
  models: z.array(z.object({ alias: z.string(), name: z.string(), purpose: z.string(), type: z.enum(['production', 'experiment']), allowed: z.boolean() })),
})

export const personUsageResponseSchema = z.object({
  meta: z.object({ source: z.literal('demo'), generatedAt: z.string(), timezone: z.literal('Asia/Shanghai'), period: z.enum(['7d', '30d']) }),
  items: z.array(z.object({ date: z.string(), requests: z.number().int().nonnegative(), tokens: z.number().int().nonnegative(), points: z.number().int().nonnegative() })),
})

export type PeopleFilters = z.infer<typeof peopleFilterSchema>
export type PeopleResponse = z.infer<typeof peopleResponseSchema>
export type Person = PeopleResponse['items'][number]
export type PersonDetailResponse = z.infer<typeof personDetailResponseSchema>
export type PersonUsageResponse = z.infer<typeof personUsageResponseSchema>
export type PersonUsagePeriod = PersonUsageResponse['meta']['period']

export class PeopleApiError extends Error {
  constructor(message: string, readonly requestId?: string) {
    super(message)
    this.name = 'PeopleApiError'
  }
}

export async function fetchPeople(filters: PeopleFilters, signal?: AbortSignal): Promise<PeopleResponse> {
  const validated = peopleFilterSchema.parse(filters)
  const query = new URLSearchParams({
    search: validated.search,
    department: validated.department,
    status: validated.status,
    goal: validated.goal,
    page: String(validated.page),
    pageSize: String(validated.pageSize),
  })
  const response = await fetch(`/api/people?${query}`, { headers: { accept: 'application/json' }, signal })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw new PeopleApiError('人员数据暂时无法加载', requestId)

  const result = peopleResponseSchema.safeParse(await response.json())
  if (!result.success) throw new PeopleApiError('人员数据格式不符合接口约定', requestId)
  return result.data
}

async function fetchPersonResource<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' }, signal })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (response.status === 404) throw new PeopleApiError('未找到指定人员', requestId)
  if (!response.ok) throw new PeopleApiError('人员详情暂时无法加载', requestId)
  const result = schema.safeParse(await response.json())
  if (!result.success) throw new PeopleApiError('人员详情格式不符合接口约定', requestId)
  return result.data
}

export function fetchPersonDetail(id: string, signal?: AbortSignal) {
  return fetchPersonResource(`/api/people/${encodeURIComponent(id)}`, personDetailResponseSchema, signal)
}

export function fetchPersonUsage(id: string, period: PersonUsagePeriod, signal?: AbortSignal) {
  return fetchPersonResource(`/api/people/${encodeURIComponent(id)}/usage?period=${period}`, personUsageResponseSchema, signal)
}
