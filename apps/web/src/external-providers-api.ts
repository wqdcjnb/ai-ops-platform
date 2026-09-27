import { z } from 'zod'
import { withCsrfHeader } from './csrf'

export const externalProviderModelSchema = z.object({ id: z.string(), upstreamId: z.string() })
export const externalProviderSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  name: z.string(),
  baseUrl: z.string().url(),
  host: z.string(),
  enabled: z.boolean(),
  credentialConfigured: z.boolean(),
  models: z.array(externalProviderModelSchema),
  health: z.enum(['healthy', 'unknown', 'error']),
  lastCheckedAt: z.string().datetime().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  lastSyncedAt: z.string().datetime().nullable(),
  lastSyncError: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const externalProviderInputSchema = z.object({
  id: z.string().trim().regex(/^[a-z][a-z0-9-]{0,31}$/).optional(),
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().trim().url().max(512),
  apiKey: z.string().trim().min(1).max(2_048).optional(),
  modelIds: z.array(z.string().trim().min(1).max(160)).max(500).optional().default([]),
  enabled: z.boolean(),
})

export const externalProviderPresetSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  name: z.string(),
  baseUrl: z.string().url(),
  host: z.string(),
  description: z.string(),
})

export const externalProvidersResponseSchema = z.object({
  meta: z.object({ source: z.literal('runtime'), generatedAt: z.string().datetime(), notice: z.string() }),
  items: z.array(externalProviderSchema),
  requestId: z.string(),
})

export const externalProviderPresetsResponseSchema = z.object({
  meta: z.object({ source: z.literal('built_in'), generatedAt: z.string().datetime(), notice: z.string() }),
  items: z.array(externalProviderPresetSchema),
  requestId: z.string(),
})

export type ExternalProvider = z.infer<typeof externalProviderSchema>
export type ExternalProviderInput = z.infer<typeof externalProviderInputSchema>
export type ExternalProviderPreset = z.infer<typeof externalProviderPresetSchema>
export type ExternalProvidersResponse = z.infer<typeof externalProvidersResponseSchema>
export type ExternalProviderPresetsResponse = z.infer<typeof externalProviderPresetsResponseSchema>

export const externalProviderDiscoveryResponseSchema = z.object({
  models: z.array(z.string()),
  latencyMs: z.number().int().nonnegative(),
  requestId: z.string(),
})

export const externalProviderModelTestSchema = z.object({
  id: z.string(),
  status: z.enum(['available', 'catalog_confirmed', 'unavailable']),
  latencyMs: z.number().int().nonnegative().nullable(),
  message: z.string(),
})

export const externalProviderModelTestResponseSchema = z.object({
  catalogLatencyMs: z.number().int().nonnegative(),
  results: z.array(externalProviderModelTestSchema),
  requestId: z.string(),
})

export type ExternalProviderDiscoveryResponse = z.infer<typeof externalProviderDiscoveryResponseSchema>
export type ExternalProviderModelTest = z.infer<typeof externalProviderModelTestSchema>
export type ExternalProviderModelTestResponse = z.infer<typeof externalProviderModelTestResponseSchema>

export class ExternalProvidersApiError extends Error {
  constructor(message: string, readonly requestId?: string) {
    super(message)
    this.name = 'ExternalProvidersApiError'
  }
}

async function errorFrom(response: Response, fallback: string, requestId?: string) {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null
  return new ExternalProvidersApiError(body?.error?.message ?? fallback, requestId)
}

export async function fetchExternalProviders(signal?: AbortSignal): Promise<ExternalProvidersResponse> {
  const response = await fetch('/api/external-providers', { headers: { accept: 'application/json' }, signal })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw await errorFrom(response, '第三方模型供应商暂时无法加载', requestId)
  const parsed = externalProvidersResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new ExternalProvidersApiError('第三方模型供应商响应格式不符合接口约定', requestId)
  return parsed.data
}

export async function fetchExternalProviderPresets(signal?: AbortSignal): Promise<ExternalProviderPresetsResponse> {
  const response = await fetch('/api/external-providers/presets', { headers: { accept: 'application/json' }, signal })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw await errorFrom(response, '第三方模型预设暂时无法加载', requestId)
  const parsed = externalProviderPresetsResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new ExternalProvidersApiError('第三方模型预设响应格式不符合接口约定', requestId)
  return parsed.data
}

