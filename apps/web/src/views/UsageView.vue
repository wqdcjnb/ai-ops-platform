<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  IconActivityHeartbeat, IconAlertTriangle, IconArrowLeft, IconArrowRight, IconChevronRight,
  IconCircleCheck, IconClock, IconCoins, IconFileAnalytics, IconRefresh, IconSearch, IconShieldCheck, IconX,
} from '@tabler/icons-vue'
import { fetchUsage, fetchUsageDetail, UsageApiError, type UsageDetail, type UsageFilters, type UsageItem, type UsageResponse } from '../usage-api'

const usage = ref<UsageResponse | null>(null)
const detail = ref<UsageDetail | null>(null)
const detailLoadingId = ref('')
const errorMessage = ref('')
const isLoading = ref(false)
const period = ref<UsageFilters['period']>('7d')
function linkedUsageRequestFromLocation() {
  if (typeof window === 'undefined') return ''
  const value = new URLSearchParams(window.location.search).get('requestId')?.trim() ?? ''
  return /^req-[A-Za-z0-9-]{1,80}$/.test(value) ? value : ''
}
type LinkedUsageOrigin = 'conversation_audit' | 'alert'
function linkedUsageOriginFromLocation(): LinkedUsageOrigin {
  if (typeof window === 'undefined') return 'conversation_audit'
  return new URLSearchParams(window.location.search).get('origin') === 'alert' ? 'alert' : 'conversation_audit'
}
const linkedUsageRequestId = ref(linkedUsageRequestFromLocation())
const linkedUsageOrigin = ref(linkedUsageOriginFromLocation())
const search = ref(linkedUsageRequestId.value)
const person = ref('all')
const department = ref('all')
const purpose = ref('all')
const key = ref('all')
const model = ref('all')
const channel = ref('all')
const status = ref<UsageFilters['status']>('all')
const costType = ref<UsageFilters['costType']>('all')
const page = ref(1)
const pageSize = 10
let request: AbortController | undefined
let detailRequest: AbortController | undefined

const statusText = { succeeded: '成功', failed: '失败', cancelled: '已取消' }
const errorText = { rate_limit: '限流', timeout: '超时', authentication: '认证', server: '服务端', cancelled: '客户端取消' }
const costTone = { official_actual: 'actual', platform_estimate: 'platform', cpa_estimate: 'cpa' }

const updatedAt = computed(() => usage.value ? timeText(usage.value.meta.generatedAt) : '—')
const sourceLabel = computed(() => usage.value?.meta.source === 'database' ? 'SQLite · 模拟数据' : '正在读取')
const linkedUsageTitle = computed(() => linkedUsageOrigin.value === 'alert' ? '来自告警事件的模拟调用关联' : '来自对话审计的模拟用量关联')
const linkedUsageNotice = computed(() => linkedUsageOrigin.value === 'alert' ? '当前仅筛选告警明确关联的 SQLite 模拟调用，不代表真实上游请求链路。' : '当前仅筛选 SQLite 合成映射的模拟记录，不代表真实网关请求链路。')
const clearLinkedUsageLabel = computed(() => linkedUsageOrigin.value === 'alert' ? '清除告警关联筛选' : '清除对话审计关联筛选')
const summaryCards = computed(() => {
  const value = usage.value?.summary
  return [
    { label: '请求数', value: value?.requests.toLocaleString('zh-CN') ?? '—', hint: '当前筛选范围', icon: IconActivityHeartbeat, tone: 'teal' },
    { label: 'Token', value: compactNumber(value?.tokens), hint: '输入与输出合计', icon: IconFileAnalytics, tone: 'blue' },
    { label: '成本点数', value: value?.points.toLocaleString('zh-CN') ?? '—', hint: '软目标统一口径', icon: IconCoins, tone: 'amber' },
    { label: '成功率', value: value ? `${value.successRate}%` : '—', hint: '仅成功请求', icon: IconCircleCheck, tone: 'green' },
    { label: 'P95 延迟', value: value ? latencyText(value.p95LatencyMs) : '—', hint: '总耗时 P95', icon: IconClock, tone: 'violet' },
  ]
})

