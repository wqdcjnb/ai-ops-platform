import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import Fastify, { LogController } from 'fastify'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  authErrorSchema,
  authResponseSchema,
  createAuthService,
  isRoleAllowed,
  loginBodySchema,
  registrationBodySchema,
  ensureBootstrapSuperAdmin,
  type AppRole,
  type AuthService,
} from './auth.js'
import { createDatabasePeople, peopleQuerySchema, personDeleteBodySchema, personDisableBodySchema, personEnableBodySchema, personIdParamsSchema, personPasswordResetBodySchema } from './people.js'
import { createOwnedModels, modelsQuerySchema } from './models.js'
import { createDatabaseUsage, createDatabaseUsageDetail, usageQuerySchema, usageRequestParamsSchema } from './usage.js'
import { auditExportQuerySchema, auditParamsSchema, auditQuerySchema, createAuditCsv, createDatabaseAudit, createDatabaseAuditDetail } from './audit.js'
import {
  conversationAccessBodySchema,
  conversationAuditParamsSchema,
  conversationAuditQuerySchema,
  conversationDeleteBodySchema,
  createDatabaseConversationAccess,
  createDatabaseConversationAccessHistory,
  createDatabaseConversationAudits,
  getDatabaseConversationAuditRecord,
} from './conversation-audit.js'
import { createPlatformDatabase, hashPlatformApiKey, type PlatformDatabase } from './platform-db.js'
import { isPublicModelId, PUBLIC_MODEL_ID, PUBLIC_MODEL_NAME } from './public-model.js'
import { loadGatewayConfig, type GatewayConfig } from './gateway-config.js'
import { registerGatewayRoutes } from './gateway/routes.js'
import { createGatewayConnector } from './gateway/connectors.js'
import { ExternalProviderGatewayUpstream } from './gateway/external-provider-upstream.js'
import type { GatewayUpstream } from './gateway/openai-compatible.js'
import {
  createExternalProviderRegistry,
  ExternalProviderError,
  externalProviderIdSchema,
  externalProviderInputSchema,
  externalProviderModelIdSchema,
  listExternalProviderPresets,
  type ExternalProviderRegistry,
} from './external-providers.js'
import { createLocalModelAnalytics, modelAnalyticsQuerySchema } from './model-analytics.js'

const SYSTEM_AUDIT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000

const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
})

const externalProviderParamsSchema = z.object({ id: externalProviderIdSchema })
const externalProviderCreateInputSchema = externalProviderInputSchema.extend({ id: externalProviderIdSchema.optional() })
const externalProviderDiscoveryInputSchema = z.object({
  baseUrl: z.string().trim().url().max(512),
  apiKey: z.string().trim().min(1).max(2048),
})
const externalProviderModelTestInputSchema = externalProviderDiscoveryInputSchema.extend({
  modelIds: z.array(externalProviderModelIdSchema).min(1).max(500),
})
const externalProviderEnabledInputSchema = z.object({ enabled: z.boolean() })
const employeePortalKeyOperationSchema = z.object({
  idempotencyKey: z.string().trim().regex(/^employee-key-(?:create|reset)-[A-Za-z0-9._:-]{8,96}$/),
})
const personKeyResetBodySchema = z.object({
  idempotencyKey: z.string().trim().regex(/^person-key-reset-[A-Za-z0-9._:-]{8,96}$/),
  acknowledgeImpact: z.literal(true),
})

type AppErrorStatus = 400 | 401 | 403 | 404 | 409 | 410 | 500 | 502 | 503 | 504

class ManagedKeyError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode: AppErrorStatus = 409) {
    super(message)
    this.name = 'ManagedKeyError'
  }
}

export interface BuildAppOptions {
  logger?: boolean
  authMode?: 'required' | 'disabled'
  authService?: AuthService
  database?: PlatformDatabase
  databasePath?: string
  gatewayConfig?: GatewayConfig
  gatewayUpstream?: GatewayUpstream
  externalProviderRegistry?: ExternalProviderRegistry
}

function publicGatewayBaseUrlForCodex() {
  try {
    const url = new URL(process.env.AI_OPS_PUBLIC_GATEWAY_BASE_URL?.trim() || 'http://127.0.0.1:4175')
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported gateway protocol')
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    url.pathname = (url.pathname.replace(/\/$/, '') + '/v1').replace(/\/v1\/v1$/, '/v1')
    return url.toString().replace(/\/$/, '')
  } catch {
    return 'http://127.0.0.1:4175/v1'
  }
}

function createPlatformApiKeySecret() {
  return 'sk-aiops-' + randomBytes(32).toString('base64url')
}

function maskPlatformApiKey(secret: string) {
  return 'sk-aiops••••••' + secret.slice(-6).toUpperCase()
}

function errorPayload(code: string, message: string, requestId: string) {
  return { error: { code, message, requestId } }
}

