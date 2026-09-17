// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import AlertsView from './views/AlertsView.vue'
import { acknowledgeLocalAlert, fetchAlertDetail, fetchAlertRules, fetchAlerts, fetchAlertSummary, type AlertActionResponse, type AlertDetail, type AlertRules, type AlertsResponse, type AlertSummary } from './alerts-api'

vi.mock('./alerts-api', async (importOriginal) => ({ ...await importOriginal<typeof import('./alerts-api')>(), acknowledgeLocalAlert: vi.fn(), fetchAlertDetail: vi.fn(), fetchAlertRules: vi.fn(), fetchAlerts: vi.fn(), fetchAlertSummary: vi.fn() }))

const meta = { source: 'database' as const, simulated: true as const, generatedAt: '2026-09-17T10:00:00.000Z', notice: '当前读取 SQLite 可重复模拟告警。' }
const notificationConfig = { configured: false as const, channels: [{ type: 'wecom' as const, state: 'not_configured' as const }, { type: 'dingtalk' as const, state: 'not_configured' as const }], notice: '不会向外发送消息。' }
const event = {
  id: 'alert-error-global', title: '官方全球组错误率持续升高', summary: '仅安全摘要。', severity: 'critical' as const, status: 'open' as const, environment: 'production' as const, source: 'error_rate' as const,
  subject: { type: 'channel' as const, id: 'channel-global', name: 'Official Global · 01' }, rule: { id: 'rule-error', name: '错误率严重告警', metric: '5xx 错误率', thresholdLabel: '≥ 5%' }, trigger: { valueLabel: '8.4%', comparator: 'gte' as const },
  firstOccurredAt: '2026-09-17T09:00:00.000Z', lastOccurredAt: '2026-09-17T10:00:00.000Z', occurrences: 2, assignee: null, acknowledgedAt: null, closedAt: null,
  notification: { state: 'not_configured' as const, channel: 'none' as const, sentAt: null }, silence: { active: false, until: null }, relatedRequestIds: ['req-demo-001'],
}
function summary(): AlertSummary { return { meta, summary: { open: 1, critical: 1, warning: 0, experiment: 0, acknowledged: 0, closed: 0 }, notificationConfig } }
function alerts(): AlertsResponse { return { meta, options: { sources: [{ id: 'error_rate', label: '错误率' }] }, items: [event], pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 } } }
function rules(): AlertRules { return { meta, notificationConfig, items: [{ id: 'rule-error', name: '错误率严重告警', category: 'error_rate', severity: 'critical', enabled: true, environment: 'production', scope: '官方生产渠道', condition: '5xx ≥ 5%', window: '5 分钟', cooldownMinutes: 15, notification: { configured: false, channel: 'none' }, lastTriggeredAt: '2026-09-17T10:00:00.000Z', triggerCount7d: 2, description: '仅安全摘要。' }] } }
function detail(): AlertDetail { return { meta, item: event, analysis: { cause: '仅安全摘要。', impact: '可能影响生产范围。', recommendation: '按请求 ID 排查。', rawUpstreamBodyAvailable: false }, timeline: [{ id: 'alert-error-global-detected', type: 'detected', occurredAt: '2026-09-17T09:00:00.000Z', title: '检测到事件', description: '安全说明。' }] } }
function acknowledgedDetail(): AlertDetail { return { ...detail(), item: { ...event, status: 'acknowledged', assignee: { id: 'admin-demo', name: '超级管理员' }, acknowledgedAt: '2026-09-17T10:01:00.000Z' } } }
function acknowledgement(): AlertActionResponse { return { meta: { source: 'database', completedAt: '2026-09-17T10:01:00.000Z', notice: '仅本地模拟。' }, item: acknowledgedDetail().item, operation: { action: 'acknowledge', idempotencyKey: 'alert-ack-1a2b3c4d', idempotent: false, auditEventId: 'audit-alert-ack-1a2b3c4d' } } }

