import { createHash } from 'node:crypto'
import { z } from 'zod'
import { resolveCpaManagementKey } from './deployment-config.js'

export const CPA_AUTH_FILE_MAX_BYTES = 2_000_000

const cpaAuthFileFormatSchema = z.enum(['cpa', 'codex_cli'])

export const cpaAuthVerificationSchema = z.object({
  status: z.enum(['verified', 'accepted', 'failed', 'unavailable']),
  probe: z.enum(['codex_usage', 'auth_file_status', 'not_run']),
  checkedAt: z.string().datetime(),
  detail: z.string().max(240),
  fileName: z.string().max(160).optional(),
})

const oauthStartSchema = z.object({
  status: z.string().optional(),
  url: z.string().url(),
  state: z.string().min(1).max(256),
})

const oauthStatusSchema = z.object({
  status: z.enum(['wait', 'ok', 'error']),
  error: z.string().max(200).optional(),
})

const authFileSchema = z.object({
  id: z.string().max(256).optional(),
  auth_index: z.string().max(256).optional(),
  name: z.string().max(256).optional(),
  provider: z.string().max(64).optional(),
  type: z.string().max(64).optional(),
  status: z.string().max(64).optional(),
  status_message: z.string().max(240).optional(),
  email: z.string().max(320).optional(),
  account: z.string().max(320).optional(),
  account_id: z.string().max(320).optional(),
  account_type: z.string().max(64).optional(),
  disabled: z.boolean().optional(),
  unavailable: z.boolean().optional(),
  created_at: z.string().max(128).optional(),
  updated_at: z.string().max(128).optional(),
  last_refresh: z.string().max(128).optional(),
  modtime: z.string().max(128).optional(),
  size: z.number().nonnegative().optional(),
  success: z.number().int().nonnegative().optional(),
  failed: z.number().int().nonnegative().optional(),
  recent_requests: z.array(z.object({ time: z.string().max(64), success: z.number().int().nonnegative(), failed: z.number().int().nonnegative() }).passthrough()).optional(),
  cooldowns: z.array(z.record(z.string(), z.unknown())).optional(),
  quota: z.record(z.string(), z.unknown()).optional(),
  id_token: z.unknown().optional(),
}).passthrough()

const authFilesResponseSchema = z.object({ files: z.array(authFileSchema).default([]) }).or(z.array(authFileSchema).transform((files) => ({ files })))

export const cpaManagementInputSchema = z.object({
  managementBaseUrl: z.string().trim().url().max(512).optional(),
  managementKey: z.string().trim().min(1).max(2_048).optional(),
})

export const cpaAuthFileUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(160),
  contentBase64: z.string().min(1).max(2_900_000),
}).extend(cpaManagementInputSchema.shape)

export type CpaManagementConfig = {
  baseUrl: string
  managementKey: string
}

export type CpaAuthFileSummary = z.infer<typeof authFileSchema>
export type CpaAuthFileUpload = z.infer<typeof cpaAuthFileUploadSchema>
export type CpaManagementInput = z.infer<typeof cpaManagementInputSchema>
export type CpaAuthFileFormat = z.infer<typeof cpaAuthFileFormatSchema>
export type CpaAuthVerification = z.infer<typeof cpaAuthVerificationSchema>

export type CpaAuthFileModel = {
  id: string
  displayName: string
  ownedBy?: string
  type?: string
}

export type CpaAuthFileSettings = {
  prefix: string
  proxyUrl: string
  priority: number | null
  weight: number | null
  disableCooling: boolean
  websockets: boolean
  usingApi: boolean
  note: string
  excludedModels: string[]
  headers: Record<string, string>
}

export type CpaAuthFileDetail = {
  infoJson: string
  jsonPreview: string
  settings: CpaAuthFileSettings
}

export type CpaCodexQuotaWindow = {
  id: string
  label: string
  usedPercent: number | null
  remainingPercent: number | null
  resetAt: string | null
  resetAfterSeconds: number | null
}

export type CpaCodexQuota = {
  status: 'success'
  planType: string | null
  subscriptionActiveUntil: string | null
  windows: CpaCodexQuotaWindow[]
  creditsAvailable: number | null
  checkedAt: string
}

type JsonRecord = Record<string, unknown>

