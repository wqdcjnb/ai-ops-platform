import { z } from 'zod'
import type { NewApiStatus } from './new-api-status.js'
import { isDepartmentVisible, scopeNotice, type DataScope } from './data-scope.js'
import type { PlatformDatabase } from './platform-db.js'
import type { NewApiTokenRecord } from './new-api-tokens.js'
import type { NormalizedNewApiPerson } from './people-sync.js'
import { stableNewApiPersonId } from './platform-db.js'

export const KEY_MODEL_OPTIONS = ['ecommerce-general', 'ecommerce-copy', 'ecommerce-analysis', 'ecommerce-translate', 'ecommerce-service', 'ecommerce-image-check', 'ecommerce-pro-lab'] as const

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
  createdAt: z.string().datetime(),
  purpose: z.string(),
  model: z.string(),
  models: z.array(z.string()),
  status: z.enum(['active', 'disabled']),
  expiryState: z.enum(['normal', 'expiring', 'expired']),
  expiresAt: z.string().datetime().nullable(),
  lastUsedAt: z.string().datetime().nullable(),
  usage: z.object({ requests: z.number().int().nonnegative(), points: z.number().int().nonnegative() }),
  secretAvailable: z.boolean(),
  quotaMode: z.enum(['unlimited', 'legacy']),
})

const connectionSchema = z.object({
  baseUrl: z.string().url(),
  note: z.string(),
})