let host: HTMLDivElement
let app: App
function mount(path = '/alerts') { window.history.replaceState({}, '', path); app = createApp(AlertsView); app.mount(host) }
beforeEach(() => {
  vi.resetAllMocks()
  host = document.createElement('div'); document.body.append(host)
  vi.mocked(fetchAlertSummary).mockResolvedValue(summary())
  vi.mocked(fetchAlerts).mockResolvedValue(alerts())
  vi.mocked(fetchAlertRules).mockResolvedValue(rules())
  vi.mocked(fetchAlertDetail).mockResolvedValue(detail())
  vi.mocked(acknowledgeLocalAlert).mockResolvedValue(acknowledgement())
})
afterEach(() => { app?.unmount(); window.history.replaceState({}, '', '/'); host.remove() })

describe('alerts view database simulation', () => {
  it('labels SQLite simulation data, filters events, and keeps the safe detail boundary', async () => {
    app = createApp(AlertsView); app.mount(host)
    await vi.waitFor(() => expect(host.textContent).toContain('SQLite · 模拟数据'))
    const severity = host.querySelector<HTMLSelectElement>('[aria-label="严重度"]')!
    severity.value = 'critical'; severity.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(fetchAlerts).toHaveBeenLastCalledWith(expect.objectContaining({ severity: 'critical', page: 1 }), expect.any(AbortSignal)))
    host.querySelector<HTMLButtonElement>('[aria-label="查看 官方全球组错误率持续升高 详情"]')!.click()
    await vi.waitFor(() => expect(fetchAlertDetail).toHaveBeenCalledWith('alert-error-global', expect.any(AbortSignal)))
    await vi.waitFor(() => expect(host.querySelector('[role="dialog"]')).not.toBeNull())
    expect(host.querySelector('[role="dialog"]')!.textContent).toContain('不保留上游完整正文')
    expect(host.querySelector<HTMLAnchorElement>('[aria-label="查看 req-demo-001 关联调用"]')?.getAttribute('href')).toBe('/usage?requestId=req-demo-001&origin=alert')
  })

  it('links a completed local acknowledgement to its exact safe audit event', async () => {
    app = createApp(AlertsView); app.mount(host)
    await vi.waitFor(() => expect(host.querySelector<HTMLButtonElement>('[aria-label="查看 官方全球组错误率持续升高 详情"]')).not.toBeNull())
    host.querySelector<HTMLButtonElement>('[aria-label="查看 官方全球组错误率持续升高 详情"]')!.click()
    await vi.waitFor(() => expect(host.textContent).toContain('确认告警'))
    ;[...host.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === '确认告警')!.click()
    await vi.waitFor(() => expect(host.querySelector('textarea')).not.toBeNull())
    const reason = host.querySelector<HTMLTextAreaElement>('textarea')!
    reason.value = '已完成本地模拟事件复核并由管理员接手处理'
    reason.dispatchEvent(new Event('input'))
    await nextTick()
    const submit = [...host.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === '确认本地告警')!
    expect(submit.disabled).toBe(false)
    submit.click()
    await vi.waitFor(() => expect(acknowledgeLocalAlert).toHaveBeenCalledWith('alert-error-global', expect.objectContaining({ acknowledgeSimulation: true })))
    await vi.waitFor(() => expect(host.textContent).toContain('处置摘要已写入 SQLite 审计记录'))
    expect(host.querySelector<HTMLAnchorElement>('[aria-label="查看 audit-alert-ack-1a2b3c4d 操作审计"]')?.getAttribute('href')).toBe('/audit?eventId=audit-alert-ack-1a2b3c4d&origin=alert_action')
  })

  it('accepts a safe audit-to-alert filter and removes it when cleared', async () => {
    mount('/alerts?alertId=alert-error-global')
    await vi.waitFor(() => expect(fetchAlerts).toHaveBeenCalledWith(expect.objectContaining({ alertId: 'alert-error-global', page: 1 }), expect.any(AbortSignal)))
    await vi.waitFor(() => expect(host.textContent).toContain('正在显示关联审计记录对应的模拟告警'))
    host.querySelector<HTMLButtonElement>('[aria-label="清除关联告警筛选"]')!.click()
    await vi.waitFor(() => expect(fetchAlerts).toHaveBeenLastCalledWith(expect.objectContaining({ alertId: '', subjectId: '', page: 1 }), expect.any(AbortSignal)))
    expect(window.location.search).toBe('')
  })
})
