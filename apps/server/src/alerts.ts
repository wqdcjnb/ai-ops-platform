import { z } from 'zod'
import type { NewApiStatus } from './new-api-status.js'

const severitySchema = z.enum(['critical', 'warning', 'info'])
const statusSchema = z.enum(['open', 'acknowledged', 'closed'])
const sourceSchema = z.enum(['quota', 'traffic', 'error_rate', 'balance', 'credential', 'upstream'])
const environmentSchema = z.enum(['production', 'experiment'])
const channelSchema = z.enum(['none', 'wecom', 'dingtalk'])
const notificationStateSchema = z.enum(['not_configured', 'not_sent', 'sent', 'failed'])

export const alertsQuerySchema = z.object({
  search: z.string().trim().max(80).default(''),
  severity: z.union([z.literal('all'), severitySchema]).default('all'),
  status: z.union([z.literal('all'), statusSchema]).default('all'),
  source: z.union([z.literal('all'), sourceSchema]).default('all'),
  environment: z.union([z.literal('all'), environmentSchema]).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(50).default(10),
})

export const alertParamsSchema = z.object({ id: z.string().regex(/^alert-[a-z0-9-]+$/) })

const subjectSchema = z.object({
  type: z.enum(['company', 'department', 'person', 'key', 'channel', 'upstream']),
  id: z.string(),
  name: z.string(),
})
const ruleRefSchema = z.object({ id: z.string(), name: z.string(), metric: z.string(), thresholdLabel: z.string() })
const notificationSchema = z.object({ state: notificationStateSchema, channel: channelSchema, sentAt: z.string().datetime().nullable() })

export const alertEventSchema = z.object({
  id: z.string(), title: z.string(), summary: z.string(), severity: severitySchema, status: statusSchema,
  environment: environmentSchema, source: sourceSchema, subject: subjectSchema, rule: ruleRefSchema,
  trigger: z.object({ valueLabel: z.string(), comparator: z.enum(['gte', 'gt', 'lte', 'eq']) }),
  firstOccurredAt: z.string().datetime(), lastOccurredAt: z.string().datetime(), occurrences: z.number().int().positive(),
  assignee: z.object({ id: z.string(), name: z.string() }).nullable(),
  acknowledgedAt: z.string().datetime().nullable(), closedAt: z.string().datetime().nullable(),
  notification: notificationSchema, silence: z.object({ active: z.boolean(), until: z.string().datetime().nullable() }),
  relatedRequestIds: z.array(z.string().regex(/^req-[a-z0-9-]+$/)),
})

const metaSchema = z.object({ source: z.literal('demo'), generatedAt: z.string().datetime(), notice: z.string() })
const notificationConfigSchema = z.object({
  configured: z.literal(false),
  channels: z.array(z.object({ type: z.enum(['wecom', 'dingtalk']), state: z.literal('not_configured') })),
  notice: z.string(),
})

export const alertSummaryResponseSchema = z.object({
  meta: metaSchema,
  summary: z.object({ open: z.number().int().nonnegative(), critical: z.number().int().nonnegative(), warning: z.number().int().nonnegative(), experiment: z.number().int().nonnegative(), acknowledged: z.number().int().nonnegative(), closed: z.number().int().nonnegative() }),
  notificationConfig: notificationConfigSchema,
})

export const alertsResponseSchema = z.object({
  meta: metaSchema,
  options: z.object({ sources: z.array(z.object({ id: sourceSchema, label: z.string() })) }),
  items: z.array(alertEventSchema),
  pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }),
})

export const alertRuleSchema = z.object({
  id: z.string(), name: z.string(), category: sourceSchema, severity: severitySchema, enabled: z.boolean(), environment: environmentSchema,
  scope: z.string(), condition: z.string(), window: z.string(), cooldownMinutes: z.number().int().nonnegative(),
  notification: z.object({ configured: z.literal(false), channel: channelSchema }),
  lastTriggeredAt: z.string().datetime().nullable(), triggerCount7d: z.number().int().nonnegative(), description: z.string(),
})

export const alertRulesResponseSchema = z.object({ meta: metaSchema, items: z.array(alertRuleSchema), notificationConfig: notificationConfigSchema })