export const keysResponseSchema = z.object({
  meta: z.object({ source: z.enum(['demo', 'database', 'new_api']), generatedAt: z.string().datetime(), timezone: z.literal('Asia/Shanghai'), notice: z.string() }),
  summary: z.object({ total: z.number().int().nonnegative(), active: z.number().int().nonnegative(), disabled: z.number().int().nonnegative(), expiring: z.number().int().nonnegative() }),
  options: z.object({
    owners: z.array(z.object({ id: z.string(), name: z.string(), department: z.string() })),
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
  meta: z.object({ source: z.enum(['demo', 'database', 'new_api']), generatedAt: z.string().datetime(), timezone: z.literal('Asia/Shanghai') }),
  key: keyListItemSchema.extend({
    createdAt: z.string().datetime(),
    deviceNote: z.string(),
    allowedIps: z.array(z.string()),
    limits: z.object({ rpm: z.number().int().positive().nullable(), tpm: z.number().int().positive().nullable(), concurrent: z.number().int().positive().nullable() }),
  }),
  connection: connectionSchema.extend({ instructions: z.array(z.string()) }),
})

export const keySecretResponseSchema = z.object({
  meta: z.object({ source: z.enum(['database', 'new_api']), completedAt: z.string().datetime(), notice: z.string() }),
  key: z.object({ id: z.string(), masked: z.string() }),
  secret: z.string().min(20),
  operation: z.object({ auditEventId: z.string() }),
})

const remoteKeyCreateBodySchema = z.object({
  personId: z.string().trim().min(1).max(96),
  purpose: z.string().trim().min(2).max(40),
  model: z.string().trim().min(1).max(256),
}).strict()

const legacyKeyCreateBodySchema = z.object({
  ownerId: z.string().regex(/^person-[a-z0-9-]+$/).max(96),
  purpose: z.string().trim().min(2).max(40),
  model: z.string().trim().min(1).max(256),
  expiresInDays: z.coerce.number().int().min(1).max(365),
  deviceNote: z.string().trim().max(120).default('本地演示设备'),
}).strict()

export const keyCreateBodySchema = z.union([remoteKeyCreateBodySchema, legacyKeyCreateBodySchema])

export const keyCreateResponseSchema = z.object({
  meta: z.object({ source: z.enum(['database', 'new_api']), createdAt: z.string().datetime(), notice: z.string() }),
  key: z.object({ id: z.string(), masked: z.string(), owner: z.object({ id: z.string(), name: z.string(), department: z.string() }), purpose: z.string(), model: z.string(), models: z.array(z.string()), expiresAt: z.string().datetime().nullable() }),
  secret: z.string().min(20),
  operation: z.object({ auditEventId: z.string() }),
})

export const keyDisableBodySchema = z.object({
  idempotencyKey: z.string().regex(/^key-disable-[a-z0-9-]{8,96}$/),
  // Disabling a local demo Key only needs the explicit impact acknowledgement.
  // Keep accepting a legacy reason for older clients without requiring it.
  reason: z.union([z.literal(''), z.string().trim().min(8).max(200)]).optional().default(''),
  acknowledgeImpact: z.literal(true),
})

export const keyDisableResponseSchema = z.object({
  meta: z.object({ source: z.enum(['database', 'new_api']), completedAt: z.string().datetime(), notice: z.string() }),
  key: z.object({ id: z.string(), masked: z.string(), status: z.literal('disabled') }),
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})

export const keyEnableBodySchema = z.object({
  idempotencyKey: z.string().regex(/^key-enable-[a-z0-9-]{8,96}$/),
  acknowledgeImpact: z.literal(true),
})

export const keyEnableResponseSchema = z.object({
  meta: z.object({ source: z.enum(['database', 'new_api']), completedAt: z.string().datetime(), notice: z.string() }),
  key: z.object({ id: z.string(), masked: z.string(), status: z.literal('active') }),
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})

export const keyDeleteBodySchema = z.object({
  idempotencyKey: z.string().regex(/^key-delete-[a-z0-9-]{8,96}$/),
  reason: z.union([z.literal(''), z.string().trim().min(8).max(200)]).optional().default(''),
  acknowledgeImpact: z.literal(true),
})

export const keyDeleteResponseSchema = z.object({
  meta: z.object({ source: z.enum(['database', 'new_api']), completedAt: z.string().datetime(), notice: z.string() }),
  key: z.object({ id: z.string(), masked: z.string(), status: z.literal('deleted') }),
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})

export const keyRotateBodySchema = z.object({
  idempotencyKey: z.string().regex(/^key-rotate-[a-z0-9-]{8,96}$/),
  reason: z.string().trim().min(8).max(200),
  expiresInDays: z.coerce.number().int().min(1).max(365),
  acknowledgeImpact: z.literal(true),
})

export const keyRotateResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), completedAt: z.string().datetime(), notice: z.string(), secretAvailable: z.boolean() }),
  oldKey: z.object({ id: z.string(), masked: z.string(), status: z.literal('disabled') }),
  key: z.object({ id: z.string(), masked: z.string(), owner: z.object({ id: z.string(), name: z.string(), department: z.string() }), purpose: z.string(), model: z.string(), models: z.array(z.string()), expiresAt: z.string().datetime().nullable() }),
  secret: z.string().min(20).nullable(),
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})

export const keyResetBodySchema = z.object({
  idempotencyKey: z.string().regex(/^key-reset-[a-z0-9-]{8,96}$/),
  acknowledgeImpact: z.literal(true),
})

export const keyResetResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), completedAt: z.string().datetime(), notice: z.string() }),
  key: z.object({ id: z.string(), masked: z.string(), owner: z.object({ id: z.string(), name: z.string(), department: z.string() }), purpose: z.string(), model: z.string(), models: z.array(z.string()), expiresAt: z.string().datetime().nullable() }),
  secret: z.string().min(20),
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})

