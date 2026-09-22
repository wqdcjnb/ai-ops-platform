import { createHash } from 'node:crypto'
import { z } from 'zod'
import { type NewApiUser, type NewApiUserReader } from './new-api-management.js'
import { stableNewApiPersonId, type PlatformDatabase, type PlatformExternalPersonStatus, type PlatformSyncedPerson, type PlatformSyncedPersonInput, type PlatformAuditEventSeed } from './platform-db.js'

const syncStatusSchema = z.enum(['active', 'disabled', 'unknown'])
const syncStateSchema = z.enum(['synced', 'external_missing', 'stale'])

export const personSyncPersonSchema = z.object({
  id: z.string(),
  externalUserId: z.string(),
  name: z.string(),
  department: z.object({ id: z.string(), name: z.string() }),
  username: z.string().nullable(),
  status: syncStatusSchema,
  createdAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  syncState: syncStateSchema,
})

const personSyncItemSchema = z.object({
  action: z.enum(['add', 'update', 'missing', 'unknown', 'unchanged']),
  person: personSyncPersonSchema,
  changes: z.array(z.string()),
})

const personSyncSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  added: z.number().int().nonnegative(),
  changed: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
})

const personSyncMetaSchema = z.object({
  source: z.literal('new-api'),
  generatedAt: z.string().datetime(),
  stale: z.boolean(),
  notice: z.string(),
})

export const personSyncPreviewResponseSchema = z.object({
  meta: personSyncMetaSchema,
  summary: personSyncSummarySchema,
  items: z.array(personSyncItemSchema),
})

export const personSyncBodySchema = z.object({
  idempotencyKey: z.string().regex(/^people-sync-[a-z0-9-]{8,96}$/),
})

export const personSyncResponseSchema = personSyncPreviewResponseSchema.extend({
  operation: z.object({
    idempotencyKey: z.string(),
    idempotent: z.boolean(),
    auditEventId: z.string(),
  }),
})

export type PersonSyncPreviewResponse = z.infer<typeof personSyncPreviewResponseSchema>
export type PersonSyncBody = z.infer<typeof personSyncBodySchema>
export type PersonSyncResponse = z.infer<typeof personSyncResponseSchema>

export class PeopleSyncReadError extends Error {
  constructor(
    message: string,
    readonly state: 'auth_required' | 'unavailable',
    readonly statusCode: number,
  ) {
    super(message)
    this.name = 'PeopleSyncReadError'
  }
}

export interface NormalizedNewApiPerson extends PlatformSyncedPersonInput {}

function stableDepartmentId(name: string) {
  return `department-${createHash('sha256').update(`local:${name.trim().toLocaleLowerCase('zh-CN')}`).digest('hex').slice(0, 16)}`
}

function normalizedDate(value: string | number | null) {
  if (value === null || value === undefined || value === '') return null
  if ((typeof value === 'number' && value <= 0) || (typeof value === 'string' && /^0+(?:\.0+)?$/.test(value.trim()))) return null
  const numeric = typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value).trim())
  const parsed = numeric
    ? new Date(Number(value) < 1_000_000_000_000 ? Number(value) * 1_000 : Number(value))
    : new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function normalizedStatus(value: NewApiUser['status']): PlatformExternalPersonStatus {
  if (value === true || value === 1) return 'active'
  if (value === false || value === 0 || value === 2) return 'disabled'
  const normalized = String(value ?? '').trim().toLocaleLowerCase('en-US')
  if (['1', 'true', 'active', 'enabled', 'enable', 'normal'].includes(normalized)) return 'active'
  if (['0', '2', 'false', 'disabled', 'disable', 'inactive', 'banned'].includes(normalized)) return 'disabled'
  return 'active'
}

function isAdministrativeUser(user: NewApiUser) {
  if (user.isAdmin === true) return true
  const roleText = [user.roleName, typeof user.role === 'string' ? user.role : ''].filter(Boolean).join(' ').trim().toLocaleLowerCase('en-US')
  if (/(^|[ _-])(admin|administrator|root|superadmin|super_admin)([ _-]|$)/.test(roleText)) return true
  const roleNumber = typeof user.role === 'number' ? user.role : Number(user.role)
  return Number.isFinite(roleNumber) && roleNumber >= 100
}