type CodexTokenData = {
  accessToken: string
  refreshToken?: string
  idToken?: string
  accountId?: string
  email?: string
  lastRefresh?: string
  expired?: string
}

type DecodedCpaAuthFile = {
  fileName: string
  bytes: Buffer
  format: CpaAuthFileFormat
  accountId?: string
}

export class CpaManagementError extends Error {
  constructor(readonly code: 'CPA_MANAGEMENT_NOT_CONFIGURED' | 'CPA_MANAGEMENT_UNAVAILABLE' | 'CPA_MANAGEMENT_AUTH_FAILED' | 'CPA_MANAGEMENT_INVALID_RESPONSE' | 'CPA_AUTH_FILE_UNSUPPORTED_FORMAT', readonly statusCode = 502) {
    super({
      CPA_MANAGEMENT_NOT_CONFIGURED: 'AI OPS 服务端尚未读取到 CPA 管理地址和管理 Key，请检查服务端运行环境配置',
      CPA_MANAGEMENT_UNAVAILABLE: 'CPA 管理接口暂时不可达',
      CPA_MANAGEMENT_AUTH_FAILED: 'CPA 管理 Key 无效或已失效',
      CPA_MANAGEMENT_INVALID_RESPONSE: 'CPA 管理接口返回了无法识别的结果',
      CPA_AUTH_FILE_UNSUPPORTED_FORMAT: '该文件不是可转换的 Codex OAuth 认证文件；请上传 ~/.codex/auth.json 或 CPA 的 Codex JSON 文件',
    }[code])
  }
}

