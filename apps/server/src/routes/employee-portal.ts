import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  deviceSetupFailureMessage, errorPayload, parseInput,
  publicAssistantServerUrl, publicGatewayBaseUrlForCodex,
} from '../http/support.js'
import type { ApiRouteContext } from '../http/context.js'

const employeePortalKeyOperationSchema = z.object({
  idempotencyKey: z.string().trim().regex(/^employee-key-(?:create|reset)-[A-Za-z0-9._:-]{8,96}$/),
})

const deviceSetupTargetSchema = z.enum(['codex', 'workbuddy'])

const deviceSetupTicketCreateSchema = z.object({ target: deviceSetupTargetSchema })

const deviceSetupTicketIdSchema = z.object({ id: z.string().trim().regex(/^setup-[a-z0-9]{16,64}$/) })

const deviceSetupTicketTokenSchema = z.object({ ticket: z.string().trim().regex(/^[A-Za-z0-9_-]{40,128}$/) })

const deviceSetupFailureCodeSchema = z.enum(['WORKBUDDY_INVALID_JSON', 'WORKBUDDY_UNSUPPORTED_ROOT', 'WORKBUDDY_MODEL_ID_CONFLICT', 'LOCAL_CONFIG_WRITE_FAILED'])

const deviceSetupTicketCompletionSchema = z.object({ succeeded: z.boolean(), failureCode: deviceSetupFailureCodeSchema.optional() })

