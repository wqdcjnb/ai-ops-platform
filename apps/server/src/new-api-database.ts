import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { CatalogReader } from './model-catalog.js'
import type { NewApiManagementResult, NewApiTokenReader, NewApiUser, NewApiUserPage, NewApiUserReader } from './new-api-management.js'

type SqlRow = Record<string, unknown>

export interface NewApiDatabaseOptions {
  filename: string
}

export interface NewApiLogRecord {
  id: string
  userId: string | null
  occurredAt: string | null
  type: number | null
  username: string | null
  tokenName: string | null
  modelName: string | null
  quota: number
  promptTokens: number
  completionTokens: number
  useTime: number
  streamed: boolean
  channelId: string | null
  channelName: string | null
  tokenId: string | null
  group: string | null
  requestId: string
  upstreamRequestId: string | null
}

/**
 * The gateway uses this short-lived, in-memory view to authenticate a
 * client-provided New API token. The secret itself is deliberately never
 * returned by the reader and is never written to the platform database.
 */
export interface NewApiTokenCredential {
  id: string
  userId: string | null
  status: 'active' | 'disabled'
  modelLimits: string[]
  expiresAt: string | null
}

export type NewApiDatabaseReader = NewApiUserReader & NewApiTokenReader & CatalogReader & {
  readonly filename: string
  readonly available: true
  listLogs(limit?: number): readonly NewApiLogRecord[]
  findTokenBySecret(secret: string): Promise<NewApiTokenCredential | null>
}

function value(row: SqlRow, key: string) {
  const item = row[key]
  return typeof item === 'bigint' ? Number(item) : item
}

function textValue(row: SqlRow, key: string) {
  const item = value(row, key)
  return typeof item === 'string' && item.trim() ? item.trim() : null
}

function numberValue(row: SqlRow, key: string) {
  const item = value(row, key)
  if (typeof item === 'number' && Number.isFinite(item)) return item
  if (typeof item === 'string' && item.trim() && Number.isFinite(Number(item))) return Number(item)
  return null
}

function pageArgs(page: number, pageSize: number) {
  const safePage = Math.max(1, Math.floor(page))
  const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)))
  return { page: safePage, pageSize: safePageSize, offset: (safePage - 1) * safePageSize }
}

function ready<T>(data: T, statusCode = 200): NewApiManagementResult<T> {
  return { state: 'ready', statusCode, data, message: null }
}

function unavailable<T>(): NewApiManagementResult<T> {
  return { state: 'unavailable', statusCode: 503, data: null, message: 'New API SQLite 数据库当前不可读' }
}

function parseModelLimits(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
  } catch {
    // Older New API versions stored this field as a comma separated string.
  }
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function mapUser(row: SqlRow): NewApiUser {
  const role = numberValue(row, 'role')
  return {
    id: String(value(row, 'id') ?? ''),
    username: textValue(row, 'username'),
    displayName: textValue(row, 'display_name'),
    status: value(row, 'status') as NewApiUser['status'],
    group: textValue(row, 'group'),
    department: null,
    departmentName: null,
    role: role ?? textValue(row, 'role'),
    roleName: role !== null && role >= 100 ? 'admin' : null,
    isAdmin: role !== null ? role >= 100 : null,
    createdAt: (value(row, 'created_at') as string | number | null | undefined) ?? null,
    lastLoginAt: (value(row, 'last_login_at') as string | number | null | undefined) ?? null,
  }
}

function tokenRow(row: SqlRow) {
  return {
    id: value(row, 'id'),
    user_id: value(row, 'user_id'),
    name: textValue(row, 'name'),
    status: value(row, 'status'),
    created_time: value(row, 'created_time'),
    accessed_time: value(row, 'accessed_time'),
    expired_time: value(row, 'expired_time'),
    unlimited_quota: value(row, 'unlimited_quota'),
    model_limits_enabled: value(row, 'model_limits_enabled'),
    model_limits: parseModelLimits(value(row, 'model_limits')),
    group: textValue(row, 'group'),
  }
}

function modelRow(row: SqlRow) {
  return {
    id: numberValue(row, 'id') ?? 0,
    model_name: textValue(row, 'model_name') ?? '',
    status: numberValue(row, 'status') ?? undefined,
    name_rule: numberValue(row, 'name_rule') ?? undefined,
  }
}

function channelRow(row: SqlRow) {
  return {
    id: numberValue(row, 'id') ?? 0,
    name: textValue(row, 'name') ?? `Channel ${String(value(row, 'id') ?? '')}`,
    status: numberValue(row, 'status') ?? 0,
    models: textValue(row, 'models') ?? '',
  }
}

