import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import Fastify, { LogController } from 'fastify'
import { randomBytes } from 'node:crypto'
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { createDatabaseOverview, overviewResponseSchema, periodSchema } from './overview.js'
import { newApiStatusSchema, probeNewApiFromEnvironment, type NewApiStatus } from './new-api-status.js'
import { newApiManagementResponseSchema, probeNewApiManagementFromEnvironment, type NewApiManagementResponse } from './new-api-management.js'
import { createPlatformStatus, createTaskSummary, platformStatusSchema, probeHttpService, taskSummarySchema, type PlatformProbeResult } from './platform.js'
import { createDatabasePeople, createDatabasePersonDetail, createDatabasePersonUsage, peopleQuerySchema, peopleResponseSchema, personCreateBodySchema, personCreateResponseSchema, personDetailResponseSchema, personIdParamsSchema, personUsageQuerySchema, personUsageResponseSchema } from './people.js'
import { createDatabaseKeyDetail, createDatabaseKeys, createDemoKeyDetail, createDemoKeys, keyCreateBodySchema, keyCreateResponseSchema, keyDetailResponseSchema, keyIdParamsSchema, keysQuerySchema, keysResponseSchema } from './keys.js'
import { createDatabaseLimits, createDemoLimits, limitsQuerySchema, limitsResponseSchema } from './limits.js'
import { createDemoRoutes, routesQuerySchema, routesResponseSchema } from './routes.js'
import { channelsQuerySchema, channelsResponseSchema, createDemoChannels, createDemoModels, modelsQuerySchema, modelsResponseSchema } from './models.js'
import { CatalogError, createModelCatalog, type CatalogReader } from './model-catalog.js'
import { createDemoUpstreams, upstreamsQuerySchema, upstreamsResponseSchema } from './upstreams.js'
import { createDatabaseUsage, createDatabaseUsageDetail, usageDetailResponseSchema, usageQuerySchema, usageRequestParamsSchema, usageResponseSchema } from './usage.js'
import { alertDetailResponseSchema, alertParamsSchema, alertRulesResponseSchema, alertsQuerySchema, alertsResponseSchema, alertSummaryResponseSchema, createDatabaseAlertDetail, createDatabaseAlertRules, createDatabaseAlerts, createDatabaseAlertSummary } from './alerts.js'
import { auditDetailResponseSchema, auditParamsSchema, auditQuerySchema, auditResponseSchema, createDatabaseAudit, createDatabaseAuditDetail, createDemoAudit, createDemoAuditDetail } from './audit.js'
import { conversationAccessBodySchema, conversationAccessResponseSchema, conversationAuditParamsSchema, conversationAuditQuerySchema, conversationAuditResponseSchema, createDemoConversationAccess, createDemoConversationAudits, getDemoConversationAuditRecord } from './conversation-audit.js'
import { createSettings, settingsResponseSchema } from './settings.js'
import { createDatabaseEmployeeKeys, createDatabaseEmployeeProfile, createDatabaseEmployeeUsage, createDemoEmployeeModels, employeeKeysResponseSchema, employeeModelsResponseSchema, employeeProfileResponseSchema, employeeUsageQuerySchema, employeeUsageResponseSchema } from './employee.js'
import { authErrorSchema, authResponseSchema, createAuthService, isRoleAllowed, loginBodySchema, seedDemoUsers, type AppRole, type AuthService } from './auth.js'
import { createPlatformDatabase, databaseStatusSchema, seedDemoData, type PlatformDatabase } from './platform-db.js'

