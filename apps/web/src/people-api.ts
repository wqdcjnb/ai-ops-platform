import { z } from 'zod'
import { withCsrfHeader } from './csrf'
import { quotaUpdateBodySchema, quotaUpdateResponseSchema, type QuotaUpdateBody, type QuotaUpdateResponse } from './limits-api'

export const peopleFilterSchema = z.object({
  search: z.string(),
  department: z.string(),
  status: z.enum(['all', 'active', 'disabled', 'offboarding', 'unknown', 'external_missing']),
  goal: z.enum(['all', 'normal', 'near', 'reached']),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(50),
})

export const peopleResponseSchema = z.object({
  meta: z.object({
    source: z.enum(['demo', 'database', 'new_api']),
    generatedAt: z.string(),
    timezone: z.literal('Asia/Shanghai'),
    notice: z.string(),
  }),
  summary: z.object({
    total: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    disabled: z.number().int().nonnegative(),
    offboarding: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative().optional(),
    externalMissing: z.number().int().nonnegative().optional(),
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
    status: z.enum(['active', 'disabled', 'offboarding', 'unknown', 'external_missing']),
    username: z.string().nullable().optional(), externalUserId: z.string().nullable().optional(), source: z.enum(['new-api', 'local']).optional(), syncState: z.enum(['synced', 'external_missing', 'stale']).optional(), createdAt: z.string().nullable().optional(), lastUsedAt: z.string().nullable().optional(),
    keyCount: z.number().int().nonnegative(),
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
  meta: z.object({ source: z.enum(['demo', 'database', 'new_api']), generatedAt: z.string(), timezone: z.literal('Asia/Shanghai'), notice: z.string() }),
  profile: z.object({
    id: z.string(), name: z.string(), initials: z.string(), department: z.object({ id: z.string(), name: z.string() }), title: z.string(), manager: z.string(),
    status: z.enum(['active', 'disabled', 'offboarding', 'unknown', 'external_missing']), username: z.string().nullable().optional(), externalUserId: z.string().nullable().optional(), source: z.enum(['new-api', 'local']).optional(), syncState: z.enum(['synced', 'external_missing', 'stale']).optional(), createdAt: z.string().nullable().optional(), lastUsedAt: z.string().nullable().optional(), keyCount: z.number().int().nonnegative(),
    goal: z.object({ used: z.number().int().nonnegative(), limit: z.number().int().positive(), percent: z.number().min(0), state: z.enum(['normal', 'near', 'reached']) }),
    lastActiveAt: z.string().nullable(), tone: z.enum(['coral', 'blue', 'violet', 'green', 'amber']),
  }),
  metrics: z.object({
    todayRequests: z.number().int().nonnegative(), monthInputTokens: z.number().int().nonnegative(), monthOutputTokens: z.number().int().nonnegative(), monthTokens: z.number().int().nonnegative(), monthPoints: z.number().int().nonnegative(),
    monthPointLimit: z.number().int().positive(), successRate: z.number().min(0).max(100), p95LatencyMs: z.number().int().nonnegative(),
  }),
  keys: z.array(z.object({
    id: z.string(), masked: z.string(), purpose: z.string(), model: z.string(), status: z.enum(['active', 'disabled']), models: z.array(z.string()), expiresAt: z.string().nullable(), lastUsedAt: z.string().nullable(),
    usage: z.object({ requests: z.number().int().nonnegative(), inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), totalTokens: z.number().int().nonnegative() }),
  })),
})

export const personUsageResponseSchema = z.object({
  meta: z.object({ source: z.enum(['demo', 'database', 'new_api']), generatedAt: z.string(), timezone: z.literal('Asia/Shanghai'), period: z.enum(['1d', '7d', '30d']) }),
  summary: z.object({
    requests: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  }),
  items: z.array(z.object({ date: z.string(), requests: z.number().int().nonnegative(), inputTokens: z.number().int().nonnegative().default(0), outputTokens: z.number().int().nonnegative().default(0), tokens: z.number().int().nonnegative(), points: z.number().int().nonnegative() })),
  modelItems: z.array(z.object({
    model: z.string(),
    summary: z.object({
      requests: z.number().int().nonnegative(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
    }),
    items: z.array(z.object({ date: z.string(), requests: z.number().int().nonnegative(), inputTokens: z.number().int().nonnegative().default(0), outputTokens: z.number().int().nonnegative().default(0), tokens: z.number().int().nonnegative(), points: z.number().int().nonnegative() })),
  })),
  breakdown: z.array(z.object({
    keyId: z.string(),
    masked: z.string(),
    purpose: z.string(),
    model: z.string(),
    alias: z.string(),
    requests: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  })),
})

export type PeopleFilters = z.infer<typeof peopleFilterSchema>
export const personCreateBodySchema = z.object({
  username: z.string().trim().regex(/^[a-z][a-z0-9._-]{2,39}$/i).optional(),
  displayName: z.string().trim().min(2).max(40),
  departmentId: z.string().trim().min(1).max(40),
  password: z.string().min(8).max(200).optional(),
})
export const personCreateResponseSchema = z.object({
  meta: z.object({ source: z.enum(['database', 'new_api']), createdAt: z.string(), notice: z.string() }),
  person: z.object({ id: z.string(), username: z.string(), displayName: z.string(), department: z.object({ id: z.string(), name: z.string() }) }),
  operation: z.object({ auditEventId: z.string() }),
})
export const personBatchCreateBodySchema = z.object({
  idempotencyKey: z.string().regex(/^people-import-[a-z0-9-]{8,96}$/),
  items: z.array(personCreateBodySchema.partial({ username: true, password: true }).required({ displayName: true, departmentId: true })).min(1).max(200),
})
export const personBatchCreateResponseSchema = z.object({
  meta: z.object({ source: z.enum(['database', 'new_api']), createdAt: z.string(), notice: z.string(), createdCount: z.number().int().positive() }),
  people: z.array(z.object({ id: z.string(), username: z.string(), displayName: z.string(), department: z.object({ id: z.string(), name: z.string() }) })),
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})
export const personDisableBodySchema = z.object({
  idempotencyKey: z.string().regex(/^person-disable-[a-z0-9-]{8,96}$/),
  acknowledgeImpact: z.literal(true),
})
export const personDisableResponseSchema = z.object({
  meta: z.object({ source: z.enum(['database', 'new_api']), completedAt: z.string(), notice: z.string() }),
  person: z.object({ id: z.string(), name: z.string(), status: z.literal('disabled') }),
  keysDisabled: z.number().int().nonnegative(),
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})
export const personEnableBodySchema = z.object({
  idempotencyKey: z.string().regex(/^person-enable-[a-z0-9-]{8,96}$/),
  acknowledgeImpact: z.literal(true),
})
export const personEnableResponseSchema = z.object({
  meta: z.object({ source: z.enum(['database', 'new_api']), completedAt: z.string(), notice: z.string() }),
  person: z.object({ id: z.string(), name: z.string(), status: z.literal('active') }),
  keysEnabled: z.number().int().nonnegative(),
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})
export const personDeleteBodySchema = z.object({
  idempotencyKey: z.string().regex(/^person-delete-[a-z0-9-]{8,96}$/),
  reason: z.union([z.literal(''), z.string().trim().min(8).max(200)]).optional().default(''),
  acknowledgeImpact: z.literal(true),
})
export const personDeleteResponseSchema = z.object({
  meta: z.object({ source: z.enum(['database', 'new_api']), completedAt: z.string(), notice: z.string() }),
  person: z.object({ id: z.string(), name: z.string(), status: z.literal('deleted') }),
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})
export type PeopleResponse = z.infer<typeof peopleResponseSchema>
export type PersonCreateBody = z.infer<typeof personCreateBodySchema>
export type PersonCreateResponse = z.infer<typeof personCreateResponseSchema>
export type PersonBatchCreateBody = z.infer<typeof personBatchCreateBodySchema>
export type PersonBatchCreateResponse = z.infer<typeof personBatchCreateResponseSchema>
export type PersonDisableBody = z.infer<typeof personDisableBodySchema>
export type PersonDisableResponse = z.infer<typeof personDisableResponseSchema>
export type PersonEnableBody = z.infer<typeof personEnableBodySchema>
export type PersonEnableResponse = z.infer<typeof personEnableResponseSchema>
export type PersonDeleteBody = z.infer<typeof personDeleteBodySchema>
export type PersonDeleteResponse = z.infer<typeof personDeleteResponseSchema>
export type PersonGoalUpdateBody = QuotaUpdateBody
export type PersonGoalUpdateResponse = QuotaUpdateResponse
export type Person = PeopleResponse['items'][number]
export type PersonDetailResponse = z.infer<typeof personDetailResponseSchema>
export type PersonUsageResponse = z.infer<typeof personUsageResponseSchema>
export type PersonUsagePeriod = PersonUsageResponse['meta']['period']

const personSyncPersonSchema = z.object({
  id: z.string(), externalUserId: z.string(), name: z.string(), department: z.object({ id: z.string(), name: z.string() }),
  username: z.string().nullable(), status: z.enum(['active', 'disabled', 'unknown']), createdAt: z.string().nullable(), lastUsedAt: z.string().nullable(), syncState: z.enum(['synced', 'external_missing', 'stale']),
})
const personSyncSummarySchema = z.object({ total: z.number().int().nonnegative(), added: z.number().int().nonnegative(), changed: z.number().int().nonnegative(), missing: z.number().int().nonnegative(), unknown: z.number().int().nonnegative(), unchanged: z.number().int().nonnegative(), skipped: z.number().int().nonnegative() })
const personSyncPreviewResponseSchema = z.object({
  meta: z.object({ source: z.literal('new-api'), generatedAt: z.string(), stale: z.boolean(), notice: z.string() }),
  summary: personSyncSummarySchema,
  items: z.array(z.object({ action: z.enum(['add', 'update', 'missing', 'unknown', 'unchanged']), person: personSyncPersonSchema, changes: z.array(z.string()) })),
})
const personSyncBodySchema = z.object({ idempotencyKey: z.string().regex(/^people-sync-[a-z0-9-]{8,96}$/) })
const personSyncResponseSchema = personSyncPreviewResponseSchema.extend({ operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }) })