export function normalizeCpaManagementBaseUrl(value: string) {
  const url = new URL(value.trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('CPA 管理地址必须使用 HTTP 或 HTTPS')
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname
    .replace(/\/(?:management\.html|v0\/management)\/?$/i, '')
    .replace(/\/v1\/?$/i, '')
    .replace(/\/$/, '')
  return url.toString().replace(/\/$/, '')
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined
}

function textValue(record: JsonRecord | undefined, key: string) {
  const value = record?.[key]
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized ? normalized : undefined
}

function validEmail(value: string | undefined) {
  return value && value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : undefined
}

function decodeJwtClaims(token: string | undefined) {
  if (!token) return undefined
  const segment = token.split('.')[1]
  if (!segment) return undefined
  try {
    const decoded = Buffer.from(segment, 'base64url').toString('utf8')
    return asRecord(JSON.parse(decoded))
  } catch {
    return undefined
  }
}

function isoDate(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function tokenDataFromAuthJson(root: JsonRecord): CodexTokenData | undefined {
  const tokens = asRecord(root.tokens)
  const accessToken = textValue(tokens, 'access_token') ?? textValue(root, 'access_token')
  if (!accessToken) return undefined

  const idToken = textValue(tokens, 'id_token') ?? textValue(root, 'id_token')
  const idClaims = decodeJwtClaims(idToken)
  const authClaims = asRecord(idClaims?.['https://api.openai.com/auth'])
  const accountId = textValue(tokens, 'account_id')
    ?? textValue(root, 'account_id')
    ?? textValue(authClaims, 'chatgpt_account_id')
    ?? textValue(idClaims, 'chatgpt_account_id')
  const email = validEmail(textValue(root, 'email') ?? textValue(idClaims, 'email') ?? textValue(authClaims, 'email'))
  const expiryClaim = typeof idClaims?.exp === 'number' ? idClaims.exp : typeof idClaims?.exp === 'string' ? Number(idClaims.exp) : undefined
  const expired = isoDate(textValue(root, 'expired') ?? (expiryClaim && Number.isFinite(expiryClaim) ? expiryClaim * 1_000 : undefined))
  const lastRefresh = isoDate(textValue(root, 'last_refresh'))
  const refreshToken = textValue(tokens, 'refresh_token') ?? textValue(root, 'refresh_token')

  return { accessToken, ...(refreshToken ? { refreshToken } : {}), ...(idToken ? { idToken } : {}), ...(accountId ? { accountId } : {}), ...(email ? { email } : {}), ...(lastRefresh ? { lastRefresh } : {}), ...(expired ? { expired } : {}) }
}

function createCpaCodexPayload(data: CodexTokenData): JsonRecord {
  return {
    type: 'codex',
    access_token: data.accessToken,
    ...(data.refreshToken ? { refresh_token: data.refreshToken } : {}),
    ...(data.idToken ? { id_token: data.idToken } : {}),
    ...(data.accountId ? { account_id: data.accountId } : {}),
    ...(data.email ? { email: data.email } : {}),
    ...(data.lastRefresh ? { last_refresh: data.lastRefresh } : {}),
    ...(data.expired ? { expired: data.expired } : {}),
    disabled: false,
  }
}

function generatedCodexFileName(data: CodexTokenData, sourceName: string) {
  const idClaims = decodeJwtClaims(data.idToken)
  const stableIdentity = data.accountId ?? data.email ?? textValue(idClaims, 'sub') ?? data.idToken ?? sourceName
  const digest = createHash('sha256').update(stableIdentity).digest('hex').slice(0, 20)
  return `codex-${digest}.json`
}

function unsupportedAuthFile() {
  throw new CpaManagementError('CPA_AUTH_FILE_UNSUPPORTED_FORMAT', 400)
}

export function decodeCpaAuthFile(input: CpaAuthFileUpload): DecodedCpaAuthFile {
  const fileName = input.fileName.trim()
  if (!/^[^\\/\r\n]+\.json$/i.test(fileName)) throw new CpaManagementError('CPA_MANAGEMENT_INVALID_RESPONSE', 400)
  const encoded = input.contentBase64.trim()
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) throw new CpaManagementError('CPA_MANAGEMENT_INVALID_RESPONSE', 400)
  const bytes = Buffer.from(encoded, 'base64')
  const canonical = bytes.toString('base64').replace(/=+$/, '')
  if (canonical !== encoded.replace(/=+$/, '') || bytes.length === 0 || bytes.length > CPA_AUTH_FILE_MAX_BYTES) throw new CpaManagementError('CPA_MANAGEMENT_INVALID_RESPONSE', 400)
  const text = bytes.toString('utf8')
  if (text.includes('\uFFFD')) throw new CpaManagementError('CPA_MANAGEMENT_INVALID_RESPONSE', 400)
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch {
    throw new CpaManagementError('CPA_MANAGEMENT_INVALID_RESPONSE', 400)
  }
  const root = asRecord(parsed)
  if (!root) throw new CpaManagementError('CPA_MANAGEMENT_INVALID_RESPONSE', 400)

  const rootType = textValue(root, 'type')?.toLowerCase()
  const authMode = textValue(root, 'auth_mode')?.toLowerCase()
  const tokens = asRecord(root.tokens)
  const tokenData = tokenDataFromAuthJson(root)
  const apiKey = textValue(root, 'OPENAI_API_KEY') ?? textValue(root, 'openai_api_key')

  // Codex CLI stores ChatGPT OAuth credentials under `tokens`. CPA stores the
  // same material as a provider-specific top-level object. Convert only the
  // OAuth shape; an API-key login cannot be silently represented as a Codex
  // OAuth account in CPA.
  if (tokens && tokenData && authMode !== 'api_key' && authMode !== 'apikey' && authMode !== 'personalaccesstoken' && authMode !== 'agentidentity' && (authMode === 'chatgpt' || authMode === 'chatgptauthtokens' || !rootType)) {
    if (!tokenData.refreshToken) unsupportedAuthFile()
    const converted = Buffer.from(JSON.stringify(createCpaCodexPayload(tokenData)), 'utf8')
    if (converted.length > CPA_AUTH_FILE_MAX_BYTES) throw new CpaManagementError('CPA_MANAGEMENT_INVALID_RESPONSE', 400)
    return { fileName: generatedCodexFileName(tokenData, fileName), bytes: converted, format: 'codex_cli', ...(tokenData.accountId ? { accountId: tokenData.accountId } : {}) }
  }

  if ((authMode === 'api_key' || authMode === 'apikey' || authMode === 'personalaccesstoken' || authMode === 'agentidentity') && !tokenData) unsupportedAuthFile()
  if (apiKey && !tokenData) unsupportedAuthFile()

  // Keep accepting CPA-native files (and let CPA perform the provider-level
  // validation), while still rejecting an arbitrary non-credential object.
  if (tokenData || rootType === 'codex') return { fileName, bytes, format: 'cpa', ...(tokenData?.accountId ? { accountId: tokenData.accountId } : {}) }
  throw new CpaManagementError('CPA_MANAGEMENT_INVALID_RESPONSE', 400)
}

function configuredClient(config: Partial<CpaManagementConfig> = process.env) {
  const baseUrl = config.baseUrl?.trim() || process.env.CPA_MANAGEMENT_URL?.trim() || process.env.CPA_BASE_URL?.trim() || process.env.AI_OPS_GATEWAY_CPA_BASE_URL?.trim()
  const managementKey = config.managementKey?.trim() || resolveCpaManagementKey()
  if (!baseUrl || !managementKey) throw new CpaManagementError('CPA_MANAGEMENT_NOT_CONFIGURED', 400)
  try {
    return { baseUrl: normalizeCpaManagementBaseUrl(baseUrl), managementKey }
  } catch {
    throw new CpaManagementError('CPA_MANAGEMENT_NOT_CONFIGURED', 400)
  }
}

async function requestJson(config: Partial<CpaManagementConfig>, path: string, init: RequestInit = {}) {
  const client = configuredClient(config)
  let response: Response
  try {
    response = await fetch(`${client.baseUrl}/v0/management/${path.replace(/^\//, '')}`, {
      ...init,
      headers: { Authorization: `Bearer ${client.managementKey}`, ...(init.headers ?? {}) },
    })
  } catch {
    throw new CpaManagementError('CPA_MANAGEMENT_UNAVAILABLE')
  }
  if (response.status === 401 || response.status === 403) throw new CpaManagementError('CPA_MANAGEMENT_AUTH_FAILED', response.status)
  if (!response.ok) throw new CpaManagementError('CPA_MANAGEMENT_UNAVAILABLE', response.status >= 500 ? 502 : response.status)
  const text = await response.text()
  if (!text.trim()) return {}
  try { return JSON.parse(text) as unknown } catch { throw new CpaManagementError('CPA_MANAGEMENT_INVALID_RESPONSE') }
}

async function requestBinary(config: Partial<CpaManagementConfig>, path: string) {
  const client = configuredClient(config)
  let response: Response
  try {
    response = await fetch(`${client.baseUrl}/v0/management/${path.replace(/^\//, '')}`, {
      headers: { Authorization: `Bearer ${client.managementKey}` },
    })
  } catch {
    throw new CpaManagementError('CPA_MANAGEMENT_UNAVAILABLE')
  }
  if (response.status === 401 || response.status === 403) throw new CpaManagementError('CPA_MANAGEMENT_AUTH_FAILED', response.status)
  if (!response.ok) throw new CpaManagementError('CPA_MANAGEMENT_UNAVAILABLE', response.status >= 500 ? 502 : response.status)
  return { bytes: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') ?? 'application/json' }
}

function safeAuthFileName(fileName: string) {
  const safeName = fileName.trim()
  if (!/^[^\\/\r\n]+\.json$/i.test(safeName)) throw new CpaManagementError('CPA_MANAGEMENT_INVALID_RESPONSE', 400)
  return safeName
}

export async function startCpaCodexOAuth(config: Partial<CpaManagementConfig> = {}) {
  const value = await requestJson(config, 'codex-auth-url?is_webui=true')
  const parsed = oauthStartSchema.safeParse(value)
  if (!parsed.success) throw new CpaManagementError('CPA_MANAGEMENT_INVALID_RESPONSE')
  return parsed.data
}

export async function getCpaOAuthStatus(config: Partial<CpaManagementConfig>, state: string) {
  const value = await requestJson(config, `get-auth-status?state=${encodeURIComponent(state)}`)
  const parsed = oauthStatusSchema.safeParse(value)
  if (!parsed.success) throw new CpaManagementError('CPA_MANAGEMENT_INVALID_RESPONSE')
  return parsed.data
}

export async function uploadCpaAuthFile(config: Partial<CpaManagementConfig>, fileName: string, bytes: Uint8Array) {
  const safeName = safeAuthFileName(fileName)
  const form = new FormData()
  const fileBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  form.append('file', new Blob([fileBytes], { type: 'application/json' }), safeName)
  const value = await requestJson(config, 'auth-files', { method: 'POST', body: form })
  if (!z.object({ status: z.string().optional() }).passthrough().safeParse(value).success) throw new CpaManagementError('CPA_MANAGEMENT_INVALID_RESPONSE')
  return { status: 'ok' as const }
}

export async function setCpaAuthFileStatus(config: Partial<CpaManagementConfig>, fileName: string, disabled: boolean) {
  const name = safeAuthFileName(fileName)
  await requestJson(config, 'auth-files/status', {
    method: 'PATCH',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ name, disabled }),
  })
  return { status: 'ok' as const }
}