function currentFilters(): UsageFilters { return { period: period.value, search: search.value.trim(), person: person.value, department: department.value, purpose: purpose.value, key: key.value, model: model.value, channel: channel.value, status: status.value, costType: costType.value, page: page.value, pageSize } }
function compactNumber(value: number | undefined) { if (value === undefined) return '—'; return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}K` : String(value) }
function latencyText(value: number | null) { if (value === null) return '—'; return value >= 1_000 ? `${(value / 1_000).toFixed(1)}s` : `${value}ms` }
function timeText(value: string) { return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) }
function usd(value: number) { return `$${value.toFixed(value >= 1 ? 2 : 4)}` }
function applyFilters() { page.value = 1; void loadData() }
function clearFilters() { period.value = '7d'; search.value = ''; person.value = 'all'; department.value = 'all'; purpose.value = 'all'; key.value = 'all'; model.value = 'all'; channel.value = 'all'; status.value = 'all'; costType.value = 'all'; applyFilters() }
function clearLinkedUsageFilter() {
  linkedUsageRequestId.value = ''
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href)
    url.searchParams.delete('requestId')
    url.searchParams.delete('origin')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }
  clearFilters()
}
function changePage(next: number) { if (!usage.value || next < 1 || next > usage.value.pagination.totalPages) return; page.value = next; void loadData() }

async function loadData() {
  request?.abort()
  const next = new AbortController()
  request = next
  isLoading.value = true
  errorMessage.value = ''
  try { usage.value = await fetchUsage(currentFilters(), next.signal) }
  catch (error) { if (next.signal.aborted) return; const requestId = error instanceof UsageApiError ? error.requestId : undefined; errorMessage.value = `${error instanceof Error ? error.message : '用量与日志暂时无法加载'}${requestId ? ` · 请求 ID ${requestId}` : ''}` }
  finally { if (request === next) isLoading.value = false }
}

async function openDetail(item: UsageItem) {
  detailRequest?.abort()
  const next = new AbortController()
  detailRequest = next
  detailLoadingId.value = item.requestId
  try { detail.value = await fetchUsageDetail(item.requestId, next.signal) }
  catch (error) { if (!next.signal.aborted) errorMessage.value = error instanceof Error ? error.message : '调用详情暂时无法加载' }
  finally { if (detailRequest === next) detailLoadingId.value = '' }
}

onMounted(() => void loadData())
onBeforeUnmount(() => { request?.abort(); detailRequest?.abort() })
</script>

<template>
  <div class="dashboard usage-dashboard">
    <section class="page-heading"><div><div class="eyebrow">USAGE &amp; REQUEST LOGS</div><h1>用量与日志</h1><p>按请求 ID 核对调用归属、Token、点数、延迟、渠道和安全错误摘要。</p></div><div class="heading-actions"><span class="updated-at">更新于 {{ updatedAt }}</span><button class="btn btn-white refresh-button" :disabled="isLoading" @click="loadData"><IconRefresh :size="17" :class="{ spinning: isLoading }" />刷新</button><button class="btn" disabled title="异步导出、权限过滤和审计完成后开放"><IconFileAnalytics :size="16" />导出</button></div></section>
    <div v-if="linkedUsageRequestId" class="usage-linked-notice"><div><strong>{{ linkedUsageTitle }}</strong><p>{{ linkedUsageNotice }}</p></div><code>{{ linkedUsageRequestId }}</code><button class="text-button" type="button" :aria-label="clearLinkedUsageLabel" @click="clearLinkedUsageFilter">清除关联</button></div>
    <div v-if="usage" class="source-banner"><span>{{ sourceLabel }}</span>{{ usage.meta.notice }}</div>
    <section class="usage-summary-grid" aria-label="调用汇总"><article v-for="card in summaryCards" :key="card.label" class="metric-card"><div class="metric-top"><span class="metric-label">{{ card.label }}</span><span class="metric-icon" :class="`tone-${card.tone}`"><component :is="card.icon" :size="19" /></span></div><strong class="metric-value">{{ card.value }}</strong><div class="metric-foot">{{ card.hint }}</div></article></section>

    <div v-if="!usage && !errorMessage" class="panel data-state"><div class="state-icon"><IconRefresh :size="22" class="spinning" /></div><div><strong>正在读取调用日志</strong><p>正在聚合同一筛选条件下的汇总和明细…</p></div></div>
    <div v-else-if="errorMessage && !usage" class="panel data-state failed"><div class="state-icon"><IconAlertTriangle :size="22" /></div><div><strong>用量与日志加载失败</strong><p>{{ errorMessage }}</p></div><button class="btn btn-white" @click="loadData">重试</button></div>

    <template v-else-if="usage">
      <section class="usage-cost-strip" aria-label="成本口径"><header><div><strong>成本口径分账</strong><small>三类金额独立展示，禁止合并为“实际账单”</small></div><IconShieldCheck :size="19" /></header><article class="actual"><small>官方实际</small><strong>{{ usd(usage.summary.costs.officialActualUsd) }}</strong><em>供应商账单口径</em></article><article class="platform"><small>平台估算</small><strong>{{ usd(usage.summary.costs.platformEstimateUsd) }}</strong><em>尚待对账</em></article><article class="cpa"><small>CPA 估算</small><strong>{{ usd(usage.summary.costs.cpaEstimateUsd) }}</strong><em>不计入官方账单</em></article></section>

      <section class="panel usage-main-panel"><header class="panel-header"><div><span class="panel-title">调用记录</span><span class="panel-subtitle">SQLite 模拟元数据 · 默认无请求与响应正文</span></div><span class="source-tag demo">{{ sourceLabel }}</span></header>
        <form class="usage-filters" @submit.prevent="applyFilters">
          <label class="usage-search"><span>请求或 Key</span><div><IconSearch :size="15" /><input v-model="search" aria-label="搜索调用记录" maxlength="80" type="search" placeholder="请求 ID、掩码 Key、人员或别名" /></div></label>
          <label><span>日期</span><select v-model="period" aria-label="日期范围" @change="applyFilters"><option value="today">今天</option><option value="7d">近 7 天</option><option value="30d">近 30 天</option></select></label>
          <label><span>人员</span><select v-model="person" aria-label="人员" @change="applyFilters"><option value="all">全部人员</option><option v-for="item in usage.options.people" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
          <label><span>部门</span><select v-model="department" aria-label="部门" @change="applyFilters"><option value="all">全部部门</option><option v-for="item in usage.options.departments" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
          <label><span>用途</span><select v-model="purpose" aria-label="用途" @change="applyFilters"><option value="all">全部用途</option><option v-for="item in usage.options.purposes" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
          <label><span>Key</span><select v-model="key" aria-label="Key" @change="applyFilters"><option value="all">全部 Key</option><option v-for="item in usage.options.keys" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
          <label><span>模型</span><select v-model="model" aria-label="模型" @change="applyFilters"><option value="all">全部模型</option><option v-for="item in usage.options.models" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
          <label><span>渠道</span><select v-model="channel" aria-label="渠道" @change="applyFilters"><option value="all">全部渠道</option><option v-for="item in usage.options.channels" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
          <label><span>结果</span><select v-model="status" aria-label="结果" @change="applyFilters"><option value="all">全部结果</option><option value="succeeded">成功</option><option value="failed">失败</option><option value="cancelled">已取消</option></select></label>
          <label><span>成本口径</span><select v-model="costType" aria-label="成本口径" @change="applyFilters"><option value="all">全部口径</option><option value="official_actual">官方实际</option><option value="platform_estimate">平台估算</option><option value="cpa_estimate">CPA 估算</option></select></label>
          <button class="btn filter-submit" type="submit" aria-label="查询调用记录">查询</button><button class="text-button" type="button" aria-label="清除调用筛选" @click="clearFilters">清除</button>
        </form>

        <div v-if="usage.items.length" class="table-responsive"><table class="data-table usage-table"><thead><tr><th>请求 / 时间</th><th>人员 / Key</th><th>用途</th><th>模型 / 渠道</th><th>Token / 点数</th><th>首 Token / 总耗时</th><th>成本口径</th><th>结果</th><th /></tr></thead><tbody><tr v-for="item in usage.items" :key="item.requestId"><td><div class="usage-request"><code>{{ item.requestId }}</code><small>{{ timeText(item.occurredAt) }}</small></div></td><td><div class="usage-owner"><strong>{{ item.person.name }}</strong><small>{{ item.person.department.name }} · {{ item.key.masked }}</small></div></td><td><div class="usage-purpose"><strong>{{ item.purpose.name }}</strong><code>{{ item.purpose.alias }}</code></div></td><td><div class="usage-model"><strong>{{ item.model.displayName }}</strong><small>{{ item.channel.name }}</small></div></td><td><div class="usage-numbers"><strong>{{ item.tokens.total.toLocaleString('zh-CN') }}</strong><small>{{ item.points }} 点</small></div></td><td><div class="usage-numbers"><strong>{{ latencyText(item.latency.firstTokenMs) }}</strong><small>{{ latencyText(item.latency.totalMs) }}</small></div></td><td><span class="cost-type" :class="costTone[item.cost.type]">{{ item.cost.label }}</span><small class="cost-value">{{ usd(item.cost.amountUsd) }}</small></td><td><span class="usage-status" :class="item.status"><i />{{ statusText[item.status] }}</span><small v-if="item.error" class="usage-error">{{ errorText[item.error.category] }}</small></td><td><button class="row-action enabled" :disabled="detailLoadingId === item.requestId" :aria-label="`查看 ${item.requestId} 调用详情`" @click="openDetail(item)"><IconRefresh v-if="detailLoadingId === item.requestId" :size="15" class="spinning" /><IconChevronRight v-else :size="17" /></button></td></tr></tbody></table></div>
        <div v-else class="people-empty"><IconFileAnalytics :size="24" /><strong>没有符合条件的调用记录</strong><span>调整日期、人员、用途、渠道或请求 ID。</span><button class="text-button" @click="clearFilters">清除筛选</button></div>
        <footer class="usage-pagination"><span>共 {{ usage.pagination.total }} 条 · 第 {{ usage.pagination.page }}/{{ Math.max(usage.pagination.totalPages, 1) }} 页</span><div><button :disabled="usage.pagination.page <= 1" aria-label="上一页" @click="changePage(usage.pagination.page - 1)"><IconArrowLeft :size="15" /></button><button :disabled="usage.pagination.page >= usage.pagination.totalPages" aria-label="下一页" @click="changePage(usage.pagination.page + 1)"><IconArrowRight :size="15" /></button></div></footer>
      </section>
      <footer class="page-footer">数据来源：{{ sourceLabel }} · 日志只含脱敏元数据 · 不保存认证 Header、完整 Key 或未经授权的对话正文</footer>
    </template>

    <div v-if="detail" class="drawer-backdrop" @click.self="detail = null"><aside class="model-drawer usage-drawer" role="dialog" aria-modal="true" aria-label="调用详情"><header><div><span class="source-tag demo">{{ sourceLabel }}</span><h2>调用详情</h2></div><button class="icon-button" aria-label="关闭详情" @click="detail = null"><IconX :size="20" /></button></header>
      <section class="usage-drawer-hero"><div><span :class="detail.item.status"><IconCircleCheck v-if="detail.item.status === 'succeeded'" :size="20" /><IconAlertTriangle v-else :size="20" /></span><div><code>{{ detail.item.requestId }}</code><small>{{ timeText(detail.item.occurredAt) }} · {{ detail.client.name }}</small></div></div><span class="usage-status" :class="detail.item.status"><i />{{ statusText[detail.item.status] }}</span></section>
      <section class="drawer-section"><h3>调用归属</h3><dl class="model-facts"><div><dt>人员</dt><dd>{{ detail.item.person.name }}</dd></div><div><dt>部门</dt><dd>{{ detail.item.person.department.name }}</dd></div><div><dt>Key</dt><dd>{{ detail.item.key.masked }}</dd></div><div><dt>业务用途</dt><dd>{{ detail.item.purpose.name }}</dd></div></dl></section>
      <section class="usage-detail-metrics"><article><small>输入 Token</small><strong>{{ detail.item.tokens.input.toLocaleString('zh-CN') }}</strong></article><article><small>输出 Token</small><strong>{{ detail.item.tokens.output.toLocaleString('zh-CN') }}</strong></article><article><small>成本点数</small><strong>{{ detail.item.points }}</strong></article><article><small>首 Token</small><strong>{{ latencyText(detail.item.latency.firstTokenMs) }}</strong></article><article><small>总耗时</small><strong>{{ latencyText(detail.item.latency.totalMs) }}</strong></article><article><small>重试次数</small><strong>{{ detail.route.retryCount }}</strong></article></section>
      <section class="drawer-section"><h3>路由与成本</h3><dl class="model-facts"><div><dt>业务别名</dt><dd>{{ detail.route.alias }}</dd></div><div><dt>实际模型</dt><dd>{{ detail.item.model.actualModel }}</dd></div><div><dt>上游渠道</dt><dd>{{ detail.item.channel.name }}</dd></div><div><dt>协议 / 模式</dt><dd>{{ detail.item.protocol === 'responses' ? 'Responses' : 'Chat Completions' }} · {{ detail.client.mode === 'stream' ? '流式' : '非流式' }}</dd></div></dl><div class="detail-cost-line"><span class="cost-type" :class="costTone[detail.item.cost.type]">{{ detail.item.cost.label }}</span><strong>{{ usd(detail.item.cost.amountUsd) }}</strong><small>{{ detail.item.cost.type === 'official_actual' ? '供应商账单口径' : detail.item.cost.type === 'platform_estimate' ? '平台估算，尚待对账' : 'CPA 估算，不计入官方账单' }}</small></div></section>
      <section v-if="detail.item.error" class="drawer-section"><h3>错误摘要</h3><div class="channel-error-detail"><IconAlertTriangle :size="18" /><div><strong>{{ errorText[detail.item.error.category] }}</strong><p>{{ detail.item.error.summary }}</p><small>不返回上游完整错误正文</small></div></div></section>
      <section class="usage-content-boundary"><IconShieldCheck :size="19" /><div><strong>无对话正文</strong><p>{{ detail.content.reason }}</p><small>请求 ID 已{{ detail.route.requestIdPropagated ? '透传' : '未验证' }}；对话审计必须通过独立授权页面访问。</small></div></section>
      <section v-if="detail.conversationAudit.accessible" class="usage-conversation-link"><IconShieldCheck :size="18" /><div><strong>已关联合成对话审计记录</strong><p>{{ detail.conversationAudit.notice }}</p></div><a class="btn btn-white" :href="detail.conversationAudit.href ?? undefined" aria-label="进入关联的对话审计">进入对话审计</a></section>
      <footer class="drawer-actions"><button class="btn" disabled><IconFileAnalytics :size="16" />导出记录</button></footer>
    </aside></div>
  </div>
</template>
