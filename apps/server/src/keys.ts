import { z } from 'zod'
import type { NewApiStatus } from './new-api-status.js'
import { isDepartmentVisible, scopeNotice, type DataScope } from './data-scope.js'
import type { PlatformDatabase } from './platform-db.js'

export const keysQuerySchema = z.object({
  search: z.string().trim().max(60).default(''),
  owner: z.string().trim().max(64).default('all'),
  purpose: z.string().trim().max(40).default('all'),
  model: z.string().trim().max(64).default('all'),
  status: z.enum(['all', 'active', 'disabled', 'expiring']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})

export const keyIdParamsSchema = z.object({ id: z.string().regex(/^key-[a-z0-9-]+-[1-9][0-9]*$/).max(96) })

const keyListItemSchema = z.object({
  id: z.string(),
  masked: z.string(),
  owner: z.object({ id: z.string(), name: z.string(), department: z.string(), initials: z.string() }),
  purpose: z.string(),
  models: z.array(z.string()),
  status: z.enum(['active', 'disabled']),
  expiryState: z.enum(['normal', 'expiring', 'expired']),
  expiresAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  usage: z.object({ requests: z.number().int().nonnegative(), points: z.number().int().nonnegative() }),
})

const connectionSchema = z.object({
  baseUrl: z.string().url(),
  note: z.string(),
})

export const keysResponseSchema = z.object({
  meta: z.object({ source: z.enum(['demo', 'database']), generatedAt: z.string().datetime(), timezone: z.literal('Asia/Shanghai'), notice: z.string() }),
  summary: z.object({ total: z.number().int().nonnegative(), active: z.number().int().nonnegative(), disabled: z.number().int().nonnegative(), expiring: z.number().int().nonnegative() }),
  options: z.object({
    owners: z.array(z.object({ id: z.string(), name: z.string() })),
    purposes: z.array(z.string()),
    models: z.array(z.string()),
  }),
  connection: connectionSchema,
  items: z.array(keyListItemSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
})

export const keyDetailResponseSchema = z.object({
  meta: z.object({ source: z.enum(['demo', 'database']), generatedAt: z.string().datetime(), timezone: z.literal('Asia/Shanghai') }),
  key: keyListItemSchema.extend({
    createdAt: z.string().datetime(),
    deviceNote: z.string(),
    allowedIps: z.array(z.string()),
    limits: z.object({ rpm: z.number().int().positive(), tpm: z.number().int().positive(), concurrent: z.number().int().positive() }),
  }),
  connection: connectionSchema.extend({ instructions: z.array(z.string()) }),
})

export const keyCreateBodySchema = z.object({
  ownerId: z.string().regex(/^person-[a-z0-9-]+$/).max(96),
  purpose: z.string().trim().min(2).max(40),
  models: z.array(z.string().trim().min(2).max(64)).min(1).max(8),
  expiresInDays: z.coerce.number().int().min(1).max(365),
  deviceNote: z.string().trim().max(120).default('本地演示设备'),
})

export const keyCreateResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), createdAt: z.string().datetime(), notice: z.string() }),
  key: z.object({ id: z.string(), masked: z.string(), owner: z.object({ id: z.string(), name: z.string(), department: z.string() }), purpose: z.string(), models: z.array(z.string()), expiresAt: z.string().datetime() }),
  secret: z.string().min(20),
})

export const keyDisableBodySchema = z.object({
  idempotencyKey: z.string().regex(/^key-disable-[a-z0-9-]{8,96}$/),
  reason: z.string().trim().min(8).max(200),
  acknowledgeImpact: z.literal(true),
})

export const keyDisableResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), completedAt: z.string().datetime(), notice: z.string() }),
  key: z.object({ id: z.string(), masked: z.string(), status: z.literal('disabled') }),
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})

export type KeysQuery = z.infer<typeof keysQuerySchema>
export type KeysResponse = z.infer<typeof keysResponseSchema>
export type KeyDetailResponse = z.infer<typeof keyDetailResponseSchema>
export type KeyCreateBody = z.infer<typeof keyCreateBodySchema>
export type KeyCreateResponse = z.infer<typeof keyCreateResponseSchema>
export type KeyDisableBody = z.infer<typeof keyDisableBodySchema>
export type KeyDisableResponse = z.infer<typeof keyDisableResponseSchema>

