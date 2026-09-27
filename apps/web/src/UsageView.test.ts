// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, type App } from 'vue'
import UsageView from './views/UsageView.vue'
import { fetchModelAnalytics, UsageApiError, type ModelAnalyticsResponse } from './usage-api'

vi.mock('./usage-api', async (importOriginal) => ({ ...await importOriginal<typeof import('./usage-api')>(), fetchModelAnalytics: vi.fn() }))

function response(): ModelAnalyticsResponse {
  return {
    meta: {
      source: 'ai_ops_local', generatedAt: '2026-09-21T12:00:00.000Z', startAt: '2026-09-20T12:00:00.000Z', endAt: '2026-09-21T12:00:00.000Z', timeGranularity: 'hour', person: 'all',
      notice: '数据源：AI OPS 统一模型网关已采集的真实调用元数据；不含提示词、回答或凭据。',
    },
    summary: { totalCount: 3, totalTokens: 39, averageRpm: 0.02, averageTpm: 0.27 },
    options: { people: [{ id: 'person-wang', label: '王建康' }, { id: 'person-li', label: '李安' }] },
    models: [{ modelName: 'deepseek-chat', count: 2, tokens: 30 }, { modelName: 'gpt-5.6-sol', count: 1, tokens: 9 }],
    series: [
      { bucket: '2026-09-21T10:00:00.000Z', modelName: 'deepseek-chat', count: 2, tokens: 30 },
      { bucket: '2026-09-21T11:00:00.000Z', modelName: 'gpt-5.6-sol', count: 1, tokens: 9 },
    ],
  }
}

let host: HTMLDivElement
let app: App
function mount() { app = createApp(UsageView); app.mount(host) }
function button(label: string) {
  const found = [...host.querySelectorAll('button')].find((node) => node.getAttribute('aria-label') === label || node.textContent?.trim() === label)
  if (!found) throw new Error('Missing button: ' + label)
  return found as HTMLButtonElement
}

beforeEach(() => {
  vi.resetAllMocks()
  host = document.createElement('div')
  document.body.append(host)
  vi.mocked(fetchModelAnalytics).mockResolvedValue(response())
})
afterEach(() => { app?.unmount(); host.remove() })

describe('local model analytics view', () => {
  it('renders the restored model analytics page from AI OPS local gateway data', async () => {
    mount()
    await vi.waitFor(() => expect(host.textContent).toContain('Token 分布'))
    expect(fetchModelAnalytics).toHaveBeenCalledWith({ days: 1, timeGranularity: 'hour', person: 'all' }, expect.any(AbortSignal))
    expect(host.textContent).toContain('AI OPS 本地网关')
    expect(host.textContent).not.toContain('数据源：AI OPS 统一模型网关')
    expect(host.textContent).toContain('deepseek-chat')
    expect(host.textContent).not.toContain('演示数据')
    expect(host.textContent).toContain('Token 分布')
  })

  it('filters the local aggregate by a real AI OPS person', async () => {
    mount()
    await vi.waitFor(() => expect(host.textContent).toContain('Token 分布'))
    button('筛选').click()
    await vi.waitFor(() => expect(host.querySelector('[aria-label="人员"]')).not.toBeNull())
    const person = host.querySelector<HTMLSelectElement>('[aria-label="人员"]')!
    person.value = 'person-wang'
    person.dispatchEvent(new Event('change'))
    button('应用筛选').click()
    await vi.waitFor(() => expect(fetchModelAnalytics).toHaveBeenLastCalledWith({ days: 1, timeGranularity: 'hour', person: 'person-wang' }, expect.any(AbortSignal)))
  })

  it('keeps full actual model names in a scrollable detail table while grouping chart overflow', async () => {
    const models = Array.from({ length: 8 }, (_, index) => ({
      modelName: `gpt-4.1-super-long-production-model-variant-${index + 1}`,
      count: 8 - index,
      tokens: (8 - index) * 100,
    }))
    vi.mocked(fetchModelAnalytics).mockResolvedValue({
      ...response(),
      summary: { totalCount: models.reduce((sum, item) => sum + item.count, 0), totalTokens: models.reduce((sum, item) => sum + item.tokens, 0), averageRpm: 0.1, averageTpm: 1 },
      models,
      series: models.map((item) => ({ bucket: '2026-09-21T10:00:00.000Z', ...item })),
    })

    mount()

    await vi.waitFor(() => expect(host.textContent).toContain('实际模型明细'))
    expect(host.textContent).toContain('其他 2 个')
    const table = host.querySelector('.na-actual-model-table')
    expect(table?.textContent).toContain('gpt-4.1-super-long-production-model-variant-8')
    expect(table?.querySelector('code')?.getAttribute('title')).toBe('gpt-4.1-super-long-production-model-variant-1')
  })

  it('keeps the analytics failure retryable', async () => {
    vi.mocked(fetchModelAnalytics).mockRejectedValueOnce(new UsageApiError('本地网关暂时不可用', 'analytics-fixture-request'))
    mount()
    await vi.waitFor(() => expect(host.textContent).toContain('本地网关暂时不可用'))
    button('重试').click()
    await vi.waitFor(() => expect(host.textContent).toContain('Token 分布'))
  })
})
