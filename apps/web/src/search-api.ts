import { z } from 'zod'

const searchGroupSchema = z.object({
  id: z.enum(['people', 'keys', 'requests']),
  label: z.string(),
  items: z.array(z.object({
    id: z.string(),
    title: z.string(),
    detail: z.string(),
    href: z.string(),
  })),
})

export const globalSearchResponseSchema = z.object({
  meta: z.object({
    source: z.literal('database'),
    simulated: z.literal(true),
    generatedAt: z.string(),
    notice: z.string(),
  }),
  query: z.string(),
  total: z.number().int().nonnegative(),
  groups: z.array(searchGroupSchema),
})

export type GlobalSearchResponse = z.infer<typeof globalSearchResponseSchema>

export class GlobalSearchApiError extends Error {
  constructor(message: string, readonly requestId?: string) {
    super(message)
    this.name = 'GlobalSearchApiError'
  }
}

export async function fetchGlobalSearch(query: string, signal?: AbortSignal): Promise<GlobalSearchResponse> {
  const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
    headers: { accept: 'application/json' },
    signal,
  })
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw new GlobalSearchApiError('全局搜索暂时无法加载', requestId)

  const result = globalSearchResponseSchema.safeParse(await response.json())
  if (!result.success) throw new GlobalSearchApiError('全局搜索接口数据格式不正确', requestId)
  return result.data
}
