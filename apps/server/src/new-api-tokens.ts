import { createNewApiManagementClient, type NewApiManagementResult, type NewApiTokenClient } from './new-api-management.js'

export type NewApiTokenStatus = 'active' | 'disabled' | 'unknown'

export interface NewApiTokenRecord {
  id: string
  userId: string | null
  name: string
  secret: string | null
  masked: string
  status: NewApiTokenStatus
  unlimitedQuota: boolean | null
  modelLimitsEnabled: boolean | null
  modelLimits: string[]
  group: string | null
  expiresAt: string | null
  createdAt: string | null
  lastUsedAt: string | null
}

export function managementResultError(result: NewApiManagementResult<unknown>) {
  if (result.state === 'auth_required') return 'NEW_API_UNAVAILABLE'
  return result.state === 'ready' ? null : 'NEW_API_UNAVAILABLE'
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isMaskedNewApiToken(value: string) {
  // New API deployments use several masking styles. In particular, AI OPS
  // renders masks with the bullet character, so accepting only asterisks here
  // could accidentally turn a displayed mask into a usable credential.
  return /[*＊•●○◦▪▫…]/u.test(value) || value.includes('...')
}

export function displayNewApiTokenMask(masked: string) {
  const normalized = masked.trim()
  if (!normalized || normalized === '未返回掩码' || normalized.startsWith('sk-')) return normalized
  return `sk-${normalized}`
}

function id(value: unknown) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
  return text(value)
}

function booleanValue(value: unknown) {
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1' || value === 'true') return true
  if (value === 0 || value === '0' || value === 'false') return false
  return null
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function unixTime(value: unknown) {
  const seconds = numberValue(value)
  if (seconds === null || seconds <= 0) return null
  const date = new Date(seconds * 1_000)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function modelLimits(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean)
  if (value && typeof value === 'object') return Object.entries(value).filter(([, enabled]) => Boolean(enabled)).map(([model]) => model)
  return []
}

function tokenStatus(value: unknown): NewApiTokenStatus {
  if (value === 1 || value === '1' || value === true || value === 'active' || value === 'enabled') return 'active'
  if (value === 0 || value === '0' || value === false || value === 'disabled' || value === 'revoked' || value === 'expired') return 'disabled'
  return 'unknown'
}

export function normalizeNewApiToken(value: unknown): NewApiTokenRecord | null {
  const root = record(value)
  const item = root && (record(root.token) ?? record(root.data)) ? (record(root.token) ?? record(root.data)) : root
  if (!item) return null
  const tokenId = id(item.id ?? item.token_id ?? item.tokenId)
  if (!tokenId) return null
  const rawSecret = text(item.key ?? item.token ?? item.secret)
  const secret = rawSecret && !isMaskedNewApiToken(rawSecret) ? rawSecret : null
  const maskedValue = rawSecret ?? text(item.masked_key ?? item.maskedKey ?? item.key_masked)
  const masked = secret ? maskNewApiToken(secret) : maskedValue ? displayNewApiTokenMask(maskedValue) : '未返回掩码'
  const limits = modelLimits(item.model_limits ?? item.modelLimits)
  return {
    id: tokenId,
    userId: id(item.user_id ?? item.userId),
    name: text(item.name) ?? `Token ${tokenId}`,
    secret,
    masked,
    status: tokenStatus(item.status),
    unlimitedQuota: booleanValue(item.unlimited_quota ?? item.unlimitedQuota),
    modelLimitsEnabled: booleanValue(item.model_limits_enabled ?? item.modelLimitsEnabled),
    modelLimits: limits,
    group: text(item.group),
    expiresAt: unixTime(item.expired_time ?? item.expiredTime ?? item.expires_at ?? item.expiresAt),
    createdAt: unixTime(item.created_time ?? item.createdTime),
    lastUsedAt: unixTime(item.accessed_time ?? item.accessedTime ?? item.last_used_at ?? item.lastUsedAt),
  }
}

export function extractNewApiToken(value: unknown) {
  return normalizeNewApiToken(value)
}

export function extractNewApiTokenSecret(value: unknown) {
  const root = record(value)
  const item = root && (record(root.data) ?? record(root.token)) ? (record(root.data) ?? record(root.token)) : root
  const candidate = item ? text(item.key ?? item.token ?? item.secret) : null
  return candidate && !isMaskedNewApiToken(candidate) ? candidate : null
}

export function extractNewApiTokens(value: unknown) {
  const item = record(value)
  const values = Array.isArray(value) ? value : Array.isArray(item?.items) ? item.items : Array.isArray(item?.tokens) ? item.tokens : []
  return values.map(normalizeNewApiToken).filter((token): token is NewApiTokenRecord => token !== null)
}

/**
 * New API stores the canonical token body without the OpenAI-compatible
 * display prefix. Consumers such as Codex use the prefixed form.
 */
export function displayNewApiTokenSecret(secret: string) {
  const normalized = secret.trim()
  if (!normalized) return ''
  return normalized.startsWith('sk-') ? normalized : `sk-${normalized}`
}

export function maskNewApiToken(secret: string) {
  const normalized = secret.trim()
  if (!normalized) return '未返回掩码'
  const display = displayNewApiTokenSecret(normalized)
  const body = display.slice(3)
  if (body.length <= 4) return `sk-${body.slice(0, 1)}••••••`
  return `sk-${body.slice(0, Math.min(3, body.length - 4))}••••••${body.slice(-4).toUpperCase()}`
}

export function createDefaultNewApiTokenClient(): NewApiTokenClient {
  return createNewApiManagementClient({ baseUrl: process.env.NEW_API_BASE_URL, accessToken: process.env.NEW_API_ACCESS_TOKEN, userId: process.env.NEW_API_USER_ID })
}