function isoTime(value: unknown) {
  const item = typeof value === 'bigint' ? Number(value) : value
  const numeric = typeof item === 'number' ? item : typeof item === 'string' && item.trim() ? Number(item) : NaN
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  const date = new Date(numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function nonNegativeNumber(row: SqlRow, key: string) {
  return Math.max(0, numberValue(row, key) ?? 0)
}

/**
 * Read-only view over the New API SQLite file. Normal list/detail methods do
 * not select token.key or channel.key, so the platform cannot turn a database
 * mirror into a second credential store. The narrowly-scoped
 * findTokenBySecret() method only compares a client credential at the gateway
 * boundary and returns non-sensitive token metadata; it never returns or
 * persists the secret.
 */
export class ReadOnlyNewApiDatabase implements NewApiDatabaseReader {
  readonly available = true as const
  readonly filename: string
  private readonly db: DatabaseSync

  constructor(options: NewApiDatabaseOptions) {
    if (!existsSync(options.filename)) throw new Error('NEW_API_DB_NOT_FOUND')
    this.filename = options.filename
    this.db = new DatabaseSync(options.filename, { readOnly: true })
    this.db.exec('PRAGMA busy_timeout = 5000')
    this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'tokens', 'models', 'channels')").all()
  }

  private all(sql: string, params: Array<string | number> = []) {
    return this.db.prepare(sql).all(...params) as unknown as SqlRow[]
  }

  private one(sql: string, params: Array<string | number> = []) {
    return this.db.prepare(sql).get(...params) as unknown as SqlRow | undefined
  }

  listUsers(page = 1, pageSize = 100): Promise<NewApiManagementResult<NewApiUserPage>> {
    try {
      const paging = pageArgs(page, pageSize)
      const total = numberValue(this.one('SELECT COUNT(*) AS total FROM users WHERE deleted_at IS NULL') ?? {}, 'total') ?? 0
      const rows = this.all(`SELECT id, username, display_name, status, "group" AS "group", role, created_at, last_login_at
        FROM users WHERE deleted_at IS NULL ORDER BY id LIMIT ? OFFSET ?`, [paging.pageSize, paging.offset])
      return Promise.resolve(ready({ page: paging.page, pageSize: paging.pageSize, total, items: rows.map(mapUser) }))
    } catch {
      return Promise.resolve(unavailable())
    }
  }

  getUser(id: string | number): Promise<NewApiManagementResult<NewApiUser>> {
    try {
      const row = this.one(`SELECT id, username, display_name, status, "group" AS "group", role, created_at, last_login_at
        FROM users WHERE id = ? AND deleted_at IS NULL`, [String(id)])
      return Promise.resolve(row ? ready(mapUser(row)) : { state: 'ready', statusCode: 404, data: null, message: 'New API 用户不存在' })
    } catch {
      return Promise.resolve(unavailable())
    }
  }

  listTokens(page = 1, pageSize = 100): Promise<NewApiManagementResult<unknown>> {
    try {
      const paging = pageArgs(page, pageSize)
      const total = numberValue(this.one('SELECT COUNT(*) AS total FROM tokens WHERE deleted_at IS NULL') ?? {}, 'total') ?? 0
      const rows = this.all(`SELECT id, user_id, name, status, created_time, accessed_time, expired_time,
        unlimited_quota, model_limits_enabled, model_limits, "group" AS "group"
        FROM tokens WHERE deleted_at IS NULL ORDER BY id LIMIT ? OFFSET ?`, [paging.pageSize, paging.offset])
      return Promise.resolve(ready({ page: paging.page, page_size: paging.pageSize, total, items: rows.map(tokenRow) }))
    } catch {
      return Promise.resolve(unavailable())
    }
  }

  getToken(id: string): Promise<NewApiManagementResult<unknown>> {
    try {
      const row = this.one(`SELECT id, user_id, name, status, created_time, accessed_time, expired_time,
        unlimited_quota, model_limits_enabled, model_limits, "group" AS "group"
        FROM tokens WHERE id = ? AND deleted_at IS NULL`, [String(id)])
      return Promise.resolve(row ? ready(tokenRow(row)) : { state: 'ready', statusCode: 404, data: null, message: 'New API Token 不存在' })
    } catch {
      return Promise.resolve(unavailable())
    }
  }

  /**
   * Resolve a client credential without exposing the token column to callers.
   * New API stores the token body without the conventional `sk-` prefix, while
   * OpenAI-compatible clients usually send the prefixed form, so both forms
   * are accepted. Only a matching token's non-sensitive metadata is returned.
   */
  findTokenBySecret(secret: string): Promise<NewApiTokenCredential | null> {
    try {
      const normalized = secret.trim()
      if (!normalized) return Promise.resolve(null)
      const body = normalized.replace(/^sk-/iu, '')
      const row = this.one(`SELECT id, user_id, status, expired_time, model_limits, "group" AS "group"
        FROM tokens
        WHERE deleted_at IS NULL AND (key = ? OR key = ?)
        LIMIT 1`, [normalized, body])
      if (!row) return Promise.resolve(null)
      const status = numberValue(row, 'status') === 1 ? 'active' as const : 'disabled' as const
      return Promise.resolve({
        id: String(value(row, 'id') ?? ''),
        userId: value(row, 'user_id') === null || value(row, 'user_id') === undefined ? null : String(value(row, 'user_id')),
        status,
        modelLimits: parseModelLimits(value(row, 'model_limits')),
        expiresAt: isoTime(value(row, 'expired_time')),
      })
    } catch {
      return Promise.resolve(null)
    }
  }

  getModelMetadata(page = 1, pageSize = 100): Promise<NewApiManagementResult<unknown>> {
    try {
      const paging = pageArgs(page, pageSize)
      const total = numberValue(this.one('SELECT COUNT(*) AS total FROM models WHERE deleted_at IS NULL') ?? {}, 'total') ?? 0
      const rows = this.all(`SELECT id, model_name, status, name_rule FROM models
        WHERE deleted_at IS NULL ORDER BY id LIMIT ? OFFSET ?`, [paging.pageSize, paging.offset])
      return Promise.resolve(ready({ page: paging.page, page_size: paging.pageSize, total, items: rows.map(modelRow) }))
    } catch {
      return Promise.resolve(unavailable())
    }
  }

  getChannels(page = 1, pageSize = 100): Promise<NewApiManagementResult<unknown>> {
    try {
      const paging = pageArgs(page, pageSize)
      const total = numberValue(this.one('SELECT COUNT(*) AS total FROM channels') ?? {}, 'total') ?? 0
      const rows = this.all(`SELECT id, name, status, models FROM channels ORDER BY id LIMIT ? OFFSET ?`, [paging.pageSize, paging.offset])
      return Promise.resolve(ready({ page: paging.page, page_size: paging.pageSize, total, items: rows.map(channelRow) }))
    } catch {
      return Promise.resolve(unavailable())
    }
  }

  listLogs(limit = 10_000): readonly NewApiLogRecord[] {
    try {
      const rows = this.all(`SELECT id, user_id, created_at, type, username, token_name, model_name,
        quota, prompt_tokens, completion_tokens, use_time, is_stream, channel_id, channel_name,
        token_id, [group] AS [group], request_id, upstream_request_id
        FROM logs ORDER BY id DESC LIMIT ?`, [Math.min(50_000, Math.max(1, Math.floor(limit)))])
      return rows.map((row) => {
        const id = String(value(row, 'id') ?? '')
        const channelId = numberValue(row, 'channel_id')
        const tokenId = numberValue(row, 'token_id')
        return {
          id,
          userId: value(row, 'user_id') === null || value(row, 'user_id') === undefined ? null : String(value(row, 'user_id')),
          occurredAt: isoTime(value(row, 'created_at')),
          type: numberValue(row, 'type'),
          username: textValue(row, 'username'),
          tokenName: textValue(row, 'token_name'),
          modelName: textValue(row, 'model_name'),
          quota: nonNegativeNumber(row, 'quota'),
          promptTokens: nonNegativeNumber(row, 'prompt_tokens'),
          completionTokens: nonNegativeNumber(row, 'completion_tokens'),
          useTime: nonNegativeNumber(row, 'use_time'),
          streamed: Boolean(value(row, 'is_stream')),
          channelId: channelId !== null && channelId > 0 ? String(channelId) : null,
          channelName: textValue(row, 'channel_name'),
          tokenId: tokenId !== null && tokenId > 0 ? String(tokenId) : null,
          group: textValue(row, 'group'),
          requestId: `req-new-api-${id}`,
          upstreamRequestId: textValue(row, 'upstream_request_id'),
        }
      })
    } catch {
      return []
    }
  }
}

export function createNewApiDatabaseReader(filename = process.env.NEW_API_DB_PATH?.trim()) {
  if (!filename) return null
  try {
    return new ReadOnlyNewApiDatabase({ filename })
  } catch {
    return null
  }
}