interface KeySeed {
  id: string
  suffix: string
  ownerId: string
  ownerName: string
  initials: string
  department: string
  purpose: string
  models: string[]
  status: 'active' | 'disabled'
  expiresInDays: number
  lastUsedMinutes: number | null
  requests: number
  points: number
  deviceNote: string
}

const demoKeys: KeySeed[] = [
  { id: 'key-lin-1', suffix: '7F2A', ownerId: 'person-lin', ownerName: '林筱雨', initials: 'LY', department: '内容运营', purpose: '商品文案', models: ['ecommerce-copy', 'ecommerce-general'], status: 'active', expiresInDays: 120, lastUsedMinutes: 6, requests: 1684, points: 542, deviceNote: 'Codex Desktop · 内容工作站' },
  { id: 'key-lin-2', suffix: '3C91', ownerId: 'person-lin', ownerName: '林筱雨', initials: 'LY', department: '内容运营', purpose: '临时项目', models: ['ecommerce-copy'], status: 'active', expiresInDays: 85, lastUsedMinutes: 42, requests: 526, points: 200, deviceNote: 'WorkBuddy · 选品项目' },
  { id: 'key-zhou-1', suffix: '8B14', ownerId: 'person-zhou', ownerName: '周明远', initials: 'ZM', department: '广告投放', purpose: '策略分析', models: ['ecommerce-analysis', 'ecommerce-general'], status: 'active', expiresInDays: 26, lastUsedMinutes: 18, requests: 976, points: 681, deviceNote: 'Codex Desktop · 投放工作站' },
  { id: 'key-chen-1', suffix: 'C620', ownerId: 'person-chen', ownerName: '陈安琪', initials: 'CA', department: '跨境运营', purpose: '多语翻译', models: ['ecommerce-translate', 'ecommerce-general'], status: 'active', expiresInDays: 103, lastUsedMinutes: 33, requests: 1720, points: 412, deviceNote: 'WorkBuddy · 跨境工作站' },
  { id: 'key-chen-2', suffix: 'E15D', ownerId: 'person-chen', ownerName: '陈安琪', initials: 'CA', department: '跨境运营', purpose: '临时项目', models: ['ecommerce-translate'], status: 'active', expiresInDays: 14, lastUsedMinutes: 165, requests: 490, points: 131, deviceNote: 'Codex Desktop · 欧洲站项目' },
  { id: 'key-xu-1', suffix: '92AC', ownerId: 'person-xu', ownerName: '许嘉禾', initials: 'XJ', department: '客户服务', purpose: '回复建议', models: ['ecommerce-service', 'ecommerce-general'], status: 'active', expiresInDays: 66, lastUsedMinutes: 51, requests: 2538, points: 438, deviceNote: 'WorkBuddy · 客服主管席' },
  { id: 'key-tang-1', suffix: '41D8', ownerId: 'person-tang', ownerName: '唐语宁', initials: 'TY', department: '商品运营', purpose: '图片检查', models: ['ecommerce-copy', 'ecommerce-general'], status: 'active', expiresInDays: 44, lastUsedMinutes: 77, requests: 744, points: 361, deviceNote: 'Codex Desktop · 商品工作站' },
  { id: 'key-he-1', suffix: 'B73E', ownerId: 'person-he', ownerName: '何沐晨', initials: 'HM', department: '内容运营', purpose: '标题优化', models: ['ecommerce-copy'], status: 'active', expiresInDays: 92, lastUsedMinutes: 125, requests: 680, points: 286, deviceNote: 'WorkBuddy · 内容编辑席' },
  { id: 'key-luo-1', suffix: '5A09', ownerId: 'person-luo', ownerName: '罗一帆', initials: 'LF', department: '广告投放', purpose: '素材分析', models: ['ecommerce-analysis'], status: 'active', expiresInDays: 9, lastUsedMinutes: 210, requests: 521, points: 152, deviceNote: 'Codex Desktop · 素材分析' },
  { id: 'key-luo-2', suffix: 'D04C', ownerId: 'person-luo', ownerName: '罗一帆', initials: 'LF', department: '广告投放', purpose: '临时项目', models: ['ecommerce-pro-lab'], status: 'disabled', expiresInDays: -2, lastUsedMinutes: 1860, requests: 146, points: 73, deviceNote: '隔离实验设备 · 已停用' },
  { id: 'key-su-1', suffix: 'A811', ownerId: 'person-su', ownerName: '苏澄', initials: 'SC', department: '跨境运营', purpose: '多语翻译', models: ['ecommerce-translate'], status: 'active', expiresInDays: 78, lastUsedMinutes: 340, requests: 610, points: 198, deviceNote: 'WorkBuddy · 本地化席' },
  { id: 'key-qiao-1', suffix: '62BE', ownerId: 'person-qiao', ownerName: '乔南星', initials: 'QX', department: '客户服务', purpose: '回复建议', models: ['ecommerce-service'], status: 'active', expiresInDays: 18, lastUsedMinutes: 1450, requests: 418, points: 156, deviceNote: 'WorkBuddy · 离职回收中' },
  { id: 'key-guo-1', suffix: 'F330', ownerId: 'person-guo', ownerName: '郭子谦', initials: 'GQ', department: '商品运营', purpose: '选品分析', models: ['ecommerce-analysis'], status: 'active', expiresInDays: 110, lastUsedMinutes: 580, requests: 370, points: 112, deviceNote: 'Codex Desktop · 选品席' },
  { id: 'key-wei-1', suffix: '19CE', ownerId: 'person-wei', ownerName: '魏昭', initials: 'WZ', department: '客户服务', purpose: '会话质检', models: ['ecommerce-service'], status: 'active', expiresInDays: 58, lastUsedMinutes: 920, requests: 288, points: 92, deviceNote: 'Codex Desktop · 质检席' },
]

