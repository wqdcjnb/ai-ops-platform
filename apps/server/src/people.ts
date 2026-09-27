import { z } from 'zod'
import { isDepartmentVisible, type DataScope } from './data-scope.js'
import type { PlatformDatabase } from './platform-db.js'
import { isPublicModelId } from './public-model.js'

export const peopleQuerySchema = z.object({
  search: z.string().trim().max(60).default(''),
  status: z.enum(['all', 'active', 'disabled']).default('all'),
  goal: z.literal('all').default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})

export const personIdParamsSchema = z.object({
  id: z.string().regex(/^person-[a-z0-9-]+$/).max(64),
})

const actionBody = z.object({
  idempotencyKey: z.string().min(8).max(128),
  acknowledgeImpact: z.literal(true),
})

export const personDisableBodySchema = actionBody.extend({
  idempotencyKey: z.string().regex(/^person-disable-[a-z0-9-]{8,96}$/),
})
export const personEnableBodySchema = actionBody.extend({
  idempotencyKey: z.string().regex(/^person-enable-[a-z0-9-]{8,96}$/),
})
export const personPasswordResetBodySchema = actionBody.extend({
  idempotencyKey: z.string().regex(/^person-password-reset-[a-z0-9-]{8,96}$/),
})
export const personDeleteBodySchema = actionBody.extend({
  idempotencyKey: z.string().regex(/^person-delete-[a-z0-9-]{8,96}$/),
  reason: z.literal('').default(''),
})

const personSchema = z.object({
  id: z.string(),
  name: z.string(),
  initials: z.string(),
  title: z.literal('员工'),
  manager: z.literal('—'),
  status: z.enum(['active', 'disabled']),
  username: z.string(),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  apiKeyMasked: z.string().nullable(),
  keyCount: z.number().int().nonnegative(),
  goal: z.object({ used: z.literal(0), limit: z.literal(1), percent: z.literal(0), state: z.literal('normal') }),
  lastActiveAt: z.string().datetime().nullable(),
  tone: z.enum(['coral', 'blue', 'violet', 'green', 'amber']),
})

export const peopleResponseSchema = z.object({
  meta: z.object({
    source: z.literal('database'),
    generatedAt: z.string().datetime(),
    timezone: z.literal('Asia/Shanghai'),
    notice: z.string(),
  }),
  summary: z.object({
    total: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    disabled: z.number().int().nonnegative(),
    offboarding: z.literal(0),
  }),
  items: z.array(personSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
})

export type PeopleQuery = z.infer<typeof peopleQuerySchema>
export type PeopleResponse = z.infer<typeof peopleResponseSchema>

const tones: Array<z.infer<typeof personSchema>['tone']> = ['blue', 'violet', 'green', 'amber', 'coral']

export function createDatabasePeople(
  database: PlatformDatabase,
  query: PeopleQuery,
  now = new Date(),
  scope: DataScope = { mode: 'global' },
): PeopleResponse {
  const all = database.listPeople()
    .filter((row) => isDepartmentVisible(scope, row.departmentId))
    .map((row, index) => {
    const key = database.listApiKeysForOwner(row.id).find((item) => isPublicModelId(item.model) && item.status !== 'revoked') ?? null
    return {
      id: row.id,
      name: row.displayName,
      initials: row.displayName.slice(0, 2),
      title: '员工' as const,
      manager: '—' as const,
      status: row.status,
      username: row.username,
      createdAt: row.createdAt,
      lastUsedAt: key?.lastUsedAt ?? null,
      apiKeyMasked: key?.maskedValue ?? null,
      keyCount: key ? 1 : 0,
      goal: { used: 0 as const, limit: 1 as const, percent: 0 as const, state: 'normal' as const },
      lastActiveAt: key?.lastUsedAt ?? null,
      tone: tones[index % tones.length]!,
    }
  })

  const search = query.search.toLocaleLowerCase('zh-CN')
  const filtered = all.filter((item) => {
    const matchesSearch = !search || [item.name, item.username].some((value) => value.toLocaleLowerCase('zh-CN').includes(search))
    return matchesSearch
      && (query.status === 'all' || item.status === query.status)
  })
  const start = (query.page - 1) * query.pageSize
  return {
    meta: {
      source: 'database',
      generatedAt: now.toISOString(),
      timezone: 'Asia/Shanghai',
      notice: '员工通过邮箱自助注册；管理员仅维护状态、密码和唯一 AI OPS 平台 Key。',
    },
    summary: {
      total: all.length,
      active: all.filter((item) => item.status === 'active').length,
      disabled: all.filter((item) => item.status === 'disabled').length,
      offboarding: 0,
    },
    items: filtered.slice(start, start + query.pageSize),
    page: query.page,
    pageSize: query.pageSize,
    total: filtered.length,
  }
}