export type KeysQuery = z.infer<typeof keysQuerySchema>
export type KeysResponse = z.infer<typeof keysResponseSchema>
export type KeyDetailResponse = z.infer<typeof keyDetailResponseSchema>
export type KeyCreateBody = z.infer<typeof keyCreateBodySchema>
export type KeyCreateResponse = z.infer<typeof keyCreateResponseSchema>
export type KeyDisableBody = z.infer<typeof keyDisableBodySchema>
export type KeyDisableResponse = z.infer<typeof keyDisableResponseSchema>
export type KeyEnableBody = z.infer<typeof keyEnableBodySchema>
export type KeyEnableResponse = z.infer<typeof keyEnableResponseSchema>
export type KeyDeleteBody = z.infer<typeof keyDeleteBodySchema>
export type KeyDeleteResponse = z.infer<typeof keyDeleteResponseSchema>
export type KeyRotateBody = z.infer<typeof keyRotateBodySchema>
export type KeyRotateResponse = z.infer<typeof keyRotateResponseSchema>
export type KeyResetBody = z.infer<typeof keyResetBodySchema>
export type KeyResetResponse = z.infer<typeof keyResetResponseSchema>

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
  { id: 'key-lin-1', suffix: '7F2A', ownerId: 'person-lin', ownerName: '林筱雨', initials: 'LY', department: '内容运营', purpose: '商品文案', models: ['ecommerce-copy'], status: 'active', expiresInDays: 120, lastUsedMinutes: 6, requests: 1684, points: 542, deviceNote: 'Codex Desktop · 内容工作站' },
  { id: 'key-lin-2', suffix: '3C91', ownerId: 'person-lin', ownerName: '林筱雨', initials: 'LY', department: '内容运营', purpose: '临时项目', models: ['ecommerce-copy'], status: 'active', expiresInDays: 85, lastUsedMinutes: 42, requests: 526, points: 200, deviceNote: 'WorkBuddy · 选品项目' },
  { id: 'key-zhou-1', suffix: '8B14', ownerId: 'person-zhou', ownerName: '周明远', initials: 'ZM', department: '广告投放', purpose: '策略分析', models: ['ecommerce-analysis'], status: 'active', expiresInDays: 26, lastUsedMinutes: 18, requests: 976, points: 681, deviceNote: 'Codex Desktop · 投放工作站' },
  { id: 'key-chen-1', suffix: 'C620', ownerId: 'person-chen', ownerName: '陈安琪', initials: 'CA', department: '跨境运营', purpose: '多语翻译', models: ['ecommerce-translate'], status: 'active', expiresInDays: 103, lastUsedMinutes: 33, requests: 1720, points: 412, deviceNote: 'WorkBuddy · 跨境工作站' },
  { id: 'key-chen-2', suffix: 'E15D', ownerId: 'person-chen', ownerName: '陈安琪', initials: 'CA', department: '跨境运营', purpose: '临时项目', models: ['ecommerce-translate'], status: 'active', expiresInDays: 14, lastUsedMinutes: 165, requests: 490, points: 131, deviceNote: 'Codex Desktop · 欧洲站项目' },
  { id: 'key-xu-1', suffix: '92AC', ownerId: 'person-xu', ownerName: '许嘉禾', initials: 'XJ', department: '客户服务', purpose: '回复建议', models: ['ecommerce-service'], status: 'active', expiresInDays: 66, lastUsedMinutes: 51, requests: 2538, points: 438, deviceNote: 'WorkBuddy · 客服主管席' },
  { id: 'key-tang-1', suffix: '41D8', ownerId: 'person-tang', ownerName: '唐语宁', initials: 'TY', department: '商品运营', purpose: '图片检查', models: ['ecommerce-copy'], status: 'active', expiresInDays: 44, lastUsedMinutes: 77, requests: 744, points: 361, deviceNote: 'Codex Desktop · 商品工作站' },
  { id: 'key-he-1', suffix: 'B73E', ownerId: 'person-he', ownerName: '何沐晨', initials: 'HM', department: '内容运营', purpose: '标题优化', models: ['ecommerce-copy'], status: 'active', expiresInDays: 92, lastUsedMinutes: 125, requests: 680, points: 286, deviceNote: 'WorkBuddy · 内容编辑席' },
  { id: 'key-luo-1', suffix: '5A09', ownerId: 'person-luo', ownerName: '罗一帆', initials: 'LF', department: '广告投放', purpose: '素材分析', models: ['ecommerce-analysis'], status: 'active', expiresInDays: 9, lastUsedMinutes: 210, requests: 521, points: 152, deviceNote: 'Codex Desktop · 素材分析' },
  { id: 'key-luo-2', suffix: 'D04C', ownerId: 'person-luo', ownerName: '罗一帆', initials: 'LF', department: '广告投放', purpose: '临时项目', models: ['ecommerce-pro-lab'], status: 'disabled', expiresInDays: -2, lastUsedMinutes: 1860, requests: 146, points: 73, deviceNote: '隔离实验设备 · 已停用' },
  { id: 'key-su-1', suffix: 'A811', ownerId: 'person-su', ownerName: '苏澄', initials: 'SC', department: '跨境运营', purpose: '多语翻译', models: ['ecommerce-translate'], status: 'active', expiresInDays: 78, lastUsedMinutes: 340, requests: 610, points: 198, deviceNote: 'WorkBuddy · 本地化席' },
  { id: 'key-qiao-1', suffix: '62BE', ownerId: 'person-qiao', ownerName: '乔南星', initials: 'QX', department: '客户服务', purpose: '回复建议', models: ['ecommerce-service'], status: 'active', expiresInDays: 18, lastUsedMinutes: 1450, requests: 418, points: 156, deviceNote: 'WorkBuddy · 离职回收中' },
  { id: 'key-guo-1', suffix: 'F330', ownerId: 'person-guo', ownerName: '郭子谦', initials: 'GQ', department: '商品运营', purpose: '选品分析', models: ['ecommerce-analysis'], status: 'active', expiresInDays: 110, lastUsedMinutes: 580, requests: 370, points: 112, deviceNote: 'Codex Desktop · 选品席' },
  { id: 'key-wei-1', suffix: '19CE', ownerId: 'person-wei', ownerName: '魏昭', initials: 'WZ', department: '客户服务', purpose: '会话质检', models: ['ecommerce-service'], status: 'active', expiresInDays: 58, lastUsedMinutes: 920, requests: 288, points: 92, deviceNote: 'Codex Desktop · 质检席' },
]

