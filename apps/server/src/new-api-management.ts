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

const newApiUserValueSchema = z.union([z.string(), z.number(), z.boolean()]).nullable().optional()
const newApiUserWireSchema = z.object({
  id: z.union([z.string(), z.number()]),
  username: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  status: newApiUserValueSchema,
  group: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  department_name: z.string().nullable().optional(),
  role: newApiUserValueSchema,
  role_name: z.string().nullable().optional(),
  is_admin: z.boolean().nullable().optional(),
  created_at: z.union([z.string(), z.number()]).nullable().optional(),
  last_login_at: z.union([z.string(), z.number()]).nullable().optional(),
}).passthrough()

const newApiUserPageSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().optional(),
  total: z.coerce.number().int().nonnegative().optional(),
  items: z.array(newApiUserWireSchema),
})

const newApiChannelValueSchema = z.union([z.string(), z.number(), z.boolean()]).nullable().optional()
const newApiChannelWireSchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string().nullable().optional(),
  type: newApiChannelValueSchema,
  status: newApiChannelValueSchema,
  base_url: z.string().nullable().optional(),
  models: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  group: z.string().nullable().optional(),
  tag: z.string().nullable().optional(),
  created_at: z.union([z.string(), z.number()]).nullable().optional(),
  updated_at: z.union([z.string(), z.number()]).nullable().optional(),
  test_model: z.string().nullable().optional(),
  test_time: z.union([z.string(), z.number()]).nullable().optional(),
  response_time: z.union([z.string(), z.number()]).nullable().optional(),
  settings: z.union([z.string(), z.record(z.string(), z.unknown())]).nullable().optional(),
  setting: z.union([z.string(), z.record(z.string(), z.unknown())]).nullable().optional(),
  key: z.string().nullable().optional(),
}).passthrough()

const newApiChannelPageSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().optional(),
  total: z.coerce.number().int().nonnegative().optional(),
  items: z.array(newApiChannelWireSchema),
})

export type NewApiUserStatusValue = string | number | boolean | null

export interface NewApiUser {
  id: string
  username: string | null
  displayName: string | null
  status: NewApiUserStatusValue
  group: string | null
  department: string | null
  departmentName: string | null
  role: NewApiUserStatusValue
  roleName: string | null
  isAdmin: boolean | null
  createdAt: string | number | null
  lastLoginAt: string | number | null
}

export interface NewApiUserPage {
  page: number
  pageSize: number
  total: number
  items: NewApiUser[]
}

export interface NewApiUserReader {
  listUsers(page?: number, pageSize?: number): Promise<NewApiManagementResult<NewApiUserPage>>
  getUser(id: string | number): Promise<NewApiManagementResult<NewApiUser>>
}

export interface NewApiChannel {
  id: string
  name: string
  type: string | number | boolean | null
  status: string | number | boolean | null
  baseUrl: string
  models: string[]
  group: string | null
  marker: string | null
  enabled: boolean | null
  keyConfigured: boolean | null
  createdAt: string | number | null
  updatedAt: string | number | null
  testModel: string | null
  testTime: string | number | null
  responseTimeMs: number | null
  advancedRoutes: NewApiAdvancedRoute[]
}

export interface NewApiAdvancedRoute {
  incomingPath: string
  upstreamPath: string
  converter: string | null
}

export interface NewApiChannelTestResult {
  success: boolean
  message: string | null
  latencyMs: number | null
}

export interface NewApiChannelPage {
  page: number
  pageSize: number
  total: number
  items: NewApiChannel[]
}

export interface NewApiChannelWriteInput {
  name: string
  type: string | number
  key: string
  baseUrl: string
  models: string[]
  group?: string
  priority?: number
  weight?: number
  status?: 0 | 1
  tag?: string
}

export type NewApiChannelStatus = 0 | 1

function channelModels(value: string | string[] | null | undefined) {
  const values = Array.isArray(value) ? value : (value ?? '').split(',')
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))]
}

function channelEnabled(value: string | number | boolean | null | undefined) {
  if (value === true || value === 1 || value === '1' || value === 'active' || value === 'enabled') return true
  if (value === false || value === 0 || value === '0' || value === 'inactive' || value === 'disabled') return false
  return null
}

