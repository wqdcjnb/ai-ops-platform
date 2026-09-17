import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { PlatformDatabase, PlatformUser } from './platform-db.js'

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

const roleLabels: Record<AppRole, string> = {
  super_admin: '超级管理员',
  admin: '运营管理员',
  department_lead: '部门负责人',
  finance: '财务只读',
  employee: '员工',
}

function toAuthUser(user: PlatformUser): AuthUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    roleLabel: roleLabels[user.role],
  }
}

export function seedDemoUsers(database: PlatformDatabase) {
  database.seedUser({
    id: 'user-super-admin',
    username: process.env.AUTH_ADMIN_USERNAME ?? 'admin',
    password: process.env.AUTH_ADMIN_PASSWORD ?? 'admin-demo',
    displayName: process.env.AUTH_ADMIN_DISPLAY_NAME ?? '超级管理员',
    role: 'super_admin',
    roleLabel: roleLabels.super_admin,
  })
  database.seedUser({
    id: 'person-lin',
    username: process.env.AUTH_EMPLOYEE_USERNAME ?? 'employee',
    password: process.env.AUTH_EMPLOYEE_PASSWORD ?? 'employee-demo',
    displayName: process.env.AUTH_EMPLOYEE_DISPLAY_NAME ?? '林筱雨',
    role: 'employee',
    roleLabel: roleLabels.employee,
  })
}

export function createAuthService(options: { database?: PlatformDatabase } = {}): AuthService {
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
      const databaseUser = options.database?.passwordMatches(username, password)
        ? options.database.findUserByUsername(username)
        : null
      const account = databaseUser
        ? { user: toAuthUser(databaseUser), password: '' }
        : options.database
          ? null
          : accounts.find((item) => item.user.username === username && item.password === password)
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