// Client traffic must enter the AI OPS gateway so request/response bodies can
// be captured. The gateway forwards to New API internally.
const DEFAULT_PUBLIC_GATEWAY_BASE_URL = 'http://127.0.0.1:4175/v1'

function safeClientBaseUrl(value: string | undefined) {
  try {
    const url = new URL(value || 'http://127.0.0.1:4175')
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol')
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    url.pathname = `${url.pathname.replace(/\/$/, '')}/v1`.replace(/\/v1\/v1$/, '/v1')
    return url.toString().replace(/\/$/, '')
  } catch {
    return DEFAULT_PUBLIC_GATEWAY_BASE_URL
  }
}

// The BFF reaches New API through the Compose hostname, but exported client
// configs are consumed from the host machine. Keep the public gateway endpoint
// separate so `new-api:3000` never leaks into WorkBuddy/Codex configs or
// bypasses conversation capture.
function publicGatewayBaseUrl() {
  return safeClientBaseUrl(process.env.AI_OPS_PUBLIC_GATEWAY_BASE_URL || DEFAULT_PUBLIC_GATEWAY_BASE_URL)
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
    createdAt: new Date(now.getTime() - 76 * 86_400_000).toISOString(),
    purpose: seed.purpose,
    model: seed.models[0] ?? 'ecommerce-general',
    models: seed.models,
    secretAvailable: false,
    status: seed.status,
    expiryState: seed.expiresInDays < 0 ? 'expired' : seed.expiresInDays <= 30 ? 'expiring' : 'normal',
    expiresAt,
    lastUsedAt: seed.lastUsedMinutes === null ? null : new Date(now.getTime() - seed.lastUsedMinutes * 60_000).toISOString(),
    usage: { requests: seed.requests, points: seed.points },
    quotaMode: 'legacy',
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
  const uniqueOwners = new Map(items.map((key) => [key.owner.id, { id: key.owner.id, name: key.owner.name, department: key.owner.department }]))
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
      models: [...new Set([...KEY_MODEL_OPTIONS, ...items.flatMap((key) => key.models)])],
    },
    connection: { baseUrl: publicGatewayBaseUrl(), note: '员工只使用 AI OPS 网关地址和个人 Key；请求会经过正文审计边界，不得接触管理凭据或上游密钥。' },
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
      baseUrl: publicGatewayBaseUrl(),
      note: '复制非敏感配置后，由员工自行填写仅属于本人的 Key。',
      instructions: ['Base URL 指向 AI OPS 统一网关入口', '模型填写该 Key 的绑定业务别名', 'API Key 仅在员工自己的客户端中保存', '认证失败时先确认 Key 状态、绑定模型与到期时间'],
    },
  }
}