export const alertDetailResponseSchema = z.object({
  meta: metaSchema,
  item: alertEventSchema,
  analysis: z.object({ cause: z.string(), impact: z.string(), recommendation: z.string(), rawUpstreamBodyAvailable: z.literal(false) }),
  timeline: z.array(z.object({ id: z.string(), type: z.enum(['detected', 'notification', 'acknowledged', 'closed']), occurredAt: z.string().datetime(), title: z.string(), description: z.string() })),
})

export type AlertsQuery = z.infer<typeof alertsQuerySchema>
export type AlertEvent = z.infer<typeof alertEventSchema>
export type AlertRule = z.infer<typeof alertRuleSchema>

const minutesAgo = (now: Date, minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString()
const notificationConfig = {
  configured: false as const,
  channels: [{ type: 'wecom' as const, state: 'not_configured' as const }, { type: 'dingtalk' as const, state: 'not_configured' as const }],
  notice: '企业微信与钉钉通知尚未配置；当前页面仅展示站内演示告警，不会向外发送消息。',
}

function noticeFor(newApi: NewApiStatus) {
  if (newApi.state === 'ready') return 'New API 管理连接已验证；真实告警采集与平台数据库接入前仍使用演示数据'
  if (newApi.state === 'reachable') return 'New API 可达但等待管理认证；告警事件为演示数据'
  if (newApi.state === 'auth_required') return 'New API 管理认证未通过；告警事件为演示数据'
  return 'New API 当前离线；告警事件为演示数据'
}

function meta(newApi: NewApiStatus, now: Date) { return { source: 'demo' as const, generatedAt: now.toISOString(), notice: noticeFor(newApi) } }

function createEvents(now: Date): AlertEvent[] {
  return [
    { id: 'alert-error-global', title: '官方全球组错误率持续升高', summary: '近 5 分钟 5xx 错误率超过严重阈值，路由仍限定在官方生产组。', severity: 'critical', status: 'open', environment: 'production', source: 'error_rate', subject: { type: 'channel', id: 'channel-official-global-1', name: 'Official Global · 01' }, rule: { id: 'rule-error-critical', name: '错误率严重告警', metric: '5xx 错误率', thresholdLabel: '≥ 5% / 5 分钟' }, trigger: { valueLabel: '8.4%', comparator: 'gte' }, firstOccurredAt: minutesAgo(now, 42), lastOccurredAt: minutesAgo(now, 3), occurrences: 7, assignee: null, acknowledgedAt: null, closedAt: null, notification: { state: 'not_configured', channel: 'none', sentAt: null }, silence: { active: false, until: null }, relatedRequestIds: ['req-260915-c412', 'req-260915-a096'] },
    { id: 'alert-balance-low', title: '官方全球账号余额偏低', summary: '按近 7 天消耗速度估算，可用余额低于 3 天安全线。', severity: 'warning', status: 'open', environment: 'production', source: 'balance', subject: { type: 'upstream', id: 'upstream-official-global-1', name: 'Official Global · 01' }, rule: { id: 'rule-balance-low', name: '上游余额预警', metric: '预计可用天数', thresholdLabel: '≤ 3 天' }, trigger: { valueLabel: '2.1 天', comparator: 'lte' }, firstOccurredAt: minutesAgo(now, 310), lastOccurredAt: minutesAgo(now, 35), occurrences: 3, assignee: null, acknowledgedAt: null, closedAt: null, notification: { state: 'not_configured', channel: 'none', sentAt: null }, silence: { active: false, until: null }, relatedRequestIds: [] },
    { id: 'alert-cpa-credential', title: 'CPA 实验凭证即将到期', summary: '实验渠道凭证预计 18 小时后失效，生产路由不会回退至该渠道。', severity: 'critical', status: 'acknowledged', environment: 'experiment', source: 'credential', subject: { type: 'upstream', id: 'upstream-cpa-lab-2', name: 'CPA Lab · 02' }, rule: { id: 'rule-credential-expiry', name: '凭证到期告警', metric: '剩余有效时间', thresholdLabel: '≤ 24 小时' }, trigger: { valueLabel: '18 小时', comparator: 'lte' }, firstOccurredAt: minutesAgo(now, 520), lastOccurredAt: minutesAgo(now, 88), occurrences: 2, assignee: { id: 'admin-demo', name: '超级管理员' }, acknowledgedAt: minutesAgo(now, 76), closedAt: null, notification: { state: 'not_configured', channel: 'none', sentAt: null }, silence: { active: false, until: null }, relatedRequestIds: [] },
    { id: 'alert-quota-content', title: '内容运营部门本月额度接近目标', summary: '部门月度软额度达到 84.7%，当前仅提示，不会阻断请求。', severity: 'warning', status: 'open', environment: 'production', source: 'quota', subject: { type: 'department', id: 'content', name: '内容运营' }, rule: { id: 'rule-quota-warning', name: '软额度 80% 预警', metric: '月度额度使用率', thresholdLabel: '≥ 80%' }, trigger: { valueLabel: '84.7%', comparator: 'gte' }, firstOccurredAt: minutesAgo(now, 930), lastOccurredAt: minutesAgo(now, 120), occurrences: 5, assignee: null, acknowledgedAt: null, closedAt: null, notification: { state: 'not_configured', channel: 'none', sentAt: null }, silence: { active: false, until: null }, relatedRequestIds: [] },
    { id: 'alert-traffic-copy', title: '商品文案用途请求量突增', summary: '10 分钟请求量较过去 7 天同时间段基线高 2.8 倍。', severity: 'info', status: 'acknowledged', environment: 'production', source: 'traffic', subject: { type: 'company', id: 'company-xinzhi', name: '新知科技' }, rule: { id: 'rule-traffic-spike', name: '流量突增提示', metric: '请求量基线倍数', thresholdLabel: '≥ 2.5 倍 / 10 分钟' }, trigger: { valueLabel: '2.8 倍', comparator: 'gte' }, firstOccurredAt: minutesAgo(now, 160), lastOccurredAt: minutesAgo(now, 132), occurrences: 2, assignee: { id: 'admin-demo', name: '超级管理员' }, acknowledgedAt: minutesAgo(now, 128), closedAt: null, notification: { state: 'not_configured', channel: 'none', sentAt: null }, silence: { active: true, until: new Date(now.getTime() + 45 * 60_000).toISOString() }, relatedRequestIds: ['req-260915-8f31'] },
    { id: 'alert-cpa-upstream', title: 'CPA Lab · 01 出现短时 5xx', summary: '实验流量独立运行，异常未跨组影响官方生产渠道。', severity: 'warning', status: 'open', environment: 'experiment', source: 'upstream', subject: { type: 'upstream', id: 'upstream-cpa-lab-1', name: 'CPA Lab · 01' }, rule: { id: 'rule-upstream-failure', name: '上游连续失败', metric: '连续失败次数', thresholdLabel: '≥ 3 次' }, trigger: { valueLabel: '4 次', comparator: 'gte' }, firstOccurredAt: minutesAgo(now, 68), lastOccurredAt: minutesAgo(now, 21), occurrences: 4, assignee: null, acknowledgedAt: null, closedAt: null, notification: { state: 'not_configured', channel: 'none', sentAt: null }, silence: { active: false, until: null }, relatedRequestIds: ['req-260915-55ed', 'req-260915-9dd2'] },
    { id: 'alert-key-limit', title: '林筱雨 Key 达到单小时软目标', summary: 'Key 仅保存掩码；本次达到目标后继续放行，并记录告警。', severity: 'critical', status: 'closed', environment: 'production', source: 'quota', subject: { type: 'key', id: 'key-lin-1', name: 'sk-ops••••••7F2A' }, rule: { id: 'rule-quota-critical', name: '软额度 100% 告警', metric: '小时额度使用率', thresholdLabel: '≥ 100%' }, trigger: { valueLabel: '102.3%', comparator: 'gte' }, firstOccurredAt: minutesAgo(now, 1_320), lastOccurredAt: minutesAgo(now, 1_270), occurrences: 2, assignee: { id: 'admin-demo', name: '超级管理员' }, acknowledgedAt: minutesAgo(now, 1_260), closedAt: minutesAgo(now, 1_190), notification: { state: 'not_configured', channel: 'none', sentAt: null }, silence: { active: false, until: null }, relatedRequestIds: ['req-260914-14ac'] },
    { id: 'alert-channel-recovered', title: 'Official CN · 02 延迟已恢复', summary: 'P95 延迟回落至正常区间，事件已自动关闭。', severity: 'info', status: 'closed', environment: 'production', source: 'upstream', subject: { type: 'channel', id: 'channel-official-cn-2', name: 'Official CN · 02' }, rule: { id: 'rule-upstream-latency', name: '上游延迟异常', metric: 'P95 总耗时', thresholdLabel: '≥ 10 秒 / 10 分钟' }, trigger: { valueLabel: '已恢复至 3.2 秒', comparator: 'lte' }, firstOccurredAt: minutesAgo(now, 2_880), lastOccurredAt: minutesAgo(now, 2_770), occurrences: 6, assignee: null, acknowledgedAt: null, closedAt: minutesAgo(now, 2_760), notification: { state: 'not_configured', channel: 'none', sentAt: null }, silence: { active: false, until: null }, relatedRequestIds: ['req-260913-2f83'] },
  ]
}

function createRules(now: Date): AlertRule[] {
  return [
    { id: 'rule-quota-warning', name: '软额度 80% 预警', category: 'quota', severity: 'warning', enabled: true, environment: 'production', scope: '公司 / 部门 / 人员 / 用途 / Key', condition: '使用率 ≥ 80%', window: '小时 / 日 / 周 / 月', cooldownMinutes: 60, notification: { configured: false, channel: 'none' }, lastTriggeredAt: minutesAgo(now, 120), triggerCount7d: 9, description: '提前提示额度接近目标，不会阻断调用。' },
    { id: 'rule-quota-critical', name: '软额度 100% 告警', category: 'quota', severity: 'critical', enabled: true, environment: 'production', scope: '公司 / 部门 / 人员 / 用途 / Key', condition: '使用率 ≥ 100%', window: '小时 / 日 / 周 / 月', cooldownMinutes: 30, notification: { configured: false, channel: 'none' }, lastTriggeredAt: minutesAgo(now, 1_270), triggerCount7d: 3, description: '达到软目标后记录严重告警，硬阻断仍未启用。' },
    { id: 'rule-traffic-spike', name: '流量突增提示', category: 'traffic', severity: 'info', enabled: true, environment: 'production', scope: '全公司请求', condition: '请求量 ≥ 同期基线 2.5 倍', window: '10 分钟', cooldownMinutes: 30, notification: { configured: false, channel: 'none' }, lastTriggeredAt: minutesAgo(now, 132), triggerCount7d: 4, description: '识别异常请求增长，辅助核对活动或自动化任务。' },
    { id: 'rule-error-critical', name: '错误率严重告警', category: 'error_rate', severity: 'critical', enabled: true, environment: 'production', scope: '官方生产渠道', condition: '5xx 错误率 ≥ 5%', window: '5 分钟', cooldownMinutes: 15, notification: { configured: false, channel: 'none' }, lastTriggeredAt: minutesAgo(now, 3), triggerCount7d: 7, description: '监控生产渠道服务异常，不展示上游完整错误正文。' },
    { id: 'rule-balance-low', name: '上游余额预警', category: 'balance', severity: 'warning', enabled: true, environment: 'production', scope: '官方上游账号', condition: '预计可用天数 ≤ 3 天', window: '每天', cooldownMinutes: 720, notification: { configured: false, channel: 'none' }, lastTriggeredAt: minutesAgo(now, 35), triggerCount7d: 2, description: '按近期消耗估算余额安全天数。' },
    { id: 'rule-credential-expiry', name: '凭证到期告警', category: 'credential', severity: 'critical', enabled: true, environment: 'experiment', scope: 'CPA 实验账号', condition: '剩余有效时间 ≤ 24 小时', window: '每小时', cooldownMinutes: 360, notification: { configured: false, channel: 'none' }, lastTriggeredAt: minutesAgo(now, 88), triggerCount7d: 2, description: '仅返回凭证状态与到期时间，不返回任何凭证内容。' },
  ]
}

export function createDemoAlertSummary(newApi: NewApiStatus, now = new Date()) {
  const events = createEvents(now)
  return {
    meta: meta(newApi, now),
    summary: { open: events.filter((item) => item.status === 'open').length, critical: events.filter((item) => item.status === 'open' && item.severity === 'critical').length, warning: events.filter((item) => item.status === 'open' && item.severity === 'warning').length, experiment: events.filter((item) => item.status !== 'closed' && item.environment === 'experiment').length, acknowledged: events.filter((item) => item.status === 'acknowledged').length, closed: events.filter((item) => item.status === 'closed').length },
    notificationConfig,
  }
}

export function createDemoAlerts(query: AlertsQuery, newApi: NewApiStatus, now = new Date()) {
  const events = createEvents(now)
  const search = query.search.toLocaleLowerCase('zh-CN')
  const filtered = events.filter((item) => {
    const matchesSearch = !search || [item.id, item.title, item.summary, item.subject.name, item.rule.name].some((value) => value.toLocaleLowerCase('zh-CN').includes(search))
    return matchesSearch && (query.severity === 'all' || item.severity === query.severity) && (query.status === 'all' || item.status === query.status) && (query.source === 'all' || item.source === query.source) && (query.environment === 'all' || item.environment === query.environment)
  })
  const start = (query.page - 1) * query.pageSize
  return { meta: meta(newApi, now), options: { sources: [{ id: 'quota' as const, label: '额度' }, { id: 'traffic' as const, label: '流量' }, { id: 'error_rate' as const, label: '错误率' }, { id: 'balance' as const, label: '余额' }, { id: 'credential' as const, label: '凭证' }, { id: 'upstream' as const, label: '上游' }] }, items: filtered.slice(start, start + query.pageSize), pagination: { page: query.page, pageSize: query.pageSize, total: filtered.length, totalPages: Math.ceil(filtered.length / query.pageSize) } }
}

export function createDemoAlertRules(newApi: NewApiStatus, now = new Date()) { return { meta: meta(newApi, now), items: createRules(now), notificationConfig } }

export function createDemoAlertDetail(id: string, newApi: NewApiStatus, now = new Date()) {
  const item = createEvents(now).find((event) => event.id === id)
  if (!item) return null
  const timeline: z.infer<typeof alertDetailResponseSchema>['timeline'] = [
    { id: `${id}-detected`, type: 'detected' as const, occurredAt: item.firstOccurredAt, title: '检测到事件', description: `${item.rule.name}触发：${item.trigger.valueLabel}（阈值 ${item.rule.thresholdLabel}）。` },
    { id: `${id}-notification`, type: 'notification' as const, occurredAt: item.firstOccurredAt, title: '外部通知未发送', description: '企业微信与钉钉尚未配置，事件仅保留在站内。' },
  ]
  if (item.acknowledgedAt) timeline.push({ id: `${id}-ack`, type: 'acknowledged', occurredAt: item.acknowledgedAt, title: '事件已确认', description: `${item.assignee?.name ?? '管理员'}已接手处理。` })
  if (item.closedAt) timeline.push({ id: `${id}-closed`, type: 'closed', occurredAt: item.closedAt, title: '事件已关闭', description: '指标已恢复或演示事件完成处置。' })
  return { meta: meta(newApi, now), item, analysis: { cause: item.summary, impact: item.environment === 'experiment' ? '影响限定在 CPA 实验组，不会跨组回退至生产路径。' : '可能影响对应生产范围；当前软额度告警不会阻断请求。', recommendation: item.source === 'balance' ? '核对供应商账单并安排充值，完成真实通知配置后再启用自动提醒。' : item.source === 'credential' ? '在凭证管理系统中续期并重新验证，不要在页面或日志中粘贴凭证。' : '按关联请求 ID 与渠道健康状态定位问题；确认、关闭和静默将在写接口与审计完成后开放。', rawUpstreamBodyAvailable: false as const }, timeline }
}
