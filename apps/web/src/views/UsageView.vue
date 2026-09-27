<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  IconActivityHeartbeat, IconAlertTriangle, IconChartAreaLine, IconChartBar,
  IconChartPie, IconFileAnalytics, IconFilter, IconRefresh, IconSettings2,
  IconWallet, IconX,
} from '@tabler/icons-vue'
import { fetchModelAnalytics, type ModelAnalyticsQuery, type ModelAnalyticsResponse } from '../usage-api'

const analytics = ref<ModelAnalyticsResponse | null>(null)
const analyticsError = ref('')
const analyticsLoading = ref(false)
const analyticsDays = ref<ModelAnalyticsQuery['days']>(1)
const analyticsGranularity = ref<ModelAnalyticsQuery['timeGranularity']>('hour')
const analyticsPerson = ref('all')
const analyticsTab = ref<'trend' | 'distribution' | 'ranking'>('trend')
const analyticsFilterOpen = ref(false)
const analyticsPreferencesOpen = ref(false)
const tokenChartType = ref<'bar' | 'area'>('bar')
let analyticsRequest: AbortController | undefined

type AnalyticsChartBucket = {
  bucket: string
  count: number
  tokens: number
  models: Record<string, { count: number; tokens: number }>
}

type AnalyticsChartModel = {
  modelName: string
  count: number
  tokens: number
  overflow: boolean
  hiddenModelCount: number
}

const MAX_MODELS_IN_CHART = 6
const chartPalette = ['#5B8FF9', '#5AD8A6', '#F6BD16', '#E8684A', '#6DC8EC', '#9270CA', '#FF9D4D', '#269A99', '#FF99C3', '#5D7092']
const analyticsModels = computed(() => analytics.value?.models ?? [])
const analyticsPeople = computed(() => analytics.value?.options.people ?? [])
const chartModels = computed<AnalyticsChartModel[]>(() => {
  const direct = analyticsModels.value.slice(0, MAX_MODELS_IN_CHART).map((item) => ({ ...item, overflow: false, hiddenModelCount: 0 }))
  const hidden = analyticsModels.value.slice(MAX_MODELS_IN_CHART)
  if (!hidden.length) return direct
  return [...direct, {
    modelName: `其他 ${hidden.length} 个实际模型`,
    count: hidden.reduce((sum, item) => sum + item.count, 0),
    tokens: hidden.reduce((sum, item) => sum + item.tokens, 0),
    overflow: true,
    hiddenModelCount: hidden.length,
  }]
})
const directChartModelNames = computed(() => new Set(chartModels.value.filter((item) => !item.overflow).map((item) => item.modelName)))
const chartOverflowModel = computed(() => chartModels.value.find((item) => item.overflow) ?? null)
const analyticsMaxModelCount = computed(() => Math.max(1, ...chartModels.value.map((item) => item.count)))
const analyticsTotalModelCount = computed(() => analyticsModels.value.reduce((sum, item) => sum + item.count, 0))
const selectedPersonLabel = computed(() => analyticsPerson.value === 'all'
  ? '全部人员'
  : analyticsPeople.value.find((item) => item.id === analyticsPerson.value)?.label ?? '已选人员')

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
    const bucket = byBucket.get(item.bucket) ?? { bucket: item.bucket, count: 0, tokens: 0, models: {} }
    const model = bucket.models[item.modelName] ?? { count: 0, tokens: 0 }
    model.count += item.count
    model.tokens += item.tokens
    bucket.models[item.modelName] = model
    bucket.count += item.count
    bucket.tokens += item.tokens
    byBucket.set(item.bucket, bucket)
  }
  const end = analyticsBucketStart(new Date(analytics.value.meta.endAt), analyticsGranularity.value)
  const step = analyticsBucketStep(analyticsGranularity.value)
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(end.getTime() - (6 - index) * step)
    const key = date.toISOString()
    return byBucket.get(key) ?? { bucket: key, count: 0, tokens: 0, models: {} }
  })
})

