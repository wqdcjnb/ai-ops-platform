import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  IconActivityHeartbeat, IconAlertTriangle, IconChartAreaLine, IconChartBar,
  IconChartPie, IconFileAnalytics, IconFilter, IconRefresh, IconSettings2,
  IconUsers, IconX,
} from '@tabler/icons-vue'
import { fetchModelAnalytics, type ModelAnalyticsQuery, type ModelAnalyticsResponse } from '../usage-api'

export function useUsageView() {
/**
 * All state and behaviour for the UsageView view.
 * Extracted verbatim from the component so the template keeps rendering identically.
 */

const analytics = ref<ModelAnalyticsResponse | null>(null)
const analyticsError = ref('')
const analyticsLoading = ref(false)
const analyticsDays = ref<ModelAnalyticsQuery['days']>(1)
const analyticsGranularity = ref<ModelAnalyticsQuery['timeGranularity']>('hour')
const analyticsPerson = ref('all')
const analyticsTab = ref<'trend' | 'distribution' | 'ranking'>('trend')
const analyticsFilterOpen = ref(false)
const analyticsPreferencesOpen = ref(false)
const personMetric = ref<'tokens' | 'count'>('tokens')
const personPage = ref(1)
const PERSON_PAGE_SIZE = 10
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
const rankedPeople = computed(() => [...(analytics.value?.people ?? [])].sort((left, right) =>
  right[personMetric.value] - left[personMetric.value]
  || right.tokens - left.tokens
  || right.count - left.count
  || left.personName.localeCompare(right.personName, 'zh-CN')
  || left.personId.localeCompare(right.personId)))
const personPageCount = computed(() => Math.max(1, Math.ceil(rankedPeople.value.length / PERSON_PAGE_SIZE)))
const visiblePeople = computed(() => rankedPeople.value.slice((personPage.value - 1) * PERSON_PAGE_SIZE, personPage.value * PERSON_PAGE_SIZE))
const maxPersonUsage = computed(() => Math.max(1, rankedPeople.value[0]?.[personMetric.value] ?? 0))
const personMetricLabel = computed(() => personMetric.value === 'tokens' ? 'Token 用量' : '调用次数')
const personMetricTotal = computed(() => rankedPeople.value.reduce((sum, person) => sum + person[personMetric.value], 0))
watch([analytics, personMetric], () => { personPage.value = 1 })
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

const analyticsMaxChartCount = computed(() => Math.max(4, Math.ceil(Math.max(0, ...analyticsChartBuckets.value.map((item) => item.count)) / 4) * 4))
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

function analyticsChartX(index: number) {
  const left = 44; const right = 14; const width = 760
  return left + index * ((width - left - right) / Math.max(1, analyticsChartBuckets.value.length - 1))
}

function personUsageShare(value: number) {
  return personMetricTotal.value ? `${(value / personMetricTotal.value * 100).toFixed(1)}%` : '0%'
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

  return { analytics, analyticsError, analyticsLoading, analyticsDays, analyticsGranularity, analyticsPerson, analyticsTab, analyticsFilterOpen, analyticsPreferencesOpen, personMetric, personPage, PERSON_PAGE_SIZE, analyticsRequest, MAX_MODELS_IN_CHART, chartPalette, analyticsModels, analyticsPeople, rankedPeople, personPageCount, visiblePeople, maxPersonUsage, personMetricLabel, personMetricTotal, chartModels, directChartModelNames, chartOverflowModel, analyticsMaxModelCount, analyticsTotalModelCount, selectedPersonLabel, analyticsBucketStart, analyticsBucketStep, analyticsChartBuckets, analyticsMaxChartCount, analyticsPieStyle, analyticsCards, compactNumber, analyticsColor, analyticsChartMetric, analyticsChartPointCount, analyticsTrendPath, analyticsTrendAreaPath, analyticsChartX, personUsageShare, analyticsRankBarHeight, compactModelName, chartModelLabel, chartModelTitle, modelShare, analyticsAxisLabel, analyticsFilterLabel, analyticsQuery, loadModelAnalytics, applyAnalyticsFilters, resetAnalyticsFilters }
}
