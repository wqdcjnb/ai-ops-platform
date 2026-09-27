import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
import type { GatewayConfig } from './gateway-config.js'
import { decryptPlatformApiKey, encryptPlatformApiKey } from './platform-db.js'
import { isPublicModelId, PUBLIC_MODEL_ID } from './public-model.js'
import { GatewayUpstreamError, OpenAiCompatibleAdapter } from './gateway/openai-compatible.js'

/** A short, stable ID is deliberately used instead of accepting arbitrary URLs
 * as a model identifier.  It makes allow-listing, auditing and key policy
 * enforceable at the AI OPS boundary. */
export const externalProviderIdSchema = z.string().trim().regex(/^[a-z][a-z0-9-]{0,31}$/, '供应商 ID 只能包含小写字母、数字和连字符').max(32)
export const externalProviderModelIdSchema = z.string().trim().min(1).max(160).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), '模型 ID 不能包含控制字符')
export const externalProviderModalitySchema = z.enum(['text', 'image', 'video', 'audio'])
export type ExternalProviderModality = z.infer<typeof externalProviderModalitySchema>

export const externalProviderInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().trim().url().max(512),
  /** Optional on update. The existing encrypted credential is retained. */
  apiKey: z.string().trim().min(1).max(2_048).optional(),
  /** The administrator selects a validated subset of the discovered catalog. */
  modelIds: z.array(externalProviderModelIdSchema).max(500).optional().default([]),
  enabled: z.boolean().default(true),
})

/**
 * Built-in provider presets are a convenience layer, not an arbitrary URL
 * bypass. Each preset contributes one reviewed HTTPS host to the same
 * server-side allow-list used by custom providers.
 */
export const externalProviderPresetSchema = z.object({
  id: externalProviderIdSchema,
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().url().max(512),
  host: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(240),
})

export const externalProviderModelSchema = z.object({
  id: z.string().min(1).max(128),
  upstreamId: externalProviderModelIdSchema,
})

export const externalProviderPublicSchema = z.object({
  id: externalProviderIdSchema,
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

export type ExternalProviderInput = z.infer<typeof externalProviderInputSchema>
export type ExternalProviderPublic = z.infer<typeof externalProviderPublicSchema>
export type ExternalProviderPreset = z.infer<typeof externalProviderPresetSchema>

export type ExternalProviderModelTestStatus = 'available' | 'catalog_confirmed' | 'unavailable'

export interface ExternalProviderModelTestResult {
  id: string
  status: ExternalProviderModelTestStatus
  latencyMs: number | null
  message: string
}

export interface ExternalProviderModelTestReport {
  catalogLatencyMs: number
  results: ExternalProviderModelTestResult[]
}

const builtInExternalProviderPresets: readonly ExternalProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    host: 'api.deepseek.com',
    description: '官方 OpenAI Responses / Chat Completions 接口；填写你的 DeepSeek API Key 后读取实际可用模型。',
  },
]

export function listExternalProviderPresets(): ExternalProviderPreset[] {
  return builtInExternalProviderPresets.map((preset) => ({ ...preset }))
}

interface PersistedExternalProviderModel {
  upstreamId: string
  publicId: string
  /** Internal routing information. It is intentionally not exposed as an
   * employee-facing catalog capability because a bare /models catalog does
   * not always provide authoritative capability metadata. */
  modalities: ExternalProviderModality[]
}

interface PersistedExternalProvider {
  id: string
  name: string
  baseUrl: string
  /** AES-GCM ciphertext; the clear-text credential never reaches disk. */
  apiKey: string
  enabled: boolean
  models: PersistedExternalProviderModel[]
  health: 'healthy' | 'unknown' | 'error'
  lastCheckedAt: string | null
  latencyMs: number | null
  lastSyncedAt: string | null
  lastSyncError: string | null
  createdAt: string
  updatedAt: string
}

interface PersistedExternalProviders {
  version: 1
  providers: PersistedExternalProvider[]
  updatedAt: string
}

const persistedModelSchema = z.object({
  upstreamId: externalProviderModelIdSchema,
  publicId: z.string().trim().min(1).max(128),
  // Existing provider files predate modality-aware routing. Defaulting them
  // to text keeps their established Chat/Responses behaviour intact.
  modalities: z.array(externalProviderModalitySchema).min(1).max(4).default(['text']),
})