export async function requestCpaAuthFileRefresh(config: Partial<CpaManagementConfig>, fileName: string, authIndex?: string) {
  const name = safeAuthFileName(fileName)
  await requestJson(config, 'auth-files/refresh', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ name, ...(authIndex ? { auth_index: authIndex } : {}) }),
  })
  return { status: 'ok' as const }
}

export async function deleteCpaAuthFile(config: Partial<CpaManagementConfig>, fileName: string) {
  const name = safeAuthFileName(fileName)
  await requestJson(config, 'auth-files', {
    method: 'DELETE',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ names: [name] }),
  })
  return { status: 'ok' as const }
}

export async function downloadCpaAuthFile(config: Partial<CpaManagementConfig>, fileName: string) {
  const name = safeAuthFileName(fileName)
  return requestBinary(config, `auth-files/download?name=${encodeURIComponent(name)}`)
}

function numberValue(value: unknown) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(number) ? number : null
}

function booleanValue(value: unknown) {
  return value === true || value === 1 || (typeof value === 'string' && value.trim().toLowerCase() === 'true')
}

function stringArrayValue(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : []
}

function stringRecordValue(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item === 'string').map(([key, item]) => [key, item as string]))
}

const sensitiveAuthKeyPattern = /(?:access|refresh|id)[_-]?token|(?:api|client|management)[_-]?key|authorization|password|secret/i

