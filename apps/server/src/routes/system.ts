import { z } from 'zod'
import type { ApiRouteContext } from '../http/context.js'

/** Liveness probe. Registered first so it is never shadowed by another route. */
export function registerSystemRoutes(ctx: ApiRouteContext) {
  const { app, database, runtime } = ctx

  app.get('/health', {
    schema: { response: { 200: z.object({ status: z.literal('ok'), service: z.literal('ai-ops-bff') }), 503: z.object({ status: z.literal('unavailable'), service: z.literal('ai-ops-bff') }) } },
  }, async (_request, reply) => {
    try { await Promise.all([database.db.health(), runtime.health()]) }
    catch { return reply.status(503).send({ status: 'unavailable', service: 'ai-ops-bff' }) }
    return { status: 'ok' as const, service: 'ai-ops-bff' as const }
  })
}

/** Readiness payload used by the operator dashboard. */
export function registerSystemStatusRoutes(ctx: ApiRouteContext) {
  const { app, database, runtime } = ctx

  app.get('/api/system/status', async () => {
    const checks = await Promise.allSettled([database.db.health(), runtime.health()])
    return {
      ready: checks.every((result) => result.status === 'fulfilled'),
      storage: { engine: 'PostgreSQL', available: checks[0]!.status === 'fulfilled', connections: database.db.pool.totalCount, idle: database.db.pool.idleCount, waiting: database.db.pool.waitingCount },
      coordination: { engine: 'Redis', available: checks[1]!.status === 'fulfilled', ...runtime.status() },
      process: { uptimeSeconds: Math.round(process.uptime()), memoryRssBytes: process.memoryUsage().rss },
    }
  })
}
