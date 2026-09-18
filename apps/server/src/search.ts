import { z } from 'zod'
import type { DataScope } from './data-scope.js'
import { isDepartmentVisible } from './data-scope.js'
import type { PlatformDatabase } from './platform-db.js'

const searchGroupIdSchema = z.enum(['people', 'keys', 'requests'])

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(80),
})

export const searchResponseSchema = z.object({
  meta: z.object({
    source: z.literal('database'),
    simulated: z.literal(true),
    generatedAt: z.string(),
    notice: z.string(),
  }),
  query: z.string(),
  total: z.number().int().nonnegative(),
  groups: z.array(z.object({
    id: searchGroupIdSchema,
    label: z.string(),
    items: z.array(z.object({
      id: z.string(),
      title: z.string(),
      detail: z.string(),
      href: z.string(),
    })),
  })),
})

export type SearchResponse = z.infer<typeof searchResponseSchema>

const RESULT_LIMIT = 5

function searchable(values: Array<string | null | undefined>, needle: string) {
  return values.some((value) => value?.toLocaleLowerCase('zh-CN').includes(needle))
}

function parseModels(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function formatRequestTime(value: string) {
  return value.replace('T', ' ').replace(/\.\d{3}Z$/, '').replace('Z', '')
}

export function createDatabaseSearch(database: PlatformDatabase, query: z.infer<typeof searchQuerySchema>, scope: DataScope, now = new Date()): SearchResponse {
  const normalizedQuery = query.q.trim()
  const needle = normalizedQuery.toLocaleLowerCase('zh-CN')

  const people = database.listPeople()
    .filter((person) => isDepartmentVisible(scope, person.departmentId))
    .filter((person) => searchable([person.id, person.username, person.displayName, person.departmentName], needle))
    .slice(0, RESULT_LIMIT)
    .map((person) => ({
      id: person.id,
      title: person.displayName,
      detail: [person.departmentName ?? '未分配部门', person.username].join(' · '),
      href: `/people/${encodeURIComponent(person.id)}`,
    }))

  const keys = database.listApiKeys()
    .filter((key) => isDepartmentVisible(scope, key.departmentId))
    .filter((key) => searchable([key.id, key.maskedValue, key.ownerName, key.departmentName, key.purpose, ...parseModels(key.modelsJson)], needle))
    .slice(0, RESULT_LIMIT)
    .map((key) => ({
      id: key.id,
      title: key.maskedValue,
      detail: [key.ownerName, key.purpose].join(' · '),
      href: `/keys?owner=${encodeURIComponent(key.ownerUserId)}`,
    }))

  const requests = database.listUsageRequests()
    .filter((request) => isDepartmentVisible(scope, request.departmentId))
    .filter((request) => searchable([
      request.requestId,
      request.personName,
      request.departmentName,
      request.maskedValue,
      request.purposeName,
      request.purposeAlias,
      request.modelDisplayName,
      request.actualModel,
      request.routeAlias,
      request.clientName,
    ], needle))
    .slice(0, RESULT_LIMIT)
    .map((request) => ({
      id: request.requestId,
      title: request.requestId,
      detail: [request.personName, request.purposeName, formatRequestTime(request.occurredAt)].join(' · '),
      href: `/usage?requestId=${encodeURIComponent(request.requestId)}`,
    }))

  const groups = [
    { id: 'people' as const, label: '人员', items: people },
    { id: 'keys' as const, label: 'Key 掩码', items: keys },
    { id: 'requests' as const, label: '调用请求', items: requests },
  ].filter((group) => group.items.length > 0)

  return searchResponseSchema.parse({
    meta: {
      source: 'database',
      simulated: true,
      generatedAt: now.toISOString(),
      notice: '结果来自本地 SQLite 模拟数据；Key 仅显示掩码，不搜索对话正文。',
    },
    query: normalizedQuery,
    total: groups.reduce((total, group) => total + group.items.length, 0),
    groups,
  })
}
