// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, type App } from 'vue'
import AuditView from './views/AuditView.vue'
import { fetchAuditDetail, fetchAuditEvents, type AuditDetail, type AuditResponse } from './audit-api'

vi.mock('./audit-api', async (importOriginal) => ({ ...await importOriginal<typeof import('./audit-api')>(), fetchAuditDetail: vi.fn(), fetchAuditEvents: vi.fn() }))

const event = {
  id: 'audit-alert-ack-1a2b3c4d', occurredAt: '2026-09-17T10:00:00.000Z', actor: { id: 'admin-demo', name: '超级管理员', role: 'super_admin' as const }, action: 'acknowledge' as const, actionLabel: '确认告警',
  resource: { type: 'alert' as const, id: 'alert-error-global', name: '官方全球组错误率持续升高' }, result: { status: 'success' as const, code: 'ALERT_ACKNOWLEDGED' },
  source: { type: 'web' as const, label: '告警中心', ipMasked: null, client: '客户端信息未采集' }, requestId: 'req-alert-ack-1a2b3c4d', summary: '已记录字段级操作摘要。', changes: [], contentAvailable: false as const, credentialValueAvailable: false as const,
}
function response(): AuditResponse {
  return {
    meta: { source: 'database', generatedAt: '2026-09-17T10:00:00.000Z', period: '7d', notice: 'SQLite 审计事件。' }, summary: { total: 1, success: 1, failed: 0, denied: 0, sensitiveChanges: 0 }, options: { actors: [{ id: 'admin-demo', label: '超级管理员' }] }, items: [event], pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 }, retention: { mode: 'database', deletionAllowed: false, appendOnlyVerified: false, notice: '页面不提供删除能力。' }, integrity: { deletionAllowed: false, appendOnlyVerified: false, verified: true, hashChainVerified: true, checkpointVerified: true, algorithm: 'sha256', checkedAt: '2026-09-17T10:00:00.000Z', checkpointUpdatedAt: '2026-09-17T10:00:00.000Z', eventCount: 1, firstInvalidEventId: null, notice: '本地校验通过。' },
  }
}
function detail(): AuditDetail { return { meta: { source: 'database', generatedAt: '2026-09-17T10:00:00.000Z', notice: 'SQLite 审计事件。' }, event, request: { requestId: event.requestId, traceState: 'database_unverified', responseCode: 200, durationMs: 80 }, integrity: response().integrity, relatedAuditIds: [] } }

let host: HTMLDivElement
let app: App
beforeEach(() => { vi.resetAllMocks(); host = document.createElement('div'); document.body.append(host); vi.mocked(fetchAuditEvents).mockResolvedValue(response()); vi.mocked(fetchAuditDetail).mockResolvedValue(detail()) })
afterEach(() => { app?.unmount(); window.history.replaceState({}, '', '/'); host.remove() })