function parseInput(schema: z.ZodTypeAny, input: unknown, requestId: string, reply: any): any {
  const parsed = schema.safeParse(input)
  if (parsed.success) return parsed.data
  reply.status(400).send(errorPayload('VALIDATION_ERROR', '请求参数不符合接口约定。', requestId))
  return null
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    genReqId: () => 'req-' + randomUUID(),
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
  const database = options.database ?? createPlatformDatabase({
    filename: options.databasePath ?? process.env.PLATFORM_DB_PATH ?? (authMode === 'disabled' ? ':memory:' : undefined),
  })
  database.cleanupAuditEvents('startup')
  const auditCleanupTimer = setInterval(() => {
    try {
      database.cleanupAuditEvents('scheduled')
    } catch (error) {
      app.log.error({ err: error }, 'system audit retention cleanup failed')
    }
  }, SYSTEM_AUDIT_CLEANUP_INTERVAL_MS)
  auditCleanupTimer.unref()
  app.addHook('onClose', async () => {
    clearInterval(auditCleanupTimer)
    if (!options.database) database.close()
  })
  ensureBootstrapSuperAdmin(database)
  const auth = options.authService ?? createAuthService({ database })
  const gatewayConfig = options.gatewayConfig ?? loadGatewayConfig()
  const externalProviderRegistry = options.externalProviderRegistry ?? createExternalProviderRegistry()
  const primaryGateway = options.gatewayUpstream ?? createGatewayConnector(gatewayConfig)
  const gatewayUpstream = new ExternalProviderGatewayUpstream(primaryGateway, externalProviderRegistry, gatewayConfig)

  const recordAuthenticationAudit = (input: {
    actorUserId?: string | null
    action: 'login' | 'logout' | 'access'
    result: 'success' | 'failed' | 'denied'
    requestId: string
    code: string
    message: string
  }) => {
    database.appendAuditEvent({
      id: 'audit-auth-' + randomUUID(),
      actorUserId: input.actorUserId && database.userExists(input.actorUserId) ? input.actorUserId : null,
      action: input.action,
      resourceType: input.action === 'access' ? 'authorization' : 'session',
      resourceId: input.action === 'access' ? 'authorization-check' : 'local-session',
      result: input.result,
      requestId: input.requestId,
      summary: { code: input.code, message: input.message },
    })
  }

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id)
    reply.header('cache-control', 'no-store')
    return payload
  })

  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '/'
    if (
      path === '/health'
      || path.startsWith('/gateway/')
      || path.startsWith('/v1/')
      || path === '/api/auth/login'
      || path === '/api/auth/register'
      || path === '/api/auth/bootstrap'
    ) return

    if (authMode === 'disabled') return

    const user = auth.authenticate(request)
    if (!user) {
      recordAuthenticationAudit({
        action: 'access',
        result: 'denied',
        requestId: request.id,
        code: 'AUTH_REQUIRED',
        message: '未建立有效本地会话的访问被拒绝。',
      })
      return reply.status(401).send(errorPayload('AUTH_REQUIRED', '请先登录后再访问该资源', request.id))
    }
    request.authUser = user

    let roles: readonly AppRole[] = ['super_admin']
    if (path.startsWith('/api/me')) roles = ['employee']
    else if (path.startsWith('/api/auth/')) roles = ['super_admin', 'employee']
    if (!isRoleAllowed(user, roles)) {
      recordAuthenticationAudit({
        actorUserId: user.id,
        action: 'access',
        result: 'denied',
        requestId: request.id,
        code: 'AUTH_FORBIDDEN',
        message: '角色权限拒绝了受保护的接口访问。',
      })
      return reply.status(403).send(errorPayload('AUTH_FORBIDDEN', '当前身份没有访问该资源的权限', request.id))
    }

    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !auth.verifyCsrf(request)) {
      recordAuthenticationAudit({
        actorUserId: user.id,
        action: 'access',
        result: 'denied',
        requestId: request.id,
        code: 'CSRF_INVALID',
        message: 'CSRF 请求安全校验未通过。',
      })
      return reply.status(403).send(errorPayload('CSRF_INVALID', '请求安全校验未通过，请刷新页面后重试', request.id))
    }
  })

  app.get('/health', {
    schema: { response: { 200: z.object({ status: z.literal('ok'), service: z.literal('ai-ops-bff') }) } },
  }, async () => ({ status: 'ok' as const, service: 'ai-ops-bff' as const }))

  registerGatewayRoutes(app, gatewayConfig, {
    upstream: gatewayUpstream,
    database,
    hasExternalModels: () => externalProviderRegistry.hasEnabledModels(),
    supportsNativeResponses: (model) => isPublicModelId(model) && externalProviderRegistry.hasEnabledModels(),
  })

  const sendExternalProviderError = (error: unknown, requestId: string, reply: any) => {
    if (error instanceof ExternalProviderError) {
      return reply.status(error.statusCode).send(errorPayload(error.code, error.message, requestId))
    }
    return reply.status(502).send(errorPayload('EXTERNAL_PROVIDER_UNAVAILABLE', '第三方账号暂时不可用；本次配置未保存。', requestId))
  }

  const recordExternalProviderAudit = (
    action: 'create' | 'update' | 'sync' | 'verify' | 'delete',
    provider: { id: string; name: string; models: unknown[] },
    requestId: string,
    actorUserId: string | null,
  ) => {
    const codes = {
      create: 'RELAY_ACCOUNT_CREATED',
      update: 'RELAY_ACCOUNT_UPDATED',
      sync: 'RELAY_ACCOUNT_SYNCED',
      verify: 'RELAY_ACCOUNT_HEALTH_CHECKED',
      delete: 'RELAY_ACCOUNT_DELETED',
    }
    database.appendAuditEvent({
      id: 'audit-external-provider-' + action + '-' + randomUUID(),
      actorUserId,
      action,
      resourceType: 'upstream',
      resourceId: 'external-provider-' + provider.id,
      result: 'success',
      requestId,
      summary: {
        code: codes[action],
        resourceName: provider.name,
        modelCount: provider.models.length,
        message: action === 'verify'
          ? '已执行轻量模型目录健康检查；未发送任何生成请求。'
          : action === 'delete'
            ? '已删除第三方账号；审计不保存中转站地址或凭据。'
            : '已维护第三方账号并同步所选可用模型；审计不保存中转站地址或凭据。',
      },
    })
  }

  app.get('/api/external-providers/presets', async (request) => ({
    meta: {
      source: 'built_in' as const,
      generatedAt: new Date().toISOString(),
      notice: '预设只提供服务地址；保存时会验证管理员选择的模型。',
    },
    items: listExternalProviderPresets(),
    requestId: request.id,
  }))

  app.get('/api/external-providers', async (request) => ({
    meta: {
      source: 'runtime' as const,
      generatedAt: new Date().toISOString(),
      notice: '中转站凭据经服务端加密保存，员工、WorkBuddy 与 Codex 只接收平台 Key。',
    },
    items: externalProviderRegistry.list(),
    requestId: request.id,
  }))

  app.post('/api/external-providers/discover', async (request, reply) => {
    const body = parseInput(externalProviderDiscoveryInputSchema, request.body, request.id, reply)
    if (!body) return
    try {
      const discovered = await externalProviderRegistry.discover(body)
      return { ...discovered, requestId: request.id }
    } catch (error) {
      return sendExternalProviderError(error, request.id, reply)
    }
  })

  app.post('/api/external-providers/test', async (request, reply) => {
    const body = parseInput(externalProviderModelTestInputSchema, request.body, request.id, reply)
    if (!body) return
    try {
      const report = await externalProviderRegistry.testModels(body)
      const availableCount = report.results.filter((item) => item.status === 'available').length
      database.appendAuditEvent({
        id: 'audit-external-provider-model-test-' + randomUUID(),
        actorUserId: request.authUser?.id ?? null,
        action: 'verify',
        resourceType: 'upstream',
        resourceId: 'external-provider-preview',
        result: availableCount > 0 ? 'success' : 'failed',
        requestId: request.id,
        summary: {
          code: 'RELAY_ACCOUNT_MODEL_TESTED',
          message: '已完成管理员发起的第三方模型调用探测；审计不保存服务地址、凭据或测试内容。',
          modelCount: report.results.length,
          availableCount,
        },
      })
      return { ...report, requestId: request.id }
    } catch (error) {
      return sendExternalProviderError(error, request.id, reply)
    }
  })

  app.post('/api/external-providers', async (request, reply) => {
    const body = parseInput(externalProviderCreateInputSchema, request.body, request.id, reply)
    if (!body) return
    try {
      const input = {
        name: body.name,
        baseUrl: body.baseUrl,
        apiKey: body.apiKey,
        modelIds: body.modelIds,
        enabled: body.enabled,
      }
      const existing = body.id ? externalProviderRegistry.get(body.id) : null
      const provider = body.id
        ? await externalProviderRegistry.upsertVerified(body.id, input)
        : await externalProviderRegistry.createVerified(input)
      recordExternalProviderAudit(existing ? 'update' : 'create', provider, request.id, request.authUser?.id ?? null)
      return { provider, requestId: request.id }
    } catch (error) {
      return sendExternalProviderError(error, request.id, reply)
    }
  })

  app.patch('/api/external-providers/:id', async (request, reply) => {
    const params = parseInput(externalProviderParamsSchema, request.params, request.id, reply)
    const body = parseInput(externalProviderInputSchema, request.body, request.id, reply)
    if (!params || !body) return
    try {
      const provider = await externalProviderRegistry.upsertVerified(params.id, body)
      recordExternalProviderAudit('update', provider, request.id, request.authUser?.id ?? null)
      return { provider, requestId: request.id }
    } catch (error) {
      return sendExternalProviderError(error, request.id, reply)
    }
  })

  app.patch('/api/external-providers/:id/enabled', async (request, reply) => {
    const params = parseInput(externalProviderParamsSchema, request.params, request.id, reply)
    const body = parseInput(externalProviderEnabledInputSchema, request.body, request.id, reply)
    if (!params || !body) return
    try {
      const provider = externalProviderRegistry.setEnabled(params.id, body.enabled)
      recordExternalProviderAudit('update', provider, request.id, request.authUser?.id ?? null)
      return { provider, requestId: request.id }
    } catch (error) {
      return sendExternalProviderError(error, request.id, reply)
    }
  })

  app.post('/api/external-providers/:id/sync', async (request, reply) => {
    const params = parseInput(externalProviderParamsSchema, request.params, request.id, reply)
    if (!params) return
    try {
      const provider = await externalProviderRegistry.syncModels(params.id)
      recordExternalProviderAudit('sync', provider, request.id, request.authUser?.id ?? null)
      return { provider, requestId: request.id }
    } catch (error) {
      return sendExternalProviderError(error, request.id, reply)
    }
  })

  app.post('/api/external-providers/:id/health', async (request, reply) => {
    const params = parseInput(externalProviderParamsSchema, request.params, request.id, reply)
    if (!params) return
    try {
      const provider = await externalProviderRegistry.checkHealth(params.id)
      recordExternalProviderAudit('verify', provider, request.id, request.authUser?.id ?? null)
      return { provider, requestId: request.id }
    } catch (error) {
      return sendExternalProviderError(error, request.id, reply)
    }
  })

  app.delete('/api/external-providers/:id', async (request, reply) => {
    const params = parseInput(externalProviderParamsSchema, request.params, request.id, reply)
    if (!params) return
    try {
      const provider = externalProviderRegistry.remove(params.id)
      recordExternalProviderAudit('delete', provider, request.id, request.authUser?.id ?? null)
      return { status: 'ok' as const, requestId: request.id }
    } catch (error) {
      return sendExternalProviderError(error, request.id, reply)
    }
  })

  app.post('/api/auth/login', async (request, reply) => {
    const body = parseInput(loginBodySchema, request.body, request.id, reply)
    if (!body) return
    const session = auth.login(body.email, body.password)
    if (!session) {
      recordAuthenticationAudit({
        action: 'login',
        result: 'failed',
        requestId: request.id,
        code: 'AUTH_INVALID',
        message: '本地登录校验失败；未记录输入的邮箱或密码。',
      })
      return reply.status(401).send(errorPayload('AUTH_INVALID', '邮箱或密码不正确', request.id))
    }
    auth.setSessionCookie(reply, session.token, session.csrfToken, session.expiresAt)
    recordAuthenticationAudit({
      actorUserId: session.user.id,
      action: 'login',
      result: 'success',
      requestId: request.id,
      code: 'AUTH_OK',
      message: '本地管理会话已创建。',
    })
    return { authenticated: true as const, user: session.user, expiresAt: session.expiresAt }
  })

  app.post('/api/auth/register', async (request, reply) => {
    const body = parseInput(registrationBodySchema, request.body, request.id, reply)
    if (!body) return
    const id = 'person-' + randomUUID().replaceAll('-', '').slice(0, 16)
    try {
      database.createPerson({
        id,
        username: body.email,
        displayName: body.realName,
        password: body.password,
      }, {
        id: 'audit-' + id + '-register',
        actorUserId: null,
        action: 'create',
        resourceType: 'person',
        resourceId: id,
        result: 'success',
        requestId: request.id,
        summary: {
          code: 'EMPLOYEE_SELF_REGISTERED',
          message: '员工通过真实姓名、邮箱和密码完成自助注册；审计不保存密码。',
          resourceName: body.realName,
        },
      })
    } catch (error) {
      if (error instanceof Error && /unique|duplicate/i.test(error.message)) {
        return reply.status(409).send(errorPayload('EMAIL_CONFLICT', '该邮箱已注册，请直接登录。', request.id))
      }
      throw error
    }
    const session = auth.login(body.email, body.password)
    if (!session) return reply.status(400).send(errorPayload('REGISTER_SESSION_FAILED', '账号已创建，但登录会话未能建立，请直接登录。', request.id))
    auth.setSessionCookie(reply, session.token, session.csrfToken, session.expiresAt)
    return reply.status(201).send({ authenticated: true as const, user: session.user, expiresAt: session.expiresAt })
  })

  app.get('/api/auth/me', async (request, reply) => {
    const session = auth.getSession(request)
    if (!session) return reply.status(401).send(errorPayload('AUTH_REQUIRED', '当前会话已失效，请重新登录', request.id))
    return { authenticated: true as const, user: session.user, expiresAt: session.expiresAt }
  })

  app.post('/api/auth/logout', async (request, reply) => {
    auth.revoke(request)
    auth.clearSessionCookie(reply)
    recordAuthenticationAudit({
      actorUserId: request.authUser?.id ?? null,
      action: 'logout',
      result: 'success',
      requestId: request.id,
      code: 'LOGOUT_OK',
      message: '本地管理会话已撤销。',
    })
    return reply.status(204).send()
  })

  app.get('/api/people', async (request, reply) => {
    const query = parseInput(peopleQuerySchema, request.query, request.id, reply)
    if (!query) return
    return createDatabasePeople(database, query, new Date())
  })

  app.post('/api/people', async (request, reply) => {
    return reply.status(410).send(errorPayload('ADMIN_EMPLOYEE_CREATION_DISABLED', '管理员不能创建员工账号；员工必须通过注册页面自助创建。', request.id))
  })

  const personActionError = (error: unknown, requestId: string, reply: any) => {
    if (error instanceof ManagedKeyError) return reply.status(error.statusCode).send(errorPayload(error.code, error.message, requestId))
    if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') {
      return reply.status(409).send(errorPayload('IDEMPOTENCY_KEY_REUSED', '该幂等编号已用于其他人员或操作。', requestId))
    }
    throw error
  }

  const personAudit = (idempotencyKey: string, action: string, personId: string, request: { id: string; authUser?: { id: string } }, summary: Record<string, unknown>) => ({
    id: 'audit-' + idempotencyKey,
    actorUserId: request.authUser?.id ?? null,
    action,
    resourceType: 'person',
    resourceId: personId,
    result: 'success' as const,
    requestId: request.id,
    summary,
  })

  app.post('/api/people/:id/disable', async (request, reply) => {
    const params = parseInput(personIdParamsSchema, request.params, request.id, reply)
    const body = parseInput(personDisableBodySchema, request.body, request.id, reply)
    if (!params || !body) return
    try {
      const result = database.disablePerson(params.id, personAudit(body.idempotencyKey, 'disable', params.id, request, {
        code: 'PERSON_DISABLED',
        message: '已停用员工并立即回收其 AI OPS 平台 Key。',
      }))
      if (!result) return reply.status(404).send(errorPayload('PERSON_NOT_FOUND', '未找到指定人员', request.id))
      if (result.state === 'already_disabled') return reply.status(409).send(errorPayload('PERSON_ALREADY_DISABLED', '该人员已停用', request.id))
      return {
        meta: { source: 'database' as const, completedAt: new Date().toISOString(), notice: result.idempotent ? '已返回上次停用结果。' : '员工已停用，旧平台 Key 已立即失效。' },
        person: { id: result.person.id, name: result.person.displayName, status: 'disabled' as const },
        keysDisabled: result.keysDisabled,
        operation: { idempotencyKey: body.idempotencyKey, idempotent: result.idempotent, auditEventId: 'audit-' + body.idempotencyKey },
      }
    } catch (error) {
      return personActionError(error, request.id, reply)
    }
  })

  app.post('/api/people/:id/enable', async (request, reply) => {
    const params = parseInput(personIdParamsSchema, request.params, request.id, reply)
    const body = parseInput(personEnableBodySchema, request.body, request.id, reply)
    if (!params || !body) return
    try {
      const result = database.enablePerson(params.id, personAudit(body.idempotencyKey, 'enable', params.id, request, {
        code: 'PERSON_ENABLED',
        message: '已启用员工；此前因停用而回收的 Key 按原状态恢复。',
      }))
      if (!result) return reply.status(404).send(errorPayload('PERSON_NOT_FOUND', '未找到指定人员', request.id))
      if (result.state === 'already_enabled') return reply.status(409).send(errorPayload('PERSON_ALREADY_ENABLED', '该人员已启用', request.id))
      return {
        meta: { source: 'database' as const, completedAt: new Date().toISOString(), notice: result.idempotent ? '已返回上次启用结果。' : '员工已启用。' },
        person: { id: result.person.id, name: result.person.displayName, status: 'active' as const },
        keysEnabled: result.keysEnabled,
        operation: { idempotencyKey: body.idempotencyKey, idempotent: result.idempotent, auditEventId: 'audit-' + body.idempotencyKey },
      }
    } catch (error) {
      return personActionError(error, request.id, reply)
    }
  })

  app.post('/api/people/:id/reset-password', async (request, reply) => {
    const params = parseInput(personIdParamsSchema, request.params, request.id, reply)
    const body = parseInput(personPasswordResetBodySchema, request.body, request.id, reply)
    if (!params || !body) return
    try {
      const result = database.resetPersonPassword(params.id, personAudit(body.idempotencyKey, 'reset', params.id, request, {
        code: 'PERSON_PASSWORD_RESET',
        message: '管理员已将员工登录密码重置为固定临时值；审计不保存该值。',
      }))
      if (!result) return reply.status(404).send(errorPayload('PERSON_NOT_FOUND', '未找到指定人员', request.id))
      return {
        meta: { source: 'database' as const, completedAt: new Date().toISOString(), notice: result.idempotent ? '已返回上次密码重置结果。' : '登录密码已重置为 123456。' },
        person: { id: result.person.id, name: result.person.displayName },
        operation: { idempotencyKey: body.idempotencyKey, idempotent: result.idempotent, auditEventId: 'audit-' + body.idempotencyKey },
      }
    } catch (error) {
      return personActionError(error, request.id, reply)
    }
  })

  const currentPlatformKey = (ownerUserId: string) => database.listApiKeysForOwner(ownerUserId)
    .find((key) => key.status !== 'revoked') ?? null

  const employeePortalKeyResponse = (ownerUserId: string, requestId: string) => {
    const key = currentPlatformKey(ownerUserId)
    return {
      key: key ? {
        id: key.id,
        masked: key.maskedValue,
        status: key.status as 'active' | 'expiring',
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt,
      } : null,
      // This route is protected by employee-only session authentication. The
      // encrypted copy exists specifically so the owner can configure another
      // device or copy the same Key after a later login. Admin routes never
      // call this helper or receive this field.
      secret: key ? database.readApiKeySecret(key.id) : null,
      model: { id: PUBLIC_MODEL_ID, name: PUBLIC_MODEL_NAME },
      gateway: { baseUrl: publicGatewayBaseUrlForCodex() },
      requestId,
    }
  }

  const issuePlatformKey = (ownerUserId: string, actorUserId: string | null, requestId: string, idempotencyKey: string, action: 'create' | 'reset') => {
    const person = database.findPerson(ownerUserId)
    if (!person || person.status !== 'active') {
      throw new ManagedKeyError('EMPLOYEE_NOT_ACTIVE', '员工账号不存在或已停用，不能创建 API Key。')
    }
    const auditEventId = 'audit-' + idempotencyKey
    const existingOperation = database.findApiKeyOperation(idempotencyKey)
    if (existingOperation) {
      if (existingOperation.personId !== ownerUserId) {
        throw new ManagedKeyError('IDEMPOTENCY_KEY_REUSED', '幂等编号已用于其他员工。')
      }
      const key = database.listApiKeysForOwner(ownerUserId).find((item) => item.id === existingOperation.keyId)
      const secret = key ? database.readApiKeySecret(key.id) : null
      if (!key || !secret) throw new ManagedKeyError('KEY_OPERATION_UNAVAILABLE', '已保存的 Key 操作无法读取，请重新发起重置。', 503)
      return { key, secret, auditEventId, idempotent: true }
    }

    const secret = createPlatformApiKeySecret()
    const maskedValue = maskPlatformApiKey(secret)
    const existing = currentPlatformKey(ownerUserId)
    if (existing) {
      const result = database.resetApiKey(existing.id, {
        maskedValue,
        secretHash: hashPlatformApiKey(secret),
        secretValue: secret,
      }, {
        id: auditEventId,
        actorUserId,
        action: 'reset',
        resourceType: 'key',
        resourceId: existing.id,
        result: 'success',
        requestId,
        summary: {
          code: 'PLATFORM_KEY_RESET',
          message: 'AI OPS 平台 Key 已重置；旧 Key 立即失效。',
          resourceName: person.displayName,
          idempotencyFingerprint: createHash('sha256').update(ownerUserId + ':' + action).digest('hex'),
        },
      })
      if (!result || !result.secret) throw new ManagedKeyError('KEY_RESET_FAILED', 'AI OPS 平台 Key 重置未完成，请稍后重试。')
      return { key: result.key, secret: result.secret, auditEventId, idempotent: result.idempotent }
    }

    const keyId = 'key-aiops-' + randomUUID().replaceAll('-', '').slice(0, 16)
    const created = database.createApiKey({
      id: keyId,
      ownerUserId,
      maskedValue,
      secretHash: hashPlatformApiKey(secret),
      secretValue: secret,
      purpose: 'AI OPS 统一访问',
      status: 'active',
      secretRevealedAt: new Date().toISOString(),
      idempotencyKey,
    }, {
      id: auditEventId,
      actorUserId,
      action: 'create',
      resourceType: 'key',
      resourceId: keyId,
      result: 'success',
      requestId,
      summary: {
        code: 'PLATFORM_KEY_CREATED',
        message: '已创建 AI OPS 平台 Key；员工本人可在登录后查看和复制。',
        resourceName: person.displayName,
        idempotencyFingerprint: createHash('sha256').update(ownerUserId + ':' + action).digest('hex'),
      },
    })
    if (!created) throw new ManagedKeyError('KEY_CREATE_FAILED', 'AI OPS 平台 Key 创建未完成，请稍后重试。')
    return { key: created, secret, auditEventId, idempotent: false }
  }

  app.post('/api/people/:id/reset-key', async (request, reply) => {
    const params = parseInput(personIdParamsSchema, request.params, request.id, reply)
    const body = parseInput(personKeyResetBodySchema, request.body, request.id, reply)
    if (!params || !body) return
    try {
      const issued = issuePlatformKey(params.id, request.authUser?.id ?? null, request.id, body.idempotencyKey, 'reset')
      const person = database.findPerson(params.id)
      if (!person) return reply.status(404).send(errorPayload('PERSON_NOT_FOUND', '未找到指定人员', request.id))
      return {
        meta: {
          source: 'database' as const,
          completedAt: new Date().toISOString(),
          notice: issued.idempotent ? '已返回上次 Key 重置结果。' : '已重置员工平台 Key，旧 Key 已立即失效；员工可在自己的已登录门户中查看和复制新 Key。',
        },
        person: { id: person.id, name: person.displayName, apiKeyMasked: issued.key.maskedValue },
        operation: { idempotencyKey: body.idempotencyKey, idempotent: issued.idempotent, auditEventId: issued.auditEventId },
      }
    } catch (error) {
      return personActionError(error, request.id, reply)
    }
  })

  app.post('/api/people/:id/delete', async (request, reply) => {
    const params = parseInput(personIdParamsSchema, request.params, request.id, reply)
    const body = parseInput(personDeleteBodySchema, request.body, request.id, reply)
    if (!params || !body) return
    try {
      const result = database.deletePerson(params.id, personAudit(body.idempotencyKey, 'delete', params.id, request, {
        code: 'PERSON_DELETED',
        message: '已从人员目录删除员工；历史审计与用量记录保留。',
      }))
      if (!result) return reply.status(404).send(errorPayload('PERSON_NOT_FOUND', '未找到指定人员', request.id))
      if (result.state === 'not_disabled') return reply.status(409).send(errorPayload('PERSON_MUST_BE_DISABLED', '只有已停用员工才可删除。', request.id))
      return {
        meta: { source: 'database' as const, completedAt: new Date().toISOString(), notice: result.idempotent ? '已返回上次删除结果。' : '员工已从人员目录删除，历史审计与用量记录保留。' },
        person: { id: result.person.id, name: result.person.displayName, status: 'deleted' as const },
        operation: { idempotencyKey: body.idempotencyKey, idempotent: result.idempotent, auditEventId: 'audit-' + body.idempotencyKey },
      }
    } catch (error) {
      return personActionError(error, request.id, reply)
    }
  })

  app.get('/api/models', async (request, reply) => {
    const query = parseInput(modelsQuerySchema, request.query, request.id, reply)
    if (!query) return
    return createOwnedModels(query, externalProviderRegistry.list(), new Date())
  })

  app.get('/api/usage', async (request, reply) => {
    const query = parseInput(usageQuerySchema, request.query, request.id, reply)
    if (!query) return
    return createDatabaseUsage(database, query, new Date())
  })

  app.get('/api/usage/model-analytics', async (request, reply) => {
    const query = parseInput(modelAnalyticsQuerySchema, request.query, request.id, reply)
    if (!query) return
    return createLocalModelAnalytics(database.listUsageRequests().map((record) => ({
      requestId: record.requestId,
      occurredAt: record.occurredAt,
      personId: record.personId,
      personName: record.personName,
      modelId: record.actualModel || record.modelDisplayName,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
    })), query, new Date())
  })

  app.get('/api/usage/:requestId', async (request, reply) => {
    const params = parseInput(usageRequestParamsSchema, request.params, request.id, reply)
    if (!params) return
    const result = createDatabaseUsageDetail(database, params.requestId, new Date(), true)
    if (!result) return reply.status(404).send(errorPayload('USAGE_NOT_FOUND', '未找到指定调用记录', request.id))
    return result
  })

  app.get('/api/audit-events', async (request, reply) => {
    const query = parseInput(auditQuerySchema, request.query, request.id, reply)
    if (!query) return
    return createDatabaseAudit(database, query)
  })

  app.post('/api/audit-events/export', async (request, reply) => {
    const body = parseInput(auditExportQuerySchema, request.body, request.id, reply)
    if (!body) return
    const result = createDatabaseAudit(database, { ...body, page: 1, pageSize: 500 })
    database.appendAuditEvent({
      id: 'audit-export-' + randomUUID(),
      actorUserId: request.authUser?.id ?? null,
      action: 'export',
      resourceType: 'export',
      resourceId: 'audit-csv',
      result: 'success',
      requestId: request.id,
      summary: {
        code: 'AUDIT_CSV_EXPORTED',
        message: '已导出当前筛选范围内的脱敏审计摘要。',
        exportedRows: result.items.length,
      },
    })
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="audit-export-' + date + '.csv"')
      .send(createAuditCsv(result.items))
  })

  app.get('/api/audit-events/:id', async (request, reply) => {
    const params = parseInput(auditParamsSchema, request.params, request.id, reply)
    if (!params) return
    const result = createDatabaseAuditDetail(database, params.id)
    if (!result) return reply.status(404).send(errorPayload('AUDIT_EVENT_NOT_FOUND', '未找到指定审计事件', request.id))
    return result
  })

  app.get('/api/conversation-audits', async (request, reply) => {
    const query = parseInput(conversationAuditQuerySchema, request.query, request.id, reply)
    if (!query) return
    return createDatabaseConversationAudits(database, query, new Date(), request.authUser?.role ?? 'super_admin')
  })

  app.get('/api/keys/:keyId/audits', async (request, reply) => {
    const keyParams = parseInput(z.object({ keyId: z.string().min(1).max(128) }), request.params, request.id, reply)
    const query = parseInput(conversationAuditQuerySchema, request.query, request.id, reply)
    if (!keyParams || !query) return
    return createDatabaseConversationAudits(database, { ...query, key: keyParams.keyId }, new Date(), request.authUser?.role ?? 'super_admin')
  })

  app.get('/api/conversation-audits/:id/access-events', async (request, reply) => {
    const params = parseInput(conversationAuditParamsSchema, request.params, request.id, reply)
    if (!params) return
    const result = createDatabaseConversationAccessHistory(database, params.id)
    if (!result) return reply.status(404).send(errorPayload('CONVERSATION_AUDIT_NOT_FOUND', '未找到指定对话审计记录', request.id))
    return result
  })

  const accessConversationAudit = async (request: any, reply: any) => {
    const params = parseInput(conversationAuditParamsSchema, request.params, request.id, reply)
    const body = parseInput(conversationAccessBodySchema, request.body, request.id, reply)
    if (!params || !body) return
    const record = getDatabaseConversationAuditRecord(database, params.id)
    if (!record || !record.contentAccess.available) {
      return reply.status(404).send(errorPayload('CONVERSATION_CONTENT_UNAVAILABLE', '该记录没有可访问的对话内容', request.id))
    }
    const accessEvent = database.recordConversationAccess({
      id: 'access-' + randomUUID(),
      actorUserId: request.authUser?.id ?? 'user-super-admin',
      recordId: record.id,
      requestId: record.requestId,
      action: 'view',
      reasonProvided: body.reason.length > 0,
      reasonLength: body.reason.length,
      acknowledgedSensitiveScope: body.acknowledgeSensitiveScope,
    }, new Date(), {
      id: 'audit-conversation-' + randomUUID(),
      actorUserId: request.authUser?.id ?? 'user-super-admin',
      action: 'view',
      resourceType: 'conversation',
      resourceId: record.id,
      result: 'success',
      requestId: request.id,
      summary: {
        code: 'CONVERSATION_CONTENT_VIEWED',
        message: '超级管理员查看了对话审计内容；访问动作已记录。',
        resourceName: record.person.name,
      },
    })
    const result = createDatabaseConversationAccess(database, record, body, new Date(), {
      id: accessEvent.id,
      persisted: true,
      auditEventId: 'audit-conversation-' + randomUUID(),
    })
    if (!result) return reply.status(404).send(errorPayload('CONVERSATION_CONTENT_UNAVAILABLE', '该记录没有可访问的对话内容', request.id))
    return result
  }

  app.post('/api/conversation-audits/:id/access', accessConversationAudit)

  const conversationDetail = async (request: any, reply: any) => {
    const params = parseInput(conversationAuditParamsSchema, request.params, request.id, reply)
    if (!params) return
    const record = getDatabaseConversationAuditRecord(database, params.id)
    if (!record) return reply.status(404).send(errorPayload('CONVERSATION_AUDIT_NOT_FOUND', '未找到指定对话审计记录', request.id))
    return {
      meta: { source: 'database' as const, generatedAt: new Date().toISOString(), notice: '详情默认只返回元数据；打开正文会写入访问审计。' },
      record,
      content: {
        promptAvailable: record.promptAvailable,
        responseAvailable: record.responseAvailable,
        encrypted: record.promptAvailable || record.responseAvailable,
      },
    }
  }
  app.get('/api/audits/:id', conversationDetail)

  const operateConversationAudit = async (request: any, reply: any, action: 'copy' | 'export') => {
    const params = parseInput(conversationAuditParamsSchema, request.params, request.id, reply)
    const body = parseInput(conversationAccessBodySchema, request.body, request.id, reply)
    if (!params || !body) return
    const record = getDatabaseConversationAuditRecord(database, params.id)
    if (!record || (!record.promptAvailable && !record.responseAvailable)) {
      return reply.status(404).send(errorPayload('CONVERSATION_CONTENT_UNAVAILABLE', '该记录没有可访问的正文', request.id))
    }
    const content = database.getConversationAuditContent(record.id)
    if (!content || (!content.promptAvailable && !content.responseAvailable)) {
      return reply.status(404).send(errorPayload('CONVERSATION_CONTENT_UNAVAILABLE', '该记录的正文已到期或采集失败', request.id))
    }
    const operationId = action + '-' + randomUUID()
    const auditEventId = 'audit-conversation-' + action + '-' + randomUUID()
    database.recordConversationAuditOperation({
      id: operationId,
      actorUserId: request.authUser?.id ?? 'user-super-admin',
      recordId: record.id,
      requestId: record.requestId,
      keyId: record.key.id,
      action,
      fieldType: 'both',
      result: 'success',
      reasonLength: body.reason.length,
      scope: 'prompt,response',
    }, new Date(), {
      id: auditEventId,
      actorUserId: request.authUser?.id ?? 'user-super-admin',
      action,
      resourceType: 'conversation',
      resourceId: record.id,
      result: 'success',
      requestId: request.id,
      summary: {
        code: action === 'copy' ? 'CONVERSATION_CONTENT_COPIED' : 'CONVERSATION_CONTENT_EXPORTED',
        message: action === 'copy' ? '超级管理员复制了真实对话正文。' : '超级管理员导出了真实对话正文。',
        resourceName: record.person.name,
      },
    })
    if (action === 'copy') return { status: 'ok' as const, operationId, auditEventId, requestId: request.id }
    database.incrementConversationAuditExportCount(record.id)
    const normalized = createDatabaseConversationAccess(database, record, body, new Date())
    const payload = JSON.stringify({
      exportedAt: new Date().toISOString(),
      record,
      content: { messages: normalized?.content.messages ?? [] },
    }, null, 2)
    return reply
      .type('application/json; charset=utf-8')
      .header('content-disposition', 'attachment; filename="conversation-audit-' + randomUUID() + '.json"')
      .send(payload)
  }

  app.post('/api/conversation-audits/:id/copy', async (request, reply) => operateConversationAudit(request, reply, 'copy'))
  app.post('/api/audits/:id/copy', async (request, reply) => operateConversationAudit(request, reply, 'copy'))
  app.post('/api/conversation-audits/:id/export', async (request, reply) => operateConversationAudit(request, reply, 'export'))
  app.post('/api/audits/:id/export', async (request, reply) => operateConversationAudit(request, reply, 'export'))

  app.post('/api/conversation-audits/:id/delete', async (request, reply) => {
    const params = parseInput(conversationAuditParamsSchema, request.params, request.id, reply)
    const body = parseInput(conversationDeleteBodySchema, request.body, request.id, reply)
    if (!params || !body) return
    const auditEventId = `audit-conversation-delete-${body.idempotencyKey}`
    try {
      const result = database.deleteConversationAuditRecord(params.id, {
        id: auditEventId,
        actorUserId: request.authUser?.id ?? 'user-super-admin',
        action: 'delete',
        resourceType: 'conversation',
        resourceId: params.id,
        result: 'success',
        requestId: request.id,
        summary: {
          code: 'CONVERSATION_RECORD_DELETED',
          message: '超级管理员删除了本地对话审计记录；仅保留不含正文的删除证明。',
          idempotencyKey: body.idempotencyKey,
        },
      })
      if (!result) {
        return reply.status(404).send(errorPayload(
          'CONVERSATION_CONTENT_UNAVAILABLE',
          '该记录没有可删除的对话审计内容。',
          request.id,
        ))
      }
      return {
        meta: {
          source: 'database' as const,
          completedAt: result.deletedAt,
          notice: result.idempotent
            ? '已返回此前的删除结果。'
            : '已删除本地对话审计记录；删除证明仍保留。',
        },
        record: { id: result.id, requestId: result.requestId, state: 'deleted' as const },
        operation: {
          idempotencyKey: body.idempotencyKey,
          idempotent: result.idempotent,
          auditEventId: result.auditEventId,
        },
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') {
        return reply.status(409).send(errorPayload(
          'IDEMPOTENCY_KEY_REUSED',
          '该幂等编号已用于其他记录或操作。',
          request.id,
        ))
      }
      throw error
    }
  })

  app.get('/api/me/key', async (request) => employeePortalKeyResponse(request.authUser!.id, request.id))

  app.post('/api/me/key', async (request, reply) => {
    const body = parseInput(employeePortalKeyOperationSchema, request.body, request.id, reply)
    if (!body) return
    if (currentPlatformKey(request.authUser!.id)) {
      return reply.status(409).send(errorPayload('KEY_ALREADY_CREATED', '你已经创建过平台 Key；如需更换，请使用“重置 Key”。', request.id))
    }
    try {
      const issued = issuePlatformKey(request.authUser!.id, request.authUser!.id, request.id, body.idempotencyKey, 'create')
      return reply.status(201).send({
        ...employeePortalKeyResponse(request.authUser!.id, request.id),
        key: {
          id: issued.key.id,
          masked: issued.key.maskedValue,
          status: issued.key.status as 'active' | 'expiring',
          createdAt: issued.key.createdAt,
          lastUsedAt: issued.key.lastUsedAt,
        },
        secret: issued.secret,
      })
    } catch (error) {
      return personActionError(error, request.id, reply)
    }
  })

  app.post('/api/me/key/reset', async (request, reply) => {
    const body = parseInput(employeePortalKeyOperationSchema, request.body, request.id, reply)
    if (!body) return
    try {
      const issued = issuePlatformKey(request.authUser!.id, request.authUser!.id, request.id, body.idempotencyKey, 'reset')
      return {
        ...employeePortalKeyResponse(request.authUser!.id, request.id),
        key: {
          id: issued.key.id,
          masked: issued.key.maskedValue,
          status: issued.key.status as 'active' | 'expiring',
          createdAt: issued.key.createdAt,
          lastUsedAt: issued.key.lastUsedAt,
        },
        secret: issued.secret,
      }
    } catch (error) {
      return personActionError(error, request.id, reply)
    }
  })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.status(400).send(errorPayload('VALIDATION_ERROR', '请求参数不符合接口约定。', request.id))
    }
    app.log.error({ err: error, requestId: request.id }, 'Unhandled API error')
    return reply.status(500).send(errorPayload('INTERNAL_ERROR', '服务暂时不可用，请稍后重试。', request.id))
  })

  return app
}