function databaseNotice(newApi: NewApiStatus) {
  if (newApi.state === 'ready') return 'Key 列表已从平台 SQLite 读取；外部 New API Token 会按映射同步'
  if (newApi.state === 'reachable') return 'Key 列表来自平台 SQLite；New API 服务可达但尚未配置管理认证'
  if (newApi.state === 'auth_required') return 'Key 列表来自平台 SQLite；New API 管理认证未通过'
  return 'Key 列表来自平台 SQLite；New API 当前离线'
}

function keyExpiryState(expiresAt: string | null, now: Date): 'normal' | 'expiring' | 'expired' {
  if (!expiresAt) return 'normal'
  const remaining = new Date(expiresAt).getTime() - now.getTime()
  if (remaining < 0) return 'expired'
  return remaining <= 30 * 86_400_000 ? 'expiring' : 'normal'
}

export function newApiKeyId(externalTokenId: string) {
  const safe = externalTokenId.toLocaleLowerCase('en-US').replace(/[^a-z0-9-]+/g, '-')
  return `key-new-api-${safe || 'token'}-1`
}

function newApiKeyItem(token: NewApiTokenRecord, owner: NormalizedNewApiPerson, now: Date): z.infer<typeof keyListItemSchema> {
  const models = token.modelLimits.length ? token.modelLimits : ['未绑定模型']
  const expiresAt = token.expiresAt
  return {
    id: newApiKeyId(token.id),
    masked: token.masked,
    owner: { id: stableNewApiPersonId(owner.externalUserId), name: owner.displayName, department: owner.departmentName, initials: owner.displayName.slice(0, 2) },
    createdAt: token.createdAt ?? now.toISOString(),
    purpose: token.name,
    model: models[0]!,
    models,
    secretAvailable: false,
    status: token.status === 'active' ? 'active' : 'disabled',
    expiryState: keyExpiryState(expiresAt, now),
    expiresAt,
    lastUsedAt: token.lastUsedAt,
    usage: { requests: 0, points: 0 },
    quotaMode: token.unlimitedQuota === true ? 'unlimited' : 'legacy',
  }
}

type NewApiKeyOwnerMap = ReadonlyMap<string, NormalizedNewApiPerson>

function ownerForToken(token: NewApiTokenRecord, peopleByExternalId: ReadonlyMap<string, NormalizedNewApiPerson>, localOwners: NewApiKeyOwnerMap) {
  // A managed Token may be created under the New API administrator while AI
  // OPS still needs to show the person selected in its own create dialog.
  return localOwners.get(token.id) ?? (token.userId ? peopleByExternalId.get(token.userId) : undefined)
}

