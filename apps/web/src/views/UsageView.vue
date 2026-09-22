<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  IconActivityHeartbeat, IconAlertTriangle, IconArrowLeft, IconArrowRight, IconChartAreaLine,
  IconChartBar, IconChartPie, IconChevronRight, IconCircleCheck, IconClock, IconFileAnalytics,
  IconFilter, IconRefresh, IconSearch, IconSettings2, IconShieldCheck, IconWallet, IconX,
} from '@tabler/icons-vue'
import { fetchModelAnalytics, fetchUsage, fetchUsageDetail, UsageApiError, type ModelAnalyticsQuery, type ModelAnalyticsResponse, type UsageDetail, type UsageFilters, type UsageItem, type UsageResponse } from '../usage-api'
import { useDebouncedSearch } from '../composables/useDebouncedSearch'

const usage = ref<UsageResponse | null>(null)
const analytics = ref<ModelAnalyticsResponse | null>(null)
const analyticsError = ref('')
const analyticsLoading = ref(false)
const analyticsDays = ref<ModelAnalyticsQuery['days']>(1)
const analyticsGranularity = ref<ModelAnalyticsQuery['timeGranularity']>('hour')
const analyticsUsername = ref('')
const analyticsTab = ref<'trend' | 'distribution' | 'ranking'>('trend')
const analyticsFilterOpen = ref(false)
const analyticsPreferencesOpen = ref(false)
const quotaChartType = ref<'bar' | 'area'>('bar')
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
function personFromLocation() {
  if (typeof window === 'undefined') return 'all'
  const value = new URLSearchParams(window.location.search).get('person')?.trim() ?? ''
  return /^[A-Za-z0-9._-]{1,96}$/.test(value) ? value : 'all'
}
const linkedUsageRequestId = ref(linkedUsageRequestFromLocation())
const search = ref(linkedUsageRequestId.value)
const person = ref(personFromLocation())
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
let analyticsRequest: AbortController | undefined
let detailRequest: AbortController | undefined

const statusText = { succeeded: '成功', failed: '失败', cancelled: '已取消' }
const errorText = { rate_limit: '限流', timeout: '超时', authentication: '认证', server: '服务端', cancelled: '客户端取消' }

const updatedAt = computed(() => usage.value ? timeText(usage.value.meta.generatedAt) : '—')
const isNewApi = computed(() => usage.value?.meta.source === 'new_api')
const sourceLabel = computed(() => isNewApi.value ? 'New API · 真实日志' : usage.value?.meta.source !== 'database' ? '正在读取' : usage.value.meta.simulated ? 'SQLite · 脱敏快照' : 'SQLite · 网关数据')
const analyticsModels = computed(() => analytics.value?.models ?? [])
const analyticsMaxModelCount = computed(() => Math.max(1, ...analyticsModels.value.map((item) => item.count)))
const analyticsBuckets = computed(() => {
  const points = new Map<string, { bucket: string; count: number; quota: number; tokens: number }>()
  for (const item of analytics.value?.series ?? []) {
    const current = points.get(item.bucket) ?? { bucket: item.bucket, count: 0, quota: 0, tokens: 0 }
    current.count += item.count
    current.quota += item.quota
    current.tokens += item.tokens
    points.set(item.bucket, current)
  }
  return [...points.values()].sort((left, right) => left.bucket.localeCompare(right.bucket))
})
const analyticsMaxBucketCount = computed(() => Math.max(1, ...analyticsBuckets.value.map((item) => item.count)))
type AnalyticsChartBucket = {
  bucket: string
  count: number
  quota: number
  tokens: number
  models: Record<string, { count: number; quota: number; tokens: number }>
}
const chartPalette = ['#5B8FF9', '#5AD8A6', '#F6BD16', '#E8684A', '#6DC8EC', '#9270CA', '#FF9D4D', '#269A99', '#FF99C3', '#5D7092']
function analyticsBucketStart(value: Date, granularity: ModelAnalyticsQuery['timeGranularity']) {
  const date = new Date(value)
  if (granularity === 'hour') date.setUTCMinutes(0, 0, 0)
  else if (granularity === 'day') date.setUTCHours(0, 0, 0, 0)
  else {
    date.setUTCHours(0, 0, 0, 0)
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  }
  return date
}
function analyticsBucketStep(granularity: ModelAnalyticsQuery['timeGranularity']) {
  return granularity === 'hour' ? 60 * 60 * 1000 : granularity === 'day' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
}
const analyticsChartBuckets = computed<AnalyticsChartBucket[]>(() => {
  if (!analytics.value) return []
  const byBucket = new Map<string, AnalyticsChartBucket>()
  for (const item of analytics.value.series) {
    const bucket = byBucket.get(item.bucket) ?? { bucket: item.bucket, count: 0, quota: 0, tokens: 0, models: {} }
    const model = bucket.models[item.modelName] ?? { count: 0, quota: 0, tokens: 0 }
    model.count += item.count
    model.quota += item.quota
    model.tokens += item.tokens
    bucket.models[item.modelName] = model
    bucket.count += item.count
    bucket.quota += item.quota
    bucket.tokens += item.tokens
    byBucket.set(item.bucket, bucket)
  }
  const end = analyticsBucketStart(new Date(analytics.value.meta.endAt), analyticsGranularity.value)
  const step = analyticsBucketStep(analyticsGranularity.value)
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(end.getTime() - (6 - index) * step)
    const key = date.toISOString()
    return byBucket.get(key) ?? { bucket: key, count: 0, quota: 0, tokens: 0, models: {} }
  })
})
const analyticsMaxQuota = computed(() => Math.max(1, ...analyticsChartBuckets.value.map((item) => item.quota)))
const analyticsMaxChartCount = computed(() => Math.max(1, ...analyticsChartBuckets.value.map((item) => item.count)))
const analyticsTotalModelCount = computed(() => analyticsModels.value.reduce((sum, item) => sum + item.count, 0))
const analyticsPieStyle = computed(() => {
  if (!analyticsModels.value.length || analyticsTotalModelCount.value <= 0) return { background: 'var(--na-muted)' }
  let cursor = 0
  const stops = analyticsModels.value.map((item, index) => {
    const next = cursor + (item.count / analyticsTotalModelCount.value) * 360
    const stop = `${analyticsColor(index)} ${cursor.toFixed(2)}deg ${next.toFixed(2)}deg`
    cursor = next
    return stop
  })
  return { background: `conic-gradient(${stops.join(', ')})` }
})
const analyticsCards = computed(() => {
  const value = analytics.value?.summary
  return [
    { key: 'count', label: '总调用次数', value: value?.totalCount.toLocaleString('en-US') ?? '—', hint: '统计调用次数', tone: 'teal' },
    { key: 'tokens', label: '令牌总量', value: value ? compactNumber(value.totalTokens) : '—', hint: '输入 + 输出令牌', tone: 'violet' },
    { key: 'rpm', label: '平均请求速率', value: value ? value.averageRpm.toFixed(2) : '—', hint: '每分钟请求数', tone: 'green' },
    { key: 'tpm', label: '平均令牌速率', value: value ? compactNumber(value.averageTpm) : '—', hint: '每分钟令牌数', tone: 'orange' },
  ]
})
const linkedUsageTitle = computed(() => '来自对话审计的关联用量')
const linkedUsageNotice = computed(() => '当前仅筛选系统已关联的记录，不代表完整网关请求链路。')
const clearLinkedUsageLabel = computed(() => '清除对话审计关联筛选')
const summaryCards = computed(() => {
  const value = usage.value?.summary
  return [
    { label: '请求数', value: value?.requests.toLocaleString('zh-CN') ?? '—', hint: '当前筛选范围', icon: IconActivityHeartbeat, tone: 'teal' },
    { label: 'Token', value: compactNumber(value?.tokens), hint: '输入与输出合计', icon: IconFileAnalytics, tone: 'blue' },
    { label: '成功率', value: value ? `${value.successRate}%` : '—', hint: '仅成功请求', icon: IconCircleCheck, tone: 'green' },
    { label: 'P95 延迟', value: value ? latencyText(value.p95LatencyMs) : '—', hint: '总耗时 P95', icon: IconClock, tone: 'violet' },
  ]
})