const analyticsMaxToken = computed(() => Math.max(1, ...analyticsChartBuckets.value.map((item) => item.tokens)))
const analyticsMaxChartCount = computed(() => Math.max(1, ...analyticsChartBuckets.value.map((item) => item.count)))
const analyticsPieStyle = computed(() => {
  if (!analyticsModels.value.length || analyticsTotalModelCount.value <= 0) return { background: 'var(--na-muted)' }
  let cursor = 0
  const stops = chartModels.value.map((item, index) => {
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
    { key: 'count', label: '总调用次数', value: value?.totalCount.toLocaleString('en-US') ?? '—', hint: '真实网关调用', tone: 'teal' },
    { key: 'tokens', label: '令牌总量', value: value ? compactNumber(value.totalTokens) : '—', hint: '输入 + 输出令牌', tone: 'violet' },
    { key: 'rpm', label: '平均请求速率', value: value ? value.averageRpm.toFixed(2) : '—', hint: '每分钟请求数', tone: 'green' },
    { key: 'tpm', label: '平均令牌速率', value: value ? compactNumber(value.averageTpm) : '—', hint: '每分钟令牌数', tone: 'orange' },
  ]
})

function compactNumber(value: number | undefined) {
  if (value === undefined) return '—'
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}K` : String(value)
}

function analyticsColor(index: number) { return chartPalette[index % chartPalette.length] }
function analyticsChartMetric(bucket: AnalyticsChartBucket, model: AnalyticsChartModel, metric: 'count' | 'tokens') {
  if (!model.overflow) return bucket.models[model.modelName]?.[metric] ?? 0
  return Object.entries(bucket.models)
    .filter(([modelName]) => !directChartModelNames.value.has(modelName))
    .reduce((sum, [, value]) => sum + value[metric], 0)
}
function analyticsChartPointCount(bucket: AnalyticsChartBucket, model: AnalyticsChartModel) { return analyticsChartMetric(bucket, model, 'count') }
function analyticsChartTokens(bucket: AnalyticsChartBucket, model: AnalyticsChartModel) { return analyticsChartMetric(bucket, model, 'tokens') }

function analyticsTrendPath(model: AnalyticsChartModel) {
  const buckets = analyticsChartBuckets.value
  if (!buckets.length) return ''
  const width = 760; const height = 250; const left = 44; const right = 14; const top = 18; const bottom = 32
  const xStep = (width - left - right) / Math.max(1, buckets.length - 1)
  return buckets.map((bucket, index) => {
    const value = analyticsChartPointCount(bucket, model)
    const x = left + index * xStep
    const y = top + (height - top - bottom) * (1 - value / analyticsMaxChartCount.value)
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

function analyticsTrendAreaPath(model: AnalyticsChartModel) {
  const line = analyticsTrendPath(model)
  if (!line) return ''
  const width = 760; const height = 250; const left = 44; const right = 14; const bottom = 32
  return `${line} L${width - right},${height - bottom} L${left},${height - bottom} Z`
}

function analyticsTokenLinePath(model: AnalyticsChartModel) {
  const buckets = analyticsChartBuckets.value
  if (!buckets.length) return ''
  const width = 760; const height = 250; const left = 44; const right = 14; const top = 18; const bottom = 32
  const xStep = (width - left - right) / Math.max(1, buckets.length - 1)
  return buckets.map((bucket, index) => {
    const value = analyticsChartTokens(bucket, model)
    const x = left + index * xStep
    const y = top + (height - top - bottom) * (1 - value / analyticsMaxToken.value)
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

function analyticsTokenAreaPath(model: AnalyticsChartModel) {
  const line = analyticsTokenLinePath(model)
  if (!line) return ''
  const width = 760; const height = 250; const left = 44; const right = 14; const bottom = 32
  return `${line} L${width - right},${height - bottom} L${left},${height - bottom} Z`
}

function analyticsChartX(index: number) {
  const left = 44; const right = 14; const width = 760
  return left + index * ((width - left - right) / Math.max(1, analyticsChartBuckets.value.length - 1))
}

function analyticsTokenBarWidth() { return Math.max(12, Math.min(38, 560 / Math.max(1, analyticsChartBuckets.value.length))) }
function analyticsTokenBarHeight(value: number) { return (250 - 18 - 32) * (value / analyticsMaxToken.value) }
function analyticsTokenBarY(bucket: AnalyticsChartBucket, modelIndex: number) {
  const total = chartModels.value.slice(0, modelIndex).reduce((sum, item) => sum + analyticsChartTokens(bucket, item), 0)
  const model = chartModels.value[modelIndex]
  return 250 - 32 - analyticsTokenBarHeight(total + (model ? analyticsChartTokens(bucket, model) : 0))
}
function analyticsRankBarHeight(value: number) { return Math.max(2, 190 * (value / analyticsMaxModelCount.value)) }
function compactModelName(value: string, limit = 26) {
  if (value.length <= limit) return value
  const tailLength = Math.min(8, Math.floor(limit / 3))
  return `${value.slice(0, limit - tailLength - 1)}…${value.slice(-tailLength)}`
}
function chartModelLabel(model: AnalyticsChartModel) {
  return model.overflow ? `其他 ${model.hiddenModelCount} 个` : compactModelName(model.modelName)
}
function chartModelTitle(model: AnalyticsChartModel) {
  return model.overflow
    ? `其余 ${model.hiddenModelCount} 个实际模型已合并；完整名称见下方明细。`
    : model.modelName
}
function modelShare(count: number) {
  if (!analyticsTotalModelCount.value) return '0%'
  return `${((count / analyticsTotalModelCount.value) * 100).toFixed(1)}%`
}
function analyticsAxisLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return analyticsGranularity.value === 'hour'
    ? `${String(date.getUTCHours()).padStart(2, '0')}:00`
    : `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}`
}

function analyticsFilterLabel() {
  const range = `${analyticsDays.value} 天`
  return `${range} · ${selectedPersonLabel.value}`
}

function analyticsQuery(): ModelAnalyticsQuery {
  return { days: analyticsDays.value, timeGranularity: analyticsGranularity.value, person: analyticsPerson.value }
}

async function loadModelAnalytics() {
  analyticsRequest?.abort()
  const next = new AbortController()
  analyticsRequest = next
  analyticsLoading.value = true
  analyticsError.value = ''
  try {
    analytics.value = await fetchModelAnalytics(analyticsQuery(), next.signal)
    if (analyticsPerson.value !== 'all' && !analytics.value.options.people.some((item) => item.id === analyticsPerson.value)) analyticsPerson.value = 'all'
  } catch (error) {
    if (next.signal.aborted) return
    analytics.value = null
    analyticsError.value = error instanceof Error ? error.message : '模型调用分析暂时无法加载'
  } finally {
    if (!next.signal.aborted) analyticsLoading.value = false
  }
}

function applyAnalyticsFilters() { void loadModelAnalytics() }
function resetAnalyticsFilters() {
  analyticsDays.value = 1
  analyticsGranularity.value = 'hour'
  analyticsPerson.value = 'all'
  analyticsFilterOpen.value = false
  void loadModelAnalytics()
}

onMounted(() => void loadModelAnalytics())
onBeforeUnmount(() => analyticsRequest?.abort())
</script>

<template>
  <div class="dashboard usage-dashboard">
    <section class="usage-analytics-page" aria-label="模型调用分析">
      <header class="na-page-header">
        <div class="na-heading-copy">
          <div class="na-eyebrow">AI OPS · LOCAL GATEWAY</div>
          <h1>模型调用分析</h1>
          <p>按模型查看本机 AI OPS 网关已采集的真实调用、Token 与速率。</p>
        </div>
        <div class="na-page-actions">
          <button type="button" class="na-button na-button-outline" :disabled="analyticsLoading" @click="loadModelAnalytics"><IconRefresh :size="15" :class="{ spinning: analyticsLoading }" />刷新</button>
          <button type="button" class="na-button na-button-outline" aria-label="偏好设置" @click="analyticsPreferencesOpen = !analyticsPreferencesOpen; analyticsFilterOpen = false"><IconSettings2 :size="15" />偏好设置</button>
          <button type="button" class="na-button na-button-outline" aria-label="筛选" @click="analyticsFilterOpen = !analyticsFilterOpen; analyticsPreferencesOpen = false"><IconFilter :size="15" />筛选</button>
        </div>
      </header>

      <div v-if="analyticsPreferencesOpen" class="na-popover na-preferences" role="dialog" aria-label="模型分析默认设置">
        <header><div><strong>模型分析默认设置</strong><small>设置默认时间范围和图表形式。</small></div><button type="button" aria-label="关闭偏好设置" @click="analyticsPreferencesOpen = false"><IconX :size="16" /></button></header>
        <label>默认时间范围<select v-model="analyticsDays"><option :value="1">1 天</option><option :value="7">7 天</option><option :value="14">14 天</option><option :value="29">29 天</option></select></label>
        <label>默认时间粒度<select v-model="analyticsGranularity"><option value="hour">小时</option><option value="day">天</option><option value="week">周</option></select></label>
        <label>Token 图表<select v-model="tokenChartType"><option value="bar">柱状图</option><option value="area">面积图</option></select></label>
        <label>调用图表<select v-model="analyticsTab"><option value="trend">调用趋势</option><option value="distribution">调用次数分布</option><option value="ranking">调用次数排行</option></select></label>
        <button type="button" class="na-button na-button-primary" @click="analyticsPreferencesOpen = false; applyAnalyticsFilters()">保存设置</button>
      </div>

      <div v-if="analyticsFilterOpen" class="na-popover na-filter-popover" role="dialog" aria-label="模型分析筛选">
        <header><div><strong>模型分析筛选</strong><small>按时间范围和人员查看本地网关真实调用。</small></div><button type="button" aria-label="关闭筛选" @click="analyticsFilterOpen = false"><IconX :size="16" /></button></header>
        <div class="na-filter-section"><span class="na-filter-section-title"><IconChartAreaLine :size="14" />快速范围</span><div class="na-quick-range"><button v-for="range in [1, 7, 14, 29]" :key="range" type="button" :class="{ active: analyticsDays === range }" @click="analyticsDays = range; analyticsGranularity = range === 1 ? 'hour' : range === 29 ? 'week' : 'day'">{{ range }} 天</button></div></div>
        <div class="na-filter-divider"><span>图表设置</span></div>
        <label>时间粒度<select v-model="analyticsGranularity"><option value="hour">小时</option><option value="day">天</option><option value="week">周</option></select></label>
        <label>人员<select v-model="analyticsPerson" aria-label="人员"><option value="all">全部人员</option><option v-for="item in analyticsPeople" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
        <footer><button type="button" class="na-button na-button-outline" @click="resetAnalyticsFilters">重置</button><button type="button" class="na-button na-button-primary" @click="analyticsFilterOpen = false; applyAnalyticsFilters()">应用筛选</button></footer>
      </div>

      <div v-if="analyticsLoading && !analytics" class="na-state"><IconRefresh :size="20" class="spinning" /><div><strong>正在加载模型调用分析</strong><span>正在读取 AI OPS 本地网关的调用元数据。</span></div></div>
      <div v-else-if="analyticsError" class="na-state na-state-error"><IconAlertTriangle :size="20" /><div><strong>模型调用分析暂不可用</strong><span>{{ analyticsError }}</span></div><button type="button" class="na-button na-button-outline" @click="applyAnalyticsFilters">重试</button></div>
      <template v-else-if="analytics">
        <section class="na-stat-grid" aria-label="模型调用分析统计">
          <article v-for="card in analyticsCards" :key="card.label" class="na-stat-item">
            <div class="na-stat-label"><span class="na-stat-icon" :class="`na-tone-${card.tone}`"><IconActivityHeartbeat v-if="card.key === 'count'" :size="14" /><IconFileAnalytics v-else-if="card.key === 'tokens'" :size="14" /><IconChartAreaLine v-else-if="card.key === 'rpm'" :size="14" /><IconChartBar v-else :size="14" /></span><span>{{ card.label }}</span></div>
            <strong class="na-stat-value">{{ card.value }}</strong>
            <small>{{ card.hint }}</small>
          </article>
        </section>

        <section class="na-chart-card" aria-label="Token 分布">
          <header class="na-chart-header"><div class="na-chart-title"><span class="na-chart-icon na-chart-icon-success"><IconWallet :size="15" /></span><strong>Token 分布</strong><span>总计：{{ compactNumber(analytics.summary.totalTokens) }}</span></div><div class="na-chart-switch"><button type="button" :class="{ active: tokenChartType === 'bar' }" @click="tokenChartType = 'bar'"><IconChartBar :size="13" />柱状图</button><button type="button" :class="{ active: tokenChartType === 'area' }" @click="tokenChartType = 'area'"><IconChartAreaLine :size="13" />面积图</button></div></header>
          <div class="na-chart-body">
            <svg viewBox="0 0 760 250" role="img" aria-label="Token 分布图" preserveAspectRatio="none">
              <g class="na-grid-lines"><line v-for="tick in [0, 0.25, 0.5, 0.75, 1]" :key="tick" x1="44" x2="746" :y1="18 + (200 * (1 - tick))" :y2="18 + (200 * (1 - tick))" /><text v-for="tick in [0, 0.25, 0.5, 0.75, 1]" :key="`token-${tick}`" x="36" :y="22 + (200 * (1 - tick))">{{ tick === 0 ? '0' : compactNumber(analyticsMaxToken * tick) }}</text></g>
              <g v-if="tokenChartType === 'bar'" class="na-bars"><g v-for="(bucket, bucketIndex) in analyticsChartBuckets" :key="bucket.bucket"><rect v-for="(modelItem, modelIndex) in chartModels" :key="modelItem.modelName" :x="analyticsChartX(bucketIndex) - analyticsTokenBarWidth() / 2" :y="analyticsTokenBarY(bucket, modelIndex)" :width="analyticsTokenBarWidth()" :height="analyticsTokenBarHeight(analyticsChartTokens(bucket, modelItem))" :fill="analyticsColor(modelIndex)" rx="3" /></g></g>
              <g v-else class="na-area-lines"><path v-for="(modelItem, index) in chartModels" :key="modelItem.modelName" :d="analyticsTokenAreaPath(modelItem)" :fill="analyticsColor(index)" fill-opacity=".10" /><path v-for="(modelItem, index) in chartModels" :key="`line-${modelItem.modelName}`" :d="analyticsTokenLinePath(modelItem)" :stroke="analyticsColor(index)" fill="none" stroke-width="2" stroke-linecap="round" /></g>
              <g class="na-axis-labels"><text v-for="(bucket, index) in analyticsChartBuckets" :key="`x-${bucket.bucket}`" :x="analyticsChartX(index)" y="242">{{ analyticsAxisLabel(bucket.bucket) }}</text></g>
            </svg>
            <div v-if="!analyticsModels.length" class="na-chart-empty">暂无真实调用数据</div>
            <div v-else class="na-legend"><span v-for="(modelItem, index) in chartModels" :key="modelItem.modelName" :title="chartModelTitle(modelItem)"><i :style="{ background: analyticsColor(index) }" />{{ chartModelLabel(modelItem) }}</span></div>
          </div>
        </section>

        <section class="na-chart-card" aria-label="模型调用分析图表">
          <header class="na-chart-header na-model-header"><div class="na-chart-title"><span class="na-chart-icon na-chart-icon-info"><IconChartPie :size="15" /></span><strong>模型调用分析</strong><span>总计：{{ analytics.summary.totalCount.toLocaleString('en-US') }}</span></div><nav class="na-chart-tabs" role="tablist" aria-label="模型调用分析视图"><button type="button" role="tab" :aria-selected="analyticsTab === 'trend'" :class="{ active: analyticsTab === 'trend' }" @click="analyticsTab = 'trend'">调用趋势</button><button type="button" role="tab" :aria-selected="analyticsTab === 'distribution'" :class="{ active: analyticsTab === 'distribution' }" @click="analyticsTab = 'distribution'">调用次数分布</button><button type="button" role="tab" :aria-selected="analyticsTab === 'ranking'" :class="{ active: analyticsTab === 'ranking' }" @click="analyticsTab = 'ranking'">调用次数排行</button></nav></header>
          <div v-if="analyticsTab === 'trend'" class="na-chart-body na-model-chart"><svg viewBox="0 0 760 250" role="img" aria-label="调用趋势图" preserveAspectRatio="none"><g class="na-grid-lines"><line v-for="tick in [0, 0.25, 0.5, 0.75, 1]" :key="tick" x1="44" x2="746" :y1="18 + (200 * (1 - tick))" :y2="18 + (200 * (1 - tick))" /><text v-for="tick in [0, 0.25, 0.5, 0.75, 1]" :key="`count-${tick}`" x="36" :y="22 + (200 * (1 - tick))">{{ Math.round(analyticsMaxChartCount * tick) }}</text></g><path v-for="(modelItem, index) in chartModels" :key="`area-${modelItem.modelName}`" :d="analyticsTrendAreaPath(modelItem)" :fill="analyticsColor(index)" fill-opacity=".08" /><path v-for="(modelItem, index) in chartModels" :key="modelItem.modelName" :d="analyticsTrendPath(modelItem)" :stroke="analyticsColor(index)" fill="none" stroke-width="2" stroke-linecap="round" /><g class="na-axis-labels"><text v-for="(bucket, index) in analyticsChartBuckets" :key="bucket.bucket" :x="analyticsChartX(index)" y="242">{{ analyticsAxisLabel(bucket.bucket) }}</text></g></svg><div v-if="!analyticsModels.length" class="na-chart-empty">暂无真实调用数据</div><div v-else class="na-legend"><span v-for="(modelItem, index) in chartModels" :key="modelItem.modelName" :title="chartModelTitle(modelItem)"><i :style="{ background: analyticsColor(index) }" />{{ chartModelLabel(modelItem) }}</span></div></div>
          <div v-else-if="analyticsTab === 'distribution'" class="na-distribution-body"><div class="na-donut" :style="analyticsPieStyle"><div><strong>{{ analyticsTotalModelCount.toLocaleString('en-US') }}</strong><small>调用次数</small></div></div><div class="na-donut-legend"><div v-for="(modelItem, index) in chartModels" :key="modelItem.modelName"><span :title="chartModelTitle(modelItem)"><i :style="{ background: analyticsColor(index) }" />{{ chartModelLabel(modelItem) }}</span><strong>{{ modelItem.count.toLocaleString('en-US') }}</strong></div></div><div v-if="!analyticsModels.length" class="na-chart-empty">暂无真实调用数据</div></div>
          <div v-else class="na-ranking-body"><div v-if="analyticsModels.length" class="na-ranking-chart"><div v-for="(modelItem, index) in chartModels" :key="modelItem.modelName" class="na-ranking-column"><strong>{{ modelItem.count.toLocaleString('en-US') }}</strong><span :style="{ height: `${analyticsRankBarHeight(modelItem.count)}px`, background: analyticsColor(index) }" /><small :title="chartModelTitle(modelItem)">{{ chartModelLabel(modelItem) }}</small></div></div><div v-else class="na-chart-empty">暂无真实调用数据</div></div>
        </section>
        <div v-if="chartOverflowModel" class="na-model-display-note">图表只展示调用量最高的 {{ MAX_MODELS_IN_CHART }} 个实际模型；其余 {{ chartOverflowModel.hiddenModelCount }} 个已合并为“其他”。完整模型名称和数据见下方明细。</div>

        <section class="na-chart-card na-actual-model-card" aria-label="实际模型明细">
          <header class="na-chart-header"><div class="na-chart-title"><span class="na-chart-icon na-chart-icon-info"><IconFileAnalytics :size="15" /></span><strong>实际模型明细</strong><span>共 {{ analyticsModels.length }} 个实际模型</span></div></header>
          <div v-if="analyticsModels.length" class="na-actual-model-scroll"><table class="na-actual-model-table"><thead><tr><th scope="col">实际模型名称</th><th scope="col">调用次数</th><th scope="col">Token</th><th scope="col">占比</th></tr></thead><tbody><tr v-for="modelItem in analyticsModels" :key="modelItem.modelName"><td><code :title="modelItem.modelName">{{ modelItem.modelName }}</code></td><td>{{ modelItem.count.toLocaleString('en-US') }}</td><td>{{ compactNumber(modelItem.tokens) }}</td><td>{{ modelShare(modelItem.count) }}</td></tr></tbody></table></div>
          <div v-else class="na-actual-model-empty">暂无真实调用数据</div>
        </section>
        <footer class="na-footer">AI OPS 本地网关 · 仅展示真实调用元数据 · {{ analyticsFilterLabel() }} · {{ analytics.meta.startAt.slice(0, 10) }} — {{ analytics.meta.endAt.slice(0, 10) }}</footer>
      </template>
    </section>
  </div>
</template>

<style scoped>
:global(:root) { --na-background: #fff; --na-foreground: #0a0a0a; --na-card: #fff; --na-border: #e5e5e5; --na-muted: #f5f5f5; --na-muted-foreground: #606060; --na-primary: #3ea4ec; --na-radius: 1rem; }
.usage-analytics-page { position: relative; display: grid; gap: 14px; color: var(--na-foreground); }
.na-page-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 36px; }.na-heading-copy { display: grid; gap: 2px; }.na-eyebrow { color: #1681be; font-size: 10px; font-weight: 750; letter-spacing: .11em; }.na-heading-copy p { margin: 0; color: var(--na-muted-foreground); font-size: 12px; }
.na-page-header h1 { margin: 0; color: var(--na-foreground); font-size: 20px; line-height: 1.35; font-weight: 650; letter-spacing: -.02em; }.na-page-actions { display: flex; align-items: center; gap: 8px; }
.na-button { min-height: 32px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 12px; border: 1px solid transparent; border-radius: 7px; color: var(--na-foreground); background: transparent; font-size: 12px; font-weight: 500; transition: background .15s, border-color .15s, box-shadow .15s; }.na-button:hover { background: var(--na-muted); }.na-button:disabled { cursor: wait; opacity: .7; }.na-button-outline { border-color: var(--na-border); background: var(--na-card); }.na-button-primary { border-color: var(--na-primary); color: #fff; background: var(--na-primary); }.na-button-primary:hover { background: #238ed6; }
.na-popover { position: absolute; z-index: 20; top: 78px; right: 0; width: min(100%, 440px); display: grid; gap: 12px; padding: 16px; border: 1px solid var(--na-border); border-radius: 12px; background: var(--na-card); box-shadow: 0 18px 45px rgba(0,0,0,.14); }.na-popover header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding-bottom: 4px; }.na-popover header div { display: grid; gap: 3px; }.na-popover header strong { font-size: 14px; }.na-popover header small { color: var(--na-muted-foreground); font-size: 11px; }.na-popover header button { display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 6px; color: var(--na-muted-foreground); background: transparent; }.na-popover header button:hover { background: var(--na-muted); }
.na-popover > label { display: grid; gap: 6px; color: var(--na-foreground); font-size: 12px; font-weight: 500; }.na-popover select { min-height: 34px; padding: 0 10px; border: 1px solid var(--na-border); border-radius: 7px; outline: 0; color: var(--na-foreground); background: var(--na-background); font: inherit; }.na-popover select:focus { border-color: var(--na-primary); box-shadow: 0 0 0 2px rgba(62,164,236,.16); }.na-popover footer { display: flex; justify-content: flex-end; gap: 8px; padding-top: 4px; }.na-filter-section { display: grid; gap: 8px; }.na-filter-section-title { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; }.na-quick-range { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; }.na-quick-range button { min-height: 32px; border: 1px solid var(--na-border); border-radius: 7px; color: var(--na-foreground); background: var(--na-background); font-size: 11px; }.na-quick-range button.active { border-color: var(--na-primary); color: var(--na-primary); box-shadow: 0 0 0 2px rgba(62,164,236,.13); }.na-filter-divider { position: relative; display: flex; align-items: center; justify-content: center; margin: 2px 0; color: var(--na-muted-foreground); font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }.na-filter-divider::before { content: ''; position: absolute; inset: 50% 0 auto; border-top: 1px solid var(--na-border); }.na-filter-divider span { position: relative; padding: 0 8px; background: var(--na-card); }
.na-state { min-height: 150px; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 24px; border: 1px solid var(--na-border); border-radius: 10px; color: var(--na-muted-foreground); background: var(--na-card); }.na-state > div { display: grid; gap: 3px; }.na-state strong { color: var(--na-foreground); font-size: 13px; }.na-state span { font-size: 11px; }.na-state-error { color: #d33; }.na-state-error strong { color: #b42318; }.na-state .na-button { margin-left: 10px; }
.na-stat-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); overflow: hidden; border: 1px solid var(--na-border); border-radius: 9px; background: var(--na-card); }.na-stat-item { min-width: 0; min-height: 112px; padding: 16px 20px; border-right: 1px solid var(--na-border); }.na-stat-item:last-child { border-right: 0; }.na-stat-label { display: flex; align-items: center; gap: 8px; min-width: 0; color: var(--na-muted-foreground); font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; }.na-stat-label > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.na-stat-icon { width: 28px; height: 28px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 7px; }.na-tone-teal { color: #1677b7; background: #e7f4fc; }.na-tone-violet { color: #7954bc; background: #f0ebfa; }.na-tone-green { color: #2c9a68; background: #e9f8f0; }.na-tone-orange { color: #d97819; background: #fff2e5; }.na-stat-value { display: block; max-width: 100%; margin-top: 9px; overflow: hidden; color: var(--na-foreground); font: 700 24px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: -.04em; text-overflow: ellipsis; white-space: nowrap; }.na-stat-item small { display: block; margin-top: 7px; overflow: hidden; color: rgba(96,96,96,.62); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.na-chart-card { overflow: hidden; border: 1px solid var(--na-border); border-radius: 9px; background: var(--na-card); }.na-chart-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 52px; padding: 10px 20px; border-bottom: 1px solid var(--na-border); }.na-chart-title { display: flex; align-items: center; gap: 8px; min-width: 0; }.na-chart-title strong { color: var(--na-foreground); font-size: 13px; font-weight: 650; white-space: nowrap; }.na-chart-title > span:last-child { color: var(--na-muted-foreground); font-size: 11px; white-space: nowrap; }.na-chart-icon { width: 25px; height: 25px; display: grid; place-items: center; border-radius: 6px; }.na-chart-icon-success { color: #269a65; background: #e9f8f0; }.na-chart-icon-info { color: #7b5abd; background: #f0ebfa; }.na-chart-switch, .na-chart-tabs { display: inline-flex; align-items: center; gap: 2px; padding: 3px; border: 1px solid var(--na-border); border-radius: 7px; background: rgba(245,245,245,.75); }.na-chart-switch button, .na-chart-tabs button { display: inline-flex; align-items: center; gap: 5px; min-height: 26px; padding: 0 10px; border: 0; border-radius: 5px; color: var(--na-muted-foreground); background: transparent; font-size: 11px; white-space: nowrap; }.na-chart-switch button.active, .na-chart-tabs button.active { color: var(--na-foreground); background: var(--na-background); box-shadow: 0 1px 3px rgba(0,0,0,.10); }.na-chart-switch button:hover, .na-chart-tabs button:hover { color: var(--na-foreground); }
.na-chart-body { position: relative; min-height: 300px; padding: 8px 10px 4px; }.na-chart-body > svg { display: block; width: 100%; height: 300px; overflow: visible; }.na-grid-lines line { stroke: #ececec; stroke-width: 1; }.na-grid-lines text { fill: #a0a0a0; font: 9px ui-monospace, SFMono-Regular, Menlo, monospace; text-anchor: end; }.na-axis-labels text { fill: #858585; font-size: 9px; text-anchor: middle; }.na-bars rect { opacity: .92; transition: opacity .15s; }.na-bars rect:hover { opacity: .68; }.na-area-lines path { transition: opacity .15s; }.na-legend { display: flex; flex-wrap: wrap; gap: 7px 15px; padding: 5px 10px 12px 44px; color: var(--na-muted-foreground); font-size: 10px; }.na-legend span { display: inline-flex; align-items: center; gap: 6px; }.na-legend i, .na-donut-legend i { width: 8px; height: 8px; flex: 0 0 auto; display: inline-block; border-radius: 50%; }.na-chart-empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--na-muted-foreground); font-size: 12px; }.na-model-chart { min-height: 330px; }
.na-distribution-body { position: relative; display: grid; grid-template-columns: minmax(230px, 1fr) minmax(230px, 1fr); align-items: center; gap: 24px; min-height: 300px; padding: 24px 48px; }.na-donut { width: 210px; height: 210px; display: grid; place-items: center; margin: auto; border-radius: 50%; }.na-donut::before { content: ''; position: absolute; width: 124px; height: 124px; border-radius: 50%; background: var(--na-card); }.na-donut > div { position: relative; z-index: 1; display: grid; place-items: center; }.na-donut strong { font: 700 23px ui-monospace, SFMono-Regular, Menlo, monospace; }.na-donut small { color: var(--na-muted-foreground); font-size: 10px; }.na-donut-legend { display: grid; gap: 11px; max-height: 230px; overflow: auto; }.na-donut-legend > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--na-muted-foreground); font-size: 11px; }.na-donut-legend span { display: inline-flex; align-items: center; gap: 7px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.na-donut-legend strong { color: var(--na-foreground); font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
.na-ranking-body { min-height: 300px; padding: 26px 34px 16px; }.na-ranking-chart { height: 255px; display: flex; align-items: flex-end; gap: 12px; padding: 0 12px 28px 38px; border-bottom: 1px solid #ededed; }.na-ranking-column { position: relative; flex: 1 1 0; min-width: 26px; height: 100%; display: flex; align-items: center; flex-direction: column; justify-content: flex-end; gap: 5px; }.na-ranking-column > strong { color: var(--na-muted-foreground); font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; }.na-ranking-column > span { width: min(38px, 78%); min-height: 2px; border-radius: 4px 4px 0 0; opacity: .9; }.na-ranking-column > small { width: 100%; overflow: hidden; color: var(--na-muted-foreground); font-size: 9px; text-align: center; text-overflow: ellipsis; white-space: nowrap; }.na-footer { padding: 3px 0 1px; color: #999; font-size: 10px; text-align: center; }
.na-model-display-note { padding: 9px 12px; border: 1px solid #dce6f4; border-radius: 8px; color: #52708f; background: #f7faff; font-size: 11px; line-height: 1.5; }.na-actual-model-card { min-height: 0; }.na-actual-model-scroll { max-height: 330px; overflow: auto; }.na-actual-model-table { width: 100%; min-width: 620px; border-collapse: collapse; color: var(--na-foreground); font-size: 11px; }.na-actual-model-table th, .na-actual-model-table td { height: 42px; padding: 0 20px; border-bottom: 1px solid var(--na-border); text-align: right; font-variant-numeric: tabular-nums; }.na-actual-model-table th { position: sticky; top: 0; z-index: 1; height: 38px; color: var(--na-muted-foreground); background: var(--na-card); font-size: 10px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; }.na-actual-model-table th:first-child, .na-actual-model-table td:first-child { width: 58%; text-align: left; }.na-actual-model-table tbody tr:last-child td { border-bottom: 0; }.na-actual-model-table tbody tr:hover { background: rgba(91, 143, 249, .055); }.na-actual-model-table code { display: inline-block; max-width: 100%; color: #315c94; font: 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: nowrap; }.na-actual-model-empty { display: grid; min-height: 130px; place-items: center; color: var(--na-muted-foreground); font-size: 12px; }
.na-stat-item:nth-child(even) { border-right: 0; }.na-stat-item:nth-child(n + 3) { border-top: 1px solid var(--na-border); }
@media (min-width: 700px) { .na-stat-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }.na-stat-item:nth-child(even) { border-right: 1px solid var(--na-border); }.na-stat-item:nth-child(3n) { border-right: 0; }.na-stat-item:nth-child(n + 4) { border-top: 1px solid var(--na-border); }.na-stat-item:nth-child(4) { border-right: 1px solid var(--na-border); } }
@media (min-width: 1024px) { .na-stat-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }.na-stat-item:nth-child(n) { border-top: 0; }.na-stat-item:nth-child(3n), .na-stat-item:nth-child(4) { border-right: 1px solid var(--na-border); }.na-stat-item:last-child { border-right: 0; } }
@media (max-width: 980px) { .na-chart-header, .na-page-header { align-items: flex-start; flex-direction: column; }.na-page-actions, .na-chart-switch, .na-chart-tabs { width: 100%; overflow-x: auto; }.na-page-actions { justify-content: flex-end; }.na-chart-switch button, .na-chart-tabs button { flex: 0 0 auto; }.na-distribution-body { padding-inline: 20px; } }
@media (max-width: 640px) { .usage-analytics-page { gap: 10px; }.na-page-header h1 { font-size: 18px; }.na-stat-item { padding: 12px; }.na-stat-value { font-size: 20px; }.na-chart-header { padding-inline: 12px; }.na-chart-body { padding-inline: 4px; }.na-distribution-body { grid-template-columns: 1fr; gap: 18px; padding: 20px; }.na-donut { width: 170px; height: 170px; }.na-donut::before { width: 102px; height: 102px; }.na-ranking-body { padding-inline: 12px; }.na-ranking-chart { gap: 6px; padding-left: 22px; }.na-popover { position: fixed; top: 70px; right: 12px; left: 12px; width: auto; max-height: calc(100vh - 90px); overflow-y: auto; } }
</style>
