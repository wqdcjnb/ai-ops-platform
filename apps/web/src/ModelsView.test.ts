// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import ModelsView from './views/ModelsView.vue'
import { fetchChannels, fetchModels, ModelsApiError, type CatalogSource, type ChannelsResponse, type ModelsResponse } from './models-api'

vi.mock('./models-api', async (importOriginal) => ({ ...await importOriginal<typeof import('./models-api')>(), fetchModels: vi.fn(), fetchChannels: vi.fn() }))
const time = '2026-09-17T10:00:00.000Z'
function modelResponse(source: CatalogSource = 'new_api'): ModelsResponse {
  return { meta: { source, generatedAt: time, notice: source === 'demo' ? '模拟数据，仅用于演示' : 'New API 只读配置' }, summary: { total: 1, available: 0, degraded: 0, production: 0, experiment: 0 }, options: { capabilities: [] }, total: 1, items: [{ id: 'm1', displayName: source === 'demo' ? '模拟样例模型' : '真实配置样例', actualModel: 'fixture-text', provider: '未提供', aliases: [], capabilities: [], contextWindow: null, region: '未提供', environment: 'unassigned', status: 'unverified', pricing: null, purposes: [], channelIds: ['c1'] }] }
}
function channelResponse(source: CatalogSource = 'demo'): ChannelsResponse {
  return { meta: { source, generatedAt: time, notice: '只读', healthCacheSeconds: 30 }, summary: { total: 1, healthy: 0, degraded: 0, offline: 0 }, total: 1, items: [{ id: 'c1', name: '样例渠道', provider: 'New API', type: 'unknown', environment: 'unassigned', status: 'unverified', modelIds: ['m1'], latencyMs: null, successRate: null, balanceState: 'unknown', rateLimits: { rpm: null, tpm: null }, recentError: null, checkedAt: null, credentialConfigured: null }] }
}
const emptyModels = (): ModelsResponse => ({ ...modelResponse('new_api'), items: [], total: 0, summary: { total: 0, available: 0, degraded: 0, production: 0, experiment: 0 } })
const emptyChannels = (): ChannelsResponse => ({ ...channelResponse('new_api'), items: [], total: 0, summary: { total: 0, healthy: 0, degraded: 0, offline: 0 } })
let host: HTMLDivElement
let app: App
function button(text: string) {
  const found = [...host.querySelectorAll('button')].find((node) => node.textContent?.trim() === text)
  if (!found) throw new Error('Missing button: ' + text)
  return found
}
function mount() { app = createApp(ModelsView); app.mount(host) }
beforeEach(() => {
  vi.resetAllMocks()
  host = document.createElement('div'); document.body.append(host)
  vi.mocked(fetchModels).mockImplementation(async (filters) => modelResponse(filters.source))
  vi.mocked(fetchChannels).mockImplementation(async (filters) => channelResponse(filters.source))
})
afterEach(() => { app?.unmount(); host.remove() })

describe('model catalog source and interaction states', () => {
  it('defaults to the formal catalog, supports filters, and opens safe nullable details', async () => {
    mount()
    await vi.waitFor(() => expect(host.textContent).toContain('真实配置样例'))
    expect(fetchModels).toHaveBeenCalledWith(expect.objectContaining({ source: 'new_api', environment: 'production' }), expect.any(AbortSignal))
    const search = host.querySelector<HTMLInputElement>('[aria-label="搜索模型"]')!
    search.value = 'sample'; search.dispatchEvent(new Event('input'))
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(fetchModels).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'sample' }), expect.any(AbortSignal)))
    await vi.waitFor(() => expect(host.querySelector('[aria-label="渠道状态"]')).not.toBeNull())
    const status = host.querySelector<HTMLSelectElement>('[aria-label="渠道状态"]')!
    status.value = 'unverified'; status.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(fetchChannels).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'unverified' }), expect.any(AbortSignal)))
    await vi.waitFor(() => expect(host.querySelector('[aria-label="查看 真实配置样例 模型详情"]')).not.toBeNull())
    host.querySelector<HTMLButtonElement>('[aria-label="查看 真实配置样例 模型详情"]')!.click()
    await nextTick()
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('未提供不表示免费')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭详情')
    host.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })

  it('clears stale content while refreshing and distinguishes empty state from filters', async () => {
    mount(); await vi.waitFor(() => expect(host.textContent).toContain('真实配置样例'))
    let resolveModels!: (value: ModelsResponse) => void
    vi.mocked(fetchModels).mockReturnValueOnce(new Promise((resolve) => { resolveModels = resolve }))
    vi.mocked(fetchChannels).mockResolvedValueOnce(emptyChannels())
    button('刷新').click(); await nextTick()
    expect(host.textContent).not.toContain('真实配置样例')
    expect(host.querySelector('[role="status"]')?.textContent).toContain('正在读取New API')
    resolveModels(emptyModels())
    await vi.waitFor(() => expect(host.textContent).toContain('暂无正式模型配置'))
    expect(host.textContent).toContain('暂无正式渠道配置')
    expect(host.textContent).not.toContain('没有符合条件的模型')
  })

  it('shows a retryable failure, never paints demo as live, and recovers without stale details', async () => {
    mount(); await vi.waitFor(() => expect(host.textContent).toContain('真实配置样例'))
    vi.mocked(fetchModels).mockRejectedValueOnce(new ModelsApiError('New API 暂时不可用', 'fixture-request'))
    button('刷新').click()
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('fixture-request'))
    expect(host.textContent).not.toContain('真实配置样例')
    button('重试').click()
    await vi.waitFor(() => expect(host.textContent).toContain('真实配置样例'))
    host.querySelector<HTMLButtonElement>('[aria-label="查看 样例渠道 渠道详情"]')!.click()
    await nextTick()
    const detail = host.querySelector('[role="dialog"]')!.textContent
    expect(detail).toContain('调用错误数据尚未接入')
    expect(detail).toContain('未检测')
    expect(detail).not.toContain('0%')
  })

  it('rejects mismatched response labels before painting the catalog', async () => {
    mount()
    await vi.waitFor(() => expect(host.textContent).toContain('真实配置样例'))
    vi.mocked(fetchModels).mockResolvedValueOnce(modelResponse('demo'))
    button('刷新').click()
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('数据来源与当前选择不一致'))
    expect(host.querySelector('.models-table')).toBeNull()
  })
})