function currentFilters(): UsageFilters { return { period: period.value, search: search.value.trim(), person: person.value, department: department.value, purpose: purpose.value, key: key.value, model: model.value, channel: channel.value, status: status.value, costType: costType.value, page: page.value, pageSize } }
function compactNumber(value: number | undefined) { if (value === undefined) return '—'; return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}K` : String(value) }
function latencyText(value: number | null) { if (value === null) return '—'; return value >= 1_000 ? `${(value / 1_000).toFixed(1)}s` : `${value}ms` }
function timeText(value: string) { return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) }
function analyticsBucketText(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return analyticsGranularity.value === 'hour'
    ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).format(date)
    : new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date)
}
function analyticsColor(index: number) {
  return chartPalette[index % chartPalette.length]
}
function analyticsModelIndex(modelName: string) { return Math.max(0, analyticsModels.value.findIndex((item) => item.modelName === modelName)) }
function analyticsBarHeight(value: number, max: number) { return `${value > 0 ? Math.max(6, Math.round((value / max) * 100)) : 0}%` }
function analyticsPointCount(bucket: string, modelName: string) { return analytics.value?.series.find((item) => item.bucket === bucket && item.modelName === modelName)?.count ?? 0 }
function analyticsChartPointCount(bucket: AnalyticsChartBucket, modelName: string) { return bucket.models[modelName]?.count ?? 0 }
function analyticsChartQuota(bucket: AnalyticsChartBucket, modelName: string) { return bucket.models[modelName]?.quota ?? 0 }
function analyticsTrendPath(modelName: string) {
  const buckets = analyticsChartBuckets.value
  if (!buckets.length) return ''
  const width = 760; const height = 250; const left = 44; const right = 14; const top = 18; const bottom = 32
  const xStep = (width - left - right) / Math.max(1, buckets.length - 1)
  return buckets.map((bucket, index) => {
    const value = analyticsChartPointCount(bucket, modelName)
    const x = left + index * xStep
    const y = top + (height - top - bottom) * (1 - value / analyticsMaxChartCount.value)
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}
function analyticsTrendAreaPath(modelName: string) {
  const line = analyticsTrendPath(modelName)
  if (!line) return ''
  const width = 760; const height = 250; const left = 44; const right = 14; const bottom = 32
  const lastX = width - right
  return `${line} L${lastX},${height - bottom} L${left},${height - bottom} Z`
}
function analyticsQuotaAreaPath(modelName: string) {
  const buckets = analyticsChartBuckets.value
  if (!buckets.length) return ''
  const width = 760; const height = 250; const left = 44; const right = 14; const top = 18; const bottom = 32
  const xStep = (width - left - right) / Math.max(1, buckets.length - 1)
  const line = buckets.map((bucket, index) => {
    const value = analyticsChartQuota(bucket, modelName)
    const x = left + index * xStep
    const y = top + (height - top - bottom) * (1 - value / analyticsMaxQuota.value)
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return `${line} L${width - right},${height - bottom} L${left},${height - bottom} Z`
}
function analyticsChartX(index: number) {
  const left = 44; const right = 14; const width = 760
  return left + index * ((width - left - right) / Math.max(1, analyticsChartBuckets.value.length - 1))
}
function analyticsQuotaBarWidth() {
  return Math.max(12, Math.min(38, 560 / Math.max(1, analyticsChartBuckets.value.length)))
}
function analyticsQuotaBarHeight(value: number) {
  const height = 250; const top = 18; const bottom = 32
  return (height - top - bottom) * (value / analyticsMaxQuota.value)
}
function analyticsQuotaBarY(bucket: AnalyticsChartBucket, modelIndex: number) {
  const total = analyticsModels.value.slice(0, modelIndex).reduce((sum, item) => sum + analyticsChartQuota(bucket, item.modelName), 0)
  return 250 - 32 - analyticsQuotaBarHeight(total + analyticsChartQuota(bucket, analyticsModels.value[modelIndex]?.modelName ?? ''))
}
function analyticsRankBarHeight(value: number) {
  return Math.max(2, 190 * (value / analyticsMaxModelCount.value))
}
function analyticsRankBarX(index: number) {
  return 54 + index * (Math.max(1, 650 / Math.max(1, analyticsModels.value.length)))
}
function analyticsAxisLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  if (analyticsGranularity.value === 'hour') return `${String(date.getUTCHours()).padStart(2, '0')}:00`
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}`
}
function analyticsFilterLabel() {
  const range = [1, 7, 14, 29].includes(analyticsDays.value) ? `${analyticsDays.value} 天` : '自定义'
  return analyticsUsername.value.trim() ? `${range} · ${analyticsUsername.value.trim()}` : range
}
function analyticsQuery(): ModelAnalyticsQuery { return { days: analyticsDays.value, timeGranularity: analyticsGranularity.value, username: analyticsUsername.value.trim() } }
function applyAnalyticsFilters() { void loadModelAnalytics() }
function resetAnalyticsFilters() {
  analyticsDays.value = 1
  analyticsGranularity.value = 'hour'
  analyticsUsername.value = ''
  analyticsFilterOpen.value = false
  void loadModelAnalytics()
}
function closeAnalyticsOverlays() {
  analyticsFilterOpen.value = false
  analyticsPreferencesOpen.value = false
}
function setAnalyticsDays(value: number) {
  if (value === 1 || value === 7 || value === 14 || value === 29) {
    analyticsDays.value = value
    applyAnalyticsFilters()
  }
}
function applyFilters() { cancelSearch(); page.value = 1; void loadData() }
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