function redactAuthJson(value: unknown, key?: string): unknown {
  if (key && sensitiveAuthKeyPattern.test(key)) return '[REDACTED]'
  if (Array.isArray(value)) return value.map((item) => redactAuthJson(item))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactAuthJson(entryValue, entryKey)]))
}

function authFileInfo(root: JsonRecord, fileName: string, size: number, summary?: CpaAuthFileSummary): JsonRecord {
  const info: JsonRecord = {
    name: fileName,
    provider: summary?.provider ?? textValue(root, 'provider') ?? textValue(root, 'type') ?? 'codex',
    size: summary?.size ?? size,
  }
  for (const key of ['account', 'account_id', 'email', 'status', 'status_message', 'created_at', 'updated_at', 'last_refresh']) {
    if (summary && key === 'account' && summary.account !== undefined) info[key] = summary.account
    else if (summary && key === 'email' && summary.email !== undefined) info[key] = summary.email
    else if (root[key] !== undefined) info[key] = redactAuthJson(root[key], key)
  }
  const quota = summary?.quota ?? root.quota ?? { signals: {} }
  const recentRequests = summary?.recent_requests ?? root.recent_requests ?? []
  info.quota = redactAuthJson(quota, 'quota')
  info.recent_requests = redactAuthJson(recentRequests, 'recent_requests')
  if (summary?.success !== undefined) info.success = summary.success
  if (summary?.failed !== undefined) info.failed = summary.failed
  if (summary?.disabled !== undefined) info.disabled = summary.disabled
  return info
}

async function readCpaAuthFileJson(config: Partial<CpaManagementConfig>, fileName: string) {
  const result = await downloadCpaAuthFile(config, fileName)
  let parsed: unknown
  try { parsed = JSON.parse(result.bytes.toString('utf8')) } catch { throw new CpaManagementError('CPA_MANAGEMENT_INVALID_RESPONSE') }
  const root = asRecord(parsed)
  if (!root) throw new CpaManagementError('CPA_MANAGEMENT_INVALID_RESPONSE')
  return { root, size: result.bytes.length }
}

function settingsFromJson(root: JsonRecord): CpaAuthFileSettings {
  const priority = numberValue(root.priority)
  const weight = numberValue(root.weight)
  return {
    prefix: textValue(root, 'prefix') ?? '',
    proxyUrl: textValue(root, 'proxy_url') ?? '',
    priority,
    weight,
    disableCooling: booleanValue(root.disable_cooling ?? root['disable-cooling']),
    websockets: booleanValue(root.websockets),
    usingApi: booleanValue(root.using_api),
    note: textValue(root, 'note') ?? '',
    excludedModels: stringArrayValue(root.excluded_models ?? root['excluded-models']),
    headers: stringRecordValue(root.headers),
  }
}