const persistedProviderSchema = z.object({
  id: externalProviderIdSchema,
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().url().max(512),
  apiKey: z.string().trim().min(1),
  enabled: z.boolean(),
  models: z.array(persistedModelSchema).max(500),
  health: z.enum(['healthy', 'unknown', 'error']).default('unknown'),
  lastCheckedAt: z.string().datetime().nullable().default(null),
  latencyMs: z.number().int().nonnegative().nullable().default(null),
  lastSyncedAt: z.string().datetime().nullable().default(null),
  lastSyncError: z.string().max(240).nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

const persistedStateSchema = z.object({
  version: z.literal(1),
  providers: z.array(persistedProviderSchema).max(128),
  updatedAt: z.string().datetime(),
})

export interface ExternalProviderRoute {
  providerId: string
  providerName: string
  baseUrl: string
  apiKey: string
  upstreamModelId: string
  publicModelId: string
  modalities: ExternalProviderModality[]
}

export interface ExternalProviderGatewayModel {
  id: string
  providerId: string
  providerName: string
  upstreamId: string
}

export type ExternalProviderErrorCode =
  | 'EXTERNAL_PROVIDER_URL_INVALID'
  | 'EXTERNAL_PROVIDER_HOST_NOT_ALLOWED'
  | 'EXTERNAL_PROVIDER_INSECURE_URL'
  | 'EXTERNAL_PROVIDER_KEY_REQUIRED'
  | 'EXTERNAL_PROVIDER_NOT_FOUND'
  | 'EXTERNAL_PROVIDER_CREDENTIAL_INVALID'
  | 'EXTERNAL_PROVIDER_TIMEOUT'
  | 'EXTERNAL_PROVIDER_UNAVAILABLE'
  | 'EXTERNAL_PROVIDER_MODEL_NOT_DISCOVERED'
  | 'EXTERNAL_PROVIDER_STORE_FAILED'

export class ExternalProviderError extends Error {
  constructor(readonly code: ExternalProviderErrorCode, message: string, readonly statusCode: 400 | 404 | 502 | 504 = 400) {
    super(message)
    this.name = 'ExternalProviderError'
  }
}

export interface ExternalProviderRegistryOptions {
  filePath?: string
  env?: NodeJS.ProcessEnv
  /**
   * Optional exact host restriction, without scheme or path. When omitted or
   * empty, an administrator can connect any public HTTPS service. Supplying a
   * list turns it into a deployment-level restriction; `*` keeps custom
   * public services enabled.
   */
  allowedHosts?: Iterable<string>
  /** Intended for test/dev loopback endpoints only. Production endpoints remain HTTPS-only. */
  allowInsecureLoopback?: boolean
}

function defaultExternalProvidersPath(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.AI_OPS_EXTERNAL_PROVIDERS_FILE?.trim()
  if (configured) return isAbsolute(configured) ? configured : resolve(process.cwd(), configured)
  const databasePath = env.PLATFORM_DB_PATH?.trim()
  if (databasePath && databasePath !== ':memory:') return join(dirname(resolve(databasePath)), 'external-providers.json')
  return resolve(process.cwd(), 'data', 'external-providers.json')
}

function hostsFromEnvironment(env: NodeJS.ProcessEnv) {
  return (env.AI_OPS_EXTERNAL_PROVIDER_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

function isLoopbackHost(host: string) {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '')
  return normalized === 'localhost' || normalized === '::1' || normalized === '127.0.0.1'
}

function isPrivateIpv4(host: string) {
  const parts = host.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const first = parts[0]
  const second = parts[1]
  if (first === undefined || second === undefined) return false
  return first === 0
    || first === 10
    || first === 127
    || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && (second === 0 || second === 168))
    || (first === 198 && (second === 18 || second === 19 || second === 51))
    || (first === 203 && second === 0)
}

/** Reject endpoints that are unequivocally local/reserved before a server-side
 * credentials-bearing request is made. DNS/egress restrictions remain the
 * deployment's second line of defence for hostnames. */
function isPrivateOrReservedHost(host: string) {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (isLoopbackHost(normalized) || normalized.endsWith('.localhost') || normalized.endsWith('.local')) return true

  const version = isIP(normalized)
  if (version === 4) return isPrivateIpv4(normalized)
  if (version !== 6) return false

  if (normalized === '::' || normalized === '::1') return true
  if (/^(?:fc|fd|fe[89ab])/i.test(normalized)) return true
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1]
  return Boolean(mappedIpv4 && isPrivateIpv4(mappedIpv4))
}

/** Candidate API roots used by popular OpenAI-compatible relays. The working
 * root is retained for later model requests once discovery succeeds. */
function catalogBaseCandidates(baseUrl: string) {
  const parsed = new URL(baseUrl)
  const existingPath = parsed.pathname.replace(/\/+$/, '')
  const candidates = [baseUrl]
  const appendPath = (suffix: string) => {
    const next = new URL(parsed.toString())
    next.pathname = `${existingPath || ''}${suffix}`.replace(/\/+/g, '/')
    const value = next.toString().replace(/\/$/, '')
    if (!candidates.includes(value)) candidates.push(value)
  }

  // When an administrator enters only the service origin, probe the most
  // common OpenAI-compatible roots in a bounded order. A path that already
  // carries an API version remains unchanged.
  if (!/(?:^|\/)(?:api\/)?v\d+$/i.test(existingPath)) {
    appendPath('/v1')
    appendPath('/api/v1')
    appendPath('/api')
  }
  return candidates
}

function shouldTryNextCatalogRoot(error: unknown) {
  return error instanceof GatewayUpstreamError
    && ['GATEWAY_UPSTREAM_NOT_FOUND', 'GATEWAY_UPSTREAM_INVALID_RESPONSE', 'GATEWAY_UPSTREAM_ERROR'].includes(error.code)
}

function publicModelId(providerId: string, upstreamId: string) {
  const readable = upstreamId.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'model'
  const fingerprint = createHash('sha256').update(upstreamId).digest('hex').slice(0, 10)
  return `external-${providerId}-${readable}-${fingerprint}`
}

function normalizeModelIds(values: readonly string[]) {
  return [...new Set(values.map((value) => externalProviderModelIdSchema.parse(value)))]
}

const modalityOrder: readonly ExternalProviderModality[] = ['text', 'image', 'video', 'audio']

function modalityLabel(modality: ExternalProviderModality) {
  return ({ text: '文本', image: '图片', video: '视频', audio: '语音' })[modality]
}

function modalityFromHint(hint: string): ExternalProviderModality | null {
  const normalized = hint.toLowerCase().replace(/[\s_-]+/g, '')
  if (/(?:image|photo|picture|flux|diffusion|t2i|i2i|imagen|imagine)/.test(normalized)) return 'image'
  if (/(?:video|movie|kling|seedance|veo|sora|t2v|i2v|v2v)/.test(normalized)) return 'video'
  if (/(?:audio|speech|voice|tts|asr|stt|music|transcri)/.test(normalized)) return 'audio'
  if (/(?:text|chat|completion|reasoning|language|code|llm)/.test(normalized)) return 'text'
  return null
}

/**
 * `/models` is not a capability contract across relay implementations. Use
 * metadata when an upstream gives it, otherwise apply deliberately narrow
 * naming hints for well-known media families. Unknown models remain text
 * candidates so ordinary Chat/Responses models keep working. The value is
 * only used internally for endpoint routing and never rendered as a claimed
 * employee-facing capability.
 */
export function inferExternalProviderModelModalities(modelId: string, capabilityHints: readonly string[] = []): ExternalProviderModality[] {
  const inferred = new Set<ExternalProviderModality>()
  for (const hint of capabilityHints) {
    const modality = modalityFromHint(hint)
    if (modality) inferred.add(modality)
  }

  const normalizedId = modelId.toLowerCase()
  if (/(?:^|[-_/.])(?:image|flux|sdxl|stable[-_]?diffusion|imagen|imagine|wanx|hunyuanimage|kolors|cogview|seedream|t2i|i2i)(?:$|[-_/.])|(?:image|flux|sdxl|stable[-_]?diffusion|imagen|imagine|wanx|hunyuanimage|kolors|cogview|seedream|t2i|i2i)/.test(normalizedId)) inferred.add('image')
  if (/(?:video|kling|seedance|wan[-_]?2|veo|hunyuanvideo|sora|cogvideo|t2v|i2v|v2v)/.test(normalizedId)) inferred.add('video')
  if (/(?:tts|speech|whisper|asr|stt|audio|music|voice|bark|cosyvoice|fishaudio)/.test(normalizedId)) inferred.add('audio')

  // A catalog that only labels a model as media should not be sent to the
  // Chat/Responses endpoint. Otherwise retain text as the safe default.
  if (!inferred.size) inferred.add('text')
  return modalityOrder.filter((modality) => inferred.has(modality))
}

interface ExternalProviderDiscovery {
  models: string[]
  baseUrl: string
  latencyMs: number
  modalitiesByModel: Map<string, ExternalProviderModality[]>
}

function readProviderFile(filePath: string): PersistedExternalProviders | null {
  if (!existsSync(filePath)) return null
  try {
    const parsed = persistedStateSchema.safeParse(JSON.parse(readFileSync(filePath, 'utf8')))
    if (!parsed.success) return null
    return parsed.data
  } catch {
    return null
  }
}

/**
 * Owns administrator-approved third-party OpenAI Responses providers. It is
 * intentionally server-local: browser clients get a safe summary only, while
 * the external API key is encrypted before it is persisted.
 */
export class ExternalProviderRegistry {
  readonly filePath: string
  private readonly allowedHosts: Set<string>
  private readonly restrictHosts: boolean
  private readonly allowInsecureLoopback: boolean
  private readonly providers = new Map<string, PersistedExternalProvider>()

  constructor(options: ExternalProviderRegistryOptions = {}) {
    const env = options.env ?? process.env
    this.filePath = options.filePath ?? defaultExternalProvidersPath(env)
    const configuredHosts = (options.allowedHosts ? [...options.allowedHosts] : hostsFromEnvironment(env))
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
    this.restrictHosts = configuredHosts.length > 0 && !configuredHosts.includes('*')
    this.allowedHosts = new Set([
      ...builtInExternalProviderPresets.map((preset) => preset.host),
      ...configuredHosts.filter((host) => host !== '*'),
    ].map((host) => host.trim().toLowerCase()).filter(Boolean))
    this.allowInsecureLoopback = options.allowInsecureLoopback ?? env.AI_OPS_ALLOW_INSECURE_EXTERNAL_PROVIDER === 'true'
    const state = readProviderFile(this.filePath)
    for (const provider of state?.providers ?? []) {
      // The first persisted format had no modality field, so Zod supplied the
      // text default above. Reclassify only obvious media names in memory so
      // a deployment upgrade does not continue routing an old image/video/TTS
      // selection through Chat until the administrator next syncs it.
      const models = provider.models.map((model) => {
        if (model.modalities.length !== 1 || model.modalities[0] !== 'text') return model
        const inferred = inferExternalProviderModelModalities(model.upstreamId)
        return inferred.length === 1 && inferred[0] === 'text' ? model : { ...model, modalities: inferred }
      })
      this.providers.set(provider.id, { ...provider, models })
    }
  }

  list() {
    return [...this.providers.values()]
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
      .map((provider) => this.toPublic(provider))
  }

  get(id: string) {
    const provider = this.providers.get(externalProviderIdSchema.parse(id))
    return provider ? this.toPublic(provider) : null
  }

  hasEnabledModels() {
    return this.listGatewayModels().length > 0
  }

  isGatewayModel(modelId: string) {
    return Boolean(this.resolveGatewayModel(modelId))
  }

  listGatewayModels(): ExternalProviderGatewayModel[] {
    const models: ExternalProviderGatewayModel[] = []
    for (const provider of this.providers.values()) {
      if (!provider.enabled || !decryptPlatformApiKey(provider.apiKey)) continue
      for (const model of provider.models) models.push({ id: model.publicId, providerId: provider.id, providerName: provider.name, upstreamId: model.upstreamId })
    }
    return models.sort((left, right) => left.id.localeCompare(right.id))
  }

  /** Every enabled relay model is a candidate beneath the single public
   * virtual model. The gateway chooses the fastest healthy candidate and
   * retries a different relay when a retryable failure occurs. */
  listPlatformRoutes(modality?: ExternalProviderModality): ExternalProviderRoute[] {
    const routes: ExternalProviderRoute[] = []
    for (const provider of this.providers.values()) {
      if (!provider.enabled) continue
      const apiKey = decryptPlatformApiKey(provider.apiKey)
      if (!apiKey) continue
      for (const model of provider.models) {
        if (modality && !model.modalities.includes(modality)) continue
        routes.push({
          providerId: provider.id,
          providerName: provider.name,
          baseUrl: provider.baseUrl,
          apiKey,
          upstreamModelId: model.upstreamId,
          publicModelId: PUBLIC_MODEL_ID,
          modalities: model.modalities,
        })
      }
    }
    return routes.sort((left, right) => `${left.providerName}/${left.upstreamModelId}`.localeCompare(`${right.providerName}/${right.upstreamModelId}`, 'zh-CN'))
  }

  resolveGatewayModel(modelId: string): ExternalProviderRoute | null {
    if (isPublicModelId(modelId)) return this.listPlatformRoutes()[0] ?? null
    const upstreamMatches: ExternalProviderRoute[] = []
    for (const provider of this.providers.values()) {
      if (!provider.enabled) continue
      const apiKey = decryptPlatformApiKey(provider.apiKey)
      if (!apiKey) continue
      for (const model of provider.models) {
        const route = {
          providerId: provider.id,
          providerName: provider.name,
          baseUrl: provider.baseUrl,
          apiKey,
          upstreamModelId: model.upstreamId,
          publicModelId: model.publicId,
          modalities: model.modalities,
        }
        // The namespaced public ID remains the canonical gateway identity.
        // Accept the upstream ID only as a convenience alias when it resolves
        // to exactly one enabled provider model.
        if (model.publicId === modelId) return route
        if (model.upstreamId === modelId) upstreamMatches.push(route)
      }
    }
    return upstreamMatches.length === 1 ? upstreamMatches[0] ?? null : null
  }

  async discover(input: Pick<ExternalProviderInput, 'baseUrl' | 'apiKey'>) {
    const result = await this.probeModels(input)
    return { models: result.models, baseUrl: result.baseUrl, latencyMs: result.latencyMs }
  }

  /**
   * Runs an explicit administrator-requested, minimal text probe for each
   * selected model. A model that is listed but rejects this text-shaped probe
   * is reported as catalog-confirmed rather than unavailable: image, video
   * and audio models commonly need a different request format.
   */
  async testModels(input: Pick<ExternalProviderInput, 'baseUrl' | 'apiKey'> & { modelIds: readonly string[] }): Promise<ExternalProviderModelTestReport> {
    const selected = normalizeModelIds(input.modelIds)
    if (!selected.length) throw new ExternalProviderError('EXTERNAL_PROVIDER_MODEL_NOT_DISCOVERED', '请至少选择一个模型后再测试。')

    const apiKey = input.apiKey?.trim()
    if (!apiKey) throw new ExternalProviderError('EXTERNAL_PROVIDER_KEY_REQUIRED', '请提供第三方供应商 API Key；该 Key 不会返回到浏览器。')

    const catalog = await this.probeModels({ baseUrl: input.baseUrl, apiKey })
    const listed = new Set(catalog.models)
    const results = await mapWithConcurrency(selected, 6, async (modelId) => {
      if (!listed.has(modelId)) {
        return {
          id: modelId,
          status: 'unavailable' as const,
          latencyMs: null,
          message: '该模型未出现在当前账号返回的模型目录中。',
        }
      }

      const modalities = catalog.modalitiesByModel.get(modelId) ?? inferExternalProviderModelModalities(modelId)
      if (!modalities.includes('text')) {
        const label = modalities.map(modalityLabel).join('、')
        return {
          id: modelId,
          status: 'catalog_confirmed' as const,
          latencyMs: null,
          message: `模型目录已确认；已归类为${label}模型。为避免自动创建可能计费的生成任务，未发送文本探测；保存后会仅在对应接口中参与路由。`,
        }
      }

      const startedAt = Date.now()
      const adapter = new OpenAiCompatibleAdapter(this.adapterConfig(catalog.baseUrl, apiKey, 12_000))
      try {
        await adapter.chatCompletion({
          model: modelId,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          temperature: 0,
        })
        return {
          id: modelId,
          status: 'available' as const,
          latencyMs: Math.max(1, Date.now() - startedAt),
          message: '最小文本调用成功（Chat Completions）。',
        }
      } catch (chatError) {
        const chatFailure = directTextProbeFailure(modelId, chatError, startedAt)
        if (chatFailure) return chatFailure
        try {
          await adapter.responses({
            model: modelId,
            input: 'ping',
            max_output_tokens: 1,
          })
          return {
            id: modelId,
            status: 'available' as const,
            latencyMs: Math.max(1, Date.now() - startedAt),
            message: '最小文本调用成功（Responses）。',
          }
        } catch (responsesError) {
          const responsesFailure = directTextProbeFailure(modelId, responsesError, startedAt)
          if (responsesFailure) return responsesFailure
          const latencyMs = Math.max(1, Date.now() - startedAt)
          return {
            id: modelId,
            status: 'catalog_confirmed' as const,
            latencyMs,
            message: modalities.length > 1
              ? `模型目录已确认；Chat Completions 与 Responses 文本探测均未通过。该模型还被归类为${modalities.filter((modality) => modality !== 'text').map(modalityLabel).join('、')}模型，请使用对应专用接口调用。`
              : '模型目录已确认；Chat Completions 与 Responses 最小文本测试均未通过。请检查该模型是否有调用权限、余额/配额，以及服务端实际支持的文本接口。',
          }
        }
      }
    })

    return { catalogLatencyMs: catalog.latencyMs, results }
  }

  /** A health probe is intentionally a lightweight /models request. It is
   * safe to race concurrently and never submits a user generation request. */
  async checkHealth(id: string) {
    const providerId = externalProviderIdSchema.parse(id)
    const existing = this.providers.get(providerId)
    if (!existing) throw new ExternalProviderError('EXTERNAL_PROVIDER_NOT_FOUND', '未找到该第三方账号。', 404)
    const apiKey = decryptPlatformApiKey(existing.apiKey)
    if (!apiKey) throw new ExternalProviderError('EXTERNAL_PROVIDER_KEY_REQUIRED', '该第三方账号缺少可用凭据，请重新保存 API Key。')
    try {
      const probe = await this.probeModels({ baseUrl: existing.baseUrl, apiKey })
      const next: PersistedExternalProvider = {
        ...existing,
        baseUrl: probe.baseUrl,
        health: 'healthy',
        lastCheckedAt: new Date().toISOString(),
        latencyMs: probe.latencyMs,
        updatedAt: new Date().toISOString(),
      }
      this.providers.set(providerId, next)
      try { this.persist() } catch (error) { this.providers.set(providerId, existing); throw error }
      return this.toPublic(next)
    } catch (error) {
      const next: PersistedExternalProvider = {
        ...existing,
        health: 'error',
        lastCheckedAt: new Date().toISOString(),
        latencyMs: null,
        updatedAt: new Date().toISOString(),
      }
      this.providers.set(providerId, next)
      try { this.persist() } catch { this.providers.set(providerId, existing) }
      throw this.discoveryError(error)
    }
  }

  private async probeModels(input: Pick<ExternalProviderInput, 'baseUrl' | 'apiKey'>) {
    const baseUrl = this.normalizeBaseUrl(input.baseUrl)
    const apiKey = input.apiKey?.trim()
    if (!apiKey) throw new ExternalProviderError('EXTERNAL_PROVIDER_KEY_REQUIRED', '请提供第三方供应商 API Key；该 Key 不会返回到浏览器。')

    const startedAt = Date.now()
    let firstEmptyCatalog: ExternalProviderDiscovery | null = null
    let lastError: unknown = null
    for (const candidateBaseUrl of catalogBaseCandidates(baseUrl)) {
      try {
        const adapter = new OpenAiCompatibleAdapter(this.adapterConfig(candidateBaseUrl, apiKey))
        const modalitiesByModel = new Map<string, ExternalProviderModality[]>()
        for (const model of await adapter.listModels()) {
          if (!externalProviderModelIdSchema.safeParse(model.id).success) continue
          const previous = modalitiesByModel.get(model.id) ?? []
          const modalities = new Set<ExternalProviderModality>([
            ...previous,
            ...inferExternalProviderModelModalities(model.id, model.capabilityHints),
          ])
          modalitiesByModel.set(model.id, modalityOrder.filter((modality) => modalities.has(modality)))
        }
        const models = [...modalitiesByModel.keys()].sort((left, right) => left.localeCompare(right))
        if (models.length > 0) {
          return { models, baseUrl: candidateBaseUrl, latencyMs: Math.max(1, Date.now() - startedAt), modalitiesByModel }
        }
        firstEmptyCatalog ??= { baseUrl: candidateBaseUrl, models, latencyMs: Math.max(1, Date.now() - startedAt), modalitiesByModel }
      } catch (error) {
        lastError = error
        if (shouldTryNextCatalogRoot(error)) continue
        throw this.discoveryError(error)
      }
    }

    if (firstEmptyCatalog) return { ...firstEmptyCatalog, latencyMs: Math.max(1, Date.now() - startedAt) }
    throw this.discoveryError(lastError)
  }

  /** Verify first, then write. This prevents a saved provider from granting an
   * arbitrary string that its own model catalog did not advertise. */
  async createVerified(rawInput: ExternalProviderInput) {
    let providerId = ''
    do {
      providerId = `relay-${randomUUID().replaceAll('-', '').slice(0, 12)}`
    } while (this.providers.has(providerId))
    return this.upsertVerified(providerId, rawInput)
  }

  async upsertVerified(id: string, rawInput: ExternalProviderInput) {
    const providerId = externalProviderIdSchema.parse(id)
    const input = externalProviderInputSchema.parse(rawInput)
    const existing = this.providers.get(providerId)
    const apiKey = input.apiKey?.trim() || (existing ? decryptPlatformApiKey(existing.apiKey) : null)
    if (!apiKey) throw new ExternalProviderError('EXTERNAL_PROVIDER_KEY_REQUIRED', '新供应商必须提供 API Key。')
    const discovered = await this.probeModels({ baseUrl: input.baseUrl, apiKey })
    const requested = normalizeModelIds(input.modelIds)
    const selected = requested.length ? requested : discovered.models
    const available = new Set(discovered.models)
    if (!selected.length || selected.some((modelId) => !available.has(modelId))) {
      throw new ExternalProviderError('EXTERNAL_PROVIDER_MODEL_NOT_DISCOVERED', '所选模型未从该账号当前模型列表中返回，请重新获取模型列表后再保存。')
    }
    return this.upsert(
      providerId,
      { ...input, baseUrl: discovered.baseUrl, modelIds: selected, ...(input.apiKey ? { apiKey: input.apiKey } : {}) },
      { syncedAt: new Date().toISOString(), latencyMs: discovered.latencyMs },
      discovered.modalitiesByModel,
    )
  }

  async syncModels(id: string) {
    const providerId = externalProviderIdSchema.parse(id)
    const existing = this.providers.get(providerId)
    if (!existing) throw new ExternalProviderError('EXTERNAL_PROVIDER_NOT_FOUND', '未找到该第三方账号。', 404)
    const apiKey = decryptPlatformApiKey(existing.apiKey)
    if (!apiKey) throw new ExternalProviderError('EXTERNAL_PROVIDER_KEY_REQUIRED', '该第三方账号缺少可用凭据，请重新保存 API Key。')
    try {
      const discovered = await this.probeModels({ baseUrl: existing.baseUrl, apiKey })
      const configuredModels = existing.models.map((model) => model.upstreamId)
      const available = new Set(discovered.models)
      const selected = configuredModels.length ? configuredModels.filter((modelId) => available.has(modelId)) : discovered.models
      return this.upsert(
        providerId,
        {
          name: existing.name,
          baseUrl: discovered.baseUrl,
          enabled: existing.enabled,
          modelIds: selected,
        },
        { syncedAt: new Date().toISOString(), latencyMs: discovered.latencyMs },
        discovered.modalitiesByModel,
      )
    } catch (error) {
      const safeMessage = error instanceof ExternalProviderError ? error.message.slice(0, 240) : '模型同步失败'
      const next = { ...existing, health: 'error' as const, lastCheckedAt: new Date().toISOString(), latencyMs: null, lastSyncError: safeMessage, updatedAt: new Date().toISOString() }
      this.providers.set(providerId, next)
      try { this.persist() } catch { this.providers.set(providerId, existing) }
      throw error
    }
  }

  setEnabled(id: string, enabled: boolean) {
    const providerId = externalProviderIdSchema.parse(id)
    const existing = this.providers.get(providerId)
    if (!existing) throw new ExternalProviderError('EXTERNAL_PROVIDER_NOT_FOUND', '未找到该第三方供应商。', 404)
    const next = { ...existing, enabled, updatedAt: new Date().toISOString() }
    this.providers.set(providerId, next)
    try {
      this.persist()
    } catch (error) {
      this.providers.set(providerId, existing)
      throw error
    }
    return this.toPublic(next)
  }

  remove(id: string) {
    const providerId = externalProviderIdSchema.parse(id)
    const existing = this.providers.get(providerId)
    if (!existing) throw new ExternalProviderError('EXTERNAL_PROVIDER_NOT_FOUND', '未找到该第三方供应商。', 404)
    this.providers.delete(providerId)
    try {
      this.persist()
    } catch (error) {
      this.providers.set(providerId, existing)
      throw error
    }
    return this.toPublic(existing)
  }

  private upsert(
    id: string,
    input: ExternalProviderInput,
    sync: { syncedAt: string; latencyMs: number } | null = null,
    discoveredModalities: ReadonlyMap<string, ExternalProviderModality[]> = new Map(),
  ) {
    const existing = this.providers.get(id)
    const baseUrl = this.normalizeBaseUrl(input.baseUrl)
    const apiKey = input.apiKey?.trim() || (existing ? decryptPlatformApiKey(existing.apiKey) : null)
    if (!apiKey) throw new ExternalProviderError('EXTERNAL_PROVIDER_KEY_REQUIRED', '新供应商必须提供 API Key。')
    const selected = normalizeModelIds(input.modelIds)
    const previousModels = new Map(existing?.models.map((model) => [model.upstreamId, model]) ?? [])
    const modelIds = new Set<string>()
    const models = selected.map((upstreamId) => {
      const previous = previousModels.get(upstreamId)
      let modelPublicId = previous?.publicId ?? publicModelId(id, upstreamId)
      // A hash collision is highly unlikely, but a deterministic suffix keeps
      // the persisted public namespace safe even in that case.
      let attempt = 1
      while (modelIds.has(modelPublicId)) modelPublicId = `${publicModelId(id, upstreamId).slice(0, 118)}-${attempt++}`
      modelIds.add(modelPublicId)
      return {
        upstreamId,
        publicId: modelPublicId,
        modalities: discoveredModalities.get(upstreamId) ?? previous?.modalities ?? inferExternalProviderModelModalities(upstreamId),
      }
    })
    const timestamp = new Date().toISOString()
    const next: PersistedExternalProvider = {
      id,
      name: input.name.trim(),
      baseUrl,
      apiKey: input.apiKey?.trim() ? encryptPlatformApiKey(input.apiKey.trim()) : existing!.apiKey,
      enabled: input.enabled,
      models,
      health: sync ? 'healthy' : existing?.health ?? 'unknown',
      lastCheckedAt: sync?.syncedAt ?? existing?.lastCheckedAt ?? null,
      latencyMs: sync?.latencyMs ?? existing?.latencyMs ?? null,
      lastSyncedAt: sync?.syncedAt ?? existing?.lastSyncedAt ?? null,
      lastSyncError: null,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }
    this.providers.set(id, next)
    try {
      this.persist()
    } catch (error) {
      if (existing) this.providers.set(id, existing)
      else this.providers.delete(id)
      throw error
    }
    return this.toPublic(next)
  }

  private normalizeBaseUrl(value: string) {
    let url: URL
    try {
      url = new URL(value.trim())
    } catch {
      throw new ExternalProviderError('EXTERNAL_PROVIDER_URL_INVALID', '第三方供应商地址必须是有效的 HTTP(S) URL。')
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new ExternalProviderError('EXTERNAL_PROVIDER_URL_INVALID', '第三方供应商地址必须是不带凭据、查询参数或片段的 HTTP(S) URL。')
    }
    const host = url.hostname.toLowerCase()
    if (host === 'cloud.siliconflow.cn') {
      throw new ExternalProviderError(
        'EXTERNAL_PROVIDER_URL_INVALID',
        'cloud.siliconflow.cn 是 SiliconFlow 控制台，不提供模型 API。请填写 https://api.siliconflow.cn/v1，并使用控制台创建的 API Key。',
      )
    }
    const developmentLoopback = this.allowInsecureLoopback && isLoopbackHost(host)
    if (!developmentLoopback && isPrivateOrReservedHost(host)) {
      throw new ExternalProviderError('EXTERNAL_PROVIDER_HOST_NOT_ALLOWED', '第三方服务地址不能指向本机、内网或保留地址。')
    }
    if (this.restrictHosts && !this.allowedHosts.has(host)) {
      throw new ExternalProviderError('EXTERNAL_PROVIDER_HOST_NOT_ALLOWED', '该地址不在管理员设置的第三方服务主机白名单中。')
    }
    if (url.protocol === 'http:' && !developmentLoopback) {
      throw new ExternalProviderError('EXTERNAL_PROVIDER_INSECURE_URL', '第三方供应商必须使用 HTTPS；仅本机测试地址可在显式开发开关下使用 HTTP。')
    }
    return url.toString().replace(/\/$/, '')
  }

  private adapterConfig(baseUrl: string, apiKey: string, timeoutMs = 60_000): GatewayConfig {
    return {
      mode: 'relay',
      provider: 'openai_compatible',
      baseUrl,
      upstreamApiKey: apiKey,
      timeoutMs,
      defaultStreaming: false,
      context: { enabled: false, maxInputChars: 4_000, maxMessages: 1 },
      upstreamConfigured: true,
    }
  }

  private discoveryError(error: unknown) {
    if (error instanceof ExternalProviderError) return error
    if (error instanceof GatewayUpstreamError) {
      if (error.code === 'GATEWAY_UPSTREAM_AUTH_FAILED') return new ExternalProviderError('EXTERNAL_PROVIDER_CREDENTIAL_INVALID', '第三方供应商拒绝了 API Key；未保存本次配置。')
      if (error.code === 'GATEWAY_UPSTREAM_TIMEOUT') return new ExternalProviderError('EXTERNAL_PROVIDER_TIMEOUT', '第三方供应商读取模型目录超时；未保存本次配置。', 504)
      if (error.code === 'GATEWAY_UPSTREAM_NOT_FOUND') return new ExternalProviderError('EXTERNAL_PROVIDER_UNAVAILABLE', '在该 Base URL 下未找到模型目录接口。请填写 API 根地址（通常以 /v1 结尾），系统会请求 /models；未保存本次配置。', 502)
      if (error.code === 'GATEWAY_UPSTREAM_RATE_LIMITED') return new ExternalProviderError('EXTERNAL_PROVIDER_UNAVAILABLE', '第三方供应商暂时限制了模型目录请求，请稍后重试；未保存本次配置。', 502)
      if (error.code === 'GATEWAY_UPSTREAM_INVALID_RESPONSE') return new ExternalProviderError('EXTERNAL_PROVIDER_UNAVAILABLE', '已连接第三方供应商，但无法从模型目录中提取模型 ID。系统已自动尝试常见 API 根路径和目录格式；该服务可能不兼容 OpenAI 调用协议。', 502)
      if (error.code === 'GATEWAY_UPSTREAM_UNAVAILABLE') return new ExternalProviderError('EXTERNAL_PROVIDER_UNAVAILABLE', '服务端无法连接第三方供应商。请检查域名解析、HTTPS 证书、防火墙和服务地址；未保存本次配置。', 502)
    }
    return new ExternalProviderError('EXTERNAL_PROVIDER_UNAVAILABLE', '第三方供应商拒绝了模型目录请求。请确认 Base URL 是 API 根地址且该服务支持 /models；未保存本次配置。', 502)
  }

  private toPublic(provider: PersistedExternalProvider): ExternalProviderPublic {
    const host = new URL(provider.baseUrl).hostname
    return {
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      host,
      enabled: provider.enabled,
      credentialConfigured: Boolean(decryptPlatformApiKey(provider.apiKey)),
      models: provider.models.map((model) => ({ id: model.publicId, upstreamId: model.upstreamId })),
      health: provider.health,
      lastCheckedAt: provider.lastCheckedAt,
      latencyMs: provider.latencyMs,
      lastSyncedAt: provider.lastSyncedAt,
      lastSyncError: provider.lastSyncError,
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt,
    }
  }

  private persist() {
    const state: PersistedExternalProviders = {
      version: 1,
      providers: [...this.providers.values()],
      updatedAt: new Date().toISOString(),
    }
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
      writeFileSync(temporaryPath, JSON.stringify(state, null, 2), 'utf8')
      renameSync(temporaryPath, this.filePath)
    } catch {
      throw new ExternalProviderError('EXTERNAL_PROVIDER_STORE_FAILED', '第三方供应商验证成功，但服务端未能安全保存配置。', 502)
    }
  }
}

