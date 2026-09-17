import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import Fastify, { LogController } from 'fastify'
import { createHash, randomBytes } from 'node:crypto'
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { createDatabaseOverview, overviewResponseSchema, periodSchema } from './overview.js'
import { newApiStatusSchema, probeNewApiFromEnvironment, type NewApiStatus } from './new-api-status.js'
import { newApiManagementResponseSchema, probeNewApiManagementFromEnvironment, type NewApiManagementResponse } from './new-api-management.js'
import { createPlatformStatus, createTaskSummary, platformStatusSchema, probeHttpService, taskSummarySchema, type PlatformProbeResult } from './platform.js'
import { createDatabasePeople, createDatabasePersonDetail, createDatabasePersonUsage, peopleQuerySchema, peopleResponseSchema, personCreateBodySchema, personCreateResponseSchema, personDetailResponseSchema, personDisableBodySchema, personDisableResponseSchema, personIdParamsSchema, personUsageQuerySchema, personUsageResponseSchema } from './people.js'
import { createDatabaseKeyDetail, createDatabaseKeys, createDemoKeyDetail, createDemoKeys, keyCreateBodySchema, keyCreateResponseSchema, keyDetailResponseSchema, keyDisableBodySchema, keyDisableResponseSchema, keyIdParamsSchema, keyRotateBodySchema, keyRotateResponseSchema, keysQuerySchema, keysResponseSchema } from './keys.js'
import { createDatabaseLimits, createDemoLimits, limitIdParamsSchema, limitsQuerySchema, limitsResponseSchema, quotaPolicySubject, quotaUpdateBodySchema, quotaUpdateResponseSchema } from './limits.js'
import { createDatabaseRoutes, routeIdParamsSchema, routePolicyUpdateBodySchema, routePolicyUpdateResponseSchema, routesQuerySchema, routesResponseSchema } from './routes.js'
import { channelCheckBodySchema, channelCheckResponseSchema, channelIdParamsSchema, channelsQuerySchema, channelsResponseSchema, createDatabaseDemoChannels, createDemoModels, modelsQuerySchema, modelsResponseSchema } from './models.js'
import { CatalogError, createModelCatalog, type CatalogReader } from './model-catalog.js'
import { createDemoUpstreams, upstreamsQuerySchema, upstreamsResponseSchema } from './upstreams.js'
import { createDatabaseUsage, createDatabaseUsageDetail, usageDetailResponseSchema, usageQuerySchema, usageRequestParamsSchema, usageResponseSchema } from './usage.js'
import { alertDetailResponseSchema, alertParamsSchema, alertRulesResponseSchema, alertsQuerySchema, alertsResponseSchema, alertSummaryResponseSchema, createDatabaseAlertDetail, createDatabaseAlertRules, createDatabaseAlerts, createDatabaseAlertSummary } from './alerts.js'
import { auditDetailResponseSchema, auditParamsSchema, auditQuerySchema, auditResponseSchema, createDatabaseAudit, createDatabaseAuditDetail, createDemoAudit, createDemoAuditDetail } from './audit.js'
import { conversationAccessBodySchema, conversationAccessHistoryResponseSchema, conversationAccessResponseSchema, conversationAuditParamsSchema, conversationAuditQuerySchema, conversationAuditResponseSchema, createDatabaseConversationAccess, createDatabaseConversationAccessHistory, createDatabaseConversationAudits, getDatabaseConversationAuditRecord } from './conversation-audit.js'
import { createSettings, settingsResponseSchema } from './settings.js'
import { createDatabaseEmployeeKeys, createDatabaseEmployeeProfile, createDatabaseEmployeeUsage, createDemoEmployeeModels, employeeKeysResponseSchema, employeeModelsResponseSchema, employeeProfileResponseSchema, employeeUsageQuerySchema, employeeUsageResponseSchema } from './employee.js'
import { authErrorSchema, authResponseSchema, createAuthService, isRoleAllowed, loginBodySchema, seedDemoUsers, type AppRole, type AuthService } from './auth.js'
import { dataScopeFor } from './data-scope.js'
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
    methods: ['GET', 'POST', 'PATCH'],
  })
  app.register(rateLimit, { max: 120, timeWindow: '1 minute' })

  const authMode = options.authMode ?? (process.env.AUTH_MODE === 'disabled' ? 'disabled' : 'required')
  const database = options.database ?? createPlatformDatabase({ filename: options.databasePath ?? process.env.PLATFORM_DB_PATH ?? (authMode === 'disabled' ? ':memory:' : undefined) })
  seedDemoUsers(database)
  seedDemoData(database)
  database.cleanupConversationAuditMetadata('startup')
  database.cleanupAuthSessions('startup')
  const auth = options.authService ?? createAuthService({ database })
  const catalog = createModelCatalog(options.catalogReader)
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
    if ((path === '/api/models' || path === '/api/channels') && source === 'new_api') return ['super_admin', 'admin']
    if (path.startsWith('/api/me')) return ['employee']
    if (path.startsWith('/api/conversation-audits')) return ['super_admin']
    if (path.startsWith('/api/integrations/new-api/management')) return ['super_admin', 'admin']
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
    if (path === '/health' || path === '/api/auth/login') return
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
      },
    },
  }, async (request) => {
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    return createDatabaseOverview(request.query.period, database, new Date(), newApi, dataScopeFor(request.authUser))
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
  }, async (request) => createTaskSummary(database, new Date(), dataScopeFor(request.authUser)))

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
    return createDatabasePeople(database, request.query, newApi, new Date(), dataScopeFor(request.authUser))
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

  app.post('/api/people/:id/disable', {
    schema: { params: personIdParamsSchema, body: personDisableBodySchema, response: { 200: personDisableResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema } },
  }, async (request, reply) => {
    const visible = createDatabasePersonDetail(database, request.params.id, await (options.probeNewApi ?? probeNewApiFromEnvironment)(), new Date(), dataScopeFor(request.authUser))
    if (!visible) return reply.status(404).send({ error: { code: 'PERSON_NOT_FOUND', message: '未找到指定人员', requestId: request.id } })
    const auditEventId = `audit-${request.body.idempotencyKey}`
    try {
      const result = database.disablePerson(request.params.id, {
        id: auditEventId, actorUserId: request.authUser?.id ?? null, action: 'disable', resourceType: 'person', resourceId: request.params.id,
        result: 'success', requestId: request.id,
        summary: {
          message: '已停用本地 SQLite 演示人员并回收其仍有效 Key；未调用 New API，未记录停用原因原文。', resourceName: visible.profile.name,
          reasonProvided: true, reasonLength: request.body.reason.length,
          changes: [
            { field: 'status', label: '人员状态', before: '在职', after: '停用', sensitive: false },
            { field: 'keys', label: '关联 Key', before: '仍有效', after: '已回收（数量见操作结果）', sensitive: false },
          ],
        },
      })
      if (!result) return reply.status(404).send({ error: { code: 'PERSON_NOT_FOUND', message: '未找到指定人员', requestId: request.id } })
      if (result.state === 'already_disabled') return reply.status(409).send({ error: { code: 'PERSON_ALREADY_DISABLED', message: '该人员已停用，请勿重复提交新的操作', requestId: request.id } })
      return { meta: { source: 'database' as const, completedAt: new Date().toISOString(), notice: '已停用本地 SQLite 演示人员并回收其仍有效 Key；该人员后续本地登录和会话访问会被拒绝。' }, person: { id: result.person.id, name: result.person.displayName, status: 'disabled' as const }, keysDisabled: result.keysDisabled, operation: { idempotencyKey: request.body.idempotencyKey, idempotent: result.idempotent, auditEventId } }
    } catch (error) {
      if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') return reply.status(409).send({ error: { code: 'IDEMPOTENCY_KEY_REUSED', message: '该幂等操作编号已用于另一名人员', requestId: request.id } })
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
    const result = createDatabasePersonDetail(database, request.params.id, newApi, new Date(), dataScopeFor(request.authUser))
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
    const result = createDatabasePersonUsage(database, request.params.id, request.query.period, newApi, new Date(), dataScopeFor(request.authUser))
    if (result) return result
    return reply.status(404).send({ error: { code: 'PERSON_NOT_FOUND', message: '未找到指定人员', requestId: request.id } })
  })

  app.get('/api/keys', {
    schema: { querystring: keysQuerySchema, response: { 200: keysResponseSchema, 400: errorResponseSchema } },
  }, async (request) => {
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    return createDatabaseKeys(database, request.query, newApi, new Date(), dataScopeFor(request.authUser))
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
    const result = createDatabaseKeyDetail(database, request.params.id, new Date(), dataScopeFor(request.authUser))
    if (result) return result
    return reply.status(404).send({ error: { code: 'KEY_NOT_FOUND', message: '未找到指定 Key', requestId: request.id } })
  })

  app.post('/api/keys/:id/disable', {
    schema: { params: keyIdParamsSchema, body: keyDisableBodySchema, response: { 200: keyDisableResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema } },
  }, async (request, reply) => {
    const visible = createDatabaseKeyDetail(database, request.params.id, new Date(), dataScopeFor(request.authUser))
    if (!visible) return reply.status(404).send({ error: { code: 'KEY_NOT_FOUND', message: '未找到指定 Key', requestId: request.id } })
    const auditEventId = `audit-${request.body.idempotencyKey}`
    try {
      const result = database.disableApiKey(request.params.id, {
        id: auditEventId, actorUserId: request.authUser?.id ?? null, action: 'disable', resourceType: 'key', resourceId: request.params.id,
        result: 'success', requestId: request.id,
        summary: {
          message: '已停用本地 SQLite 演示 Key；未调用 New API，未记录完整 Key 或停用原因原文。', resourceName: visible.key.masked,
          reasonProvided: true, reasonLength: request.body.reason.length,
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

  app.post('/api/keys/:id/rotate', {
    schema: { params: keyIdParamsSchema, body: keyRotateBodySchema, response: { 200: keyRotateResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema } },
  }, async (request, reply) => {
    const visible = createDatabaseKeyDetail(database, request.params.id, new Date(), dataScopeFor(request.authUser))
    if (!visible) return reply.status(404).send({ error: { code: 'KEY_NOT_FOUND', message: '未找到指定 Key', requestId: request.id } })
    const digest = createHash('sha256').update(request.body.idempotencyKey).digest('hex')
    const rotationId = `key-${visible.key.owner.id.replace(/^person-/, '')}-rotate-${digest.slice(0, 11)}-${Number.parseInt(digest.slice(11, 12), 16) % 10}`
    const idempotencyFingerprint = createHash('sha256').update(`${request.params.id}:${request.body.expiresInDays}`).digest('hex')
    const secret = `sk-ops-${randomBytes(24).toString('base64url')}`
    const expiresAt = new Date(Date.now() + request.body.expiresInDays * 86_400_000).toISOString()
    const auditEventId = `audit-${request.body.idempotencyKey}`
    try {
      const result = database.rotateApiKey(request.params.id, {
        id: rotationId, ownerUserId: visible.key.owner.id, maskedValue: `sk-ops••••••${secret.slice(-4).toUpperCase()}`,
        purpose: visible.key.purpose, expiresAt, models: visible.key.models,
      }, {
        id: auditEventId, actorUserId: request.authUser?.id ?? null, action: 'rotate', resourceType: 'key', resourceId: request.params.id,
        result: 'success', requestId: request.id,
        summary: {
          message: '已轮换本地 SQLite 演示 Key；旧 Key 已停用，未调用 New API，未记录完整 Key 或轮换原因原文。', resourceName: visible.key.masked,
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
        key: { id: result.newKey.id, masked: result.newKey.maskedValue, owner: { id: result.newKey.ownerUserId, name: result.newKey.ownerName, department: result.newKey.departmentName }, purpose: result.newKey.purpose, models: result.newKey.models, expiresAt: result.newKey.expiresAt },
        secret: result.idempotent ? null : secret,
        operation: { idempotencyKey: request.body.idempotencyKey, idempotent: result.idempotent, auditEventId },
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') return reply.status(409).send({ error: { code: 'IDEMPOTENCY_KEY_REUSED', message: '该幂等操作编号已用于另一条 Key', requestId: request.id } })
      if (error instanceof Error && /UNIQUE constraint failed: api_keys\.id/i.test(error.message)) return reply.status(409).send({ error: { code: 'KEY_ID_CONFLICT', message: 'Key 编号冲突，请使用新的操作编号重试', requestId: request.id } })
      throw error
    }
  })

  app.get('/api/limits', {
    schema: { querystring: limitsQuerySchema, response: { 200: limitsResponseSchema, 400: errorResponseSchema } },
  }, async (request) => {
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    return createDatabaseLimits(database, request.query, newApi, new Date(), dataScopeFor(request.authUser))
  })

  app.patch('/api/limits/:id', {
    schema: { params: limitIdParamsSchema, body: quotaUpdateBodySchema, response: { 200: quotaUpdateResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema } },
  }, async (request, reply) => {
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

  app.get('/api/routes', {
    schema: { querystring: routesQuerySchema, response: { 200: routesResponseSchema, 400: errorResponseSchema } },
  }, async (request) => {
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    return createDatabaseRoutes(database, request.query, newApi)
  })

  app.patch('/api/routes/:id', {
    schema: { params: routeIdParamsSchema, body: routePolicyUpdateBodySchema, response: { 200: routePolicyUpdateResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema } },
  }, async (request, reply) => {
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
    return createDatabaseDemoChannels(database, request.query, newApi)
  })

  app.post('/api/channels/:id/check', {
    schema: { params: channelIdParamsSchema, body: channelCheckBodySchema, response: { 200: channelCheckResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema } },
  }, async (request, reply) => {
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
    return createDatabaseUsage(database, request.query, newApi, new Date(), dataScopeFor(request.authUser))
  })

  app.get('/api/usage/:requestId', {
    schema: { params: usageRequestParamsSchema, response: { 200: usageDetailResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema } },
  }, async (request, reply) => {
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    const result = createDatabaseUsageDetail(database, request.params.requestId, newApi, new Date(), dataScopeFor(request.authUser), authMode === 'disabled' || request.authUser?.role === 'super_admin')
    if (result) return result
    return reply.status(404).send({ error: { code: 'USAGE_NOT_FOUND', message: '未找到指定调用记录', requestId: request.id } })
  })

  app.get('/api/alerts/summary', {
    schema: { response: { 200: alertSummaryResponseSchema } },
  }, async (request) => createDatabaseAlertSummary(database, await (options.probeNewApi ?? probeNewApiFromEnvironment)(), new Date(), dataScopeFor(request.authUser)))

  app.get('/api/alerts', {
    schema: { querystring: alertsQuerySchema, response: { 200: alertsResponseSchema, 400: errorResponseSchema } },
  }, async (request) => createDatabaseAlerts(database, request.query, await (options.probeNewApi ?? probeNewApiFromEnvironment)(), new Date(), dataScopeFor(request.authUser)))

  app.get('/api/alert-rules', {
    schema: { response: { 200: alertRulesResponseSchema } },
  }, async (request) => createDatabaseAlertRules(database, await (options.probeNewApi ?? probeNewApiFromEnvironment)(), new Date(), dataScopeFor(request.authUser)))

  app.get('/api/alerts/:id', {
    schema: { params: alertParamsSchema, response: { 200: alertDetailResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema } },
  }, async (request, reply) => {
    const result = createDatabaseAlertDetail(database, request.params.id, await (options.probeNewApi ?? probeNewApiFromEnvironment)(), new Date(), dataScopeFor(request.authUser))
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
    const actorUserId = request.authUser?.id ?? 'user-super-admin'
    const accessEvent = database.recordConversationAccess({
      id: `access-demo-${crypto.randomUUID()}`,
      actorUserId,
      recordId: record.id,
      requestId: record.requestId,
      action: 'view_synthetic',
      reasonProvided: true,
      reasonLength: request.body.reason.length,
      acknowledgedSensitiveScope: request.body.acknowledgeSensitiveScope,
    }, now, {
      id: `audit-conversation-${crypto.randomUUID()}`,
      actorUserId,
      action: 'view',
      resourceType: 'conversation',
      resourceId: record.id,
      result: 'success',
      requestId: request.id,
      summary: {
        code: 'CONVERSATION_ACCESS_RECORDED',
        message: '已查看预先脱敏的合成对话轮次；查看原因原文不保存。',
        resourceName: '预先脱敏合成轮次',
        changes: [
          { field: 'reason', label: '查看原因', before: null, after: '已提供（不记录原文）', sensitive: true },
          { field: 'acknowledgedSensitiveScope', label: '敏感范围确认', before: null, after: '已确认', sensitive: false },
          { field: 'contentMode', label: '内容模式', before: null, after: '合成且预先脱敏', sensitive: false },
        ],
      },
    })
    const result = createDatabaseConversationAccess(database, record, request.body, now, { id: accessEvent.id, persisted: true })
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