export async function getCpaAuthFileSettings(config: Partial<CpaManagementConfig>, fileName: string) {
  const { root } = await readCpaAuthFileJson(config, fileName)
  return settingsFromJson(root)
}

export async function getCpaAuthFileDetail(config: Partial<CpaManagementConfig>, fileName: string): Promise<CpaAuthFileDetail> {
  const safeName = safeAuthFileName(fileName)
  const { root, size } = await readCpaAuthFileJson(config, safeName)
  let summary: CpaAuthFileSummary | undefined
  try { summary = (await listCpaAuthFiles(config)).find((file) => file.name === safeName || file.id === safeName) } catch { /* the downloaded file is still enough to render a detail view */ }
  return {
    infoJson: JSON.stringify(authFileInfo(root, safeName, size, summary), null, 2),
    jsonPreview: JSON.stringify(redactAuthJson(root), null, 2),
    settings: settingsFromJson(root),
  }
}

export async function patchCpaAuthFileSettings(config: Partial<CpaManagementConfig>, fileName: string, settings: Partial<CpaAuthFileSettings>) {
  const name = safeAuthFileName(fileName)
  const body = {
    name,
    ...(settings.prefix !== undefined ? { prefix: settings.prefix.trim() } : {}),
    ...(settings.proxyUrl !== undefined ? { proxy_url: settings.proxyUrl.trim() } : {}),
    ...(settings.priority !== undefined ? { priority: settings.priority } : {}),
    ...(settings.weight !== undefined ? { weight: settings.weight } : {}),
    ...(settings.disableCooling !== undefined ? { disable_cooling: settings.disableCooling } : {}),
    ...(settings.websockets !== undefined ? { websockets: settings.websockets } : {}),
    ...(settings.usingApi !== undefined ? { using_api: settings.usingApi } : {}),
    ...(settings.note !== undefined ? { note: settings.note.trim() } : {}),
    ...(settings.excludedModels !== undefined ? { excluded_models: settings.excludedModels } : {}),
    ...(settings.headers !== undefined ? { headers: settings.headers } : {}),
  }
  await requestJson(config, 'auth-files/fields', {
    method: 'PATCH',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: 'ok' as const }
}

export async function getCpaAuthFileModels(config: Partial<CpaManagementConfig>, fileName: string) {
  const name = safeAuthFileName(fileName)
  const value = await requestJson(config, `auth-files/models?name=${encodeURIComponent(name)}`)
  const list = Array.isArray(value) ? value : asRecord(value)?.models
  if (!Array.isArray(list)) throw new CpaManagementError('CPA_MANAGEMENT_INVALID_RESPONSE')
  return list.flatMap((item): CpaAuthFileModel[] => {
    const record = asRecord(item)
    const id = textValue(record, 'id')
    if (!id) return []
    return [{ id, displayName: textValue(record, 'display_name') ?? textValue(record, 'displayName') ?? id, ...(textValue(record, 'owned_by') || textValue(record, 'ownedBy') ? { ownedBy: textValue(record, 'owned_by') ?? textValue(record, 'ownedBy') } : {}), ...(textValue(record, 'type') ? { type: textValue(record, 'type') } : {}) }]
  })
}

const cpaApiCallResponseSchema = z.object({
  status_code: z.number().int(),
  body: z.string().max(2_000_000),
})

function verification(status: CpaAuthVerification['status'], probe: CpaAuthVerification['probe'], detail: string, fileName?: string): CpaAuthVerification {
  return { status, probe, checkedAt: new Date().toISOString(), detail, ...(fileName ? { fileName } : {}) }
}

function fileTimestamp(file: CpaAuthFileSummary) {
  return [file.updated_at, file.last_refresh, file.created_at].map((value) => value ? Date.parse(value) : 0).find((value) => Number.isFinite(value) && value > 0) ?? 0
}

function isCodexFile(file: CpaAuthFileSummary) {
  return [file.provider, file.type].some((value) => value?.trim().toLowerCase() === 'codex') || file.name?.toLowerCase().startsWith('codex-') === true
}

async function cpaCodexUsageProbe(config: Partial<CpaManagementConfig>, authIndex: string, accountId?: string) {
  const headers: Record<string, string> = {
    Authorization: 'Bearer $TOKEN$',
    Accept: 'application/json',
    Origin: 'https://chatgpt.com',
    Referer: 'https://chatgpt.com/',
    'User-Agent': 'codex_cli_rs/0.76.0',
  }
  if (accountId) headers['ChatGPT-Account-Id'] = accountId
  const value = await requestJson(config, 'api-call', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ auth_index: authIndex, method: 'GET', url: 'https://chatgpt.com/backend-api/wham/usage', header: headers }),
  })
  const parsed = cpaApiCallResponseSchema.safeParse(value)
  if (!parsed.success) throw new CpaManagementError('CPA_MANAGEMENT_INVALID_RESPONSE')
  return parsed.data
}

