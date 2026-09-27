// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, type App } from 'vue'
import AuditView from './views/AuditView.vue'
import { fetchAuditDetail, fetchAuditEvents, type AuditDetail, type AuditResponse } from './audit-api'

vi.mock('./audit-api', async (importOriginal) => ({ ...await importOriginal<typeof import('./audit-api')>(), fetchAuditDetail: vi.fn(), fetchAuditEvents: vi.fn() }))

const event = {
  id: 'audit-upstream-sync-1a2b3c4d', occurredAt: '2026-09-17T10:00:00.000Z', actor: { id: 'admin-system', name: '超级管理员', role: 'super_admin' as const }, action: 'sync' as const, actionLabel: '同步模型',
  resource: { type: 'upstream' as const, id: 'relay-a', name: '第三方账号 A' }, result: { status: 'success' as const, code: 'RELAY_MODELS_SYNCED' },
  source: { type: 'web' as const, label: 'AI OPS 管理接口', ipMasked: null, client: '管理控制台' }, requestId: 'req-upstream-sync-1a2b3c4d', summary: '已同步第三方账号模型目录。', changes: [], sourceSystem: 'ai_ops' as const, contentAvailable: false as const, credentialValueAvailable: false as const,
}

function response(): AuditResponse {
  return {
    meta: { source: 'database', generatedAt: '2026-09-17T10:00:00.000Z', period: '7d', notice: '统一模型网关审计事件。', sources: [{ id: 'ai_ops', label: 'AI OPS 审计', state: 'ready', count: 1, notice: '平台管理与统一网关事件' }] },
    summary: { total: 1, success: 1, failed: 0, denied: 0, sensitiveChanges: 0 }, options: { actors: [{ id: 'admin-system', label: '超级管理员' }] }, items: [event], pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 }, retention: { mode: 'database', deletionAllowed: false, appendOnlyVerified: false, notice: '页面不提供删除能力。' }, integrity: { deletionAllowed: false, appendOnlyVerified: false, verified: true, hashChainVerified: true, checkpointVerified: true, algorithm: 'sha256', checkedAt: '2026-09-17T10:00:00.000Z', checkpointUpdatedAt: '2026-09-17T10:00:00.000Z', eventCount: 1, firstInvalidEventId: null, notice: '本地校验通过。' },
  }
}

function detail(): AuditDetail {
  return { meta: { source: 'database', generatedAt: '2026-09-17T10:00:00.000Z', notice: '统一模型网关审计事件。' }, event, request: { requestId: event.requestId, traceState: 'database_unverified', responseCode: 200, durationMs: 80 }, integrity: response().integrity, relatedAuditIds: [] }
}

let host: HTMLDivElement
let app: App
beforeEach(() => { vi.resetAllMocks(); host = document.createElement('div'); document.body.append(host); vi.mocked(fetchAuditEvents).mockResolvedValue(response()); vi.mocked(fetchAuditDetail).mockResolvedValue(detail()) })
afterEach(() => { app?.unmount(); window.history.replaceState({}, '', '/'); host.remove() })

describe('audit view', () => {
  it('shows only the current platform audit source and opens a relay-account event', async () => {
    app = createApp(AuditView)
    app.mount(host)
    await vi.waitFor(() => expect(host.querySelector<HTMLButtonElement>('[aria-label="查看 audit-upstream-sync-1a2b3c4d 审计详情"]')).not.toBeNull())
    expect(host.textContent).toContain('AI OPS 审计')
    expect(host.textContent).toContain('第三方账号 A')
    host.querySelector<HTMLButtonElement>('[aria-label="查看 audit-upstream-sync-1a2b3c4d 审计详情"]')!.click()
    await vi.waitFor(() => expect(fetchAuditDetail).toHaveBeenCalledWith('audit-upstream-sync-1a2b3c4d', expect.any(AbortSignal)))
    await vi.waitFor(() => expect(host.textContent).toContain('导出此事件'))
  })

  it('keeps a request-linked audit handoff usable', async () => {
    window.history.replaceState({}, '', '/audit?search=req-upstream-sync-1a2b3c4d&origin=usage_request')
    app = createApp(AuditView)
    app.mount(host)
    await vi.waitFor(() => expect(fetchAuditEvents).toHaveBeenCalledWith(expect.objectContaining({ search: 'req-upstream-sync-1a2b3c4d', resource: 'all', page: 1 }), expect.any(AbortSignal)))
    expect(host.textContent).toContain('正在显示请求 ID“req-upstream-sync-1a2b3c4d”的审计记录')
  })
})
