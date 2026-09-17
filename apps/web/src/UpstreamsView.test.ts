// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import UpstreamsView from './views/UpstreamsView.vue'
import { fetchUpstreams, type UpstreamItem, type UpstreamsResponse } from './upstreams-api'

vi.mock('./upstreams-api', async (importOriginal) => ({ ...await importOriginal<typeof import('./upstreams-api')>(), fetchUpstreams: vi.fn() }))

const item: UpstreamItem = {
  id: 'upstream-cpa-lab-2', name: 'CPA Pro · 实验账号 02', provider: 'CLIProxyAPI', type: 'cpa_oauth', environment: 'experiment', status: 'auth_required', credentialConfigured: true, credentialValidation: 'failed', models: ['pro-oauth-lab'],
  health: { successRate: 81.2, latencyMs: 7340, checkedAt: '2026-09-17T10:00:00.000Z' }, balance: { state: 'unknown', label: '认证后更新', updatedAt: null }, capacity: null,
  auth: { expiresAt: '2026-09-17T11:00:00.000Z', lastRefreshedAt: '2026-09-17T09:00:00.000Z' }, windows: [{ id: 'five_hour', label: '5 小时窗口', usedPercent: 92, resetsAt: '2026-09-17T11:00:00.000Z' }], cooldown: { active: true, until: '2026-09-17T10:30:00.000Z', reason: '刷新失败后进入短时冷却' },
  recentError: { category: 'authentication', summary: 'OAuth 刷新未完成，需要通过受保护部署流程重新授权', firstSeenAt: '2026-09-17T09:20:00.000Z', lastSeenAt: '2026-09-17T10:00:00.000Z' },
}

function response(): UpstreamsResponse {
  return {
    meta: { source: 'demo', generatedAt: '2026-09-17T10:00:00.000Z', notice: '模拟账号明细', live: { newApi: 'healthy', cpa: 'reachable', checkedAt: '2026-09-17T10:00:00.000Z' } },
    summary: { total: 1, available: 0, needsAttention: 1, official: 0, experiment: 1, configured: 1 },
    isolation: { enforced: true, productionToExperimentFallback: false, statement: '正式与实验隔离' }, items: [item], total: 1,
  }
}

let host: HTMLDivElement
let app: App
let router: Router

async function mount() {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/upstreams', component: UpstreamsView }, { path: '/alerts', component: { template: '<div />' } }] })
  await router.push('/upstreams')
  await router.isReady()
  app = createApp(UpstreamsView)
  app.use(router)
  app.mount(host)
}

beforeEach(() => {
  vi.resetAllMocks()
  host = document.createElement('div')
  document.body.append(host)
  vi.mocked(fetchUpstreams).mockResolvedValue(response())
})

afterEach(() => { app?.unmount(); host.remove() })

describe('upstream alert handoff', () => {
  it('opens an exact simulated-alert filter from an account with a current exception', async () => {
    await mount()
    await vi.waitFor(() => expect(host.textContent).toContain('CPA Pro · 实验账号 02'))
    host.querySelector<HTMLButtonElement>('[aria-label="查看 CPA Pro · 实验账号 02 账号详情"]')!.click()
    await nextTick()
    const related = host.querySelector<HTMLButtonElement>('[aria-label="查看 CPA Pro · 实验账号 02 的关联模拟告警"]')
    expect(related?.textContent).toContain('查看关联模拟告警')
    related!.click()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/alerts?subjectId=upstream-cpa-lab-2'))
  })
})
