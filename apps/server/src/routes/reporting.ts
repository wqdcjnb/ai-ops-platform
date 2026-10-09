import { createOwnedModels, modelsQuerySchema } from '../models.js'
import { createDatabaseUsage, createDatabaseUsageDetail, usageQuerySchema, usageRequestParamsSchema } from '../usage.js'
import {
  auditExportQuerySchema, auditParamsSchema, auditQuerySchema, createAuditCsv,
  createDatabaseAudit, createDatabaseAuditDetail,
} from '../audit.js'
import { createDatabaseModelAnalytics, modelAnalyticsQuerySchema } from '../model-analytics.js'

import { randomUUID } from 'node:crypto'
import type { ApiRouteContext } from '../http/context.js'
import { errorPayload, parseInput } from '../http/support.js'

export function registerReportingRoutes(ctx: ApiRouteContext) {
  const {
    app, database,     externalProviderRegistry,
  } = ctx

    app.get('/api/models', async (request, reply) => {
      const query = parseInput(modelsQuerySchema, request.query, request.id, reply)
      if(!query) return
      return createOwnedModels(query, externalProviderRegistry.list(), new Date())
    })

    app.get('/api/usage', async (request, reply) => {
      const query = parseInput(usageQuerySchema, request.query, request.id, reply)
      if(!query) return
      return (await createDatabaseUsage(database, query, new Date()))
    })

    app.get('/api/usage/model-analytics', async (request, reply) => {
      const query = parseInput(modelAnalyticsQuerySchema, request.query, request.id, reply)
      if(!query) return
      return createDatabaseModelAnalytics(database, query, new Date())
    })

    app.get('/api/usage/:requestId', async (request, reply) => {
      const params = parseInput(usageRequestParamsSchema, request.params, request.id, reply)
      if(!params) return
      const result = (await createDatabaseUsageDetail(database, params.requestId, new Date(), true))
      if(!result) return reply.status(404).send(errorPayload('USAGE_NOT_FOUND', '未找到指定调用记录', request.id))
      return result
    })

    app.get('/api/audit-events', async (request, reply) => {
      const query = parseInput(auditQuerySchema, request.query, request.id, reply)
      if(!query) return
      return (await createDatabaseAudit(database, query))
    })

    app.post('/api/audit-events/export', async (request, reply) => {
      const body = parseInput(auditExportQuerySchema, request.body, request.id, reply)
      if(!body) return
      const result = (await createDatabaseAudit(database, { ...body, page: 1, pageSize: 500 }))
      await database.appendAuditEvent({
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
      if(!params) return
      const result = (await createDatabaseAuditDetail(database, params.id))
      if(!result) return reply.status(404).send(errorPayload('AUDIT_EVENT_NOT_FOUND', '未找到指定审计事件', request.id))
      return result
    })
}