function safeClientBaseUrl(value: string | undefined) {
  try {
    const url = new URL(value || 'http://127.0.0.1:3000')
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol')
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    url.pathname = `${url.pathname.replace(/\/$/, '')}/v1`.replace(/\/v1\/v1$/, '/v1')
    return url.toString().replace(/\/$/, '')
  } catch {
    return 'http://127.0.0.1:3000/v1'
  }
}

function noticeFor(newApi: NewApiStatus) {
  if (newApi.state === 'ready') return 'New API 管理连接已验证；Key 字段映射完成前，本页仍使用演示数据'
  if (newApi.state === 'reachable') return 'New API 服务可达但尚未配置管理认证；Key 列表为演示数据'
  if (newApi.state === 'auth_required') return 'New API 管理认证未通过；Key 列表为演示数据'
  return 'New API 当前离线；Key 列表为演示数据'
}

function mapKey(seed: KeySeed, now: Date): z.infer<typeof keyListItemSchema> {
  const expiresAt = new Date(now.getTime() + seed.expiresInDays * 86_400_000).toISOString()
  return {
    id: seed.id,
    masked: `sk-ops••••••${seed.suffix}`,
    owner: { id: seed.ownerId, name: seed.ownerName, department: seed.department, initials: seed.initials },
    purpose: seed.purpose,
    models: seed.models,
    status: seed.status,
    expiryState: seed.expiresInDays < 0 ? 'expired' : seed.expiresInDays <= 30 ? 'expiring' : 'normal',
    expiresAt,
    lastUsedAt: seed.lastUsedMinutes === null ? null : new Date(now.getTime() - seed.lastUsedMinutes * 60_000).toISOString(),
    usage: { requests: seed.requests, points: seed.points },
  }
}

