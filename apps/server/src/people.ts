import { z } from 'zod'
import type { NewApiStatus } from './new-api-status.js'
import { isDepartmentVisible, scopeNotice, type DataScope } from './data-scope.js'
import type { PlatformDatabase } from './platform-db.js'

export const peopleQuerySchema = z.object({
  search: z.string().trim().max(60).default(''),
  department: z.string().trim().max(40).default('all'),
  status: z.enum(['all', 'active', 'disabled', 'offboarding']).default('all'),
  goal: z.enum(['all', 'normal', 'near', 'reached']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})

const personStatusSchema = z.enum(['active', 'disabled', 'offboarding'])
const goalStateSchema = z.enum(['normal', 'near', 'reached'])

const personSchema = z.object({
  id: z.string(),
  name: z.string(),
  initials: z.string(),
  department: z.object({ id: z.string(), name: z.string() }),
  title: z.string(),
  manager: z.string(),
  status: personStatusSchema,
  keyCount: z.number().int().nonnegative(),
  goal: z.object({
    used: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    percent: z.number().min(0),
    state: goalStateSchema,
  }),
  lastActiveAt: z.string().datetime().nullable(),
  tone: z.enum(['coral', 'blue', 'violet', 'green', 'amber']),
})

export const peopleResponseSchema = z.object({
  meta: z.object({
    source: z.enum(['demo', 'database']),
    generatedAt: z.string().datetime(),
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
  items: z.array(personSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
})

export const personIdParamsSchema = z.object({
  id: z.string().regex(/^person-[a-z0-9-]+$/).max(64),
})

export const personCreateBodySchema = z.object({
  username: z.string().trim().regex(/^[a-z][a-z0-9._-]{2,39}$/i).optional(),
  displayName: z.string().trim().min(2).max(40),
  departmentId: z.string().trim().min(1).max(40),
  password: z.string().min(8).max(200).optional(),
})

export const personCreateResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), createdAt: z.string().datetime(), notice: z.string() }),
  person: z.object({ id: z.string(), username: z.string(), displayName: z.string(), department: z.object({ id: z.string(), name: z.string() }) }),
  operation: z.object({ auditEventId: z.string() }),
})

export const personBatchCreateBodySchema = z.object({
  idempotencyKey: z.string().regex(/^people-import-[a-z0-9-]{8,96}$/),
  items: z.array(personCreateBodySchema.partial({ username: true, password: true }).required({ displayName: true, departmentId: true })).min(1).max(200),
})

export const personBatchCreateResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), createdAt: z.string().datetime(), notice: z.string(), createdCount: z.number().int().positive() }),
  people: z.array(z.object({ id: z.string(), username: z.string(), displayName: z.string(), department: z.object({ id: z.string(), name: z.string() }) })),
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})

export const personDisableBodySchema = z.object({
  idempotencyKey: z.string().regex(/^person-disable-[a-z0-9-]{8,96}$/),
  reason: z.string().trim().min(8).max(200),
  acknowledgeImpact: z.literal(true),
})

export const personDisableResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), completedAt: z.string().datetime(), notice: z.string() }),
  person: z.object({ id: z.string(), name: z.string(), status: z.literal('disabled') }),
  keysDisabled: z.number().int().nonnegative(),
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})

export const personDeleteBodySchema = z.object({
  idempotencyKey: z.string().regex(/^person-delete-[a-z0-9-]{8,96}$/),
  reason: z.string().trim().min(8).max(200),
  acknowledgeImpact: z.literal(true),
})

export const personDeleteResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), completedAt: z.string().datetime(), notice: z.string() }),
  person: z.object({ id: z.string(), name: z.string(), status: z.literal('deleted') }),
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})

export const personUsageQuerySchema = z.object({
  period: z.enum(['7d', '30d']).default('7d'),
})