export type PersonSyncPreviewResponse = z.infer<typeof personSyncPreviewResponseSchema>
export type PersonSyncBody = z.infer<typeof personSyncBodySchema>
export type PersonSyncResponse = z.infer<typeof personSyncResponseSchema>

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

export async function fetchPeopleSyncPreview(signal?: AbortSignal): Promise<PersonSyncPreviewResponse> {
  const response = await fetch('/api/people/sync/preview', { headers: { accept: 'application/json' }, signal })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new PeopleApiError(detail?.error?.message ?? '人员同步预览暂时无法加载', requestId)
  }
  const result = personSyncPreviewResponseSchema.safeParse(await response.json())
  if (!result.success) throw new PeopleApiError('人员同步预览格式不符合接口约定', requestId)
  return result.data
}

export async function syncPeople(payload: PersonSyncBody): Promise<PersonSyncResponse> {
  const body = personSyncBodySchema.parse(payload)
  const response = await fetch('/api/people/sync', { method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(body) })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new PeopleApiError(detail?.error?.message ?? '人员同步未完成', requestId)
  }
  const result = personSyncResponseSchema.safeParse(await response.json())
  if (!result.success) throw new PeopleApiError('人员同步响应格式不符合接口约定', requestId)
  return result.data
}

export async function createPerson(payload: PersonCreateBody): Promise<PersonCreateResponse> {
  const body = personCreateBodySchema.parse(payload)
  const response = await fetch('/api/people', { method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(body) })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new PeopleApiError(detail?.error?.message ?? '添加人员失败', requestId)
  }
  const result = personCreateResponseSchema.safeParse(await response.json())
  if (!result.success) throw new PeopleApiError('添加人员响应格式不符合接口约定', requestId)
  return result.data
}