async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const worker = async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await mapper(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, worker))
  return results
}

/** Authentication, transport and quota failures are definitive for the
 * current account, so retrying a different text endpoint adds delay without
 * improving the diagnosis. Endpoint/shape errors intentionally return null:
 * the caller then tries the alternate OpenAI text contract. */
function directTextProbeFailure(id: string, error: unknown, startedAt: number): ExternalProviderModelTestResult | null {
  if (!(error instanceof GatewayUpstreamError)) return null
  const latencyMs = Math.max(1, Date.now() - startedAt)
  if (error.code === 'GATEWAY_UPSTREAM_AUTH_FAILED') {
    return { id, status: 'unavailable', latencyMs, message: '第三方账号拒绝了认证，请检查 API Key。' }
  }
  if (error.code === 'GATEWAY_UPSTREAM_TIMEOUT') {
    return { id, status: 'unavailable', latencyMs, message: '模型调用测试超时。' }
  }
  if (error.code === 'GATEWAY_UPSTREAM_RATE_LIMITED') {
    return { id, status: 'unavailable', latencyMs, message: '第三方服务暂时限流。' }
  }
  if (error.code === 'GATEWAY_UPSTREAM_CREDIT_EXHAUSTED') {
    return { id, status: 'unavailable', latencyMs, message: '第三方账号余额或调用配额不足，无法完成模型调用测试。' }
  }
  if (error.code === 'GATEWAY_UPSTREAM_UNAVAILABLE') {
    return { id, status: 'unavailable', latencyMs, message: '第三方服务暂时不可达。' }
  }
  return null
}

export function createExternalProviderRegistry(options: ExternalProviderRegistryOptions = {}) {
  return new ExternalProviderRegistry(options)
}
