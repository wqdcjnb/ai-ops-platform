import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { PlatformDatabase, PlatformUser } from './platform-db.js'

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser
  }
}

export const appRoleSchema = z.enum(['super_admin', 'employee'])
export type AppRole = z.infer<typeof appRoleSchema>

export const authUserSchema = z.object({
  id: z.string(),
  /**
   * 登录标识。员工注册时它始终是邮箱；保留 username 是为了不让已有
   * 管理员会话和历史审计失效。
   */
  email: z.string().min(1).max(320).optional(),
  username: z.string(),
  displayName: z.string(),
  role: appRoleSchema,
  roleLabel: z.string(),
})
export type AuthUser = z.infer<typeof authUserSchema>

export const loginBodySchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(200),
}).transform((value) => ({
  email: value.email.trim().toLocaleLowerCase('en-US'),
  password: value.password,
}))

/** Public employee registration uses only a name, email address and password. */
export const registrationBodySchema = z.object({
  realName: z.string().trim().min(2).max(40),
  email: z.string().trim().email().max(320).transform((value) => value.toLocaleLowerCase('en-US')),
  password: z.string().min(8).max(200),
})

export const authResponseSchema = z.object({
  authenticated: z.literal(true),
  user: authUserSchema,
  expiresAt: z.string().datetime(),
})

export const authErrorSchema = z.object({
  error: z.object({
    code: z.enum(['AUTH_INVALID', 'AUTH_REQUIRED', 'AUTH_FORBIDDEN', 'CSRF_INVALID']),
    message: z.string(),
    requestId: z.string(),
  }),
})

export const SESSION_COOKIE = 'ai_ops_session'
export const CSRF_COOKIE = 'ai_ops_csrf'
const SESSION_TTL_MS = 8 * 60 * 60 * 1000

interface BootstrapAccount {
  user: AuthUser
  password: string
}

interface Session {
  user: AuthUser
  expiresAt: number
  csrfTokenHash: string
}

export interface AuthService {
  authenticate(request: FastifyRequest): AuthUser | null
  getSession(request: FastifyRequest): { user: AuthUser; expiresAt: string } | null
  verifyCsrf(request: FastifyRequest): boolean
  login(username: string, password: string): { token: string; csrfToken: string; user: AuthUser; expiresAt: string } | null
  revoke(request: FastifyRequest): void
  setSessionCookie(reply: FastifyReply, token: string, csrfToken: string, expiresAt: string): void
  clearSessionCookie(reply: FastifyReply): void
}

function cookieValue(request: FastifyRequest, name: string) {
  const raw = request.headers.cookie ?? ''
  const item = raw.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))
  return item?.slice(`${name}=`.length) ?? null
}

