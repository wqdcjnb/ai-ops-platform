// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, type App } from 'vue'
import UsageView from './views/UsageView.vue'
import { fetchUsage, fetchUsageDetail, UsageApiError, type UsageDetail, type UsageResponse } from './usage-api'

vi.mock('./usage-api', async (importOriginal) => ({ ...await importOriginal<typeof import('./usage-api')>(), fetchUsage: vi.fn(), fetchUsageDetail: vi.fn() }))

const item = {
  requestId: 'req-demo-001', occurredAt: '2026-09-17T10:00:00.000Z',
  person: { id: 'person-lin', name: '林筱雨', department: { id: 'content', name: '内容运营' } },
  key: { id: 'key-lin-1', masked: 'sk-ops••••••7F2A' }, purpose: { id: 'copy', name: '商品文案', alias: 'ecommerce-copy' },
  model: { id: 'model-mini', displayName: '通用轻量模型', actualModel: 'gpt-5.1-mini' }, channel: { id: 'channel-cn', name: 'Official CN · 01', type: 'official_api' as const },
  protocol: 'responses' as const, streamed: true, tokens: { input: 10, output: 20, total: 30 }, points: 1,
  latency: { firstTokenMs: 100, totalMs: 500 }, cost: { type: 'official_actual' as const, amountUsd: .01, label: '官方实际' },
  status: 'succeeded' as const, error: null, conversationContentAvailable: false as const,
}
function response(): UsageResponse {
  return {
    meta: { source: 'database', simulated: true, generatedAt: '2026-09-17T10:00:00.000Z', period: '7d', notice: 'SQLite 模拟调用元数据' },
    summary: { requests: 1, tokens: 30, points: 1, successRate: 100, p95LatencyMs: 500, costs: { officialActualUsd: .01, platformEstimateUsd: 0, cpaEstimateUsd: 0 } },
    options: { people: [{ id: 'person-lin', label: '林筱雨' }], departments: [{ id: 'content', label: '内容运营' }], purposes: [{ id: 'copy', label: '商品文案' }], keys: [{ id: 'key-lin-1', label: 'sk-ops••••••7F2A' }], models: [{ id: 'model-mini', label: '通用轻量模型' }], channels: [{ id: 'channel-cn', label: 'Official CN · 01' }] },
    items: [item], pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
  }
}
function detail(): UsageDetail {
  return { meta: { source: 'database', simulated: true, generatedAt: '2026-09-17T10:00:00.000Z', notice: 'SQLite 模拟调用元数据' }, item, route: { alias: 'ecommerce-copy', retryCount: 0, requestIdPropagated: true }, client: { name: 'Codex Desktop', mode: 'stream' }, content: { stored: false, reason: '不保存认证 Header、完整 Key 或对话正文。' }, conversationAudit: { accessible: true, recordId: 'conv-audit-copy-01', href: '/conversation-audit?recordId=conv-audit-copy-01', source: 'synthetic_seed', notice: '已关联合成映射。' } }
}

let host: HTMLDivElement
let app: App
function mount(path = '/usage') { window.history.replaceState({}, '', path); app = createApp(UsageView); app.mount(host) }
function button(label: string) {
  const found = [...host.querySelectorAll('button')].find((node) => node.getAttribute('aria-label') === label || node.textContent?.trim() === label)
  if (!found) throw new Error('Missing button: ' + label)
  return found as HTMLButtonElement
}
beforeEach(() => {
  vi.resetAllMocks()
  host = document.createElement('div'); document.body.append(host)
  vi.mocked(fetchUsage).mockResolvedValue(response())
  vi.mocked(fetchUsageDetail).mockResolvedValue(detail())
})
afterEach(() => { app?.unmount(); window.history.replaceState({}, '', '/'); host.remove() })

describe('usage view database simulation', () => {
  it('marks SQLite records as a redacted snapshot, applies a result filter, and opens metadata-only detail', async () => {
    mount()
    await vi.waitFor(() => expect(host.textContent).toContain('SQLite · 脱敏快照'))
    expect(fetchUsage).toHaveBeenCalledWith(expect.objectContaining({ period: '7d', status: 'all' }), expect.any(AbortSignal))
    const status = host.querySelector<HTMLSelectElement>('[aria-label="结果"]')!
    status.value = 'failed'; status.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(fetchUsage).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed', page: 1 }), expect.any(AbortSignal)))
    host.querySelector<HTMLButtonElement>('[aria-label*="调用详情"]')!.click()
    await vi.waitFor(() => expect(fetchUsageDetail).toHaveBeenCalledWith('req-demo-001', expect.any(AbortSignal)))
    await vi.waitFor(() => expect(host.querySelector('[role="dialog"]')).not.toBeNull())
    expect(host.querySelector('[role="dialog"]')!.textContent).toContain('无对话正文')
    expect(host.querySelector('[role="dialog"]')!.textContent).toContain('不保存认证 Header')
    expect(host.querySelector<HTMLAnchorElement>('[aria-label="进入关联的对话审计"]')?.getAttribute('href')).toBe('/conversation-audit?recordId=conv-audit-copy-01')
  })

  it('shows a retryable error without displaying a stale table', async () => {
    vi.mocked(fetchUsage).mockRejectedValueOnce(new UsageApiError('数据库暂时不可用', 'usage-fixture-request'))
    mount()
    await vi.waitFor(() => expect(host.textContent).toContain('usage-fixture-request'))
    expect(host.querySelector('.usage-table')).toBeNull()
    button('重试').click()
    await vi.waitFor(() => expect(host.querySelector('.usage-table')).not.toBeNull())
  })

  it('accepts a safe synthetic request ID from conversation audit and allows clearing it', async () => {
    mount('/usage?requestId=req-demo-001&origin=conversation_audit')
    await vi.waitFor(() => expect(fetchUsage).toHaveBeenCalledWith(expect.objectContaining({ search: 'req-demo-001', page: 1 }), expect.any(AbortSignal)))
    expect(host.textContent).toContain('来自对话审计的关联用量')
    expect(host.textContent).toContain('不代表完整网关请求链路')
    button('清除对话审计关联筛选').click()
    await vi.waitFor(() => expect(fetchUsage).toHaveBeenLastCalledWith(expect.objectContaining({ search: '', page: 1 }), expect.any(AbortSignal)))
    expect(window.location.search).toBe('')
  })

})
