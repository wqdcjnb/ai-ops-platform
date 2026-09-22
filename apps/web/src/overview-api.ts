import { z } from 'zod'

export const periodSchema = z.enum(['7d', '30d'])
export type Period = z.infer<typeof periodSchema>

export const newApiStatusSchema = z.object({
  state: z.enum(['offline', 'reachable', 'auth_required', 'ready']),
  authConfigured: z.boolean(),
  checkedAt: z.string(),
})
export type NewApiStatus = z.infer<typeof newApiStatusSchema>

export const overviewResponseSchema = z.object({
  meta: z.object({
    source: z.literal('database'),
    simulated: z.literal(true),
    generatedAt: z.string(),
    timezone: z.literal('Asia/Shanghai'),
    period: periodSchema,
    notice: z.string(),
  }),
  service: z.object({
    bff: z.literal('healthy'),
    newApi: newApiStatusSchema,
  }),
  metrics: z.object({
    todayRequests: z.number(),
    todayRequestDeltaPercent: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    tokenDeltaPercent: z.number(),
    successRate: z.number(),
    successDeltaPercent: z.number(),
    p95LatencyMs: z.number(),
    p95LatencyDeltaMs: z.number(),
    firstTokenLatencyMs: z.number(),
  }),
  trend: z.array(z.object({ date: z.string(), requests: z.number() })),
  people: z.array(z.object({
    id: z.string(), name: z.string(), initials: z.string(), department: z.string(), purpose: z.string(), requests: z.number(), tokens: z.number(), tone: z.enum(['coral', 'blue', 'violet', 'green', 'amber']),
  })),
  channels: z.array(z.object({
    id: z.string(), name: z.string(), model: z.string(), type: z.enum(['production', 'experiment']), status: z.enum(['healthy', 'auth_required']), latencyMs: z.number().nullable(), successRate: z.number(), requests: z.number(),
  })),
  limits: z.object({ mode: z.literal('soft'), blocking: z.literal(false) }),
})

export type OverviewResponse = z.infer<typeof overviewResponseSchema>

export class OverviewApiError extends Error {
  constructor(message: string, readonly requestId?: string) {
    super(message)
    this.name = 'OverviewApiError'
  }
}

export async function fetchOverview(period: Period, signal?: AbortSignal): Promise<OverviewResponse> {
  const response = await fetch(`/api/overview?period=${period}`, {
    headers: { accept: 'application/json' },
    signal,
  })

  if (!response.ok) {
    const requestId = response.headers.get('x-request-id') ?? undefined
    throw new OverviewApiError('运营数据暂时无法加载', requestId)
  }

  const result = overviewResponseSchema.safeParse(await response.json())
  if (!result.success) {
    throw new OverviewApiError('运营数据格式不符合接口约定', response.headers.get('x-request-id') ?? undefined)
  }
  return result.data
}

export async function fetchNewApiStatus(signal?: AbortSignal): Promise<NewApiStatus> {
  const response = await fetch('/api/integrations/new-api/status', {
    headers: { accept: 'application/json' },
    signal,
  })
  if (!response.ok) throw new OverviewApiError('服务状态暂时无法加载', response.headers.get('x-request-id') ?? undefined)

  const result = newApiStatusSchema.safeParse(await response.json())
  if (!result.success) throw new OverviewApiError('服务状态格式不符合接口约定', response.headers.get('x-request-id') ?? undefined)
  return result.data
}
