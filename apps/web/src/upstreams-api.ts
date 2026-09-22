import { z } from 'zod'
import { withCsrfHeader } from './csrf'

export const upstreamFiltersSchema = z.object({ search: z.string().max(60), type: z.enum(['all', 'cpa_oauth']), status: z.enum(['all', 'healthy', 'degraded', 'auth_required', 'offline', 'unconfigured']) })

const upstreamItemSchema = z.object({
  id: z.string(), name: z.string(), provider: z.string(), type: z.literal('cpa_oauth'), environment: z.literal('production'), status: z.enum(['healthy', 'degraded', 'auth_required', 'offline', 'unconfigured']), credentialConfigured: z.boolean(), credentialValidation: z.enum(['verified', 'failed', 'not_checked']), models: z.array(z.string()),
  health: z.object({ successRate: z.number().min(0).max(100).nullable(), latencyMs: z.number().int().nonnegative().nullable(), checkedAt: z.string().datetime() }),
  balance: z.object({ state: z.enum(['sufficient', 'low', 'unknown', 'unavailable']), label: z.string(), updatedAt: z.string().datetime().nullable() }),
  capacity: z.object({ rpm: z.number().int().positive(), tpm: z.number().int().positive() }).nullable(),
  auth: z.object({ expiresAt: z.string().datetime().nullable(), lastRefreshedAt: z.string().datetime().nullable() }).nullable(),
  windows: z.array(z.object({ id: z.enum(['five_hour', 'weekly']), label: z.string(), usedPercent: z.number().min(0).max(100), resetsAt: z.string().datetime() })),
  cooldown: z.object({ active: z.boolean(), until: z.string().datetime().nullable(), reason: z.string().nullable() }).nullable(),
  recentError: z.object({ category: z.enum(['authentication', 'rate_limit', 'timeout', 'balance', 'server', 'connection']), summary: z.string(), firstSeenAt: z.string().datetime(), lastSeenAt: z.string().datetime() }).nullable(),
})

export const upstreamsResponseSchema = z.object({
  meta: z.object({ source: z.literal('live'), generatedAt: z.string().datetime(), notice: z.string(), live: z.object({ cpa: z.enum(['reachable', 'offline']), checkedAt: z.string().datetime(), managementConfigured: z.boolean() }) }),
  summary: z.object({ total: z.number().int().nonnegative(), available: z.number().int().nonnegative(), needsAttention: z.number().int().nonnegative(), official: z.number().int().nonnegative(), experiment: z.number().int().nonnegative(), configured: z.number().int().nonnegative() }),
  isolation: z.object({ enforced: z.literal(true), productionToExperimentFallback: z.literal(false), statement: z.string() }),
  items: z.array(upstreamItemSchema), total: z.number().int().nonnegative(),
})

export type UpstreamFilters = z.infer<typeof upstreamFiltersSchema>
export type UpstreamsResponse = z.infer<typeof upstreamsResponseSchema>
export type UpstreamItem = z.infer<typeof upstreamItemSchema>

export const upstreamCheckBodySchema = z.object({
  idempotencyKey: z.string().regex(/^upstream-check-[a-z0-9-]{8,96}$/),
  reason: z.string().trim().min(8).max(200),
  acknowledgeSynthetic: z.literal(true),
})

export const upstreamCheckResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), completedAt: z.string().datetime(), notice: z.string() }),
  upstream: upstreamItemSchema,
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})

export const upstreamHistoryResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), generatedAt: z.string().datetime(), notice: z.string() }),
  upstream: z.object({ id: z.string(), name: z.string() }),
  items: z.array(z.object({
    id: z.string(), checkedAt: z.string().datetime(), actorName: z.string(), actorRole: z.enum(['super_admin', 'admin', 'department_lead', 'finance', 'employee', 'system']),
    result: z.enum(['success', 'failed', 'denied']), requestId: z.string(), code: z.string(), summary: z.string(),
  })),
  total: z.number().int().nonnegative(),
})