export function createDemoKeys(query: KeysQuery, newApi: NewApiStatus, now = new Date()): KeysResponse {
  const items = demoKeys.map((seed) => mapKey(seed, now))
  const search = query.search.toLocaleLowerCase('zh-CN')
  const filtered = items.filter((key) => {
    const matchesSearch = !search || [key.masked, key.owner.name, key.owner.department, key.purpose, ...key.models].some((value) => value.toLocaleLowerCase('zh-CN').includes(search))
    const matchesOwner = query.owner === 'all' || key.owner.id === query.owner
    const matchesPurpose = query.purpose === 'all' || key.purpose === query.purpose
    const matchesModel = query.model === 'all' || key.models.includes(query.model)
    const matchesStatus = query.status === 'all' || (query.status === 'expiring' ? key.expiryState === 'expiring' : key.status === query.status)
    return matchesSearch && matchesOwner && matchesPurpose && matchesModel && matchesStatus
  })
  const uniqueOwners = new Map(items.map((key) => [key.owner.id, { id: key.owner.id, name: key.owner.name }]))
  const start = (query.page - 1) * query.pageSize
  return {
    meta: { source: 'demo', generatedAt: now.toISOString(), timezone: 'Asia/Shanghai', notice: noticeFor(newApi) },
    summary: {
      total: items.length,
      active: items.filter((key) => key.status === 'active').length,
      disabled: items.filter((key) => key.status === 'disabled').length,
      expiring: items.filter((key) => key.expiryState === 'expiring').length,
    },
    options: {
      owners: [...uniqueOwners.values()],
      purposes: [...new Set(items.map((key) => key.purpose))],
      models: [...new Set(items.flatMap((key) => key.models))],
    },
    connection: { baseUrl: safeClientBaseUrl(process.env.NEW_API_BASE_URL), note: '员工只使用平台地址和个人 Key；不得接触管理凭据或上游密钥。' },
    items: filtered.slice(start, start + query.pageSize),
    page: query.page,
    pageSize: query.pageSize,
    total: filtered.length,
  }
}

export function createDemoKeyDetail(id: string, now = new Date()): KeyDetailResponse | null {
  const seed = demoKeys.find((key) => key.id === id)
  if (!seed) return null
  return {
    meta: { source: 'demo', generatedAt: now.toISOString(), timezone: 'Asia/Shanghai' },
    key: {
      ...mapKey(seed, now),
      createdAt: new Date(now.getTime() - 76 * 86_400_000).toISOString(),
      deviceNote: seed.deviceNote,
      allowedIps: ['未限制'],
      limits: { rpm: 60, tpm: 120_000, concurrent: 4 },
    },
    connection: {
      baseUrl: safeClientBaseUrl(process.env.NEW_API_BASE_URL),
      note: '复制非敏感配置后，由员工自行填写仅属于本人的 Key。',
      instructions: ['Base URL 指向统一 New API 入口', '模型填写已授权的业务别名', 'API Key 仅在员工自己的客户端中保存', '认证失败时先确认 Key 状态与到期时间'],
    },
  }
}

function databaseNotice(newApi: NewApiStatus) {
  if (newApi.state === 'ready') return 'Key 列表已从平台 SQLite 读取；New API 管理映射仍待接入'
  if (newApi.state === 'reachable') return 'Key 列表来自平台 SQLite；New API 服务可达但尚未配置管理认证'
  if (newApi.state === 'auth_required') return 'Key 列表来自平台 SQLite；New API 管理认证未通过'
  return 'Key 列表来自平台 SQLite；New API 当前离线'
}

function keyExpiryState(expiresAt: string, now: Date): 'normal' | 'expiring' | 'expired' {
  const remaining = new Date(expiresAt).getTime() - now.getTime()
  if (remaining < 0) return 'expired'
  return remaining <= 30 * 86_400_000 ? 'expiring' : 'normal'
}