export async function createPeopleBatch(payload: PersonBatchCreateBody): Promise<PersonBatchCreateResponse> {
  const body = personBatchCreateBodySchema.parse(payload)
  const response = await fetch('/api/people/batch', { method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(body) })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new PeopleApiError(detail?.error?.message ?? '批量导入人员失败', requestId)
  }
  const result = personBatchCreateResponseSchema.safeParse(await response.json())
  if (!result.success) throw new PeopleApiError('批量导入响应格式不符合接口约定', requestId)
  return result.data
}

export async function disablePerson(id: string, payload: PersonDisableBody): Promise<PersonDisableResponse> {
  const body = personDisableBodySchema.parse(payload)
  const response = await fetch(`/api/people/${encodeURIComponent(id)}/disable`, { method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(body) })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new PeopleApiError(detail?.error?.message ?? '停用人员失败', requestId)
  }
  const result = personDisableResponseSchema.safeParse(await response.json())
  if (!result.success) throw new PeopleApiError('停用人员响应格式不符合接口约定', requestId)
  return result.data
}

export async function enablePerson(id: string, payload: PersonEnableBody): Promise<PersonEnableResponse> {
  const body = personEnableBodySchema.parse(payload)
  const response = await fetch(`/api/people/${encodeURIComponent(id)}/enable`, { method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(body) })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new PeopleApiError(detail?.error?.message ?? '启用人员失败', requestId)
  }
  const result = personEnableResponseSchema.safeParse(await response.json())
  if (!result.success) throw new PeopleApiError('启用人员响应格式不符合接口约定', requestId)
  return result.data
}

export async function deletePerson(id: string, payload: PersonDeleteBody): Promise<PersonDeleteResponse> {
  const body = personDeleteBodySchema.parse(payload)
  const response = await fetch(`/api/people/${encodeURIComponent(id)}/delete`, { method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(body) })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new PeopleApiError(detail?.error?.message ?? '删除人员失败', requestId)
  }
  const result = personDeleteResponseSchema.safeParse(await response.json())
  if (!result.success) throw new PeopleApiError('删除人员响应格式不符合接口约定', requestId)
  return result.data
}

export async function updatePersonMonthlyGoal(id: string, payload: PersonGoalUpdateBody): Promise<PersonGoalUpdateResponse> {
  const body = quotaUpdateBodySchema.parse(payload)
  const response = await fetch(`/api/people/${encodeURIComponent(id)}/goal`, {
    method: 'PATCH', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(body),
  })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new PeopleApiError(detail?.error?.message ?? '调整人员月度软目标失败', requestId)
  }
  const result = quotaUpdateResponseSchema.safeParse(await response.json())
  if (!result.success) throw new PeopleApiError('人员月度软目标响应格式不符合接口约定', requestId)
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