function normalizeUser(user: NewApiUser, database: PlatformDatabase, materializeDepartment: boolean): NormalizedNewApiPerson | null {
  // New API has no department column in the deployed schema. In this
  // project, username is the employee name and display_name carries the
  // department label (the same contract used by the New API user form).
  const sourceDisplayName = user.displayName?.trim() || null
  const displayName = user.username?.trim() || sourceDisplayName || ''
  const departmentName = user.department?.trim() || user.departmentName?.trim() || sourceDisplayName || user.group?.trim() || displayName
  if (!displayName || !departmentName) return null
  const departmentId = materializeDepartment ? database.ensureDepartment(departmentName) : database.findActiveDepartmentByName(departmentName)?.id ?? stableDepartmentId(departmentName)
  return {
    externalUserId: user.id,
    username: user.username,
    displayName,
    departmentId,
    departmentName,
    status: normalizedStatus(user.status),
    createdAt: normalizedDate(user.createdAt),
    lastUsedAt: normalizedDate(user.lastLoginAt),
    sourceDisplayName,
    sourceGroup: user.group,
    sourceRole: user.role === null || user.role === undefined ? null : String(user.role),
  }
}

export async function readNewApiPeople(client: NewApiUserReader, database: PlatformDatabase, materializeDepartment = false) {
  const pageSize = 100
  const people: NormalizedNewApiPerson[] = []
  let page = 1
  let seen = 0
  let total = 0
  let skipped = 0
  const excludedExternalUserIds = new Set<string>()
  while (page <= 100) {
    const result = await client.listUsers(page, pageSize)
    if (result.state !== 'ready' || !result.data) {
      throw new PeopleSyncReadError(result.message ?? 'New API 用户数据暂时无法读取', result.state === 'auth_required' ? 'auth_required' : 'unavailable', result.statusCode)
    }
    total = result.data.total
    for (const user of result.data.items) {
      seen += 1
      if (isAdministrativeUser(user)) {
        excludedExternalUserIds.add(user.id)
        skipped += 1
        continue
      }
      const normalized = normalizeUser(user, database, materializeDepartment)
      if (normalized) people.push(normalized)
      else skipped += 1
    }
    if (!result.data.items.length || seen >= total || result.data.items.length < pageSize) break
    page += 1
  }
  if (page > 100) throw new PeopleSyncReadError('New API 用户分页超过安全上限，已停止同步', 'unavailable', 0)
  return { people, total, skipped, excludedExternalUserIds }
}

function asSyncPerson(person: NormalizedNewApiPerson | PlatformSyncedPerson, syncState: 'synced' | 'external_missing' | 'stale' = 'synced') {
  return {
    id: 'id' in person ? person.id : stableNewApiPersonId(person.externalUserId),
    externalUserId: person.externalUserId,
    name: person.displayName,
    department: { id: person.departmentId, name: person.departmentName },
    username: person.username,
    status: 'sourceStatus' in person ? person.sourceStatus : person.status,
    createdAt: person.createdAt,
    lastUsedAt: person.lastUsedAt,
    syncState,
  }
}

function changesFor(previous: PlatformSyncedPerson, current: NormalizedNewApiPerson) {
  const changes: string[] = []
  if (previous.displayName !== current.displayName) changes.push('姓名')
  if (previous.departmentId !== current.departmentId || previous.departmentName !== current.departmentName) changes.push('部门')
  if (previous.username !== current.username) changes.push('用户名')
  if (previous.sourceStatus !== current.status) changes.push('状态')
  if (previous.createdAt !== current.createdAt) changes.push('创建时间')
  if (previous.lastUsedAt !== current.lastUsedAt) changes.push('最后使用时间')
  if (previous.sourceDisplayName !== (current.sourceDisplayName ?? null)) changes.push('New API 显示名称')
  if (previous.sourceGroup !== (current.sourceGroup ?? null)) changes.push('New API 用户分组')
  if (previous.sourceRole !== (current.sourceRole ?? null)) changes.push('New API 角色')
  if (previous.syncState !== 'synced') changes.push('同步状态')
  return changes
}

