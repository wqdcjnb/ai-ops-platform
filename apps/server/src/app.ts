import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import Fastify, { LogController } from 'fastify'
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { createDemoOverview, overviewResponseSchema, periodSchema } from './overview.js'
import { newApiStatusSchema, probeNewApiFromEnvironment, type NewApiStatus } from './new-api-status.js'
import { createPlatformStatus, createTaskSummary, platformStatusSchema, probeHttpService, taskSummarySchema, type PlatformProbeResult } from './platform.js'
import { createDemoPeople, createDemoPersonDetail, createDemoPersonUsage, peopleQuerySchema, peopleResponseSchema, personDetailResponseSchema, personIdParamsSchema, personUsageQuerySchema, personUsageResponseSchema } from './people.js'
import { createDemoKeyDetail, createDemoKeys, keyDetailResponseSchema, keyIdParamsSchema, keysQuerySchema, keysResponseSchema } from './keys.js'
import { createDemoLimits, limitsQuerySchema, limitsResponseSchema } from './limits.js'
import { createDemoRoutes, routesQuerySchema, routesResponseSchema } from './routes.js'
import { channelsQuerySchema, channelsResponseSchema, createDemoChannels, createDemoModels, modelsQuerySchema, modelsResponseSchema } from './models.js'
import { createDemoUpstreams, upstreamsQuerySchema, upstreamsResponseSchema } from './upstreams.js'
import { createDemoUsage, createDemoUsageDetail, usageDetailResponseSchema, usageQuerySchema, usageRequestParamsSchema, usageResponseSchema } from './usage.js'
import { alertDetailResponseSchema, alertParamsSchema, alertRulesResponseSchema, alertsQuerySchema, alertsResponseSchema, alertSummaryResponseSchema, createDemoAlertDetail, createDemoAlertRules, createDemoAlerts, createDemoAlertSummary } from './alerts.js'
import { auditDetailResponseSchema, auditParamsSchema, auditQuerySchema, auditResponseSchema, createDemoAudit, createDemoAuditDetail } from './audit.js'
import { conversationAccessBodySchema, conversationAccessResponseSchema, conversationAuditParamsSchema, conversationAuditQuerySchema, conversationAuditResponseSchema, createDemoConversationAccess, createDemoConversationAudits } from './conversation-audit.js'
import { createSettings, settingsResponseSchema } from './settings.js'
import { createDemoEmployeeKeys, createDemoEmployeeModels, createDemoEmployeeProfile, createDemoEmployeeUsage, employeeKeysResponseSchema, employeeModelsResponseSchema, employeeProfileResponseSchema, employeeUsageQuerySchema, employeeUsageResponseSchema } from './employee.js'
import { authErrorSchema, authResponseSchema, createAuthService, isRoleAllowed, loginBodySchema, type AppRole, type AuthService } from './auth.js'

const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
})

export interface BuildAppOptions {
  logger?: boolean
  authMode?: 'required' | 'disabled'
  authService?: AuthService
  probeNewApi?: () => Promise<NewApiStatus>
  probeCpa?: () => Promise<PlatformProbeResult>
  probeDocs?: () => Promise<PlatformProbeResult>
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    genReqId: () => crypto.randomUUID(),
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
  const auth = options.authService ?? createAuthService()

  const requiredRoles = (path: string): readonly AppRole[] => {
    if (path.startsWith('/api/me')) return ['employee']
    if (path.startsWith('/api/conversation-audits')) return ['super_admin']
    if (path.startsWith('/api/audit-events') || path.startsWith('/api/settings') || path.startsWith('/api/upstreams') || path.startsWith('/api/routes')) return ['super_admin', 'admin']
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
    if (!isRoleAllowed(user, requiredRoles(path))) {
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
    return createDemoOverview(request.query.period, new Date(), newApi)
  })

