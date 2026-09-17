import { z } from 'zod'
import { withCsrfHeader } from './csrf'

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

export const authResponseSchema = z.object({
  authenticated: z.literal(true),
  user: authUserSchema,
  expiresAt: z.string().datetime(),
})
export type AuthResponse = z.infer<typeof authResponseSchema>

export class AuthApiError extends Error {
  constructor(message: string, readonly requestId?: string) {
    super(message)
    this.name = 'AuthApiError'
  }
}

async function parseAuthResponse(response: Response, fallback: string) {
  const requestId = response.headers.get('x-request-id') ?? undefined
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object' && 'message' in body.error
      ? String(body.error.message)
      : fallback
    throw new AuthApiError(message, requestId)
  }
  const parsed = authResponseSchema.safeParse(body)
  if (!parsed.success) throw new AuthApiError(`${fallback}：接口数据格式不正确`, requestId)
  return parsed.data
}

export async function fetchCurrentUser(signal?: AbortSignal): Promise<AuthResponse | null> {
  const response = await fetch('/api/auth/me', { headers: { accept: 'application/json' }, signal })
  if (response.status === 401) return null
  return parseAuthResponse(response, '登录状态暂时无法确认')
}

export async function login(username: string, password: string, signal?: AbortSignal) {
  return parseAuthResponse(await fetch('/api/auth/login', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
    signal,
  }), '登录失败')
}

export async function logout(signal?: AbortSignal) {
  const response = await fetch('/api/auth/logout', { method: 'POST', headers: withCsrfHeader({ accept: 'application/json' }), signal })
  if (!response.ok) throw new AuthApiError('退出登录失败', response.headers.get('x-request-id') ?? undefined)
}