describe('audit view historic alert records', () => {
  it('keeps an exact historic alert audit record readable without routing to a removed module', async () => {
    window.history.replaceState({}, '', '/audit?eventId=audit-alert-ack-1a2b3c4d&origin=alert_action')
    app = createApp(AuditView); app.mount(host)
    await vi.waitFor(() => expect(fetchAuditEvents).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'audit-alert-ack-1a2b3c4d', page: 1 }), expect.any(AbortSignal)))
    expect(host.textContent).toContain('正在显示本次告警处置的审计记录')
    host.querySelector<HTMLButtonElement>('[aria-label="清除告警处置审计关联"]')!.click()
    await vi.waitFor(() => expect(fetchAuditEvents).toHaveBeenLastCalledWith(expect.objectContaining({ eventId: '', page: 1 }), expect.any(AbortSignal)))
    expect(window.location.search).toBe('')
    host.querySelector<HTMLButtonElement>('[aria-label="查看 audit-alert-ack-1a2b3c4d 审计详情"]')!.click()
    await vi.waitFor(() => expect(fetchAuditDetail).toHaveBeenCalledWith('audit-alert-ack-1a2b3c4d', expect.any(AbortSignal)))
    await vi.waitFor(() => expect(host.textContent).toContain('已下线的告警中心'))
    expect(host.querySelector('[aria-label="查看 alert-error-global 关联告警"]')).toBeNull()
  })

  it('supports a quota detail handoff and can clear the linked scope', async () => {
    window.history.replaceState({}, '', '/audit?resource=quota&search=内容运营%20%C2%B7%20月度软目标')
    app = createApp(AuditView); app.mount(host)
    await vi.waitFor(() => expect(fetchAuditEvents).toHaveBeenCalledWith(expect.objectContaining({ resource: 'quota', search: '内容运营 · 月度软目标', page: 1 }), expect.any(AbortSignal)))
    expect(host.textContent).toContain('正在显示“内容运营 · 月度软目标”的额度审计记录')
    expect(host.querySelector<HTMLButtonElement>('[aria-label="清除额度审计关联"]')).not.toBeNull()
    host.querySelector<HTMLButtonElement>('[aria-label="清除额度审计关联"]')!.click()
    await vi.waitFor(() => expect(window.location.search).toBe(''))
  })

  it('supports a usage request handoff and labels the request-linked audit filter', async () => {
    window.history.replaceState({}, '', '/audit?search=req-demo-007&origin=usage_request')
    app = createApp(AuditView); app.mount(host)
    await vi.waitFor(() => expect(fetchAuditEvents).toHaveBeenCalledWith(expect.objectContaining({ search: 'req-demo-007', resource: 'all', page: 1 }), expect.any(AbortSignal)))
    expect(host.textContent).toContain('正在显示请求 ID“req-demo-007”的审计记录')
    expect(host.querySelector<HTMLButtonElement>('[aria-label="清除请求审计关联"]')).not.toBeNull()
  })

  it('labels an exact management mutation audit handoff', async () => {
    window.history.replaceState({}, '', '/audit?eventId=audit-quota-update-test&origin=mutation')
    app = createApp(AuditView); app.mount(host)
    await vi.waitFor(() => expect(fetchAuditEvents).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'audit-quota-update-test', page: 1 }), expect.any(AbortSignal)))
    expect(host.textContent).toContain('正在显示本次管理操作的审计记录')
    expect(host.querySelector<HTMLButtonElement>('[aria-label="清除管理操作审计关联"]')).not.toBeNull()
  })

  it('opens external metadata events with the shared export action', async () => {
    const externalEvent = { ...event, id: 'audit-cpa-fixture-1', requestId: 'req-cpa-fixture-1', sourceSystem: 'cpa' as const, actionLabel: '网关调用', resource: { type: 'gateway_request' as const, id: 'req-cpa-fixture-1', name: 'GET /v1/models' }, source: { type: 'system' as const, label: 'CPA 运行日志', ipMasked: '10.20.30.*', client: 'CPA · main.log' }, summary: '耗时 18ms · Trace trace-cpa-fixture', transport: { responseCode: 200, durationMs: 18, traceId: 'trace-cpa-fixture' } }
    vi.mocked(fetchAuditEvents).mockResolvedValue({ ...response(), items: [externalEvent], summary: { total: 1, success: 1, failed: 0, denied: 0, sensitiveChanges: 0 } })
    vi.mocked(fetchAuditDetail).mockResolvedValue({ ...detail(), event: externalEvent, integrity: { ...response().integrity, verified: false, hashChainVerified: false, checkpointVerified: false, algorithm: 'not_configured', eventCount: 0, notice: '外部只读日志。' }, relatedAuditIds: [] })
    app = createApp(AuditView); app.mount(host)
    await vi.waitFor(() => expect(host.querySelector<HTMLButtonElement>('[aria-label="查看 audit-cpa-fixture-1 审计详情"]')).not.toBeNull())
    host.querySelector<HTMLButtonElement>('[aria-label="查看 audit-cpa-fixture-1 审计详情"]')!.click()
    await vi.waitFor(() => expect(fetchAuditDetail).toHaveBeenCalledWith('audit-cpa-fixture-1', expect.any(AbortSignal)))
    await vi.waitFor(() => expect(host.querySelector<HTMLButtonElement>('button[aria-label="关闭详情"]')).not.toBeNull())
    expect(host.textContent).toContain('导出此事件')
    expect(host.textContent).toContain('外部元数据只读')
  })
})