  app.get('/api/integrations/new-api/status', {
    schema: { response: { 200: newApiStatusSchema } },
  }, async () => (options.probeNewApi ?? probeNewApiFromEnvironment)())

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
  }, async () => createTaskSummary())

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
    return createDemoPeople(request.query, newApi)
  })

  app.get('/api/people/:id', {
    schema: {
      params: personIdParamsSchema,
      response: { 200: personDetailResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema },
    },
  }, async (request, reply) => {
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    const result = createDemoPersonDetail(request.params.id, newApi)
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
    const result = createDemoPersonUsage(request.params.id, request.query.period, newApi)
    if (result) return result
    return reply.status(404).send({ error: { code: 'PERSON_NOT_FOUND', message: '未找到指定人员', requestId: request.id } })
  })

  app.get('/api/keys', {
    schema: { querystring: keysQuerySchema, response: { 200: keysResponseSchema, 400: errorResponseSchema } },
  }, async (request) => {
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    return createDemoKeys(request.query, newApi)
  })

  app.get('/api/keys/:id', {
    schema: { params: keyIdParamsSchema, response: { 200: keyDetailResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema } },
  }, async (request, reply) => {
    const result = createDemoKeyDetail(request.params.id)
    if (result) return result
    return reply.status(404).send({ error: { code: 'KEY_NOT_FOUND', message: '未找到指定 Key', requestId: request.id } })
  })

  app.get('/api/limits', {
    schema: { querystring: limitsQuerySchema, response: { 200: limitsResponseSchema, 400: errorResponseSchema } },
  }, async (request) => {
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    return createDemoLimits(request.query, newApi)
  })

  app.get('/api/routes', {
    schema: { querystring: routesQuerySchema, response: { 200: routesResponseSchema, 400: errorResponseSchema } },
  }, async (request) => {
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    return createDemoRoutes(request.query, newApi)
  })

  app.get('/api/models', {
    schema: { querystring: modelsQuerySchema, response: { 200: modelsResponseSchema, 400: errorResponseSchema } },
  }, async (request) => {
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    return createDemoModels(request.query, newApi)
  })

  app.get('/api/channels', {
    schema: { querystring: channelsQuerySchema, response: { 200: channelsResponseSchema, 400: errorResponseSchema } },
  }, async (request) => {
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
    return createDemoUsage(request.query, newApi)
  })

  app.get('/api/usage/:requestId', {
    schema: { params: usageRequestParamsSchema, response: { 200: usageDetailResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema } },
  }, async (request, reply) => {
    const newApi = await (options.probeNewApi ?? probeNewApiFromEnvironment)()
    const result = createDemoUsageDetail(request.params.requestId, newApi)
    if (result) return result
    return reply.status(404).send({ error: { code: 'USAGE_NOT_FOUND', message: '未找到指定调用记录', requestId: request.id } })
  })

  app.get('/api/alerts/summary', {
    schema: { response: { 200: alertSummaryResponseSchema } },
  }, async () => createDemoAlertSummary(await (options.probeNewApi ?? probeNewApiFromEnvironment)()))

  app.get('/api/alerts', {
    schema: { querystring: alertsQuerySchema, response: { 200: alertsResponseSchema, 400: errorResponseSchema } },
  }, async (request) => createDemoAlerts(request.query, await (options.probeNewApi ?? probeNewApiFromEnvironment)()))

  app.get('/api/alert-rules', {
    schema: { response: { 200: alertRulesResponseSchema } },
  }, async () => createDemoAlertRules(await (options.probeNewApi ?? probeNewApiFromEnvironment)()))

  app.get('/api/alerts/:id', {
    schema: { params: alertParamsSchema, response: { 200: alertDetailResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema } },
  }, async (request, reply) => {
    const result = createDemoAlertDetail(request.params.id, await (options.probeNewApi ?? probeNewApiFromEnvironment)())
    if (result) return result
    return reply.status(404).send({ error: { code: 'ALERT_NOT_FOUND', message: '未找到指定告警事件', requestId: request.id } })
  })

  app.get('/api/audit-events', {
    schema: { querystring: auditQuerySchema, response: { 200: auditResponseSchema, 400: errorResponseSchema } },
  }, async (request) => createDemoAudit(request.query))

  app.get('/api/audit-events/:id', {
    schema: { params: auditParamsSchema, response: { 200: auditDetailResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema } },
  }, async (request, reply) => {
    const result = createDemoAuditDetail(request.params.id)
    if (result) return result
    return reply.status(404).send({ error: { code: 'AUDIT_EVENT_NOT_FOUND', message: '未找到指定审计事件', requestId: request.id } })
  })

  app.get('/api/conversation-audits', {
    schema: { querystring: conversationAuditQuerySchema, response: { 200: conversationAuditResponseSchema, 400: errorResponseSchema } },
  }, async (request) => createDemoConversationAudits(request.query, new Date(), request.authUser?.role ?? 'super_admin'))

  app.post('/api/conversation-audits/:id/access', {
    schema: { params: conversationAuditParamsSchema, body: conversationAccessBodySchema, response: { 200: conversationAccessResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema } },
  }, async (request, reply) => {
    const result = createDemoConversationAccess(request.params.id, request.body)
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
    return createSettings(newApi, cpa, docs, new Date(), request.authUser?.role ?? 'super_admin')
  })

  app.get('/api/me', {
    schema: { response: { 200: employeeProfileResponseSchema } },
  }, async () => createDemoEmployeeProfile())

  app.get('/api/me/keys', {
    schema: { response: { 200: employeeKeysResponseSchema } },
  }, async () => createDemoEmployeeKeys())

  app.get('/api/me/usage', {
    schema: { querystring: employeeUsageQuerySchema, response: { 200: employeeUsageResponseSchema, 400: errorResponseSchema } },
  }, async (request) => createDemoEmployeeUsage(request.query.period))

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
