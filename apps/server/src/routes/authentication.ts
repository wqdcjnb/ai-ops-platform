import { loginBodySchema, registrationBodySchema } from '../auth.js'

import { randomUUID } from 'node:crypto'
import type { ApiRouteContext } from '../http/context.js'
import { errorPayload, parseInput } from '../http/support.js'

export function registerAuthenticationRoutes(ctx: ApiRouteContext) {
  const {
    app, database, auth,
    recordAuthenticationAudit
  } = ctx

    app.post('/api/auth/login', async (request, reply) => {
      const body = parseInput(loginBodySchema, request.body, request.id, reply)
      if(!body) return
      const session = (await auth.login(body.email, body.password))
      if(!session) {
        await recordAuthenticationAudit({
          action: 'login',
          result: 'failed',
          requestId: request.id,
          code: 'AUTH_INVALID',
          message: '本地登录校验失败；未记录输入的邮箱或密码。',
        })
        return reply.status(401).send(errorPayload('AUTH_INVALID', '邮箱或密码不正确', request.id))
      }
      auth.setSessionCookie(reply, session.token, session.csrfToken, session.expiresAt)
      await recordAuthenticationAudit({
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
      if(!body) return
      const id = 'person-' + randomUUID().replaceAll('-', '').slice(0, 16)
      try {
        await database.createPerson({
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
      } catch(error) {
        if(error instanceof Error && /unique|duplicate/i.test(error.message)) {
          return reply.status(409).send(errorPayload('EMAIL_CONFLICT', '该邮箱已注册，请直接登录。', request.id))
        }
        throw error
      }
      const session = (await auth.login(body.email, body.password))
      if(!session) return reply.status(400).send(errorPayload('REGISTER_SESSION_FAILED', '账号已创建，但登录会话未能建立，请直接登录。', request.id))
      auth.setSessionCookie(reply, session.token, session.csrfToken, session.expiresAt)
      return reply.status(201).send({ authenticated: true as const, user: session.user, expiresAt: session.expiresAt })
    })

    app.get('/api/auth/me', async (request, reply) => {
      const session = (await auth.getSession(request))
      if(!session) return reply.status(401).send(errorPayload('AUTH_REQUIRED', '当前会话已失效，请重新登录', request.id))
      return { authenticated: true as const, user: session.user, expiresAt: session.expiresAt }
    })

    app.post('/api/auth/logout', async (request, reply) => {
      await auth.revoke(request)
      auth.clearSessionCookie(reply)
      await recordAuthenticationAudit({
        actorUserId: request.authUser?.id ?? null,
        action: 'logout',
        result: 'success',
        requestId: request.id,
        code: 'LOGOUT_OK',
        message: '本地管理会话已撤销。',
      })
      return reply.status(204).send()
    })
}