function usageResponseLooksValid(body: string) {
  try {
    const parsed = asRecord(JSON.parse(body))
    return Boolean(parsed && ('rate_limit' in parsed || 'plan_type' in parsed || 'credits' in parsed))
  } catch {
    return false
  }
}

function epochDate(value: unknown) {
  const numeric = numberValue(value)
  if (numeric !== null) {
    const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1_000
    const date = new Date(milliseconds)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  return isoDate(value)
}

function clampPercent(value: number | null) {
  return value === null ? null : Math.min(100, Math.max(0, value))
}

function quotaWindow(id: string, label: string, value: unknown): CpaCodexQuotaWindow | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  const usedPercent = clampPercent(numberValue(record.used_percent ?? record.usedPercent))
  const remainingPercent = clampPercent(numberValue(record.remaining_percent ?? record.remainingPercent) ?? (usedPercent === null ? null : 100 - usedPercent))
  const resetAfterSeconds = numberValue(record.reset_after_seconds ?? record.resetAfterSeconds)
  const resetAt = epochDate(record.reset_at ?? record.resetAt)
  if (usedPercent === null && remainingPercent === null && resetAfterSeconds === null && !resetAt) return undefined
  return { id, label, usedPercent, remainingPercent, resetAt: resetAt ?? null, resetAfterSeconds }
}

function quotaWindowLabel(value: JsonRecord, fallback: string) {
  const seconds = numberValue(value.limit_window_seconds ?? value.limitWindowSeconds)
  if (seconds === 604_800) return '周限额'
  if (seconds === 18_000) return '5 小时限额'
  if (seconds !== null && seconds >= 3_600) return `${Math.round(seconds / 3_600)} 小时限额`
  return fallback
}

function accountIdFromAuthFile(file: CpaAuthFileSummary) {
  const claims = typeof file.id_token === 'string' ? decodeJwtClaims(file.id_token) : asRecord(file.id_token)
  const authClaims = asRecord(claims?.['https://api.openai.com/auth'])
  return textValue(file, 'account_id')
    ?? textValue(authClaims, 'chatgpt_account_id')
    ?? textValue(claims, 'chatgpt_account_id')
}

function parseCodexQuotaBody(body: string): CpaCodexQuota {
  let parsed: unknown
  try { parsed = JSON.parse(body) } catch { throw new CpaManagementError('CPA_MANAGEMENT_INVALID_RESPONSE') }
  const root = asRecord(parsed)
  if (!root) throw new CpaManagementError('CPA_MANAGEMENT_INVALID_RESPONSE')

  const rateLimit = asRecord(root.rate_limit ?? root.rateLimit)
  const windows = [
    quotaWindow('primary', '主限额', rateLimit?.primary_window ?? rateLimit?.primaryWindow),
    quotaWindow('secondary', '辅助限额', rateLimit?.secondary_window ?? rateLimit?.secondaryWindow),
  ].filter((window): window is CpaCodexQuotaWindow => Boolean(window))
  if (windows.length === 0 && !('credits' in root) && !('plan_type' in root) && !('planType' in root)) throw new CpaManagementError('CPA_MANAGEMENT_INVALID_RESPONSE')

  const normalizedWindows = windows.map((window) => {
    const source = window.id === 'primary' ? asRecord(rateLimit?.primary_window ?? rateLimit?.primaryWindow) : asRecord(rateLimit?.secondary_window ?? rateLimit?.secondaryWindow)
    return source ? { ...window, label: quotaWindowLabel(source, window.label) } : window
  })
  const credits = asRecord(root.rate_limit_reset_credits ?? root.rateLimitResetCredits)
  const creditCount = numberValue(credits?.available_count ?? credits?.availableCount)
  const subscriptionActiveUntil = epochDate(root.subscription_active_until ?? root.subscriptionActiveUntil)
  return {
    status: 'success',
    planType: textValue(root, 'plan_type') ?? textValue(root, 'planType') ?? null,
    subscriptionActiveUntil: subscriptionActiveUntil ?? null,
    windows: normalizedWindows,
    creditsAvailable: creditCount,
    checkedAt: new Date().toISOString(),
  }
}