function finiteNumber(value: unknown) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(number) ? number : null
}

function advancedRoutes(value: unknown): NewApiAdvancedRoute[] {
  let settings: unknown = value
  if (typeof settings === 'string') {
    try { settings = JSON.parse(settings) } catch { return [] }
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return []
  const advanced = (settings as Record<string, unknown>).advanced_custom
  if (!advanced || typeof advanced !== 'object' || Array.isArray(advanced)) return []
  const routes = (advanced as Record<string, unknown>).advanced_routes
  if (!Array.isArray(routes)) return []
  return routes.flatMap((route) => {
    if (!route || typeof route !== 'object' || Array.isArray(route)) return []
    const item = route as Record<string, unknown>
    const incomingPath = typeof item.incoming_path === 'string' ? item.incoming_path.trim() : ''
    const upstreamPath = typeof item.upstream_path === 'string' ? item.upstream_path.trim() : ''
    if (!incomingPath || !upstreamPath || incomingPath.length > 256 || upstreamPath.length > 256) return []
    const converter = typeof item.converter === 'string' ? item.converter.trim() : null
    return [{ incomingPath, upstreamPath, converter: converter || null }]
  })
}

export function normalizeNewApiChannel(value: z.infer<typeof newApiChannelWireSchema>): NewApiChannel {
  const key = value.key?.trim()
  const settings = value.settings ?? value.setting
  return {
    id: String(value.id),
    name: value.name?.trim() ?? '',
    type: typeof value.type === 'boolean' ? String(value.type) : value.type ?? null,
    status: value.status ?? null,
    baseUrl: value.base_url?.trim().replace(/\/$/, '') ?? '',
    models: channelModels(value.models),
    group: value.group?.trim() || null,
    marker: value.tag?.trim() || null,
    enabled: channelEnabled(value.status),
    keyConfigured: value.key === undefined || value.key === null ? null : Boolean(key),
    createdAt: value.created_at ?? null,
    updatedAt: value.updated_at ?? null,
    testModel: value.test_model?.trim() || null,
    testTime: value.test_time ?? null,
    responseTimeMs: finiteNumber(value.response_time),
    advancedRoutes: advancedRoutes(settings),
  }
}

export interface NewApiUserCreateInput {
  username: string
  displayName: string
  password: string
}

export type NewApiUserManagementAction = 'enable' | 'disable' | 'delete'

function mapNewApiUser(value: z.infer<typeof newApiUserWireSchema>): NewApiUser {
  return {
    id: String(value.id),
    username: value.username?.trim() || null,
    displayName: value.display_name?.trim() || null,
    status: value.status ?? null,
    group: value.group?.trim() || null,
    department: value.department?.trim() || null,
    departmentName: value.department_name?.trim() || null,
    role: value.role ?? null,
    roleName: value.role_name?.trim() || null,
    isAdmin: value.is_admin ?? null,
    createdAt: value.created_at ?? null,
    lastLoginAt: value.last_login_at ?? null,
  }
}

export interface NewApiManagementResult<T> {
  state: Exclude<NewApiManagementState, 'not_configured'>
  statusCode: number
  data: T | null
  message: string | null
}

export interface NewApiTokenCreateInput {
  user_id: string
  name: string
  expired_time: -1
  remain_quota: 0
  unlimited_quota: true
  model_limits_enabled: true
  model_limits: string
  group?: ''
  status?: 1
}

export interface NewApiTokenReader {
  listTokens(page?: number, pageSize?: number, userId?: string): Promise<NewApiManagementResult<unknown>>
  getToken(id: string, userId?: string): Promise<NewApiManagementResult<unknown>>
}

export interface NewApiTokenClient extends NewApiTokenReader {
  readonly authConfigured: boolean
  createToken(input: NewApiTokenCreateInput): Promise<NewApiManagementResult<unknown>>
  getTokenKey?(id: string, userId?: string): Promise<NewApiManagementResult<unknown>>
  updateTokenStatus(id: string, status: 0 | 1, userId?: string): Promise<NewApiManagementResult<unknown>>
  deleteToken?(id: string, userId?: string): Promise<NewApiManagementResult<unknown>>
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

function safeManagementMessage(value: string | undefined) {
  const message = value?.trim().replace(/\s+/g, ' ')
  if (!message || message.length > 240) return null
  if (/private|secret|credential|authorization|bearer|password|api[_ -]?key|sk-[A-Za-z0-9_-]{8,}/i.test(message)) return null
  return message
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

  private async request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, requestBody?: unknown, allowEmptyData = false, userIdOverride?: string, allowUnsuccessfulResponse = false, timeoutMs = this.timeoutMs): Promise<NewApiManagementResult<T>> {
    if (!this.accessToken) return { state: 'auth_required', statusCode: 401, data: null, message: '管理凭据未配置' }
    try {
      const headers: Record<string, string> = { accept: 'application/json', authorization: `Bearer ${this.accessToken}` }
      const effectiveUserId = userIdOverride?.trim() || this.userId
      if (effectiveUserId) headers['New-Api-User'] = effectiveUserId
      if (requestBody !== undefined) headers['content-type'] = 'application/json'
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        ...(requestBody === undefined ? {} : { body: JSON.stringify(requestBody) }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      let responseBody: unknown = null
      try { responseBody = await response.json() } catch { responseBody = null }
      const parsed = envelope(responseBody)
      const upstreamMessage = safeManagementMessage(parsed.message)
      if (response.status === 401 || response.status === 403) return { state: 'auth_required', statusCode: response.status, data: null, message: upstreamMessage ?? '管理凭据未通过验证' }
      if (!response.ok || (!allowUnsuccessfulResponse && parsed.success !== true) || (!allowEmptyData && (parsed.data === undefined || parsed.data === null))) return { state: 'unavailable', statusCode: response.status, data: null, message: upstreamMessage ?? 'New API 管理接口返回失败或无效数据' }
      return { state: 'ready', statusCode: response.status, data: (parsed.data ?? responseBody) as T, message: parsed.message ?? null }
    } catch {
      return { state: 'unavailable', statusCode: 0, data: null, message: 'New API 管理接口当前不可达' }
    }
  }

  private get<T>(path: string, userIdOverride?: string) { return this.request<T>('GET', path, undefined, false, userIdOverride) }

  getModelMetadata(page?: number, pageSize = 100) { return this.get<unknown>(page === undefined ? '/api/models/' : `/api/models/?p=${page}&page_size=${pageSize}`) }
  getChannels(page = 1, pageSize = 100) { return this.get<unknown>(`/api/channel/?p=${page}&page_size=${pageSize}&id_sort=false&tag_mode=false&status=all`) }
  getChannelModels() { return this.get<unknown>('/api/channel/models') }

  async listChannels(page = 1, pageSize = 100): Promise<NewApiManagementResult<NewApiChannelPage>> {
    const result = await this.getChannels(page, pageSize)
    if (result.state !== 'ready' || result.data === null) return { state: result.state, statusCode: result.statusCode, data: null, message: result.message }
    const parsed = newApiChannelPageSchema.safeParse(result.data)
    if (!parsed.success) return { state: 'unavailable', statusCode: result.statusCode, data: null, message: 'New API 渠道列表响应格式不符合接口约定' }
    return {
      ...result,
      data: {
        page: parsed.data.page ?? page,
        pageSize: parsed.data.page_size ?? pageSize,
        total: parsed.data.total ?? parsed.data.items.length,
        items: parsed.data.items.map(normalizeNewApiChannel),
      },
    }
  }

  async getChannel(id: string | number): Promise<NewApiManagementResult<NewApiChannel | null>> {
    const result = await this.request<unknown>('GET', `/api/channel/${encodeURIComponent(String(id))}`)
    if (result.state !== 'ready' || result.data === null) return { state: result.state, statusCode: result.statusCode, data: null, message: result.message }
    const parsed = newApiChannelWireSchema.safeParse(result.data)
    if (!parsed.success) return { state: 'unavailable', statusCode: result.statusCode, data: null, message: 'New API 渠道详情响应格式不符合接口约定' }
    return { ...result, data: normalizeNewApiChannel(parsed.data) }
  }

  /**
   * Runs New API's own channel probe. The probe is intentionally kept behind
   * the server-side management client so the browser never receives the
   * management token or the upstream channel key.
   */
  async testChannel(id: string | number, model?: string): Promise<NewApiManagementResult<NewApiChannelTestResult>> {
    const query = model?.trim() ? `?model=${encodeURIComponent(model.trim())}` : ''
    const result = await this.request<unknown>('GET', `/api/channel/test/${encodeURIComponent(String(id))}${query}`, undefined, true, undefined, true, Math.max(this.timeoutMs, 60_000))
    if (result.state !== 'ready' || result.data === null) return { state: result.state, statusCode: result.statusCode, data: null, message: result.message }
    const record = result.data && typeof result.data === 'object' && !Array.isArray(result.data) ? result.data as Record<string, unknown> : {}
    const success = record.success === true
    const message = typeof record.message === 'string' ? safeManagementMessage(record.message) : null
    const latencyMs = finiteNumber(record.time)
    return { ...result, data: { success, message, latencyMs: latencyMs === null ? null : Math.max(0, Math.round(latencyMs * 1_000)) } }
  }

  private channelPayload(input: NewApiChannelWriteInput) {
    return {
      name: input.name,
      type: input.type,
      key: input.key,
      base_url: input.baseUrl,
      models: input.models.join(','),
      group: input.group ?? 'default',
      priority: input.priority ?? 10,
      weight: input.weight ?? 100,
      status: input.status ?? 1,
      ...(input.tag ? { tag: input.tag } : {}),
    }
  }

  async createChannel(input: NewApiChannelWriteInput): Promise<NewApiManagementResult<NewApiChannel | null>> {
    const result = await this.request<unknown>('POST', '/api/channel/', { mode: 'single', channel: this.channelPayload(input) }, true)
    if (result.state !== 'ready') return { state: result.state, statusCode: result.statusCode, data: null, message: result.message }
    const parsed = newApiChannelWireSchema.safeParse(result.data)
    return { ...result, data: parsed.success ? normalizeNewApiChannel(parsed.data) : null }
  }

  async updateChannel(id: string | number, input: NewApiChannelWriteInput): Promise<NewApiManagementResult<NewApiChannel | null>> {
    const normalizedId = Number.isSafeInteger(Number(id)) ? Number(id) : id
    const result = await this.request<unknown>('PUT', '/api/channel/', { id: normalizedId, ...this.channelPayload(input) }, true)
    if (result.state !== 'ready') return { state: result.state, statusCode: result.statusCode, data: null, message: result.message }
    const parsed = newApiChannelWireSchema.safeParse(result.data)
    return { ...result, data: parsed.success ? normalizeNewApiChannel(parsed.data) : null }
  }

  updateChannelStatus(id: string | number, status: NewApiChannelStatus) {
    const normalizedId = String(id)
    return this.request<unknown>('POST', `/api/channel/${encodeURIComponent(normalizedId)}/status`, { status }, true)
  }

  async listUsers(page = 1, pageSize = 100): Promise<NewApiManagementResult<NewApiUserPage>> {
    const result = await this.get<unknown>(`/api/user/?p=${page}&page_size=${pageSize}`)
    if (result.state !== 'ready' || result.data === null) return { state: result.state, statusCode: result.statusCode, data: null, message: result.message }
    const parsed = newApiUserPageSchema.safeParse(result.data)
    if (!parsed.success) return { state: 'unavailable', statusCode: result.statusCode, data: null, message: 'New API 用户列表响应格式不符合接口约定' }
    return {
      ...result,
      data: {
        page: parsed.data.page ?? page,
        pageSize: parsed.data.page_size ?? pageSize,
        total: parsed.data.total ?? parsed.data.items.length,
        items: parsed.data.items.map(mapNewApiUser),
      },
    }
  }

  async getUser(id: string | number): Promise<NewApiManagementResult<NewApiUser>> {
    const result = await this.get<unknown>(`/api/user/${encodeURIComponent(String(id))}`)
    if (result.state !== 'ready' || result.data === null) return { state: result.state, statusCode: result.statusCode, data: null, message: result.message }
    const parsed = newApiUserWireSchema.safeParse(result.data)
    if (!parsed.success) return { state: 'unavailable', statusCode: result.statusCode, data: null, message: 'New API 用户详情响应格式不符合接口约定' }
    return { ...result, data: mapNewApiUser(parsed.data) }
  }

  async getSelfUser(): Promise<NewApiManagementResult<NewApiUser>> {
    const result = await this.get<unknown>('/api/user/self')
    if (result.state !== 'ready' || result.data === null) return { state: result.state, statusCode: result.statusCode, data: null, message: result.message }
    const parsed = newApiUserWireSchema.safeParse(result.data)
    if (!parsed.success) return { state: 'unavailable', statusCode: result.statusCode, data: null, message: 'New API 当前用户响应格式不符合接口约定' }
    return { ...result, data: mapNewApiUser(parsed.data) }
  }

  async findUserByUsername(username: string): Promise<NewApiManagementResult<NewApiUser | null>> {
    const normalizedUsername = username.trim()
    if (!normalizedUsername) return { state: 'unavailable', statusCode: 400, data: null, message: 'New API 用户名不能为空' }
    for (let page = 1; page <= 100; page += 1) {
      const result = await this.listUsers(page, 100)
      if (result.state !== 'ready' || !result.data) return { state: result.state, statusCode: result.statusCode, data: null, message: result.message }
      const found = result.data.items.find((user) => user.username?.trim() === normalizedUsername)
      if (found) return { ...result, data: found }
      if (!result.data.items.length || result.data.items.length < result.data.pageSize || page * result.data.pageSize >= result.data.total) break
    }
    return { state: 'ready', statusCode: 200, data: null, message: null }
  }

  async createUser(input: NewApiUserCreateInput): Promise<NewApiManagementResult<NewApiUser | null>> {
    const result = await this.request<unknown>('POST', '/api/user/', {
      username: input.username,
      role: 1,
      display_name: input.displayName,
      password: input.password,
    }, true)
    if (result.state !== 'ready') return { state: result.state, statusCode: result.statusCode, data: null, message: result.message }
    const parsed = newApiUserWireSchema.safeParse(result.data)
    return { ...result, data: parsed.success ? mapNewApiUser(parsed.data) : null }
  }

  manageUser(id: string | number, action: NewApiUserManagementAction) {
    const normalizedId = Number.isSafeInteger(Number(id)) ? Number(id) : id
    return this.request<unknown>('POST', '/api/user/manage', { id: normalizedId, action }, true)
  }

  enableUser(id: string | number) {
    return this.manageUser(id, 'enable')
  }

  disableUser(id: string | number) {
    return this.manageUser(id, 'disable')
  }

  deleteUser(id: string | number) {
    return this.manageUser(id, 'delete')
  }

  listTokens(page = 1, pageSize = 100, userId?: string) {
    return this.get<unknown>(`/api/token/?p=${page}&size=${pageSize}`, userId)
  }

  getToken(id: string, userId?: string) {
    return this.get<unknown>(`/api/token/${encodeURIComponent(id)}`, userId)
  }

  createToken(input: NewApiTokenCreateInput) {
    const { user_id: userId, ...payload } = input
    return this.request<unknown>('POST', '/api/token/', payload, true, userId)
  }

  getTokenKey(id: string, userId?: string) {
    return this.request<unknown>('POST', `/api/token/${encodeURIComponent(id)}/key`, undefined, false, userId)
  }

  updateTokenStatus(id: string, status: 0 | 1, userId?: string) {
    return this.request<unknown>('PUT', '/api/token/?status_only=true', { id: Number.isSafeInteger(Number(id)) ? Number(id) : id, status }, false, userId)
  }

  deleteToken(id: string, userId?: string) {
    return this.request<unknown>('DELETE', `/api/token/${encodeURIComponent(id)}`, undefined, true, userId)
  }
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
