import { z } from 'zod'

export const newApiStateSchema = z.enum(['offline', 'reachable', 'auth_required', 'ready'])
export type NewApiState = z.infer<typeof newApiStateSchema>

export const newApiStatusSchema = z.object({
  state: newApiStateSchema,
  authConfigured: z.boolean(),
  checkedAt: z.string().datetime(),
})
export type NewApiStatus = z.infer<typeof newApiStatusSchema>

export interface NewApiProbeOptions {
  baseUrl?: string
  accessToken?: string
  userId?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  now?: () => Date
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('NEW_API_BASE_URL must use HTTP or HTTPS')
  }
  return url.toString().replace(/\/$/, '')
}

export async function probeNewApiStatus(options: NewApiProbeOptions = {}): Promise<NewApiStatus> {
  const accessToken = options.accessToken?.trim()
  const authConfigured = Boolean(accessToken)
  const checkedAt = (options.now?.() ?? new Date()).toISOString()
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 1_500

  let baseUrl: string
  try {
    baseUrl = normalizeBaseUrl(options.baseUrl ?? 'http://127.0.0.1:3000')
  } catch {
    return { state: 'offline', authConfigured, checkedAt }
  }

  try {
    const publicResponse = await fetchImpl(`${baseUrl}/api/status`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!publicResponse.ok) return { state: 'offline', authConfigured, checkedAt }
    if (!authConfigured) return { state: 'reachable', authConfigured, checkedAt }

    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
    }
    if (options.userId?.trim()) headers['new-api-user'] = options.userId.trim()

    const authResponse = await fetchImpl(`${baseUrl}/api/user/self`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    })
    return {
      state: authResponse.ok ? 'ready' : 'auth_required',
      authConfigured,
      checkedAt,
    }
  } catch {
    return { state: 'offline', authConfigured, checkedAt }
  }
}

export function probeNewApiFromEnvironment() {
  return probeNewApiStatus({
    baseUrl: process.env.NEW_API_BASE_URL,
    accessToken: process.env.NEW_API_ACCESS_TOKEN,
    userId: process.env.NEW_API_USER_ID,
  })
}