async function loadModelAnalytics(signal?: AbortSignal) {
  if (!isNewApi.value) {
    analytics.value = null
    analyticsError.value = ''
    return
  }
  if (!signal) {
    analyticsRequest?.abort()
    const next = new AbortController()
    analyticsRequest = next
    signal = next.signal
  }
  analyticsLoading.value = true
  analyticsError.value = ''
  try {
    analytics.value = await fetchModelAnalytics(analyticsQuery(), signal)
  } catch (error) {
    if (signal?.aborted) return
    analytics.value = null
    analyticsError.value = error instanceof Error ? error.message : '模型调用分析暂时无法加载'
  } finally {
    if (!signal?.aborted) analyticsLoading.value = false
  }
}

async function loadData() {
  request?.abort()
  analyticsRequest?.abort()
  const next = new AbortController()
  request = next
  isLoading.value = true
  errorMessage.value = ''
  try {
    usage.value = await fetchUsage(currentFilters(), next.signal)
    if (usage.value.meta.source === 'new_api') await loadModelAnalytics()
    else {
      analytics.value = null
      analyticsError.value = ''
      analyticsLoading.value = false
    }
  }
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

const { cancel: cancelSearch } = useDebouncedSearch(search, () => { page.value = 1; void loadData() })

onMounted(() => void loadData())
onBeforeUnmount(() => { request?.abort(); analyticsRequest?.abort(); detailRequest?.abort() })
</script>

<template>
  <div class="dashboard usage-dashboard">
    <section v-if="!isNewApi" class="page-heading"><div><div class="eyebrow">USAGE &amp; REQUEST LOGS</div><h1>用量与日志</h1><p>按时间核对调用归属、Token、延迟、渠道和安全错误摘要。</p></div><div class="heading-actions"><span class="updated-at">更新于 {{ updatedAt }}</span><button class="btn btn-white refresh-button" :disabled="isLoading" @click="loadData"><IconRefresh :size="17" :class="{ spinning: isLoading }" />刷新</button><button class="btn" disabled title="异步导出、权限过滤和审计完成后开放"><IconFileAnalytics :size="16" />导出</button></div></section>
    <div v-if="linkedUsageRequestId && !isNewApi" class="usage-linked-notice"><div><strong>{{ linkedUsageTitle }}</strong><p>{{ linkedUsageNotice }}</p></div><code>{{ linkedUsageRequestId }}</code><button class="text-button" type="button" :aria-label="clearLinkedUsageLabel" @click="clearLinkedUsageFilter">清除关联</button></div>
    <div v-if="usage && !isNewApi" class="source-banner"><span>{{ sourceLabel }}</span>{{ usage.meta.notice }}</div>
    <section v-if="!isNewApi" class="usage-summary-grid" aria-label="调用汇总"><article v-for="card in summaryCards" :key="card.label" class="metric-card"><div class="metric-top"><span class="metric-label">{{ card.label }}</span><span class="metric-icon" :class="`tone-${card.tone}`"><component :is="card.icon" :size="19" /></span></div><strong class="metric-value">{{ card.value }}</strong><div class="metric-foot">{{ card.hint }}</div></article></section>

    <div v-if="!usage && !errorMessage" class="panel data-state"><div class="state-icon"><IconRefresh :size="22" class="spinning" /></div><div><strong>正在读取调用日志</strong><p>正在聚合同一筛选条件下的汇总和明细…</p></div></div>
    <div v-else-if="errorMessage && !usage" class="panel data-state failed"><div class="state-icon"><IconAlertTriangle :size="22" /></div><div><strong>用量与日志加载失败</strong><p>{{ errorMessage }}</p></div><button class="btn btn-white" @click="loadData">重试</button></div>

    <template v-else-if="usage && isNewApi">
      <section class="new-api-page" aria-label="模型调用分析">
        <header class="na-page-header">
          <h1>模型调用分析</h1>
          <div class="na-page-actions">
            <button type="button" class="na-button na-button-outline" aria-label="偏好设置" @click="analyticsPreferencesOpen = !analyticsPreferencesOpen; analyticsFilterOpen = false"><IconSettings2 :size="15" />偏好设置</button>
            <button type="button" class="na-button na-button-outline" aria-label="筛选" @click="analyticsFilterOpen = !analyticsFilterOpen; analyticsPreferencesOpen = false"><IconFilter :size="15" />筛选</button>
          </div>
        </header>

        <div v-if="analyticsPreferencesOpen" class="na-popover na-preferences" role="dialog" aria-label="模型分析默认设置">
          <header><div><strong>模型分析默认设置</strong><small>设置模型分析的默认时间范围和图表。</small></div><button type="button" aria-label="关闭偏好设置" @click="analyticsPreferencesOpen = false"><IconX :size="16" /></button></header>
          <label>默认时间范围<select v-model="analyticsDays"><option :value="1">1 天</option><option :value="7">7 天</option><option :value="14">14 天</option><option :value="29">29 天</option></select></label>
          <label>默认时间粒度<select v-model="analyticsGranularity"><option value="hour">小时</option><option value="day">天</option><option value="week">周</option></select></label>
          <label>默认配额图表<select v-model="quotaChartType"><option value="bar">柱状图</option><option value="area">面积图</option></select></label>
          <label>默认调用图表<select v-model="analyticsTab"><option value="trend">调用趋势</option><option value="distribution">调用次数分布</option><option value="ranking">调用次数排行</option></select></label>
          <button type="button" class="na-button na-button-primary" @click="analyticsPreferencesOpen = false; applyAnalyticsFilters()">保存设置</button>
        </div>

        <div v-if="analyticsFilterOpen" class="na-popover na-filter-popover" role="dialog" aria-label="模型分析筛选">
          <header><div><strong>模型分析筛选</strong><small>按时间范围和用户筛选模型分析数据。</small></div><button type="button" aria-label="关闭筛选" @click="analyticsFilterOpen = false"><IconX :size="16" /></button></header>
          <div class="na-filter-section"><span class="na-filter-section-title"><IconChartAreaLine :size="14" />快速范围</span><div class="na-quick-range"><button v-for="range in [1, 7, 14, 29]" :key="range" type="button" :class="{ active: analyticsDays === range }" @click="analyticsDays = range; analyticsGranularity = range === 1 ? 'hour' : range === 29 ? 'week' : 'day'">{{ range }} 天</button></div></div>
          <div class="na-filter-divider"><span>图表设置</span></div>
          <label>时间粒度<select v-model="analyticsGranularity"><option value="hour">小时</option><option value="day">天</option><option value="week">周</option></select></label>
          <label>用户名<input v-model="analyticsUsername" aria-label="New API 用户名" maxlength="80" placeholder="按用户名筛选" /></label>
          <footer><button type="button" class="na-button na-button-outline" @click="resetAnalyticsFilters">重置</button><button type="button" class="na-button na-button-primary" @click="analyticsFilterOpen = false; applyAnalyticsFilters()">应用筛选</button></footer>
        </div>

        <div v-if="analyticsLoading && !analytics" class="na-state"><IconRefresh :size="20" class="spinning" /><div><strong>正在加载模型调用分析</strong><span>正在读取 New API SQLite 中的模型调用元数据。</span></div></div>
        <div v-else-if="analyticsError" class="na-state na-state-error"><IconAlertTriangle :size="20" /><div><strong>模型调用分析暂不可用</strong><span>{{ analyticsError }}</span></div><button type="button" class="na-button na-button-outline" @click="applyAnalyticsFilters">重试</button></div>
        <template v-else-if="analytics">
          <section class="na-stat-grid" aria-label="模型调用分析统计">
            <article v-for="card in analyticsCards" :key="card.label" class="na-stat-item">
              <div class="na-stat-label"><span class="na-stat-icon" :class="`na-tone-${card.tone}`"><IconActivityHeartbeat v-if="card.key === 'count'" :size="14" /><IconFileAnalytics v-else-if="card.key === 'tokens'" :size="14" /><IconChartAreaLine v-else-if="card.key === 'rpm'" :size="14" /><IconChartBar v-else :size="14" /></span><span>{{ card.label }}</span></div>
              <strong class="na-stat-value">{{ card.value }}</strong>
              <small>{{ card.key === 'count' ? '统计调用次数' : card.key === 'tokens' ? '统计令牌总量' : card.key === 'rpm' ? '每分钟请求数' : '每分钟令牌数' }}</small>
            </article>
          </section>

          <section class="na-chart-card" aria-label="配额分布">
            <header class="na-chart-header"><div class="na-chart-title"><span class="na-chart-icon na-chart-icon-success"><IconWallet :size="15" /></span><strong>配额分布</strong><span>总计：{{ compactNumber(analytics.summary.totalQuota) }}</span></div><div class="na-chart-switch"><button type="button" :class="{ active: quotaChartType === 'bar' }" @click="quotaChartType = 'bar'"><IconChartBar :size="13" />柱状图</button><button type="button" :class="{ active: quotaChartType === 'area' }" @click="quotaChartType = 'area'"><IconChartAreaLine :size="13" />面积图</button></div></header>
            <div class="na-chart-body">
              <svg viewBox="0 0 760 250" role="img" aria-label="配额分布图" preserveAspectRatio="none">
                <g class="na-grid-lines"><line v-for="tick in [0, 0.25, 0.5, 0.75, 1]" :key="tick" x1="44" x2="746" :y1="18 + (200 * (1 - tick))" :y2="18 + (200 * (1 - tick))" /><text v-for="tick in [0, 0.25, 0.5, 0.75, 1]" :key="`quota-${tick}`" x="36" :y="22 + (200 * (1 - tick))">{{ tick === 0 ? '0' : compactNumber(analyticsMaxQuota * tick) }}</text></g>
                <g v-if="quotaChartType === 'bar'" class="na-bars"><g v-for="(bucket, bucketIndex) in analyticsChartBuckets" :key="bucket.bucket"><rect v-for="(modelItem, modelIndex) in analyticsModels" :key="modelItem.modelName" :x="analyticsChartX(bucketIndex) - analyticsQuotaBarWidth() / 2" :y="analyticsQuotaBarY(bucket, modelIndex)" :width="analyticsQuotaBarWidth()" :height="analyticsQuotaBarHeight(analyticsChartQuota(bucket, modelItem.modelName))" :fill="analyticsColor(modelIndex)" rx="3" /></g></g>
                <g v-else class="na-area-lines"><path v-for="(modelItem, index) in analyticsModels" :key="modelItem.modelName" :d="analyticsQuotaAreaPath(modelItem.modelName)" :fill="analyticsColor(index)" fill-opacity=".10" /><path v-for="(modelItem, index) in analyticsModels" :key="`line-${modelItem.modelName}`" :d="analyticsTrendPath(modelItem.modelName)" :stroke="analyticsColor(index)" fill="none" stroke-width="2" stroke-linecap="round" /></g>
                <g class="na-axis-labels"><text v-for="(bucket, index) in analyticsChartBuckets" :key="`x-${bucket.bucket}`" :x="analyticsChartX(index)" y="242">{{ analyticsAxisLabel(bucket.bucket) }}</text></g>
              </svg>
              <div v-if="!analyticsModels.length" class="na-chart-empty">暂无数据</div>
              <div v-else class="na-legend"><span v-for="(modelItem, index) in analyticsModels" :key="modelItem.modelName"><i :style="{ background: analyticsColor(index) }" />{{ modelItem.modelName }}</span></div>
            </div>
          </section>

          <section class="na-chart-card" aria-label="模型调用分析图表">
            <header class="na-chart-header na-model-header"><div class="na-chart-title"><span class="na-chart-icon na-chart-icon-info"><IconChartPie :size="15" /></span><strong>模型调用分析</strong><span>总计：{{ analytics.summary.totalCount.toLocaleString('en-US') }}</span></div><nav class="na-chart-tabs" role="tablist" aria-label="模型调用分析视图"><button type="button" role="tab" :aria-selected="analyticsTab === 'trend'" :class="{ active: analyticsTab === 'trend' }" @click="analyticsTab = 'trend'">调用趋势</button><button type="button" role="tab" :aria-selected="analyticsTab === 'distribution'" :class="{ active: analyticsTab === 'distribution' }" @click="analyticsTab = 'distribution'">调用次数分布</button><button type="button" role="tab" :aria-selected="analyticsTab === 'ranking'" :class="{ active: analyticsTab === 'ranking' }" @click="analyticsTab = 'ranking'">调用次数排行</button></nav></header>
            <div v-if="analyticsTab === 'trend'" class="na-chart-body na-model-chart"><svg viewBox="0 0 760 250" role="img" aria-label="调用趋势图" preserveAspectRatio="none"><g class="na-grid-lines"><line v-for="tick in [0, 0.25, 0.5, 0.75, 1]" :key="tick" x1="44" x2="746" :y1="18 + (200 * (1 - tick))" :y2="18 + (200 * (1 - tick))" /><text v-for="tick in [0, 0.25, 0.5, 0.75, 1]" :key="`count-${tick}`" x="36" :y="22 + (200 * (1 - tick))">{{ Math.round(analyticsMaxChartCount * tick) }}</text></g><path v-for="(modelItem, index) in analyticsModels" :key="`area-${modelItem.modelName}`" :d="analyticsTrendAreaPath(modelItem.modelName)" :fill="analyticsColor(index)" fill-opacity=".08" /><path v-for="(modelItem, index) in analyticsModels" :key="modelItem.modelName" :d="analyticsTrendPath(modelItem.modelName)" :stroke="analyticsColor(index)" fill="none" stroke-width="2" stroke-linecap="round" /><g class="na-axis-labels"><text v-for="(bucket, index) in analyticsChartBuckets" :key="bucket.bucket" :x="analyticsChartX(index)" y="242">{{ analyticsAxisLabel(bucket.bucket) }}</text></g></svg><div v-if="!analyticsModels.length" class="na-chart-empty">暂无数据</div><div v-else class="na-legend"><span v-for="(modelItem, index) in analyticsModels" :key="modelItem.modelName"><i :style="{ background: analyticsColor(index) }" />{{ modelItem.modelName }}</span></div></div>
            <div v-else-if="analyticsTab === 'distribution'" class="na-distribution-body"><div class="na-donut" :style="analyticsPieStyle"><div><strong>{{ analyticsTotalModelCount.toLocaleString('en-US') }}</strong><small>调用次数</small></div></div><div class="na-donut-legend"><div v-for="(modelItem, index) in analyticsModels" :key="modelItem.modelName"><span><i :style="{ background: analyticsColor(index) }" />{{ modelItem.modelName }}</span><strong>{{ modelItem.count.toLocaleString('en-US') }}</strong></div></div><div v-if="!analyticsModels.length" class="na-chart-empty">暂无数据</div></div>
            <div v-else class="na-ranking-body"><div v-if="analyticsModels.length" class="na-ranking-chart"><div v-for="(modelItem, index) in analyticsModels.slice(0, 12)" :key="modelItem.modelName" class="na-ranking-column"><strong>{{ modelItem.count.toLocaleString('en-US') }}</strong><span :style="{ height: `${analyticsRankBarHeight(modelItem.count)}px`, background: analyticsColor(index) }" /><small :title="modelItem.modelName">{{ modelItem.modelName }}</small></div></div><div v-else class="na-chart-empty">暂无数据</div></div>
          </section>
          <footer class="na-footer">New API SQLite · 仅展示模型调用元数据 · {{ analyticsFilterLabel() }} · {{ analytics.meta.startAt.slice(0, 10) }} — {{ analytics.meta.endAt.slice(0, 10) }}</footer>
        </template>
      </section>
    </template>

    <template v-else-if="usage && !isNewApi">

      <section class="panel usage-main-panel"><header class="panel-header"><div><span class="panel-title">调用记录</span><span class="panel-subtitle">SQLite 脱敏元数据 · 默认无请求与响应正文</span></div><span class="source-tag demo">{{ sourceLabel }}</span></header>
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
          <span class="realtime-search-hint" aria-live="polite">输入即搜索</span><button class="text-button" type="button" aria-label="清除调用筛选" @click="clearFilters">清除</button>
        </form>

        <div v-if="usage.items.length" class="table-responsive"><table class="data-table usage-table"><thead><tr><th>时间</th><th>人员 / Key</th><th>用途</th><th>模型 / 渠道</th><th>Token</th><th>结果</th><th /></tr></thead><tbody><tr v-for="item in usage.items" :key="item.requestId"><td><div class="usage-request"><small>{{ timeText(item.occurredAt) }}</small></div></td><td><div class="usage-owner"><strong>{{ item.person.name }}</strong><small>{{ item.person.department.name }} · {{ item.key.masked }}</small></div></td><td><div class="usage-purpose"><strong>{{ item.purpose.name }}</strong><code>{{ item.purpose.alias }}</code></div></td><td><div class="usage-model"><strong>{{ item.model.displayName }}</strong><small>{{ item.channel.name }}</small></div></td><td><div class="usage-numbers"><strong>{{ item.tokens.total.toLocaleString('zh-CN') }}</strong></div></td><td><span class="usage-status" :class="item.status"><i />{{ statusText[item.status] }}</span><small v-if="item.error" class="usage-error">{{ errorText[item.error.category] }}</small></td><td><button class="row-action enabled" :disabled="detailLoadingId === item.requestId" :aria-label="`查看 ${timeText(item.occurredAt)} 调用详情`" @click="openDetail(item)"><IconRefresh v-if="detailLoadingId === item.requestId" :size="15" class="spinning" /><IconChevronRight v-else :size="17" /></button></td></tr></tbody></table></div>
        <div v-else class="people-empty"><IconFileAnalytics :size="24" /><strong>没有符合条件的调用记录</strong><span>调整日期、人员、用途、渠道或请求 ID。</span><button class="text-button" @click="clearFilters">清除筛选</button></div>
        <footer class="usage-pagination"><span>共 {{ usage.pagination.total }} 条 · 第 {{ usage.pagination.page }}/{{ Math.max(usage.pagination.totalPages, 1) }} 页</span><div><button :disabled="usage.pagination.page <= 1" aria-label="上一页" @click="changePage(usage.pagination.page - 1)"><IconArrowLeft :size="15" /></button><button :disabled="usage.pagination.page >= usage.pagination.totalPages" aria-label="下一页" @click="changePage(usage.pagination.page + 1)"><IconArrowRight :size="15" /></button></div></footer>
      </section>
      <footer class="page-footer">数据来源：{{ sourceLabel }} · 日志只含脱敏元数据 · 不保存认证 Header、完整 Key 或未经授权的对话正文</footer>
    </template>

    <div v-if="detail" class="drawer-backdrop" @click.self="detail = null"><aside class="model-drawer usage-drawer" role="dialog" aria-modal="true" aria-label="调用详情"><header><div><span class="source-tag demo">{{ sourceLabel }}</span><h2>调用详情</h2></div><button class="icon-button" aria-label="关闭详情" @click="detail = null"><IconX :size="20" /></button></header>
      <section class="usage-drawer-hero"><div><span :class="detail.item.status"><IconCircleCheck v-if="detail.item.status === 'succeeded'" :size="20" /><IconAlertTriangle v-else :size="20" /></span><div><code>{{ detail.item.requestId }}</code><small>{{ timeText(detail.item.occurredAt) }} · {{ detail.client.name }}</small></div></div><span class="usage-status" :class="detail.item.status"><i />{{ statusText[detail.item.status] }}</span></section>
      <section class="drawer-section"><h3>调用归属</h3><dl class="model-facts"><div><dt>人员</dt><dd>{{ detail.item.person.name }}</dd></div><div><dt>部门</dt><dd>{{ detail.item.person.department.name }}</dd></div><div><dt>Key</dt><dd>{{ detail.item.key.masked }}</dd></div><div><dt>业务用途</dt><dd>{{ detail.item.purpose.name }}</dd></div></dl></section>
      <section class="usage-detail-metrics"><article><small>输入 Token</small><strong>{{ detail.item.tokens.input.toLocaleString('zh-CN') }}</strong></article><article><small>输出 Token</small><strong>{{ detail.item.tokens.output.toLocaleString('zh-CN') }}</strong></article><article><small>重试次数</small><strong>{{ detail.route.retryCount }}</strong></article></section>
      <section class="drawer-section"><h3>路由信息</h3><dl class="model-facts"><div><dt>业务别名</dt><dd>{{ detail.route.alias }}</dd></div><div><dt>实际模型</dt><dd>{{ detail.item.model.actualModel }}</dd></div><div><dt>上游渠道</dt><dd>{{ detail.item.channel.name }}</dd></div><div><dt>协议 / 模式</dt><dd>{{ detail.item.protocol === 'responses' ? 'Responses' : 'Chat Completions' }} · {{ detail.client.mode === 'stream' ? '流式' : '非流式' }}</dd></div></dl></section>
      <section v-if="detail.item.error" class="drawer-section"><h3>错误摘要</h3><div class="channel-error-detail"><IconAlertTriangle :size="18" /><div><strong>{{ errorText[detail.item.error.category] }}</strong><p>{{ detail.item.error.summary }}</p><small>不返回上游完整错误正文</small></div></div></section>
      <section class="usage-content-boundary"><IconShieldCheck :size="19" /><div><strong>无对话正文</strong><p>{{ detail.content.reason }}</p><small>请求 ID 已{{ detail.route.requestIdPropagated ? '透传' : '未验证' }}；对话审计必须通过独立授权页面访问。</small></div></section>
      <section v-if="detail.conversationAudit.accessible" class="usage-conversation-link"><IconShieldCheck :size="18" /><div><strong>已关联合成对话审计记录</strong><p>{{ detail.conversationAudit.notice }}</p></div><a class="btn btn-white" :href="detail.conversationAudit.href ?? undefined" aria-label="进入关联的对话审计">进入对话审计</a></section>
      <footer class="drawer-actions"><button class="btn" disabled><IconFileAnalytics :size="16" />导出记录</button></footer>
    </aside></div>
  </div>
</template>

<style scoped>
:global(:root) { --na-background: #fff; --na-foreground: #0a0a0a; --na-card: #fff; --na-border: #e5e5e5; --na-muted: #f5f5f5; --na-muted-foreground: #606060; --na-primary: #3ea4ec; --na-radius: 1rem; }
.new-api-page { position: relative; display: grid; gap: 14px; color: var(--na-foreground); }
.na-page-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 36px; }
.na-page-header h1 { margin: 0; color: var(--na-foreground); font-size: 20px; line-height: 1.35; font-weight: 650; letter-spacing: -.02em; }
.na-page-actions { display: flex; align-items: center; gap: 8px; }
.na-button { min-height: 32px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 12px; border: 1px solid transparent; border-radius: 7px; color: var(--na-foreground); background: transparent; font-size: 12px; font-weight: 500; transition: background .15s, border-color .15s, box-shadow .15s; }
.na-button:hover { background: var(--na-muted); }
.na-button-outline { border-color: var(--na-border); background: var(--na-card); }
.na-button-primary { border-color: var(--na-primary); color: #fff; background: var(--na-primary); }
.na-button-primary:hover { background: #238ed6; }
.na-popover { position: absolute; z-index: 20; top: 42px; right: 0; width: min(100%, 440px); display: grid; gap: 12px; padding: 16px; border: 1px solid var(--na-border); border-radius: 12px; background: var(--na-card); box-shadow: 0 18px 45px rgba(0,0,0,.14); }
.na-popover header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding-bottom: 4px; }
.na-popover header div { display: grid; gap: 3px; }.na-popover header strong { font-size: 14px; }.na-popover header small { color: var(--na-muted-foreground); font-size: 11px; }.na-popover header button { display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 6px; color: var(--na-muted-foreground); background: transparent; }.na-popover header button:hover { background: var(--na-muted); }
.na-popover > label { display: grid; gap: 6px; color: var(--na-foreground); font-size: 12px; font-weight: 500; }.na-popover select, .na-popover input { min-height: 34px; padding: 0 10px; border: 1px solid var(--na-border); border-radius: 7px; outline: 0; color: var(--na-foreground); background: var(--na-background); font: inherit; }.na-popover select:focus, .na-popover input:focus { border-color: var(--na-primary); box-shadow: 0 0 0 2px rgba(62,164,236,.16); }
.na-popover footer { display: flex; justify-content: flex-end; gap: 8px; padding-top: 4px; }.na-filter-section { display: grid; gap: 8px; }.na-filter-section-title { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; }.na-quick-range { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; }.na-quick-range button { min-height: 32px; border: 1px solid var(--na-border); border-radius: 7px; color: var(--na-foreground); background: var(--na-background); font-size: 11px; }.na-quick-range button.active { border-color: var(--na-primary); color: var(--na-primary); box-shadow: 0 0 0 2px rgba(62,164,236,.13); }.na-filter-divider { position: relative; display: flex; align-items: center; justify-content: center; margin: 2px 0; color: var(--na-muted-foreground); font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }.na-filter-divider::before { content: ''; position: absolute; inset: 50% 0 auto; border-top: 1px solid var(--na-border); }.na-filter-divider span { position: relative; padding: 0 8px; background: var(--na-card); }
.na-state { min-height: 150px; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 24px; border: 1px solid var(--na-border); border-radius: 10px; color: var(--na-muted-foreground); background: var(--na-card); }.na-state > div { display: grid; gap: 3px; }.na-state strong { color: var(--na-foreground); font-size: 13px; }.na-state span { font-size: 11px; }.na-state-error { color: #d33; }.na-state-error strong { color: #b42318; }.na-state .na-button { margin-left: 10px; }
.na-stat-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); overflow: hidden; border: 1px solid var(--na-border); border-radius: 9px; background: var(--na-card); }
.na-stat-item { min-width: 0; min-height: 112px; padding: 16px 20px; border-right: 1px solid var(--na-border); }.na-stat-item:last-child { border-right: 0; }.na-stat-label { display: flex; align-items: center; gap: 8px; min-width: 0; color: var(--na-muted-foreground); font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; }.na-stat-label > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.na-stat-icon { width: 28px; height: 28px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 7px; }.na-tone-teal { color: #1677b7; background: #e7f4fc; }.na-tone-blue { color: #2e9b65; background: #e9f8f0; }.na-tone-violet { color: #7954bc; background: #f0ebfa; }.na-tone-green { color: #2c9a68; background: #e9f8f0; }.na-tone-orange { color: #d97819; background: #fff2e5; }.na-stat-value { display: block; max-width: 100%; margin-top: 9px; overflow: hidden; color: var(--na-foreground); font: 700 24px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: -.04em; text-overflow: ellipsis; white-space: nowrap; }.na-stat-item small { display: block; margin-top: 7px; overflow: hidden; color: rgba(96,96,96,.62); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.na-chart-card { overflow: hidden; border: 1px solid var(--na-border); border-radius: 9px; background: var(--na-card); }.na-chart-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 52px; padding: 10px 20px; border-bottom: 1px solid var(--na-border); }.na-chart-title { display: flex; align-items: center; gap: 8px; min-width: 0; }.na-chart-title strong { color: var(--na-foreground); font-size: 13px; font-weight: 650; white-space: nowrap; }.na-chart-title > span:last-child { color: var(--na-muted-foreground); font-size: 11px; white-space: nowrap; }.na-chart-icon { width: 25px; height: 25px; display: grid; place-items: center; border-radius: 6px; }.na-chart-icon-success { color: #269a65; background: #e9f8f0; }.na-chart-icon-info { color: #7b5abd; background: #f0ebfa; }.na-chart-switch, .na-chart-tabs { display: inline-flex; align-items: center; gap: 2px; padding: 3px; border: 1px solid var(--na-border); border-radius: 7px; background: rgba(245,245,245,.75); }.na-chart-switch button, .na-chart-tabs button { display: inline-flex; align-items: center; gap: 5px; min-height: 26px; padding: 0 10px; border: 0; border-radius: 5px; color: var(--na-muted-foreground); background: transparent; font-size: 11px; white-space: nowrap; }.na-chart-switch button.active, .na-chart-tabs button.active { color: var(--na-foreground); background: var(--na-background); box-shadow: 0 1px 3px rgba(0,0,0,.10); }.na-chart-switch button:hover, .na-chart-tabs button:hover { color: var(--na-foreground); }
.na-chart-body { position: relative; min-height: 300px; padding: 8px 10px 4px; }.na-chart-body > svg { display: block; width: 100%; height: 300px; overflow: visible; }.na-grid-lines line { stroke: #ececec; stroke-width: 1; }.na-grid-lines text { fill: #a0a0a0; font: 9px ui-monospace, SFMono-Regular, Menlo, monospace; text-anchor: end; }.na-axis-labels text { fill: #858585; font-size: 9px; text-anchor: middle; }.na-bars rect { opacity: .92; transition: opacity .15s; }.na-bars rect:hover { opacity: .68; }.na-area-lines path { transition: opacity .15s; }.na-legend { display: flex; flex-wrap: wrap; gap: 7px 15px; padding: 5px 10px 12px 44px; color: var(--na-muted-foreground); font-size: 10px; }.na-legend span { display: inline-flex; align-items: center; gap: 6px; }.na-legend i, .na-donut-legend i { width: 8px; height: 8px; flex: 0 0 auto; display: inline-block; border-radius: 50%; }.na-chart-empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--na-muted-foreground); font-size: 12px; }.na-model-chart { min-height: 330px; }
.na-distribution-body { position: relative; display: grid; grid-template-columns: minmax(230px, 1fr) minmax(230px, 1fr); align-items: center; gap: 24px; min-height: 300px; padding: 24px 48px; }.na-donut { width: 210px; height: 210px; display: grid; place-items: center; margin: auto; border-radius: 50%; }.na-donut::before { content: ''; position: absolute; width: 124px; height: 124px; border-radius: 50%; background: var(--na-card); }.na-donut > div { position: relative; z-index: 1; display: grid; place-items: center; }.na-donut strong { font: 700 23px ui-monospace, SFMono-Regular, Menlo, monospace; }.na-donut small { color: var(--na-muted-foreground); font-size: 10px; }.na-donut-legend { display: grid; gap: 11px; max-height: 230px; overflow: auto; }.na-donut-legend > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--na-muted-foreground); font-size: 11px; }.na-donut-legend span { display: inline-flex; align-items: center; gap: 7px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.na-donut-legend strong { color: var(--na-foreground); font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
.na-ranking-body { min-height: 300px; padding: 26px 34px 16px; }.na-ranking-chart { height: 255px; display: flex; align-items: flex-end; gap: 12px; padding: 0 12px 28px 38px; border-bottom: 1px solid #ededed; }.na-ranking-column { position: relative; flex: 1 1 0; min-width: 26px; height: 100%; display: flex; align-items: center; flex-direction: column; justify-content: flex-end; gap: 5px; }.na-ranking-column > strong { color: var(--na-muted-foreground); font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; }.na-ranking-column > span { width: min(38px, 78%); min-height: 2px; border-radius: 4px 4px 0 0; opacity: .9; }.na-ranking-column > small { width: 100%; overflow: hidden; color: var(--na-muted-foreground); font-size: 9px; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
.na-footer { padding: 3px 0 1px; color: #999; font-size: 10px; text-align: center; }
.na-stat-item:nth-child(even) { border-right: 0; }.na-stat-item:nth-child(n + 3) { border-top: 1px solid var(--na-border); }
@media (min-width: 700px) { .na-stat-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }.na-stat-item:nth-child(even) { border-right: 1px solid var(--na-border); }.na-stat-item:nth-child(3n) { border-right: 0; }.na-stat-item:nth-child(n + 4) { border-top: 1px solid var(--na-border); }.na-stat-item:nth-child(4) { border-right: 1px solid var(--na-border); } }
@media (min-width: 1024px) { .na-stat-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }.na-stat-item:nth-child(n) { border-top: 0; }.na-stat-item:nth-child(3n), .na-stat-item:nth-child(4) { border-right: 1px solid var(--na-border); }.na-stat-item:last-child { border-right: 0; } }
@media (max-width: 980px) { .na-chart-header { align-items: flex-start; flex-direction: column; }.na-chart-switch, .na-chart-tabs { width: 100%; overflow-x: auto; }.na-chart-switch button, .na-chart-tabs button { flex: 0 0 auto; }.na-distribution-body { padding-inline: 20px; } }
@media (max-width: 640px) { .new-api-page { gap: 10px; }.na-page-header h1 { font-size: 18px; }.na-stat-item { padding: 12px; }.na-stat-value { font-size: 20px; }.na-chart-header { padding-inline: 12px; }.na-chart-body { padding-inline: 4px; }.na-distribution-body { grid-template-columns: 1fr; gap: 18px; padding: 20px; }.na-donut { width: 170px; height: 170px; }.na-donut::before { width: 102px; height: 102px; }.na-ranking-body { padding-inline: 12px; }.na-ranking-chart { gap: 6px; padding-left: 22px; }.na-popover { position: fixed; top: 70px; right: 12px; left: 12px; width: auto; max-height: calc(100vh - 90px); overflow-y: auto; } }
</style>
