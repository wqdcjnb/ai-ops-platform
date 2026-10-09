import { z } from 'zod'
import {
  createDatabasePeople, peopleQuerySchema, personDeleteBodySchema, personDisableBodySchema,
  personEnableBodySchema, personIdParamsSchema, personPasswordResetBodySchema,
} from '../people.js'
import { errorPayload, parseInput } from '../http/support.js'
import type { ApiRouteContext } from '../http/context.js'

const personKeyResetBodySchema = z.object({
  idempotencyKey: z.string().trim().regex(/^person-key-reset-[A-Za-z0-9._:-]{8,96}$/),
  acknowledgeImpact: z.literal(true),
})

export function registerPeopleRoutes(ctx: ApiRouteContext) {
  const {
    app, database,     keys,
  } = ctx
  const { issuePlatformKey, personActionError } = keys

    app.get('/api/people', async (request, reply) => {
      const query = parseInput(peopleQuerySchema, request.query, request.id, reply)
      if(!query) return
      return (await createDatabasePeople(database, query, new Date()))
    })

    app.post('/api/people', async (request, reply) => {
      return reply.status(410).send(errorPayload('ADMIN_EMPLOYEE_CREATION_DISABLED', '管理员不能创建员工账号；员工必须通过注册页面自助创建。', request.id))
    })

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
      if(!params || !body) return
      try {
        const result = (await database.disablePerson(params.id, personAudit(body.idempotencyKey, 'disable', params.id, request, {
          code: 'PERSON_DISABLED',
          message: '已停用员工并立即回收其 AI OPS 平台 Key。',
        })))
        if(!result) return reply.status(404).send(errorPayload('PERSON_NOT_FOUND', '未找到指定人员', request.id))
        if(result.state === 'already_disabled') return reply.status(409).send(errorPayload('PERSON_ALREADY_DISABLED', '该人员已停用', request.id))
        return {
          meta: { source: 'database' as const, completedAt: new Date().toISOString(), notice: result.idempotent ? '已返回上次停用结果。' : '员工已停用，旧平台 Key 已立即失效。' },
          person: { id: result.person.id, name: result.person.displayName, status: 'disabled' as const },
          keysDisabled: result.keysDisabled,
          operation: { idempotencyKey: body.idempotencyKey, idempotent: result.idempotent, auditEventId: 'audit-' + body.idempotencyKey },
        }
      } catch(error) {
        return personActionError(error, request.id, reply)
      }
    })

    app.post('/api/people/:id/enable', async (request, reply) => {
      const params = parseInput(personIdParamsSchema, request.params, request.id, reply)
      const body = parseInput(personEnableBodySchema, request.body, request.id, reply)
      if(!params || !body) return
      try {
        const result = (await database.enablePerson(params.id, personAudit(body.idempotencyKey, 'enable', params.id, request, {
          code: 'PERSON_ENABLED',
          message: '已启用员工；此前因停用而回收的 Key 按原状态恢复。',
        })))
        if(!result) return reply.status(404).send(errorPayload('PERSON_NOT_FOUND', '未找到指定人员', request.id))
        if(result.state === 'already_enabled') return reply.status(409).send(errorPayload('PERSON_ALREADY_ENABLED', '该人员已启用', request.id))
        return {
          meta: { source: 'database' as const, completedAt: new Date().toISOString(), notice: result.idempotent ? '已返回上次启用结果。' : '员工已启用。' },
          person: { id: result.person.id, name: result.person.displayName, status: 'active' as const },
          keysEnabled: result.keysEnabled,
          operation: { idempotencyKey: body.idempotencyKey, idempotent: result.idempotent, auditEventId: 'audit-' + body.idempotencyKey },
        }
      } catch(error) {
        return personActionError(error, request.id, reply)
      }
    })

    app.post('/api/people/:id/reset-password', async (request, reply) => {
      const params = parseInput(personIdParamsSchema, request.params, request.id, reply)
      const body = parseInput(personPasswordResetBodySchema, request.body, request.id, reply)
      if(!params || !body) return
      try {
        const result = (await database.resetPersonPassword(params.id, personAudit(body.idempotencyKey, 'reset', params.id, request, {
          code: 'PERSON_PASSWORD_RESET',
          message: '管理员已将员工登录密码重置为固定临时值；审计不保存该值。',
        })))
        if(!result) return reply.status(404).send(errorPayload('PERSON_NOT_FOUND', '未找到指定人员', request.id))
        return {
          meta: { source: 'database' as const, completedAt: new Date().toISOString(), notice: result.idempotent ? '已返回上次密码重置结果。' : '登录密码已重置为 123456。' },
          person: { id: result.person.id, name: result.person.displayName },
          operation: { idempotencyKey: body.idempotencyKey, idempotent: result.idempotent, auditEventId: 'audit-' + body.idempotencyKey },
        }
      } catch(error) {
        return personActionError(error, request.id, reply)
      }
    })

    app.post('/api/people/:id/reset-key', async (request, reply) => {
      const params = parseInput(personIdParamsSchema, request.params, request.id, reply)
      const body = parseInput(personKeyResetBodySchema, request.body, request.id, reply)
      if(!params || !body) return
      try {
        const issued = (await issuePlatformKey(params.id, request.authUser?.id ?? null, request.id, body.idempotencyKey, 'reset'))
        const person = (await database.findPerson(params.id))
        if(!person) return reply.status(404).send(errorPayload('PERSON_NOT_FOUND', '未找到指定人员', request.id))
        return {
          meta: {
            source: 'database' as const,
            completedAt: new Date().toISOString(),
            notice: issued.idempotent ? '已返回上次 Key 重置结果。' : '已重置员工平台 Key，旧 Key 已立即失效；员工可在自己的已登录门户中查看和复制新 Key。',
          },
          person: { id: person.id, name: person.displayName, apiKeyMasked: issued.key.maskedValue },
          operation: { idempotencyKey: body.idempotencyKey, idempotent: issued.idempotent, auditEventId: issued.auditEventId },
        }
      } catch(error) {
        return personActionError(error, request.id, reply)
      }
    })

    app.post('/api/people/:id/delete', async (request, reply) => {
      const params = parseInput(personIdParamsSchema, request.params, request.id, reply)
      const body = parseInput(personDeleteBodySchema, request.body, request.id, reply)
      if(!params || !body) return
      try {
        const result = (await database.deletePerson(params.id, personAudit(body.idempotencyKey, 'delete', params.id, request, {
          code: 'PERSON_DELETED',
          message: '已从人员目录删除员工；历史审计与用量记录保留。',
        })))
        if(!result) return reply.status(404).send(errorPayload('PERSON_NOT_FOUND', '未找到指定人员', request.id))
        if(result.state === 'not_disabled') return reply.status(409).send(errorPayload('PERSON_MUST_BE_DISABLED', '只有已停用员工才可删除。', request.id))
        return {
          meta: { source: 'database' as const, completedAt: new Date().toISOString(), notice: result.idempotent ? '已返回上次删除结果。' : '员工已从人员目录删除，历史审计与用量记录保留。' },
          person: { id: result.person.id, name: result.person.displayName, status: 'deleted' as const },
          operation: { idempotencyKey: body.idempotencyKey, idempotent: result.idempotent, auditEventId: 'audit-' + body.idempotencyKey },
        }
      } catch(error) {
        return personActionError(error, request.id, reply)
      }
    })

}
