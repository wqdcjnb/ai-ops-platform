// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import UpstreamsView from './views/UpstreamsView.vue'
import { fetchCpaAuthFileQuota, fetchCpaAuthFiles, fetchUpstreams, uploadCpaAuthFile, type UpstreamItem, type UpstreamsResponse } from './upstreams-api'

vi.mock('./upstreams-api', async (importOriginal) => ({ ...await importOriginal<typeof import('./upstreams-api')>(), fetchUpstreams: vi.fn(), fetchCpaAuthFiles: vi.fn(), fetchCpaAuthFileQuota: vi.fn(), uploadCpaAuthFile: vi.fn() }))

const item: UpstreamItem = {
  id: 'upstream-cpa-gateway', name: 'CPA Codex OAuth', provider: 'CLIProxyAPI', type: 'cpa_oauth', environment: 'production', status: 'auth_required', credentialConfigured: true, credentialValidation: 'failed', models: ['gpt-5-codex'],
  health: { successRate: null, latencyMs: 7340, checkedAt: '2026-09-17T10:00:00.000Z' }, balance: { state: 'unknown', label: '由 CPA 管理', updatedAt: null }, capacity: null,
  auth: { expiresAt: '2026-09-17T11:00:00.000Z', lastRefreshedAt: '2026-09-17T09:00:00.000Z' }, windows: [{ id: 'five_hour', label: '5 小时窗口', usedPercent: 92, resetsAt: '2026-09-17T11:00:00.000Z' }], cooldown: { active: true, until: '2026-09-17T10:30:00.000Z', reason: '刷新失败后进入短时冷却' },
  recentError: { category: 'authentication', summary: 'OAuth 刷新未完成，需要通过受保护部署流程重新授权', firstSeenAt: '2026-09-17T09:20:00.000Z', lastSeenAt: '2026-09-17T10:00:00.000Z' },
}

function response(): UpstreamsResponse {
  return {
    meta: { source: 'live', generatedAt: '2026-09-17T10:00:00.000Z', notice: 'CPA 账号池已接入', live: { cpa: 'reachable', checkedAt: '2026-09-17T10:00:00.000Z', managementConfigured: true } },
    summary: { total: 1, available: 0, needsAttention: 1, official: 0, experiment: 0, configured: 1 },
    isolation: { enforced: true, productionToExperimentFallback: false, statement: '正式与实验隔离' }, items: [item], total: 1,
  }
}

let host: HTMLDivElement
let app: App

async function mount() {
  app = createApp(UpstreamsView)
  app.mount(host)
}

beforeEach(() => {
  vi.resetAllMocks()
  host = document.createElement('div')
  document.body.append(host)
  vi.mocked(fetchUpstreams).mockResolvedValue(response())
  vi.mocked(fetchCpaAuthFiles).mockResolvedValue({ files: [], requestId: 'req-auth-files' })
})

afterEach(() => { app?.unmount(); host.remove() })

