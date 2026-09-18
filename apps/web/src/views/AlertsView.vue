<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  IconAlertCircle, IconAlertTriangle, IconArrowLeft, IconArrowRight, IconBell, IconBellOff,
  IconChevronRight, IconCircleCheck, IconClock, IconFilter, IconRefresh, IconSearch, IconSettings, IconShieldCheck, IconX,
} from '@tabler/icons-vue'
import { acknowledgeLocalAlert, AlertsApiError, closeLocalAlert, fetchAlertDetail, fetchAlertRules, fetchAlerts, fetchAlertSummary, updateLocalAlertRule, type AlertAcknowledgeBody, type AlertCloseBody, type AlertDetail, type AlertEvent, type AlertFilters, type AlertRule, type AlertRuleUpdateBody, type AlertRules, type AlertsResponse, type AlertSummary } from '../alerts-api'
import { useDebouncedSearch } from '../composables/useDebouncedSearch'

const summary = ref<AlertSummary | null>(null)
const alerts = ref<AlertsResponse | null>(null)
const rules = ref<AlertRules | null>(null)
const detail = ref<AlertDetail | null>(null)
const activeTab = ref<'events' | 'rules'>('events')
const initialQuery = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search)
const search = ref(initialQuery?.get('search') ?? '')
const subjectId = ref((initialQuery?.get('subjectId') ?? '').match(/^[a-z0-9-]{1,80}$/) ? initialQuery!.get('subjectId')! : '')
const alertId = ref((initialQuery?.get('alertId') ?? '').match(/^alert-[a-z0-9-]{1,80}$/) ? initialQuery!.get('alertId')! : '')
const severity = ref<AlertFilters['severity']>('all')
const status = ref<AlertFilters['status']>('all')
const source = ref<AlertFilters['source']>('all')
const environment = ref<AlertFilters['environment']>('all')
const page = ref(1)
const pageSize = 10
const isLoading = ref(false)
const detailLoadingId = ref('')
const errorMessage = ref('')
const action = ref<'acknowledge' | 'close' | null>(null)
const actionError = ref('')
const isActing = ref(false)
const actionForm = ref<AlertAcknowledgeBody | AlertCloseBody>({ idempotencyKey: '', reason: '', acknowledgeSimulation: true })
const actionReceipt = ref<{ action: 'acknowledge' | 'close'; auditEventId: string } | null>(null)
const editingRule = ref<AlertRule | null>(null)
const ruleError = ref('')
const isRuleSaving = ref(false)
const ruleForm = ref<AlertRuleUpdateBody>({ severity: 'warning', enabled: true, condition: '', window: '', cooldownMinutes: 30, reason: '', acknowledgeSimulation: true, idempotencyKey: '' })
const ruleReceipt = ref<{ ruleName: string; auditEventId: string } | null>(null)
let request: AbortController | undefined
let eventsRequest: AbortController | undefined
let detailRequest: AbortController | undefined
let eventsRevision = 0

const severityText = { critical: '严重', warning: '警告', info: '提示' }
const statusText = { open: '待处理', acknowledged: '已确认', closed: '已关闭' }
const sourceText = { quota: '额度', traffic: '流量', error_rate: '错误率', balance: '余额', credential: '凭证', upstream: '上游' }
const environmentText = { production: '生产', experiment: '实验' }
const updatedAt = computed(() => summary.value ? timeText(summary.value.meta.generatedAt) : '—')
const hasRelatedFilter = computed(() => Boolean(subjectId.value || alertId.value))
const relatedFilterMessage = computed(() => alertId.value ? '正在显示关联审计记录对应的模拟告警' : '正在显示关联对象的模拟告警')
const summaryCards = computed(() => {
  const value = summary.value?.summary
  return [
    { label: '待处理', value: value?.open ?? '—', hint: '需要跟进的事件', icon: IconAlertCircle, tone: 'red' },
    { label: '严重', value: value?.critical ?? '—', hint: '待处理严重事件', icon: IconAlertTriangle, tone: 'red' },
    { label: '警告', value: value?.warning ?? '—', hint: '待处理警告事件', icon: IconBell, tone: 'amber' },
    { label: '实验环境', value: value?.experiment ?? '—', hint: '未关闭实验事件', icon: IconShieldCheck, tone: 'violet' },
    { label: '已确认', value: value?.acknowledged ?? '—', hint: `另有 ${value?.closed ?? 0} 条已关闭`, icon: IconCircleCheck, tone: 'teal' },
  ]
})

