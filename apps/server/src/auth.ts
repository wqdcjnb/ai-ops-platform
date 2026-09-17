import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { FastifyReply, FastifyRequest } from 'fastify'

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser
  }
}

export const appRoleSchema = z.enum(['super_admin', 'admin', 'department_lead', 'finance', 'employee'])
export type AppRole = z.infer<typeof appRoleSchema>

export const authUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  role: appRoleSchema,
  roleLabel: z.string(),
})
export type AuthUser = z.infer<typeof authUserSchema>

export const loginBodySchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(200),
})

export const authResponseSchema = z.object({
  authenticated: z.literal(true),
  user: authUserSchema,
  expiresAt: z.string().datetime(),
})

export const authErrorSchema = z.object({
  error: z.object({
    code: z.enum(['AUTH_INVALID', 'AUTH_REQUIRED', 'AUTH_FORBIDDEN']),
    message: z.string(),
    requestId: z.string(),
  }),
})

export const SESSION_COOKIE = 'ai_ops_session'
const SESSION_TTL_MS = 8 * 60 * 60 * 1000

interface DemoAccount {
  user: AuthUser
  password: string
}

interface Session {
  user: AuthUser
  expiresAt: number
}

export interface AuthService {
  authenticate(request: FastifyRequest): AuthUser | null
  login(username: string, password: string): { token: string; user: AuthUser; expiresAt: string } | null
  revoke(request: FastifyRequest): void
  setSessionCookie(reply: FastifyReply, token: string, expiresAt: string): void
  clearSessionCookie(reply: FastifyReply): void
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function passwordsMatch(actual: string, expected: string) {
  return digest(actual) === digest(expected)
}

function cookieValue(request: FastifyRequest) {
  const raw = request.headers.cookie ?? ''
  const item = raw.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))
  return item?.slice(`${SESSION_COOKIE}=`.length) ?? null
}

function accountFromEnvironment(role: AppRole, fallback: { username: string; password: string; displayName: string; roleLabel: string }): DemoAccount {
  const prefix = role === 'super_admin' ? 'ADMIN' : 'EMPLOYEE'
  return {
    user: {
      id: role === 'super_admin' ? 'user-super-admin' : 'person-lin',
      username: process.env[`AUTH_${prefix}_USERNAME`] ?? fallback.username,
      displayName: process.env[`AUTH_${prefix}_DISPLAY_NAME`] ?? fallback.displayName,
      role,
      roleLabel: fallback.roleLabel,
    },
    password: process.env[`AUTH_${prefix}_PASSWORD`] ?? fallback.password,
  }
}

export function createAuthService(): AuthService {
  const sessions = new Map<string, Session>()
  const accounts = [
    accountFromEnvironment('super_admin', { username: 'admin', password: 'admin-demo', displayName: '超级管理员', roleLabel: '超级管理员' }),
    accountFromEnvironment('employee', { username: 'employee', password: 'employee-demo', displayName: '林筱雨', roleLabel: '员工' }),
  ]

  function purgeExpired() {
    const now = Date.now()
    for (const [token, session] of sessions) {
      if (session.expiresAt <= now) sessions.delete(token)
    }
  }

  return {
    authenticate(request) {
      purgeExpired()
      const token = cookieValue(request)
      if (!token) return null
      const session = sessions.get(token)
      if (!session || session.expiresAt <= Date.now()) {
        if (session) sessions.delete(token)
        return null
      }
      return session.user
    },
    login(username, password) {
      const account = accounts.find((item) => item.user.username === username && passwordsMatch(password, item.password))
      if (!account) return null
      const token = randomBytes(32).toString('base64url')
      const expiresAt = Date.now() + SESSION_TTL_MS
      sessions.set(token, { user: account.user, expiresAt })
      return { token, user: account.user, expiresAt: new Date(expiresAt).toISOString() }
    },
    revoke(request) {
      const token = cookieValue(request)
      if (token) sessions.delete(token)
    },
    setSessionCookie(reply, token, expiresAt) {
      const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000))
      const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
      reply.header('set-cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`)
    },
    clearSessionCookie(reply) {
      const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
      reply.header('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`)
    },
  }
}

export function isRoleAllowed(user: AuthUser, roles: readonly AppRole[]) {
  return roles.includes(user.role)
}
