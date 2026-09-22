import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import Fastify, { LogController } from 'fastify'
import { createHash, randomBytes } from 'node:crypto'
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { createDatabaseOverview, createNewApiOverview, overviewResponseSchema, periodSchema } from './overview.js'
import { newApiStatusSchema, probeNewApiFromEnvironment, type NewApiStatus } from './new-api-status.js'
import { createNewApiManagementClient, newApiManagementResponseSchema, probeNewApiManagementFromEnvironment, type NewApiChannel, type NewApiManagementClient, type NewApiManagementResponse } from './new-api-management.js'
import { createPlatformStatus, createTaskSummary, platformStatusSchema, probeCpaFromEnvironment, probeHttpService, taskSummarySchema, type PlatformProbeResult } from './platform.js'
import { createDatabasePeople, createDatabasePersonDetail, createDatabasePersonUsage, createNewApiPeople, createNewApiPersonDetail, createNewApiPersonUsage, peopleQuerySchema, peopleResponseSchema, personBatchCreateBodySchema, personBatchCreateResponseSchema, personCreateBodySchema, personCreateResponseSchema, personDeleteBodySchema, personDeleteResponseSchema, personDetailResponseSchema, personDisableBodySchema, personDisableResponseSchema, personEnableBodySchema, personEnableResponseSchema, personIdParamsSchema, personUsageQuerySchema, personUsageResponseSchema } from './people.js'
import { createDatabaseKeyDetail, createDatabaseKeys, createDemoKeyDetail, createDemoKeys, createNewApiKeyDetail, createNewApiKeys, keyCreateBodySchema, keyCreateResponseSchema, keyDeleteBodySchema, keyDeleteResponseSchema, keyDetailResponseSchema, keyDisableBodySchema, keyDisableResponseSchema, keyEnableBodySchema, keyEnableResponseSchema, keyIdParamsSchema, keyResetBodySchema, keyResetResponseSchema, keyRotateBodySchema, keyRotateResponseSchema, keySecretResponseSchema, keysQuerySchema, keysResponseSchema, newApiKeyId } from './keys.js'
import { createDatabaseLimits, createDemoLimits, isSoftQuotaEnabled, limitIdParamsSchema, limitsQuerySchema, limitsResponseSchema, quotaPolicySubject, quotaUpdateBodySchema, quotaUpdateResponseSchema } from './limits.js'
import { createDatabaseRoutes, routeIdParamsSchema, routePolicyUpdateBodySchema, routePolicyUpdateResponseSchema, routesQuerySchema, routesResponseSchema } from './routes.js'
import { channelCheckBodySchema, channelCheckResponseSchema, channelIdParamsSchema, channelsQuerySchema, channelsResponseSchema, createDatabaseDemoChannels, createDemoModels, modelsQuerySchema, modelsResponseSchema } from './models.js'
import { CatalogError, createModelCatalog, type CatalogReader } from './model-catalog.js'
import { createDatabaseUpstreamHistory, createUpstreamSnapshot, upstreamCheckBodySchema, upstreamCheckResponseSchema, upstreamHistoryResponseSchema, upstreamIdParamsSchema, upstreamsQuerySchema, upstreamsResponseSchema } from './upstreams.js'
import { createDatabaseUsage, createDatabaseUsageDetail, createNewApiUsage, createNewApiUsageDetail, usageDetailResponseSchema, usageQuerySchema, usageRequestParamsSchema, usageResponseSchema } from './usage.js'
import { auditDetailResponseSchema, auditExportQuerySchema, auditParamsSchema, auditQuerySchema, auditResponseSchema, createAuditCsv, createDatabaseAudit, createDatabaseAuditDetail, createDemoAudit, createDemoAuditDetail } from './audit.js'
import { conversationAccessBodySchema, conversationAccessHistoryResponseSchema, conversationAccessResponseSchema, conversationAuditParamsSchema, conversationAuditQuerySchema, conversationAuditResponseSchema, createDatabaseConversationAccess, createDatabaseConversationAccessHistory, createDatabaseConversationAudits, getDatabaseConversationAuditRecord } from './conversation-audit.js'
import { businessRuleDraftBodySchema, businessRulePreviewBodySchema, businessRulePreviewResponseSchema, businessRulePublishBodySchema, businessRuleRollbackBodySchema, businessRuleVersionActionResponseSchema, createSettings, settingsResponseSchema } from './settings.js'
import { createDatabaseEmployeeKeys, createDatabaseEmployeeProfile, createDatabaseEmployeeUsage, createDemoEmployeeModels, employeeKeysResponseSchema, employeeModelsResponseSchema, employeeProfileResponseSchema, employeeUsageQuerySchema, employeeUsageResponseSchema } from './employee.js'
import { authErrorSchema, authResponseSchema, createAuthService, isRoleAllowed, loginBodySchema, seedDemoUsers, type AppRole, type AuthService } from './auth.js'
import { dataScopeFor, isDepartmentVisible } from './data-scope.js'
import { createPlatformDatabase, databaseStatusSchema, hashPlatformApiKey, seedDemoData, stableNewApiPersonId, type PlatformDatabase, type PlatformGatewayKey } from './platform-db.js'
import { createDatabaseSearch, searchQuerySchema, searchResponseSchema } from './search.js'
import { createQuotaRequestsResponse, quotaDecisionBodySchema, quotaRequestBodySchema, quotaRequestParamsSchema, quotaRequestQuerySchema, quotaRequestActionResponseSchema, quotaRequestsResponseSchema } from './quota-requests.js'
import { createQuotaReservationsResponse, quotaReservationActionBodySchema, quotaReservationActionResponseSchema, quotaReservationBodySchema, quotaReservationParamsSchema, quotaReservationQuerySchema, quotaReservationsResponseSchema, mapQuotaReservation } from './quota-reservations.js'
import { loadGatewayConfig, type GatewayConfig } from './gateway-config.js'
import { createGatewayRuntime, cpaCredentialInputSchema, normalizeGatewayUrl, type GatewayRuntimeStore } from './gateway-runtime.js'
import { registerGatewayRoutes } from './gateway/routes.js'
import { GatewayUpstreamError, type GatewayUpstream } from './gateway/openai-compatible.js'
import { createGatewayConnector } from './gateway/connectors.js'
import { CpaCatalogError, createCpaCatalog } from './gateway-catalog.js'
import { cpaAuthFileUploadSchema, cpaAuthVerificationSchema, cpaManagementInputSchema, CpaManagementError, decodeCpaAuthFile, deleteCpaAuthFile, downloadCpaAuthFile, getCpaAuthFileDetail, getCpaAuthFileModels, getCpaAuthFileSettings, getCpaCodexQuota, getCpaOAuthStatus, listCpaAuthFiles, normalizeCpaManagementBaseUrl, patchCpaAuthFileSettings, requestCpaAuthFileRefresh, setCpaAuthFileStatus, startCpaCodexOAuth, uploadCpaAuthFile, verifyCpaAuthFile, type CpaAuthFileSettings, type CpaAuthFileSummary } from './cpa-management.js'
import { resolveCpaApiKey } from './deployment-config.js'
import { createDefaultNewApiTokenClient, displayNewApiTokenMask, displayNewApiTokenSecret, extractNewApiToken, extractNewApiTokenSecret, extractNewApiTokens, maskNewApiToken, type NewApiTokenRecord } from './new-api-tokens.js'
import { createNewApiDatabaseReader, type NewApiDatabaseReader } from './new-api-database.js'
import { createCpaLogReader, type CpaLogReader } from './cpa-logs.js'
import { createNewApiModelAnalytics, modelAnalyticsQuerySchema, modelAnalyticsResponseSchema } from './model-analytics.js'
import { executePeopleSync, markPeopleSyncStale, personSyncBodySchema, personSyncPreviewResponseSchema, personSyncResponseSchema, PeopleSyncReadError, previewPeopleSync, readNewApiPeople } from './people-sync.js'
import type { NewApiTokenClient, NewApiTokenReader, NewApiUserReader } from './new-api-management.js'
import { buildChannelSyncPayload, buildChannelSyncPreview, channelSyncPreviewSchema, channelSyncSnapshotHash, channelSyncTarget, CPA_CHANNEL_MARKER, listAllNewApiChannels, managementResultError, NewApiChannelSyncError, normalizeChannelBaseUrl, normalizeNewApiChannelBaseUrl, type CpaChannelSourceSnapshot } from './new-api-channel-sync.js'
import { createDockerControl, dockerRestartTargetSchema, type DockerControl, type DockerRestartTarget } from './docker-control.js'

const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
})

const platformRestartBodySchema = z.object({ target: dockerRestartTargetSchema })
const platformRestartResponseSchema = z.object({
  status: z.literal('accepted'),
  target: dockerRestartTargetSchema,
  requestId: z.string(),
  message: z.string(),
})

const modelTestBodySchema = z.object({
  model: z.string().trim().min(1).max(256),
  channelId: z.string().trim().min(1).max(128).optional(),
})

const modelTestResponseSchema = z.object({
  meta: z.object({ source: z.literal('new_api'), completedAt: z.string().datetime(), notice: z.string() }),
  result: z.object({
    model: z.string(),
    channelId: z.string(),
    channelName: z.string(),
    status: z.enum(['passed', 'failed', 'unavailable']),
    latencyMs: z.number().int().nonnegative().nullable(),
    testedAt: z.string().datetime(),
    message: z.string().nullable(),
    testPath: z.string().nullable(),
  }),
  requestId: z.string(),
})

class ManagedKeyError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode: 400 | 409 | 502 | 503 = 400) {
    super(message)
    this.name = 'ManagedKeyError'
  }
}

class KeySecretNotRetrievableError extends Error {
  readonly code = 'KEY_SECRET_NOT_RETRIEVABLE'
  readonly statusCode = 410 as const

  constructor(message: string) {
    super(message)
    this.name = 'KeySecretNotRetrievableError'
  }
}

const cpaCredentialProbeSchema = z.object({
  status: z.enum(['healthy', 'empty']),
  modelCount: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
})

const cpaCredentialResponseSchema = z.object({
  meta: z.object({ source: z.literal('runtime'), completedAt: z.string().datetime(), notice: z.string() }),
  cpa: cpaCredentialProbeSchema,
  managementConfigured: z.boolean(),
  requestId: z.string(),
})

const cpaOAuthStartResponseSchema = z.object({ status: z.literal('ok'), url: z.string().url(), state: z.string().min(1).max(256), requestId: z.string() })
const cpaOAuthStatusResponseSchema = z.object({ status: z.enum(['wait', 'ok', 'error']), verification: cpaAuthVerificationSchema.optional(), requestId: z.string() })
const cpaOAuthStatusInputSchema = cpaManagementInputSchema.extend({ state: z.string().min(1).max(256).regex(/^[A-Za-z0-9._:-]+$/) })
const cpaAuthFilePublicSchema = z.object({
  id: z.string().max(256).optional(), name: z.string().max(256).optional(), provider: z.string().max(64).optional(), status: z.string().max(64).optional(), email: z.string().max(320).optional(), account: z.string().max(320).optional(), accountType: z.string().max(64).optional(), disabled: z.boolean().optional(), unavailable: z.boolean().optional(),
  size: z.number().nonnegative().optional(), modtime: z.string().max(128).optional(), createdAt: z.string().max(128).optional(), updatedAt: z.string().max(128).optional(), lastRefresh: z.string().max(128).optional(), success: z.number().int().nonnegative().optional(), failed: z.number().int().nonnegative().optional(),
  recentRequests: z.array(z.object({ time: z.string().max(64), success: z.number().int().nonnegative(), failed: z.number().int().nonnegative() })),
})
const cpaAuthFilesResponseSchema = z.object({ files: z.array(cpaAuthFilePublicSchema), requestId: z.string() })
const cpaAuthFileUploadResponseSchema = z.object({ status: z.literal('ok'), fileName: z.string(), format: z.enum(['cpa', 'codex_cli']), converted: z.boolean(), verification: cpaAuthVerificationSchema, requestId: z.string() })
const cpaVerifyInputSchema = cpaManagementInputSchema.extend({ fileName: z.string().trim().min(1).max(160).optional() })
const cpaVerifyResponseSchema = z.object({ status: z.literal('ok'), verification: cpaAuthVerificationSchema, requestId: z.string() })
const cpaAuthFileNameQuerySchema = z.object({ name: z.string().trim().min(1).max(256) })
const cpaAuthFileNameInputSchema = z.object({ name: z.string().trim().min(1).max(256) })
const cpaAuthFileStatusInputSchema = cpaAuthFileNameInputSchema.extend({ disabled: z.boolean() })
const cpaAuthFileActionResponseSchema = z.object({ status: z.literal('ok'), requestId: z.string() })
const cpaAuthFileModelsResponseSchema = z.object({ models: z.array(z.object({ id: z.string(), displayName: z.string(), ownedBy: z.string().optional(), type: z.string().optional() })), requestId: z.string() })
const cpaAuthFileSettingsSchema = z.object({ prefix: z.string(), proxyUrl: z.string(), priority: z.number().int().nonnegative().nullable(), weight: z.number().int().nonnegative().nullable(), disableCooling: z.boolean(), websockets: z.boolean(), usingApi: z.boolean(), note: z.string(), excludedModels: z.array(z.string()), headers: z.record(z.string(), z.string()) })
const cpaAuthFileSettingsInputSchema = cpaAuthFileNameInputSchema.extend({
  prefix: z.string().max(512).optional(), proxyUrl: z.string().max(2_048).optional(), priority: z.number().int().min(0).max(1_000_000).nullable().optional(), weight: z.number().int().min(0).max(1_000_000).nullable().optional(), disableCooling: z.boolean().optional(), websockets: z.boolean().optional(), usingApi: z.boolean().optional(), note: z.string().max(1_000).optional(), excludedModels: z.array(z.string().max(160)).max(100).optional(), headers: z.record(z.string(), z.string()).optional(),
})
const cpaAuthFileSettingsResponseSchema = z.object({ settings: cpaAuthFileSettingsSchema, requestId: z.string() })
const cpaAuthFileDetailResponseSchema = z.object({ detail: z.object({ infoJson: z.string().max(3_000_000), jsonPreview: z.string().max(3_000_000), settings: cpaAuthFileSettingsSchema }), requestId: z.string() })
const cpaAuthFileQuotaResponseSchema = z.object({ quota: z.object({ status: z.literal('success'), planType: z.string().nullable(), subscriptionActiveUntil: z.string().datetime().nullable(), windows: z.array(z.object({ id: z.string(), label: z.string(), usedPercent: z.number().min(0).max(100).nullable(), remainingPercent: z.number().min(0).max(100).nullable(), resetAt: z.string().datetime().nullable(), resetAfterSeconds: z.number().nonnegative().nullable() })), creditsAvailable: z.number().int().nonnegative().nullable(), checkedAt: z.string().datetime() }), requestId: z.string() })
const channelSyncBodySchema = z.object({ idempotencyKey: z.string().regex(/^channel-sync-[A-Za-z0-9._:-]{8,96}$/) })
const channelSyncResponseSchema = channelSyncPreviewSchema.extend({
  status: z.enum(['succeeded', 'unchanged']),
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string() }),
})

function publicCpaAuthFile(file: CpaAuthFileSummary) {
  return {
    ...(file.id ? { id: file.id } : {}),
    ...(file.name ? { name: file.name } : {}),
    ...(file.provider ? { provider: file.provider } : file.type ? { provider: file.type } : {}),
    ...(file.status ? { status: file.status } : {}),
    ...(file.email ? { email: file.email } : {}),
    ...(file.account ? { account: file.account } : {}),
    ...(file.account_type ? { accountType: file.account_type } : {}),
    ...(file.disabled !== undefined ? { disabled: file.disabled } : {}),
    ...(file.unavailable !== undefined ? { unavailable: file.unavailable } : {}),
    ...(file.size !== undefined ? { size: file.size } : {}),
    ...(file.modtime ? { modtime: file.modtime } : {}),
    ...(file.created_at ? { createdAt: file.created_at } : {}),
    ...(file.updated_at ? { updatedAt: file.updated_at } : {}),
    ...(file.last_refresh ? { lastRefresh: file.last_refresh } : {}),
    ...(file.success !== undefined ? { success: file.success } : {}),
    ...(file.failed !== undefined ? { failed: file.failed } : {}),
    recentRequests: file.recent_requests ?? [],
  }
}

type ModelChannelRef = {
  id: string
  name: string
  provider?: string
  source: 'cpa_auth_file' | 'new_api'
  modelIds: string[]
}

function epochOrIso(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return null
  const numeric = typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value).trim()) ? Number(value) : NaN
  const date = Number.isFinite(numeric) ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1_000) : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function newApiChannelId(value: string) {
  const match = /^(?:new-api-channel-)?(\d+)$/.exec(value.trim())
  return match?.[1] ?? null
}

function channelTestPath(channel: { advancedRoutes?: Array<{ incomingPath: string; upstreamPath: string }> }) {
  const route = channel.advancedRoutes?.find((item) => item.incomingPath === '/v1/chat/completions') ?? channel.advancedRoutes?.[0]
  return route?.upstreamPath ?? null
}