function filters(): AlertFilters { return { search: search.value.trim(), subjectId: subjectId.value, alertId: alertId.value, severity: severity.value, status: status.value, source: source.value, environment: environment.value, page: page.value, pageSize } }
function timeText(value: string) { return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) }
function applyFilters() { cancelSearch(); page.value = 1; void loadEvents() }
function removeRelatedAlertQuery() {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  params.delete('subjectId'); params.delete('alertId')
  window.history.replaceState({}, '', `${window.location.pathname}${params.size ? `?${params}` : ''}${window.location.hash}`)
}
function clearFilters() { search.value = ''; subjectId.value = ''; alertId.value = ''; severity.value = 'all'; status.value = 'all'; source.value = 'all'; environment.value = 'all'; removeRelatedAlertQuery(); applyFilters() }
function clearRelatedFilter() { cancelSearch(); subjectId.value = ''; alertId.value = ''; removeRelatedAlertQuery(); page.value = 1; void loadEvents() }
function changePage(next: number) { if (!alerts.value || next < 1 || next > alerts.value.pagination.totalPages) return; page.value = next; void loadEvents() }

async function loadEvents() {
  eventsRequest?.abort()
  const next = new AbortController()
  eventsRequest = next
  const revision = ++eventsRevision
  try {
    const nextAlerts = await fetchAlerts(filters(), next.signal)
    if (next.signal.aborted || eventsRequest !== next || revision !== eventsRevision) return
    alerts.value = nextAlerts
  } catch (error) {
    if (next.signal.aborted || eventsRequest !== next || revision !== eventsRevision) return
    const requestId = error instanceof AlertsApiError ? error.requestId : undefined
    errorMessage.value = `${error instanceof Error ? error.message : '告警事件暂时无法加载'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  }
}
async function loadData() {
  request?.abort()
  const next = new AbortController()
  request = next
  const revision = ++eventsRevision
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [summaryValue, alertsValue, rulesValue] = await Promise.all([fetchAlertSummary(next.signal), fetchAlerts(filters(), next.signal), fetchAlertRules(next.signal)])
    if (next.signal.aborted || request !== next) return
    summary.value = summaryValue; rules.value = rulesValue
    if (revision === eventsRevision) alerts.value = alertsValue
  } catch (error) {
    if (next.signal.aborted || request !== next || revision !== eventsRevision) return
    const requestId = error instanceof AlertsApiError ? error.requestId : undefined
    errorMessage.value = `${error instanceof Error ? error.message : '告警中心暂时无法加载'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally { if (request === next) isLoading.value = false }
}

async function openDetail(item: AlertEvent) {
  detailRequest?.abort()
  const next = new AbortController()
  detailRequest = next
  detailLoadingId.value = item.id
  try { detail.value = await fetchAlertDetail(item.id, next.signal); actionReceipt.value = null }
  catch (error) { if (!next.signal.aborted) errorMessage.value = error instanceof Error ? error.message : '告警详情暂时无法加载' }
  finally { if (detailRequest === next) detailLoadingId.value = '' }
}

function idempotencyKey(nextAction: 'acknowledge' | 'close') { return `alert-${nextAction === 'acknowledge' ? 'ack' : 'close'}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}` }
function ruleIdempotencyKey() { return `alert-rule-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}` }
function openAction(nextAction: 'acknowledge' | 'close') {
  if (!detail.value || detail.value.item.status === 'closed' || (nextAction === 'acknowledge' && detail.value.item.status !== 'open')) return
  action.value = nextAction
  actionError.value = ''
  actionForm.value = { idempotencyKey: idempotencyKey(nextAction), reason: '', acknowledgeSimulation: true }
}
function closeAction() { if (!isActing.value) { action.value = null; actionError.value = '' } }
async function submitAction() {
  if (!detail.value || !action.value) return
  const nextAction = action.value
  actionError.value = ''
  isActing.value = true
  try {
    const result = nextAction === 'acknowledge'
      ? await acknowledgeLocalAlert(detail.value.item.id, actionForm.value as AlertAcknowledgeBody)
      : await closeLocalAlert(detail.value.item.id, actionForm.value as AlertCloseBody)
    detail.value = await fetchAlertDetail(result.item.id)
    await loadData()
    actionReceipt.value = { action: result.operation.action, auditEventId: result.operation.auditEventId }
    action.value = null
  } catch (error) {
    const requestId = error instanceof AlertsApiError ? error.requestId : undefined
    actionError.value = `${error instanceof Error ? error.message : '本地模拟告警处置失败'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally { isActing.value = false }
}

function openRuleEditor(rule: AlertRule) {
  if (isRuleSaving.value) return
  editingRule.value = rule
  ruleError.value = ''
  ruleForm.value = { severity: rule.severity, enabled: rule.enabled, condition: rule.condition, window: rule.window, cooldownMinutes: rule.cooldownMinutes, reason: '', acknowledgeSimulation: true, idempotencyKey: ruleIdempotencyKey() }
}
function closeRuleEditor() { if (!isRuleSaving.value) { editingRule.value = null; ruleError.value = '' } }
async function submitRuleEdit() {
  if (!editingRule.value) return
  ruleError.value = ''
  isRuleSaving.value = true
  try {
    const result = await updateLocalAlertRule(editingRule.value.id, ruleForm.value)
    ruleReceipt.value = { ruleName: result.rule.name, auditEventId: result.operation.auditEventId }
    editingRule.value = null
    await loadData()
  } catch (error) {
    const requestId = error instanceof AlertsApiError ? error.requestId : undefined
    ruleError.value = `${error instanceof Error ? error.message : '本地告警规则编辑失败'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally { isRuleSaving.value = false }
}

const { cancel: cancelSearch } = useDebouncedSearch(search, () => { page.value = 1; void loadEvents() })

onMounted(() => void loadData())
onBeforeUnmount(() => { request?.abort(); eventsRequest?.abort(); detailRequest?.abort() })
</script>

<template>
  <div class="dashboard alerts-dashboard">
    <section class="page-heading"><div><div class="eyebrow">ALERT CENTER</div><h1>告警中心</h1><p>集中查看额度、错误率、流量、余额、凭证与上游异常。</p></div><div class="heading-actions"><span class="updated-at">更新于 {{ updatedAt }}</span><button class="btn btn-white refresh-button" :disabled="isLoading" @click="loadData"><IconRefresh :size="17" :class="{ spinning: isLoading }" />刷新</button><button class="btn" disabled title="本地编辑已开放；新建规则暂未开放"><IconSettings :size="16" />新建规则</button></div></section>
    <div v-if="summary" class="source-banner"><span>SQLite · 模拟数据</span>{{ summary.meta.notice }}</div>
    <section class="alerts-summary-grid" aria-label="告警汇总"><article v-for="card in summaryCards" :key="card.label" class="metric-card"><div class="metric-top"><span class="metric-label">{{ card.label }}</span><span class="metric-icon" :class="`tone-${card.tone}`"><component :is="card.icon" :size="19" /></span></div><strong class="metric-value">{{ card.value }}</strong><div class="metric-foot">{{ card.hint }}</div></article></section>

    <div v-if="!summary && !errorMessage" class="panel data-state"><div class="state-icon"><IconRefresh :size="22" class="spinning" /></div><div><strong>正在聚合告警</strong><p>正在读取事件、规则和通知配置状态…</p></div></div>
    <div v-else-if="errorMessage && !summary" class="panel data-state failed"><div class="state-icon"><IconAlertTriangle :size="22" /></div><div><strong>告警中心加载失败</strong><p>{{ errorMessage }}</p></div><button class="btn btn-white" @click="loadData">重试</button></div>

    <template v-else-if="summary && alerts && rules">
      <section class="notification-banner"><span><IconBellOff :size="19" /></span><div><strong>外部通知尚未配置</strong><p>{{ summary.notificationConfig.notice }}</p></div><div class="notification-channels"><em v-for="channel in summary.notificationConfig.channels" :key="channel.type">{{ channel.type === 'wecom' ? '企业微信' : '钉钉' }} · 未配置</em></div></section>

      <section class="panel alert-workbench">
          <header class="alert-tabs" role="tablist" aria-label="告警中心视图"><button :class="{ active: activeTab === 'events' }" role="tab" :aria-selected="activeTab === 'events'" @click="activeTab = 'events'">事件 <span>{{ alerts.pagination.total }}</span></button><button :class="{ active: activeTab === 'rules' }" role="tab" :aria-selected="activeTab === 'rules'" @click="activeTab = 'rules'">规则 <span>{{ rules.items.length }}</span></button><small>SQLite 模拟数据 · 规则可本地编辑</small></header>

        <template v-if="activeTab === 'events'">
          <form class="alert-filters" @submit.prevent="applyFilters"><label class="alert-search"><IconSearch :size="15" /><input v-model="search" aria-label="关键词" maxlength="80" type="search" placeholder="事件、对象、规则或告警 ID" /></label><label><IconAlertTriangle :size="14" /><select v-model="severity" aria-label="严重度" @change="applyFilters"><option value="all">全部严重度</option><option value="critical">严重</option><option value="warning">警告</option><option value="info">提示</option></select></label><label><IconCircleCheck :size="14" /><select v-model="status" aria-label="状态" @change="applyFilters"><option value="all">全部状态</option><option value="open">待处理</option><option value="acknowledged">已确认</option><option value="closed">已关闭</option></select></label><label><IconFilter :size="14" /><select v-model="source" aria-label="来源" @change="applyFilters"><option value="all">全部来源</option><option v-for="option in alerts.options.sources" :key="option.id" :value="option.id">{{ option.label }}</option></select></label><label><IconShieldCheck :size="14" /><select v-model="environment" aria-label="环境" @change="applyFilters"><option value="all">全部环境</option><option value="production">生产</option><option value="experiment">实验</option></select></label><span class="realtime-search-hint" aria-live="polite">输入即搜索</span><button class="text-button" type="button" @click="clearFilters">清除</button></form>
          <div v-if="hasRelatedFilter" class="alert-related-filter" role="status"><span><IconFilter :size="15" />{{ relatedFilterMessage }}</span><button class="text-button" type="button" aria-label="清除关联告警筛选" @click="clearRelatedFilter">清除关联</button></div>
          <div v-if="alerts.items.length" class="alert-event-list"><article v-for="item in alerts.items" :key="item.id" class="alert-event" :class="`severity-${item.severity}`"><span class="alert-severity-icon"><IconAlertTriangle v-if="item.severity !== 'info'" :size="18" /><IconAlertCircle v-else :size="18" /></span><div class="alert-event-main"><div><span class="severity-chip" :class="item.severity">{{ severityText[item.severity] }}</span><span class="environment-tag" :class="item.environment">{{ environmentText[item.environment] }}</span><code>{{ item.id }}</code></div><strong>{{ item.title }}</strong><p>{{ item.summary }}</p><small>{{ item.subject.name }} · {{ sourceText[item.source] }} · {{ item.rule.name }}</small></div><div class="alert-trigger"><small>触发值 / 阈值</small><strong>{{ item.trigger.valueLabel }}</strong><span>{{ item.rule.thresholdLabel }}</span></div><div class="alert-history"><small>最近发生</small><strong>{{ timeText(item.lastOccurredAt) }}</strong><span>{{ item.occurrences }} 次 · {{ item.silence.active ? '静默中' : '未静默' }}</span></div><div class="alert-owner"><span class="alert-state" :class="item.status"><i />{{ statusText[item.status] }}</span><small>{{ item.assignee?.name ?? '未分派' }}</small><em>{{ item.notification.state === 'not_configured' ? '通知未配置' : '通知已处理' }}</em></div><button class="row-action enabled" :disabled="detailLoadingId === item.id" :aria-label="`查看 ${item.title} 详情`" @click="openDetail(item)"><IconRefresh v-if="detailLoadingId === item.id" :size="15" class="spinning" /><IconChevronRight v-else :size="17" /></button></article></div>
          <div v-else class="people-empty"><IconBellOff :size="25" /><strong>没有符合条件的告警事件</strong><span>调整严重度、状态、来源或环境筛选。</span><button class="text-button" @click="clearFilters">清除筛选</button></div>
          <footer class="usage-pagination"><span>共 {{ alerts.pagination.total }} 条 · 第 {{ alerts.pagination.page }}/{{ Math.max(alerts.pagination.totalPages, 1) }} 页</span><div><button :disabled="alerts.pagination.page <= 1" aria-label="上一页" @click="changePage(alerts.pagination.page - 1)"><IconArrowLeft :size="15" /></button><button :disabled="alerts.pagination.page >= alerts.pagination.totalPages" aria-label="下一页" @click="changePage(alerts.pagination.page + 1)"><IconArrowRight :size="15" /></button></div></footer>
        </template>

        <template v-else>
          <div class="alert-rules-heading"><div><strong>规则目录</strong><p>可编辑启用状态、严重度、触发条件、统计窗口和冷却时间；只写入本地 SQLite，并保留安全审计摘要。</p></div><span class="source-tag live">SQLite</span></div>
          <div v-if="ruleReceipt" class="alert-action-success alert-rule-receipt" role="status"><div><IconCircleCheck :size="18" /><div><strong>已更新本地告警规则</strong><p>{{ ruleReceipt.ruleName }} 的编辑摘要已写入 SQLite 审计记录，不保存编辑说明原文。</p></div></div><a :href="`/audit?eventId=${encodeURIComponent(ruleReceipt.auditEventId)}&origin=mutation`" :aria-label="`查看 ${ruleReceipt.auditEventId} 规则编辑审计`">查看操作审计<IconChevronRight :size="15" /></a></div>
          <div class="alert-rule-grid"><article v-for="rule in rules.items" :key="rule.id" class="alert-rule-card"><header><span class="severity-chip" :class="rule.severity">{{ severityText[rule.severity] }}</span><span class="environment-tag" :class="rule.environment">{{ environmentText[rule.environment] }}</span><span class="rule-enabled" :class="{ disabled: !rule.enabled }"><i />{{ rule.enabled ? '已启用' : '已停用' }}</span></header><strong>{{ rule.name }}</strong><p>{{ rule.description }}</p><dl><div><dt>监控范围</dt><dd>{{ rule.scope }}</dd></div><div><dt>触发条件</dt><dd>{{ rule.condition }}</dd></div><div><dt>统计窗口</dt><dd>{{ rule.window }}</dd></div><div><dt>冷却时间</dt><dd>{{ rule.cooldownMinutes }} 分钟</dd></div><div><dt>近 7 天触发</dt><dd>{{ rule.triggerCount7d }} 次</dd></div><div><dt>外部通知</dt><dd class="not-configured">未配置</dd></div></dl><footer><small>最近触发 {{ rule.lastTriggeredAt ? timeText(rule.lastTriggeredAt) : '—' }}</small><button class="btn btn-white" @click="openRuleEditor(rule)">编辑规则</button></footer></article></div>
        </template>
      </section>
      <footer class="page-footer">数据来源：SQLite 模拟数据 · 可确认或关闭本地模拟告警，可编辑现有规则；新建规则、静默、外部通知和真实事件处置保持禁用 · 不返回凭证或上游完整错误正文</footer>
    </template>

    <div v-if="detail" class="drawer-backdrop" @click.self="detail = null"><aside class="model-drawer alert-drawer" role="dialog" aria-modal="true" aria-label="告警事件详情"><header><div><span class="source-tag live">SQLite</span><h2>告警详情</h2></div><button class="icon-button" aria-label="关闭详情" @click="detail = null"><IconX :size="20" /></button></header>
      <section class="alert-drawer-hero" :class="detail.item.severity"><span><IconAlertTriangle :size="21" /></span><div><div><span class="severity-chip" :class="detail.item.severity">{{ severityText[detail.item.severity] }}</span><span class="environment-tag" :class="detail.item.environment">{{ environmentText[detail.item.environment] }}</span></div><strong>{{ detail.item.title }}</strong><code>{{ detail.item.id }}</code></div><span class="alert-state" :class="detail.item.status"><i />{{ statusText[detail.item.status] }}</span></section>
      <section v-if="actionReceipt" class="alert-action-success" role="status"><div><IconCircleCheck :size="18" /><div><strong>已{{ actionReceipt.action === 'acknowledge' ? '确认' : '关闭' }}本地模拟告警</strong><p>处置摘要已写入 SQLite 审计记录，不保存说明原文。</p></div></div><a :href="`/audit?eventId=${encodeURIComponent(actionReceipt.auditEventId)}&origin=alert_action`" :aria-label="`查看 ${actionReceipt.auditEventId} 操作审计`">查看操作审计<IconChevronRight :size="15" /></a></section>
      <section class="drawer-section"><h3>事件概况</h3><dl class="model-facts"><div><dt>告警对象</dt><dd>{{ detail.item.subject.name }}</dd></div><div><dt>来源</dt><dd>{{ sourceText[detail.item.source] }}</dd></div><div><dt>规则</dt><dd>{{ detail.item.rule.name }}</dd></div><div><dt>触发值</dt><dd>{{ detail.item.trigger.valueLabel }}</dd></div><div><dt>阈值</dt><dd>{{ detail.item.rule.thresholdLabel }}</dd></div><div><dt>发生次数</dt><dd>{{ detail.item.occurrences }} 次</dd></div><div><dt>首次发生</dt><dd>{{ timeText(detail.item.firstOccurredAt) }}</dd></div><div><dt>最近发生</dt><dd>{{ timeText(detail.item.lastOccurredAt) }}</dd></div></dl></section>
      <section class="drawer-section"><h3>安全分析</h3><div class="alert-analysis"><article><small>原因摘要</small><p>{{ detail.analysis.cause }}</p></article><article><small>影响范围</small><p>{{ detail.analysis.impact }}</p></article><article><small>建议动作</small><p>{{ detail.analysis.recommendation }}</p></article></div><div class="usage-content-boundary"><IconShieldCheck :size="19" /><div><strong>不保留上游完整正文</strong><p>详情仅展示可审计的脱敏摘要和请求 ID。</p></div></div></section>
      <section class="drawer-section"><h3>处理记录</h3><div class="alert-timeline"><article v-for="entry in detail.timeline" :key="entry.id"><i /><div><strong>{{ entry.title }}</strong><p>{{ entry.description }}</p><small>{{ timeText(entry.occurredAt) }}</small></div></article></div></section>
      <section class="drawer-section"><h3>关联请求</h3><div v-if="detail.item.relatedRequestIds.length" class="related-requests"><a v-for="id in detail.item.relatedRequestIds" :key="id" class="related-request-link" :href="`/usage?requestId=${encodeURIComponent(id)}&origin=alert`" :aria-label="`查看 ${id} 关联调用`"><code>{{ id }}</code><IconChevronRight :size="14" /></a></div><p v-else class="drawer-empty">此事件没有关联请求 ID。</p></section>
      <footer class="drawer-actions alert-actions"><button class="btn btn-white" disabled title="静默时间与外部通知尚未配置"><IconClock :size="16" />静默</button><button class="btn btn-white" :disabled="detail.item.status !== 'open'" :title="detail.item.status === 'open' ? '确认本地 SQLite 模拟告警' : '此告警无需再次确认'" @click="openAction('acknowledge')"><IconCircleCheck :size="16" />{{ detail.item.status === 'acknowledged' ? '已确认' : '确认告警' }}</button><button class="btn" :disabled="detail.item.status === 'closed'" :title="detail.item.status === 'closed' ? '此告警已关闭' : '关闭本地 SQLite 模拟告警'" @click="openAction('close')"><IconX :size="16" />{{ detail.item.status === 'closed' ? '已关闭' : '关闭告警' }}</button></footer>
    </aside></div>

    <div v-if="action && detail" class="drawer-backdrop" @click.self="closeAction"><aside class="model-drawer alert-action-dialog" role="dialog" aria-modal="true" :aria-label="action === 'acknowledge' ? '确认本地模拟告警' : '关闭本地模拟告警'"><header><div><span class="source-tag demo">本地模拟</span><h2>{{ action === 'acknowledge' ? '确认模拟告警' : '关闭模拟告警' }}</h2></div><button class="icon-button" aria-label="关闭告警处置窗口" :disabled="isActing" @click="closeAction"><IconX :size="20" /></button></header>
      <form class="alert-action-form" @submit.prevent="submitAction"><div class="alert-action-heading"><strong>{{ detail.item.title }}</strong><code>{{ detail.item.id }}</code><p>{{ action === 'acknowledge' ? '将记录当前管理员已接手处理。' : '将把该模拟事件标为已关闭；若尚未确认，会同时记录本地确认时间。' }} 不会发送通知、调用 New API 或改变真实事件。</p></div><label><span>处置说明 <em>至少 8 个字符，仅校验长度</em></span><textarea v-model.trim="actionForm.reason" required minlength="8" maxlength="200" rows="4" placeholder="例如：已完成本地演示事件复核，后续继续观察" /></label><label class="alert-action-ack"><input v-model="actionForm.acknowledgeSimulation" type="checkbox" /><span>我确认：这仅会改变 SQLite 模拟告警状态，并写入不含处置说明原文的审计摘要。</span></label><p v-if="actionError" class="alert-action-error">{{ actionError }}</p><footer><button class="btn btn-white" type="button" :disabled="isActing" @click="closeAction">取消</button><button class="btn" type="submit" :disabled="isActing || actionForm.reason.trim().length < 8 || !actionForm.acknowledgeSimulation"><IconCircleCheck v-if="action === 'acknowledge'" :size="16" /><IconX v-else :size="16" />{{ isActing ? '保存中…' : action === 'acknowledge' ? '确认本地告警' : '关闭本地告警' }}</button></footer></form>
    </aside></div>

    <div v-if="editingRule" class="drawer-backdrop" @click.self="closeRuleEditor"><aside class="model-drawer alert-action-dialog" role="dialog" aria-modal="true" aria-label="编辑本地告警规则"><header><div><span class="source-tag demo">本地 SQLite</span><h2>编辑告警规则</h2></div><button class="icon-button" aria-label="关闭规则编辑窗口" :disabled="isRuleSaving" @click="closeRuleEditor"><IconX :size="20" /></button></header>
      <form class="alert-action-form alert-rule-form" @submit.prevent="submitRuleEdit"><div class="alert-action-heading"><strong>{{ editingRule.name }}</strong><code>{{ editingRule.id }}</code><p>只修改本地 SQLite 模拟规则，不会发送通知、调用 New API 或改变真实告警源。</p></div><div class="alert-rule-fields"><label><span>规则状态</span><select v-model="ruleForm.enabled"><option :value="true">启用</option><option :value="false">停用</option></select></label><label><span>严重度</span><select v-model="ruleForm.severity"><option value="critical">严重</option><option value="warning">警告</option><option value="info">提示</option></select></label><label><span>触发条件</span><input v-model.trim="ruleForm.condition" maxlength="120" required placeholder="例如：5xx 错误率 ≥ 5%" /></label><label><span>统计窗口</span><input v-model.trim="ruleForm.window" maxlength="60" required placeholder="例如：5 分钟" /></label><label><span>冷却时间（分钟）</span><input v-model.number="ruleForm.cooldownMinutes" type="number" min="0" max="1440" required /></label></div><label><span>编辑说明 <em>至少 8 个字符，仅校验长度</em></span><textarea v-model.trim="ruleForm.reason" required minlength="8" maxlength="200" rows="4" placeholder="例如：根据本地演示规则复核结果调整阈值" /></label><label class="alert-action-ack"><input v-model="ruleForm.acknowledgeSimulation" type="checkbox" /><span>我确认：这仅会改变 SQLite 模拟规则，并写入不含说明原文的审计摘要。</span></label><p v-if="ruleError" class="alert-action-error">{{ ruleError }}</p><footer><button class="btn btn-white" type="button" :disabled="isRuleSaving" @click="closeRuleEditor">取消</button><button class="btn" type="submit" :disabled="isRuleSaving || ruleForm.condition.trim().length < 1 || ruleForm.window.trim().length < 1 || ruleForm.reason.trim().length < 8 || !ruleForm.acknowledgeSimulation"><IconSettings :size="16" />{{ isRuleSaving ? '保存中…' : '保存本地规则' }}</button></footer></form>
    </aside></div>
  </div>
</template>

<style scoped>
.alert-action-dialog { width: min(500px, 100vw); }
.alert-rule-form { max-height: min(760px, 92vh); overflow: auto; }
.alert-rule-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.alert-rule-fields label:nth-child(3), .alert-rule-fields label:nth-child(4), .alert-rule-fields label:nth-child(5) { grid-column: 1 / -1; }
.alert-rule-fields input, .alert-rule-fields select { width: 100%; min-height: 36px; padding: 8px 10px; border: 1px solid #d8e1e5; border-radius: 6px; outline: 0; color: #344754; background: #fff; font: 13px/1.4 inherit; }
.alert-rule-fields input:focus, .alert-rule-fields select:focus { border-color: #19808a; box-shadow: 0 0 0 2px rgba(25,128,138,.08); }
.alert-rule-receipt { margin: 0 18px 14px; }
.rule-enabled.disabled { color: #8a6b47; }
.rule-enabled.disabled i { background: #d19b42; }
@media (max-width: 560px) { .alert-rule-fields { grid-template-columns: 1fr; } .alert-rule-fields label:nth-child(3), .alert-rule-fields label:nth-child(4), .alert-rule-fields label:nth-child(5) { grid-column: auto; } }
.alert-action-form { display: grid; gap: 15px; padding: 18px; }
.alert-action-heading { display: grid; gap: 5px; padding: 12px; border: 1px solid #cfe2e4; border-radius: 7px; color: #526a73; background: #f2f9f9; }
.alert-action-heading strong { color: #36545e; font-size: 14px; }
.alert-action-heading code { color: #6b7f89; font: 11px ui-monospace, SFMono-Regular, Consolas, monospace; }
.alert-action-heading p { margin: 1px 0 0; font-size: 12px; line-height: 1.55; }
.alert-action-form label { display: grid; gap: 7px; }
.alert-action-form label > span { color: #687b86; font-size: 12px; font-weight: 650; }
.alert-action-form label > span em { color: #8a989f; font-size: 11px; font-style: normal; font-weight: 400; }
.alert-action-form textarea { width: 100%; min-height: 78px; padding: 10px; resize: vertical; border: 1px solid #d8e1e5; border-radius: 6px; outline: 0; color: #344754; background: #fff; font: 13px/1.5 inherit; }
.alert-action-form textarea:focus { border-color: #19808a; box-shadow: 0 0 0 2px rgba(25,128,138,.08); }
.alert-action-ack { display: flex !important; grid-template-columns: 16px minmax(0, 1fr); align-items: flex-start; gap: 8px !important; color: #536873; font-size: 12px; line-height: 1.5; }
.alert-action-ack input { margin: 2px 0 0; accent-color: var(--brand); }
.alert-action-error { margin: -3px 0 0; padding: 9px 10px; border-radius: 6px; color: #a33232; background: #fff1f1; font-size: 12px; line-height: 1.5; }
.alert-action-form footer { display: flex; justify-content: flex-end; gap: 8px; padding-top: 14px; border-top: 1px solid var(--line); }
.alert-action-success { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 13px 18px 0; padding: 10px 11px; border: 1px solid #b9dfc0; border-radius: 7px; color: #2f6240; background: #f1faf2; }.alert-action-success > div { display: flex; align-items: flex-start; gap: 8px; }.alert-action-success > div > div { display: grid; gap: 2px; }.alert-action-success svg { flex: 0 0 auto; }.alert-action-success strong { font-size: 12px; }.alert-action-success p { margin: 0; color: #5d7a67; font-size: 11px; line-height: 1.45; }.alert-action-success a { display: inline-flex; align-items: center; gap: 1px; color: #286c45; font-size: 11px; font-weight: 700; text-decoration: none; white-space: nowrap; }.alert-action-success a:hover { color: #165832; text-decoration: underline; }.alert-action-success a:focus-visible { outline: 2px solid #62a877; outline-offset: 2px; }
</style>