function hashSessionValue(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function matchesToken(left: string, right: string) {
  if (left.length !== right.length) return false
  return timingSafeEqual(Buffer.from(left), Buffer.from(right))
}

function csrfHeader(request: FastifyRequest) {
  const value = request.headers['x-csrf-token']
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

function configuredAdminPassword() {
  const password = process.env.AUTH_ADMIN_PASSWORD
  if (password) return password
  if (process.env.NODE_ENV === 'test') return 'test-admin-password'
  throw new Error('AUTH_ADMIN_PASSWORD is required to create the bootstrap super administrator.')
}

function bootstrapAdminAccount(): BootstrapAccount {
  const username = process.env.AUTH_ADMIN_USERNAME ?? 'admin@aiops.local'
  return {
    user: {
      id: 'user-super-admin',
      email: username,
      username,
      displayName: process.env.AUTH_ADMIN_DISPLAY_NAME ?? '超级管理员',
      role: 'super_admin',
      roleLabel: '超级管理员',
    },
    password: configuredAdminPassword(),
  }
}

const roleLabels: Record<AppRole, string> = {
  super_admin: '超级管理员',
  employee: '员工',
}

function toAuthUser(user: PlatformUser): AuthUser {
  return {
    id: user.id,
    email: user.username,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    roleLabel: roleLabels[user.role],
  }
}

export function ensureBootstrapSuperAdmin(database: PlatformDatabase) {
  // Never overwrite or collide with an administrator that already exists in
  // an upgraded local database. New installs receive the email-shaped
  // bootstrap identity below; existing deployments can configure their admin
  // email explicitly before migrating login identifiers.
  if (database.findUserByRole('super_admin')) return
  database.seedUser({
    id: 'user-super-admin',
    // The rendered sign-in flow is email-only. Keep the bootstrap account on
    // the same identifier contract instead of asking an operator to remember
    // a legacy username that employees can never use.
    username: process.env.AUTH_ADMIN_USERNAME ?? 'admin@aiops.local',
    password: configuredAdminPassword(),
    displayName: process.env.AUTH_ADMIN_DISPLAY_NAME ?? '超级管理员',
    role: 'super_admin',
    roleLabel: roleLabels.super_admin,
  })
  // Employees are intentionally never seeded or created by an administrator.
  // They enter through the public real-name/email/password registration flow.
}

export function createAuthService(options: { database?: PlatformDatabase } = {}): AuthService {
  const sessions = new Map<string, Session>()
  const fallbackAccount = options.database ? null : bootstrapAdminAccount()

  function purgeExpired() {
    const now = Date.now()
    for (const [token, session] of sessions) {
      if (session.expiresAt <= now) sessions.delete(token)
    }
  }

  function getSession(request: FastifyRequest) {
    const token = cookieValue(request, SESSION_COOKIE)
    if (!token) return null
    const tokenHash = hashSessionValue(token)
    if (options.database) {
      const session = options.database.findAuthSession(tokenHash)
      if (!session) return null
      return { user: toAuthUser(session.user), expiresAt: session.expiresAt }
    }
    purgeExpired()
    const session = sessions.get(token)
    if (!session || session.expiresAt <= Date.now()) {
      if (session) sessions.delete(token)
      return null
    }
    return { user: session.user, expiresAt: new Date(session.expiresAt).toISOString() }
  }

  function createSession(user: AuthUser) {
    if (options.database) options.database.cleanupAuthSessions('login')
    const token = randomBytes(32).toString('base64url')
    const csrfToken = randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + SESSION_TTL_MS
    const expiresAtIso = new Date(expiresAt).toISOString()
    const tokenHash = hashSessionValue(token)
    const csrfTokenHash = hashSessionValue(csrfToken)
    if (options.database) {
      options.database.createAuthSession({
        id: `session-${randomBytes(16).toString('hex')}`,
        userId: user.id,
        tokenHash,
        csrfTokenHash,
        expiresAt: expiresAtIso,
      })
    } else {
      sessions.set(token, { user, expiresAt, csrfTokenHash })
    }
    return { token, csrfToken, user, expiresAt: expiresAtIso }
  }

  return {
    authenticate(request) {
      return getSession(request)?.user ?? null
    },
    getSession,
    verifyCsrf(request) {
      const token = cookieValue(request, SESSION_COOKIE)
      const csrfCookie = cookieValue(request, CSRF_COOKIE)
      const csrf = csrfHeader(request)
      if (!token || !csrfCookie || !csrf || !matchesToken(csrfCookie, csrf)) return false
      const tokenHash = hashSessionValue(token)
      const csrfTokenHash = hashSessionValue(csrf)
      if (options.database) return options.database.isAuthSessionCsrfValid(tokenHash, csrfTokenHash)
      purgeExpired()
      const session = sessions.get(token)
      return Boolean(session && session.expiresAt > Date.now() && matchesToken(session.csrfTokenHash, csrfTokenHash))
    },
    login(username, password) {
      const databaseUser = options.database?.passwordMatches(username, password)
        ? options.database.findUserByUsername(username)
        : null
      const account = databaseUser
        ? { user: toAuthUser(databaseUser), password: '' }
        : options.database
          ? null
          : fallbackAccount?.user.username === username && fallbackAccount.password === password ? fallbackAccount : null
      if (!account) return null
      return createSession(account.user)
    },
    revoke(request) {
      const token = cookieValue(request, SESSION_COOKIE)
      if (!token) return
      if (options.database) options.database.revokeAuthSession(hashSessionValue(token))
      else sessions.delete(token)
    },
    setSessionCookie(reply, token, csrfToken, expiresAt) {
      const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000))
      const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
      reply.header('set-cookie', [
        `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`,
        `${CSRF_COOKIE}=${csrfToken}; Path=/; SameSite=Strict; Max-Age=${maxAge}${secure}`,
      ])
    },
    clearSessionCookie(reply) {
      const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
      reply.header('set-cookie', [
        `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
        `${CSRF_COOKIE}=; Path=/; SameSite=Strict; Max-Age=0${secure}`,
      ])
    },
  }
}

export function isRoleAllowed(user: AuthUser, roles: readonly AppRole[]) {
  return roles.includes(user.role)
}