export const personDetailResponseSchema = z.object({
  meta: z.object({
    source: z.enum(['demo', 'database']),
    generatedAt: z.string().datetime(),
    timezone: z.literal('Asia/Shanghai'),
    notice: z.string(),
  }),
  profile: personSchema,
  metrics: z.object({
    todayRequests: z.number().int().nonnegative(),
    monthInputTokens: z.number().int().nonnegative(),
    monthOutputTokens: z.number().int().nonnegative(),
    monthTokens: z.number().int().nonnegative(),
    monthPoints: z.number().int().nonnegative(),
    monthPointLimit: z.number().int().positive(),
    successRate: z.number().min(0).max(100),
    p95LatencyMs: z.number().int().nonnegative(),
  }),
  keys: z.array(z.object({
    id: z.string(),
    masked: z.string(),
    purpose: z.string(),
    model: z.string(),
    status: z.enum(['active', 'disabled']),
    models: z.array(z.string()),
    expiresAt: z.string().datetime(),
    lastUsedAt: z.string().datetime().nullable(),
    usage: z.object({
      requests: z.number().int().nonnegative(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
    }),
  })),
})

export const personUsageResponseSchema = z.object({
  meta: z.object({ source: z.enum(['demo', 'database']), generatedAt: z.string().datetime(), timezone: z.literal('Asia/Shanghai'), period: z.enum(['7d', '30d']) }),
  items: z.array(z.object({
    date: z.string(),
    requests: z.number().int().nonnegative(),
    tokens: z.number().int().nonnegative(),
    points: z.number().int().nonnegative(),
  })),
})

export type PeopleQuery = z.infer<typeof peopleQuerySchema>
export type PeopleResponse = z.infer<typeof peopleResponseSchema>
export type PersonCreateBody = z.infer<typeof personCreateBodySchema>
export type PersonCreateResponse = z.infer<typeof personCreateResponseSchema>
export type PersonBatchCreateBody = z.infer<typeof personBatchCreateBodySchema>
export type PersonBatchCreateResponse = z.infer<typeof personBatchCreateResponseSchema>
export type PersonDisableBody = z.infer<typeof personDisableBodySchema>
export type PersonDisableResponse = z.infer<typeof personDisableResponseSchema>
export type PersonDeleteBody = z.infer<typeof personDeleteBodySchema>
export type PersonDeleteResponse = z.infer<typeof personDeleteResponseSchema>
export type PersonDetailResponse = z.infer<typeof personDetailResponseSchema>
export type PersonUsageResponse = z.infer<typeof personUsageResponseSchema>
export type PersonUsagePeriod = z.infer<typeof personUsageQuerySchema>['period']

interface DemoPersonSeed {
  id: string
  name: string
  initials: string
  departmentId: string
  departmentName: string
  title: string
  manager: string
  status: 'active' | 'disabled' | 'offboarding'
  keyCount: number
  defaultKeyPurpose: string
  used: number
  limit: number
  minutesAgo: number | null
  tone: 'coral' | 'blue' | 'violet' | 'green' | 'amber'
}

const demoPeople: DemoPersonSeed[] = [
  { id: 'person-lin', name: '林筱雨', initials: 'LY', departmentId: 'content', departmentName: '内容运营', title: '资深内容运营', manager: '宋嘉言', status: 'active', keyCount: 2, defaultKeyPurpose: '商品文案', used: 742, limit: 860, minutesAgo: 6, tone: 'coral' },
  { id: 'person-zhou', name: '周明远', initials: 'ZM', departmentId: 'ads', departmentName: '广告投放', title: '投放策略师', manager: '顾闻舟', status: 'active', keyCount: 1, defaultKeyPurpose: '策略分析', used: 681, limit: 860, minutesAgo: 18, tone: 'blue' },
  { id: 'person-chen', name: '陈安琪', initials: 'CA', departmentId: 'global', departmentName: '跨境运营', title: '跨境运营专员', manager: '沈若川', status: 'active', keyCount: 2, defaultKeyPurpose: '多语翻译', used: 543, limit: 860, minutesAgo: 33, tone: 'violet' },
  { id: 'person-xu', name: '许嘉禾', initials: 'XJ', departmentId: 'service', departmentName: '客户服务', title: '客服主管', manager: '陆知行', status: 'active', keyCount: 1, defaultKeyPurpose: '回复建议', used: 438, limit: 860, minutesAgo: 51, tone: 'green' },
  { id: 'person-tang', name: '唐语宁', initials: 'TY', departmentId: 'merch', departmentName: '商品运营', title: '商品运营专员', manager: '宋嘉言', status: 'active', keyCount: 1, defaultKeyPurpose: '图片检查', used: 361, limit: 860, minutesAgo: 77, tone: 'amber' },
  { id: 'person-he', name: '何沐晨', initials: 'HM', departmentId: 'content', departmentName: '内容运营', title: '内容编辑', manager: '宋嘉言', status: 'active', keyCount: 1, defaultKeyPurpose: '标题优化', used: 286, limit: 700, minutesAgo: 125, tone: 'blue' },
  { id: 'person-luo', name: '罗一帆', initials: 'LF', departmentId: 'ads', departmentName: '广告投放', title: '广告优化师', manager: '顾闻舟', status: 'active', keyCount: 2, defaultKeyPurpose: '素材分析', used: 225, limit: 700, minutesAgo: 210, tone: 'violet' },
  { id: 'person-su', name: '苏澄', initials: 'SC', departmentId: 'global', departmentName: '跨境运营', title: '本地化专员', manager: '沈若川', status: 'active', keyCount: 1, defaultKeyPurpose: '多语翻译', used: 198, limit: 700, minutesAgo: 340, tone: 'green' },
  { id: 'person-qiao', name: '乔南星', initials: 'QX', departmentId: 'service', departmentName: '客户服务', title: '客服专员', manager: '陆知行', status: 'offboarding', keyCount: 1, defaultKeyPurpose: '回复建议', used: 156, limit: 500, minutesAgo: 1450, tone: 'amber' },
  { id: 'person-guo', name: '郭子谦', initials: 'GQ', departmentId: 'merch', departmentName: '商品运营', title: '选品运营', manager: '宋嘉言', status: 'active', keyCount: 1, defaultKeyPurpose: '选品分析', used: 112, limit: 500, minutesAgo: 580, tone: 'coral' },
  { id: 'person-yan', name: '严可欣', initials: 'YX', departmentId: 'content', departmentName: '内容运营', title: '内容实习生', manager: '宋嘉言', status: 'disabled', keyCount: 0, defaultKeyPurpose: '商品文案', used: 48, limit: 300, minutesAgo: null, tone: 'green' },
  { id: 'person-wei', name: '魏昭', initials: 'WZ', departmentId: 'service', departmentName: '客户服务', title: '质检专员', manager: '陆知行', status: 'active', keyCount: 1, defaultKeyPurpose: '会话质检', used: 92, limit: 500, minutesAgo: 920, tone: 'blue' },
]

function goalState(percent: number): 'normal' | 'near' | 'reached' {
  if (percent >= 100) return 'reached'
  if (percent >= 80) return 'near'
  return 'normal'
}

export function createDemoPeople(query: PeopleQuery, newApi: NewApiStatus, now = new Date()): PeopleResponse {
  const people = demoPeople.map((person) => {
    const percent = Math.round(person.used / person.limit * 100)
    return {
      id: person.id,
      name: person.name,
      initials: person.initials,
      department: { id: person.departmentId, name: person.departmentName },
      title: person.title,
      manager: person.manager,
      status: person.status,
       keyCount: person.keyCount,
      goal: { used: person.used, limit: person.limit, percent, state: goalState(percent) },
      lastActiveAt: person.minutesAgo === null ? null : new Date(now.getTime() - person.minutesAgo * 60_000).toISOString(),
      tone: person.tone,
    }
  })

  const normalizedSearch = query.search.toLocaleLowerCase('zh-CN')
  const filtered = people.filter((person) => {
    const matchesSearch = !normalizedSearch || [person.name, person.title, person.manager].some((value) => value.toLocaleLowerCase('zh-CN').includes(normalizedSearch))
    const matchesDepartment = query.department === 'all' || person.department.id === query.department
    const matchesStatus = query.status === 'all' || person.status === query.status
    const matchesGoal = query.goal === 'all' || person.goal.state === query.goal
    return matchesSearch && matchesDepartment && matchesStatus && matchesGoal
  })

  const departmentMap = new Map<string, PeopleResponse['departments'][number]>()
  for (const person of people) {
    const current = departmentMap.get(person.department.id) ?? { id: person.department.id, name: person.department.name, people: 0, activeKeys: 0, usagePercent: 0 }
    current.people += 1
    current.activeKeys += person.keyCount
    current.usagePercent += person.goal.percent
    departmentMap.set(person.department.id, current)
  }
  const departments = [...departmentMap.values()].map((department) => ({ ...department, usagePercent: Math.round(department.usagePercent / department.people) }))
  const start = (query.page - 1) * query.pageSize

  return {
    meta: {
      source: 'demo',
      generatedAt: now.toISOString(),
      timezone: 'Asia/Shanghai',
      notice: newApi.state === 'ready'
        ? 'New API 管理连接已验证；人员字段映射完成前，本页仍使用演示数据'
        : newApi.state === 'reachable'
          ? 'New API 服务可达但尚未配置管理认证；人员与部门数据为演示数据'
          : newApi.state === 'auth_required'
            ? 'New API 管理认证未通过；人员与部门数据为演示数据'
            : 'New API 当前离线；人员与部门数据为演示数据',
    },
    summary: {
      total: people.length,
      active: people.filter((person) => person.status === 'active').length,
      disabled: people.filter((person) => person.status === 'disabled').length,
      offboarding: people.filter((person) => person.status === 'offboarding').length,
      departments: departments.length,
    },
    departments,
    items: filtered.slice(start, start + query.pageSize),
    page: query.page,
    pageSize: query.pageSize,
    total: filtered.length,
  }
}

function databaseNotice(newApi: NewApiStatus) {
  if (newApi.state === 'ready') return '人员与部门已从平台 SQLite 读取；New API 管理字段仍待接入'
  if (newApi.state === 'reachable') return '人员与部门来自平台 SQLite；New API 服务可达但尚未配置管理认证'
  if (newApi.state === 'auth_required') return '人员与部门来自平台 SQLite；New API 管理认证未通过'
  return '人员与部门来自平台 SQLite；New API 当前离线'
}

function filterPeopleResponse(query: PeopleQuery, people: PeopleResponse['items'], newApi: NewApiStatus, now: Date, source: 'demo' | 'database', notice: string): PeopleResponse {
  const normalizedSearch = query.search.toLocaleLowerCase('zh-CN')
  const filtered = people.filter((person) => {
    const matchesSearch = !normalizedSearch || [person.name, person.title, person.manager].some((value) => value.toLocaleLowerCase('zh-CN').includes(normalizedSearch))
    const matchesDepartment = query.department === 'all' || person.department.id === query.department
    const matchesStatus = query.status === 'all' || person.status === query.status
    const matchesGoal = query.goal === 'all' || person.goal.state === query.goal
    return matchesSearch && matchesDepartment && matchesStatus && matchesGoal
  })
  const departmentMap = new Map<string, PeopleResponse['departments'][number]>()
  for (const person of people) {
    const current = departmentMap.get(person.department.id) ?? { id: person.department.id, name: person.department.name, people: 0, activeKeys: 0, usagePercent: 0 }
    current.people += 1
    current.activeKeys += person.keyCount
    current.usagePercent += person.goal.percent
    departmentMap.set(person.department.id, current)
  }
  const departments = [...departmentMap.values()].map((department) => ({ ...department, usagePercent: department.people ? Math.round(department.usagePercent / department.people) : 0 }))
  const start = (query.page - 1) * query.pageSize
  return {
    meta: { source, generatedAt: now.toISOString(), timezone: 'Asia/Shanghai', notice },
    summary: {
      total: people.length,
      active: people.filter((person) => person.status === 'active').length,
      disabled: people.filter((person) => person.status === 'disabled').length,
      offboarding: people.filter((person) => person.status === 'offboarding').length,
      departments: departments.length,
    },
    departments,
    items: filtered.slice(start, start + query.pageSize),
    page: query.page,
    pageSize: query.pageSize,
    total: filtered.length,
  }
}

export function createDatabasePeople(database: PlatformDatabase, query: PeopleQuery, newApi: NewApiStatus, now = new Date(), scope: DataScope = { mode: 'global' }): PeopleResponse {
  const demo = createDemoPeople({ search: '', department: 'all', status: 'all', goal: 'all', page: 1, pageSize: 50 }, newApi, now)
  const demoById = new Map(demo.items.map((person) => [person.id, person]))
  const personPolicies = new Map(database.listQuotaPolicies().filter((policy) => policy.level === 'person' && policy.period === 'month').map((policy) => [policy.subjectId, policy]))
  const tones: PeopleResponse['items'][number]['tone'][] = ['blue', 'violet', 'green', 'amber', 'coral']
  const people = database.listPeople().map((row, index) => {
    const existing = demoById.get(row.id)
    if (existing) {
      const targetPoints = personPolicies.get(row.id)?.targetPoints ?? existing.goal.limit
      const percent = Math.round(existing.goal.used / targetPoints * 100)
      return {
        ...existing,
        name: row.displayName,
        department: row.departmentId && row.departmentName ? { id: row.departmentId, name: row.departmentName } : existing.department,
        status: row.status === 'disabled' ? 'disabled' as const : existing.status,
        goal: { used: existing.goal.used, limit: targetPoints, percent, state: goalState(percent) },
      }
    }
    const targetPoints = personPolicies.get(row.id)?.targetPoints ?? 500
    const percent = 0
    return {
      id: row.id,
      name: row.displayName,
      initials: row.displayName.slice(0, 2),
      department: { id: row.departmentId ?? 'unassigned', name: row.departmentName ?? '待分配部门' },
      title: '新加入成员',
      manager: '待分配',
      status: row.status === 'disabled' ? 'disabled' as const : 'active' as const,
       keyCount: 0,
      goal: { used: 0, limit: targetPoints, percent, state: 'normal' as const },
      lastActiveAt: null,
      tone: tones[index % tones.length]!,
    }
  })
  const visiblePeople = people.filter((person) => isDepartmentVisible(scope, person.department.id))
  return filterPeopleResponse(query, visiblePeople, newApi, now, 'database', `${databaseNotice(newApi)}${scopeNotice(scope)}`)
}

function findDemoPerson(id: string, newApi: NewApiStatus, now: Date) {
  return createDemoPeople({ search: '', department: 'all', status: 'all', goal: 'all', page: 1, pageSize: 50 }, newApi, now).items.find((person) => person.id === id)
}

function findDatabasePerson(database: PlatformDatabase, id: string, newApi: NewApiStatus, now: Date) {
  return createDatabasePeople(database, { search: '', department: 'all', status: 'all', goal: 'all', page: 1, pageSize: 50 }, newApi, now).items.find((person) => person.id === id)
}

function detailNotice(newApi: NewApiStatus) {
  if (newApi.state === 'ready') return 'New API 管理连接已验证；详情字段映射完成前，本页仍使用演示数据'
  if (newApi.state === 'reachable') return 'New API 服务可达但尚未配置管理认证；个人详情为演示数据'
  if (newApi.state === 'auth_required') return 'New API 管理认证未通过；个人详情为演示数据'
  return 'New API 当前离线；个人详情为演示数据'
}

function primaryModelForPurpose(keyPurpose: string) {
  return keyPurpose.includes('翻译') ? 'ecommerce-translate' : keyPurpose.includes('分析') ? 'ecommerce-analysis' : keyPurpose.includes('回复') || keyPurpose.includes('质检') ? 'ecommerce-service' : 'ecommerce-copy'
}

export function createDemoPersonDetail(id: string, newApi: NewApiStatus, now = new Date()): PersonDetailResponse | null {
  const person = findDemoPerson(id, newApi, now)
  if (!person) return null
  const seed = demoPeople.find((candidate) => candidate.id === id)
  const primaryModel = primaryModelForPurpose(seed?.defaultKeyPurpose ?? '商品文案')
  const monthTokens = person.goal.used * 8_260
  const monthInputTokens = Math.round(monthTokens * 0.62)
  const monthOutputTokens = monthTokens - monthInputTokens
  const todayRequests = person.status === 'disabled' ? 0 : Math.round(person.goal.used * 1.72)
  const suffixes = ['7F2A', '3C91']
  const keys = Array.from({ length: person.keyCount }, (_, index) => ({
    id: `key-${person.id.replace('person-', '')}-${index + 1}`,
    masked: `sk-ops••••••${suffixes[index] ?? 'A8D4'}`,
    purpose: index === 0 ? '主业务 Key' : '临时项目',
    model: index === 0 ? primaryModel : 'ecommerce-general',
    status: person.status === 'disabled' ? 'disabled' as const : 'active' as const,
    models: [index === 0 ? primaryModel : 'ecommerce-general'],
    expiresAt: new Date(now.getTime() + (120 - index * 35) * 86_400_000).toISOString(),
    lastUsedAt: person.lastActiveAt,
    usage: (() => {
      const ratio = person.keyCount === 1 ? 1 : index === 0 ? .7 : index === 1 ? .3 : 1 / person.keyCount
      const totalTokens = Math.round(monthTokens * ratio)
      const inputTokens = Math.round(monthInputTokens * ratio)
      return { requests: Math.round(todayRequests * ratio), inputTokens, outputTokens: totalTokens - inputTokens, totalTokens }
    })(),
  }))

  return {
    meta: { source: 'demo', generatedAt: now.toISOString(), timezone: 'Asia/Shanghai', notice: detailNotice(newApi) },
    profile: person,
    metrics: {
      todayRequests,
      monthInputTokens,
      monthOutputTokens,
      monthTokens,
      monthPoints: person.goal.used,
      monthPointLimit: person.goal.limit,
      successRate: person.status === 'disabled' ? 0 : Number((98.4 + (person.goal.percent % 13) / 10).toFixed(1)),
      p95LatencyMs: person.status === 'disabled' ? 0 : 1_450 + person.goal.percent * 17,
    },
    keys,
  }
}

export function createDatabasePersonDetail(database: PlatformDatabase, id: string, newApi: NewApiStatus, now = new Date(), scope: DataScope = { mode: 'global' }): PersonDetailResponse | null {
  const person = findDatabasePerson(database, id, newApi, now)
  if (!person || !isDepartmentVisible(scope, person.department.id)) return null
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const keyUsage = new Map(database.listPersonKeyTokenUsage(id, monthStart).map((usage) => [usage.keyId, usage]))
  const keys = database.listApiKeysForOwner(id).map((key) => ({
    id: key.id,
    masked: key.maskedValue,
    purpose: key.purpose,
    model: key.model,
    status: key.status === 'revoked' ? 'disabled' as const : 'active' as const,
    models: [key.model],
    expiresAt: key.expiresAt ?? now.toISOString(),
    lastUsedAt: key.lastUsedAt,
    usage: (() => {
      const usage = keyUsage.get(key.id)
      const inputTokens = Number(usage?.inputTokens ?? 0)
      const outputTokens = Number(usage?.outputTokens ?? 0)
      return { requests: Number(usage?.requests ?? 0), inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }
    })(),
  }))
  const monthInputTokens = keys.reduce((total, key) => total + key.usage.inputTokens, 0)
  const monthOutputTokens = keys.reduce((total, key) => total + key.usage.outputTokens, 0)
  const monthTokens = monthInputTokens + monthOutputTokens
  return {
    meta: { source: 'database', generatedAt: now.toISOString(), timezone: 'Asia/Shanghai', notice: '人员档案与本月 Token 用量来自平台 SQLite；Key 只返回掩码' },
    profile: person,
    metrics: {
      todayRequests: person.status === 'disabled' ? 0 : Math.round(person.goal.used * 1.72),
      monthInputTokens,
      monthOutputTokens,
      monthTokens,
      monthPoints: person.goal.used,
      monthPointLimit: person.goal.limit,
      successRate: person.status === 'disabled' ? 0 : Number((98.4 + (person.goal.percent % 13) / 10).toFixed(1)),
      p95LatencyMs: person.status === 'disabled' ? 0 : 1_450 + person.goal.percent * 17,
    },
    keys,
  }
}

export function createDemoPersonUsage(id: string, period: PersonUsagePeriod, newApi: NewApiStatus, now = new Date()): PersonUsageResponse | null {
  const person = findDemoPerson(id, newApi, now)
  if (!person) return null
  const count = period === '7d' ? 7 : 30
  const seed = demoPeople.findIndex((candidate) => candidate.id === id) + 1
  const base = Math.max(8, Math.round(person.goal.used / count))
  const items = Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getTime() - (count - index - 1) * 86_400_000)
    const requests = person.status === 'disabled' ? 0 : Math.max(0, Math.round(base * 4.4 + Math.sin((index + seed) / 2) * base + (index % 3) * seed))
    return {
      date: `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`,
      requests,
      tokens: requests * (3_600 + seed * 85),
      points: Math.round(requests * 0.16),
    }
  })
  return { meta: { source: 'demo', generatedAt: now.toISOString(), timezone: 'Asia/Shanghai', period }, items }
}

export function createDatabasePersonUsage(database: PlatformDatabase, id: string, period: PersonUsagePeriod, newApi: NewApiStatus, now = new Date(), scope: DataScope = { mode: 'global' }): PersonUsageResponse | null {
  const person = findDatabasePerson(database, id, newApi, now)
  if (!person || !isDepartmentVisible(scope, person.department.id)) return null
  const count = period === '7d' ? 7 : 30
  const base = Math.max(0, Math.round(person.goal.used / Math.max(count, 1)))
  const items = Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getTime() - (count - index - 1) * 86_400_000)
    const requests = person.status === 'disabled' ? 0 : base
    return { date: `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`, requests, tokens: requests * 3_600, points: Math.round(requests * 0.16) }
  })
  return { meta: { source: 'database', generatedAt: now.toISOString(), timezone: 'Asia/Shanghai', period }, items }
}