export function createNewApiKeys(
  tokens: readonly NewApiTokenRecord[],
  people: readonly NormalizedNewApiPerson[],
  query: KeysQuery,
  now = new Date(),
  scope: DataScope = { mode: 'global' },
  localOwners: NewApiKeyOwnerMap = new Map(),
): KeysResponse {
  const peopleByExternalId = new Map(people.map((person) => [person.externalUserId, person]))
  const all = tokens.flatMap((token) => {
    const owner = ownerForToken(token, peopleByExternalId, localOwners)
    return owner && isDepartmentVisible(scope, owner.departmentId) ? [newApiKeyItem(token, owner, now)] : []
  })
  const search = query.search.toLocaleLowerCase('zh-CN')
  const filtered = all.filter((key) => {
    const matchesSearch = !search || [key.masked, key.owner.name, key.owner.department, key.purpose, ...key.models].some((value) => value.toLocaleLowerCase('zh-CN').includes(search))
    const matchesOwner = query.owner === 'all' || key.owner.id === query.owner
    const matchesPurpose = query.purpose === 'all' || key.purpose === query.purpose
    const matchesModel = query.model === 'all' || key.models.includes(query.model)
    const matchesStatus = query.status === 'all' || (query.status === 'expiring' ? key.expiryState === 'expiring' : key.status === query.status)
    return matchesSearch && matchesOwner && matchesPurpose && matchesModel && matchesStatus
  })
  // The create dialog needs the complete active personnel directory. Building
  // this list from `all` only exposed people who already had a Token, which
  // made a valid New API user impossible to select for their first Key.
  // `displayName`/`departmentName` were normalized from New API's
  // `username`/`display_name` mapping in people-sync.ts.
  const owners = [...new Map(
    people
      .filter((person) => person.status === 'active' && isDepartmentVisible(scope, person.departmentId))
      .map((person) => [
        stableNewApiPersonId(person.externalUserId),
        { id: stableNewApiPersonId(person.externalUserId), name: person.displayName, department: person.departmentName },
      ] as const),
  ).values()]
  const start = (query.page - 1) * query.pageSize
  return {
    meta: { source: 'new_api', generatedAt: now.toISOString(), timezone: 'Asia/Shanghai', notice: `Key、状态、人员归属和模型限制来自 New API Token 数据；AI OPS SQLite 仅保存外部 Token 映射和备份镜像，完整 Key 可由管理员按需复制且不会写入镜像。${scopeNotice(scope)}${all.some((key) => key.usage.requests === 0) ? '用量统计需通过 New API 日志接口读取。' : ''}` },
    summary: { total: all.length, active: all.filter((key) => key.status === 'active').length, disabled: all.filter((key) => key.status === 'disabled').length, expiring: all.filter((key) => key.expiryState === 'expiring').length },
    options: { owners, purposes: [...new Set(all.map((key) => key.purpose))], models: [...new Set(all.flatMap((key) => key.models))] },
    connection: { baseUrl: publicGatewayBaseUrl(), note: '员工只使用 AI OPS 网关地址和 New API 分发的个人 Key；管理凭据和 CPA 凭据不会返回。' },
    items: filtered.slice(start, start + query.pageSize), page: query.page, pageSize: query.pageSize, total: filtered.length,
  }
}

export function createNewApiKeyDetail(tokens: readonly NewApiTokenRecord[], people: readonly NormalizedNewApiPerson[], id: string, now = new Date(), scope: DataScope = { mode: 'global' }, localOwners: NewApiKeyOwnerMap = new Map()): KeyDetailResponse | null {
  const peopleByExternalId = new Map(people.map((person) => [person.externalUserId, person]))
  const token = tokens.find((item) => newApiKeyId(item.id) === id)
  const owner = token ? ownerForToken(token, peopleByExternalId, localOwners) : undefined
  if (!token || !owner || !isDepartmentVisible(scope, owner.departmentId)) return null
  const item = newApiKeyItem(token, owner, now)
  return {
    meta: { source: 'new_api', generatedAt: now.toISOString(), timezone: 'Asia/Shanghai' },
    key: { ...item, deviceNote: 'New API Token', allowedIps: ['未提供'], limits: { rpm: null, tpm: null, concurrent: null } },
    connection: { baseUrl: publicGatewayBaseUrl(), note: '员工使用 AI OPS 网关地址和个人 Key；管理员可按需复制完整 Key。', instructions: ['Base URL 指向 AI OPS 统一网关入口', '模型限制以 New API Token 实际配置为准', '完整 Key 仅在管理员主动复制时返回，AI OPS 不保存明文', '认证失败时先刷新 New API Token 状态'] },
  }
}