const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
})

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
    methods: ['GET', 'POST'],
  })
  app.register(rateLimit, { max: 120, timeWindow: '1 minute' })

  const authMode = options.authMode ?? (process.env.AUTH_MODE === 'disabled' ? 'disabled' : 'required')
  const database = options.database ?? createPlatformDatabase({ filename: options.databasePath ?? process.env.PLATFORM_DB_PATH ?? (authMode === 'disabled' ? ':memory:' : undefined) })
  seedDemoUsers(database)
  seedDemoData(database)
  const auth = options.authService ?? createAuthService({ database })
  const catalog = createModelCatalog(options.catalogReader)
  if (!options.database) app.addHook('onClose', async () => database.close())

  const requiredRoles = (path: string, method: string, source?: string): readonly AppRole[] => {
    if ((path === '/api/models' || path === '/api/channels') && source === 'new_api') return ['super_admin', 'admin']
    if (path.startsWith('/api/me')) return ['employee']
    if (path.startsWith('/api/conversation-audits')) return ['super_admin']
    if (path.startsWith('/api/integrations/new-api/management')) return ['super_admin', 'admin']
    if (path.startsWith('/api/audit-events') || path.startsWith('/api/settings') || path.startsWith('/api/upstreams') || path.startsWith('/api/routes')) return ['super_admin', 'admin']
    if (path.startsWith('/api/people') && method !== 'GET') return ['super_admin', 'admin']
    if (path.startsWith('/api/keys') && method !== 'GET') return ['super_admin', 'admin']
    if (path.startsWith('/api/people') || path.startsWith('/api/keys') || path.startsWith('/api/models') || path.startsWith('/api/channels')) return ['super_admin', 'admin', 'department_lead']
    return ['super_admin', 'admin', 'department_lead', 'finance']
  }

  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '/'
    if (path === '/health' || path.startsWith('/api/auth/')) return
    if (authMode === 'disabled') return
    const user = auth.authenticate(request)
    if (!user) {
      return reply.status(401).send({ error: { code: 'AUTH_REQUIRED', message: '请先登录后再访问该资源', requestId: request.id } })
    }
    request.authUser = user
    if (!isRoleAllowed(user, requiredRoles(path, request.method, (request.query as { source?: string })?.source))) {
      return reply.status(403).send({ error: { code: 'AUTH_FORBIDDEN', message: '当前身份没有访问该资源的权限', requestId: request.id } })
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
      return reply.status(401).send({ error: { code: 'AUTH_INVALID', message: '用户名或密码不正确', requestId: request.id } })
    }
    auth.setSessionCookie(reply, session.token, session.expiresAt)
    return { authenticated: true as const, user: session.user, expiresAt: session.expiresAt }
  })

  app.get('/api/auth/me', {
    schema: { response: { 200: authResponseSchema, 401: authErrorSchema } },
  }, async (request, reply) => {
    const user = auth.authenticate(request)
    if (!user) return reply.status(401).send({ error: { code: 'AUTH_REQUIRED', message: '当前会话已失效，请重新登录', requestId: request.id } })
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
    return { authenticated: true as const, user, expiresAt }
  })

  app.post('/api/auth/logout', {
  }, async (request, reply) => {
    auth.revoke(request)
    auth.clearSessionCookie(reply)
    return reply.status(204).send()
  })

  app.get('/api/overview', {
    schema: {
      querystring: z.object({ period: periodSchema.default('7d') }),
      response: {
        200: overviewResponseSchema,
        400: errorResponseSchema,
      },
    },
  }, async (request) => {
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    return createDatabaseOverview(request.query.period, database, new Date(), newApi)
  })

  app.get('/api/integrations/new-api/status', {
    schema: { response: { 200: newApiStatusSchema } },
  }, async () => (options.probeNewApi ?? probeNewApiFromEnvironment)())

  app.get('/api/integrations/new-api/management', {
    schema: { response: { 200: newApiManagementResponseSchema } },
  }, async () => (options.probeNewApiManagement ?? probeNewApiManagementFromEnvironment)())

  app.get('/api/platform/status', {
    schema: { response: { 200: platformStatusSchema } },
  }, async () => {
    const cpaUrl = process.env.CPA_BASE_URL ?? 'http://127.0.0.1:8317/management.html'
    const [newApi, cpa] = await Promise.all([
      (options.probeNewApi ?? probeNewApiFromEnvironment)(),
      (options.probeCpa ?? (() => probeHttpService(cpaUrl)))(),
    ])
    return createPlatformStatus({
      newApi,
      cpa,
      newApiUrl: process.env.NEW_API_BASE_URL,
      cpaUrl,
    })
  })

  app.get('/api/tasks/summary', {
    schema: { response: { 200: taskSummarySchema } },
  }, async () => createTaskSummary(database))

  app.get('/api/people', {
    schema: {
      querystring: peopleQuerySchema,
      response: {
        200: peopleResponseSchema,
        400: errorResponseSchema,
      },
    },
  }, async (request) => {
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    return createDatabasePeople(database, request.query, newApi)
  })

  app.post('/api/people', {
    schema: {
      body: personCreateBodySchema,
      response: { 201: personCreateResponseSchema, 400: errorResponseSchema, 409: errorResponseSchema },
    },
  }, async (request, reply) => {
    if (!database.departmentExists(request.body.departmentId)) {
      return reply.status(400).send({ error: { code: 'DEPARTMENT_NOT_FOUND', message: '请选择有效的在用部门', requestId: request.id } })
    }
    const id = `person-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
    try {
      const created = database.createPerson({ id, username: request.body.username, displayName: request.body.displayName, departmentId: request.body.departmentId, password: request.body.password }, {
        id: `audit-${id}-create`,
        actorUserId: request.authUser?.id ?? null,
        action: 'create',
        resourceType: 'person',
        resourceId: id,
        result: 'success',
        requestId: request.id,
        summary: {
          message: `已添加本地演示人员 ${request.body.displayName}；初始密码仅保存摘要。`,
          resourceName: request.body.displayName,
          changes: [
            { field: 'username', label: '登录名', before: null, after: request.body.username, sensitive: false },
            { field: 'departmentId', label: '所属部门', before: null, after: request.body.departmentId, sensitive: false },
            { field: 'password', label: '初始密码', before: null, after: '已设置（不记录值）', sensitive: true },
          ],
        },
      })
      if (!created || !created.departmentId || !created.departmentName) throw new Error('PERSON_CREATE_FAILED')
      return reply.status(201).send({ meta: { source: 'database' as const, createdAt: new Date().toISOString(), notice: '人员已写入本地 SQLite；职位、用途和真实 New API 映射将在后续接入' }, person: { id: created.id, username: created.username, displayName: created.displayName, department: { id: created.departmentId, name: created.departmentName } } })
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: users\.username/i.test(error.message)) {
        return reply.status(409).send({ error: { code: 'USERNAME_CONFLICT', message: '用户名已存在，请更换后重试', requestId: request.id } })
      }
      throw error
    }
  })

  app.get('/api/people/:id', {
    schema: {
      params: personIdParamsSchema,
      response: { 200: personDetailResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema },
    },
  }, async (request, reply) => {
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    const result = createDatabasePersonDetail(database, request.params.id, newApi)
    if (result) return result
    return reply.status(404).send({ error: { code: 'PERSON_NOT_FOUND', message: '未找到指定人员', requestId: request.id } })
  })

  app.get('/api/people/:id/usage', {
    schema: {
      params: personIdParamsSchema,
      querystring: personUsageQuerySchema,
      response: { 200: personUsageResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema },
    },
  }, async (request, reply) => {
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    const result = createDatabasePersonUsage(database, request.params.id, request.query.period, newApi)
    if (result) return result
    return reply.status(404).send({ error: { code: 'PERSON_NOT_FOUND', message: '未找到指定人员', requestId: request.id } })
  })

  app.get('/api/keys', {
    schema: { querystring: keysQuerySchema, response: { 200: keysResponseSchema, 400: errorResponseSchema } },
  }, async (request) => {
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    return createDatabaseKeys(database, request.query, newApi)
  })

  app.post('/api/keys', {
    schema: {
      body: keyCreateBodySchema,
      response: { 201: keyCreateResponseSchema, 400: errorResponseSchema, 409: errorResponseSchema },
    },
  }, async (request, reply) => {
    if (!database.ownerExists(request.body.ownerId)) {
      return reply.status(400).send({ error: { code: 'KEY_OWNER_NOT_FOUND', message: '请选择有效的在职人员', requestId: request.id } })
    }
    const secret = `sk-ops-${randomBytes(24).toString('base64url')}`
    const id = `key-${request.body.ownerId.replace(/^person-/, '')}-${Date.now()}`
    const expiresAt = new Date(Date.now() + request.body.expiresInDays * 86_400_000).toISOString()
    const masked = `sk-ops••••••${secret.slice(-4).toUpperCase()}`
    try {
      const created = database.createApiKey({ id, ownerUserId: request.body.ownerId, maskedValue: masked, purpose: request.body.purpose, expiresAt, models: request.body.models }, {
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
            { field: 'models', label: '允许模型', before: null, after: request.body.models.join('、'), sensitive: false },
          ],
        },
      })
      if (!created || !created.departmentName || !created.expiresAt) throw new Error('KEY_CREATE_FAILED')
      return reply.status(201).send({
        meta: { source: 'database' as const, createdAt: created.createdAt, notice: '完整 Key 仅在本次响应中展示一次；数据库只保存掩码标识。' },
        key: { id: created.id, masked: created.maskedValue, owner: { id: created.ownerUserId, name: created.ownerName, department: created.departmentName }, purpose: created.purpose, models: created.models, expiresAt: created.expiresAt },
        secret,
      })
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: api_keys\.id/i.test(error.message)) {
        return reply.status(409).send({ error: { code: 'KEY_ID_CONFLICT', message: 'Key 编号冲突，请重试', requestId: request.id } })
      }
      throw error
    }
  })

  app.get('/api/keys/:id', {
    schema: { params: keyIdParamsSchema, response: { 200: keyDetailResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema } },
  }, async (request, reply) => {
    const result = createDatabaseKeyDetail(database, request.params.id)
    if (result) return result
    return reply.status(404).send({ error: { code: 'KEY_NOT_FOUND', message: '未找到指定 Key', requestId: request.id } })
  })

  app.get('/api/limits', {
    schema: { querystring: limitsQuerySchema, response: { 200: limitsResponseSchema, 400: errorResponseSchema } },
  }, async (request) => {
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    return createDatabaseLimits(database, request.query, newApi)
  })

  app.get('/api/routes', {
    schema: { querystring: routesQuerySchema, response: { 200: routesResponseSchema, 400: errorResponseSchema } },
  }, async (request) => {
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    return createDemoRoutes(request.query, newApi)
  })

  app.get('/api/models', {
    schema: { querystring: modelsQuerySchema, response: { 200: modelsResponseSchema, 400: errorResponseSchema, 502: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    if (request.query.source === 'new_api') {
      try { return await catalog.models(request.query) } catch (error) {
        if (!(error instanceof CatalogError)) throw error
        return reply.status(error.code === 'NEW_API_AUTH_REQUIRED' ? 503 : 502).send({ error: { code: error.code, message: error.message, requestId: request.id } })
      }
    }
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    return createDemoModels(request.query, newApi)
  })

  app.get('/api/channels', {
    schema: { querystring: channelsQuerySchema, response: { 200: channelsResponseSchema, 400: errorResponseSchema, 502: errorResponseSchema, 503: errorResponseSchema } },
  }, async (request, reply) => {
    if (request.query.source === 'new_api') {
      try { return await catalog.channels(request.query) } catch (error) {
        if (!(error instanceof CatalogError)) throw error
        return reply.status(error.code === 'NEW_API_AUTH_REQUIRED' ? 503 : 502).send({ error: { code: error.code, message: error.message, requestId: request.id } })
      }
    }
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    return createDemoChannels(request.query, newApi)
  })

  app.get('/api/upstreams', {
    schema: { querystring: upstreamsQuerySchema, response: { 200: upstreamsResponseSchema, 400: errorResponseSchema } },
  }, async (request) => {
    const cpaUrl = process.env.CPA_BASE_URL ?? 'http://127.0.0.1:8317/management.html'
    const [newApi, cpa] = await Promise.all([
      (options.probeNewApi ?? probeNewApiFromEnvironment)(),
      (options.probeCpa ?? (() => probeHttpService(cpaUrl)))(),
    ])
    return createDemoUpstreams(request.query, newApi, cpa)
  })

  app.get('/api/usage', {
    schema: { querystring: usageQuerySchema, response: { 200: usageResponseSchema, 400: errorResponseSchema } },
  }, async (request) => {
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    return createDatabaseUsage(database, request.query, newApi)
  })

  app.get('/api/usage/:requestId', {
    schema: { params: usageRequestParamsSchema, response: { 200: usageDetailResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema } },
  }, async (request, reply) => {
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    const result = createDatabaseUsageDetail(database, request.params.requestId, newApi)
    if (result) return result
    return reply.status(404).send({ error: { code: 'USAGE_NOT_FOUND', message: '未找到指定调用记录', requestId: request.id } })
  })

  app.get('/api/alerts/summary', {
    schema: { response: { 200: alertSummaryResponseSchema } },
  }, async () => createDatabaseAlertSummary(database, await (options.probeNewApi ?? probeNewApiFromEnvironment)()))

  app.get('/api/alerts', {
    schema: { querystring: alertsQuerySchema, response: { 200: alertsResponseSchema, 400: errorResponseSchema } },
  }, async (request) => createDatabaseAlerts(database, request.query, await (options.probeNewApi ?? probeNewApiFromEnvironment)()))

  app.get('/api/alert-rules', {
    schema: { response: { 200: alertRulesResponseSchema } },
  }, async () => createDatabaseAlertRules(database, await (options.probeNewApi ?? probeNewApiFromEnvironment)()))

  app.get('/api/alerts/:id', {
    schema: { params: alertParamsSchema, response: { 200: alertDetailResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema } },
  }, async (request, reply) => {
    const result = createDatabaseAlertDetail(database, request.params.id, await (options.probeNewApi ?? probeNewApiFromEnvironment)())
    if (result) return result
    return reply.status(404).send({ error: { code: 'ALERT_NOT_FOUND', message: '未找到指定告警事件', requestId: request.id } })
  })

  app.get('/api/audit-events', {
    schema: { querystring: auditQuerySchema, response: { 200: auditResponseSchema, 400: errorResponseSchema } },
  }, async (request) => createDatabaseAudit(database, request.query))

  app.get('/api/audit-events/:id', {
    schema: { params: auditParamsSchema, response: { 200: auditDetailResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema } },
  }, async (request, reply) => {
    const result = createDatabaseAuditDetail(database, request.params.id)
    if (result) return result
    return reply.status(404).send({ error: { code: 'AUDIT_EVENT_NOT_FOUND', message: '未找到指定审计事件', requestId: request.id } })
  })

  app.get('/api/conversation-audits', {
    schema: { querystring: conversationAuditQuerySchema, response: { 200: conversationAuditResponseSchema, 400: errorResponseSchema } },
  }, async (request) => createDemoConversationAudits(request.query, new Date(), request.authUser?.role ?? 'super_admin', true))

  app.post('/api/conversation-audits/:id/access', {
    schema: { params: conversationAuditParamsSchema, body: conversationAccessBodySchema, response: { 200: conversationAccessResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema } },
  }, async (request, reply) => {
    const now = new Date()
    const record = getDemoConversationAuditRecord(request.params.id, now)
    if (!record || !record.contentAccess.available) return reply.status(404).send({ error: { code: 'CONVERSATION_CONTENT_UNAVAILABLE', message: '该记录没有可访问的对话内容', requestId: request.id } })
    const accessEvent = database.recordConversationAccess({
      id: `access-demo-${crypto.randomUUID()}`,
      actorUserId: request.authUser?.id ?? 'user-super-admin',
      recordId: record.id,
      requestId: record.requestId,
      action: 'view_synthetic',
      reasonProvided: true,
      reasonLength: request.body.reason.length,
      acknowledgedSensitiveScope: request.body.acknowledgeSensitiveScope,
    }, now)
    const result = createDemoConversationAccess(request.params.id, request.body, now, { id: accessEvent.id, persisted: true })
    if (result) return result
    return reply.status(404).send({ error: { code: 'CONVERSATION_CONTENT_UNAVAILABLE', message: '该记录没有可访问的对话内容', requestId: request.id } })
  })

  app.get('/api/settings', {
    schema: { response: { 200: settingsResponseSchema } },
  }, async (request) => {
    const cpaUrl = process.env.CPA_BASE_URL ?? 'http://127.0.0.1:8317/management.html'
    const docsUrl = process.env.DOCS_BASE_URL ?? 'http://127.0.0.1:4173'
    const [newApi, cpa, docs] = await Promise.all([
      (options.probeNewApi ?? probeNewApiFromEnvironment)(),
      (options.probeCpa ?? (() => probeHttpService(cpaUrl)))(),
      (options.probeDocs ?? (() => probeHttpService(docsUrl)))(),
    ])
    return createSettings(newApi, cpa, docs, database, new Date(), request.authUser?.role ?? 'super_admin')
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

  app.setErrorHandler((error, request, reply) => {
    const isValidationError = typeof error === 'object' && error !== null && 'validation' in error
    const statusCode = isValidationError ? 400 : 500
    request.log.error({ err: error, requestId: request.id }, 'request failed')
    return reply.status(statusCode).send({
      error: {
        code: isValidationError ? 'INVALID_REQUEST' : 'INTERNAL_ERROR',
        message: isValidationError ? '请求参数不符合接口约定' : '服务暂时不可用',
        requestId: request.id,
      },
    })
  })

  return app
}