export function registerEmployeePortalRoutes(ctx: ApiRouteContext) {
  const {
    app, database,     keys,
  } = ctx
  const { currentPlatformKey, employeePortalKeyResponse, issuePlatformKey, personActionError } = keys

    app.get('/api/me/key', async (request) => (await employeePortalKeyResponse(request.authUser!.id, request.id)))

    app.post('/api/me/key', async (request, reply) => {
      const body = parseInput(employeePortalKeyOperationSchema, request.body, request.id, reply)
      if(!body) return
      if((await currentPlatformKey(request.authUser!.id))) {
        return reply.status(409).send(errorPayload('KEY_ALREADY_CREATED', '你已经创建过平台 Key；如需更换，请使用“重置 Key”。', request.id))
      }
      try {
        const issued = (await issuePlatformKey(request.authUser!.id, request.authUser!.id, request.id, body.idempotencyKey, 'create'))
        return reply.status(201).send({
          ...(await employeePortalKeyResponse(request.authUser!.id, request.id)),
          key: {
            id: issued.key.id,
            masked: issued.key.maskedValue,
            status: issued.key.status as 'active' | 'expiring',
            createdAt: issued.key.createdAt,
            lastUsedAt: issued.key.lastUsedAt,
          },
          secret: issued.secret,
        })
      } catch(error) {
        return personActionError(error, request.id, reply)
      }
    })

    app.post('/api/me/key/reset', async (request, reply) => {
      const body = parseInput(employeePortalKeyOperationSchema, request.body, request.id, reply)
      if(!body) return
      try {
        const issued = (await issuePlatformKey(request.authUser!.id, request.authUser!.id, request.id, body.idempotencyKey, 'reset'))
        return {
          ...(await employeePortalKeyResponse(request.authUser!.id, request.id)),
          key: {
            id: issued.key.id,
            masked: issued.key.maskedValue,
            status: issued.key.status as 'active' | 'expiring',
            createdAt: issued.key.createdAt,
            lastUsedAt: issued.key.lastUsedAt,
          },
          secret: issued.secret,
        }
      } catch(error) {
        return personActionError(error, request.id, reply)
      }
    })

    app.post('/api/me/device-setup-tickets', async (request, reply) => {
      const body = parseInput(deviceSetupTicketCreateSchema, request.body, request.id, reply)
      if(!body) return
      const key = (await currentPlatformKey(request.authUser!.id))
      if(!key || key.status !== 'active' || !(await database.readApiKeySecret(key.id))) {
        return reply.status(409).send(errorPayload('KEY_NOT_CREATED', '请先申请可用的平台 Key，再导入客户端。', request.id))
      }

      const ticket = randomBytes(32).toString('base64url')
      const setup = (await database.createDeviceSetupTicket({
        id: 'setup-' + randomUUID().replaceAll('-', '').slice(0, 24),
        tokenHash: createHash('sha256').update('ai-ops-device-setup:' + ticket).digest('hex'),
        ownerUserId: request.authUser!.id,
        apiKeyId: key.id,
        target: body.target,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      }))
      if(!setup) return reply.status(500).send(errorPayload('SETUP_TICKET_CREATE_FAILED', '无法创建本机配置请求，请稍后重试。', request.id))
      const assistantServerUrl = publicAssistantServerUrl()
      const launchUrl = `aiops://configure?ticket=${encodeURIComponent(ticket)}&server=${encodeURIComponent(assistantServerUrl)}`
      return reply.status(201).send({
        ticket: {
          id: setup.id,
          target: setup.target,
          state: setup.state,
          expiresAt: setup.expiresAt,
        },
        launchUrl,
        requestId: request.id,
      })
    })

    app.get('/api/me/device-setup-tickets/:id', async (request, reply) => {
      const params = parseInput(deviceSetupTicketIdSchema, request.params, request.id, reply)
      if(!params) return
      const ticket = (await database.findDeviceSetupTicketForOwner(params.id, request.authUser!.id))
      if(!ticket) return reply.status(404).send(errorPayload('SETUP_TICKET_NOT_FOUND', '未找到本机配置请求。', request.id))
      return {
        ticket: {
          id: ticket.id,
          target: ticket.target,
          state: ticket.state,
          expiresAt: ticket.expiresAt,
          completedAt: ticket.completedAt,
          failureMessage: ticket.state === 'failed' ? deviceSetupFailureMessage(ticket.failureCode) : null,
        },
        requestId: request.id,
      }
    })

    // These two endpoints are intentionally unauthenticated: a browser cannot
    // safely give a local desktop helper its HttpOnly session. The opaque,
    // single-use, five-minute ticket is the only credential accepted here and
    // its plaintext is never stored in PostgreSQL or placed in an API Key field.
    app.post('/api/device-setup-tickets/:ticket/claim', async (request, reply) => {
      const params = parseInput(deviceSetupTicketTokenSchema, request.params, request.id, reply)
      if(!params) return
      const claimed = (await database.claimDeviceSetupTicket(createHash('sha256').update('ai-ops-device-setup:' + params.ticket).digest('hex')))
      if(claimed.state === 'not_found' || claimed.state === 'expired') {
        return reply.status(404).send(errorPayload('SETUP_TICKET_EXPIRED', '本机配置请求已过期，请回到员工门户重新点击导入。', request.id))
      }
      if(claimed.state === 'already_claimed') {
        return reply.status(409).send(errorPayload('SETUP_TICKET_ALREADY_CLAIMED', '本机配置请求已在处理中，请稍候查看结果。', request.id))
      }
      if(claimed.state !== 'claimed' || !claimed.ticket || !claimed.secret) {
        return reply.status(409).send(errorPayload('SETUP_KEY_UNAVAILABLE', '当前平台 Key 不可用，请回到员工门户刷新后重试。', request.id))
      }
      return {
        target: claimed.ticket.target,
        config: {
          apiKey: claimed.secret,
          gatewayBaseUrl: publicGatewayBaseUrlForCodex(),
        },
        requestId: request.id,
      }
    })

    app.post('/api/device-setup-tickets/:ticket/complete', async (request, reply) => {
      const params = parseInput(deviceSetupTicketTokenSchema, request.params, request.id, reply)
      const body = parseInput(deviceSetupTicketCompletionSchema, request.body, request.id, reply)
      if(!params || !body) return
      const completed = (await database.completeDeviceSetupTicket(
        createHash('sha256').update('ai-ops-device-setup:' + params.ticket).digest('hex'),
        body.succeeded,
        undefined,
        body.succeeded ? undefined : (body.failureCode ?? 'LOCAL_CONFIG_WRITE_FAILED'),
      ))
      if(!completed) return reply.status(404).send(errorPayload('SETUP_TICKET_EXPIRED', '本机配置请求已过期，请回到员工门户重新点击导入。', request.id))
      return { ticket: { id: completed.id, target: completed.target, state: completed.state }, requestId: request.id }
    })
}