export type UpstreamCheckBody = z.infer<typeof upstreamCheckBodySchema>
export type UpstreamCheckResponse = z.infer<typeof upstreamCheckResponseSchema>
export type UpstreamHistoryResponse = z.infer<typeof upstreamHistoryResponseSchema>

export const cpaCredentialInputSchema = z.object({
  baseUrl: z.string().url().max(512),
  apiKey: z.string().min(1).max(512),
  managementBaseUrl: z.string().url().max(512).optional(),
  managementKey: z.string().min(1).max(2_048).optional(),
})

export const cpaCredentialResponseSchema = z.object({
  meta: z.object({ source: z.literal('runtime'), completedAt: z.string().datetime(), notice: z.string() }),
  cpa: z.object({ status: z.enum(['healthy', 'empty']), modelCount: z.number().int().nonnegative(), latencyMs: z.number().int().nonnegative() }),
  managementConfigured: z.boolean(),
  requestId: z.string(),
})

export const cpaOAuthStartResponseSchema = z.object({ status: z.literal('ok'), url: z.string().url(), state: z.string(), requestId: z.string() })
export const cpaAuthVerificationSchema = z.object({ status: z.enum(['verified', 'accepted', 'failed', 'unavailable']), probe: z.enum(['codex_usage', 'auth_file_status', 'not_run']), checkedAt: z.string().datetime(), detail: z.string(), fileName: z.string().optional() })
export const cpaOAuthStatusResponseSchema = z.object({ status: z.enum(['wait', 'ok', 'error']), verification: cpaAuthVerificationSchema.optional(), requestId: z.string() })
export const cpaAuthFileSchema = z.object({
  id: z.string().optional(), name: z.string().optional(), provider: z.string().optional(), status: z.string().optional(), email: z.string().optional(), account: z.string().optional(), accountType: z.string().optional(), disabled: z.boolean().optional(), unavailable: z.boolean().optional(), size: z.number().nonnegative().optional(), modtime: z.string().optional(), createdAt: z.string().optional(), updatedAt: z.string().optional(), lastRefresh: z.string().optional(), success: z.number().int().nonnegative().optional(), failed: z.number().int().nonnegative().optional(), recentRequests: z.array(z.object({ time: z.string(), success: z.number().int().nonnegative(), failed: z.number().int().nonnegative() })).optional(),
})
export const cpaAuthFilesResponseSchema = z.object({ files: z.array(cpaAuthFileSchema), requestId: z.string() })
export const cpaAuthFileActionResponseSchema = z.object({ status: z.literal('ok'), requestId: z.string() })
export const cpaAuthFileModelsResponseSchema = z.object({ models: z.array(z.object({ id: z.string(), displayName: z.string(), ownedBy: z.string().optional(), type: z.string().optional() })), requestId: z.string() })
export const cpaAuthFileSettingsSchema = z.object({ prefix: z.string(), proxyUrl: z.string(), priority: z.number().int().nonnegative().nullable(), weight: z.number().int().nonnegative().nullable(), disableCooling: z.boolean(), websockets: z.boolean(), usingApi: z.boolean(), note: z.string(), excludedModels: z.array(z.string()), headers: z.record(z.string(), z.string()) })
export const cpaAuthFileSettingsResponseSchema = z.object({ settings: cpaAuthFileSettingsSchema, requestId: z.string() })
export const cpaAuthFileDetailSchema = z.object({ infoJson: z.string(), jsonPreview: z.string(), settings: cpaAuthFileSettingsSchema })
export const cpaAuthFileDetailResponseSchema = z.object({ detail: cpaAuthFileDetailSchema, requestId: z.string() })
export const cpaAuthFileQuotaSchema = z.object({ status: z.literal('success'), planType: z.string().nullable(), subscriptionActiveUntil: z.string().datetime().nullable(), windows: z.array(z.object({ id: z.string(), label: z.string(), usedPercent: z.number().min(0).max(100).nullable(), remainingPercent: z.number().min(0).max(100).nullable(), resetAt: z.string().datetime().nullable(), resetAfterSeconds: z.number().nonnegative().nullable() })), creditsAvailable: z.number().int().nonnegative().nullable(), checkedAt: z.string().datetime() })
export const cpaAuthFileQuotaResponseSchema = z.object({ quota: cpaAuthFileQuotaSchema, requestId: z.string() })
export const cpaAuthFileUploadResponseSchema = z.object({ status: z.literal('ok'), fileName: z.string(), format: z.enum(['cpa', 'codex_cli']), converted: z.boolean(), verification: cpaAuthVerificationSchema, requestId: z.string() })
export const cpaVerifyResponseSchema = z.object({ status: z.literal('ok'), verification: cpaAuthVerificationSchema, requestId: z.string() })
export const cpaManagementInputSchema = z.object({ managementBaseUrl: z.string().url().max(512).optional(), managementKey: z.string().min(1).max(2_048).optional() })

