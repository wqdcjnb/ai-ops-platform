import { describe, expect, it } from 'vitest'
import { alertAcknowledgeBodySchema, alertActionResponseSchema, alertCloseBodySchema, alertDetailResponseSchema, alertFiltersSchema, alertRulesResponseSchema, alertSummaryResponseSchema, alertsResponseSchema } from './alerts-api'

const meta = { source: 'database', simulated: true, generatedAt: '2026-09-15T10:00:00.000Z', notice: '模拟数据' }
const notificationConfig = { configured: false, channels: [{ type: 'wecom', state: 'not_configured' }], notice: '未配置' }
const item = { id: 'alert-test', title: '测试告警', summary: '脱敏摘要', severity: 'critical', status: 'open', environment: 'production', source: 'error_rate', subject: { type: 'channel', id: 'channel-1', name: '渠道一' }, rule: { id: 'rule-1', name: '错误率规则', metric: '5xx', thresholdLabel: '≥ 5%' }, trigger: { valueLabel: '8%', comparator: 'gte' }, firstOccurredAt: '2026-09-15T09:00:00.000Z', lastOccurredAt: '2026-09-15T10:00:00.000Z', occurrences: 2, assignee: null, acknowledgedAt: null, closedAt: null, notification: { state: 'not_configured', channel: 'none', sentAt: null }, silence: { active: false, until: null }, relatedRequestIds: ['req-test-1'] }

describe('alert API contracts', () => {
  it('validates explicit filters, summaries and safe event metadata', () => {
    expect(alertFiltersSchema.safeParse({ search: '', subjectId: 'upstream-cpa-lab-2', alertId: 'alert-error-global', severity: 'critical', status: 'open', source: 'error_rate', environment: 'production', page: 1, pageSize: 10 }).success).toBe(true)
    expect(alertFiltersSchema.safeParse({ search: '', subjectId: 'upstream_cpa_lab_2', severity: 'fatal', status: 'open', source: 'error_rate', environment: 'production', page: 0, pageSize: 10 }).success).toBe(false)
    expect(alertFiltersSchema.safeParse({ search: '', subjectId: '', alertId: 'not-an-alert-event', severity: 'critical', status: 'open', source: 'error_rate', environment: 'production', page: 1, pageSize: 10 }).success).toBe(false)
    expect(alertSummaryResponseSchema.safeParse({ meta, summary: { open: 1, critical: 1, warning: 0, experiment: 0, acknowledged: 0, closed: 0 }, notificationConfig }).success).toBe(true)
    expect(alertsResponseSchema.safeParse({ meta, options: { sources: [{ id: 'error_rate', label: '错误率' }] }, items: [item], pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 } }).success).toBe(true)
  })

  it('requires unconfigured notifications and rejects raw upstream bodies', () => {
    const rules = { meta, notificationConfig, items: [{ id: 'rule-1', name: '规则', category: 'quota', severity: 'warning', enabled: true, environment: 'production', scope: '公司', condition: '≥ 80%', window: '月', cooldownMinutes: 60, notification: { configured: false, channel: 'none' }, lastTriggeredAt: null, triggerCount7d: 0, description: '说明' }] }
    expect(alertRulesResponseSchema.safeParse(rules).success).toBe(true)
    expect(alertRulesResponseSchema.safeParse({ ...rules, notificationConfig: { ...notificationConfig, configured: true } }).success).toBe(false)
    const detail = { meta, item, analysis: { cause: '摘要', impact: '范围', recommendation: '建议', rawUpstreamBodyAvailable: false }, timeline: [{ id: 'event-1', type: 'detected', occurredAt: '2026-09-15T09:00:00.000Z', title: '检测到', description: '说明' }] }
    expect(alertDetailResponseSchema.safeParse(detail).success).toBe(true)
    expect(alertDetailResponseSchema.safeParse({ ...detail, analysis: { ...detail.analysis, rawUpstreamBodyAvailable: true } }).success).toBe(false)
  })

  it('accepts only explicit local simulated acknowledgement and close payloads', () => {
    expect(alertAcknowledgeBodySchema.safeParse({ idempotencyKey: 'alert-ack-1a2b3c4d', reason: '完成本地模拟告警复核并接手处置', acknowledgeSimulation: true }).success).toBe(true)
    expect(alertCloseBodySchema.safeParse({ idempotencyKey: 'alert-close-1a2b3c4d', reason: '完成本地模拟告警复核并关闭事件', acknowledgeSimulation: true }).success).toBe(true)
    expect(alertCloseBodySchema.safeParse({ idempotencyKey: 'alert-ack-1a2b3c4d', reason: '完成本地模拟告警复核并关闭事件', acknowledgeSimulation: true }).success).toBe(false)
    expect(alertActionResponseSchema.safeParse({ meta: { source: 'database', completedAt: '2026-09-17T10:00:00.000Z', notice: '仅本地模拟' }, item: { ...item, status: 'acknowledged', assignee: { id: 'user-super-admin', name: '超级管理员' }, acknowledgedAt: '2026-09-17T10:00:00.000Z' }, operation: { action: 'acknowledge', idempotencyKey: 'alert-ack-1a2b3c4d', idempotent: false, auditEventId: 'audit-alert-ack-1a2b3c4d' } }).success).toBe(true)
  })
})
