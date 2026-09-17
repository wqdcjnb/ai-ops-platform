import { z } from 'zod'

export const platformServiceStateSchema = z.enum(['healthy', 'reachable', 'auth_required', 'offline'])

export const platformStatusSchema = z.object({
  meta: z.object({
    source: z.literal('live'),
    generatedAt: z.string(),
  }),
  services: z.array(z.object({
    id: z.enum(['bff', 'new-api', 'cpa']),
    name: z.string(),
    state: platformServiceStateSchema,
    detail: z.string(),
    checkedAt: z.string(),
  })).length(3),
  setup: z.array(z.object({
    id: z.string(),
    label: z.string(),
    state: z.enum(['done', 'pending']),
    detail: z.string(),
  })),
  links: z.array(z.object({
    id: z.enum(['new-api', 'cpa']),
    label: z.string(),
    url: z.string().url(),
  })).length(2),
})

export const taskSummarySchema = z.object({
  source: z.literal('database'),
  simulated: z.literal(true),
  generatedAt: z.string(),
  total: z.number().int().nonnegative(),
  summary: z.object({
    openAlerts: z.number().int().nonnegative(),
    criticalAlerts: z.number().int().nonnegative(),
    activeKeys: z.number().int().nonnegative(),
    expiringKeys: z.number().int().nonnegative(),
  }),
  items: z.array(z.object({
    id: z.string(),
    level: z.enum(['critical', 'warning', 'info']),
    title: z.string(),
    detail: z.string(),
    target: z.enum(['alerts', 'keys']),
  })),
})

export type PlatformStatus = z.infer<typeof platformStatusSchema>
export type PlatformService = PlatformStatus['services'][number]
export type PlatformServiceState = z.infer<typeof platformServiceStateSchema>
export type TaskSummary = z.infer<typeof taskSummarySchema>

export class HomeApiError extends Error {
  constructor(message: string, readonly requestId?: string) {
    super(message)
    this.name = 'HomeApiError'
  }
}

async function getValidated<T>(path: string, schema: z.ZodType<T>, message: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' }, signal })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw new HomeApiError(message, requestId)

  const result = schema.safeParse(await response.json())
  if (!result.success) throw new HomeApiError(`${message}：接口数据格式不正确`, requestId)
  return result.data
}

export function fetchPlatformStatus(signal?: AbortSignal) {
  return getValidated('/api/platform/status', platformStatusSchema, '平台状态暂时无法加载', signal)
}

export function fetchTaskSummary(signal?: AbortSignal) {
  return getValidated('/api/tasks/summary', taskSummarySchema, '待处理事项暂时无法加载', signal)
}