export async function getCpaCodexQuota(config: Partial<CpaManagementConfig>, fileName: string) {
  const name = safeAuthFileName(fileName)
  const file = (await listCpaAuthFiles(config)).find((item) => item.name === name || item.id === name)
  if (!file?.auth_index) throw new CpaManagementError('CPA_MANAGEMENT_INVALID_RESPONSE')
  const probe = await cpaCodexUsageProbe(config, file.auth_index, accountIdFromAuthFile(file))
  if (probe.status_code === 401 || probe.status_code === 403) throw new CpaManagementError('CPA_MANAGEMENT_AUTH_FAILED')
  if (probe.status_code < 200 || probe.status_code >= 300) throw new CpaManagementError('CPA_MANAGEMENT_UNAVAILABLE')
  if (!usageResponseLooksValid(probe.body)) throw new CpaManagementError('CPA_MANAGEMENT_INVALID_RESPONSE')
  return parseCodexQuotaBody(probe.body)
}

export type CpaAuthVerificationTarget = { fileName?: string; accountId?: string }

/**
 * Verifies the account that CPA loaded, rather than merely checking that a
 * JSON upload was accepted. CPA resolves `$TOKEN$` for the selected auth index,
 * so AI OPS never needs to read or return the bearer token itself.
 */
export async function verifyCpaAuthFile(config: Partial<CpaManagementConfig> = {}, target: CpaAuthVerificationTarget = {}): Promise<CpaAuthVerification> {
  let files: CpaAuthFileSummary[]
  try {
    files = await listCpaAuthFiles(config)
  } catch {
    return verification('unavailable', 'not_run', 'CPA 已接收认证文件，但账号列表暂时无法读取；请稍后刷新。', target.fileName)
  }

  const requestedName = target.fileName?.trim()
  const candidates = requestedName
    ? files.filter((file) => file.name === requestedName || file.id === requestedName)
    : files.filter(isCodexFile).sort((left, right) => fileTimestamp(right) - fileTimestamp(left))
  const file = candidates[0]
  if (!file) return verification('accepted', 'auth_file_status', 'CPA 已接收认证文件，正在热加载账号；刷新账号池确认状态。', requestedName)

  const name = file.name ?? file.id ?? requestedName
  if (file.disabled || file.unavailable || ['error', 'failed', 'expired', 'disabled'].includes(file.status?.trim().toLowerCase() ?? '')) {
    return verification('failed', 'auth_file_status', 'CPA 已加载该账号，但账号当前不可用或认证已失效。', name)
  }
  if (!file.auth_index) return verification('accepted', 'auth_file_status', 'CPA 已加载该账号；当前版本未提供可执行的账号索引验证。', name)

  try {
    const probe = await cpaCodexUsageProbe(config, file.auth_index, target.accountId)
    if (probe.status_code === 200 && usageResponseLooksValid(probe.body)) return verification('verified', 'codex_usage', 'CPA 已加载该账号，并通过 Codex usage 接口完成真实认证验证。', name)
    if (probe.status_code === 401 || probe.status_code === 403) return verification('failed', 'codex_usage', 'CPA 已加载该账号，但 Codex 上游返回认证失败。', name)
    return verification('unavailable', 'codex_usage', 'CPA 已加载该账号，但实时认证接口暂时没有返回可用结果。', name)
  } catch {
    return verification('unavailable', 'codex_usage', 'CPA 已加载该账号，但实时认证接口暂时不可用；请稍后刷新。', name)
  }
}

export async function listCpaAuthFiles(config: Partial<CpaManagementConfig> = {}) {
  const value = await requestJson(config, 'auth-files')
  const parsed = authFilesResponseSchema.safeParse(value)
  if (!parsed.success) throw new CpaManagementError('CPA_MANAGEMENT_INVALID_RESPONSE')
  return parsed.data.files
}
