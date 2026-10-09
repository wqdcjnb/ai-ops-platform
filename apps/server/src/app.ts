import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import Fastify, { LogController } from 'fastify'
import { randomUUID } from 'node:crypto'
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod'
import { createAuthService, ensureBootstrapSuperAdmin, isRoleAllowed, type AppRole } from './auth.js'
import { createPlatformDatabase } from './platform-db.js'
import { loadGatewayConfig } from './gateway-config.js'
import { registerGatewayRoutes } from './gateway/routes.js'
import { createGatewayConnector } from './gateway/connectors.js'
import { ExternalProviderGatewayUpstream } from './gateway/external-provider-upstream.js'
import { createExternalProviderRegistry } from './external-providers.js'
import { RuntimeCoordinator } from './runtime-coordinator.js'
import { SYSTEM_AUDIT_CLEANUP_INTERVAL_MS, errorPayload } from './http/support.js'
import { registerErrorHandler } from './http/error-handler.js'
import { createPlatformKeyService, type PlatformKeyService } from './platform-keys.js'
import { registerAuthenticationRoutes } from './routes/authentication.js'
import { registerConversationAuditRoutes } from './routes/conversation-audits.js'
import { registerEmployeePortalRoutes } from './routes/employee-portal.js'
import { registerExternalProviderRoutes } from './routes/external-providers.js'
import { registerPeopleRoutes } from './routes/people.js'
import { registerReportingRoutes } from './routes/reporting.js'
import { registerSystemRoutes, registerSystemStatusRoutes } from './routes/system.js'
import type { ApiRouteContext, BuildAppOptions } from './http/context.js'

export type { BuildAppOptions }

/** Thin composition layer: wiring, lifecycle hooks and route-module registration only. */
export async function buildApp(options: BuildAppOptions = {}) {
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
  const runtime = new RuntimeCoordinator()
  await runtime.initialize()
  app.register(rateLimit, {
    redis: runtime.redis,
    nameSpace: 'ai-ops:ip-limit:',
    max: 120, timeWindow: '1 minute',
    // Authenticated portal and model requests have identity-scoped limits.
    allowList: (request) => !['/api/auth/login', '/api/auth/register', '/api/auth/bootstrap'].includes(request.url.split('?')[0] ?? ''),
  })

  const authMode = options.authMode ?? (process.env.AUTH_MODE === 'disabled' ? 'disabled' : 'required')
  const database = options.database ?? (await createPlatformDatabase({
    filename: options.databasePath ?? process.env.PLATFORM_DB_PATH ?? (authMode === 'disabled' ? ':memory:' : undefined),
  }))
  await database.cleanupAuditEvents('startup')
  let cleanupRunning = false
  const auditCleanupTimer = setInterval(async () => {
    if(cleanupRunning) return
    cleanupRunning = true
    try {
      await database.cleanupAuditEvents('scheduled')
      await database.cleanupDeviceSetupTickets('scheduled')
      await database.cleanupConversationAuditMetadata('scheduled')
    } catch(error) {
      app.log.error('system retention cleanup failed')
    } finally { cleanupRunning = false }
  }, SYSTEM_AUDIT_CLEANUP_INTERVAL_MS)
  auditCleanupTimer.unref()
  app.addHook('onClose', async () => {
    clearInterval(auditCleanupTimer)
    await runtime.close()
    if(!options.database) await database.close()
  })
  await ensureBootstrapSuperAdmin(database)
  const auth = options.authService ?? createAuthService({ database })
  const gatewayConfig = options.gatewayConfig ?? loadGatewayConfig()
  const externalProviderRegistry = options.externalProviderRegistry ?? await createExternalProviderRegistry({ database: database.db })
  app.addHook('preHandler', async (request) => {
    if(request.url.startsWith('/v1/') || request.url.startsWith('/api/external-providers') || request.url.startsWith('/api/models') || request.url.startsWith('/gateway/')) await externalProviderRegistry.refresh()
  })
  const primaryGateway = options.gatewayUpstream ?? createGatewayConnector(gatewayConfig)
  const gatewayUpstream = new ExternalProviderGatewayUpstream(primaryGateway, externalProviderRegistry, gatewayConfig, runtime)
  app.addHook('onClose', async () => gatewayUpstream.close())

  const recordAuthenticationAudit = async (input: {
    actorUserId?: string | null
    action: 'login' | 'logout' | 'access'
    result: 'success' | 'failed' | 'denied'
    requestId: string
    code: string
    message: string
  }) => {
    await database.appendAuditEvent({
      id: 'audit-auth-' + randomUUID(),
      actorUserId: input.actorUserId && (await database.userExists(input.actorUserId)) ? input.actorUserId : null,
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
    const isLocalAssistantCallback = /^\/api\/device-setup-tickets\/[A-Za-z0-9_-]{40,128}\/(?:claim|complete)$/u.test(path)
    if(
      path === '/health'
      || path.startsWith('/gateway/')
      || path.startsWith('/v1/')
      || path === '/api/auth/login'
      || path === '/api/auth/register'
      || path === '/api/auth/bootstrap'
      || isLocalAssistantCallback
    ) return

    if(authMode === 'disabled') return

    const user = (await auth.authenticate(request))
    if(!user) {
      await recordAuthenticationAudit({
        action: 'access',
        result: 'denied',
        requestId: request.id,
        code: 'AUTH_REQUIRED',
        message: '未建立有效本地会话的访问被拒绝。',
      })
      return reply.status(401).send(errorPayload('AUTH_REQUIRED', '请先登录后再访问该资源', request.id))
    }
    request.authUser = user
    if(!await runtime.rateLimit('portal:' + user.id, 600)) return reply.status(429).send(errorPayload('RATE_LIMITED', '操作过于频繁，请稍后重试。', request.id))

    let roles: readonly AppRole[] = ['super_admin']
    if(path.startsWith('/api/me')) roles = ['employee']
    else if(path.startsWith('/api/auth/')) roles = ['super_admin', 'employee']
    if(!isRoleAllowed(user, roles)) {
      await recordAuthenticationAudit({
        actorUserId: user.id,
        action: 'access',
        result: 'denied',
        requestId: request.id,
        code: 'AUTH_FORBIDDEN',
        message: '角色权限拒绝了受保护的接口访问。',
      })
      return reply.status(403).send(errorPayload('AUTH_FORBIDDEN', '当前身份没有访问该资源的权限', request.id))
    }

    if(!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !(await auth.verifyCsrf(request))) {
      await recordAuthenticationAudit({
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

  const ctx: ApiRouteContext = {
    app,
    options,
    database,
    auth,
    authMode,
    runtime,
    gatewayConfig,
    gatewayUpstream,
    externalProviderRegistry,
    recordAuthenticationAudit,
    keys: undefined as unknown as PlatformKeyService,
  }
  ctx.keys = createPlatformKeyService(ctx)

  // Registration order mirrors the original monolith: liveness, gateway,
  // readiness, then each API surface.
  registerSystemRoutes(ctx)
  registerGatewayRoutes(app, gatewayConfig, {
    database,
    upstream: gatewayUpstream,
    hasExternalModels: () => externalProviderRegistry.hasEnabledModels(),
  })
  registerSystemStatusRoutes(ctx)
  registerExternalProviderRoutes(ctx)
  registerAuthenticationRoutes(ctx)
  registerPeopleRoutes(ctx)
  registerReportingRoutes(ctx)
  registerConversationAuditRoutes(ctx)
  registerEmployeePortalRoutes(ctx)
  registerErrorHandler(app)

  return app
}