export interface BuildAppOptions {
  catalogReader?: CatalogReader
  logger?: boolean
  authMode?: 'required' | 'disabled'
  authService?: AuthService
  database?: PlatformDatabase
  databasePath?: string
  probeNewApi?: () => Promise<NewApiStatus>
  probeNewApiManagement?: () => Promise<NewApiManagementResponse>
  probeCpa?: () => Promise<PlatformProbeResult>
  probeDocs?: () => Promise<PlatformProbeResult>
  peopleManagementClient?: NewApiManagementClient
  peopleReadClient?: NewApiUserReader
  newApiManagementClient?: NewApiManagementClient
  gatewayConfig?: GatewayConfig
  gatewayUpstream?: GatewayUpstream
  resolveExternalClientKey?: (secret: string) => Promise<PlatformGatewayKey | null>
  gatewayRuntime?: GatewayRuntimeStore
  newApiTokenClient?: NewApiTokenClient
  newApiTokenReader?: NewApiTokenReader
  newApiDatabase?: NewApiDatabaseReader
  cpaLogReader?: CpaLogReader
  cpaModelReader?: () => Promise<readonly string[]>
  dockerControl?: DockerControl
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    genReqId: () => `req-${crypto.randomUUID()}`,
    logController: new LogController({ disableRequestLogging: true }),
  }).withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  app.register(helmet, { contentSecurityPolicy: false })
  app.register(cors, {
    origin: ['http://127.0.0.1:4174', 'http://localhost:4174'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  })
  app.register(rateLimit, { max: 120, timeWindow: '1 minute' })

  const authMode = options.authMode ?? (process.env.AUTH_MODE === 'disabled' ? 'disabled' : 'required')
  const gatewayConfig = options.gatewayConfig ?? loadGatewayConfig()
  const gatewayRuntime = options.gatewayRuntime ?? createGatewayRuntime()
  const dockerControl = options.dockerControl ?? createDockerControl()
  let lastDockerRestartAt = 0
  const database = options.database ?? createPlatformDatabase({ filename: options.databasePath ?? process.env.PLATFORM_DB_PATH ?? (authMode === 'disabled' ? ':memory:' : undefined) })
  const peopleManagementClient = options.peopleManagementClient
    ?? options.newApiManagementClient
    ?? createNewApiManagementClient({ baseUrl: process.env.NEW_API_BASE_URL, accessToken: process.env.NEW_API_ACCESS_TOKEN, userId: process.env.NEW_API_USER_ID })
  const newApiManagementClient = options.newApiManagementClient ?? peopleManagementClient

  type LiveModelContext = {
    authChannels: ModelChannelRef[]
    newApiChannels: NewApiChannel[]
  }
  let liveModelContextCache: { expires: number; value: LiveModelContext } | undefined
  let liveModelContextPending: Promise<LiveModelContext> | undefined

  async function loadLiveModelContext(): Promise<LiveModelContext> {
    if (liveModelContextCache && liveModelContextCache.expires > Date.now()) return liveModelContextCache.value
    if (!liveModelContextPending) {
      liveModelContextPending = (async () => {
        const authChannels: ModelChannelRef[] = []
        try {
          const files = await listCpaAuthFiles()
          const candidates = files.filter((file) => !file.disabled && !file.unavailable && (file.name || file.id)).slice(0, 50)
          const mapped: Array<ModelChannelRef | null> = await Promise.all(candidates.map(async (file): Promise<ModelChannelRef | null> => {
            const name = file.name ?? file.id
            if (!name) return null
            let modelIds: string[] = []
            try {
              modelIds = (await getCpaAuthFileModels({}, name)).map((model) => model.id)
            } catch {
              const quotas = file.model_quotas
              if (quotas && typeof quotas === 'object' && !Array.isArray(quotas)) modelIds = Object.keys(quotas)
            }
            return {
              id: `cpa-auth-file-${encodeURIComponent(name)}`,
              name,
              provider: file.provider ?? file.type ?? 'codex',
              source: 'cpa_auth_file' as const,
              modelIds: [...new Set(modelIds)],
            }
          }))
          // A model may be backed by several CPA auth files. The page is
          // interested in the channel/source, not individual accounts, so
          // collapse files from the same provider into one display channel.
          const grouped = new Map<string, ModelChannelRef>()
          for (const item of mapped) {
            if (!item) continue
            const rawProvider = (item.provider ?? '').trim().toLowerCase()
            const providerKey = rawProvider.includes('codex') ? 'codex' : rawProvider || 'codex'
            const existing = grouped.get(providerKey)
            if (existing) {
              existing.modelIds = [...new Set([...existing.modelIds, ...item.modelIds])]
            } else {
              grouped.set(providerKey, {
                id: `cpa-auth-source-${encodeURIComponent(providerKey)}`,
                name: providerKey === 'codex' ? 'Codex' : (item.provider?.trim() || item.name),
                provider: providerKey === 'codex' ? 'Codex' : (item.provider?.trim() || item.name),
                source: 'cpa_auth_file',
                modelIds: [...new Set(item.modelIds)],
              })
            }
          }
          authChannels.push(...grouped.values())
        } catch {
          // The model catalog remains useful when CPA management is not
          // configured; it falls back to the aggregate CPA channel below.
        }

        let newApiChannels: LiveModelContext['newApiChannels'] = []
        if (newApiManagementClient.authConfigured) {
          try {
            const response = await newApiManagementClient.listChannels()
            if (response.state === 'ready' && response.data) newApiChannels = response.data.items
          } catch {
            newApiChannels = []
          }
        }
        const value = { authChannels, newApiChannels }
        liveModelContextCache = { expires: Date.now() + 30_000, value }
        return value
      })().finally(() => { liveModelContextPending = undefined })
    }
    return liveModelContextPending
  }

  async function enrichCpaModels<T extends { items: Array<{ actualModel: string; channelIds: string[] }> }>(response: T): Promise<T> {
    const context = await loadLiveModelContext()
    const newApiChannels = context.newApiChannels
    const authChannels = context.authChannels
    const displayAuthChannels: ModelChannelRef[] = authChannels.length > 0 ? authChannels : [{
      id: 'cpa-auth-source-codex',
      name: 'Codex',
      provider: 'Codex',
      source: 'cpa_auth_file',
      modelIds: response.items.map((item) => item.actualModel),
    }]
    const aggregateFallback: ModelChannelRef[] = newApiChannels.map((channel) => ({
      id: channel.id,
      name: channel.name || `New API 渠道 ${channel.id}`,
      provider: 'New API',
      source: 'new_api',
      modelIds: channel.models,
    }))
    return {
      ...response,
      items: response.items.map((item) => {
        const matchingAuth = displayAuthChannels.filter((channel) => channel.modelIds.length === 0 || channel.modelIds.includes(item.actualModel))
        const matchingNewApi = aggregateFallback.filter((channel) => channel.modelIds.includes(item.actualModel))
        const channels = (matchingAuth.length ? matchingAuth : displayAuthChannels.length ? displayAuthChannels : matchingNewApi.length ? matchingNewApi : aggregateFallback)
        const candidateTestChannel = newApiChannels.find((channel) => channel.models.includes(item.actualModel)) ?? newApiChannels.find((channel) => channel.enabled !== false)
        // New API's cached timestamp belongs to the channel's configured
        // test_model. Do not present that result as if every listed model had
        // already been tested.
        const testedChannel = candidateTestChannel && candidateTestChannel.testModel === item.actualModel
          ? candidateTestChannel
          : undefined
        const testedAt = epochOrIso(testedChannel?.testTime)
        const cachedStatus = !newApiChannels.length
          ? 'unavailable' as const
          : !testedChannel
            ? 'not_tested' as const
            : testedChannel.enabled === false
              ? 'failed' as const
              : testedAt && testedChannel.responseTimeMs !== null
                ? 'passed' as const
                : 'not_tested' as const
        return {
          ...item,
          channels: channels.map(({ id, name, provider, source }) => ({ id, name, ...(provider ? { provider } : {}), source })),
          testResult: {
            status: cachedStatus,
            latencyMs: testedChannel?.responseTimeMs ?? null,
            testedAt,
            channelId: testedChannel?.id ?? null,
            message: null,
            testPath: testedChannel ? channelTestPath(testedChannel) : null,
          },
        }
      }),
    }
  }

  function invalidateLiveModelContext() {
    liveModelContextCache = undefined
  }
  const newApiDatabase = options.newApiDatabase ?? createNewApiDatabaseReader()
  const cpaLogReader = options.cpaLogReader ?? createCpaLogReader()
  const peopleReadClient = options.peopleReadClient ?? newApiDatabase ?? peopleManagementClient
  const newApiTokenClient = options.newApiTokenClient ?? createDefaultNewApiTokenClient()
  const newApiTokenReader = options.newApiTokenReader ?? newApiDatabase ?? newApiTokenClient
  const upstreamDataPrimary = process.env.NODE_ENV === 'production' || process.env.AI_OPS_UPSTREAM_PRIMARY === 'true' || Boolean(newApiDatabase)
  let peopleAutoSyncAt = 0
  let peopleAutoSyncPromise: Promise<void> | null = null
  async function autoSyncPeople(actorUserId: string | null, requestId: string) {
    if (!newApiDatabase && !peopleManagementClient.authConfigured) return
    if (peopleAutoSyncPromise) return peopleAutoSyncPromise
    if (Date.now() - peopleAutoSyncAt < 15_000) return
    peopleAutoSyncAt = Date.now()
    peopleAutoSyncPromise = (async () => {
      try {
        const preview = await previewPeopleSync(peopleReadClient, database, new Date())
        const idempotencyKey = `people-auto-${preview.snapshotHash.slice(0, 32)}`
        await executePeopleSync(peopleReadClient, database, idempotencyKey, {
          id: `audit-${idempotencyKey}`,
          actorUserId,
          action: 'sync',
          resourceType: 'people',
          resourceId: 'new-api',
          result: 'success',
          requestId,
          summary: { code: 'PEOPLE_AUTO_SYNC', message: '已自动对齐 New API 普通用户与 AI OPS 人员目录；管理员未进入人员目录。' },
        }, new Date())
      } catch {
        markPeopleSyncStale(database)
      } finally {
        peopleAutoSyncPromise = null
      }
    })()
    return peopleAutoSyncPromise
  }

  async function refreshPeopleMirrorForMutation(actorUserId: string | null, requestId: string) {
    if (!peopleManagementClient.authConfigured) throw new ManagedKeyError('NEW_API_UNAVAILABLE', 'New API 管理凭据未配置，无法执行远端人员操作', 503)
    const idempotencyKey = `people-mutation-${crypto.randomUUID().replaceAll('-', '').slice(0, 32)}`
    try {
      await executePeopleSync(peopleReadClient, database, idempotencyKey, {
        id: `audit-${idempotencyKey}`,
        actorUserId,
        action: 'sync',
        resourceType: 'people',
        resourceId: 'new-api',
        result: 'success',
        requestId,
        summary: { code: 'PEOPLE_MUTATION_REFRESH', message: '执行远端人员操作前刷新 New API 人员镜像；远端结果作为主数据。' },
      }, new Date())
    } catch (error) {
      if (error instanceof PeopleSyncReadError) {
        throw new ManagedKeyError('NEW_API_UNAVAILABLE', error.message, error.state === 'auth_required' ? 503 : 502)
      }
      throw error
    }
  }

  async function loadRemotePersonForMutation(id: string, actorUserId: string | null, requestId: string, scope: ReturnType<typeof dataScopeFor>) {
    // The local mirror already carries the external user ID required by the
    // authoritative status mutation. Reuse it before attempting a full
    // directory read so a transient read failure cannot block a status write.
    const local = createDatabasePersonDetail(database, id, {
      state: 'ready',
      authConfigured: true,
      checkedAt: new Date().toISOString(),
    }, new Date(), scope)
    if (local?.profile.externalUserId) return local
    if (!peopleManagementClient.authConfigured) throw new ManagedKeyError('NEW_API_UNAVAILABLE', 'New API 管理凭据未配置，无法执行远端人员操作', 503)
    let source: Awaited<ReturnType<typeof readNewApiPeople>>
    try {
      source = await readNewApiPeople(peopleReadClient, database)
    } catch (error) {
      if (error instanceof PeopleSyncReadError) throw new ManagedKeyError('NEW_API_UNAVAILABLE', error.message, error.state === 'auth_required' ? 503 : 502)
      throw error
    }
    const remote = createNewApiPersonDetail(source.people, [], id, new Date(), scope)
    if (!remote) return null
    await refreshPeopleMirrorForMutation(actorUserId, requestId)
    return remote
  }
  // Keep the local login accounts available while allowing internal tests to
  // start from an empty business database. Demo business data is opt-in once
  // AI_OPS_SEED_DEMO_DATA=false is set in the local environment.
  seedDemoUsers(database)
  if (process.env.AI_OPS_SEED_DEMO_DATA !== 'false') seedDemoData(database)
  database.cleanupConversationAuditMetadata('startup')
  database.cleanupAuthSessions('startup')
  const auth = options.authService ?? createAuthService({ database })
  const catalog = createModelCatalog(options.catalogReader ?? newApiDatabase ?? undefined)
  const gatewayUpstream = options.gatewayUpstream ?? createGatewayConnector(gatewayConfig)
  // The request data plane is New API in the production pipeline, but the
  // model/channel catalog still needs a separate CPA adapter so CPA remains
  // visible as the account-pool source instead of being treated as the active
  // employee gateway.
  const cpaCatalogConfig: GatewayConfig = {
    ...gatewayConfig,
    mode: 'cpa',
    baseUrl: process.env.AI_OPS_GATEWAY_CPA_BASE_URL ?? (gatewayConfig.mode === 'cpa' ? gatewayConfig.baseUrl : undefined),
    upstreamApiKey: resolveCpaApiKey() ?? (gatewayConfig.mode === 'cpa' ? gatewayConfig.upstreamApiKey : undefined),
    upstreamConfigured: Boolean(process.env.AI_OPS_GATEWAY_CPA_BASE_URL?.trim() && resolveCpaApiKey()) || (gatewayConfig.mode === 'cpa' && gatewayConfig.upstreamConfigured),
  }
  const cpaCatalogUpstream = options.gatewayUpstream && gatewayConfig.mode === 'cpa' ? gatewayUpstream : createGatewayConnector(cpaCatalogConfig)
  const cpaCatalog = createCpaCatalog(cpaCatalogUpstream, cpaCatalogConfig)

  const managedKeysEnabled = newApiTokenClient.authConfigured
  const managedTokenSourceAvailable = Boolean(newApiDatabase) || newApiTokenClient.authConfigured || Boolean(options.newApiTokenReader)
  let managedTokenSyncAt = 0
  let managedTokenSyncPromise: Promise<void> | null = null
  const remoteTokenError = (result: { state: string; statusCode?: number; message?: string | null }) => result.state === 'auth_required'
    ? new ManagedKeyError('NEW_API_UNAVAILABLE', result.message ?? 'New API 管理认证未通过，请检查服务端管理凭据', 503)
    : new ManagedKeyError('NEW_API_UNAVAILABLE', result.message ?? 'New API 管理接口当前不可用，请稍后重试', result.statusCode === 401 || result.statusCode === 403 ? 503 : 502)
  const remotePersonError = (result: { state: string; message: string | null }) => new ManagedKeyError(
    'NEW_API_UNAVAILABLE',
    result.message ?? 'New API 用户状态同步失败，请稍后重试',
    result.state === 'auth_required' ? 503 : 502,
  )

  function externalUserIdForPerson(person: ReturnType<PlatformDatabase['listPeople']>[number]) {
    if (person.externalUserId) return person.externalUserId
    const match = /^person-([0-9]+)$/.exec(person.id)
    return match?.[1] ?? null
  }

  async function verifyManagedPerson(person: ReturnType<PlatformDatabase['listPeople']>[number], externalUserId: string) {
    if (!peopleManagementClient.authConfigured) return
    const result = await peopleManagementClient.getUser(externalUserId)
    if (result.state !== 'ready' || !result.data) throw remoteTokenError(result)
    if (result.data.id !== externalUserId) throw new ManagedKeyError('PERSON_NOT_ACTIVE', '该人员未匹配到 New API 用户', 400)
    const status = result.data.status
    const active = status === true || status === 1 || status === '1' || status === 'active' || status === 'enabled'
    if (!active) throw new ManagedKeyError('PERSON_NOT_ACTIVE', '该人员在 New API 中不是 active 状态', 400)
    if (person.status !== 'active') throw new ManagedKeyError('PERSON_NOT_ACTIVE', '请选择有效的在职人员', 400)
  }

  async function resolveManagedTokenOwnerId() {
    // New API rc.37 creates a Token for the authenticated management user and
    // ignores a target user_id in the request body. Resolve that identity once
    // and use it consistently for create, detail, key retrieval, validation,
    // and rollback. The selected person remains an AI OPS display mapping.
    if (peopleManagementClient.authConfigured) {
      const result = await peopleManagementClient.getSelfUser()
      if (result.state !== 'ready' || !result.data) throw remoteTokenError(result)
      const status = result.data.status
      const active = status === true || status === 1 || status === '1' || status === 'active' || status === 'enabled'
      if (status !== null && !active) throw new ManagedKeyError('NEW_API_UNAVAILABLE', '当前 New API 管理账号已停用，无法创建 Key', 503)
      const roleNumber = typeof result.data.role === 'number' ? result.data.role : Number(result.data.role)
      const hasAdminRole = result.data.isAdmin === true || (Number.isFinite(roleNumber) && roleNumber >= 10)
      if (result.data.isAdmin === false && Number.isFinite(roleNumber) && !hasAdminRole) throw new ManagedKeyError('NEW_API_UNAVAILABLE', '当前 New API 凭据不是管理员账号，无法创建 Key', 503)
      return result.data.id
    }
    // This fallback keeps isolated adapter tests and explicitly injected token
    // clients usable. The deployed management client resolves /self above.
    return process.env.NEW_API_USER_ID?.trim() || '1'
  }

  async function syncRemotePersonStatus(person: { profile: { externalUserId?: string | null } }, status: 0 | 1) {
    const externalUserId = person.profile.externalUserId
    if (!externalUserId) return
    if (!peopleManagementClient.authConfigured) throw new ManagedKeyError('NEW_API_UNAVAILABLE', 'New API 管理凭据未配置，无法同步远程用户状态', 503)
    const result = status === 1
      ? await peopleManagementClient.enableUser(externalUserId)
      : await peopleManagementClient.disableUser(externalUserId)
    if (result.state !== 'ready') throw remotePersonError(result)
  }

  async function deleteRemotePerson(person: { profile: { externalUserId?: string | null } }) {
    const externalUserId = person.profile.externalUserId
    if (!externalUserId) throw new ManagedKeyError('REMOTE_SOURCE_OF_TRUTH', '该人员缺少 New API 用户映射，无法执行远程删除', 409)
    if (!peopleManagementClient.authConfigured) throw new ManagedKeyError('NEW_API_UNAVAILABLE', 'New API 管理凭据未配置，无法删除远程用户', 503)
    const result = await peopleManagementClient.deleteUser(externalUserId)
    if (result.state !== 'ready') {
      const statusCode = result.state === 'auth_required' ? 503 : 502
      throw new ManagedKeyError('NEW_API_UNAVAILABLE', result.message ?? 'New API 用户删除失败，请稍后重试', statusCode)
    }
  }

  async function createRemotePerson(body: z.infer<typeof personCreateBodySchema>, actorUserId: string | null, requestId: string) {
    const username = body.username?.trim() || body.displayName.trim()
    const departmentName = database.findActiveDepartmentName(body.departmentId) ?? body.departmentId.trim()
    const existingResult = await peopleManagementClient.findUserByUsername(username)
    if (existingResult.state !== 'ready') throw remoteTokenError(existingResult)
    let remote = existingResult.data
    if (remote) {
      const roleNumber = typeof remote.role === 'number' ? remote.role : Number(remote.role)
      if (remote.isAdmin === true || (Number.isFinite(roleNumber) && roleNumber >= 100)) {
        throw new ManagedKeyError('USERNAME_CONFLICT', '该用户名已属于 New API 管理员，不能作为普通人员导入', 409)
      }
      if ((remote.displayName?.trim() || '') !== departmentName) {
        throw new ManagedKeyError('USERNAME_CONFLICT', 'New API 中已存在同名用户，但显示名称与部门不一致', 409)
      }
    } else {
      const created = await peopleManagementClient.createUser({
        username,
        displayName: departmentName,
        password: body.password ?? randomBytes(24).toString('base64url'),
      })
      if (created.state !== 'ready') throw remoteTokenError(created)
      remote = created.data ?? (await peopleManagementClient.findUserByUsername(username)).data
    }
    if (!remote) throw new ManagedKeyError('PERSON_CREATE_FAILED', 'New API 已处理请求，但未返回可确认的用户记录', 502)

    const syncKey = `people-sync-create-${createHash('sha256').update(`${remote.id}:${username}:${departmentName}`).digest('hex').slice(0, 32)}`
    const sync = await executePeopleSync(peopleManagementClient, database, syncKey, {
      id: `audit-${syncKey}`,
      actorUserId,
      action: 'create',
      resourceType: 'person',
      resourceId: remote.id,
      result: 'success',
      requestId,
      summary: { code: 'NEW_API_PERSON_CREATED', message: '人员已写入 New API users 表，并同步到 AI OPS 人员镜像；不保存员工登录密码。', externalUserId: remote.id, username, department: departmentName },
    }, new Date())
    const person = database.listSyncedPeople().find((item) => item.externalUserId === remote.id)
    if (!person) throw new ManagedKeyError('PERSON_CREATE_FAILED', 'New API 用户已创建，但 AI OPS 镜像未完成同步', 502)
    return { person, created: !existingResult.data, auditEventId: sync.operation.auditEventId }
  }

  function keyOperationId(request: { headers: Record<string, string | string[] | undefined> }) {
    const header = request.headers['idempotency-key']
    const value = Array.isArray(header) ? header[0] : header
    if (value && /^[A-Za-z0-9._:-]{8,96}$/.test(value)) return value
    return `key-create-${crypto.randomUUID()}`
  }

  function managedTokenConfigurationIsValid(token: NewApiTokenRecord, model: string, externalUserId: string) {
    return token.status === 'active'
      && token.userId === externalUserId
      && token.unlimitedQuota === true
      && token.expiresAt === null
      && token.modelLimitsEnabled === true
      && token.modelLimits.length === 1
      && token.modelLimits[0] === model
      && (token.group === null || token.group === '')
      && Boolean(token.secret)
  }

  async function cpaModelIds() {
    if (options.cpaModelReader) return [...new Set((await options.cpaModelReader()).map((item) => item.trim()).filter(Boolean))]
    const response = await cpaCatalog.models({ source: 'cpa', search: '', capability: 'all', environment: 'all', status: 'all' })
    return [...new Set(response.items.filter((item) => item.status === 'available' && item.channelIds.length > 0).map((item) => item.actualModel).filter(Boolean))]
  }

  async function readCpaChannelSource(now = new Date()): Promise<CpaChannelSourceSnapshot> {
    const checkedAt = now.toISOString()
    const configuredBaseUrl = cpaCatalogConfig.baseUrl?.trim() ?? ''
    const baseUrl = configuredBaseUrl ? normalizeGatewayUrl(configuredBaseUrl) : ''
    // A model reader is an explicit test/integration seam. In a deployed
    // process, credentialConfigured must come from the server-side CPA key.
    const credentialConfigured = Boolean(cpaCatalogConfig.upstreamApiKey?.trim()) || Boolean(options.cpaModelReader)
    if (!baseUrl || !credentialConfigured) return { state: 'not_configured', baseUrl, modelIds: [], credentialConfigured, checkedAt }
    try {
      return { state: 'ready', baseUrl, modelIds: await cpaModelIds(), credentialConfigured, checkedAt }
    } catch (error) {
      if (error instanceof CpaCatalogError) {
        const state: CpaChannelSourceSnapshot['state'] = error.code === 'CPA_NOT_CONFIGURED'
          ? 'not_configured'
          : error.code === 'CPA_AUTH_REQUIRED'
            ? 'auth_required'
            : error.code === 'CPA_INVALID_DATA'
              ? 'invalid_response'
              : 'unavailable'
        return { state, baseUrl, modelIds: [], credentialConfigured, checkedAt }
      }
      return { state: 'unavailable', baseUrl, modelIds: [], credentialConfigured, checkedAt }
    }
  }

  async function syncManagedToken(token: NewApiTokenRecord) {
    if (!token.userId) return null
    const model = token.modelLimits[0] ?? '未绑定模型'
    const existing = database.findApiKeyByExternalTokenId(token.id)
    const person = existing
      ? database.findPerson(existing.ownerUserId)
      : database.findPersonByExternalId(token.userId) ?? database.findPerson(`person-${token.userId}`)
    if (!person) return null
    const localId = database.findApiKeyByExternalTokenId(token.id)?.id ?? newApiKeyId(token.id)
    return database.upsertExternalApiKey({
      id: localId,
      ownerUserId: person.id,
      maskedValue: token.masked,
      purpose: token.name,
      status: token.status === 'active' ? 'active' : 'revoked',
      expiresAt: token.expiresAt,
      model,
      models: token.modelLimits.length ? token.modelLimits : [model],
      externalTokenId: token.id,
      quotaMode: token.unlimitedQuota === true ? 'unlimited' : 'legacy',
      createdAt: token.createdAt,
      lastUsedAt: token.lastUsedAt,
      lastSyncedAt: new Date().toISOString(),
    })
  }

  /**
   * WorkBuddy receives the real New API Token, while the body-capturing
   * boundary is this AI OPS gateway. Resolve that credential against the
   * read-only New API database and then use the mirrored AI OPS key metadata
   * for ownership/model enforcement. The token secret is compared in the
   * New API reader and never returned or persisted here.
   */
  async function resolveExternalGatewayKey(secret: string): Promise<PlatformGatewayKey | null> {
    if (!newApiDatabase) return null
    const token = await newApiDatabase.findTokenBySecret(secret)
    if (!token || token.status !== 'active' || (token.expiresAt !== null && token.expiresAt <= new Date().toISOString())) return null
    let mirrored = database.findApiKeyByExternalTokenId(token.id)
    // A freshly-created managed Token may not have been mirrored yet if the
    // operator has not reopened the Key page. Populate only this Token's safe
    // metadata before deciding whether it can enter the audited data plane.
    if (!mirrored && managedTokenSourceAvailable) {
      try {
        const listed = (await readManagedTokens()).find((item) => item.id === token.id)
        if (listed) {
          await syncManagedToken(listed)
          mirrored = database.findApiKeyByExternalTokenId(token.id)
        }
      } catch {
        // Keep authentication fail-closed when the mirror cannot be updated.
      }
    }
    if (!mirrored || !['active', 'expiring'].includes(mirrored.status)) return null
    if (mirrored.expiresAt !== null && mirrored.expiresAt <= new Date().toISOString()) return null
    const owner = database.findPerson(mirrored.ownerUserId)
    if (owner && owner.status !== 'active') return null
    const models = token.modelLimits.length ? token.modelLimits : mirrored.models
    const model = models[0] ?? mirrored.model
    return {
      id: mirrored.id,
      ownerUserId: mirrored.ownerUserId,
      ownerName: mirrored.ownerName,
      departmentName: mirrored.departmentName ?? '未分配部门',
      maskedValue: mirrored.maskedValue,
      externalTokenId: token.id,
      purpose: mirrored.purpose,
      model,
      models: models.length ? models : [model],
      status: mirrored.status as 'active' | 'expiring',
      expiresAt: mirrored.expiresAt,
    }
  }

  function managedTokenDisplayOwners(people: Awaited<ReturnType<typeof readNewApiPeople>>['people']) {
    const peopleById = new Map(database.listPeople().map((person) => [person.id, person]))
    const peopleByExternalId = new Map(people.map((person) => [person.externalUserId, person]))
    const owners = new Map<string, (typeof people)[number]>()
    for (const key of database.listApiKeys()) {
      if (!key.externalTokenId) continue
      const localPerson = peopleById.get(key.ownerUserId)
      const externalUserId = localPerson?.externalUserId
      const owner = externalUserId ? peopleByExternalId.get(externalUserId) : undefined
      if (owner) owners.set(key.externalTokenId, owner)
    }
    return owners
  }

  function preserveLocalTokenMask(token: NewApiTokenRecord) {
    if (token.masked !== '未返回掩码') return token
    const local = database.findApiKeyByExternalTokenId(token.id)
    return local ? { ...token, masked: displayNewApiTokenMask(local.maskedValue) } : token
  }

  async function readManagedTokens(userId?: string) {
    const tokens: NewApiTokenRecord[] = []
    for (let page = 1; page <= 20; page += 1) {
      const result = await newApiTokenReader.listTokens(page, 100, userId)
      if (result.state !== 'ready') throw remoteTokenError(result)
      const pageItems = extractNewApiTokens(result.data).map(preserveLocalTokenMask)
      tokens.push(...pageItems)
      const data = result.data && typeof result.data === 'object' && !Array.isArray(result.data) ? result.data as Record<string, unknown> : null
      const total = typeof data?.total === 'number' ? data.total : null
      if (!pageItems.length || pageItems.length < 100 || (total !== null && tokens.length >= total)) break
    }
    return tokens
  }

  async function syncManagedTokens() {
    const tokens = await readManagedTokens()
    for (const token of tokens) await syncManagedToken(token)
    return tokens
  }

  async function autoSyncManagedTokens() {
    if (!managedTokenSourceAvailable) return
    if (managedTokenSyncPromise) return managedTokenSyncPromise
    if (Date.now() - managedTokenSyncAt < 15_000) return
    managedTokenSyncAt = Date.now()
    managedTokenSyncPromise = (async () => {
      try {
        await syncManagedTokens()
      } catch {
        // Keep the last known local mapping when New API Token data is
        // temporarily unavailable; the next refresh retries the mirror.
      } finally {
        managedTokenSyncPromise = null
      }
    })()
    return managedTokenSyncPromise
  }

  async function remoteKeyResponse(query: z.infer<typeof keysQuerySchema>, now: Date, scope: ReturnType<typeof dataScopeFor>) {
    const source = await readNewApiPeople(peopleReadClient, database)
    const tokens = await readManagedTokens()
    for (const token of tokens) await syncManagedToken(token)
    const response = createNewApiKeys(tokens, source.people, query, now, scope, managedTokenDisplayOwners(source.people))
    let models: string[] = []
    try { models = await cpaModelIds() } catch { models = [] }
    return {
      ...response,
      meta: { ...response.meta, source: 'new_api' as const, notice: `${response.meta.notice} CPA 可用模型目录用于校验绑定模型。` },
      options: { ...response.options, models: models.length ? models : response.options.models },
    }
  }

  async function remoteKeyDetail(id: string, now: Date, scope: ReturnType<typeof dataScopeFor>) {
    const source = await readNewApiPeople(peopleReadClient, database)
    const tokens = await readManagedTokens()
    for (const token of tokens) await syncManagedToken(token)
    return createNewApiKeyDetail(tokens, source.people, id, now, scope, managedTokenDisplayOwners(source.people))
  }

  async function remoteKeySecret(id: string, now: Date, scope: ReturnType<typeof dataScopeFor>) {
    let people: Awaited<ReturnType<typeof readNewApiPeople>>['people']
    try {
      people = (await readNewApiPeople(peopleReadClient, database)).people
    } catch (error) {
      // Isolated adapter tests and deployments with a custom Token client may
      // have a local person mirror but no separate people-management client.
      // Use that already-authorized mirror only when no people credentials are
      // configured; a configured but failing upstream must remain fail-closed.
      if (!(error instanceof PeopleSyncReadError) || peopleManagementClient.authConfigured) throw error
      people = database.listPeople().flatMap((person) => (
        person.externalUserId && person.departmentId && person.departmentName
          ? [{ externalUserId: person.externalUserId, username: person.username, displayName: person.displayName, departmentId: person.departmentId, departmentName: person.departmentName, status: person.status, createdAt: null, lastUsedAt: null, sourceDisplayName: null, sourceGroup: null, sourceRole: null }]
          : []
      ))
    }
    const ownerId = await resolveManagedTokenOwnerId()
    const tokens = await readManagedTokens(ownerId)
    for (const token of tokens) await syncManagedToken(token)
    const token = tokens.find((item) => newApiKeyId(item.id) === id)
    if (!token) return null
    const visible = createNewApiKeyDetail(tokens, people, id, now, scope, managedTokenDisplayOwners(people))
    if (!visible) return null
    if (!newApiTokenClient.getTokenKey) {
      throw new KeySecretNotRetrievableError('当前 New API 未提供按需读取 Key 的接口，请重新创建 Token')
    }
    const result = await newApiTokenClient.getTokenKey(token.id, ownerId)
    if (result.state !== 'ready' || !result.data) throw remoteTokenError(result)
    // Prefer the one-time secret endpoint, but retain a genuine in-memory
    // value returned by a compatible token listing as a fallback. Both paths
    // reject masks (including the bullet-style mask shown in the UI).
    const secret = extractNewApiTokenSecret(result.data) ?? token.secret
    if (!secret) throw new ManagedKeyError('KEY_SECRET_UNAVAILABLE', 'New API 未返回可复制的完整 Key，请稍后重试', 409)
    return { visible, secret: displayNewApiTokenSecret(secret) }
  }

  async function loadRemoteKeyForMutation(id: string, actorUserId: string | null, requestId: string, scope: ReturnType<typeof dataScopeFor>) {
    let source: Awaited<ReturnType<typeof readNewApiPeople>>
    try {
    source = await readNewApiPeople(peopleReadClient, database)
    } catch (error) {
      if (error instanceof PeopleSyncReadError) throw new ManagedKeyError('NEW_API_UNAVAILABLE', error.message, error.state === 'auth_required' ? 503 : 502)
      throw error
    }
    const tokens = await readManagedTokens()
    const token = tokens.find((item) => newApiKeyId(item.id) === id)
    if (!token) return null
    await refreshPeopleMirrorForMutation(actorUserId, requestId)
    for (const item of tokens) await syncManagedToken(item)
    const visible = createNewApiKeyDetail(tokens, source.people, id, new Date(), scope, managedTokenDisplayOwners(source.people))
    return visible ? { visible, externalTokenId: token.id, externalUserId: token.userId } : null
  }

  async function createManagedKey(personId: string, purpose: string, model: string, operationId: string, actorUserId: string | null, requestId: string) {
    if (peopleManagementClient.authConfigured) await refreshPeopleMirrorForMutation(actorUserId, requestId)
    const person = database.findPerson(personId) ?? database.findPersonByExternalId(personId) ?? database.findPerson(`person-${personId}`)
    if (database.findApiKeyOperation(operationId)) throw new ManagedKeyError('TOKEN_ALREADY_CREATED', '该幂等操作已创建过 Token，不能再次返回明文 Key', 409)
    if (!person || person.status !== 'active') throw new ManagedKeyError('PERSON_NOT_ACTIVE', '请选择有效的在职人员', 400)
    if (!person.departmentId || !person.departmentName) throw new ManagedKeyError('PERSON_DEPARTMENT_MISSING', '该人员缺少部门信息，无法创建 Key', 400)
    const externalUserId = externalUserIdForPerson(person)
    if (!externalUserId) throw new ManagedKeyError('PERSON_EXTERNAL_ID_MISSING', '该人员尚未关联 New API 用户，无法创建 Key', 409)
    await verifyManagedPerson(person, externalUserId)

    let availableModels: string[]
    try { availableModels = await cpaModelIds() } catch { throw new ManagedKeyError('MODEL_NOT_AVAILABLE', 'CPA 当前没有可用的真实模型目录', 503) }
    if (!availableModels.includes(model)) throw new ManagedKeyError('MODEL_NOT_AVAILABLE', '请求模型不在 CPA 已同步的可用模型列表中', 400)
    const managedTokenOwnerId = await resolveManagedTokenOwnerId()

    const name = purpose.trim()
    const created = await newApiTokenClient.createToken({
      user_id: managedTokenOwnerId,
      name,
      expired_time: -1,
      remain_quota: 0,
      unlimited_quota: true,
      model_limits_enabled: true,
      model_limits: model,
      group: '',
      status: 1,
    })
    if (created.state !== 'ready') throw remoteTokenError(created)

    let token = extractNewApiToken(created.data)
    if (!token?.id) {
      const listed = await newApiTokenClient.listTokens(1, 100, managedTokenOwnerId)
      if (listed.state === 'ready') token = extractNewApiTokens(listed.data).find((item) => item.name === name) ?? null
    }
    if (token?.id) {
      const detail = await newApiTokenClient.getToken(token.id, managedTokenOwnerId)
      if (detail.state !== 'ready') {
        await newApiTokenClient.updateTokenStatus(token.id, 0, managedTokenOwnerId)
        throw remoteTokenError(detail)
      }
      const detailedToken = extractNewApiToken(detail.data)
      if (!detailedToken) {
        await newApiTokenClient.updateTokenStatus(token.id, 0, managedTokenOwnerId)
        throw new ManagedKeyError('MODEL_LIMIT_NOT_SUPPORTED', 'New API 未返回可验证的 Token 详情，已停止使用该 Token', 502)
      }
      if (detailedToken) token = {
        ...token,
        ...detailedToken,
        userId: detailedToken.userId ?? token.userId,
        name: detailedToken.name || token.name,
        secret: detailedToken.secret ?? token.secret,
        masked: detailedToken.secret ? maskNewApiToken(detailedToken.secret) : detailedToken.masked === '未返回掩码' ? token.masked : detailedToken.masked,
        status: detailedToken.status === 'unknown' ? token.status : detailedToken.status,
        unlimitedQuota: detailedToken.unlimitedQuota ?? token.unlimitedQuota,
        modelLimitsEnabled: detailedToken.modelLimitsEnabled ?? token.modelLimitsEnabled,
        modelLimits: detailedToken.modelLimits.length ? detailedToken.modelLimits : token.modelLimits,
        group: detailedToken.group ?? token.group,
        expiresAt: detailedToken.expiresAt ?? token.expiresAt,
        createdAt: detailedToken.createdAt ?? token.createdAt,
        lastUsedAt: detailedToken.lastUsedAt ?? token.lastUsedAt,
      }
    }
    if (token?.id && !token.secret && newApiTokenClient.getTokenKey) {
      const keyResult = await newApiTokenClient.getTokenKey(token.id, managedTokenOwnerId)
      const secret = keyResult.state === 'ready' ? extractNewApiTokenSecret(keyResult.data) : null
      if (secret) token = { ...token, secret, masked: maskNewApiToken(secret) }
    }
    if (!token?.id) throw new ManagedKeyError('TOKEN_CREATE_FAILED', 'New API 已接受创建请求，但未返回可确认的 Token', 502)
    if (token.userId === null) token = { ...token, userId: managedTokenOwnerId }
    if (!token || !managedTokenConfigurationIsValid(token, model, managedTokenOwnerId)) {
      if (token?.id) await newApiTokenClient.updateTokenStatus(token.id, 0, managedTokenOwnerId)
      throw new ManagedKeyError('MODEL_LIMIT_NOT_SUPPORTED', 'New API 未确认该 Token 为单模型、无限额度、永不过期且无分组，已停止使用该 Token', 502)
    }

    const localId = newApiKeyId(token.id)
    const masked = maskNewApiToken(token.secret as string)
    const auditEventId = `audit-key-create-${operationId}`
    try {
      const createdLocal = database.createApiKey({
        id: localId,
        ownerUserId: person.id,
        maskedValue: masked,
        secretHash: null,
        secretValue: null,
        purpose,
        status: 'active',
        expiresAt: null,
        model,
        models: [model],
        externalTokenId: token.id,
        quotaMode: 'unlimited',
        createdAt: token.createdAt,
        lastUsedAt: token.lastUsedAt,
        lastSyncedAt: new Date().toISOString(),
        secretRevealedAt: new Date().toISOString(),
        idempotencyKey: operationId,
      }, {
        id: auditEventId,
        actorUserId,
        action: 'create',
        resourceType: 'key',
        resourceId: localId,
        result: 'success',
        requestId,
        summary: {
          code: 'NEW_API_TOKEN_CREATED',
          message: '已由 New API 管理员创建 Token；AI OPS 按创建时选择的在职人员显示归属。审计只记录外部 ID、掩码、人员部门和单模型配置，不记录明文。',
          resourceName: masked,
          externalTokenId: token.id,
          remoteOwnerUserId: managedTokenOwnerId,
          displayOwnerUserId: person.id,
          department: person.departmentName,
          purpose,
          model,
          quotaMode: 'unlimited',
          expiresAt: null,
          group: '',
          changes: [
            { field: 'externalTokenId', label: 'New API Token ID', before: null, after: token.id, sensitive: false },
            { field: 'model', label: '绑定模型', before: null, after: model, sensitive: false },
            { field: 'secret', label: '员工 Key', before: null, after: '仅本次响应返回', sensitive: true },
          ],
        },
      })
      if (!createdLocal) throw new Error('KEY_CREATE_FAILED')
      return {
        meta: { source: 'new_api' as const, createdAt: createdLocal.createdAt, notice: 'Key 由 New API 管理员账号创建；AI OPS 按所选人员显示归属。明文在创建响应和管理员主动复制时按需返回，服务端不保存明文。' },
        key: { id: createdLocal.id, masked: createdLocal.maskedValue, owner: { id: person.id, name: person.displayName, department: person.departmentName }, purpose: createdLocal.purpose, model, models: [model], expiresAt: null },
        secret: displayNewApiTokenSecret(token.secret as string),
        operation: { auditEventId },
      }
    } catch (error) {
      await newApiTokenClient.updateTokenStatus(token.id, 0, managedTokenOwnerId)
      if (error instanceof ManagedKeyError) throw error
      throw new ManagedKeyError('TOKEN_CREATE_FAILED', 'New API Token 已创建但 AI OPS 保存失败，已尝试自动停用，请稍后查询状态', 502)
    }
  }
  if (!options.database) app.addHook('onClose', async () => database.close())

  const recordAuthenticationAudit = (event: {
    actorUserId?: string | null
    action: 'login' | 'logout' | 'access'
    result: 'success' | 'failed' | 'denied'
    requestId: string
    code: 'AUTH_INVALID' | 'AUTH_REQUIRED' | 'AUTH_FORBIDDEN' | 'CSRF_INVALID' | 'AUTH_OK' | 'LOGOUT_OK'
    message: string
  }) => {
    database.appendAuditEvent({
      id: `audit-auth-${crypto.randomUUID()}`,
      actorUserId: event.actorUserId && database.userExists(event.actorUserId) ? event.actorUserId : null,
      action: event.action,
      resourceType: event.action === 'access' ? 'authorization' : 'session',
      resourceId: event.action === 'access' ? 'authorization-check' : 'local-session',
      result: event.result,
      requestId: event.requestId,
      summary: { code: event.code, message: event.message },
    })
  }

  const requiredRoles = (path: string, method: string, source?: string): readonly AppRole[] => {
    if (path === '/api/platform/restart') return ['super_admin', 'admin']
    if ((path === '/api/models' || path === '/api/channels') && source === 'new_api') return ['super_admin', 'admin']
    if (path.startsWith('/api/models/test')) return ['super_admin', 'admin']
    if (path.startsWith('/api/me')) return ['employee']
    if (path.startsWith('/api/quota-requests')) return method === 'GET' ? ['super_admin', 'admin', 'department_lead', 'finance'] : ['super_admin', 'admin', 'department_lead']
    if (path.startsWith('/api/quota-reservations')) return method === 'GET' ? ['super_admin', 'admin', 'department_lead', 'finance'] : ['super_admin', 'admin']
    // Conversation bodies are a privileged audit surface. Keep both the
    // legacy resource names and the short aliases behind the same gate; the
    // generic /api/keys GET rule below must never widen this endpoint.
    if (path.startsWith('/api/conversation-audits') || path.startsWith('/api/audits') || /^\/api\/keys\/[^/]+\/audits(?:\/|$)/.test(path)) return ['super_admin']
    if (path.startsWith('/api/integrations/new-api/management')) return ['super_admin', 'admin']
    if (path.startsWith('/api/integrations/new-api/channel/sync')) return ['super_admin', 'admin']
    if (/^\/api\/keys\/[^/]+\/secret$/.test(path)) return ['super_admin', 'admin']
    if (path.startsWith('/api/audit-events') || path.startsWith('/api/settings') || path.startsWith('/api/upstreams') || path.startsWith('/api/routes')) return ['super_admin', 'admin']
    if (path.startsWith('/api/people') && method !== 'GET') return ['super_admin', 'admin']
    if (path.startsWith('/api/keys') && method !== 'GET') return ['super_admin', 'admin']
    if (path.startsWith('/api/limits') && method !== 'GET') return ['super_admin', 'admin']
    if (path.startsWith('/api/channels') && method !== 'GET') return ['super_admin', 'admin']
    if (path.startsWith('/api/people') || path.startsWith('/api/keys') || path.startsWith('/api/models') || path.startsWith('/api/channels')) return ['super_admin', 'admin', 'department_lead']
    return ['super_admin', 'admin', 'department_lead', 'finance']
  }

  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '/'
    if (path === '/health' || path === '/gateway/health' || path === '/gateway/upstream-health' || path === '/gateway/config' || path === '/v1/models' || path === '/v1/chat/completions' || path === '/v1/responses' || path === '/api/auth/login' || path === '/api/auth/bootstrap') return
    const isLegacySoftQuotaEndpoint = path.startsWith('/api/quota-requests') || path.startsWith('/api/me/quota-requests') || path.endsWith('/goal') || (path.startsWith('/api/limits/') && request.method !== 'GET')
    if (!isSoftQuotaEnabled() && isLegacySoftQuotaEndpoint) {
      return reply.status(410).send({ error: { code: 'SOFT_QUOTA_DEPRECATED', message: '软额度已废弃，当前版本不再支持目标、临时额度或额度审批操作', requestId: request.id } })
    }
    if (authMode === 'disabled') return
    const user = auth.authenticate(request)
    if (!user) {
      recordAuthenticationAudit({
        action: 'access', result: 'denied', requestId: request.id, code: 'AUTH_REQUIRED',
        message: '未建立有效本地会话的访问被拒绝；不记录 Cookie、令牌、查询参数或请求正文。',
      })
      return reply.status(401).send({ error: { code: 'AUTH_REQUIRED', message: '请先登录后再访问该资源', requestId: request.id } })
    }
    request.authUser = user
    if (!isRoleAllowed(user, requiredRoles(path, request.method, (request.query as { source?: string })?.source))) {
      recordAuthenticationAudit({
        actorUserId: user.id, action: 'access', result: 'denied', requestId: request.id, code: 'AUTH_FORBIDDEN',
        message: '角色权限拒绝了受保护的管理接口访问；不记录查询参数、请求正文或认证信息。',
      })
      return reply.status(403).send({ error: { code: 'AUTH_FORBIDDEN', message: '当前身份没有访问该资源的权限', requestId: request.id } })
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !auth.verifyCsrf(request)) {
      recordAuthenticationAudit({
        actorUserId: user.id, action: 'access', result: 'denied', requestId: request.id, code: 'CSRF_INVALID',
        message: 'CSRF 请求安全校验未通过；不记录会话 Cookie、令牌或 CSRF 值。',
      })
      return reply.status(403).send({ error: { code: 'CSRF_INVALID', message: '请求安全校验未通过，请刷新页面后重试', requestId: request.id } })
    }
  })

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id)
    reply.header('cache-control', 'no-store')
    return payload
  })

  app.get('/health', {
    schema: {
      response: {
        200: z.object({ status: z.literal('ok'), service: z.literal('ai-ops-bff') }),
      },
    },
  }, async () => ({ status: 'ok' as const, service: 'ai-ops-bff' as const }))

  registerGatewayRoutes(app, gatewayConfig, { upstream: gatewayUpstream, database, resolveExternalClientKey: options.resolveExternalClientKey ?? resolveExternalGatewayKey })

  app.get('/api/platform/database', {
    schema: { response: { 200: databaseStatusSchema } },
  }, async () => database.status())

  app.post('/api/auth/login', {
    schema: {
      body: loginBodySchema,
      response: { 200: authResponseSchema, 400: errorResponseSchema, 401: authErrorSchema },
    },
  }, async (request, reply) => {
    const session = auth.login(request.body.username, request.body.password)
    if (!session) {
      recordAuthenticationAudit({
        action: 'login', result: 'failed', requestId: request.id, code: 'AUTH_INVALID',
        message: '本地登录校验失败；未记录输入的用户名或密码。',
      })
      return reply.status(401).send({ error: { code: 'AUTH_INVALID', message: '用户名或密码不正确', requestId: request.id } })
    }
    auth.setSessionCookie(reply, session.token, session.csrfToken, session.expiresAt)
    recordAuthenticationAudit({
      actorUserId: session.user.id, action: 'login', result: 'success', requestId: request.id, code: 'AUTH_OK',
      message: '本地管理会话已创建；会话令牌与 CSRF 值仅以哈希形式保存。',
    })
    return { authenticated: true as const, user: session.user, expiresAt: session.expiresAt }
  })

  app.post('/api/auth/bootstrap', {
    schema: {
      response: { 200: authResponseSchema, 403: authErrorSchema, 503: authErrorSchema },
    },
  }, async (request, reply) => {
    // The single-admin bootstrap is intentionally limited to local admin-only
    // mode (or AUTH_MODE=disabled for isolated browser tests). It creates the
    // same HttpOnly session and CSRF cookie as an explicit login, without
    // reading or requiring an administrator password.
    const localBootstrapAllowed = process.env.AI_OPS_ADMIN_ONLY === 'true' || authMode === 'disabled'
    if (!localBootstrapAllowed) {
      return reply.status(403).send({ error: { code: 'AUTH_FORBIDDEN', message: '当前环境未启用单管理员自动进入', requestId: request.id } })
    }
    const session = auth.bootstrapAdmin?.() ?? null
    if (!session || session.user.role !== 'super_admin') {
      return reply.status(503).send({ error: { code: 'AUTH_REQUIRED', message: '本地超级管理员账号尚未准备好，请检查服务端配置', requestId: request.id } })
    }
    auth.setSessionCookie(reply, session.token, session.csrfToken, session.expiresAt)
    recordAuthenticationAudit({
      actorUserId: session.user.id, action: 'login', result: 'success', requestId: request.id, code: 'AUTH_OK',
      message: '本机单管理员模式自动创建管理会话；会话令牌与 CSRF 值仅以哈希形式保存。',
    })
    return { authenticated: true as const, user: session.user, expiresAt: session.expiresAt }
  })

  app.get('/api/auth/me', {
    schema: { response: { 200: authResponseSchema, 401: authErrorSchema } },
  }, async (request, reply) => {
    const session = auth.getSession(request)
    if (!session) return reply.status(401).send({ error: { code: 'AUTH_REQUIRED', message: '当前会话已失效，请重新登录', requestId: request.id } })
    return { authenticated: true as const, user: session.user, expiresAt: session.expiresAt }
  })

  app.post('/api/auth/logout', {
  }, async (request, reply) => {
    auth.revoke(request)
    auth.clearSessionCookie(reply)
    recordAuthenticationAudit({
      actorUserId: request.authUser?.id ?? null, action: 'logout', result: 'success', requestId: request.id, code: 'LOGOUT_OK',
      message: '本地管理会话已撤销；不记录会话 Cookie、令牌或 CSRF 值。',
    })
    return reply.status(204).send()
  })

  app.get('/api/overview', {
    schema: {
      querystring: z.object({ period: periodSchema.default('7d') }),
      response: {
        200: overviewResponseSchema,
        400: errorResponseSchema,
        409: errorResponseSchema,
        503: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    if (newApiDatabase) {
      return createNewApiOverview(request.query.period, newApiDatabase, new Date(), await (options.probeNewApi ?? probeNewApiFromEnvironment)(), dataScopeFor(request.authUser))
    }
    if (upstreamDataPrimary) return reply.status(503).send({ error: { code: 'NEW_API_OVERVIEW_UNAVAILABLE', message: 'New API SQLite 日志源尚未挂载，暂不读取本地概览镜像', requestId: request.id } })
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    return createDatabaseOverview(request.query.period, database, new Date(), newApi, dataScopeFor(request.authUser))
  })

  app.get('/api/integrations/new-api/status', {
    schema: { response: { 200: newApiStatusSchema } },
  }, async () => (options.probeNewApi ?? probeNewApiFromEnvironment)())

  app.get('/api/integrations/new-api/management', {
    schema: { response: { 200: newApiManagementResponseSchema } },
  }, async () => (options.probeNewApiManagement ?? probeNewApiManagementFromEnvironment)())

  async function readNewApiChannelSyncPreview(requestId: string, now = new Date()) {
    if (!newApiManagementClient.authConfigured) throw new NewApiChannelSyncError('NEW_API_AUTH_REQUIRED', 'New API 管理凭据未配置，已停止渠道写入', 503)
    const source = await readCpaChannelSource(now)
    const channels = await listAllNewApiChannels(newApiManagementClient)
    return buildChannelSyncPreview({
      source,
      channels,
      mapping: database.getManagedChannelMapping(CPA_CHANNEL_MARKER),
      requestId,
    })
  }

  function channelSyncErrorResponse(request: { id: string }, reply: any, error: unknown): any {
    if (error instanceof NewApiChannelSyncError) return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id } })
    return reply.status(503).send({ error: { code: 'NEW_API_CHANNEL_SYNC_FAILED', message: 'New API CPA 渠道同步未完成，请稍后重试', requestId: request.id } })
  }

  app.get('/api/integrations/new-api/channel/sync/preview', {
    schema: { response: { 200: channelSyncPreviewSchema, 409: errorResponseSchema, 502: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    try {
      return await readNewApiChannelSyncPreview(request.id)
    } catch (error) {
      return channelSyncErrorResponse(request, reply, error)
    }
  })

  app.post('/api/integrations/new-api/channel/sync', {
    schema: { body: channelSyncBodySchema, response: { 200: channelSyncResponseSchema, 400: errorResponseSchema, 409: errorResponseSchema, 502: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    const idempotencyKey = request.body.idempotencyKey
    const previous = database.getChannelSyncOperation(idempotencyKey)
    if (previous) {
      try {
        const stored = channelSyncResponseSchema.parse(JSON.parse(previous.resultJson))
        return { ...stored, operation: { ...stored.operation, idempotent: true } }
      } catch {
        return reply.status(503).send({ error: { code: 'NEW_API_CHANNEL_SYNC_FAILED', message: '已保存的渠道同步结果无法读取，请人工复核 New API 渠道状态', requestId: request.id } })
      }
    }

    try {
      if (!newApiManagementClient.authConfigured) throw new NewApiChannelSyncError('NEW_API_AUTH_REQUIRED', 'New API 管理凭据未配置，已停止渠道写入', 503)
      const now = new Date()
      const source = await readCpaChannelSource(now)
      if (source.state !== 'ready' || !source.credentialConfigured || !source.baseUrl || !source.modelIds.length) {
        throw new NewApiChannelSyncError('CPA_CHANNEL_SOURCE_NOT_READY', 'CPA 当前没有可写入 New API 的 ready 模型快照', 503)
      }
      const channels = await listAllNewApiChannels(newApiManagementClient)
      const preview = buildChannelSyncPreview({
        source,
        channels,
        mapping: database.getManagedChannelMapping(CPA_CHANNEL_MARKER),
        requestId: request.id,
      })
      if (!preview.canApply || preview.target.action === 'blocked') throw new NewApiChannelSyncError('CPA_CHANNEL_SOURCE_NOT_READY', 'CPA 当前没有可写入 New API 的 ready 模型快照', 503)
      const payload = buildChannelSyncPayload(source, cpaCatalogConfig.upstreamApiKey ?? '')
      const targetId = preview.target.externalChannelId
      if (preview.target.action === 'create') {
        const created = await newApiManagementClient.createChannel(payload)
        if (created.state !== 'ready') throw managementResultError(created)
      } else if (preview.target.action === 'update') {
        if (!targetId) throw new NewApiChannelSyncError('NEW_API_CHANNEL_TARGET_MISSING', '渠道更新目标不存在，已停止写入', 409)
        const updated = await newApiManagementClient.updateChannel(targetId, payload)
        if (updated.state !== 'ready') throw managementResultError(updated)
      } else if (preview.target.action === 'enable') {
        if (!targetId) throw new NewApiChannelSyncError('NEW_API_CHANNEL_TARGET_MISSING', '渠道启用目标不存在，已停止写入', 409)
        const enabled = await newApiManagementClient.updateChannelStatus(targetId, 1)
        if (enabled.state !== 'ready') throw managementResultError(enabled)
      }

      const verifiedChannels = preview.target.action === 'unchanged' ? channels : await listAllNewApiChannels(newApiManagementClient)
      const verifiedTarget = channelSyncTarget(verifiedChannels, database.getManagedChannelMapping(CPA_CHANNEL_MARKER))
      const expectedModels = [...new Set(source.modelIds)].sort()
      const actualModels = [...new Set(verifiedTarget?.models ?? [])].sort()
      const verified = Boolean(
        verifiedTarget
        && verifiedTarget.name === 'AI OPS · CPA Codex'
        && (verifiedTarget.type === 1 || verifiedTarget.type === '1')
        && verifiedTarget.baseUrl === normalizeNewApiChannelBaseUrl(source.baseUrl)
        && verifiedTarget.enabled === true
        && verifiedTarget.keyConfigured !== false
        && expectedModels.length === actualModels.length
        && expectedModels.every((model, index) => model === actualModels[index])
        && (!verifiedTarget.marker || verifiedTarget.marker === CPA_CHANNEL_MARKER),
      )
      if (!verified || !verifiedTarget) {
        if (preview.target.action !== 'unchanged' && verifiedTarget) {
          try { await newApiManagementClient.updateChannelStatus(verifiedTarget.id, 0) } catch { /* fail closed when the adapter supports it */ }
        }
        throw new NewApiChannelSyncError('NEW_API_CHANNEL_VERIFY_FAILED', 'New API 渠道写入后未通过最终校验，已停止使用该渠道', 502)
      }

      const finalTarget = verifiedTarget
      database.upsertManagedChannelMapping({
        marker: CPA_CHANNEL_MARKER,
        externalChannelId: finalTarget.id,
        source: 'cpa',
        modelSnapshot: finalTarget.models,
        updatedAt: now.toISOString(),
        lastRequestId: request.id,
      })
      const result = {
        ...preview,
        target: { ...preview.target, externalChannelId: finalTarget.id },
        status: preview.target.action === 'unchanged' ? 'unchanged' as const : 'succeeded' as const,
        operation: { idempotencyKey, idempotent: false, auditEventId: `audit-${idempotencyKey}` },
      }
      const recorded = database.recordChannelSyncOperation(idempotencyKey, channelSyncSnapshotHash(preview), result, {
        id: `audit-${idempotencyKey}`,
        actorUserId: request.authUser?.id ?? null,
        action: 'sync',
        resourceType: 'new-api-channel',
        resourceId: finalTarget.id,
        result: 'success',
        requestId: request.id,
        summary: { code: 'NEW_API_CPA_CHANNEL_SYNC', message: 'CPA 渠道已按真实模型快照写入并完成 New API 最终校验', action: preview.target.action, externalChannelId: finalTarget.id, modelCount: finalTarget.models.length },
      }, now)
      return { ...(recorded.result as typeof result), operation: { ...result.operation, idempotent: recorded.idempotent } }
    } catch (error) {
      return channelSyncErrorResponse(request, reply, error)
    }
  })

  app.get('/api/platform/status', {
    schema: { response: { 200: platformStatusSchema } },
  }, async () => {
    const cpaUrl = process.env.CPA_MANAGEMENT_URL ?? process.env.CPA_BASE_URL ?? 'http://127.0.0.1:8317/management.html'
    const [newApi, cpa, docker] = await Promise.all([
      (options.probeNewApi ?? probeNewApiFromEnvironment)(),
      (options.probeCpa ?? (() => probeCpaFromEnvironment()))(),
      dockerControl.status(),
    ])
    return createPlatformStatus({
      newApi,
      cpa,
      newApiUrl: process.env.AI_OPS_PUBLIC_NEW_API_BASE_URL ?? 'http://127.0.0.1:3000/v1',
      cpaUrl,
      dockerServices: docker.available ? docker.services : undefined,
      dockerControl: {
        enabled: docker.enabled,
        available: docker.available,
        projectName: docker.projectName,
        notice: docker.notice,
      },
    })
  })

  app.post('/api/platform/restart', {
    schema: {
      body: platformRestartBodySchema,
      response: { 202: platformRestartResponseSchema, 400: errorResponseSchema, 409: errorResponseSchema, 503: errorResponseSchema },
    },
  }, async (request, reply) => {
    const target = request.body.target as DockerRestartTarget
    const status = await dockerControl.status()
    if (!status.enabled || !status.available) {
      return reply.status(503).send({ error: { code: 'DOCKER_CONTROL_UNAVAILABLE', message: status.notice, requestId: request.id } })
    }
    const requestedServices = target === 'all' ? status.services : status.services.filter((service) => service.id === target)
    if (requestedServices.length !== (target === 'all' ? 4 : 1) || requestedServices.some((service) => !service.container)) {
      return reply.status(409).send({ error: { code: 'DOCKER_SERVICE_NOT_FOUND', message: '目标服务的 Compose 容器不存在，未执行重启', requestId: request.id } })
    }
    if (Date.now() - lastDockerRestartAt < 5_000) {
      return reply.status(409).send({ error: { code: 'DOCKER_RESTART_COOLDOWN', message: '刚刚已经提交过重启，请等待几秒后再试', requestId: request.id } })
    }
    lastDockerRestartAt = Date.now()

    const actorUserId = request.authUser?.id ?? null
    const auditEventId = `audit-docker-restart-${crypto.randomUUID()}`
    database.appendAuditEvent({
      id: auditEventId,
      actorUserId,
      action: 'restart',
      resourceType: 'docker-service',
      resourceId: target,
      result: 'success',
      requestId: request.id,
      summary: {
        code: 'DOCKER_RESTART_SCHEDULED',
        message: target === 'all' ? '已安排重启 AI OPS Compose 四项服务' : `已安排重启 Compose 服务 ${target}`,
        target,
        projectName: status.projectName,
      },
    })

    // Let Fastify flush the 202 response before restarting `server` itself.
    setTimeout(() => {
      void dockerControl.restart(target).catch((error) => {
        app.log.warn({ err: error, target }, 'Docker service restart failed after acceptance')
      })
    }, 25)

    return reply.status(202).send({
      status: 'accepted' as const,
      target,
      requestId: request.id,
      message: target === 'all' ? '已提交整套 Compose 重启，请稍后刷新服务矩阵' : `已提交 ${target} 重启，请稍后刷新服务矩阵`,
    })
  })

  app.get('/api/tasks/summary', {
    schema: { response: { 200: taskSummarySchema } },
  }, async (request) => createTaskSummary(database, new Date(), dataScopeFor(request.authUser)))

  app.get('/api/search', {
    schema: {
      querystring: searchQuerySchema,
      response: { 200: searchResponseSchema, 400: errorResponseSchema, 503: errorResponseSchema },
    },
  }, async (request, reply) => {
    if (upstreamDataPrimary) return reply.status(503).send({ error: { code: 'UPSTREAM_SEARCH_UNAVAILABLE', message: '生产搜索索引尚未接入 New API/CPA 主数据，暂不读取本地业务镜像', requestId: request.id } })
    return createDatabaseSearch(database, request.query, dataScopeFor(request.authUser))
  })

  app.get('/api/people/sync/preview', {
    schema: { response: { 200: personSyncPreviewResponseSchema, 401: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    try {
      return (await previewPeopleSync(peopleReadClient, database, new Date())).preview
    } catch (error) {
      markPeopleSyncStale(database)
      if (error instanceof PeopleSyncReadError) {
        const status = error.state === 'auth_required' ? 401 : 503
        return reply.status(status).send({ error: { code: error.state === 'auth_required' ? 'NEW_API_AUTH_REQUIRED' : 'PEOPLE_SYNC_UNAVAILABLE', message: error.message, requestId: request.id } })
      }
      return reply.status(503).send({ error: { code: 'PEOPLE_SYNC_UNAVAILABLE', message: 'New API 用户数据暂时无法读取', requestId: request.id } })
    }
  })

  app.post('/api/people/sync', {
    schema: { body: personSyncBodySchema, response: { 200: personSyncResponseSchema, 400: errorResponseSchema, 401: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    const auditEventId = `audit-${request.body.idempotencyKey}`
    try {
      return await executePeopleSync(peopleReadClient, database, request.body.idempotencyKey, {
        id: auditEventId,
        actorUserId: request.authUser?.id ?? null,
        action: 'sync',
        resourceType: 'people',
        resourceId: 'new-api',
        result: 'success',
        requestId: request.id,
        summary: { code: 'PEOPLE_SYNC_CONFIRMED', message: '已按 New API 用户快照同步人员身份和状态；未创建 Key、额度或员工登录凭据。' },
      }, new Date())
    } catch (error) {
      markPeopleSyncStale(database)
      if (error instanceof PeopleSyncReadError) {
        const status = error.state === 'auth_required' ? 401 : 503
        return reply.status(status).send({ error: { code: error.state === 'auth_required' ? 'NEW_API_AUTH_REQUIRED' : 'PEOPLE_SYNC_UNAVAILABLE', message: error.message, requestId: request.id } })
      }
      return reply.status(503).send({ error: { code: 'PEOPLE_SYNC_FAILED', message: '人员同步未完成，已有人员记录保持不变', requestId: request.id } })
    }
  })

  app.get('/api/people', {
    schema: {
      querystring: peopleQuerySchema,
      response: {
        200: peopleResponseSchema,
        400: errorResponseSchema,
        401: errorResponseSchema,
        409: errorResponseSchema,
        502: errorResponseSchema,
        503: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const upstreamPrimary = upstreamDataPrimary
    if (upstreamPrimary || peopleManagementClient.authConfigured) {
      if (!newApiDatabase && !peopleManagementClient.authConfigured) return reply.status(503).send({ error: { code: 'NEW_API_AUTH_REQUIRED', message: 'New API 数据源尚未配置，人员页不会读取本地镜像数据', requestId: request.id } })
      try {
        const source = await readNewApiPeople(peopleReadClient, database)
        const tokens = managedTokenSourceAvailable ? await readManagedTokens() : []
        await autoSyncPeople(request.authUser?.id ?? null, request.id)
        for (const token of tokens) await syncManagedToken(token)
        const keyCounts = new Map<string, number>()
        for (const token of tokens) {
          if (token.userId && token.status === 'active') keyCounts.set(token.userId, (keyCounts.get(token.userId) ?? 0) + 1)
        }
        return createNewApiPeople(source.people, keyCounts, request.query, new Date(), dataScopeFor(request.authUser))
      } catch (error) {
        markPeopleSyncStale(database)
        if (error instanceof PeopleSyncReadError) {
          const status = error.state === 'auth_required' ? 401 : 503
          return reply.status(status).send({ error: { code: error.state === 'auth_required' ? 'NEW_API_AUTH_REQUIRED' : 'PEOPLE_SYNC_UNAVAILABLE', message: error.message, requestId: request.id } })
        }
        if (error instanceof ManagedKeyError) return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id } })
        return reply.status(502).send({ error: { code: 'NEW_API_UNAVAILABLE', message: 'New API 用户或 Token 数据暂时无法读取', requestId: request.id } })
      }
    }
    await autoSyncPeople(request.authUser?.id ?? null, request.id)
    await autoSyncManagedTokens()
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    return createDatabasePeople(database, request.query, newApi, new Date(), dataScopeFor(request.authUser))
  })

  app.post('/api/people', {
    schema: {
      body: personCreateBodySchema,
      response: { 201: personCreateResponseSchema, 400: errorResponseSchema, 409: errorResponseSchema, 410: errorResponseSchema, 502: errorResponseSchema, 503: errorResponseSchema },
    },
  }, async (request, reply) => {
    const upstreamPrimary = upstreamDataPrimary
    if (upstreamPrimary && !peopleManagementClient.authConfigured) return reply.status(503).send({ error: { code: 'NEW_API_AUTH_REQUIRED', message: 'New API 管理凭据尚未配置，人员创建不会写入本地镜像', requestId: request.id } })
    if (peopleManagementClient.authConfigured) {
      try {
        const created = await createRemotePerson(request.body, request.authUser?.id ?? null, request.id)
        return reply.status(201).send({
          meta: { source: 'new_api' as const, createdAt: new Date().toISOString(), notice: '人员已写入 New API users 表，并同步到 AI OPS 镜像；状态默认为在职，员工密码不会返回。' },
          person: { id: created.person.id, username: created.person.username ?? request.body.username ?? request.body.displayName, displayName: created.person.displayName, department: { id: created.person.departmentId, name: created.person.departmentName } },
          operation: { auditEventId: created.auditEventId },
        })
      } catch (error) {
        if (error instanceof ManagedKeyError) return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id } })
        throw error
      }
    }
    let departmentId: string
    try {
      departmentId = database.ensureDepartment(request.body.departmentId)
    } catch (error) {
      if (error instanceof Error && error.message === 'DEPARTMENT_NAME_REQUIRED') return reply.status(400).send({ error: { code: 'DEPARTMENT_NOT_FOUND', message: '请填写所属部门', requestId: request.id } })
      throw error
    }
    const id = `person-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
    const username = request.body.username ?? `person-${randomBytes(9).toString('hex')}`
    const password = request.body.password ?? randomBytes(24).toString('base64url')
    try {
      const created = database.createPerson({ id, username, displayName: request.body.displayName, departmentId, password }, {
        id: `audit-${id}-create`,
        actorUserId: request.authUser?.id ?? null,
        action: 'create',
        resourceType: 'person',
        resourceId: id,
        result: 'success',
        requestId: request.id,
        summary: {
          message: `已添加本地演示人员 ${request.body.displayName}；登录名和初始密码由系统自动生成，仅保存安全摘要。`,
          resourceName: request.body.displayName,
          changes: [
            { field: 'username', label: '登录名', before: null, after: username, sensitive: false },
            { field: 'departmentId', label: '所属部门', before: null, after: departmentId, sensitive: false },
            { field: 'password', label: '初始密码', before: null, after: '系统自动生成（不记录值）', sensitive: true },
          ],
        },
      })
      if (!created || !created.departmentId || !created.departmentName) throw new Error('PERSON_CREATE_FAILED')
      return reply.status(201).send({ meta: { source: 'database' as const, createdAt: new Date().toISOString(), notice: '人员已写入本地 SQLite；职位、用途和真实 New API 映射将在后续接入' }, person: { id: created.id, username: created.username, displayName: created.displayName, department: { id: created.departmentId, name: created.departmentName } }, operation: { auditEventId: `audit-${id}-create` } })
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: users\.username/i.test(error.message)) {
        return reply.status(409).send({ error: { code: 'USERNAME_CONFLICT', message: '用户名已存在，请更换后重试', requestId: request.id } })
      }
      throw error
    }
  })

  app.post('/api/people/batch', {
    schema: {
      body: personBatchCreateBodySchema,
      response: { 201: personBatchCreateResponseSchema, 400: errorResponseSchema, 409: errorResponseSchema, 502: errorResponseSchema, 503: errorResponseSchema },
    },
  }, async (request, reply) => {
    const upstreamPrimary = upstreamDataPrimary
    if (upstreamPrimary && !peopleManagementClient.authConfigured) return reply.status(503).send({ error: { code: 'NEW_API_AUTH_REQUIRED', message: 'New API 管理凭据尚未配置，人员导入不会写入本地镜像', requestId: request.id } })
    if (peopleManagementClient.authConfigured) {
      const created: Array<Awaited<ReturnType<typeof createRemotePerson>>> = []
      try {
        for (const item of request.body.items) created.push(await createRemotePerson(item, request.authUser?.id ?? null, request.id))
        const first = created[0]
        return reply.status(201).send({
          meta: { source: 'new_api' as const, createdAt: new Date().toISOString(), notice: created.every((item) => !item.created) ? '已返回 New API 中已有的人员；AI OPS 未重复创建。' : '人员已逐条写入 New API users 表，并同步到 AI OPS 镜像；状态默认为在职，员工密码不会返回。', createdCount: created.length },
          people: created.map((item) => ({ id: item.person.id, username: item.person.username ?? '', displayName: item.person.displayName, department: { id: item.person.departmentId, name: item.person.departmentName } })),
          operation: { idempotencyKey: request.body.idempotencyKey, idempotent: created.every((item) => !item.created), auditEventId: first?.auditEventId ?? `audit-${request.body.idempotencyKey}` },
        })
      } catch (error) {
        if (error instanceof ManagedKeyError) return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id } })
        throw error
      }
    }
    let resolvedItems: Array<typeof request.body.items[number] & { resolvedDepartmentId: string }>
    try {
      resolvedItems = request.body.items.map((item) => ({ ...item, resolvedDepartmentId: database.ensureDepartment(item.departmentId) }))
    } catch (error) {
      if (error instanceof Error && error.message === 'DEPARTMENT_NAME_REQUIRED') return reply.status(400).send({ error: { code: 'DEPARTMENT_NOT_FOUND', message: '批量文件包含空的所属部门，请修正后重试', requestId: request.id } })
      throw error
    }
    const batchId = `people-batch-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
    const people = resolvedItems.map((item) => ({
      id: `person-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
      username: item.username ?? `person-${randomBytes(9).toString('hex')}`,
      displayName: item.displayName,
      departmentId: item.resolvedDepartmentId,
      password: item.password ?? randomBytes(24).toString('base64url'),
    }))
    const auditEventId = `audit-${request.body.idempotencyKey}`
    try {
      const result = database.createPeopleBatch(people, {
        id: auditEventId,
        actorUserId: request.authUser?.id ?? null,
        action: 'create',
        resourceType: 'person',
        resourceId: batchId,
        result: 'success',
        requestId: request.id,
        summary: {
          message: `已批量添加本地演示人员 ${people.length} 条；登录名和初始密码由系统自动生成，仅保存安全摘要。`,
          resourceName: `批量添加人员（${people.length} 条）`,
          createdPeople: people.map((person) => ({ id: person.id, username: person.username, displayName: person.displayName, departmentId: person.departmentId })),
          changes: [
            { field: 'count', label: '导入人数', before: null, after: String(people.length), sensitive: false },
            { field: 'password', label: '初始密码', before: null, after: '系统自动生成（不记录值）', sensitive: true },
          ],
        },
      })
      if (result.people.length !== people.length || result.people.some((person) => !person.departmentId || !person.departmentName)) throw new Error('PERSON_BATCH_CREATE_FAILED')
      return reply.status(201).send({
        meta: { source: 'database' as const, createdAt: new Date().toISOString(), notice: result.idempotent ? '已返回上次批量导入结果；未重复创建人员。' : '批量人员已写入本地 SQLite；登录名和初始凭据由服务端生成并仅保存哈希', createdCount: result.people.length },
        people: result.people.map((person) => ({ id: person.id, username: person.username, displayName: person.displayName, department: { id: person.departmentId as string, name: person.departmentName as string } })),
        operation: { idempotencyKey: request.body.idempotencyKey, idempotent: result.idempotent, auditEventId },
      })
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: users\.username/i.test(error.message)) {
        return reply.status(409).send({ error: { code: 'BATCH_USERNAME_CONFLICT', message: '批量文件中的登录用户名已存在，整批未写入', requestId: request.id } })
      }
      throw error
    }
  })

  app.post('/api/people/:id/disable', {
    schema: { params: personIdParamsSchema, body: personDisableBodySchema, response: { 200: personDisableResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema, 502: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    const auditEventId = `audit-${request.body.idempotencyKey}`
    try {
    const upstreamPrimary = upstreamDataPrimary
      const visible = upstreamPrimary || peopleManagementClient.authConfigured
        ? await loadRemotePersonForMutation(request.params.id, request.authUser?.id ?? null, request.id, dataScopeFor(request.authUser))
        : createDatabasePersonDetail(database, request.params.id, await (options.probeNewApi ?? probeNewApiFromEnvironment)(), new Date(), dataScopeFor(request.authUser))
      if (!visible) return reply.status(404).send({ error: { code: 'PERSON_NOT_FOUND', message: '未找到指定人员', requestId: request.id } })
      if (!database.hasAuditEvent(auditEventId)) await syncRemotePersonStatus(visible, 0)
      const result = database.disablePerson(request.params.id, {
        id: auditEventId, actorUserId: request.authUser?.id ?? null, action: 'disable', resourceType: 'person', resourceId: request.params.id,
        result: 'success', requestId: request.id,
        summary: {
          message: '已同步停用 New API 用户，并在 AI OPS 回收其仍有效 Key；审计只记录状态与回收数量。', resourceName: visible.profile.name,
          reasonProvided: false, reasonLength: 0,
          changes: [
            { field: 'status', label: '人员状态', before: '在职', after: '停用', sensitive: false },
            { field: 'keys', label: '关联 Key', before: '仍有效', after: '已回收（数量见操作结果）', sensitive: false },
          ],
        },
      })
      if (!result) return reply.status(404).send({ error: { code: 'PERSON_NOT_FOUND', message: '未找到指定人员', requestId: request.id } })
      if (result.state === 'already_disabled') return reply.status(409).send({ error: { code: 'PERSON_ALREADY_DISABLED', message: '该人员已停用，请勿重复提交新的操作', requestId: request.id } })
      return { meta: { source: visible.profile.source === 'new-api' ? 'new_api' as const : 'database' as const, completedAt: new Date().toISOString(), notice: '已同步停用 New API 用户；AI OPS 已回收其仍有效 Key，该人员后续不可继续创建新 Key。' }, person: { id: result.person.id, name: result.person.displayName, status: 'disabled' as const }, keysDisabled: result.keysDisabled, operation: { idempotencyKey: request.body.idempotencyKey, idempotent: result.idempotent, auditEventId } }
    } catch (error) {
      if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') return reply.status(409).send({ error: { code: 'IDEMPOTENCY_KEY_REUSED', message: '该幂等操作编号已用于另一名人员', requestId: request.id } })
      if (error instanceof ManagedKeyError) return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id } })
      throw error
    }
  })

  app.post('/api/people/:id/enable', {
    schema: { params: personIdParamsSchema, body: personEnableBodySchema, response: { 200: personEnableResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema, 502: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    const auditEventId = `audit-${request.body.idempotencyKey}`
    try {
    const upstreamPrimary = upstreamDataPrimary
      const visible = upstreamPrimary || peopleManagementClient.authConfigured
        ? await loadRemotePersonForMutation(request.params.id, request.authUser?.id ?? null, request.id, dataScopeFor(request.authUser))
        : createDatabasePersonDetail(database, request.params.id, await (options.probeNewApi ?? probeNewApiFromEnvironment)(), new Date(), dataScopeFor(request.authUser))
      if (!visible) return reply.status(404).send({ error: { code: 'PERSON_NOT_FOUND', message: '未找到指定人员', requestId: request.id } })
      if (!database.hasAuditEvent(auditEventId)) await syncRemotePersonStatus(visible, 1)
      const result = database.enablePerson(request.params.id, {
        id: auditEventId, actorUserId: request.authUser?.id ?? null, action: 'enable', resourceType: 'person', resourceId: request.params.id,
        result: 'success', requestId: request.id,
        summary: {
          message: '已同步启用 New API 用户，并恢复 AI OPS 中本次停用回收的关联 Key；审计只记录状态与恢复数量。', resourceName: visible.profile.name,
          reasonProvided: false, reasonLength: 0,
          changes: [
            { field: 'status', label: '人员状态', before: '停用', after: '在职', sensitive: false },
            { field: 'keys', label: '关联 Key', before: '已回收', after: '恢复可用（数量见操作结果）', sensitive: false },
          ],
        },
      })
      if (!result) return reply.status(404).send({ error: { code: 'PERSON_NOT_FOUND', message: '未找到指定人员', requestId: request.id } })
      if (result.state === 'already_enabled') return reply.status(409).send({ error: { code: 'PERSON_ALREADY_ENABLED', message: '该人员已启用，请勿重复提交新的操作', requestId: request.id } })
      return { meta: { source: visible.profile.source === 'new-api' ? 'new_api' as const : 'database' as const, completedAt: new Date().toISOString(), notice: '已同步启用 New API 用户；停用时回收且未被单独变更的关联 Key 已恢复为原状态。' }, person: { id: result.person.id, name: result.person.displayName, status: 'active' as const }, keysEnabled: result.keysEnabled, operation: { idempotencyKey: request.body.idempotencyKey, idempotent: result.idempotent, auditEventId } }
    } catch (error) {
      if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') return reply.status(409).send({ error: { code: 'IDEMPOTENCY_KEY_REUSED', message: '该幂等操作编号已用于另一名人员', requestId: request.id } })
      if (error instanceof ManagedKeyError) return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id } })
      throw error
    }
  })

  app.post('/api/people/:id/delete', {
    schema: { params: personIdParamsSchema, body: personDeleteBodySchema, response: { 200: personDeleteResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema, 502: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    const auditEventId = `audit-${request.body.idempotencyKey}`
    try {
    const upstreamPrimary = upstreamDataPrimary
      const visible = upstreamPrimary || peopleManagementClient.authConfigured
        ? await loadRemotePersonForMutation(request.params.id, request.authUser?.id ?? null, request.id, dataScopeFor(request.authUser))
        : createDatabasePersonDetail(database, request.params.id, await (options.probeNewApi ?? probeNewApiFromEnvironment)(), new Date(), dataScopeFor(request.authUser))
    const remotePerson = Boolean(visible?.profile.externalUserId)
      if (remotePerson && visible && !database.hasAuditEvent(auditEventId)) await deleteRemotePerson(visible)
      const result = database.deletePerson(request.params.id, {
        id: auditEventId, actorUserId: request.authUser?.id ?? null, action: 'delete', resourceType: 'person', resourceId: request.params.id,
        result: 'success', requestId: request.id,
        summary: {
          message: remotePerson ? '已删除 New API 用户，并移除 AI OPS 人员镜像；历史审计与用量记录保留。' : visible ? '已从人员目录移除本地 SQLite 人员；历史审计与用量记录保留，关联 Key 继续保持已回收状态。' : '已返回上次人员删除结果；未重复写入。',
          resourceName: visible?.profile.name ?? '已删除人员', reasonProvided: Boolean((request.body.reason ?? '').trim()), reasonLength: (request.body.reason ?? '').trim().length,
          changes: [{ field: remotePerson ? 'new_api_user' : 'directory', label: remotePerson ? 'New API 用户与人员目录' : '人员目录', before: visible?.profile.status === 'active' ? '在职' : '已停用', after: '已删除', sensitive: false }],
        },
      }, new Date(), { allowActive: remotePerson })
      if (!result) return reply.status(404).send({ error: { code: 'PERSON_NOT_FOUND', message: '未找到可删除的人员', requestId: request.id } })
      if (result.state === 'not_disabled') return reply.status(409).send({ error: { code: 'PERSON_MUST_BE_DISABLED', message: '只有已停用人员才可以删除', requestId: request.id } })
      return {
        meta: { source: remotePerson ? 'new_api' as const : 'database' as const, completedAt: new Date().toISOString(), notice: result.idempotent ? '已返回上次人员删除结果；未重复写入。' : remotePerson ? '已删除 New API 用户，并同步移除 AI OPS 人员镜像。' : '人员已从本地 SQLite 人员目录移除；历史审计与用量记录保留，关联 Key 继续保持已回收状态。' },
        person: { id: result.person.id, name: result.person.displayName, status: 'deleted' as const },
        operation: { idempotencyKey: request.body.idempotencyKey, idempotent: result.idempotent, auditEventId },
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') return reply.status(409).send({ error: { code: 'IDEMPOTENCY_KEY_REUSED', message: '该幂等操作编号已用于另一名人员', requestId: request.id } })
      if (error instanceof ManagedKeyError) return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id } })
      throw error
    }
  })

  app.patch('/api/people/:id/goal', {
    schema: { params: personIdParamsSchema, body: quotaUpdateBodySchema, response: { 200: quotaUpdateResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema } },
  }, async (request, reply) => {
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    const visible = createDatabasePersonDetail(database, request.params.id, newApi, new Date(), dataScopeFor(request.authUser))
    if (!visible) return reply.status(404).send({ error: { code: 'PERSON_NOT_FOUND', message: '未找到可调整软目标的人员', requestId: request.id } })
    const existing = database.listQuotaPolicies().find((item) => item.level === 'person' && item.subjectId === request.params.id && item.period === 'month')
    const policyId = existing?.id ?? `quota-person-${request.params.id}-month`
    const previousTargetPoints = existing?.targetPoints ?? visible.metrics.monthPointLimit
    const idempotencyFingerprint = createHash('sha256').update(`${request.params.id}:${request.body.targetPoints}`).digest('hex')
    const auditEventId = `audit-${request.body.idempotencyKey}`
    try {
      const result = database.updateMonthlySoftQuotaPolicy({ id: policyId, level: 'person', subjectId: request.params.id, targetPoints: request.body.targetPoints }, {
        id: auditEventId, actorUserId: request.authUser?.id ?? null, action: 'update', resourceType: 'quota', resourceId: policyId,
        result: 'success', requestId: request.id,
        summary: {
          message: '已调整本地 SQLite 人员月度软目标；未开启硬额度，未调用 New API，也未记录调整原因原文。', resourceName: `${visible.profile.name} · 月度软目标`,
          reasonProvided: true, reasonLength: request.body.reason.length, idempotencyFingerprint, previousTargetPoints,
          changes: [{ field: 'targetPoints', label: '人员月度软目标', before: `${previousTargetPoints.toLocaleString('zh-CN')} 点`, after: `${request.body.targetPoints.toLocaleString('zh-CN')} 点`, sensitive: false }],
        },
      })
      if (!result) return reply.status(404).send({ error: { code: 'PERSON_NOT_FOUND', message: '该人员软目标已不可用，请刷新后重试', requestId: request.id } })
      const reserved = 0
      const projectedPercent = Number(((visible.metrics.monthPoints + reserved) / result.targetPoints * 100).toFixed(1))
      return {
        meta: { source: 'database' as const, completedAt: new Date().toISOString(), notice: '已更新本地 SQLite 人员月度软目标；该目标仅用于演示提示，不会阻断请求或调用 New API。' },
        policy: { id: result.id, nodeId: request.params.id, level: result.level, targetPoints: result.targetPoints, mode: 'soft' as const },
        impact: { previousTargetPoints: result.previousTargetPoints, used: visible.metrics.monthPoints, reserved, projectedPercent },
        operation: { idempotencyKey: request.body.idempotencyKey, idempotent: result.idempotent, auditEventId },
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') return reply.status(409).send({ error: { code: 'IDEMPOTENCY_KEY_REUSED', message: '该人员软目标操作编号已用于其他目标值', requestId: request.id } })
      throw error
    }
  })

  app.get('/api/people/:id', {
    schema: {
      params: personIdParamsSchema,
      response: { 200: personDetailResponseSchema, 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema, 502: errorResponseSchema, 503: errorResponseSchema },
    },
  }, async (request, reply) => {
    const upstreamPrimary = upstreamDataPrimary
    if (upstreamPrimary || peopleManagementClient.authConfigured) {
      if (!newApiDatabase && !peopleManagementClient.authConfigured) return reply.status(503).send({ error: { code: 'NEW_API_AUTH_REQUIRED', message: 'New API 数据源尚未配置，人员详情不会读取本地镜像数据', requestId: request.id } })
      try {
        const source = await readNewApiPeople(peopleReadClient, database)
        const tokens = managedTokenSourceAvailable ? await readManagedTokens() : []
        await autoSyncPeople(request.authUser?.id ?? null, request.id)
        for (const token of tokens) await syncManagedToken(token)
        const result = createNewApiPersonDetail(source.people, tokens, request.params.id, new Date(), dataScopeFor(request.authUser))
        if (result) return result
        return reply.status(404).send({ error: { code: 'PERSON_NOT_FOUND', message: 'New API 中未找到指定人员', requestId: request.id } })
      } catch (error) {
        markPeopleSyncStale(database)
        if (error instanceof PeopleSyncReadError) {
          const status = error.state === 'auth_required' ? 401 : 503
          return reply.status(status).send({ error: { code: error.state === 'auth_required' ? 'NEW_API_AUTH_REQUIRED' : 'PEOPLE_SYNC_UNAVAILABLE', message: error.message, requestId: request.id } })
        }
        if (error instanceof ManagedKeyError) return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id } })
        return reply.status(502).send({ error: { code: 'NEW_API_UNAVAILABLE', message: 'New API 人员详情暂时无法读取', requestId: request.id } })
      }
    }
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    const result = createDatabasePersonDetail(database, request.params.id, newApi, new Date(), dataScopeFor(request.authUser))
    if (result) return result
    return reply.status(404).send({ error: { code: 'PERSON_NOT_FOUND', message: '未找到指定人员', requestId: request.id } })
  })

  app.get('/api/people/:id/usage', {
    schema: {
      params: personIdParamsSchema,
      querystring: personUsageQuerySchema,
      response: { 200: personUsageResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 502: errorResponseSchema, 503: errorResponseSchema },
    },
  }, async (request, reply) => {
    const upstreamPrimary = upstreamDataPrimary
    if (newApiDatabase) return createNewApiPersonUsage(newApiDatabase, request.params.id, request.query.period, new Date())
    if (upstreamPrimary || peopleManagementClient.authConfigured) {
      return reply.status(503).send({ error: { code: 'NEW_API_USAGE_UNAVAILABLE', message: 'New API 真实日志统计适配器尚未接入，暂不读取 AI OPS 本地用量镜像', requestId: request.id } })
    }
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    const result = createDatabasePersonUsage(database, request.params.id, request.query.period, newApi, new Date(), dataScopeFor(request.authUser))
    if (result) return result
    return reply.status(404).send({ error: { code: 'PERSON_NOT_FOUND', message: '未找到指定人员', requestId: request.id } })
  })

  app.get('/api/keys', {
    schema: { querystring: keysQuerySchema, response: { 200: keysResponseSchema, 400: errorResponseSchema, 409: errorResponseSchema, 502: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    const upstreamPrimary = upstreamDataPrimary
    const remoteKeysPrimary = upstreamPrimary || (managedKeysEnabled && peopleManagementClient.authConfigured)
    if (remoteKeysPrimary) {
      if (!newApiDatabase && (!managedKeysEnabled || !peopleManagementClient.authConfigured)) return reply.status(503).send({ error: { code: 'NEW_API_AUTH_REQUIRED', message: 'New API Token 数据源尚未配置，Key 页不会读取本地镜像数据', requestId: request.id } })
      try {
        return await remoteKeyResponse(request.query, new Date(), dataScopeFor(request.authUser))
      } catch (error) {
        if (error instanceof ManagedKeyError) return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id } })
        throw error
      }
    }
    if (upstreamPrimary) return reply.status(503).send({ error: { code: 'NEW_API_AUTH_REQUIRED', message: 'New API 管理凭据尚未配置，暂不读取本地 Key 镜像', requestId: request.id } })
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    return createDatabaseKeys(database, request.query, newApi, new Date(), dataScopeFor(request.authUser))
  })

  app.post('/api/keys', {
    schema: {
      body: keyCreateBodySchema,
      response: { 201: keyCreateResponseSchema, 400: errorResponseSchema, 409: errorResponseSchema, 502: errorResponseSchema, 503: errorResponseSchema },
    },
  }, async (request, reply) => {
    const upstreamPrimary = upstreamDataPrimary
    if (upstreamPrimary && (!managedKeysEnabled || !peopleManagementClient.authConfigured)) {
      return reply.status(503).send({ error: { code: 'NEW_API_AUTH_REQUIRED', message: 'New API 管理凭据尚未配置，暂不创建本地 Key', requestId: request.id } })
    }
    if (managedKeysEnabled) {
      if (!('personId' in request.body)) return reply.status(400).send({ error: { code: 'INVALID_KEY_REQUEST', message: 'New API Key 创建需要 personId、purpose 和 model', requestId: request.id } })
      try {
        const result = await createManagedKey(request.body.personId, request.body.purpose, request.body.model, keyOperationId(request), request.authUser?.id ?? null, request.id)
        return reply.status(201).send(result)
      } catch (error) {
        if (error instanceof ManagedKeyError) return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id } })
        throw error
      }
    }
    if (!('ownerId' in request.body)) return reply.status(503).send({ error: { code: 'NEW_API_UNAVAILABLE', message: 'New API 管理凭据尚未配置，暂不接受 New API Key 创建请求', requestId: request.id } })
    if (!database.ownerExists(request.body.ownerId)) {
      return reply.status(400).send({ error: { code: 'KEY_OWNER_NOT_FOUND', message: '请选择有效的在职人员', requestId: request.id } })
    }
    const secret = `sk-ops-${randomBytes(24).toString('base64url')}`
    const id = `key-${request.body.ownerId.replace(/^person-/, '')}-${Date.now()}`
    const expiresAt = new Date(Date.now() + request.body.expiresInDays * 86_400_000).toISOString()
    const masked = `sk-ops••••••${secret.slice(-4).toUpperCase()}`
    try {
      const created = database.createApiKey({ id, ownerUserId: request.body.ownerId, maskedValue: masked, secretHash: hashPlatformApiKey(secret), secretValue: secret, purpose: request.body.purpose, expiresAt, model: request.body.model, models: [request.body.model] }, {
        id: `audit-${id}-create`,
        actorUserId: request.authUser?.id ?? null,
        action: 'create',
        resourceType: 'key',
        resourceId: id,
        result: 'success',
        requestId: request.id,
        summary: {
          message: '已创建本地演示 Key；审计只记录掩码标识，不记录完整密钥。',
          resourceName: masked,
          changes: [
            { field: 'secret', label: '密钥内容', before: null, after: '已创建（不记录值）', sensitive: true },
            { field: 'purpose', label: '业务用途', before: null, after: request.body.purpose, sensitive: false },
            { field: 'model', label: '绑定模型', before: null, after: request.body.model, sensitive: false },
          ],
        },
      })
      if (!created || !created.departmentName || !created.expiresAt) throw new Error('KEY_CREATE_FAILED')
      return reply.status(201).send({
        meta: { source: 'database' as const, createdAt: created.createdAt, notice: '完整 Key 已加密保存；管理员可在列表中按需复制，服务端不会把完整值写入列表、日志或审计。' },
        key: { id: created.id, masked: created.maskedValue, owner: { id: created.ownerUserId, name: created.ownerName, department: created.departmentName }, purpose: created.purpose, model: created.model, models: [created.model], expiresAt: created.expiresAt },
        secret,
        operation: { auditEventId: `audit-${id}-create` },
      })
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: api_keys\.id/i.test(error.message)) {
        return reply.status(409).send({ error: { code: 'KEY_ID_CONFLICT', message: 'Key 编号冲突，请重试', requestId: request.id } })
      }
      throw error
    }
  })

  app.get('/api/keys/:id', {
    schema: { params: keyIdParamsSchema, response: { 200: keyDetailResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema, 502: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    const upstreamPrimary = upstreamDataPrimary
    const remoteKeysPrimary = upstreamPrimary || (managedKeysEnabled && peopleManagementClient.authConfigured)
    if (remoteKeysPrimary) {
      if (!newApiDatabase && (!managedKeysEnabled || !peopleManagementClient.authConfigured)) return reply.status(503).send({ error: { code: 'NEW_API_AUTH_REQUIRED', message: 'New API Token 数据源尚未配置，Key 详情不会读取本地镜像数据', requestId: request.id } })
      try {
        const remote = await remoteKeyDetail(request.params.id, new Date(), dataScopeFor(request.authUser))
        if (remote) return remote
      } catch (error) {
        if (error instanceof ManagedKeyError) return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id } })
        throw error
      }
    }
    if (upstreamPrimary) return reply.status(503).send({ error: { code: 'NEW_API_AUTH_REQUIRED', message: 'New API 管理凭据尚未配置，暂不读取本地 Key 镜像', requestId: request.id } })
    const result = createDatabaseKeyDetail(database, request.params.id, new Date(), dataScopeFor(request.authUser))
    if (result) return result
    return reply.status(404).send({ error: { code: 'KEY_NOT_FOUND', message: '未找到指定 Key', requestId: request.id } })
  })

  app.get('/api/keys/:id/secret', {
    schema: { params: keyIdParamsSchema, response: { 200: keySecretResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema, 410: errorResponseSchema, 502: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    const upstreamPrimary = upstreamDataPrimary
    const mirroredExternalKey = database.listApiKeys().some((item) => item.id === request.params.id && Boolean(item.externalTokenId))
    const remoteKeysPrimary = upstreamPrimary || (managedKeysEnabled && (peopleManagementClient.authConfigured || mirroredExternalKey))
    if (remoteKeysPrimary) {
      if (!newApiDatabase && !managedKeysEnabled) return reply.status(503).send({ error: { code: 'NEW_API_TOKEN_SOURCE_REQUIRED', message: 'New API Token 数据源尚未配置，不能从本地镜像读取 Key 明文', requestId: request.id } })
      try {
        const remote = await remoteKeySecret(request.params.id, new Date(), dataScopeFor(request.authUser))
        if (!remote) return reply.status(404).send({ error: { code: 'KEY_NOT_FOUND', message: '未找到指定 New API Token', requestId: request.id } })
        const auditEventId = `audit-key-view-${crypto.randomUUID()}`
        database.appendAuditEvent({
          id: auditEventId, actorUserId: request.authUser?.id ?? null, action: 'view', resourceType: 'key', resourceId: request.params.id,
          result: 'success', requestId: request.id,
          summary: {
            code: 'KEY_SECRET_VIEWED', message: '管理员按需复制了 New API Key；审计只记录查看动作，不记录完整凭据。', resourceName: remote.visible.key.masked,
            changes: [{ field: 'secret', label: '密钥内容', before: '已隐藏', after: '已查看（不记录值）', sensitive: true }],
          },
        })
        return {
          meta: { source: 'new_api' as const, completedAt: new Date().toISOString(), notice: '已从 New API 按需读取完整 Key；明文仅返回本次请求并写入剪贴板，服务端不保存。' },
          key: { id: remote.visible.key.id, masked: remote.visible.key.masked }, secret: remote.secret,
          operation: { auditEventId },
        }
      } catch (error) {
        if (error instanceof KeySecretNotRetrievableError) return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id } })
        if (error instanceof ManagedKeyError) return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id } })
        throw error
      }
    }
    if (upstreamPrimary) return reply.status(503).send({ error: { code: 'NEW_API_AUTH_REQUIRED', message: 'New API 管理凭据尚未配置，不能读取本地 Key 明文', requestId: request.id } })
    const visible = createDatabaseKeyDetail(database, request.params.id, new Date(), dataScopeFor(request.authUser))
    if (!visible) return reply.status(404).send({ error: { code: 'KEY_NOT_FOUND', message: '未找到指定 Key', requestId: request.id } })
    if (database.listApiKeys().some((item) => item.id === request.params.id && item.externalTokenId)) return reply.status(410).send({ error: { code: 'KEY_SECRET_NOT_RETRIEVABLE', message: 'New API 不允许再次读取员工 Key 明文；请停用旧 Token 后重新创建', requestId: request.id } })
    const secret = database.readApiKeySecret(request.params.id)
    if (!secret) return reply.status(409).send({ error: { code: 'KEY_SECRET_UNAVAILABLE', message: '该 Key 尚未保存可查看的凭据，请先重置 Key', requestId: request.id } })
    const auditEventId = `audit-key-view-${crypto.randomUUID()}`
    database.appendAuditEvent({
      id: auditEventId, actorUserId: request.authUser?.id ?? null, action: 'view', resourceType: 'key', resourceId: request.params.id,
      result: 'success', requestId: request.id,
      summary: {
        code: 'KEY_SECRET_VIEWED', message: '管理员查看了本地 Key；审计只记录查看动作，不记录完整凭据。', resourceName: visible.key.masked,
        changes: [{ field: 'secret', label: '密钥内容', before: '已隐藏', after: '已查看（不记录值）', sensitive: true }],
      },
    })
    return {
      meta: { source: 'database' as const, completedAt: new Date().toISOString(), notice: '已返回本地加密保存的 Key；完整值不会进入列表、日志或审计摘要。' },
      key: { id: visible.key.id, masked: visible.key.masked }, secret,
      operation: { auditEventId },
    }
  })

  app.post('/api/keys/:id/disable', {
    schema: { params: keyIdParamsSchema, body: keyDisableBodySchema, response: { 200: keyDisableResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema, 502: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    const upstreamPrimary = upstreamDataPrimary
    const remoteKeysPrimary = upstreamPrimary || (managedKeysEnabled && peopleManagementClient.authConfigured)
    try {
      let visible: ReturnType<typeof createDatabaseKeyDetail>
      let external: string | null | undefined
      let externalUserId: string | null | undefined
      if (remoteKeysPrimary) {
        if (!managedKeysEnabled || !peopleManagementClient.authConfigured) return reply.status(503).send({ error: { code: 'NEW_API_AUTH_REQUIRED', message: 'New API 管理凭据尚未配置，Key 停用不会读取本地镜像数据', requestId: request.id } })
        const live = await loadRemoteKeyForMutation(request.params.id, request.authUser?.id ?? null, request.id, dataScopeFor(request.authUser))
        if (!live) return reply.status(404).send({ error: { code: 'KEY_NOT_FOUND', message: '未找到指定 New API Token', requestId: request.id } })
        visible = live.visible
        external = live.externalTokenId
        externalUserId = live.externalUserId
      } else {
        visible = createDatabaseKeyDetail(database, request.params.id, new Date(), dataScopeFor(request.authUser))
        external = database.listApiKeys().find((item) => item.id === request.params.id)?.externalTokenId
      }
      if (!visible) return reply.status(404).send({ error: { code: 'KEY_NOT_FOUND', message: '未找到指定 Key', requestId: request.id } })
      if (managedKeysEnabled && external) {
        if (visible.key.status === 'disabled') return reply.status(409).send({ error: { code: 'KEY_ALREADY_DISABLED', message: '该 Key 已停用，请勿重复提交新的操作', requestId: request.id } })
        const remote = await newApiTokenClient.updateTokenStatus(external, 0, externalUserId ?? undefined)
        if (remote.state !== 'ready') {
          const failure = remoteTokenError(remote)
          return reply.status(failure.statusCode).send({ error: { code: failure.code, message: failure.message, requestId: request.id } })
        }
        const auditEventId = `audit-${request.body.idempotencyKey}`
        const result = database.disableApiKey(request.params.id, {
        id: auditEventId, actorUserId: request.authUser?.id ?? null, action: 'disable', resourceType: 'key', resourceId: request.params.id,
        result: 'success', requestId: request.id,
        summary: {
          code: 'NEW_API_TOKEN_DISABLED', message: '已调用 New API 停用管理员账号下的 Token；AI OPS 按本地人员映射同步状态。审计只记录外部 ID、掩码和状态，不记录明文。', resourceName: visible.key.masked,
          externalTokenId: external, reasonProvided: Boolean((request.body.reason ?? '').trim()), reasonLength: (request.body.reason ?? '').trim().length,
          changes: [{ field: 'status', label: 'Key 状态', before: '启用', after: '停用', sensitive: false }],
        },
        })
        if (!result) return reply.status(404).send({ error: { code: 'KEY_NOT_FOUND', message: '未找到指定 Key', requestId: request.id } })
        return { meta: { source: 'new_api' as const, completedAt: new Date().toISOString(), notice: '已由 New API 停用管理员账号下的 Token；AI OPS 已同步保存所选人员映射的停用状态。' }, key: { id: result.key.id, masked: result.key.maskedValue, status: 'disabled' as const }, operation: { idempotencyKey: request.body.idempotencyKey, idempotent: result.idempotent, auditEventId } }
      }
      const auditEventId = `audit-${request.body.idempotencyKey}`
      const result = database.disableApiKey(request.params.id, {
        id: auditEventId, actorUserId: request.authUser?.id ?? null, action: 'disable', resourceType: 'key', resourceId: request.params.id,
        result: 'success', requestId: request.id,
        summary: {
          message: '已停用本地 SQLite 演示 Key；未调用 New API，未记录完整 Key 或停用原因原文。', resourceName: visible.key.masked,
          reasonProvided: Boolean((request.body.reason ?? '').trim()), reasonLength: (request.body.reason ?? '').trim().length,
          changes: [{ field: 'status', label: 'Key 状态', before: '启用', after: '停用', sensitive: false }],
        },
      })
      if (!result) return reply.status(404).send({ error: { code: 'KEY_NOT_FOUND', message: '未找到指定 Key', requestId: request.id } })
      if (result.state === 'already_disabled') return reply.status(409).send({ error: { code: 'KEY_ALREADY_DISABLED', message: '该 Key 已停用，请勿重复提交新的操作', requestId: request.id } })
      return { meta: { source: 'database' as const, completedAt: new Date().toISOString(), notice: '已停用本地 SQLite 演示 Key；未调用 New API 或修改真实凭据。' }, key: { id: result.key.id, masked: result.key.maskedValue, status: 'disabled' as const }, operation: { idempotencyKey: request.body.idempotencyKey, idempotent: result.idempotent, auditEventId } }
    } catch (error) {
      if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') return reply.status(409).send({ error: { code: 'IDEMPOTENCY_KEY_REUSED', message: '该幂等操作编号已用于另一条 Key', requestId: request.id } })
      throw error
    }
  })

  app.post('/api/keys/:id/enable', {
    schema: { params: keyIdParamsSchema, body: keyEnableBodySchema, response: { 200: keyEnableResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema, 502: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    const upstreamPrimary = upstreamDataPrimary
    const remoteKeysPrimary = upstreamPrimary || (managedKeysEnabled && peopleManagementClient.authConfigured)
    try {
      let visible: ReturnType<typeof createDatabaseKeyDetail>
      let external: string | null | undefined
      let externalUserId: string | null | undefined
      if (remoteKeysPrimary) {
        if (!managedKeysEnabled || !peopleManagementClient.authConfigured) return reply.status(503).send({ error: { code: 'NEW_API_AUTH_REQUIRED', message: 'New API 管理凭据未配置，Key 启用不会读取本地镜像数据', requestId: request.id } })
        const live = await loadRemoteKeyForMutation(request.params.id, request.authUser?.id ?? null, request.id, dataScopeFor(request.authUser))
        if (!live) return reply.status(404).send({ error: { code: 'KEY_NOT_FOUND', message: '未找到指定 New API Token', requestId: request.id } })
        visible = live.visible
        external = live.externalTokenId
        externalUserId = live.externalUserId
      } else {
        visible = createDatabaseKeyDetail(database, request.params.id, new Date(), dataScopeFor(request.authUser))
        external = database.listApiKeys().find((item) => item.id === request.params.id)?.externalTokenId
      }
      if (!visible) return reply.status(404).send({ error: { code: 'KEY_NOT_FOUND', message: '未找到指定 Key', requestId: request.id } })
      if (visible.key.status === 'active') return reply.status(409).send({ error: { code: 'KEY_ALREADY_ENABLED', message: '该 Key 已启用，请勿重复提交新的操作', requestId: request.id } })
      if (managedKeysEnabled && external) {
        const remote = await newApiTokenClient.updateTokenStatus(external, 1, externalUserId ?? undefined)
        if (remote.state !== 'ready') {
          const failure = remoteTokenError(remote)
          return reply.status(failure.statusCode).send({ error: { code: failure.code, message: failure.message, requestId: request.id } })
        }
      }
      const auditEventId = `audit-${request.body.idempotencyKey}`
      const result = database.enableApiKey(request.params.id, {
        id: auditEventId, actorUserId: request.authUser?.id ?? null, action: 'enable', resourceType: 'key', resourceId: request.params.id,
        result: 'success', requestId: request.id,
        summary: { code: 'KEY_ENABLED', message: managedKeysEnabled && external ? '已启用 New API Token，并同步 AI OPS 中的 Key 状态。' : '已启用本地 SQLite Key。', resourceName: visible.key.masked, changes: [{ field: 'status', label: 'Key 状态', before: '停用', after: '启用', sensitive: false }] },
      })
      if (!result) return reply.status(404).send({ error: { code: 'KEY_NOT_FOUND', message: '未找到指定 Key', requestId: request.id } })
      if (result.state === 'already_enabled') return reply.status(409).send({ error: { code: 'KEY_ALREADY_ENABLED', message: '该 Key 已启用，请勿重复提交新的操作', requestId: request.id } })
      return { meta: { source: managedKeysEnabled && external ? 'new_api' as const : 'database' as const, completedAt: new Date().toISOString(), notice: managedKeysEnabled && external ? '已启用 New API Token；AI OPS 已同步保存 Key 状态。' : '已启用本地 SQLite Key。' }, key: { id: result.key.id, masked: result.key.maskedValue, status: 'active' as const }, operation: { idempotencyKey: request.body.idempotencyKey, idempotent: result.idempotent, auditEventId } }
    } catch (error) {
      if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') return reply.status(409).send({ error: { code: 'IDEMPOTENCY_KEY_REUSED', message: '该幂等操作编号已用于另一条 Key', requestId: request.id } })
      throw error
    }
  })

  app.post('/api/keys/:id/delete', {
    schema: { params: keyIdParamsSchema, body: keyDeleteBodySchema, response: { 200: keyDeleteResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema, 502: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    const upstreamPrimary = upstreamDataPrimary
    const remoteKeysPrimary = upstreamPrimary || (managedKeysEnabled && peopleManagementClient.authConfigured)
    try {
      let visible: ReturnType<typeof createDatabaseKeyDetail>
      let external: string | null | undefined
      let externalUserId: string | null | undefined
      if (remoteKeysPrimary) {
        if (!managedKeysEnabled || !peopleManagementClient.authConfigured) return reply.status(503).send({ error: { code: 'NEW_API_AUTH_REQUIRED', message: 'New API 管理凭据未配置，Key 删除不会读取本地镜像数据', requestId: request.id } })
        const live = await loadRemoteKeyForMutation(request.params.id, request.authUser?.id ?? null, request.id, dataScopeFor(request.authUser))
        if (!live) return reply.status(404).send({ error: { code: 'KEY_NOT_FOUND', message: '未找到指定 New API Token', requestId: request.id } })
        visible = live.visible
        external = live.externalTokenId
        externalUserId = live.externalUserId
      } else {
        visible = createDatabaseKeyDetail(database, request.params.id, new Date(), dataScopeFor(request.authUser))
        external = database.listApiKeys().find((item) => item.id === request.params.id)?.externalTokenId
      }
      if (!visible) return reply.status(404).send({ error: { code: 'KEY_NOT_FOUND', message: '未找到指定 Key', requestId: request.id } })
      if (managedKeysEnabled && external) {
        const remote = newApiTokenClient.deleteToken
          ? await newApiTokenClient.deleteToken(external, externalUserId ?? undefined)
          : await newApiTokenClient.updateTokenStatus(external, 0, externalUserId ?? undefined)
        if (remote.state !== 'ready') {
          const failure = remoteTokenError(remote)
          return reply.status(failure.statusCode).send({ error: { code: failure.code, message: failure.message, requestId: request.id } })
        }
      }
      const auditEventId = `audit-${request.body.idempotencyKey}`
      const result = database.deleteApiKey(request.params.id, {
        id: auditEventId, actorUserId: request.authUser?.id ?? null, action: 'delete', resourceType: 'key', resourceId: request.params.id,
        result: 'success', requestId: request.id,
        summary: { code: 'KEY_DELETED', message: managedKeysEnabled && external ? '已删除 New API Token，并移除 AI OPS 中的 Key 映射。' : '已删除本地 SQLite Key；历史审计和用量记录保留。', resourceName: visible.key.masked, reasonProvided: Boolean((request.body.reason ?? '').trim()), reasonLength: (request.body.reason ?? '').trim().length, changes: [{ field: 'status', label: 'Key 状态', before: visible.key.status === 'disabled' ? '停用' : '启用', after: '删除', sensitive: false }] },
      })
      if (!result) return reply.status(404).send({ error: { code: 'KEY_NOT_FOUND', message: '未找到指定 Key', requestId: request.id } })
      if (result.state === 'already_deleted') return reply.status(409).send({ error: { code: 'KEY_ALREADY_DELETED', message: '该 Key 已删除，请勿重复提交新的操作', requestId: request.id } })
      return { meta: { source: managedKeysEnabled && external ? 'new_api' as const : 'database' as const, completedAt: new Date().toISOString(), notice: managedKeysEnabled && external ? '已删除 New API Token，并同步移除 AI OPS 中的 Key 映射。' : '已删除本地 SQLite Key；历史审计和用量记录仍保留。' }, key: { id: result.key.id, masked: result.key.maskedValue, status: 'deleted' as const }, operation: { idempotencyKey: request.body.idempotencyKey, idempotent: result.idempotent, auditEventId } }
    } catch (error) {
      if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') return reply.status(409).send({ error: { code: 'IDEMPOTENCY_KEY_REUSED', message: '该幂等操作编号已用于另一条 Key', requestId: request.id } })
      throw error
    }
  })

  app.post('/api/keys/:id/rotate', {
    schema: { params: keyIdParamsSchema, body: keyRotateBodySchema, response: { 200: keyRotateResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema } },
  }, async (request, reply) => {
    const upstreamPrimary = upstreamDataPrimary
    if (upstreamPrimary) return reply.status(409).send({ error: { code: 'KEY_MIGRATED_TO_NEW_API', message: 'Key 由 New API 管理，不能在 AI OPS 中本地轮换；请在 New API 中停用旧 Token 后重新创建', requestId: request.id } })
    const visible = createDatabaseKeyDetail(database, request.params.id, new Date(), dataScopeFor(request.authUser))
    if (!visible) return reply.status(404).send({ error: { code: 'KEY_NOT_FOUND', message: '未找到指定 Key', requestId: request.id } })
    if (managedKeysEnabled && database.listApiKeys().some((item) => item.id === request.params.id && item.externalTokenId)) return reply.status(409).send({ error: { code: 'KEY_MIGRATED_TO_NEW_API', message: '该 Key 由 New API 管理，不能在 AI OPS 中本地轮换；请停用后重新创建', requestId: request.id } })
    const digest = createHash('sha256').update(request.body.idempotencyKey).digest('hex')
    const rotationId = `key-${visible.key.owner.id.replace(/^person-/, '')}-rotate-${digest.slice(0, 11)}-${Number.parseInt(digest.slice(11, 12), 16) % 10}`
    const idempotencyFingerprint = createHash('sha256').update(`${request.params.id}:${request.body.expiresInDays}`).digest('hex')
    const secret = `sk-ops-${randomBytes(24).toString('base64url')}`
    const expiresAt = new Date(Date.now() + request.body.expiresInDays * 86_400_000).toISOString()
    const auditEventId = `audit-${request.body.idempotencyKey}`
    try {
      const result = database.rotateApiKey(request.params.id, {
        id: rotationId, ownerUserId: visible.key.owner.id, maskedValue: `sk-ops••••••${secret.slice(-4).toUpperCase()}`, secretHash: hashPlatformApiKey(secret), secretValue: secret,
        purpose: visible.key.purpose, expiresAt, model: visible.key.model, models: [visible.key.model],
      }, {
        id: auditEventId, actorUserId: request.authUser?.id ?? null, action: 'rotate', resourceType: 'key', resourceId: request.params.id,
        result: 'success', requestId: request.id,
        summary: {
          message: '已轮换本地 SQLite 演示 Key；新 Key 继承原 Key 的单一绑定模型，未调用 New API，未记录完整 Key 或轮换原因原文。', resourceName: visible.key.masked,
          reasonProvided: true, reasonLength: request.body.reason.length, idempotencyFingerprint,
          changes: [
            { field: 'status', label: '旧 Key 状态', before: '启用', after: '停用', sensitive: false },
            { field: 'replacement', label: '替换 Key', before: null, after: `已创建 ${`sk-ops••••••${secret.slice(-4).toUpperCase()}`}`, sensitive: false },
            { field: 'secret', label: '密钥内容', before: '旧值不记录', after: '新值仅首次响应返回', sensitive: true },
          ],
        },
      })
      if (!result) return reply.status(404).send({ error: { code: 'KEY_NOT_FOUND', message: '未找到指定 Key', requestId: request.id } })
      if (result.state === 'already_disabled' || !result.newKey || !result.newKey.departmentName || !result.newKey.expiresAt) return reply.status(409).send({ error: { code: 'KEY_ALREADY_DISABLED', message: '该 Key 已停用，无法执行轮换', requestId: request.id } })
      return {
        meta: { source: 'database' as const, completedAt: new Date().toISOString(), secretAvailable: !result.idempotent, notice: result.idempotent ? '该轮换操作已完成；为保护凭据，完整新 Key 不会再次返回。' : '已轮换本地 SQLite 演示 Key；旧 Key 已停用，完整新 Key 仅在本次响应中返回一次。' },
        oldKey: { id: result.oldKey.id, masked: result.oldKey.maskedValue, status: 'disabled' as const },
        key: { id: result.newKey.id, masked: result.newKey.maskedValue, owner: { id: result.newKey.ownerUserId, name: result.newKey.ownerName, department: result.newKey.departmentName }, purpose: result.newKey.purpose, model: result.newKey.model, models: [result.newKey.model], expiresAt: result.newKey.expiresAt },
        secret: result.idempotent ? null : secret,
        operation: { idempotencyKey: request.body.idempotencyKey, idempotent: result.idempotent, auditEventId },
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') return reply.status(409).send({ error: { code: 'IDEMPOTENCY_KEY_REUSED', message: '该幂等操作编号已用于另一条 Key', requestId: request.id } })
      if (error instanceof Error && /UNIQUE constraint failed: api_keys\.id/i.test(error.message)) return reply.status(409).send({ error: { code: 'KEY_ID_CONFLICT', message: 'Key 编号冲突，请使用新的操作编号重试', requestId: request.id } })
      throw error
    }
  })

  app.post('/api/keys/:id/reset', {
    schema: { params: keyIdParamsSchema, body: keyResetBodySchema, response: { 200: keyResetResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema } },
  }, async (request, reply) => {
    const upstreamPrimary = upstreamDataPrimary
    if (upstreamPrimary) return reply.status(409).send({ error: { code: 'KEY_MIGRATED_TO_NEW_API', message: 'Key 由 New API 管理，不能在 AI OPS 中本地重置；请在 New API 中停用旧 Token 后重新创建', requestId: request.id } })
    const visible = createDatabaseKeyDetail(database, request.params.id, new Date(), dataScopeFor(request.authUser))
    if (!visible) return reply.status(404).send({ error: { code: 'KEY_NOT_FOUND', message: '未找到指定 Key', requestId: request.id } })
    if (managedKeysEnabled && database.listApiKeys().some((item) => item.id === request.params.id && item.externalTokenId)) return reply.status(409).send({ error: { code: 'KEY_MIGRATED_TO_NEW_API', message: '该 Key 由 New API 管理，不能在 AI OPS 中本地重置；请停用后重新创建', requestId: request.id } })
    const secret = `sk-ops-${randomBytes(24).toString('base64url')}`
    const masked = `sk-ops••••••${secret.slice(-4).toUpperCase()}`
    const idempotencyFingerprint = createHash('sha256').update(request.params.id).digest('hex')
    const auditEventId = `audit-${request.body.idempotencyKey}`
    try {
      const result = database.resetApiKey(request.params.id, {
        maskedValue: masked, secretHash: hashPlatformApiKey(secret), secretValue: secret,
      }, {
        id: auditEventId, actorUserId: request.authUser?.id ?? null, action: 'reset', resourceType: 'key', resourceId: request.params.id,
        result: 'success', requestId: request.id,
        summary: {
          code: 'KEY_RESET', message: '已重置本地 SQLite Key；原 Key 编号、用途、绑定模型和有效期保持不变，未调用 New API。', resourceName: visible.key.masked,
          idempotencyFingerprint,
          changes: [
            { field: 'secret', label: '密钥内容', before: '旧值不记录', after: '已重置（不记录值）', sensitive: true },
            { field: 'masked', label: 'Key 掩码', before: visible.key.masked, after: masked, sensitive: false },
          ],
        },
      })
      if (!result) return reply.status(404).send({ error: { code: 'KEY_NOT_FOUND', message: '未找到指定 Key', requestId: request.id } })
      if (result.state === 'already_disabled' || !result.key.departmentName || !result.key.expiresAt) return reply.status(409).send({ error: { code: 'KEY_ALREADY_DISABLED', message: '该 Key 已停用，无法重置', requestId: request.id } })
      const returnedSecret = result.secret ?? database.readApiKeySecret(request.params.id)
      if (!returnedSecret) return reply.status(409).send({ error: { code: 'KEY_SECRET_UNAVAILABLE', message: 'Key 重置完成，但凭据暂时不可读取，请重试', requestId: request.id } })
      return {
        meta: { source: 'database' as const, completedAt: new Date().toISOString(), notice: 'Key 已重置；Key 编号、用途、绑定模型和有效期不变，新的完整值可在详情中再次查看。' },
        key: { id: result.key.id, masked: result.key.maskedValue, owner: { id: result.key.ownerUserId, name: result.key.ownerName, department: result.key.departmentName }, purpose: result.key.purpose, model: result.key.model, models: [result.key.model], expiresAt: result.key.expiresAt },
        secret: returnedSecret,
        operation: { idempotencyKey: request.body.idempotencyKey, idempotent: result.idempotent, auditEventId },
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') return reply.status(409).send({ error: { code: 'IDEMPOTENCY_KEY_REUSED', message: '该幂等操作编号已用于另一条 Key', requestId: request.id } })
      throw error
    }
  })

  app.get('/api/limits', {
    schema: { querystring: limitsQuerySchema, response: { 200: limitsResponseSchema, 400: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    if (upstreamDataPrimary) return reply.status(503).send({ error: { code: 'UPSTREAM_QUOTA_UNAVAILABLE', message: '真实额度由 New API/CPA 管理源提供，当前没有可用的主库额度适配器', requestId: request.id } })
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    return createDatabaseLimits(database, request.query, newApi, new Date(), dataScopeFor(request.authUser))
  })

  app.patch('/api/limits/:id', {
    schema: { params: limitIdParamsSchema, body: quotaUpdateBodySchema, response: { 200: quotaUpdateResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    if (upstreamDataPrimary) return reply.status(503).send({ error: { code: 'UPSTREAM_QUOTA_READ_ONLY', message: '额度写操作必须通过 New API/CPA 主数据适配器，当前不会写入本地镜像', requestId: request.id } })
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    const visible = createDatabaseLimits(database, { level: 'all', search: '' }, newApi, new Date(), dataScopeFor(request.authUser)).items.find((item) => item.id === request.params.id)
    if (!visible) return reply.status(404).send({ error: { code: 'LIMIT_SCOPE_NOT_FOUND', message: '未找到可调整的额度范围', requestId: request.id } })
    const month = visible.periods.find((period) => period.id === 'month')
    if (!month) return reply.status(404).send({ error: { code: 'LIMIT_SCOPE_NOT_FOUND', message: '该额度范围缺少月度软目标', requestId: request.id } })
    const subjectId = quotaPolicySubject(visible)
    const existing = database.listQuotaPolicies().find((item) => item.level === visible.level && item.subjectId === subjectId && item.period === 'month')
    const policyId = existing?.id ?? `quota-override-${visible.level}-${subjectId}-month`
    const previousTargetPoints = existing?.targetPoints ?? month.limit
    const idempotencyFingerprint = createHash('sha256').update(`${visible.id}:${request.body.targetPoints}`).digest('hex')
    const auditEventId = `audit-${request.body.idempotencyKey}`
    try {
      const result = database.updateMonthlySoftQuotaPolicy({ id: policyId, level: visible.level, subjectId, targetPoints: request.body.targetPoints }, {
        id: auditEventId, actorUserId: request.authUser?.id ?? null, action: 'update', resourceType: 'quota', resourceId: policyId,
        result: 'success', requestId: request.id,
        summary: {
          message: '已调整本地 SQLite 月度软目标；未开启硬额度，未调用 New API，也未记录调整原因原文。', resourceName: `${visible.name} · 月度软目标`,
          reasonProvided: true, reasonLength: request.body.reason.length, idempotencyFingerprint, previousTargetPoints,
          changes: [{ field: 'targetPoints', label: '月度软目标', before: `${previousTargetPoints.toLocaleString('zh-CN')} 点`, after: `${request.body.targetPoints.toLocaleString('zh-CN')} 点`, sensitive: false }],
        },
      })
      if (!result) return reply.status(404).send({ error: { code: 'LIMIT_SCOPE_NOT_FOUND', message: '该额度范围已不可用，请刷新后重试', requestId: request.id } })
      const projectedPercent = Number(((month.used + month.reserved) / result.targetPoints * 100).toFixed(1))
      return {
        meta: { source: 'database' as const, completedAt: new Date().toISOString(), notice: '已更新本地 SQLite 月度软目标；该目标仅用于演示提示，不会阻断请求或调用 New API。' },
        policy: { id: result.id, nodeId: visible.id, level: result.level, targetPoints: result.targetPoints, mode: 'soft' as const },
        impact: { previousTargetPoints: result.previousTargetPoints, used: month.used, reserved: month.reserved, projectedPercent },
        operation: { idempotencyKey: request.body.idempotencyKey, idempotent: result.idempotent, auditEventId },
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') return reply.status(409).send({ error: { code: 'IDEMPOTENCY_KEY_REUSED', message: '该幂等操作编号已用于其他额度调整或不同目标值', requestId: request.id } })
      throw error
    }
  })

  app.get('/api/quota-reservations', {
    schema: { querystring: quotaReservationQuerySchema, response: { 200: quotaReservationsResponseSchema } },
  }, async (request) => {
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    const visibleIds = new Set(createDatabaseLimits(database, { level: 'all', search: '' }, newApi, new Date(), dataScopeFor(request.authUser)).items.map((item) => item.id))
    const query = request.query
    const nodeId = query.nodeId && visibleIds.has(query.nodeId) ? query.nodeId : query.nodeId ? '__not-visible__' : undefined
    return createQuotaReservationsResponse(database, { ...query, nodeId }, { canDecide: request.authUser?.role === 'super_admin' || request.authUser?.role === 'admin' })
  })

  app.post('/api/quota-reservations', {
    schema: { body: quotaReservationBodySchema, response: { 200: quotaReservationActionResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema } },
  }, async (request, reply) => {
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    const visible = createDatabaseLimits(database, { level: 'all', search: '' }, newApi, new Date(), dataScopeFor(request.authUser)).items.find((item) => item.id === request.body.nodeId)
    if (!visible) return reply.status(404).send({ error: { code: 'QUOTA_SCOPE_NOT_FOUND', message: '未找到当前范围内的额度节点', requestId: request.id } })
    const id = `quota-reservation-${createHash('sha256').update(request.body.idempotencyKey).digest('hex').slice(0, 24)}`
    const auditEventId = `audit-${request.body.idempotencyKey}`
    try {
      const result = database.createQuotaReservation({
        id, nodeId: visible.id, nodeName: visible.name, points: request.body.points, concurrentUnits: request.body.concurrentUnits,
        actorUserId: request.authUser?.id ?? null, idempotencyKey: request.body.idempotencyKey,
      }, {
        id: auditEventId, actorUserId: request.authUser?.id ?? null, action: 'create', resourceType: 'quota', resourceId: id, result: 'success', requestId: request.id,
        summary: { code: 'QUOTA_RESERVATION_CREATED', message: '已创建本地并发预留演练；不会阻断请求、调用 New API 或改变真实网关额度。', resourceName: visible.name, nodeId: visible.id, points: request.body.points, concurrentUnits: request.body.concurrentUnits, reasonLength: request.body.reason.length, idempotencyFingerprint: createHash('sha256').update(`${visible.id}:${request.body.points}:${request.body.concurrentUnits}`).digest('hex') },
      }, new Date())
      return {
        meta: { source: 'database' as const, completedAt: new Date().toISOString(), notice: '预留已写入本地 SQLite；当前仅用于验证预留路径，不启用硬额度阻断。' },
        reservation: mapQuotaReservation(result.reservation), operation: { idempotencyKey: request.body.idempotencyKey, idempotent: result.idempotent, auditEventId },
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') return reply.status(409).send({ error: { code: 'IDEMPOTENCY_KEY_REUSED', message: '该幂等操作编号已用于其他预留或不同范围', requestId: request.id } })
      throw error
    }
  })

  app.patch('/api/quota-reservations/:id', {
    schema: { params: quotaReservationParamsSchema, body: quotaReservationActionBodySchema, response: { 200: quotaReservationActionResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema } },
  }, async (request, reply) => {
    const current = database.listQuotaReservations().find((item) => item.id === request.params.id)
    if (!current) return reply.status(404).send({ error: { code: 'QUOTA_RESERVATION_NOT_FOUND', message: '未找到该并发预留演练', requestId: request.id } })
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    const visible = createDatabaseLimits(database, { level: 'all', search: '' }, newApi, new Date(), dataScopeFor(request.authUser)).items.some((item) => item.id === current.nodeId)
    if (!visible) return reply.status(404).send({ error: { code: 'QUOTA_RESERVATION_NOT_FOUND', message: '未找到当前范围内的并发预留演练', requestId: request.id } })
    const auditEventId = `audit-${request.body.idempotencyKey}`
    try {
      const result = database.applyQuotaReservationAction({ id: current.id, action: request.body.action, actorUserId: request.authUser?.id ?? null, idempotencyKey: request.body.idempotencyKey }, {
        id: auditEventId, actorUserId: request.authUser?.id ?? null, action: 'update', resourceType: 'quota', resourceId: current.id, result: 'success', requestId: request.id,
        summary: { code: request.body.action === 'settle' ? 'QUOTA_RESERVATION_SETTLED' : 'QUOTA_RESERVATION_CANCELLED', message: '已更新本地并发预留演练状态；审计只保存说明长度。', nodeId: current.nodeId, statusBefore: current.status, statusAfter: request.body.action === 'settle' ? 'settled' : 'cancelled', reasonLength: request.body.reason.length },
      }, new Date())
      if (!result) return reply.status(404).send({ error: { code: 'QUOTA_RESERVATION_NOT_FOUND', message: '该预留已不存在，请刷新后重试', requestId: request.id } })
      return {
        meta: { source: 'database' as const, completedAt: new Date().toISOString(), notice: request.body.action === 'settle' ? '预留已结算；本地演练记录保留，不会改变真实用量。' : '预留已取消并释放演练占用；本地演练不会阻断请求。' },
        reservation: mapQuotaReservation(result.reservation), operation: { idempotencyKey: request.body.idempotencyKey, idempotent: result.idempotent, auditEventId },
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') return reply.status(409).send({ error: { code: 'IDEMPOTENCY_KEY_REUSED', message: '该幂等操作编号已用于其他预留操作', requestId: request.id } })
      if (error instanceof Error && error.message === 'QUOTA_RESERVATION_NOT_RESERVED') return reply.status(409).send({ error: { code: 'QUOTA_RESERVATION_NOT_RESERVED', message: '该预留已经结算或取消，不能重复处理', requestId: request.id } })
      throw error
    }
  })

  app.get('/api/quota-requests', {
    schema: { querystring: quotaRequestQuerySchema, response: { 200: quotaRequestsResponseSchema } },
  }, async (request) => {
    const scope = dataScopeFor(request.authUser)
    const filter = { ...(scope.mode === 'department' ? { departmentId: scope.departmentId } : {}), ...(request.query.status !== 'all' ? { status: request.query.status } : {}) }
    return createQuotaRequestsResponse(database, filter, { mode: scope.mode === 'department' ? 'department' : 'global', departmentId: scope.mode === 'department' ? scope.departmentId : null, canDecide: request.authUser?.role !== 'finance' })
  })

  app.patch('/api/quota-requests/:id/decision', {
    schema: { params: quotaRequestParamsSchema, body: quotaDecisionBodySchema, response: { 200: quotaRequestActionResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema } },
  }, async (request, reply) => {
    const scope = dataScopeFor(request.authUser)
    const current = database.listTemporaryQuotaRequests({}, new Date()).find((item) => item.id === request.params.id)
    if (!current || !isDepartmentVisible(scope, current.departmentId)) return reply.status(404).send({ error: { code: 'QUOTA_REQUEST_NOT_FOUND', message: '未找到当前范围内的临时额度申请', requestId: request.id } })
    const auditEventId = `audit-${request.body.idempotencyKey}`
    try {
      const result = database.decideTemporaryQuotaRequest({
        id: request.params.id, decision: request.body.decision, approverUserId: request.authUser?.id ?? 'user-super-admin', reasonLength: request.body.reason.length, idempotencyKey: request.body.idempotencyKey,
      }, {
        id: auditEventId, actorUserId: request.authUser?.id ?? null, action: 'update', resourceType: 'quota', resourceId: request.params.id, result: 'success', requestId: request.id,
        summary: { code: request.body.decision === 'approve' ? 'TEMPORARY_QUOTA_APPROVED' : 'TEMPORARY_QUOTA_REJECTED', message: '已更新本地临时额度申请状态；审计只保存说明长度。', statusBefore: current.status, statusAfter: request.body.decision === 'approve' ? 'approved' : 'rejected', targetPoints: current.targetPoints, durationHours: current.durationHours, reasonLength: request.body.reason.length },
      }, new Date())
      if (!result) return reply.status(404).send({ error: { code: 'QUOTA_REQUEST_NOT_FOUND', message: '申请已不存在，请刷新后重试', requestId: request.id } })
      return {
        meta: { source: 'database' as const, generatedAt: new Date().toISOString(), completedAt: new Date().toISOString(), notice: '状态已写入本地 SQLite；批准只增加软目标展示，不启用硬额度拦截。' },
        request: { id: result.request.id, requester: { id: result.request.requesterUserId, name: result.request.requesterName, department: result.request.departmentName }, targetPoints: result.request.targetPoints, durationHours: result.request.durationHours, reasonLength: result.request.reasonLength, status: result.request.status, requestedAt: result.request.requestedAt, decidedAt: result.request.decidedAt, approver: result.request.approverUserId && result.request.approverName ? { id: result.request.approverUserId, name: result.request.approverName } : null, decisionReasonLength: result.request.decisionReasonLength, expiresAt: result.request.expiresAt, approvedPoints: result.request.approvedPoints },
        operation: { idempotencyKey: request.body.idempotencyKey, idempotent: result.idempotent, auditEventId },
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') return reply.status(409).send({ error: { code: 'IDEMPOTENCY_KEY_REUSED', message: '该审批操作编号已用于其他申请或不同状态', requestId: request.id } })
      if (error instanceof Error && error.message === 'QUOTA_REQUEST_NOT_PENDING') return reply.status(409).send({ error: { code: 'QUOTA_REQUEST_NOT_PENDING', message: '该申请已处理，不能重复审批', requestId: request.id } })
      throw error
    }
  })

  app.get('/api/routes', {
    schema: { querystring: routesQuerySchema, response: { 200: routesResponseSchema, 400: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    if (upstreamDataPrimary) return reply.status(503).send({ error: { code: 'UPSTREAM_ROUTE_UNAVAILABLE', message: '路由策略以 New API/CPA 主数据为准，当前不会读取本地演示路由', requestId: request.id } })
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    return createDatabaseRoutes(database, request.query, newApi)
  })

  app.patch('/api/routes/:id', {
    schema: { params: routeIdParamsSchema, body: routePolicyUpdateBodySchema, response: { 200: routePolicyUpdateResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    if (upstreamDataPrimary) return reply.status(503).send({ error: { code: 'UPSTREAM_ROUTE_READ_ONLY', message: '路由策略写操作必须通过 New API/CPA 主数据适配器，当前不会写入本地镜像', requestId: request.id } })
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    const allRoutes = createDatabaseRoutes(database, { search: '', category: 'all', environment: 'all', status: 'all' }, newApi, new Date())
    const visible = allRoutes.items.find((item) => item.id === request.params.id)
    if (!visible) return reply.status(404).send({ error: { code: 'ROUTE_NOT_FOUND', message: '未找到可调整的用途路由', requestId: request.id } })
    const usesFallback = request.body.onTimeout === 'fallback' || request.body.onRateLimit === 'fallback' || request.body.onServerError === 'fallback'
    if (usesFallback && visible.fallbacks.length === 0) return reply.status(400).send({ error: { code: 'ROUTE_FALLBACK_UNAVAILABLE', message: '该路由没有同组备用渠道，不能设置切换备用策略', requestId: request.id } })
    const idempotencyFingerprint = createHash('sha256').update(`${visible.id}:${request.body.onTimeout}:${request.body.onRateLimit}:${request.body.onServerError}:${request.body.maxRetries}`).digest('hex')
    const auditEventId = `audit-${request.body.idempotencyKey}`
    try {
      const result = database.updateRoutePolicyOverride({
        routeId: visible.id, onTimeout: request.body.onTimeout, onRateLimit: request.body.onRateLimit,
        onServerError: request.body.onServerError, maxRetries: request.body.maxRetries,
      }, {
        id: auditEventId, actorUserId: request.authUser?.id ?? null, action: 'update', resourceType: 'route', resourceId: visible.id,
        result: 'success', requestId: request.id,
        summary: {
          message: '已调整本地 SQLite 演示路由的降级与重试策略；未调用 New API，未修改真实路由，也未记录调整原因原文。',
          resourceName: `${visible.name} · ${visible.alias}`, reasonProvided: true, reasonLength: request.body.reason.length, idempotencyFingerprint,
          changes: [
            { field: 'onTimeout', label: '超时策略', before: visible.policy.onTimeout === 'fallback' ? '切换备用' : '直接失败', after: request.body.onTimeout === 'fallback' ? '切换备用' : '直接失败', sensitive: false },
            { field: 'onRateLimit', label: '上游 429 策略', before: visible.policy.onRateLimit === 'fallback' ? '切换备用' : '有限重试', after: request.body.onRateLimit === 'fallback' ? '切换备用' : '有限重试', sensitive: false },
            { field: 'onServerError', label: '上游 5xx 策略', before: visible.policy.onServerError === 'fallback' ? '切换备用' : '有限重试', after: request.body.onServerError === 'fallback' ? '切换备用' : '有限重试', sensitive: false },
            { field: 'maxRetries', label: '最大重试次数', before: `${visible.policy.maxRetries} 次`, after: `${request.body.maxRetries} 次`, sensitive: false },
          ],
        },
      })
      const updated = createDatabaseRoutes(database, { search: '', category: 'all', environment: 'all', status: 'all' }, newApi, new Date()).items.find((item) => item.id === visible.id)
      if (!updated) return reply.status(404).send({ error: { code: 'ROUTE_NOT_FOUND', message: '路由状态已变化，请刷新后重试', requestId: request.id } })
      return {
        meta: { source: 'database' as const, completedAt: new Date().toISOString(), notice: '已保存本地 SQLite 演示策略；正式与实验隔离、禁止跨组回退和禁止客户端选渠道仍由服务端固定执行。' },
        route: updated,
        operation: { idempotencyKey: request.body.idempotencyKey, idempotent: result.idempotent, auditEventId },
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') return reply.status(409).send({ error: { code: 'IDEMPOTENCY_KEY_REUSED', message: '该幂等操作编号已用于其他路由或不同策略', requestId: request.id } })
      throw error
    }
  })

  app.get('/api/models', {
    schema: { querystring: modelsQuerySchema, response: { 200: modelsResponseSchema, 400: errorResponseSchema, 502: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    if (request.query.source === 'cpa') {
      try {
        const response = await cpaCatalog.models(request.query)
        try { return await enrichCpaModels(response) } catch { return response }
      } catch (error) {
        if (!(error instanceof CpaCatalogError)) throw error
        const status = error.code === 'CPA_AUTH_REQUIRED' || error.code === 'CPA_NOT_CONFIGURED' || error.code === 'CPA_NOT_ACTIVE' ? 503 : 502
        return reply.status(status).send({ error: { code: error.code, message: error.message, requestId: request.id } })
      }
    }
    if (request.query.source === 'new_api' || (request.query.source === 'demo' && upstreamDataPrimary)) {
      try { return await catalog.models(request.query) } catch (error) {
        if (!(error instanceof CatalogError)) throw error
        return reply.status(error.code === 'NEW_API_AUTH_REQUIRED' ? 503 : 502).send({ error: { code: error.code, message: error.message, requestId: request.id } })
      }
    }
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    return createDemoModels(request.query, newApi)
  })

  app.post('/api/models/test', {
    schema: { body: modelTestBodySchema, response: { 200: modelTestResponseSchema, 400: errorResponseSchema, 502: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    if (!newApiManagementClient.authConfigured) {
      return reply.status(503).send({ error: { code: 'NEW_API_AUTH_REQUIRED', message: 'New API 管理凭据尚未配置，无法测试渠道', requestId: request.id } })
    }
    const channelsResult = await newApiManagementClient.listChannels()
    if (channelsResult.state !== 'ready' || !channelsResult.data) {
      const status = channelsResult.state === 'auth_required' ? 503 : 502
      return reply.status(status).send({ error: { code: channelsResult.state === 'auth_required' ? 'NEW_API_AUTH_REQUIRED' : 'NEW_API_CHANNELS_UNAVAILABLE', message: channelsResult.message ?? '无法读取 New API 渠道', requestId: request.id } })
    }
    const requestedId = request.body.channelId ? newApiChannelId(request.body.channelId) ?? request.body.channelId : null
    const channel = (requestedId ? channelsResult.data.items.find((item) => item.id === requestedId || item.id === request.body.channelId) : undefined)
      ?? channelsResult.data.items.find((item) => item.enabled !== false && item.models.includes(request.body.model))
      ?? channelsResult.data.items.find((item) => item.enabled !== false)
    if (!channel) return reply.status(503).send({ error: { code: 'NEW_API_CHANNEL_NOT_FOUND', message: '没有找到可测试的 New API 渠道', requestId: request.id } })

    const testResult = await newApiManagementClient.testChannel(channel.id, request.body.model)
    if (testResult.state !== 'ready' || !testResult.data) {
      const status = testResult.state === 'auth_required' ? 503 : 502
      return reply.status(status).send({ error: { code: testResult.state === 'auth_required' ? 'NEW_API_AUTH_REQUIRED' : 'NEW_API_CHANNEL_TEST_UNAVAILABLE', message: testResult.message ?? 'New API 渠道测试暂不可用', requestId: request.id } })
    }
    invalidateLiveModelContext()
    const testedAt = new Date().toISOString()
    return {
      meta: { source: 'new_api' as const, completedAt: testedAt, notice: '测试直接调用 New API 渠道“高级自定义”中的测试渠道链接。' },
      result: {
        model: request.body.model,
        channelId: channel.id,
        channelName: channel.name || `New API channel ${channel.id}`,
        status: testResult.data.success ? 'passed' as const : 'failed' as const,
        latencyMs: testResult.data.latencyMs,
        testedAt,
        message: testResult.data.message,
        testPath: channelTestPath(channel),
      },
      requestId: request.id,
    }
  })

  app.get('/api/channels', {
    schema: { querystring: channelsQuerySchema, response: { 200: channelsResponseSchema, 400: errorResponseSchema, 502: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    if (request.query.source === 'cpa') {
      try { return await cpaCatalog.channels(request.query) } catch (error) {
        if (!(error instanceof CpaCatalogError)) throw error
        const status = error.code === 'CPA_AUTH_REQUIRED' || error.code === 'CPA_NOT_CONFIGURED' || error.code === 'CPA_NOT_ACTIVE' ? 503 : 502
        return reply.status(status).send({ error: { code: error.code, message: error.message, requestId: request.id } })
      }
    }
    if (request.query.source === 'new_api' || (request.query.source === 'demo' && upstreamDataPrimary)) {
      try { return await catalog.channels(request.query) } catch (error) {
        if (!(error instanceof CatalogError)) throw error
        return reply.status(error.code === 'NEW_API_AUTH_REQUIRED' ? 503 : 502).send({ error: { code: error.code, message: error.message, requestId: request.id } })
      }
    }
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    return createDatabaseDemoChannels(database, request.query, newApi)
  })

  app.post('/api/channels/:id/check', {
    schema: { params: channelIdParamsSchema, body: channelCheckBodySchema, response: { 200: channelCheckResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    if (upstreamDataPrimary) return reply.status(503).send({ error: { code: 'UPSTREAM_CHANNEL_CHECK_UNAVAILABLE', message: '生产渠道健康状态必须来自 New API/CPA 实时适配器，当前不会写入本地模拟检查', requestId: request.id } })
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    const now = new Date()
    const visible = createDatabaseDemoChannels(database, { source: 'demo', environment: 'all', status: 'all' }, newApi, now).items.find((item) => item.id === request.params.id)
    if (!visible) return reply.status(404).send({ error: { code: 'CHANNEL_NOT_FOUND', message: '未找到可复检的模拟渠道', requestId: request.id } })
    if (visible.status === 'unverified' || visible.status === 'offline' || visible.latencyMs === null || visible.successRate === null) return reply.status(400).send({ error: { code: 'CHANNEL_CHECK_UNAVAILABLE', message: '该模拟渠道缺少可复检的健康快照', requestId: request.id } })
    const idempotencyFingerprint = createHash('sha256').update(visible.id).digest('hex')
    const auditEventId = `audit-${request.body.idempotencyKey}`
    try {
      const result = database.recordSyntheticChannelCheck({ channelId: visible.id, status: visible.status, latencyMs: visible.latencyMs, successRate: visible.successRate }, {
        id: auditEventId, actorUserId: request.authUser?.id ?? null, action: 'update', resourceType: 'channel', resourceId: visible.id,
        result: 'success', requestId: request.id,
        summary: {
          code: 'SYNTHETIC_CHECK_COMPLETED', message: '已完成本地 SQLite 模拟渠道复检；未发起真实网络探测，未调用 New API，也未记录复检原因原文。',
          resourceName: visible.name, reasonProvided: true, reasonLength: request.body.reason.length, idempotencyFingerprint,
          changes: [
            { field: 'status', label: '模拟健康状态', before: visible.status, after: visible.status, sensitive: false },
            { field: 'checkedAt', label: '本地复检时间', before: visible.checkedAt ? '已有模拟快照' : '未检测', after: '已更新 SQLite 快照', sensitive: false },
          ],
        },
      }, now)
      const channel = createDatabaseDemoChannels(database, { source: 'demo', environment: 'all', status: 'all' }, newApi, new Date()).items.find((item) => item.id === visible.id)
      if (!channel) return reply.status(404).send({ error: { code: 'CHANNEL_NOT_FOUND', message: '渠道状态已变化，请刷新后重试', requestId: request.id } })
      return {
        meta: { source: 'database' as const, completedAt: new Date().toISOString(), notice: '已更新本地 SQLite 模拟健康快照；未探测真实渠道，未调用 New API，也未变更任何配置。' },
        channel,
        operation: { idempotencyKey: request.body.idempotencyKey, idempotent: result.idempotent, auditEventId },
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') return reply.status(409).send({ error: { code: 'IDEMPOTENCY_KEY_REUSED', message: '该幂等操作编号已用于其他渠道复检', requestId: request.id } })
      throw error
    }
  })

  // CPA is the account-pool integration owned by this page. Keep account
  // connection and account-import operations scoped to CPA.
  app.post('/api/upstreams/cpa/configure', {
    schema: { body: cpaCredentialInputSchema, response: { 200: cpaCredentialResponseSchema, 400: errorResponseSchema, 502: errorResponseSchema, 504: errorResponseSchema } },
  }, async (request, reply) => {
    const input = request.body
    let cpaBaseUrl: string
    let managementBaseUrl: string
    try {
      cpaBaseUrl = normalizeGatewayUrl(input.baseUrl)
      managementBaseUrl = normalizeCpaManagementBaseUrl(input.managementBaseUrl ?? process.env.CPA_MANAGEMENT_URL ?? cpaBaseUrl)
    } catch {
      return reply.status(400).send({ error: { code: 'CPA_URL_INVALID', message: 'CPA 接口地址和管理地址必须是有效的 HTTP 或 HTTPS 地址', requestId: request.id } })
    }
    const cpaCandidate: GatewayConfig = { ...gatewayConfig, mode: 'cpa', provider: 'openai_compatible', baseUrl: cpaBaseUrl, upstreamApiKey: input.apiKey.trim(), upstreamConfigured: true }
    let models: Awaited<ReturnType<GatewayUpstream['listModels']>>
    const startedAt = Date.now()
    try {
      models = await createGatewayConnector(cpaCandidate).listModels()
    } catch (error) {
      const gatewayError = error instanceof GatewayUpstreamError ? error : new GatewayUpstreamError('GATEWAY_UPSTREAM_UNAVAILABLE', 502, '上游暂时不可达')
      if (gatewayError.code === 'GATEWAY_UPSTREAM_AUTH_FAILED') return reply.status(400).send({ error: { code: 'CPA_CREDENTIAL_INVALID', message: 'CPA 客户端 Key 验证失败，请检查 CPA 地址和客户端 Key', requestId: request.id } })
      if (gatewayError.code === 'GATEWAY_UPSTREAM_TIMEOUT') return reply.status(504).send({ error: { code: 'CPA_TIMEOUT', message: 'CPA 响应超时，未保存本次配置', requestId: request.id } })
      return reply.status(502).send({ error: { code: 'CPA_UNAVAILABLE', message: 'CPA 暂时不可达，未保存本次配置', requestId: request.id } })
    }
    try {
      gatewayRuntime.persistCpa({ baseUrl: cpaBaseUrl, apiKey: input.apiKey.trim(), managementBaseUrl, ...(input.managementKey?.trim() ? { managementKey: input.managementKey.trim() } : {}) })
      gatewayRuntime.applyCpaInput({ baseUrl: cpaBaseUrl, apiKey: input.apiKey.trim(), managementBaseUrl, ...(input.managementKey?.trim() ? { managementKey: input.managementKey.trim() } : {}) })
      cpaCatalogConfig.baseUrl = cpaBaseUrl
      cpaCatalogConfig.upstreamApiKey = input.apiKey.trim()
      cpaCatalogConfig.upstreamConfigured = true
    } catch {
      return reply.status(400).send({ error: { code: 'CPA_CONFIG_SAVE_FAILED', message: 'CPA 验证成功，但服务端保存失败', requestId: request.id } })
    }
    const completedAt = new Date().toISOString()
    database.appendAuditEvent({
      id: `audit-cpa-configure-${crypto.randomUUID()}`,
      actorUserId: request.authUser?.id ?? null,
      action: 'update', resourceType: 'upstream', resourceId: 'upstream-cpa-gateway', result: 'success', requestId: request.id,
      summary: { code: 'CPA_CREDENTIAL_CONFIGURED', message: '已验证并保存 CPA 账号池凭据；审计不记录地址、Key、管理 Key 或 OAuth 内容。', resourceName: 'CPA OAuth 账号池', changes: [{ field: 'credential', label: 'CPA 凭据', before: '未确认', after: '已验证并保存', sensitive: true }] },
    }, new Date())
    return {
      meta: { source: 'runtime' as const, completedAt, notice: '已验证并保存 CPA 账号池；OAuth 登录和认证文件上传都将通过 CPA 管理接口完成。' },
      cpa: { status: models.length > 0 ? 'healthy' as const : 'empty' as const, modelCount: models.length, latencyMs: Date.now() - startedAt },
      managementConfigured: Boolean(input.managementKey?.trim() || process.env.CPA_MANAGEMENT_KEY?.trim()),
      requestId: request.id,
    }
  })

  app.post('/api/upstreams/cpa/oauth-url', {
    schema: { body: cpaManagementInputSchema, response: { 200: cpaOAuthStartResponseSchema, 400: errorResponseSchema, 502: errorResponseSchema } },
  }, async (request, reply) => {
    try {
      const result = await startCpaCodexOAuth({ baseUrl: request.body.managementBaseUrl, managementKey: request.body.managementKey })
      return { status: 'ok' as const, url: result.url, state: result.state, requestId: request.id }
    } catch (error) {
      if (error instanceof CpaManagementError) return reply.status(error.statusCode === 400 ? 400 : 502).send({ error: { code: error.code, message: error.message, requestId: request.id } })
      return reply.status(502).send({ error: { code: 'CPA_MANAGEMENT_UNAVAILABLE', message: 'CPA 管理接口暂时不可达', requestId: request.id } })
    }
  })

  app.post('/api/upstreams/cpa/oauth-status', {
    schema: { body: cpaOAuthStatusInputSchema, response: { 200: cpaOAuthStatusResponseSchema, 400: errorResponseSchema, 502: errorResponseSchema } },
  }, async (request, reply) => {
    try {
      const result = await getCpaOAuthStatus({ baseUrl: request.body.managementBaseUrl, managementKey: request.body.managementKey }, request.body.state)
      const verification = result.status === 'ok'
        ? await verifyCpaAuthFile({ baseUrl: request.body.managementBaseUrl, managementKey: request.body.managementKey })
        : undefined
      return { status: result.status, ...(verification ? { verification } : {}), requestId: request.id }
    } catch (error) {
      if (error instanceof CpaManagementError) return reply.status(error.statusCode === 400 ? 400 : 502).send({ error: { code: error.code, message: error.message, requestId: request.id } })
      return reply.status(502).send({ error: { code: 'CPA_MANAGEMENT_UNAVAILABLE', message: 'CPA 管理接口暂时不可达', requestId: request.id } })
    }
  })

  app.get('/api/upstreams/cpa/auth-files', {
    schema: { response: { 200: cpaAuthFilesResponseSchema, 400: errorResponseSchema, 502: errorResponseSchema } },
  }, async (request, reply) => {
    try {
      const files = await listCpaAuthFiles()
      return { files: files.map(publicCpaAuthFile), requestId: request.id }
    } catch (error) {
      if (error instanceof CpaManagementError) return reply.status(error.statusCode === 400 ? 400 : 502).send({ error: { code: error.code, message: error.message, requestId: request.id } })
      return reply.status(502).send({ error: { code: 'CPA_MANAGEMENT_UNAVAILABLE', message: 'CPA 认证文件列表暂时无法读取', requestId: request.id } })
    }
  })

  app.get('/api/upstreams/cpa/auth-files/models', {
    schema: { querystring: cpaAuthFileNameQuerySchema, response: { 200: cpaAuthFileModelsResponseSchema, 400: errorResponseSchema, 502: errorResponseSchema } },
  }, async (request, reply) => {
    try {
      const models = await getCpaAuthFileModels({}, request.query.name)
      return { models, requestId: request.id }
    } catch (error) {
      if (error instanceof CpaManagementError) return reply.status(error.statusCode === 400 ? 400 : 502).send({ error: { code: error.code, message: error.message, requestId: request.id } })
      return reply.status(502).send({ error: { code: 'CPA_MANAGEMENT_UNAVAILABLE', message: 'CPA 模型列表暂时无法读取', requestId: request.id } })
    }
  })

  app.get('/api/upstreams/cpa/auth-files/settings', {
    schema: { querystring: cpaAuthFileNameQuerySchema, response: { 200: cpaAuthFileSettingsResponseSchema, 400: errorResponseSchema, 502: errorResponseSchema } },
  }, async (request, reply) => {
    try {
      const settings = await getCpaAuthFileSettings({}, request.query.name)
      return { settings, requestId: request.id }
    } catch (error) {
      if (error instanceof CpaManagementError) return reply.status(error.statusCode === 400 ? 400 : 502).send({ error: { code: error.code, message: error.message, requestId: request.id } })
      return reply.status(502).send({ error: { code: 'CPA_MANAGEMENT_UNAVAILABLE', message: 'CPA 认证文件设置暂时无法读取', requestId: request.id } })
    }
  })

  app.get('/api/upstreams/cpa/auth-files/detail', {
    schema: { querystring: cpaAuthFileNameQuerySchema, response: { 200: cpaAuthFileDetailResponseSchema, 400: errorResponseSchema, 502: errorResponseSchema } },
  }, async (request, reply) => {
    try {
      const detail = await getCpaAuthFileDetail({}, request.query.name)
      return { detail, requestId: request.id }
    } catch (error) {
      if (error instanceof CpaManagementError) return reply.status(error.statusCode === 400 ? 400 : 502).send({ error: { code: error.code, message: error.message, requestId: request.id } })
      return reply.status(502).send({ error: { code: 'CPA_MANAGEMENT_UNAVAILABLE', message: 'CPA 认证文件详情暂时无法读取', requestId: request.id } })
    }
  })

  app.get('/api/upstreams/cpa/auth-files/download', {
    schema: { querystring: cpaAuthFileNameQuerySchema },
  }, async (request, reply) => {
    try {
      const result = await downloadCpaAuthFile({}, request.query.name)
      return reply
        .header('content-type', result.contentType)
        .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(request.query.name)}`)
        .send(result.bytes)
    } catch (error) {
      if (error instanceof CpaManagementError) return reply.status(error.statusCode === 400 ? 400 : 502).send({ error: { code: error.code, message: error.message, requestId: request.id } })
      return reply.status(502).send({ error: { code: 'CPA_MANAGEMENT_UNAVAILABLE', message: 'CPA 认证文件暂时无法下载', requestId: request.id } })
    }
  })

  app.patch('/api/upstreams/cpa/auth-files/status', {
    schema: { body: cpaAuthFileStatusInputSchema, response: { 200: cpaAuthFileActionResponseSchema, 400: errorResponseSchema, 502: errorResponseSchema } },
  }, async (request, reply) => {
    try {
      await setCpaAuthFileStatus({}, request.body.name, request.body.disabled)
      return { status: 'ok' as const, requestId: request.id }
    } catch (error) {
      if (error instanceof CpaManagementError) return reply.status(error.statusCode === 400 ? 400 : 502).send({ error: { code: error.code, message: error.message, requestId: request.id } })
      return reply.status(502).send({ error: { code: 'CPA_MANAGEMENT_UNAVAILABLE', message: 'CPA 账号启用状态暂时无法更新', requestId: request.id } })
    }
  })

  app.post('/api/upstreams/cpa/auth-files/refresh', {
    schema: { body: cpaAuthFileNameInputSchema, response: { 200: cpaAuthFileActionResponseSchema, 400: errorResponseSchema, 502: errorResponseSchema } },
  }, async (request, reply) => {
    try {
      const file = (await listCpaAuthFiles()).find((item) => item.name === request.body.name || item.id === request.body.name)
      await requestCpaAuthFileRefresh({}, file?.name ?? request.body.name, file?.auth_index)
      return { status: 'ok' as const, requestId: request.id }
    } catch (error) {
      if (error instanceof CpaManagementError) return reply.status(error.statusCode === 400 ? 400 : 502).send({ error: { code: error.code, message: error.message, requestId: request.id } })
      return reply.status(502).send({ error: { code: 'CPA_MANAGEMENT_UNAVAILABLE', message: 'CPA OAuth 凭证刷新暂时无法执行', requestId: request.id } })
    }
  })

  app.patch('/api/upstreams/cpa/auth-files/settings', {
    schema: { body: cpaAuthFileSettingsInputSchema, response: { 200: cpaAuthFileActionResponseSchema, 400: errorResponseSchema, 502: errorResponseSchema } },
  }, async (request, reply) => {
    try {
      const { name, ...settings } = request.body
      await patchCpaAuthFileSettings({}, name, settings)
      return { status: 'ok' as const, requestId: request.id }
    } catch (error) {
      if (error instanceof CpaManagementError) return reply.status(error.statusCode === 400 ? 400 : 502).send({ error: { code: error.code, message: error.message, requestId: request.id } })
      return reply.status(502).send({ error: { code: 'CPA_MANAGEMENT_UNAVAILABLE', message: 'CPA 认证文件设置暂时无法保存', requestId: request.id } })
    }
  })

  app.post('/api/upstreams/cpa/auth-files/quota', {
    schema: { body: cpaAuthFileNameInputSchema, response: { 200: cpaAuthFileQuotaResponseSchema, 400: errorResponseSchema, 502: errorResponseSchema } },
  }, async (request, reply) => {
    try {
      const quota = await getCpaCodexQuota({}, request.body.name)
      return { quota, requestId: request.id }
    } catch (error) {
      if (error instanceof CpaManagementError) return reply.status(error.statusCode === 400 ? 400 : 502).send({ error: { code: error.code, message: error.message, requestId: request.id } })
      return reply.status(502).send({ error: { code: 'CPA_MANAGEMENT_UNAVAILABLE', message: 'CPA 额度暂时无法读取', requestId: request.id } })
    }
  })

  app.delete('/api/upstreams/cpa/auth-files', {
    schema: { body: cpaAuthFileNameInputSchema, response: { 200: cpaAuthFileActionResponseSchema, 400: errorResponseSchema, 502: errorResponseSchema } },
  }, async (request, reply) => {
    try {
      await deleteCpaAuthFile({}, request.body.name)
      return { status: 'ok' as const, requestId: request.id }
    } catch (error) {
      if (error instanceof CpaManagementError) return reply.status(error.statusCode === 400 ? 400 : 502).send({ error: { code: error.code, message: error.message, requestId: request.id } })
      return reply.status(502).send({ error: { code: 'CPA_MANAGEMENT_UNAVAILABLE', message: 'CPA 认证文件暂时无法删除', requestId: request.id } })
    }
  })

  app.post('/api/upstreams/cpa/auth-files', {
    bodyLimit: 4_000_000,
    schema: { body: cpaAuthFileUploadSchema, response: { 200: cpaAuthFileUploadResponseSchema, 400: errorResponseSchema, 502: errorResponseSchema } },
  }, async (request, reply) => {
    let decoded: ReturnType<typeof decodeCpaAuthFile>
    try { decoded = decodeCpaAuthFile(request.body) }
    catch (error) {
      if (error instanceof CpaManagementError && error.code === 'CPA_AUTH_FILE_UNSUPPORTED_FORMAT') return reply.status(400).send({ error: { code: error.code, message: error.message, requestId: request.id } })
      if (error instanceof CpaManagementError) return reply.status(400).send({ error: { code: 'CPA_AUTH_FILE_INVALID', message: '认证文件必须是有效的 JSON 文件（不超过 2 MB）', requestId: request.id } })
      return reply.status(400).send({ error: { code: 'CPA_AUTH_FILE_INVALID', message: '认证文件格式无效', requestId: request.id } })
    }
    try {
      await uploadCpaAuthFile({ baseUrl: request.body.managementBaseUrl, managementKey: request.body.managementKey }, decoded.fileName, decoded.bytes)
      const verification = await verifyCpaAuthFile(
        { baseUrl: request.body.managementBaseUrl, managementKey: request.body.managementKey },
        { fileName: decoded.fileName, ...(decoded.accountId ? { accountId: decoded.accountId } : {}) },
      )
      database.appendAuditEvent({
        id: `audit-cpa-auth-file-${crypto.randomUUID()}`,
        actorUserId: request.authUser?.id ?? null,
        action: 'create', resourceType: 'upstream', resourceId: 'upstream-cpa-gateway', result: 'success', requestId: request.id,
        summary: { code: 'CPA_AUTH_FILE_IMPORTED', message: '已通过 CPA 管理接口导入认证文件并执行真实认证检查；审计不记录文件名、内容或 Token。', resourceName: 'CPA OAuth 账号池', changes: [{ field: 'authFile', label: 'CPA 认证文件', before: '未导入', after: verification.status === 'verified' ? '已导入并验证' : '已交由 CPA 保存，验证结果见页面', sensitive: true }] },
      }, new Date())
      return { status: 'ok' as const, fileName: decoded.fileName, format: decoded.format, converted: decoded.format === 'codex_cli', verification, requestId: request.id }
    } catch (error) {
      if (error instanceof CpaManagementError) return reply.status(error.statusCode === 400 ? 400 : 502).send({ error: { code: error.code, message: error.message, requestId: request.id } })
      return reply.status(502).send({ error: { code: 'CPA_MANAGEMENT_UNAVAILABLE', message: 'CPA 未接受认证文件，未保存到 AI OPS', requestId: request.id } })
    } finally {
      decoded.bytes.fill(0)
    }
  })

  app.post('/api/upstreams/cpa/verify', {
    schema: { body: cpaVerifyInputSchema, response: { 200: cpaVerifyResponseSchema, 400: errorResponseSchema, 502: errorResponseSchema } },
  }, async (request, reply) => {
    try {
      const verification = await verifyCpaAuthFile(
        { baseUrl: request.body.managementBaseUrl, managementKey: request.body.managementKey },
        request.body.fileName ? { fileName: request.body.fileName } : {},
      )
      return { status: 'ok' as const, verification, requestId: request.id }
    } catch (error) {
      if (error instanceof CpaManagementError) return reply.status(error.statusCode === 400 ? 400 : 502).send({ error: { code: error.code, message: error.message, requestId: request.id } })
      return reply.status(502).send({ error: { code: 'CPA_MANAGEMENT_UNAVAILABLE', message: 'CPA 认证验证暂时无法执行', requestId: request.id } })
    }
  })

  app.post('/api/upstreams/:id/check', {
    schema: { params: upstreamIdParamsSchema, body: upstreamCheckBodySchema, response: { 200: upstreamCheckResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema } },
  }, async (request, reply) => {
    const now = new Date()
    const snapshot = createUpstreamSnapshot(
      { search: '', type: 'all', status: 'all' },
      { state: 'offline', checkedAt: now.toISOString() },
      now,
      database.listSyntheticUpstreamChecks(),
    )
    const visible = snapshot.items.find((item) => item.id === request.params.id)
    if (!visible) return reply.status(404).send({ error: { code: 'UPSTREAM_NOT_FOUND', message: '未找到可验证的真实上游账号', requestId: request.id } })
    if (!visible.credentialConfigured) return reply.status(400).send({ error: { code: 'UPSTREAM_CHECK_UNAVAILABLE', message: '该上游账号尚未配置凭据，无法执行验证', requestId: request.id } })

    const idempotencyFingerprint = createHash('sha256').update(visible.id).digest('hex')
    const auditEventId = `audit-${request.body.idempotencyKey}`
    const previous = database.listAuditEvents().find((event) => event.id === auditEventId)
    if (previous) {
      if (previous.resourceId !== visible.id || previous.summary.idempotencyFingerprint !== idempotencyFingerprint) {
        return reply.status(409).send({ error: { code: 'IDEMPOTENCY_KEY_REUSED', message: '该幂等操作编号已用于其他上游账号验证', requestId: request.id } })
      }
      const upstream = createUpstreamSnapshot(
        { search: '', type: 'all', status: 'all' },
        { state: 'offline', checkedAt: now.toISOString() },
        now,
        new Map([[visible.id, previous.occurredAt]]),
      ).items.find((item) => item.id === visible.id)
      if (!upstream) return reply.status(404).send({ error: { code: 'UPSTREAM_NOT_FOUND', message: '上游账号状态已变化，请刷新后重试', requestId: request.id } })
      return {
        meta: { source: 'database' as const, completedAt: previous.occurredAt, notice: '已读取本地 SQLite 模拟验证记录；未访问真实上游、未读取或修改任何凭据。' },
        upstream,
        operation: { idempotencyKey: request.body.idempotencyKey, idempotent: true, auditEventId },
      }
    }

    database.appendAuditEvent({
      id: auditEventId,
      actorUserId: request.authUser?.id ?? null,
      action: 'verify',
      resourceType: 'upstream',
      resourceId: visible.id,
      result: 'success',
      requestId: request.id,
      summary: {
        code: 'SYNTHETIC_UPSTREAM_CHECK_COMPLETED',
        message: '已完成本地 SQLite 模拟上游验证；未访问真实上游、未读取或修改任何凭据，也未记录验证原因原文。',
        resourceName: visible.name,
        reasonProvided: true,
        reasonLength: request.body.reason.length,
        idempotencyFingerprint,
        changes: [
          { field: 'checkedAt', label: '模拟验证时间', before: visible.health.checkedAt, after: '已更新 SQLite 验证记录', sensitive: false },
          { field: 'credentialValidation', label: '凭据验证结果', before: visible.credentialValidation, after: visible.credentialValidation, sensitive: false },
        ],
      },
    }, now)
    const upstream = createUpstreamSnapshot(
      { search: '', type: 'all', status: 'all' },
      { state: 'offline', checkedAt: now.toISOString() },
      now,
      new Map([[visible.id, now.toISOString()]]),
    ).items.find((item) => item.id === visible.id)
    if (!upstream) return reply.status(404).send({ error: { code: 'UPSTREAM_NOT_FOUND', message: '上游账号状态已变化，请刷新后重试', requestId: request.id } })
    return {
      meta: { source: 'database' as const, completedAt: now.toISOString(), notice: '已更新本地 SQLite 模拟验证记录；未访问真实上游、未读取或修改任何凭据。' },
      upstream,
      operation: { idempotencyKey: request.body.idempotencyKey, idempotent: false, auditEventId },
    }
  })

  app.get('/api/upstreams/:id/history', {
    schema: { params: upstreamIdParamsSchema, response: { 200: upstreamHistoryResponseSchema, 404: errorResponseSchema } },
  }, async (request, reply) => {
    const now = new Date()
    const snapshot = createUpstreamSnapshot(
      { search: '', type: 'all', status: 'all' },
      { state: 'offline', checkedAt: now.toISOString() },
      now,
      database.listSyntheticUpstreamChecks(),
    )
    const visible = snapshot.items.find((item) => item.id === request.params.id)
    if (!visible) return reply.status(404).send({ error: { code: 'UPSTREAM_NOT_FOUND', message: '未找到指定上游账号', requestId: request.id } })
    return createDatabaseUpstreamHistory(database, visible.id, visible.name, now)
  })

  app.get('/api/upstreams', {
    schema: { querystring: upstreamsQuerySchema, response: { 200: upstreamsResponseSchema, 400: errorResponseSchema } },
  }, async (request) => {
    const cpa = await (options.probeCpa ?? (() => probeCpaFromEnvironment()))()
    return createUpstreamSnapshot(request.query, cpa, new Date(), database.listSyntheticUpstreamChecks())
  })

  app.get('/api/usage', {
    schema: { querystring: usageQuerySchema, response: { 200: usageResponseSchema, 400: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    if (newApiDatabase) return createNewApiUsage(newApiDatabase, request.query, new Date(), dataScopeFor(request.authUser))
    if (upstreamDataPrimary) return reply.status(503).send({ error: { code: 'NEW_API_USAGE_UNAVAILABLE', message: 'New API SQLite 日志源尚未挂载，暂不读取本地用量镜像', requestId: request.id } })
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    return createDatabaseUsage(database, request.query, newApi, new Date(), dataScopeFor(request.authUser))
  })

  app.get('/api/usage/model-analytics', {
    schema: { querystring: modelAnalyticsQuerySchema, response: { 200: modelAnalyticsResponseSchema, 400: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    if (!newApiDatabase) return reply.status(503).send({ error: { code: 'NEW_API_USAGE_UNAVAILABLE', message: 'New API SQLite 日志源尚未挂载，模型调用分析不会读取本地用量镜像', requestId: request.id } })
    return createNewApiModelAnalytics(newApiDatabase, request.query, new Date())
  })

  app.get('/api/usage/:requestId', {
    schema: { params: usageRequestParamsSchema, response: { 200: usageDetailResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    if (newApiDatabase) {
      const result = createNewApiUsageDetail(newApiDatabase, database, request.params.requestId, new Date(), authMode === 'disabled' || request.authUser?.role === 'super_admin')
      if (result) return result
      return reply.status(404).send({ error: { code: 'USAGE_NOT_FOUND', message: '未找到指定调用记录', requestId: request.id } })
    }
    if (upstreamDataPrimary) return reply.status(503).send({ error: { code: 'NEW_API_USAGE_UNAVAILABLE', message: 'New API SQLite 日志源尚未挂载，暂不读取本地用量镜像', requestId: request.id } })
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    const result = createDatabaseUsageDetail(database, request.params.requestId, newApi, new Date(), dataScopeFor(request.authUser), authMode === 'disabled' || request.authUser?.role === 'super_admin')
    if (result) return result
    return reply.status(404).send({ error: { code: 'USAGE_NOT_FOUND', message: '未找到指定调用记录', requestId: request.id } })
  })

  app.get('/api/audit-events', {
    schema: { querystring: auditQuerySchema, response: { 200: auditResponseSchema, 400: errorResponseSchema } },
  }, async (request) => createDatabaseAudit(database, request.query, new Date(), { newApi: newApiDatabase, cpa: cpaLogReader }))

  app.post('/api/audit-events/export', {
    schema: { body: auditExportQuerySchema, response: { 200: z.string(), 400: errorResponseSchema } },
  }, async (request, reply) => {
    const now = new Date()
    const result = createDatabaseAudit(database, { ...request.body, page: 1, pageSize: 500 }, now, { newApi: newApiDatabase, cpa: cpaLogReader })
    const csv = createAuditCsv(result.items)
    database.appendAuditEvent({
      id: `audit-export-${crypto.randomUUID()}`,
      actorUserId: request.authUser?.id ?? null,
      action: 'export',
      resourceType: 'export',
      resourceId: 'local-audit-csv',
      result: 'success',
      requestId: request.id,
      summary: {
        code: 'AUDIT_CSV_EXPORTED',
        message: '已导出当前筛选范围内的本地脱敏审计摘要；不包含正文、完整 Key、原因原文或凭据。',
        resourceName: '本地脱敏审计 CSV',
        exportedRows: result.items.length,
        maxRows: 500,
        format: 'csv',
      },
    }, now)
    const date = now.toISOString().slice(0, 10).replaceAll('-', '')
    const fileStem = request.body.eventId ? `audit-event-${request.body.eventId.replace(/^audit-/u, '')}` : 'audit-export'
    return reply.type('text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${fileStem}-${date}.csv"`).send(csv)
  })

  app.get('/api/audit-events/:id', {
    schema: { params: auditParamsSchema, response: { 200: auditDetailResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema } },
  }, async (request, reply) => {
    const result = createDatabaseAuditDetail(database, request.params.id, new Date(), { newApi: newApiDatabase, cpa: cpaLogReader })
    if (result) return result
    return reply.status(404).send({ error: { code: 'AUDIT_EVENT_NOT_FOUND', message: '未找到指定审计事件', requestId: request.id } })
  })

  app.get('/api/conversation-audits', {
    schema: { querystring: conversationAuditQuerySchema, response: { 200: conversationAuditResponseSchema, 400: errorResponseSchema } },
  }, async (request) => createDatabaseConversationAudits(database, request.query, new Date(), request.authUser?.role ?? 'super_admin'))

  app.get('/api/conversation-audits/:id/access-events', {
    schema: { params: conversationAuditParamsSchema, response: { 200: conversationAccessHistoryResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema } },
  }, async (request, reply) => {
    const result = createDatabaseConversationAccessHistory(database, request.params.id)
    if (result) return result
    return reply.status(404).send({ error: { code: 'CONVERSATION_AUDIT_NOT_FOUND', message: '未找到指定对话审计记录', requestId: request.id } })
  })

  app.post('/api/conversation-audits/:id/access', {
    schema: { params: conversationAuditParamsSchema, body: conversationAccessBodySchema, response: { 200: conversationAccessResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema } },
  }, async (request, reply) => {
    const now = new Date()
    const record = getDatabaseConversationAuditRecord(database, request.params.id)
    if (!record || !record.contentAccess.available) return reply.status(404).send({ error: { code: 'CONVERSATION_CONTENT_UNAVAILABLE', message: '该记录没有可访问的对话内容', requestId: request.id } })
    const accessReason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : ''
    const acknowledgedSensitiveScope = request.body?.acknowledgeSensitiveScope === true
    const actorUserId = request.authUser?.id ?? 'user-super-admin'
    const auditEventId = `audit-conversation-${crypto.randomUUID()}`
    const realContent = Boolean(record.promptAvailable || record.responseAvailable || record.externalTokenId || record.endpoint)
    let accessRecord: { id: string; persisted: boolean; auditEventId: string }
    if (realContent) {
      const id = `access-${crypto.randomUUID()}`
      database.recordConversationAuditOperation({
        id,
        actorUserId,
        recordId: record.id,
        requestId: record.requestId,
        keyId: record.key.id,
        action: 'view',
        fieldType: 'both',
        result: 'success',
        reasonLength: accessReason.length,
        scope: 'prompt,response',
      }, now, {
        id: auditEventId,
        actorUserId,
        action: 'view',
        resourceType: 'conversation',
        resourceId: record.id,
        result: 'success',
        requestId: request.id,
        summary: {
          code: 'CONVERSATION_CONTENT_VIEWED',
          message: '超级管理员查看了真实请求/回复正文；访问动作已记录。',
          resourceName: '真实对话正文',
          keyId: record.key.id,
          keyMasked: record.key.masked,
          externalTokenId: record.externalTokenId,
          ownerName: record.person.name,
          requestId: record.requestId,
          fieldType: 'both',
          reasonLength: accessReason.length,
        },
      })
      accessRecord = { id, persisted: true, auditEventId }
    } else {
      const accessEvent = database.recordConversationAccess({
        id: `access-demo-${crypto.randomUUID()}`,
        actorUserId,
        recordId: record.id,
        requestId: record.requestId,
        action: 'view_synthetic',
        reasonProvided: accessReason.length > 0,
        reasonLength: accessReason.length,
        acknowledgedSensitiveScope,
      }, now, {
        id: auditEventId,
        actorUserId,
        action: 'view',
        resourceType: 'conversation',
        resourceId: record.id,
        result: 'success',
        requestId: request.id,
        summary: {
          code: 'CONVERSATION_ACCESS_RECORDED',
          message: '已查看预先脱敏的合成对话轮次；访问动作已记录。',
          resourceName: '预先脱敏合成轮次',
          keyId: record.key.id,
          keyMasked: record.key.masked,
          ownerName: record.person.name,
          changes: [
            { field: 'accessMode', label: '访问方式', before: null, after: '直接查看（超级管理员）', sensitive: false },
            { field: 'contentMode', label: '内容模式', before: null, after: '合成且预先脱敏', sensitive: false },
          ],
        },
      })
      accessRecord = { id: accessEvent.id, persisted: true, auditEventId }
    }
    const result = createDatabaseConversationAccess(database, record, request.body, now, accessRecord)
    if (result) return result
    return reply.status(404).send({ error: { code: 'CONVERSATION_CONTENT_UNAVAILABLE', message: '该记录没有可访问的对话内容', requestId: request.id } })
  })

  const auditOperationBodySchema = conversationAccessBodySchema
  const auditOperationResponseSchema = z.object({
    status: z.literal('ok'), operationId: z.string(), auditEventId: z.string(), requestId: z.string(),
  })
  const conversationAuditDetailResponseSchema = z.object({
    meta: z.object({ source: z.literal('database'), generatedAt: z.string().datetime(), notice: z.string() }),
    record: z.unknown(), content: z.object({ promptAvailable: z.boolean(), responseAvailable: z.boolean(), encrypted: z.boolean() }),
  })

  app.get('/api/keys/:keyId/audits', {
    schema: { params: z.object({ keyId: z.string().min(1).max(128) }), querystring: conversationAuditQuerySchema, response: { 200: conversationAuditResponseSchema, 400: errorResponseSchema } },
  }, async (request) => createDatabaseConversationAudits(database, { ...request.query, key: request.params.keyId }, new Date(), request.authUser?.role ?? 'super_admin'))

  const getConversationAuditDetail = async (request: any, reply: any) => {
    const record = getDatabaseConversationAuditRecord(database, request.params.id)
    if (!record) return reply.status(404).send({ error: { code: 'CONVERSATION_AUDIT_NOT_FOUND', message: '未找到指定对话审计记录', requestId: request.id } })
    return { meta: { source: 'database' as const, generatedAt: new Date().toISOString(), notice: '详情默认只返回元数据；选择记录后由超级管理员直接加载正文。' }, record, content: { promptAvailable: record.promptAvailable, responseAvailable: record.responseAvailable, encrypted: record.promptAvailable || record.responseAvailable } }
  }
  app.get('/api/audits/:id', { schema: { params: conversationAuditParamsSchema, response: { 200: conversationAuditDetailResponseSchema, 404: errorResponseSchema } } }, getConversationAuditDetail)

  const operateConversationAudit = async (request: any, reply: any, action: 'copy' | 'export') => {
    const record = getDatabaseConversationAuditRecord(database, request.params.id)
    if (!record || (!record.promptAvailable && !record.responseAvailable)) return reply.status(404).send({ error: { code: 'CONVERSATION_CONTENT_UNAVAILABLE', message: '该记录没有可访问的正文', requestId: request.id } })
    const content = database.getConversationAuditContent(record.id)
    if (!content || (!content.promptAvailable && !content.responseAvailable)) return reply.status(404).send({ error: { code: 'CONVERSATION_CONTENT_UNAVAILABLE', message: '该记录的正文已到期或采集失败', requestId: request.id } })
    const accessReason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : ''
    const actorUserId = request.authUser?.id ?? 'user-super-admin'
    const operationId = `${action}-${crypto.randomUUID()}`
    const auditEventId = `audit-conversation-${action}-${crypto.randomUUID()}`
    database.recordConversationAuditOperation({
      id: operationId, actorUserId, recordId: record.id, requestId: record.requestId, keyId: record.key.id,
      action, fieldType: 'both', result: 'success', reasonLength: accessReason.length, scope: 'prompt,response',
    }, new Date(), {
      id: auditEventId, actorUserId, action, resourceType: 'conversation', resourceId: record.id, result: 'success', requestId: request.id,
      summary: {
        code: action === 'copy' ? 'CONVERSATION_CONTENT_COPIED' : 'CONVERSATION_CONTENT_EXPORTED',
        message: action === 'copy' ? '超级管理员复制了真实对话正文；正文内容不写入操作审计。' : '超级管理员导出了真实对话正文；导出文件为短期受控响应。',
        keyId: record.key.id, keyMasked: record.key.masked, externalTokenId: record.externalTokenId, requestId: record.requestId,
        fieldType: 'both', reasonLength: accessReason.length,
      },
    })
    if (action === 'export') database.incrementConversationAuditExportCount(record.id)
    if (action === 'copy') return { status: 'ok' as const, operationId, auditEventId, requestId: request.id }
    const normalized = createDatabaseConversationAccess(database, record, request.body, new Date())
    const payload = JSON.stringify({
      exportedAt: new Date().toISOString(), record, content: { messages: normalized?.content.messages ?? [] },
    }, null, 2)
    const fileName = `conversation-audit-${crypto.randomUUID()}.json`
    return reply.type('application/json; charset=utf-8').header('content-disposition', `attachment; filename="${fileName}"`).send(payload)
  }
  app.post('/api/conversation-audits/:id/copy', { schema: { params: conversationAuditParamsSchema, body: auditOperationBodySchema, response: { 200: auditOperationResponseSchema, 404: errorResponseSchema } } }, async (request, reply) => operateConversationAudit(request, reply, 'copy'))
  app.post('/api/audits/:id/copy', { schema: { params: conversationAuditParamsSchema, body: auditOperationBodySchema, response: { 200: auditOperationResponseSchema, 404: errorResponseSchema } } }, async (request, reply) => operateConversationAudit(request, reply, 'copy'))
  app.post('/api/conversation-audits/:id/export', { schema: { params: conversationAuditParamsSchema, body: auditOperationBodySchema, response: { 200: z.string(), 404: errorResponseSchema } } }, async (request, reply) => operateConversationAudit(request, reply, 'export'))
  app.post('/api/audits/:id/export', { schema: { params: conversationAuditParamsSchema, body: auditOperationBodySchema, response: { 200: z.string(), 404: errorResponseSchema } } }, async (request, reply) => operateConversationAudit(request, reply, 'export'))

  app.get('/api/settings', {
    schema: { response: { 200: settingsResponseSchema } },
  }, async (request) => {
    const docsUrl = process.env.DOCS_BASE_URL ?? 'http://127.0.0.1:4173'
    const [newApi, cpa, docs] = await Promise.all([
      (options.probeNewApi ?? probeNewApiFromEnvironment)(),
      (options.probeCpa ?? (() => probeCpaFromEnvironment()))(),
      (options.probeDocs ?? (() => probeHttpService(docsUrl)))(),
    ])
    return createSettings(newApi, cpa, docs, database, new Date(), request.authUser?.role ?? 'super_admin')
  })

  const businessRuleError = (error: unknown, reply: any, requestId: string): any => {
    const code = error instanceof Error ? error.message : 'BUSINESS_RULE_OPERATION_FAILED'
    const status = code === 'BUSINESS_RULE_VERSION_NOT_FOUND' ? 404 : code === 'IDEMPOTENCY_KEY_REUSED' ? 409 : 400
    const messages: Record<string, string> = {
      BUSINESS_RULE_SNAPSHOT_INVALID: '业务口径快照与当前 SQLite 配置不一致',
      BUSINESS_RULE_VERSION_NOT_FOUND: '业务口径版本不存在',
      BUSINESS_RULE_DRAFT_REQUIRED: '只有草稿版本可以发布',
      BUSINESS_RULE_ROLLBACK_INVALID: '只能回滚到非当前的已发布版本',
      IDEMPOTENCY_KEY_REUSED: '幂等编号已被其他变更占用',
    }
    return reply.status(status).send({ error: { code, message: messages[code] ?? '业务口径版本操作失败', requestId } })
  }

  app.post('/api/settings/business-rules/preview', {
    schema: { body: businessRulePreviewBodySchema, response: { 200: businessRulePreviewResponseSchema, 400: errorResponseSchema } },
  }, async (request, reply) => {
    const state = database.getBusinessRuleState()
    const values = new Map(request.body.values.map((item) => [item.id, item.value]))
    if (values.size !== request.body.values.length || state.items.some((item) => !values.has(item.id)) || values.size !== state.items.length) {
      return reply.status(400).send({ error: { code: 'BUSINESS_RULE_SNAPSHOT_INVALID', message: '必须提交当前全部业务口径字段，且字段不能重复', requestId: request.id } })
    }
    const proposed = state.items.map((item) => ({ ...item, value: values.get(item.id) ?? item.value }))
    const changes = proposed.filter((item, index) => item.value !== state.items[index]?.value).map((item) => ({
      id: item.id, label: item.label, impact: item.impact, before: state.items.find((current) => current.id === item.id)?.value ?? '', after: item.value,
    }))
    return { meta: { source: 'database' as const, generatedAt: new Date().toISOString(), notice: '仅在内存中计算差异；预览不会写入 SQLite 或产生审计记录。' }, baseVersion: state.version, current: state.items, proposed, changes, changedCount: changes.length }
  })

  app.post('/api/settings/business-rules/drafts', {
    schema: { body: businessRuleDraftBodySchema, response: { 200: businessRuleVersionActionResponseSchema, 400: errorResponseSchema, 409: errorResponseSchema } },
  }, async (request, reply) => {
    const state = database.getBusinessRuleState()
    const values = new Map(request.body.values.map((item) => [item.id, item.value]))
    if (values.size !== request.body.values.length || state.items.some((item) => !values.has(item.id)) || values.size !== state.items.length) {
      return reply.status(400).send({ error: { code: 'BUSINESS_RULE_SNAPSHOT_INVALID', message: '必须提交当前全部业务口径字段，且字段不能重复', requestId: request.id } })
    }
    const versionId = `business-rule-draft-${createHash('sha256').update(request.body.idempotencyKey).digest('hex').slice(0, 24)}`
    const version = `draft-v${Date.now()}`
    const fingerprint = createHash('sha256').update(JSON.stringify(request.body.values.slice().sort((a, b) => a.id.localeCompare(b.id)))).digest('hex')
    const auditEventId = `audit-settings-business-draft-${request.body.idempotencyKey}`
    try {
      const result = database.createBusinessRuleDraft({
        id: versionId, version, actorUserId: request.authUser?.id ?? null,
        items: state.items.map((item) => ({ ...item, value: values.get(item.id) ?? item.value })),
        note: '管理员提交本地业务口径草稿；原因已提供但不保存原文。',
      }, {
        id: auditEventId, actorUserId: request.authUser?.id ?? null, action: 'draft', resourceType: 'business_rule_version', resourceId: versionId,
        result: 'success', requestId: request.id,
        summary: { code: 'BUSINESS_RULE_DRAFT_SAVED', message: '已保存本地业务口径草稿；审计不保存原因原文。', versionId, version, reasonLength: request.body.reason.length, acknowledgedSimulation: true, idempotencyFingerprint: fingerprint },
      })
      return { meta: { source: 'database' as const, completedAt: new Date().toISOString(), notice: '草稿仅写入本地 SQLite，尚未改变当前生效口径。' }, version: result.version, operation: { action: 'draft' as const, idempotencyKey: request.body.idempotencyKey, idempotent: result.idempotent, auditEventId } }
    } catch (error) {
      return businessRuleError(error, reply, request.id)
    }
  })

  app.post('/api/settings/business-rules/publish', {
    schema: { body: businessRulePublishBodySchema, response: { 200: businessRuleVersionActionResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema } },
  }, async (request, reply) => {
    const fingerprint = createHash('sha256').update(request.body.versionId).digest('hex')
    const auditEventId = `audit-settings-business-publish-${request.body.idempotencyKey}`
    try {
      const result = database.publishBusinessRuleVersion(request.body.versionId, {
        id: auditEventId, actorUserId: request.authUser?.id ?? null, action: 'publish', resourceType: 'business_rule_version', resourceId: request.body.versionId,
        result: 'success', requestId: request.id,
        summary: { code: 'BUSINESS_RULE_PUBLISHED', message: '已发布本地业务口径版本；审计不保存原因原文。', versionId: request.body.versionId, reasonLength: request.body.reason.length, acknowledgedSimulation: true, idempotencyFingerprint: fingerprint },
      })
      return { meta: { source: 'database' as const, completedAt: new Date().toISOString(), notice: '版本已发布到本地 SQLite；真实财务和网关配置仍未连接。' }, version: result.version, operation: { action: 'publish' as const, idempotencyKey: request.body.idempotencyKey, idempotent: result.idempotent, auditEventId } }
    } catch (error) {
      return businessRuleError(error, reply, request.id)
    }
  })

  app.post('/api/settings/business-rules/rollback', {
    schema: { body: businessRuleRollbackBodySchema, response: { 200: businessRuleVersionActionResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema } },
  }, async (request, reply) => {
    const fingerprint = createHash('sha256').update(request.body.versionId).digest('hex')
    const auditEventId = `audit-settings-business-rollback-${request.body.idempotencyKey}`
    try {
      const result = database.rollbackBusinessRuleVersion(request.body.versionId, {
        id: auditEventId, actorUserId: request.authUser?.id ?? null, action: 'rollback', resourceType: 'business_rule_version', resourceId: request.body.versionId,
        result: 'success', requestId: request.id,
        summary: { code: 'BUSINESS_RULE_ROLLED_BACK', message: '已回滚本地业务口径版本；审计不保存原因原文。', versionId: request.body.versionId, reasonLength: request.body.reason.length, acknowledgedSimulation: true, idempotencyFingerprint: fingerprint },
      })
      return { meta: { source: 'database' as const, completedAt: new Date().toISOString(), notice: '版本已回滚到本地 SQLite；真实财务和网关配置仍未连接。' }, version: result.version, operation: { action: 'rollback' as const, idempotencyKey: request.body.idempotencyKey, idempotent: result.idempotent, auditEventId } }
    } catch (error) {
      return businessRuleError(error, reply, request.id)
    }
  })

  app.get('/api/me', {
    schema: { response: { 200: employeeProfileResponseSchema } },
  }, async (request) => createDatabaseEmployeeProfile(database, request.authUser?.id ?? 'person-lin'))

  app.get('/api/me/keys', {
    schema: { response: { 200: employeeKeysResponseSchema } },
  }, async (request) => createDatabaseEmployeeKeys(database, request.authUser?.id ?? 'person-lin'))

  app.get('/api/me/usage', {
    schema: { querystring: employeeUsageQuerySchema, response: { 200: employeeUsageResponseSchema, 400: errorResponseSchema } },
  }, async (request) => createDatabaseEmployeeUsage(database, request.authUser?.id ?? 'person-lin', request.query.period))

  app.get('/api/me/models', {
    schema: { response: { 200: employeeModelsResponseSchema } },
  }, async () => createDemoEmployeeModels())

  app.get('/api/me/quota-requests', {
    schema: { querystring: quotaRequestQuerySchema, response: { 200: quotaRequestsResponseSchema } },
  }, async (request) => createQuotaRequestsResponse(database, { requesterUserId: request.authUser?.id ?? 'person-lin', ...(request.query.status !== 'all' ? { status: request.query.status } : {}) }, { mode: 'self', departmentId: database.findPersonDepartmentId(request.authUser?.id ?? 'person-lin'), canDecide: false }))

  app.post('/api/me/quota-requests', {
    schema: { body: quotaRequestBodySchema, response: { 200: quotaRequestActionResponseSchema, 400: errorResponseSchema, 409: errorResponseSchema } },
  }, async (request, reply) => {
    const requesterUserId = request.authUser?.id ?? 'person-lin'
    const departmentId = database.findPersonDepartmentId(requesterUserId)
    const previous = database.listTemporaryQuotaRequests({ requesterUserId }).find((item) => item.idempotencyKey === request.body.idempotencyKey)
    const id = previous?.id ?? `quota-request-${crypto.randomUUID()}`
    const auditEventId = `audit-${request.body.idempotencyKey}`
    try {
      const result = database.createTemporaryQuotaRequest({ id, requesterUserId, departmentId, targetPoints: request.body.targetPoints, durationHours: request.body.durationHours, reasonLength: request.body.reason.length, idempotencyKey: request.body.idempotencyKey }, {
        id: auditEventId, actorUserId: requesterUserId, action: 'create', resourceType: 'quota', resourceId: id, result: 'success', requestId: request.id,
        summary: { code: 'TEMPORARY_QUOTA_REQUESTED', message: '已创建本地临时额度申请；审计只保存说明长度。', targetPoints: request.body.targetPoints, durationHours: request.body.durationHours, reasonLength: request.body.reason.length },
      }, new Date())
      return {
        meta: { source: 'database' as const, generatedAt: new Date().toISOString(), completedAt: new Date().toISOString(), notice: '申请已写入本地 SQLite，等待部门负责人或管理员审批；不会阻断请求。' },
        request: { id: result.request.id, requester: { id: result.request.requesterUserId, name: result.request.requesterName, department: result.request.departmentName }, targetPoints: result.request.targetPoints, durationHours: result.request.durationHours, reasonLength: result.request.reasonLength, status: result.request.status, requestedAt: result.request.requestedAt, decidedAt: result.request.decidedAt, approver: null, decisionReasonLength: null, expiresAt: null, approvedPoints: null },
        operation: { idempotencyKey: request.body.idempotencyKey, idempotent: result.idempotent, auditEventId },
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') return reply.status(409).send({ error: { code: 'IDEMPOTENCY_KEY_REUSED', message: '该申请操作编号已用于其他申请', requestId: request.id } })
      throw error
    }
  })

  app.setErrorHandler((error, request, reply) => {
    const isValidationError = typeof error === 'object' && error !== null && 'validation' in error
    const statusCode = isValidationError ? 400 : 500
    const isGatewayRequest = request.url.split('?')[0]?.startsWith('/v1/') ?? false
    request.log.error({ err: error, requestId: request.id }, 'request failed')
    return reply.status(statusCode).send({
      error: {
        code: isValidationError ? 'INVALID_REQUEST' : 'INTERNAL_ERROR',
        message: isValidationError ? '请求参数不符合接口约定' : '服务暂时不可用',
        requestId: request.id,
        ...(isGatewayRequest ? { type: 'gateway_error' } : {}),
      },
    })
  })

  return app
}