export type CpaCredentialInput = z.infer<typeof cpaCredentialInputSchema>
export type CpaCredentialResponse = z.infer<typeof cpaCredentialResponseSchema>
export type CpaOAuthStartResponse = z.infer<typeof cpaOAuthStartResponseSchema>
export type CpaOAuthStatusResponse = z.infer<typeof cpaOAuthStatusResponseSchema>
export type CpaAuthFilesResponse = z.infer<typeof cpaAuthFilesResponseSchema>
export type CpaAuthFile = z.infer<typeof cpaAuthFileSchema>
export type CpaAuthFileModel = z.infer<typeof cpaAuthFileModelsResponseSchema>['models'][number]
export type CpaAuthFileSettings = z.infer<typeof cpaAuthFileSettingsSchema>
export type CpaAuthFileDetail = z.infer<typeof cpaAuthFileDetailSchema>
export type CpaAuthFileQuota = z.infer<typeof cpaAuthFileQuotaSchema>
export type CpaAuthFileUploadResponse = z.infer<typeof cpaAuthFileUploadResponseSchema>
export type CpaAuthVerification = z.infer<typeof cpaAuthVerificationSchema>
export type CpaVerifyResponse = z.infer<typeof cpaVerifyResponseSchema>
export type CpaManagementInput = z.infer<typeof cpaManagementInputSchema>

export class UpstreamsApiError extends Error { constructor(message: string, readonly requestId?: string) { super(message) } }

export async function fetchUpstreams(filters: UpstreamFilters, signal?: AbortSignal): Promise<UpstreamsResponse> {
  const value = upstreamFiltersSchema.parse(filters)
  const response = await fetch(`/api/upstreams?${new URLSearchParams(value)}`, { headers: { accept: 'application/json' }, signal })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw new UpstreamsApiError('上游账号暂时无法加载', requestId)
  const parsed = upstreamsResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new UpstreamsApiError('上游账号格式不符合接口约定', requestId)
  return parsed.data
}

export async function checkUpstream(id: string, payload: UpstreamCheckBody): Promise<UpstreamCheckResponse> {
  const body = upstreamCheckBodySchema.parse(payload)
  const response = await fetch(`/api/upstreams/${encodeURIComponent(id)}/check`, {
    method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(body),
  })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new UpstreamsApiError(detail?.error?.message ?? '验证上游账号失败', requestId)
  }
  const parsed = upstreamCheckResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new UpstreamsApiError('上游验证响应格式不符合接口约定', requestId)
  return parsed.data
}

export async function fetchUpstreamHistory(id: string, signal?: AbortSignal): Promise<UpstreamHistoryResponse> {
  const response = await fetch(`/api/upstreams/${encodeURIComponent(id)}/history`, { headers: { accept: 'application/json' }, signal })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw new UpstreamsApiError('上游认证历史暂时无法加载', requestId)
  const parsed = upstreamHistoryResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new UpstreamsApiError('上游认证历史格式不符合接口约定', requestId)
  return parsed.data
}

