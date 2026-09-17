import { z } from 'zod'

const managementStateSchema = z.enum(['not_configured', 'ready', 'auth_required', 'unavailable'])
export type NewApiManagementState = z.infer<typeof managementStateSchema>

export const newApiManagementResponseSchema = z.object({
  state: managementStateSchema,
  authConfigured: z.boolean(),
  checkedAt: z.string().datetime(),
  capabilities: z.object({ models: z.enum(['available', 'unverified', 'unavailable']), channels: z.enum(['available', 'unverified', 'unavailable']) }),
  notice: z.string(),
})
export type NewApiManagementResponse = z.infer<typeof newApiManagementResponseSchema>

export interface NewApiManagementOptions {
  baseUrl?: string
  accessToken?: string
  userId?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  now?: () => Date
}

interface ManagementEnvelope {
  success?: boolean
  message?: string
  data?: unknown
}

export interface NewApiManagementResult<T> {
  state: Exclude<NewApiManagementState, 'not_configured'>
  statusCode: number
  data: T | null
  message: string | null
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('NEW_API_BASE_URL must use HTTP or HTTPS')
  return url.toString().replace(/\/$/, '')
}

function envelope(value: unknown): ManagementEnvelope {
  if (!value || typeof value !== 'object') return {}
  const record = value as Record<string, unknown>
  return {
    success: typeof record.success === 'boolean' ? record.success : undefined,
    message: typeof record.message === 'string' ? record.message : undefined,
    data: record.data,
  }
}

export class NewApiManagementClient {
  private readonly baseUrl: string
  private readonly accessToken: string
  private readonly userId: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: NewApiManagementOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? 'http://127.0.0.1:3000')
    this.accessToken = options.accessToken?.trim() ?? ''
    this.userId = options.userId?.trim() ?? ''
    this.timeoutMs = options.timeoutMs ?? 2_000
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  get authConfigured() { return Boolean(this.accessToken) }

  private async get<T>(path: string): Promise<NewApiManagementResult<T>> {
    if (!this.accessToken) return { state: 'auth_required', statusCode: 401, data: null, message: '管理凭据未配置' }
    try {
      const headers: Record<string, string> = { accept: 'application/json', authorization: `Bearer ${this.accessToken}` }
      if (this.userId) headers['New-Api-User'] = this.userId
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, { headers, signal: AbortSignal.timeout(this.timeoutMs) })
      let body: unknown = null
      try { body = await response.json() } catch { body = null }
      const parsed = envelope(body)
      if (response.status === 401 || response.status === 403) return { state: 'auth_required', statusCode: response.status, data: null, message: parsed.message ?? '管理凭据未通过验证' }
      if (!response.ok || parsed.success !== true || parsed.data === undefined || parsed.data === null) return { state: 'unavailable', statusCode: response.status, data: null, message: 'New API 管理接口返回失败或无效数据' }
      return { state: 'ready', statusCode: response.status, data: (parsed.data ?? body) as T, message: parsed.message ?? null }
    } catch {
      return { state: 'unavailable', statusCode: 0, data: null, message: 'New API 管理接口当前不可达' }
    }
  }

  getModelMetadata(page?: number, pageSize = 100) { return this.get<unknown>(page === undefined ? '/api/models/' : `/api/models/?p=${page}&page_size=${pageSize}`) }
  getChannels(page = 1, pageSize = 100) { return this.get<unknown>(`/api/channel/?p=${page}&page_size=${pageSize}&id_sort=false&tag_mode=false&status=all`) }
  getChannelModels() { return this.get<unknown>('/api/channel/models') }
}

export function createNewApiManagementClient(options: NewApiManagementOptions = {}) {
  return new NewApiManagementClient(options)
}

export async function probeNewApiManagement(options: NewApiManagementOptions = {}): Promise<NewApiManagementResponse> {
  const now = (options.now?.() ?? new Date()).toISOString()
  const authConfigured = Boolean(options.accessToken?.trim())
  let client: NewApiManagementClient
  try {
    client = createNewApiManagementClient(options)
  } catch {
    return { state: 'unavailable', authConfigured, checkedAt: now, capabilities: { models: 'unavailable', channels: 'unavailable' }, notice: 'New API 管理地址配置无效，未发起管理请求。' }
  }
  if (!client.authConfigured) {
    return { state: 'not_configured', authConfigured: false, checkedAt: now, capabilities: { models: 'unavailable', channels: 'unavailable' }, notice: 'New API 服务可继续探测，但管理凭据尚未配置。' }
  }
  const [models, channels] = await Promise.all([client.getModelMetadata(), client.getChannels()])
  const authRequired = models.state === 'auth_required' || channels.state === 'auth_required'
  const anyReady = models.state === 'ready' || channels.state === 'ready'
  return {
    state: authRequired ? 'auth_required' : anyReady ? 'ready' : 'unavailable',
    authConfigured: true,
    checkedAt: now,
    capabilities: { models: models.state === 'ready' ? 'available' : models.state === 'auth_required' ? 'unavailable' : 'unavailable', channels: channels.state === 'ready' ? 'available' : channels.state === 'auth_required' ? 'unavailable' : 'unavailable' },
    notice: authRequired ? 'New API 管理凭据验证失败，模型和渠道数据未进入页面。' : anyReady ? 'New API 管理接口已响应，字段适配仍需逐项验收。' : 'New API 管理接口当前不可达。',
  }
}

export function probeNewApiManagementFromEnvironment() {
  return probeNewApiManagement({ baseUrl: process.env.NEW_API_BASE_URL, accessToken: process.env.NEW_API_ACCESS_TOKEN, userId: process.env.NEW_API_USER_ID })
}
