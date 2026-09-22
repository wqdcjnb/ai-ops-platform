import { z } from 'zod'
import type { NewApiStatus } from './new-api-status.js'
import { isDepartmentVisible, scopeNotice, type DataScope } from './data-scope.js'
import { stableNewApiPersonId, type PlatformDatabase } from './platform-db.js'
import type { NewApiDatabaseReader, NewApiLogRecord } from './new-api-database.js'
import type { NewApiTokenRecord } from './new-api-tokens.js'
import type { NormalizedNewApiPerson } from './people-sync.js'

export const peopleQuerySchema = z.object({
  search: z.string().trim().max(60).default(''),
  department: z.string().trim().max(40).default('all'),
  status: z.enum(['all', 'active', 'disabled', 'offboarding', 'unknown', 'external_missing']).default('all'),
  goal: z.enum(['all', 'normal', 'near', 'reached']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})

const personStatusSchema = z.enum(['active', 'disabled', 'offboarding', 'unknown', 'external_missing'])
const goalStateSchema = z.enum(['normal', 'near', 'reached'])

const personSchema = z.object({
  id: z.string(),
  name: z.string(),
  initials: z.string(),
  department: z.object({ id: z.string(), name: z.string() }),
  title: z.string(),
  manager: z.string(),
  status: personStatusSchema,
  username: z.string().nullable().optional(),
  externalUserId: z.string().nullable().optional(),
  source: z.enum(['new-api', 'local']).optional(),
  syncState: z.enum(['synced', 'external_missing', 'stale']).optional(),
  createdAt: z.string().datetime().nullable().optional(),
  lastUsedAt: z.string().datetime().nullable().optional(),
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
    source: z.enum(['demo', 'database', 'new_api']),
    generatedAt: z.string().datetime(),
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
  meta: z.object({ source: z.enum(['database', 'new_api']), createdAt: z.string().datetime(), notice: z.string() }),
  person: z.object({ id: z.string(), username: z.string(), displayName: z.string(), department: z.object({ id: z.string(), name: z.string() }) }),
  operation: z.object({ auditEventId: z.string() }),
})

export const personBatchCreateBodySchema = z.object({
  idempotencyKey: z.string().regex(/^people-import-[a-z0-9-]{8,96}$/),
  items: z.array(personCreateBodySchema.partial({ username: true, password: true }).required({ displayName: true, departmentId: true })).min(1).max(200),
})

export const personBatchCreateResponseSchema = z.object({
  meta: z.object({ source: z.enum(['database', 'new_api']), createdAt: z.string().datetime(), notice: z.string(), createdCount: z.number().int().positive() }),
  people: z.array(z.object({ id: z.string(), username: z.string(), displayName: z.string(), department: z.object({ id: z.string(), name: z.string() }) })),
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})

export const personDisableBodySchema = z.object({
  idempotencyKey: z.string().regex(/^person-disable-[a-z0-9-]{8,96}$/),
  acknowledgeImpact: z.literal(true),
})

export const personDisableResponseSchema = z.object({
  meta: z.object({ source: z.enum(['database', 'new_api']), completedAt: z.string().datetime(), notice: z.string() }),
  person: z.object({ id: z.string(), name: z.string(), status: z.literal('disabled') }),
  keysDisabled: z.number().int().nonnegative(),
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})

export const personEnableBodySchema = z.object({
  idempotencyKey: z.string().regex(/^person-enable-[a-z0-9-]{8,96}$/),
  acknowledgeImpact: z.literal(true),
})

export const personEnableResponseSchema = z.object({
  meta: z.object({ source: z.enum(['database', 'new_api']), completedAt: z.string().datetime(), notice: z.string() }),
  person: z.object({ id: z.string(), name: z.string(), status: z.literal('active') }),
  keysEnabled: z.number().int().nonnegative(),
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})

export const personDeleteBodySchema = z.object({
  idempotencyKey: z.string().regex(/^person-delete-[a-z0-9-]{8,96}$/),
  // Deleting an already-disabled local person only needs the explicit impact
  // acknowledgement. Keep accepting a legacy reason for older clients, but
  // do not require administrators to type one.
  reason: z.union([z.literal(''), z.string().trim().min(8).max(200)]).optional().default(''),
  acknowledgeImpact: z.literal(true),
})

export const personDeleteResponseSchema = z.object({
  meta: z.object({ source: z.enum(['database', 'new_api']), completedAt: z.string().datetime(), notice: z.string() }),
  person: z.object({ id: z.string(), name: z.string(), status: z.literal('deleted') }),
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})

export const personUsageQuerySchema = z.object({
  period: z.enum(['1d', '7d', '30d']).default('7d'),
})

export const personDetailResponseSchema = z.object({
  meta: z.object({
    source: z.enum(['demo', 'database', 'new_api']),
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
    expiresAt: z.string().datetime().nullable(),
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
  meta: z.object({ source: z.enum(['demo', 'database', 'new_api']), generatedAt: z.string().datetime(), timezone: z.literal('Asia/Shanghai'), period: z.enum(['1d', '7d', '30d']) }),
  summary: z.object({
    requests: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  }),
  items: z.array(z.object({
    date: z.string(),
    requests: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    tokens: z.number().int().nonnegative(),
    points: z.number().int().nonnegative(),
  })),
  modelItems: z.array(z.object({
    model: z.string(),
    summary: z.object({
      requests: z.number().int().nonnegative(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
    }),
    items: z.array(z.object({
      date: z.string(),
      requests: z.number().int().nonnegative(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      tokens: z.number().int().nonnegative(),
      points: z.number().int().nonnegative(),
    })),
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

export type PeopleQuery = z.infer<typeof peopleQuerySchema>
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
    const matchesSearch = !normalizedSearch || [person.name, person.title].some((value) => value.toLocaleLowerCase('zh-CN').includes(normalizedSearch))
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
      unknown: 0,
      externalMissing: 0,
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

function filterPeopleResponse(query: PeopleQuery, people: PeopleResponse['items'], newApi: NewApiStatus, now: Date, source: 'demo' | 'database' | 'new_api', notice: string): PeopleResponse {
  const normalizedSearch = query.search.toLocaleLowerCase('zh-CN')
  const filtered = people.filter((person) => {
    const matchesSearch = !normalizedSearch || [person.name, person.title].some((value) => value.toLocaleLowerCase('zh-CN').includes(normalizedSearch))
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
      unknown: people.filter((person) => person.status === 'unknown').length,
      externalMissing: people.filter((person) => person.status === 'external_missing').length,
      departments: departments.length,
    },
    departments,
    items: filtered.slice(start, start + query.pageSize),
    page: query.page,
    pageSize: query.pageSize,
    total: filtered.length,
  }
}

function livePersonStatus(status: NormalizedNewApiPerson['status']): PeopleResponse['items'][number]['status'] {
  if (status === 'disabled') return 'disabled'
  if (status === 'unknown') return 'unknown'
  return 'active'
}

function livePersonItem(person: NormalizedNewApiPerson, keyCount: number, index: number): PeopleResponse['items'][number] {
  const status = livePersonStatus(person.status)
  const tones: PeopleResponse['items'][number]['tone'][] = ['blue', 'violet', 'green', 'amber', 'coral']
  return {
    id: stableNewApiPersonId(person.externalUserId),
    name: person.displayName,
    initials: person.displayName.slice(0, 2),
    department: { id: person.departmentId, name: person.departmentName },
    title: 'New API 用户',
    manager: '—',
    status,
    username: person.username,
    externalUserId: person.externalUserId,
    source: 'new-api',
    syncState: 'synced',
    createdAt: person.createdAt,
    lastUsedAt: person.lastUsedAt,
    keyCount,
    goal: { used: 0, limit: 1, percent: 0, state: 'normal' },
    lastActiveAt: person.lastUsedAt,
    tone: tones[index % tones.length]!,
  }
}

export function createNewApiPeople(
  sourcePeople: readonly NormalizedNewApiPerson[],
  keyCounts: ReadonlyMap<string, number>,
  query: PeopleQuery,
  now = new Date(),
  scope: DataScope = { mode: 'global' },
): PeopleResponse {
  const people = sourcePeople.map((person, index) => livePersonItem(person, keyCounts.get(person.externalUserId) ?? 0, index)).filter((person) => isDepartmentVisible(scope, person.department.id))
  return filterPeopleResponse(
    query,
    people,
    { state: 'ready', authConfigured: true, checkedAt: now.toISOString() },
    now,
    'new_api',
    `人员、部门和状态来自 New API 实时用户数据；Key 数量来自 New API Token 数据，AI OPS SQLite 仅保存镜像和审计。${scopeNotice(scope)}`,
  )
}

function liveKeyId(tokenId: string) {
  const safe = tokenId.toLocaleLowerCase('en-US').replace(/[^a-z0-9-]+/g, '-')
  return `key-new-api-${safe || 'token'}-1`
}

function livePersonKeys(person: PeopleResponse['items'][number], tokens: readonly NewApiTokenRecord[], now: Date) {
  return tokens.filter((token) => token.userId === person.externalUserId).map((token) => {
    const models = token.modelLimits.length ? token.modelLimits : ['未绑定模型']
    const model = models[0]!
    return {
      id: liveKeyId(token.id),
      masked: token.masked,
      purpose: token.name,
      model,
      status: token.status === 'active' ? 'active' as const : 'disabled' as const,
      models,
      expiresAt: token.expiresAt,
      lastUsedAt: token.lastUsedAt,
      usage: { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      createdAt: token.createdAt ?? now.toISOString(),
    }
  })
}

export function createNewApiPersonDetail(
  sourcePeople: readonly NormalizedNewApiPerson[],
  tokens: readonly NewApiTokenRecord[],
  id: string,
  now = new Date(),
  scope: DataScope = { mode: 'global' },
): PersonDetailResponse | null {
  const source = sourcePeople.find((person) => stableNewApiPersonId(person.externalUserId) === id)
  if (!source) return null
  const profile = livePersonItem(source, tokens.filter((token) => token.userId === source.externalUserId).length, sourcePeople.indexOf(source))
  if (!isDepartmentVisible(scope, profile.department.id)) return null
  const keys = livePersonKeys(profile, tokens, now)
  return {
    meta: { source: 'new_api', generatedAt: now.toISOString(), timezone: 'Asia/Shanghai', notice: '人员档案和 Key 元数据来自 New API；当前 New API 日志统计适配器未提供本地演示用量，页面不读取 AI OPS 旧统计。' },
    profile,
    metrics: { todayRequests: 0, monthInputTokens: 0, monthOutputTokens: 0, monthTokens: 0, monthPoints: 0, monthPointLimit: 1, successRate: 0, p95LatencyMs: 0 },
    keys: keys.map(({ createdAt: _createdAt, ...key }) => key),
  }
}

export function createDatabasePeople(database: PlatformDatabase, query: PeopleQuery, newApi: NewApiStatus, now = new Date(), scope: DataScope = { mode: 'global' }): PeopleResponse {
  const syncedPeople = database.listSyncedPeople()
  if (syncedPeople.length) {
    const tones: PeopleResponse['items'][number]['tone'][] = ['blue', 'violet', 'green', 'amber', 'coral']
    const people = syncedPeople.map((row, index) => {
      const keyCount = database.listApiKeysForOwner(row.id).filter((key) => key.status !== 'revoked').length
      const status = row.syncState === 'external_missing' ? 'external_missing' as const : row.sourceStatus === 'disabled' ? 'disabled' as const : 'active' as const
      return {
        id: row.id,
        name: row.displayName,
        initials: row.displayName.slice(0, 2),
        department: { id: row.departmentId, name: row.departmentName },
        title: 'New API 用户',
        manager: '—',
        status,
        username: row.username,
        externalUserId: row.externalUserId,
        source: 'new-api' as const,
        syncState: row.syncState,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
        keyCount,
        goal: { used: 0, limit: 1, percent: 0, state: 'normal' as const },
        lastActiveAt: row.lastUsedAt,
        tone: tones[index % tones.length]!,
      }
    }).filter((person) => isDepartmentVisible(scope, person.department.id))
    const syncState = syncedPeople.some((person) => person.syncState === 'stale') ? 'stale' : syncedPeople.some((person) => person.syncState === 'external_missing') ? 'external_missing' : 'synced'
    const notice = syncState === 'stale'
      ? 'New API 暂时不可达；页面保留上次同步快照并标记为过期，未批量停用人员。'
      : syncState === 'external_missing'
        ? '人员身份和状态来自 New API；未返回的外部用户已标记为找不到，未自动停用。'
        : '人员身份、部门和状态已自动与 New API 普通用户对应；本页不创建员工 Key 或额度。'
    return filterPeopleResponse(query, people, newApi, now, 'database', `${notice}${scopeNotice(scope)}`)
  }
  if (newApi.state === 'ready') {
    return filterPeopleResponse(
      query,
      [],
      newApi,
      now,
      'database',
      `尚未同步 New API 普通用户；页面会自动读取用户目录，不展示管理员或演示人员。${scopeNotice(scope)}`,
    )
  }
  const demo = createDemoPeople({ search: '', department: 'all', status: 'all', goal: 'all', page: 1, pageSize: 50 }, newApi, now)
  const demoById = new Map(demo.items.map((person) => [person.id, person]))
  const personPolicies = new Map(database.listQuotaPolicies().filter((policy) => policy.level === 'person' && policy.period === 'month').map((policy) => [policy.subjectId, policy]))
  const tones: PeopleResponse['items'][number]['tone'][] = ['blue', 'violet', 'green', 'amber', 'coral']
  const people = database.listPeople().map((row, index) => {
    const keyCount = database.listApiKeysForOwner(row.id).filter((key) => key.status !== 'revoked').length
    const existing = demoById.get(row.id)
    if (existing) {
      const targetPoints = personPolicies.get(row.id)?.targetPoints ?? existing.goal.limit
      const percent = Math.round(existing.goal.used / targetPoints * 100)
      return {
        ...existing,
        name: row.displayName,
        department: row.departmentId && row.departmentName ? { id: row.departmentId, name: row.departmentName } : existing.department,
        status: row.status === 'disabled' ? 'disabled' as const : existing.status,
        keyCount,
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
        keyCount,
      goal: { used: 0, limit: targetPoints, percent, state: 'normal' as const },
      lastActiveAt: null,
      tone: tones[index % tones.length]!,
    }
  })
  const visiblePeople = people.filter((person) => isDepartmentVisible(scope, person.department.id))
  const notice = visiblePeople.length || database.listPeople().length
    ? databaseNotice(newApi)
    : '尚未同步 New API 用户；请先打开“同步 New API”生成预览，页面不会把空列表当作没有人员。'
  return filterPeopleResponse(query, visiblePeople, newApi, now, 'database', `${notice}${scopeNotice(scope)}`)
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

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000

function shanghaiDateParts(date: Date) {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS)
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate() }
}

function shanghaiDayKey(date: Date) {
  const shifted = shanghaiDateParts(date)
  return `${shifted.year}-${String(shifted.month + 1).padStart(2, '0')}-${String(shifted.day).padStart(2, '0')}`
}

function shanghaiStartOfDay(date: Date, dayOffset = 0) {
  const shifted = shanghaiDateParts(date)
  return new Date(Date.UTC(shifted.year, shifted.month, shifted.day + dayOffset, -8, 0, 0, 0))
}

function shanghaiStartOfMonth(date: Date) {
  const shifted = shanghaiDateParts(date)
  return new Date(Date.UTC(shifted.year, shifted.month, 1, -8, 0, 0, 0))
}

function shortDayLabel(day: string) {
  const [, month, date] = day.split('-')
  return `${month}/${date}`
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
  const monthStart = shanghaiStartOfMonth(now).toISOString()
  const keyUsage = new Map(database.listPersonKeyTokenUsage(id, monthStart).map((usage) => [usage.keyId, usage]))
  const keys = database.listApiKeysForOwner(id).map((key) => ({
    id: key.id,
    masked: key.maskedValue,
    purpose: key.purpose,
    model: key.model,
    status: key.status === 'revoked' ? 'disabled' as const : 'active' as const,
    models: [key.model],
    expiresAt: key.expiresAt,
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
  const count = period === '1d' ? 1 : period === '7d' ? 7 : 30
  const seed = demoPeople.findIndex((candidate) => candidate.id === id) + 1
  const base = Math.max(8, Math.round(person.goal.used / count))
  const items = Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getTime() - (count - index - 1) * 86_400_000)
    const requests = person.status === 'disabled' ? 0 : Math.max(0, Math.round(base * 4.4 + Math.sin((index + seed) / 2) * base + (index % 3) * seed))
    const tokens = requests * (3_600 + seed * 85)
    const inputTokens = Math.round(tokens * 0.62)
    return {
      date: `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`,
      requests,
      inputTokens,
      outputTokens: tokens - inputTokens,
      tokens,
      points: Math.round(requests * 0.16),
    }
  })
  const totalTokens = items.reduce((total, item) => total + item.tokens, 0)
  const inputTokens = Math.round(totalTokens * 0.62)
  const detail = createDemoPersonDetail(id, newApi, now)
  const breakdown = detail?.keys.map((key) => {
    const ratio = detail.metrics.monthTokens > 0 ? key.usage.totalTokens / detail.metrics.monthTokens : 0
    const keyInputTokens = Math.round(inputTokens * ratio)
    const keyTotalTokens = Math.round(totalTokens * ratio)
    return {
      keyId: key.id,
      masked: key.masked,
      purpose: key.purpose,
      model: key.model,
      alias: key.model,
      requests: Math.round(items.reduce((total, item) => total + item.requests, 0) * ratio),
      inputTokens: keyInputTokens,
      outputTokens: keyTotalTokens - keyInputTokens,
      totalTokens: keyTotalTokens,
    }
  }) ?? []
  const summary = {
    requests: items.reduce((total, item) => total + item.requests, 0),
    inputTokens,
    outputTokens: totalTokens - inputTokens,
    totalTokens,
  }
  const modelRatios = new Map<string, number>()
  const monthTokens = detail?.metrics.monthTokens ?? 0
  for (const key of detail?.keys ?? []) {
    const ratio = monthTokens > 0 ? key.usage.totalTokens / monthTokens : 0
    modelRatios.set(key.model, (modelRatios.get(key.model) ?? 0) + ratio)
  }
  const modelItems = [...modelRatios.entries()].map(([model, ratio]) => {
    const modelDailyItems = items.map((item) => {
      const requests = Math.round(item.requests * ratio)
      const inputTokens = Math.round(item.inputTokens * ratio)
      const outputTokens = Math.round(item.outputTokens * ratio)
      return { ...item, requests, inputTokens, outputTokens, tokens: inputTokens + outputTokens, points: Math.round(item.points * ratio) }
    })
    return {
      model,
      summary: {
        requests: modelDailyItems.reduce((total, item) => total + item.requests, 0),
        inputTokens: modelDailyItems.reduce((total, item) => total + item.inputTokens, 0),
        outputTokens: modelDailyItems.reduce((total, item) => total + item.outputTokens, 0),
        totalTokens: modelDailyItems.reduce((total, item) => total + item.tokens, 0),
      },
      items: modelDailyItems,
    }
  })
  return { meta: { source: 'demo', generatedAt: now.toISOString(), timezone: 'Asia/Shanghai', period }, summary, items, modelItems, breakdown }
}

export function createDatabasePersonUsage(database: PlatformDatabase, id: string, period: PersonUsagePeriod, newApi: NewApiStatus, now = new Date(), scope: DataScope = { mode: 'global' }): PersonUsageResponse | null {
  const person = findDatabasePerson(database, id, newApi, now)
  if (!person || !isDepartmentVisible(scope, person.department.id)) return null
  const count = period === '1d' ? 1 : period === '7d' ? 7 : 30
  const since = shanghaiStartOfDay(now, -(count - 1)).toISOString()
  const daily = new Map(database.listPersonUsageByDay(id, since).map((item) => [item.day, item]))
  const dailyByModel = database.listPersonUsageByDayAndModel(id, since)
  const usageRows = database.listPersonUsageByKeyAndModel(id, since)
  const breakdown = usageRows.map((item) => {
    const inputTokens = Number(item.inputTokens)
    const outputTokens = Number(item.outputTokens)
    return {
      keyId: item.keyId,
      masked: item.masked,
      purpose: item.purpose,
      model: item.model,
      alias: item.alias,
      requests: Number(item.requests),
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    }
  })
  const knownKeys = new Set(breakdown.map((item) => item.keyId))
  for (const key of database.listApiKeysForOwner(id)) {
    if (knownKeys.has(key.id)) continue
    breakdown.push({
      keyId: key.id,
      masked: key.maskedValue,
      purpose: key.purpose,
      model: key.model,
      alias: key.model,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    })
  }
  const summary = breakdown.reduce((total, item) => ({
    requests: total.requests + item.requests,
    inputTokens: total.inputTokens + item.inputTokens,
    outputTokens: total.outputTokens + item.outputTokens,
    totalTokens: total.totalTokens + item.totalTokens,
  }), { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 })
  const items = Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getTime() - (count - index - 1) * 86_400_000)
    const row = daily.get(shanghaiDayKey(date))
    const requests = Number(row?.requests ?? 0)
    const inputTokens = Number(row?.inputTokens ?? 0)
    const outputTokens = Number(row?.outputTokens ?? 0)
    return { date: shortDayLabel(shanghaiDayKey(date)), requests, inputTokens, outputTokens, tokens: inputTokens + outputTokens, points: Math.round(Number(row?.points ?? 0)) }
  })
  const modelNames = [...new Set(breakdown.map((item) => item.model))]
  const modelItems = modelNames.map((model) => {
    const rows = dailyByModel.filter((item) => item.model === model)
    const byDay = new Map(rows.map((item) => [item.day, item]))
    const modelDailyItems = Array.from({ length: count }, (_, index) => {
      const date = new Date(now.getTime() - (count - index - 1) * 86_400_000)
      const row = byDay.get(shanghaiDayKey(date))
      const requests = Number(row?.requests ?? 0)
      const inputTokens = Number(row?.inputTokens ?? 0)
      const outputTokens = Number(row?.outputTokens ?? 0)
      return { date: shortDayLabel(shanghaiDayKey(date)), requests, inputTokens, outputTokens, tokens: inputTokens + outputTokens, points: Math.round(Number(row?.points ?? 0)) }
    })
    return {
      model,
      summary: {
        requests: modelDailyItems.reduce((total, item) => total + item.requests, 0),
        inputTokens: modelDailyItems.reduce((total, item) => total + item.inputTokens, 0),
        outputTokens: modelDailyItems.reduce((total, item) => total + item.outputTokens, 0),
        totalTokens: modelDailyItems.reduce((total, item) => total + item.tokens, 0),
      },
      items: modelDailyItems,
    }
  })
  return { meta: { source: 'database', generatedAt: now.toISOString(), timezone: 'Asia/Shanghai', period }, summary, items, modelItems, breakdown }
}

export function createNewApiPersonUsage(reader: Pick<NewApiDatabaseReader, 'listLogs'>, id: string, period: PersonUsagePeriod, now = new Date()): PersonUsageResponse {
  const count = period === '1d' ? 1 : period === '7d' ? 7 : 30
  const since = shanghaiStartOfDay(now, -(count - 1)).getTime()
  const logs = reader.listLogs().filter((item) => item.userId && stableNewApiPersonId(item.userId) === id && new Date(item.occurredAt ?? 0).getTime() >= since)
  const byDay = new Map<string, { requests: number; inputTokens: number; outputTokens: number; points: number }>()
  const byModel = new Map<string, NewApiLogRecord[]>()
  const byKey = new Map<string, { masked: string; purpose: string; model: string; requests: number; inputTokens: number; outputTokens: number }>()
  for (const log of logs) {
    const day = shanghaiDayKey(new Date(log.occurredAt ?? 0))
    const daily = byDay.get(day) ?? { requests: 0, inputTokens: 0, outputTokens: 0, points: 0 }
    daily.requests += 1
    daily.inputTokens += log.promptTokens
    daily.outputTokens += log.completionTokens
    daily.points += log.quota
    byDay.set(day, daily)
    const model = log.modelName || 'unknown-model'
    byModel.set(model, [...(byModel.get(model) ?? []), log])
    const keyId = `key-new-api-${log.tokenId ?? 'unknown'}`
    const key = byKey.get(keyId) ?? { masked: log.tokenName ? `New API Token · ${log.tokenName}` : 'New API Token', purpose: log.tokenName || log.group || 'New API', model, requests: 0, inputTokens: 0, outputTokens: 0 }
    key.requests += 1
    key.inputTokens += log.promptTokens
    key.outputTokens += log.completionTokens
    byKey.set(keyId, key)
  }
  const items = Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getTime() - (count - index - 1) * 86_400_000)
    const row = byDay.get(shanghaiDayKey(date)) ?? { requests: 0, inputTokens: 0, outputTokens: 0, points: 0 }
    return { date: shortDayLabel(shanghaiDayKey(date)), requests: row.requests, inputTokens: row.inputTokens, outputTokens: row.outputTokens, tokens: row.inputTokens + row.outputTokens, points: Math.round(row.points) }
  })
  const modelItems = [...byModel.entries()].map(([model, modelLogs]) => {
    const modelDaily = new Map<string, { requests: number; inputTokens: number; outputTokens: number; points: number }>()
    for (const log of modelLogs) {
      const day = shanghaiDayKey(new Date(log.occurredAt ?? 0))
      const row = modelDaily.get(day) ?? { requests: 0, inputTokens: 0, outputTokens: 0, points: 0 }
      row.requests += 1
      row.inputTokens += log.promptTokens
      row.outputTokens += log.completionTokens
      row.points += log.quota
      modelDaily.set(day, row)
    }
    const modelRows = Array.from({ length: count }, (_, index) => {
      const date = new Date(now.getTime() - (count - index - 1) * 86_400_000)
      const row = modelDaily.get(shanghaiDayKey(date)) ?? { requests: 0, inputTokens: 0, outputTokens: 0, points: 0 }
      return { date: shortDayLabel(shanghaiDayKey(date)), requests: row.requests, inputTokens: row.inputTokens, outputTokens: row.outputTokens, tokens: row.inputTokens + row.outputTokens, points: Math.round(row.points) }
    })
    return {
      model,
      summary: { requests: modelRows.reduce((total, row) => total + row.requests, 0), inputTokens: modelRows.reduce((total, row) => total + row.inputTokens, 0), outputTokens: modelRows.reduce((total, row) => total + row.outputTokens, 0), totalTokens: modelRows.reduce((total, row) => total + row.tokens, 0) },
      items: modelRows,
    }
  })
  const breakdown = [...byKey.entries()].map(([keyId, key]) => ({ keyId, masked: key.masked, purpose: key.purpose, model: key.model, alias: key.model, requests: key.requests, inputTokens: key.inputTokens, outputTokens: key.outputTokens, totalTokens: key.inputTokens + key.outputTokens }))
  const summary = breakdown.reduce((total, item) => ({ requests: total.requests + item.requests, inputTokens: total.inputTokens + item.inputTokens, outputTokens: total.outputTokens + item.outputTokens, totalTokens: total.totalTokens + item.totalTokens }), { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 })
  return { meta: { source: 'new_api', generatedAt: now.toISOString(), timezone: 'Asia/Shanghai', period }, summary, items, modelItems, breakdown }
}