export async function configureCpaCredentials(payload: CpaCredentialInput): Promise<CpaCredentialResponse> {
  const body = cpaCredentialInputSchema.parse(payload)
  const response = await fetch('/api/upstreams/cpa/configure', {
    method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(body),
  })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new UpstreamsApiError(detail?.error?.message ?? 'CPA 配置失败', requestId)
  }
  const parsed = cpaCredentialResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new UpstreamsApiError('CPA 配置响应格式不符合接口约定', requestId)
  return parsed.data
}

export async function fetchCpaOAuthUrl(config: CpaManagementInput = {}): Promise<CpaOAuthStartResponse> {
  const body = cpaManagementInputSchema.parse(config)
  const response = await fetch('/api/upstreams/cpa/oauth-url', { method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(body) })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new UpstreamsApiError(detail?.error?.message ?? '无法启动 CPA OAuth 登录', requestId)
  }
  const parsed = cpaOAuthStartResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new UpstreamsApiError('CPA OAuth 响应格式不符合接口约定', requestId)
  return parsed.data
}

export async function fetchCpaOAuthStatus(state: string, config: CpaManagementInput = {}): Promise<CpaOAuthStatusResponse> {
  const body = cpaManagementInputSchema.parse(config)
  const response = await fetch('/api/upstreams/cpa/oauth-status', { method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify({ state, ...body }) })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw new UpstreamsApiError('CPA OAuth 状态暂时无法读取', requestId)
  const parsed = cpaOAuthStatusResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new UpstreamsApiError('CPA OAuth 状态响应格式不符合接口约定', requestId)
  return parsed.data
}

export async function verifyCpaAuth(config: CpaManagementInput = {}, fileName?: string): Promise<CpaVerifyResponse> {
  const management = cpaManagementInputSchema.parse(config)
  const response = await fetch('/api/upstreams/cpa/verify', {
    method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }),
    body: JSON.stringify({ ...management, ...(fileName ? { fileName } : {}) }),
  })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new UpstreamsApiError(detail?.error?.message ?? 'CPA 认证验证失败', requestId)
  }
  const parsed = cpaVerifyResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new UpstreamsApiError('CPA 认证验证响应格式不符合接口约定', requestId)
  return parsed.data
}

function fileToBase64(file: File) {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    const chunk = 0x8000
    for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
    return btoa(binary)
  })
}

export async function uploadCpaAuthFile(file: File, config: CpaManagementInput = {}): Promise<CpaAuthFileUploadResponse> {
  if (!/^.+\.json$/i.test(file.name)) throw new UpstreamsApiError('请选择 CPA 的 JSON 认证文件')
  if (file.size <= 0 || file.size > 2_000_000) throw new UpstreamsApiError('认证文件必须是 2 MB 以内的 JSON 文件')
  const management = cpaManagementInputSchema.parse(config)
  const body = { fileName: file.name, contentBase64: await fileToBase64(file), ...management }
  const response = await fetch('/api/upstreams/cpa/auth-files', {
    method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(body),
  })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new UpstreamsApiError(detail?.error?.message ?? 'CPA 认证文件导入失败', requestId)
  }
  const parsed = cpaAuthFileUploadResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new UpstreamsApiError('CPA 认证文件响应格式不符合接口约定', requestId)
  return parsed.data
}

export async function fetchCpaAuthFiles(): Promise<CpaAuthFilesResponse> {
  const response = await fetch('/api/upstreams/cpa/auth-files', { headers: { accept: 'application/json' } })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw new UpstreamsApiError('CPA 认证文件列表暂时无法读取', requestId)
  const parsed = cpaAuthFilesResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new UpstreamsApiError('CPA 认证文件列表格式不符合接口约定', requestId)
  return parsed.data
}

function cpaAuthFileError(response: Response, fallback: string, requestId?: string) {
  return response.json().catch(() => null).then((detail) => {
    const message = (detail as { error?: { message?: string } } | null)?.error?.message
    return new UpstreamsApiError(message ?? fallback, requestId)
  })
}

