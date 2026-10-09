import { z } from 'zod'
import {
  conversationAccessBodySchema, conversationAuditParamsSchema, conversationAuditQuerySchema,
  conversationDeleteBodySchema, createDatabaseConversationAccess, createDatabaseConversationAccessHistory,
  createDatabaseConversationAudits, getDatabaseConversationAuditRecord,
} from '../conversation-audit.js'

import { randomUUID } from 'node:crypto'
import type { ApiRouteContext } from '../http/context.js'
import { errorPayload, parseInput } from '../http/support.js'

export function registerConversationAuditRoutes(ctx: ApiRouteContext) {
  const {
    app, database,     keys,
  } = ctx

    app.get('/api/conversation-audits', async (request, reply) => {
      const query = parseInput(conversationAuditQuerySchema, request.query, request.id, reply)
      if(!query) return
      return (await createDatabaseConversationAudits(database, query, new Date(), request.authUser?.role ?? 'super_admin'))
    })

    app.get('/api/keys/:keyId/audits', async (request, reply) => {
      const keyParams = parseInput(z.object({ keyId: z.string().min(1).max(128) }), request.params, request.id, reply)
      const query = parseInput(conversationAuditQuerySchema, request.query, request.id, reply)
      if(!keyParams || !query) return
      return (await createDatabaseConversationAudits(database, { ...query, key: keyParams.keyId }, new Date(), request.authUser?.role ?? 'super_admin'))
    })

    app.get('/api/conversation-audits/:id/access-events', async (request, reply) => {
      const params = parseInput(conversationAuditParamsSchema, request.params, request.id, reply)
      if(!params) return
      const result = (await createDatabaseConversationAccessHistory(database, params.id))
      if(!result) return reply.status(404).send(errorPayload('CONVERSATION_AUDIT_NOT_FOUND', '未找到指定对话审计记录', request.id))
      return result
    })

    const accessConversationAudit = async (request: any, reply: any) => {
      const params = parseInput(conversationAuditParamsSchema, request.params, request.id, reply)
      const body = parseInput(conversationAccessBodySchema, request.body, request.id, reply)
      if(!params || !body) return
      const record = (await getDatabaseConversationAuditRecord(database, params.id))
      if(!record || !record.contentAccess.available) {
        return reply.status(404).send(errorPayload('CONVERSATION_CONTENT_UNAVAILABLE', '该记录没有可访问的对话内容', request.id))
      }
      const accessEvent = (await database.recordConversationAccess({
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
      }))
      const result = (await createDatabaseConversationAccess(database, record, body, new Date(), {
        id: accessEvent.id,
        persisted: true,
        auditEventId: 'audit-conversation-' + randomUUID(),
      }))
      if(!result) return reply.status(404).send(errorPayload('CONVERSATION_CONTENT_UNAVAILABLE', '该记录没有可访问的对话内容', request.id))
      return result
    }

    app.post('/api/conversation-audits/:id/access', accessConversationAudit)

    const conversationDetail = async (request: any, reply: any) => {
      const params = parseInput(conversationAuditParamsSchema, request.params, request.id, reply)
      if(!params) return
      const record = (await getDatabaseConversationAuditRecord(database, params.id))
      if(!record) return reply.status(404).send(errorPayload('CONVERSATION_AUDIT_NOT_FOUND', '未找到指定对话审计记录', request.id))
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
      if(!params || !body) return
      const record = (await getDatabaseConversationAuditRecord(database, params.id))
      if(!record || (!record.promptAvailable && !record.responseAvailable)) {
        return reply.status(404).send(errorPayload('CONVERSATION_CONTENT_UNAVAILABLE', '该记录没有可访问的正文', request.id))
      }
      const content = (await database.getConversationAuditContent(record.id))
      if(!content || (!content.promptAvailable && !content.responseAvailable)) {
        return reply.status(404).send(errorPayload('CONVERSATION_CONTENT_UNAVAILABLE', '该记录的正文已到期或采集失败', request.id))
      }
      const operationId = action + '-' + randomUUID()
      const auditEventId = 'audit-conversation-' + action + '-' + randomUUID()
      await database.recordConversationAuditOperation({
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
      if(action === 'copy') return { status: 'ok' as const, operationId, auditEventId, requestId: request.id }
      await database.incrementConversationAuditExportCount(record.id)
      const normalized = (await createDatabaseConversationAccess(database, record, body, new Date()))
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

    app.post('/api/conversation-audits/:id/copy', async (request, reply) => (await operateConversationAudit(request, reply, 'copy')))
    app.post('/api/audits/:id/copy', async (request, reply) => (await operateConversationAudit(request, reply, 'copy')))
    app.post('/api/conversation-audits/:id/export', async (request, reply) => (await operateConversationAudit(request, reply, 'export')))
    app.post('/api/audits/:id/export', async (request, reply) => (await operateConversationAudit(request, reply, 'export')))

    app.post('/api/conversation-audits/:id/delete', async (request, reply) => {
      const params = parseInput(conversationAuditParamsSchema, request.params, request.id, reply)
      const body = parseInput(conversationDeleteBodySchema, request.body, request.id, reply)
      if(!params || !body) return
      const auditEventId = `audit-conversation-delete-${body.idempotencyKey}`
      try {
        const result = (await database.deleteConversationAuditRecord(params.id, {
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
        }))
        if(!result) {
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
      } catch(error) {
        if(error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') {
          return reply.status(409).send(errorPayload(
            'IDEMPOTENCY_KEY_REUSED',
            '该幂等编号已用于其他记录或操作。',
            request.id,
          ))
        }
        throw error
      }
    })
}
