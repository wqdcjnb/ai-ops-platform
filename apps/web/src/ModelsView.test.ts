// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import ModelsView from './views/ModelsView.vue'
import { fetchModels, ModelsApiError, type CatalogSource, type ModelsResponse } from './models-api'

vi.mock('./models-api', async (importOriginal) => ({ ...await importOriginal<typeof import('./models-api')>(), fetchModels: vi.fn() }))
const time = '2026-09-17T10:00:00.000Z'
function modelResponse(source: CatalogSource = 'cpa'): ModelsResponse {
  return { meta: { source, generatedAt: time, notice: source === 'demo' ? '模拟数据，仅用于演示' : 'CPA Codex OAuth 实时目录' }, summary: { total: 1, available: 0, degraded: 0, production: 0, experiment: 0 }, options: { capabilities: [] }, total: 1, items: [{ id: 'm1', displayName: source === 'demo' ? '模拟样例模型' : '真实配置样例', actualModel: 'fixture-text', provider: '未提供', aliases: [], capabilities: [], contextWindow: null, region: '未提供', environment: 'unassigned', status: 'unverified', pricing: null, purposes: [], channelIds: ['c1'] }] }
}
const emptyModels = (): ModelsResponse => ({ ...modelResponse('cpa'), items: [], total: 0, summary: { total: 0, available: 0, degraded: 0, production: 0, experiment: 0 } })
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
})
afterEach(() => { app?.unmount(); host.remove() })

describe('model catalog source and interaction states', () => {
  it('defaults to the formal catalog, supports filters, and keeps row actions minimal', async () => {
    mount()
    await vi.waitFor(() => expect(host.textContent).toContain('真实配置样例'))
    expect(fetchModels).toHaveBeenCalledWith(expect.objectContaining({ source: 'cpa', environment: 'production' }), expect.any(AbortSignal))
    const search = host.querySelector<HTMLInputElement>('[aria-label="搜索模型"]')!
    search.value = 'sample'; search.dispatchEvent(new Event('input'))
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(fetchModels).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'sample' }), expect.any(AbortSignal)))
    expect(host.textContent).not.toContain('渠道配置')
    const source = host.querySelector<HTMLSelectElement>('[aria-label="模型目录来源"]')!
    source.value = 'new_api'; source.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(fetchModels).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'new_api', environment: 'all' }), expect.any(AbortSignal)))
    expect(host.querySelector('[aria-label="查看 真实配置样例 模型详情"]')).toBeNull()
    await vi.waitFor(() => expect(host.querySelector('.test-button')).not.toBeNull())
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })

  it('clears stale content while refreshing and distinguishes empty state from filters', async () => {
    mount(); await vi.waitFor(() => expect(host.textContent).toContain('真实配置样例'))
    let resolveModels!: (value: ModelsResponse) => void
    vi.mocked(fetchModels).mockReturnValueOnce(new Promise((resolve) => { resolveModels = resolve }))
    button('刷新').click(); await nextTick()
    expect(host.textContent).not.toContain('真实配置样例')
    expect(host.querySelector('[role="status"]')?.textContent).toContain('正在读取CPA Codex OAuth')
    resolveModels(emptyModels())
    await vi.waitFor(() => expect(host.textContent).toContain('暂无正式模型配置'))
    expect(host.textContent).not.toContain('渠道配置')
    expect(host.textContent).not.toContain('没有符合条件的模型')
  })

  it('does not repeat the model id when it matches the display name', async () => {
    const response = modelResponse()
    response.items[0] = { ...response.items[0]!, displayName: 'fixture-text', actualModel: 'fixture-text' }
    vi.mocked(fetchModels).mockResolvedValueOnce(response)
    mount()
    await vi.waitFor(() => expect(host.textContent).toContain('fixture-text'))
    const identity = host.querySelector('.model-identity')!
    expect(identity.querySelector('small')).toBeNull()
    expect(identity.textContent?.match(/fixture-text/g)?.length).toBe(1)
  })

  it('shows a retryable failure, never paints demo as live, and recovers without stale detail UI', async () => {
    mount(); await vi.waitFor(() => expect(host.textContent).toContain('真实配置样例'))
    vi.mocked(fetchModels).mockRejectedValueOnce(new ModelsApiError('New API 暂时不可用', 'fixture-request'))
    button('刷新').click()
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('fixture-request'))
    expect(host.textContent).not.toContain('真实配置样例')
    button('重试').click()
    await vi.waitFor(() => expect(host.textContent).toContain('真实配置样例'))
    expect(host.querySelector('[aria-label="查看 真实配置样例 模型详情"]')).toBeNull()
    expect(host.querySelector('[role="dialog"]')).toBeNull()
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