describe('CPA upstream configuration', () => {
  it('opens the CPA-only configuration with both account entry methods', async () => {
    await mount()
    await vi.waitFor(() => expect(host.textContent).toContain('配置凭据'))
    expect(host.textContent).toContain('真实上游实时快照')
    const statusSelect = host.querySelector<HTMLSelectElement>('.account-filter select')!
    expect([...statusSelect.options].map((option) => option.textContent)).toEqual(['全部状态', '启用', '未启用', '问题'])
    const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes('配置凭据'))
    expect(button).toBeTruthy()
    button!.click()
    await nextTick()
    expect(host.textContent).toContain('配置凭据')
    expect(host.textContent).toContain('操作步骤')
    expect(host.textContent).toContain('注意事项')
    expect(host.textContent).toContain('仅用于 Codex 登录')
    expect(host.textContent).toContain('浏览器 OAuth 登录')
    expect(host.textContent).toContain('导入并验证')
    expect(host.textContent).toContain('~/.codex/auth.json')
    expect(host.textContent).not.toContain('New API')
    expect(host.textContent).not.toContain('CPA 服务连接')
    expect(host.querySelectorAll('input[type="password"]')).toHaveLength(0)
  })

  it('refreshes the account list, closes the dialog, and shows a success notice after import', async () => {
    vi.mocked(fetchCpaAuthFiles).mockReset()
    vi.mocked(fetchCpaAuthFiles).mockResolvedValueOnce({ files: [], requestId: 'req-auth-files-initial' }).mockResolvedValue({
      files: [{ id: 'auth-1', name: 'codex-primary.json', provider: 'Codex', status: 'ready', email: 'codex@example.test' }],
      requestId: 'req-auth-files-refreshed',
    })
    await mount()
    await vi.waitFor(() => expect(host.textContent).toContain('配置凭据'))
    const openButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes('配置凭据'))!
    openButton.click()
    await nextTick()
    expect(host.querySelector('.credential-result-banner')).toBeNull()

    const fileInput = host.querySelector<HTMLInputElement>('input[type="file"]')!
    const invalidFile = new File(['{}'], 'credentials.txt', { type: 'text/plain' })
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [invalidFile] })
    fileInput.dispatchEvent(new Event('change'))
    await nextTick()
    expect(host.querySelector('.credential-result-banner')?.textContent).toContain('配置失败')

    vi.mocked(uploadCpaAuthFile).mockResolvedValue({
      status: 'ok',
      fileName: 'auth.json',
      format: 'codex_cli',
      converted: true,
      verification: { status: 'verified', probe: 'codex_usage', checkedAt: '2026-09-17T10:00:00.000Z', detail: 'Codex usage 验证通过', fileName: 'auth.json' },
      requestId: 'req-upload',
    })
    const validFile = new File(['{}'], 'auth.json', { type: 'application/json' })
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [validFile] })
    fileInput.dispatchEvent(new Event('change'))
    await nextTick()
    const importButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes('导入并验证'))!
    importButton.click()
    await vi.waitFor(() => expect(host.querySelector('.account-notice')?.textContent).toContain('auth.json'))
    expect(host.querySelector('.credential-dialog')).toBeNull()
    expect(host.querySelector('.account-notice')?.classList.contains('success')).toBe(true)
    expect(host.querySelector('.codex-account-card')?.textContent).toContain('codex@example.test')
  })

  it('renders the real CPA auth-file list as Codex account cards', async () => {
    vi.mocked(fetchCpaAuthFiles).mockResolvedValue({
      files: [{ id: 'auth-1', name: 'codex-primary.json', provider: 'Codex', status: 'ready', email: 'codex@example.test' }],
      requestId: 'req-auth-files',
    })
    await mount()
    await vi.waitFor(() => expect(host.textContent).toContain('codex@example.test'))
    expect(host.textContent).toContain('CPA 实时')
    expect(host.textContent).toContain('窗口数据来自 CPA 实时探测，不代表单账号额度。')
    expect(host.querySelectorAll('.codex-account-card')).toHaveLength(1)
  })

  it('shows a success notice after refreshing an account quota', async () => {
    vi.mocked(fetchCpaAuthFiles).mockResolvedValue({
      files: [{ id: 'auth-1', name: 'codex-primary.json', provider: 'Codex', status: 'ready', email: 'codex@example.test' }],
      requestId: 'req-auth-files',
    })
    vi.mocked(fetchCpaAuthFileQuota).mockResolvedValue({
      quota: { status: 'success', planType: 'Pro', subscriptionActiveUntil: null, windows: [{ id: 'five_hour', label: '5 小时窗口', usedPercent: 24, remainingPercent: 76, resetAt: '2026-09-17T11:00:00.000Z', resetAfterSeconds: null }], creditsAvailable: null, checkedAt: '2026-09-17T10:00:00.000Z' },
      requestId: 'req-quota',
    })
    await mount()
    await vi.waitFor(() => expect(host.textContent).toContain('codex@example.test'))
    host.querySelector<HTMLButtonElement>('.codex-account-quota')!.click()
    await vi.waitFor(() => expect(host.querySelector('.account-notice')?.textContent).toContain('已刷新 "codex-primary.json" 的额度'))
    expect(host.querySelector('.account-notice')?.classList.contains('success')).toBe(true)
    expect(host.querySelector('.account-notice-icon')).not.toBeNull()
  })

  it('changes quota colors as the remaining window quota decreases', async () => {
    vi.mocked(fetchCpaAuthFiles).mockResolvedValue({
      files: [
        { id: 'auth-healthy', name: 'codex-healthy.json', provider: 'Codex', status: 'ready', email: 'healthy@example.test' },
        { id: 'auth-warning', name: 'codex-warning.json', provider: 'Codex', status: 'ready', email: 'warning@example.test' },
        { id: 'auth-danger', name: 'codex-danger.json', provider: 'Codex', status: 'ready', email: 'danger@example.test' },
      ],
      requestId: 'req-auth-files',
    })
    vi.mocked(fetchCpaAuthFileQuota).mockImplementation(async (name) => {
      const remaining = name.includes('danger') ? 5 : name.includes('warning') ? 20 : 80
      return {
        quota: { status: 'success', planType: 'Pro', subscriptionActiveUntil: null, windows: [{ id: 'five_hour', label: '5 小时窗口', usedPercent: 100 - remaining, remainingPercent: remaining, resetAt: '2026-09-17T11:00:00.000Z', resetAfterSeconds: null }], creditsAvailable: null, checkedAt: '2026-09-17T10:00:00.000Z' },
        requestId: `req-${name}`,
      }
    })
    await mount()
    await vi.waitFor(() => expect(host.querySelectorAll('.codex-account-quota')).toHaveLength(3))

    const expected = ['quota-state-healthy', 'quota-state-warning', 'quota-state-danger']
    const windowExpected = ['quota-window-healthy', 'quota-window-warning', 'quota-window-danger']
    for (const [index, tone] of expected.entries()) {
      const button = host.querySelectorAll<HTMLButtonElement>('.codex-account-quota')[index]
      button.click()
      await vi.waitFor(() => expect(button.classList.contains(tone)).toBe(true))
      expect(button.querySelector(`.${windowExpected[index]}`)).not.toBeNull()
    }
  })
})