export async function fetchCpaAuthFileModels(name: string): Promise<{ models: CpaAuthFileModel[]; requestId: string }> {
  const response = await fetch(`/api/upstreams/cpa/auth-files/models?${new URLSearchParams({ name })}`, { headers: { accept: 'application/json' } })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw await cpaAuthFileError(response, 'CPA 模型列表暂时无法读取', requestId)
  const parsed = cpaAuthFileModelsResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new UpstreamsApiError('CPA 模型列表格式不符合接口约定', requestId)
  return parsed.data
}

export async function fetchCpaAuthFileSettings(name: string): Promise<{ settings: CpaAuthFileSettings; requestId: string }> {
  const response = await fetch(`/api/upstreams/cpa/auth-files/settings?${new URLSearchParams({ name })}`, { headers: { accept: 'application/json' } })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw await cpaAuthFileError(response, 'CPA 认证文件设置暂时无法读取', requestId)
  const parsed = cpaAuthFileSettingsResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new UpstreamsApiError('CPA 认证文件设置格式不符合接口约定', requestId)
  return parsed.data
}

export async function fetchCpaAuthFileDetail(name: string): Promise<{ detail: CpaAuthFileDetail; requestId: string }> {
  const response = await fetch(`/api/upstreams/cpa/auth-files/detail?${new URLSearchParams({ name })}`, { headers: { accept: 'application/json' } })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw await cpaAuthFileError(response, 'CPA 认证文件详情暂时无法读取', requestId)
  const parsed = cpaAuthFileDetailResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new UpstreamsApiError('CPA 认证文件详情格式不符合接口约定', requestId)
  return parsed.data
}

export async function fetchCpaAuthFileQuota(name: string): Promise<{ quota: CpaAuthFileQuota; requestId: string }> {
  const response = await fetch('/api/upstreams/cpa/auth-files/quota', { method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify({ name }) })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw await cpaAuthFileError(response, 'CPA 额度暂时无法读取', requestId)
  const parsed = cpaAuthFileQuotaResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new UpstreamsApiError('CPA 额度响应格式不符合接口约定', requestId)
  return parsed.data
}

export async function setCpaAuthFileStatus(name: string, disabled: boolean): Promise<void> {
  const response = await fetch('/api/upstreams/cpa/auth-files/status', { method: 'PATCH', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify({ name, disabled }) })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw await cpaAuthFileError(response, 'CPA 账号启用状态暂时无法更新', requestId)
  const parsed = cpaAuthFileActionResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new UpstreamsApiError('CPA 账号启用响应格式不符合接口约定', requestId)
}

export async function requestCpaAuthFileRefresh(name: string): Promise<void> {
  const response = await fetch('/api/upstreams/cpa/auth-files/refresh', { method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify({ name }) })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw await cpaAuthFileError(response, 'CPA OAuth 凭证刷新暂时无法执行', requestId)
  const parsed = cpaAuthFileActionResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new UpstreamsApiError('CPA OAuth 刷新响应格式不符合接口约定', requestId)
}

export async function updateCpaAuthFileSettings(name: string, settings: Partial<CpaAuthFileSettings>): Promise<void> {
  const response = await fetch('/api/upstreams/cpa/auth-files/settings', { method: 'PATCH', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify({ name, ...settings }) })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw await cpaAuthFileError(response, 'CPA 认证文件设置暂时无法保存', requestId)
  const parsed = cpaAuthFileActionResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new UpstreamsApiError('CPA 认证文件设置响应格式不符合接口约定', requestId)
}

export async function deleteCpaAuthFile(name: string): Promise<void> {
  const response = await fetch('/api/upstreams/cpa/auth-files', { method: 'DELETE', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify({ name }) })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw await cpaAuthFileError(response, 'CPA 认证文件暂时无法删除', requestId)
  const parsed = cpaAuthFileActionResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new UpstreamsApiError('CPA 认证文件删除响应格式不符合接口约定', requestId)
}

export async function downloadCpaAuthFile(name: string): Promise<Blob> {
  const response = await fetch(`/api/upstreams/cpa/auth-files/download?${new URLSearchParams({ name })}`, { headers: { accept: 'application/json' } })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw await cpaAuthFileError(response, 'CPA 认证文件暂时无法下载', requestId)
  return response.blob()
}