export function createDatabaseKeys(database: PlatformDatabase, query: KeysQuery, newApi: NewApiStatus, now = new Date(), scope: DataScope = { mode: 'global' }): KeysResponse {
  const demo = createDemoKeys({ search: '', owner: 'all', purpose: 'all', model: 'all', status: 'all', page: 1, pageSize: 50 }, newApi, now)
  const demoById = new Map(demo.items.map((item) => [item.id, item]))
  const databaseKeys = database.listApiKeys()
  const departmentByKeyId = new Map(databaseKeys.map((row) => [row.id, row.departmentId]))
  const keys = databaseKeys.map((row) => {
    const existing = demoById.get(row.id)
    const expiresAt = row.expiresAt ?? existing?.expiresAt ?? new Date(now.getTime() + 90 * 86_400_000).toISOString()
    const status = row.status === 'revoked' ? 'disabled' as const : existing?.status ?? 'active' as const
    return {
      id: row.id,
      masked: row.maskedValue,
      owner: { id: row.ownerUserId, name: row.ownerName, department: row.departmentName ?? '待分配部门', initials: existing?.owner.initials ?? row.ownerName.slice(0, 2) },
      purpose: row.purpose,
      models: row.models.length ? row.models : existing?.models ?? ['ecommerce-general'],
      status,
      expiryState: keyExpiryState(expiresAt, now),
      expiresAt,
      lastUsedAt: existing?.lastUsedAt ?? null,
      usage: existing?.usage ?? { requests: 0, points: 0 },
    }
  })
  const visibleKeys = keys.filter((key) => {
    return isDepartmentVisible(scope, departmentByKeyId.get(key.id))
  })
  const search = query.search.toLocaleLowerCase('zh-CN')
  const filtered = visibleKeys.filter((key) => {
    const matchesSearch = !search || [key.masked, key.owner.name, key.owner.department, key.purpose, ...key.models].some((value) => value.toLocaleLowerCase('zh-CN').includes(search))
    const matchesOwner = query.owner === 'all' || key.owner.id === query.owner
    const matchesPurpose = query.purpose === 'all' || key.purpose === query.purpose
    const matchesModel = query.model === 'all' || key.models.includes(query.model)
    const matchesStatus = query.status === 'all' || (query.status === 'expiring' ? key.expiryState === 'expiring' : key.status === query.status)
    return matchesSearch && matchesOwner && matchesPurpose && matchesModel && matchesStatus
  })
  const owners = [...new Map(visibleKeys.map((key) => [key.owner.id, { id: key.owner.id, name: key.owner.name }])).values()]
  const start = (query.page - 1) * query.pageSize
  return {
    meta: { source: 'database', generatedAt: now.toISOString(), timezone: 'Asia/Shanghai', notice: `${databaseNotice(newApi)}${scopeNotice(scope)}` },
    summary: { total: visibleKeys.length, active: visibleKeys.filter((key) => key.status === 'active').length, disabled: visibleKeys.filter((key) => key.status === 'disabled').length, expiring: visibleKeys.filter((key) => key.expiryState === 'expiring').length },
    options: { owners, purposes: [...new Set(visibleKeys.map((key) => key.purpose))], models: [...new Set(visibleKeys.flatMap((key) => key.models))] },
    connection: { baseUrl: safeClientBaseUrl(process.env.NEW_API_BASE_URL), note: '员工只使用平台地址和个人 Key；不得接触管理凭据或上游密钥。' },
    items: filtered.slice(start, start + query.pageSize), page: query.page, pageSize: query.pageSize, total: filtered.length,
  }
}

export function createDatabaseKeyDetail(database: PlatformDatabase, id: string, now = new Date(), scope: DataScope = { mode: 'global' }): KeyDetailResponse | null {
  const key = createDatabaseKeys(database, { search: '', owner: 'all', purpose: 'all', model: 'all', status: 'all', page: 1, pageSize: 50 }, { state: 'offline', authConfigured: false, checkedAt: now.toISOString() }, now, scope).items.find((item) => item.id === id)
  if (!key) return null
  const row = database.listApiKeys().find((item) => item.id === id)
  return {
    meta: { source: 'database', generatedAt: now.toISOString(), timezone: 'Asia/Shanghai' },
    key: { ...key, createdAt: row?.createdAt ?? now.toISOString(), deviceNote: '本地演示设备', allowedIps: ['未限制'], limits: { rpm: 60, tpm: 120_000, concurrent: 4 } },
    connection: { baseUrl: safeClientBaseUrl(process.env.NEW_API_BASE_URL), note: '复制非敏感配置后，由员工自行填写仅属于本人的 Key。', instructions: ['Base URL 指向统一 New API 入口', '模型填写已授权的业务别名', 'API Key 仅在员工自己的客户端中保存', '认证失败时先确认 Key 状态与到期时间'] },
  }
}