export async function discoverExternalProviderModels(input: Pick<ExternalProviderInput, 'baseUrl' | 'apiKey'>) {
  const body = z.object({ baseUrl: z.string().trim().url().max(512), apiKey: z.string().trim().min(1).max(2_048) }).parse(input)
  const response = await fetch('/api/external-providers/discover', {
    method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(body),
  })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw await errorFrom(response, '无法读取第三方模型目录', requestId)
  const parsed = externalProviderDiscoveryResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new ExternalProvidersApiError('第三方模型目录响应格式不符合接口约定', requestId)
  return parsed.data
}

export async function testExternalProviderModels(input: Pick<ExternalProviderInput, 'baseUrl' | 'apiKey'> & { modelIds: string[] }) {
  const body = z.object({
    baseUrl: z.string().trim().url().max(512),
    apiKey: z.string().trim().min(1).max(2_048),
    modelIds: z.array(z.string().trim().min(1).max(160)).min(1).max(500),
  }).parse(input)
  const response = await fetch('/api/external-providers/test', {
    method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(body),
  })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw await errorFrom(response, '无法完成第三方模型测试', requestId)
  const parsed = externalProviderModelTestResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new ExternalProvidersApiError('第三方模型测试响应格式不符合接口约定', requestId)
  return parsed.data
}

export async function saveExternalProvider(input: ExternalProviderInput) {
  const body = externalProviderInputSchema.parse(input)
  const response = await fetch('/api/external-providers', {
    method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify(body),
  })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw await errorFrom(response, '无法保存第三方模型供应商', requestId)
  const parsed = z.object({ provider: externalProviderSchema, requestId: z.string() }).safeParse(await response.json())
  if (!parsed.success) throw new ExternalProvidersApiError('保存第三方模型供应商的响应格式不符合接口约定', requestId)
  return parsed.data
}

export async function setExternalProviderEnabled(id: string, enabled: boolean) {
  const response = await fetch(`/api/external-providers/${encodeURIComponent(id)}/enabled`, {
    method: 'PATCH', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify({ enabled }),
  })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw await errorFrom(response, '无法更新供应商启用状态', requestId)
  const parsed = z.object({ provider: externalProviderSchema, requestId: z.string() }).safeParse(await response.json())
  if (!parsed.success) throw new ExternalProvidersApiError('供应商启用状态响应格式不符合接口约定', requestId)
  return parsed.data
}

export async function deleteExternalProvider(id: string) {
  const response = await fetch(`/api/external-providers/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: withCsrfHeader({ accept: 'application/json' }),
  })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw await errorFrom(response, '无法删除第三方模型供应商', requestId)
  const parsed = z.object({ status: z.literal('ok'), requestId: z.string() }).safeParse(await response.json())
  if (!parsed.success) throw new ExternalProvidersApiError('删除第三方模型供应商的响应格式不符合接口约定', requestId)
  return parsed.data
}

export async function syncExternalProviderModels(id: string) {
  const response = await fetch(`/api/external-providers/${encodeURIComponent(id)}/sync`, {
    method: 'POST', headers: withCsrfHeader({ accept: 'application/json' }),
  })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw await errorFrom(response, '无法同步中转站模型目录', requestId)
  const parsed = z.object({ provider: externalProviderSchema, requestId: z.string() }).safeParse(await response.json())
  if (!parsed.success) throw new ExternalProvidersApiError('模型同步响应格式不符合接口约定', requestId)
  return parsed.data
}

export async function checkExternalProviderHealth(id: string) {
  const response = await fetch(`/api/external-providers/${encodeURIComponent(id)}/health`, {
    method: 'POST', headers: withCsrfHeader({ accept: 'application/json' }),
  })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw await errorFrom(response, '无法检查中转站健康状态', requestId)
  const parsed = z.object({ provider: externalProviderSchema, requestId: z.string() }).safeParse(await response.json())
  if (!parsed.success) throw new ExternalProvidersApiError('中转站健康检查响应格式不符合接口约定', requestId)
  return parsed.data
}