export function createDatabaseKeys(database: PlatformDatabase, query: KeysQuery, newApi: NewApiStatus, now = new Date(), scope: DataScope = { mode: 'global' }, externalOnly = false): KeysResponse {
  const demo = createDemoKeys({ search: '', owner: 'all', purpose: 'all', model: 'all', status: 'all', page: 1, pageSize: 50 }, newApi, now)
  const demoById = new Map(demo.items.map((item) => [item.id, item]))
  const databaseKeys = database.listApiKeys().filter((row) => !externalOnly || Boolean(row.externalTokenId))
  const departmentByKeyId = new Map(databaseKeys.map((row) => [row.id, row.departmentId]))
  const keys = databaseKeys.map((row) => {
    const existing = demoById.get(row.id)
    const expiresAt = row.quotaMode === 'unlimited' ? null : row.expiresAt ?? existing?.expiresAt ?? new Date(now.getTime() + 90 * 86_400_000).toISOString()
    const status = row.status === 'revoked' ? 'disabled' as const : existing?.status ?? 'active' as const
    return {
      id: row.id,
      masked: row.maskedValue,
      owner: { id: row.ownerUserId, name: row.ownerName, department: row.departmentName ?? '待分配部门', initials: existing?.owner.initials ?? row.ownerName.slice(-2) },
      createdAt: row.createdAt,
      purpose: row.purpose,
      model: row.models[0] ?? existing?.model ?? 'ecommerce-general',
      models: [row.models[0] ?? existing?.model ?? 'ecommerce-general'],
      secretAvailable: row.secretAvailable,
      status,
      expiryState: keyExpiryState(expiresAt, now),
      expiresAt,
      lastUsedAt: row.lastUsedAt ?? existing?.lastUsedAt ?? null,
      usage: existing?.usage ?? { requests: 0, points: 0 },
      quotaMode: row.quotaMode,
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
  const owners = database.listPeople()
    .filter((person) => person.status === 'active' && isDepartmentVisible(scope, person.departmentId))
    .map((person) => ({ id: person.id, name: person.displayName, department: person.departmentName ?? '未分配部门' }))
  const start = (query.page - 1) * query.pageSize
  return {
    meta: { source: 'database', generatedAt: now.toISOString(), timezone: 'Asia/Shanghai', notice: `${databaseNotice(newApi)}${scopeNotice(scope)}` },
    summary: { total: visibleKeys.length, active: visibleKeys.filter((key) => key.status === 'active').length, disabled: visibleKeys.filter((key) => key.status === 'disabled').length, expiring: visibleKeys.filter((key) => key.expiryState === 'expiring').length },
    options: {
      owners,
      purposes: [...new Set(visibleKeys.map((key) => key.purpose))],
      models: [...new Set([...KEY_MODEL_OPTIONS, ...visibleKeys.flatMap((key) => key.models)])],
    },
    connection: { baseUrl: publicGatewayBaseUrl(), note: '员工只使用 AI OPS 网关地址和个人 Key；不得接触管理凭据或上游密钥。' },
    items: filtered.slice(start, start + query.pageSize), page: query.page, pageSize: query.pageSize, total: filtered.length,
  }
}

export function createDatabaseKeyDetail(database: PlatformDatabase, id: string, now = new Date(), scope: DataScope = { mode: 'global' }): KeyDetailResponse | null {
  const key = createDatabaseKeys(database, { search: '', owner: 'all', purpose: 'all', model: 'all', status: 'all', page: 1, pageSize: 50 }, { state: 'offline', authConfigured: false, checkedAt: now.toISOString() }, now, scope).items.find((item) => item.id === id)
  if (!key) return null
  const row = database.listApiKeys().find((item) => item.id === id)
  return {
    meta: { source: 'database', generatedAt: now.toISOString(), timezone: 'Asia/Shanghai' },
    key: { ...key, createdAt: row?.createdAt ?? now.toISOString(), deviceNote: row?.externalTokenId ? 'New API Token' : '本地演示设备', allowedIps: ['未限制'], limits: row?.externalTokenId ? { rpm: null, tpm: null, concurrent: null } : { rpm: 60, tpm: 120_000, concurrent: 4 } },
    connection: { baseUrl: publicGatewayBaseUrl(), note: '复制非敏感配置后，由员工自行填写仅属于本人的 Key。', instructions: ['Base URL 指向 AI OPS 统一网关入口', '模型填写该 Key 的绑定业务别名', 'API Key 仅在员工自己的客户端中保存', '认证失败时先确认 Key 状态、绑定模型与到期时间'] },
  }
}