export function buildPeopleSyncPreview(
  current: NormalizedNewApiPerson[],
  previous: PlatformSyncedPerson[],
  skipped: number,
  now = new Date(),
): PersonSyncPreviewResponse {
  const previousByExternalId = new Map(previous.map((person) => [person.externalUserId, person]))
  const currentIds = new Set(current.map((person) => person.externalUserId))
  const items: PersonSyncPreviewResponse['items'] = []
  let added = 0
  let changed = 0
  let unknown = 0
  let unchanged = 0

  for (const person of current) {
    const old = previousByExternalId.get(person.externalUserId)
    if (!old) {
      added += 1
      if (person.status === 'unknown') unknown += 1
      items.push({ action: person.status === 'unknown' ? 'unknown' : 'add', person: asSyncPerson(person), changes: ['新增人员'] })
      continue
    }
    const changes = changesFor(old, person)
    if (person.status === 'unknown') unknown += 1
    if (changes.length) changed += 1
    else unchanged += 1
    items.push({ action: person.status === 'unknown' ? 'unknown' : changes.length ? 'update' : 'unchanged', person: asSyncPerson(person), changes })
  }

  let missing = 0
  for (const person of previous) {
    if (currentIds.has(person.externalUserId)) continue
    missing += 1
    items.push({ action: 'missing', person: asSyncPerson(person, 'external_missing'), changes: ['New API 未返回该用户'] })
  }

  return {
    meta: {
      source: 'new-api',
      generatedAt: now.toISOString(),
      stale: false,
      notice: skipped ? `已读取 New API 用户；已排除管理员或缺少必要字段的 ${skipped} 条记录，未写入人员目录。` : '已读取 New API 用户；预览只展示字段差异，不会修改人员目录。',
    },
    summary: { total: current.length, added, changed, missing, unknown, unchanged, skipped },
    items: items.slice(0, 500),
  }
}

function snapshotHash(people: NormalizedNewApiPerson[]) {
  return createHash('sha256').update(JSON.stringify([...people].sort((left, right) => left.externalUserId.localeCompare(right.externalUserId)))).digest('hex')
}

export async function previewPeopleSync(client: NewApiUserReader, database: PlatformDatabase, now = new Date()) {
  const source = await readNewApiPeople(client, database)
  return { preview: buildPeopleSyncPreview(source.people, database.listSyncedPeople(), source.skipped, now), snapshotHash: snapshotHash(source.people) }
}

export async function executePeopleSync(
  client: NewApiUserReader,
  database: PlatformDatabase,
  idempotencyKey: string,
  auditEvent: PlatformAuditEventSeed,
  now = new Date(),
): Promise<PersonSyncResponse> {
  const previous = database.getPersonSyncOperation(idempotencyKey)
  if (previous) return JSON.parse(previous.resultJson) as PersonSyncResponse
  const source = await readNewApiPeople(client, database, true)
  const preview = buildPeopleSyncPreview(source.people, database.listSyncedPeople(), source.skipped, now)
  const ids = new Set(source.people.map((person) => person.externalUserId))
  for (const person of source.people) database.upsertSyncedPerson(person, now)
  database.markSyncedPeopleExcluded(source.excludedExternalUserIds, now)
  database.markSyncedPeopleMissing(ids, now)
  const result: PersonSyncResponse = {
    ...preview,
    meta: { ...preview.meta, notice: source.skipped ? `同步完成，${source.skipped} 条记录因缺少姓名或部门被跳过。` : '同步完成；人员身份和状态已按 New API 当前结果更新。' },
    operation: { idempotencyKey, idempotent: false, auditEventId: auditEvent.id },
  }
  const saved = database.recordPersonSyncOperation(idempotencyKey, snapshotHash(source.people), result, auditEvent, now)
  return saved.result as PersonSyncResponse
}

export function markPeopleSyncStale(database: PlatformDatabase, now = new Date()) {
  database.markSyncedPeopleStale(now)
}
