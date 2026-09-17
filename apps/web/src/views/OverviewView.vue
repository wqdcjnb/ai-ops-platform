<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import * as echarts from 'echarts/core'
import type { ECharts, EChartsCoreOption } from 'echarts/core'
import {
  IconActivityHeartbeat,
  IconAlertTriangle,
  IconChevronRight,
  IconCircleCheckFilled,
  IconClock,
  IconCoins,
  IconCommand,
  IconFingerprint,
  IconKey,
  IconRefresh,
} from '@tabler/icons-vue'
import { fetchOverview, OverviewApiError, type OverviewResponse, type Period } from '../overview-api'

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, CanvasRenderer])

const period = ref<Period>('7d')
const isLoading = ref(false)
const overview = ref<OverviewResponse | null>(null)
const errorMessage = ref('')
const chartElement = ref<HTMLElement | null>(null)
let chart: ECharts | null = null
let resizeObserver: ResizeObserver | null = null
let activeRequest: AbortController | null = null

function signed(value: number, suffix = '') {
  return `${value > 0 ? '+' : ''}${value}${suffix}`
}

function compact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
  return value.toLocaleString('zh-CN')
}

function seconds(milliseconds: number) {
  return `${(milliseconds / 1000).toFixed(1)}s`
}

function relativeTime(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  return `${Math.round(minutes / 60)} 小时前`
}

const selectedTrend = computed(() => overview.value?.trend ?? [])
const alerts = computed(() => overview.value?.alerts ?? [])
const people = computed(() => overview.value?.people ?? [])
const channels = computed(() => overview.value?.channels ?? [])
const sourceLabel = computed(() => overview.value?.meta.source === 'database' ? 'SQLite · 模拟数据' : '等待数据')
const lastUpdated = computed(() => {
  if (!overview.value) return '等待数据'
  const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(overview.value.meta.generatedAt))
  return `今天 ${time}`
})
const monthUsagePercent = computed(() => {
  const metrics = overview.value?.metrics
  return metrics ? Math.round(metrics.monthPoints / metrics.monthPointLimit * 100) : 0
})
const kpis = computed(() => {
  const metrics = overview.value?.metrics
  if (!metrics) return []
  return [
    { label: '今日请求', value: metrics.todayRequests.toLocaleString('zh-CN'), delta: signed(metrics.todayRequestDeltaPercent, '%'), hint: '较昨日同期', icon: IconActivityHeartbeat, tone: 'teal' },
    { label: '今日 Token', value: compact(metrics.inputTokens + metrics.outputTokens), delta: signed(metrics.tokenDeltaPercent, '%'), hint: `输入 ${compact(metrics.inputTokens)} · 输出 ${compact(metrics.outputTokens)}`, icon: IconCommand, tone: 'blue' },
    { label: '本月成本点数', value: metrics.monthPoints.toLocaleString('zh-CN'), delta: `${monthUsagePercent.value}%`, hint: `目标 ${metrics.monthPointLimit.toLocaleString('zh-CN')} 点`, icon: IconCoins, tone: 'amber' },
    { label: '调用成功率', value: `${metrics.successRate}%`, delta: signed(metrics.successDeltaPercent, '%'), hint: '过去 24 小时', icon: IconCircleCheckFilled, tone: 'green' },
    { label: 'P95 延迟', value: seconds(metrics.p95LatencyMs), delta: signed(metrics.p95LatencyDeltaMs / 1000, 's'), hint: `首 Token ${seconds(metrics.firstTokenLatencyMs)}`, icon: IconClock, tone: 'violet' },
  ]
})

function chartOptions(): EChartsCoreOption {
  const points = selectedTrend.value
  return {
    animationDuration: 500,
    grid: { left: 44, right: 10, top: 20, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#182433',
      borderWidth: 0,
      padding: [10, 12],
      textStyle: { color: '#fff', fontSize: 12 },
      formatter(params: unknown) {
        const rows = params as Array<{ axisValue: string; marker: string; seriesName: string; value: number }>
        return [`<strong>${rows[0]?.axisValue ?? ''}</strong>`, ...rows.map((row) => `${row.marker} ${row.seriesName}　${Number(row.value).toLocaleString()}`)].join('<br/>')
      },
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: points.map((point) => point.date),
      axisLine: { lineStyle: { color: '#dce3ea' } },
      axisTick: { show: false },
      axisLabel: { color: '#7a8795', fontSize: 11, interval: period.value === '30d' ? 4 : 0 },
    },
    yAxis: [
      { type: 'value', splitNumber: 4, axisLabel: { color: '#7a8795', fontSize: 11 }, splitLine: { lineStyle: { color: '#edf1f5', type: 'dashed' } } },
      { type: 'value', show: false },
    ],
    series: [
      { name: '请求数', type: 'line', smooth: 0.35, symbol: 'circle', symbolSize: 6, showSymbol: period.value === '7d', data: points.map((point) => point.requests), lineStyle: { color: '#146c70', width: 3 }, itemStyle: { color: '#146c70', borderColor: '#fff', borderWidth: 2 }, areaStyle: { color: 'rgba(20,108,112,.10)' } },
      { name: '成本点数', type: 'bar', yAxisIndex: 1, barMaxWidth: 12, data: points.map((point) => point.points), itemStyle: { color: 'rgba(245,159,0,.24)', borderRadius: [3, 3, 0, 0] } },
    ],
  }
}

function renderChart() {
  if (!chartElement.value || !overview.value) return
  chart ??= echarts.init(chartElement.value)
  chart.setOption(chartOptions(), true)
  if (!resizeObserver) {
    resizeObserver = new ResizeObserver(() => chart?.resize())
    resizeObserver.observe(chartElement.value)
  }
}

async function loadOverview() {
  activeRequest?.abort()
  const request = new AbortController()
  activeRequest = request
  isLoading.value = true
  errorMessage.value = ''
  try {
    overview.value = await fetchOverview(period.value, request.signal)
    await nextTick()
    renderChart()
  } catch (error) {
    if (request.signal.aborted) return
    const requestId = error instanceof OverviewApiError ? error.requestId : undefined
    errorMessage.value = `${error instanceof Error ? error.message : '运营数据暂时无法加载'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally {
    if (activeRequest === request) isLoading.value = false
  }
}

watch(period, () => void loadOverview())
onMounted(() => void loadOverview())
onBeforeUnmount(() => {
  activeRequest?.abort()
  resizeObserver?.disconnect()
  chart?.dispose()
})
</script>

<template>
  <div class="dashboard">
    <section class="page-heading">
      <div>
        <div class="eyebrow">OPERATIONS OVERVIEW</div>
        <h1>运营总览</h1>
        <p>先判断系统是否正常，再处理额度、渠道和异常事件。</p>
      </div>
      <div class="heading-actions">
        <span class="updated-at">数据更新于 {{ lastUpdated }}</span>
        <button class="btn btn-white refresh-button" :disabled="isLoading" @click="loadOverview">
          <IconRefresh :size="17" :class="{ spinning: isLoading }" /> {{ isLoading ? '更新中' : '刷新数据' }}
        </button>
        <button class="btn create-key" disabled title="Key 写接口和审计完成后开放"><IconKey :size="17" /> 创建 Key</button>
      </div>
    </section>

    <section v-if="!overview" class="panel data-state" :class="{ failed: errorMessage }">
      <div class="state-icon"><IconAlertTriangle v-if="errorMessage" :size="22" /><IconRefresh v-else :size="22" class="spinning" /></div>
      <div><strong>{{ errorMessage ? '无法连接运营数据服务' : '正在连接运营数据服务' }}</strong><p>{{ errorMessage || '正在从 BFF 获取经过校验的总览数据…' }}</p></div>
      <button v-if="errorMessage" class="btn btn-white" @click="loadOverview">重新加载</button>
    </section>

    <template v-else>
      <div class="source-banner"><span>{{ sourceLabel }}</span>{{ overview.meta.notice }}</div>

      <section class="metric-grid" aria-label="核心指标">
        <article v-for="kpi in kpis" :key="kpi.label" class="metric-card">
          <div class="metric-top"><span class="metric-label">{{ kpi.label }}</span><span class="metric-icon" :class="`tone-${kpi.tone}`"><component :is="kpi.icon" :size="20" /></span></div>
          <strong class="metric-value">{{ kpi.value }}</strong>
          <div class="metric-foot"><span :class="{ positive: kpi.delta.startsWith('+') || kpi.delta.startsWith('-') }">{{ kpi.delta }}</span> {{ kpi.hint }}</div>
          <div v-if="kpi.label === '本月成本点数'" class="metric-progress"><i :style="{ width: `${monthUsagePercent}%` }" /></div>
        </article>
      </section>

      <section class="content-grid overview-grid">
        <article class="panel trend-panel">
          <div class="panel-header">
            <div><h2>用量趋势</h2><p>请求数与内部成本点数，不等同于供应商实际账单</p></div>
            <div class="period-switch" role="group" aria-label="趋势时间范围">
              <button :class="{ active: period === '7d' }" :disabled="isLoading" @click="period = '7d'">7 天</button>
              <button :class="{ active: period === '30d' }" :disabled="isLoading" @click="period = '30d'">30 天</button>
            </div>
          </div>
          <div class="chart-legend"><span class="line-key" />请求数 <span class="bar-key" />成本点数</div>
          <div ref="chartElement" class="trend-chart" role="img" aria-label="请求数与成本点数趋势图" />
        </article>

        <article class="panel attention-panel">
          <div class="panel-header"><div><h2>需要关注</h2><p>{{ alerts.length }} 个事件等待处理</p></div><button class="text-button" disabled>查看全部</button></div>
          <div class="alert-list">
            <div v-for="alert in alerts" :key="alert.id" class="alert-item">
              <div class="alert-icon" :class="`alert-${alert.level}`"><IconAlertTriangle :size="18" /></div>
              <div class="alert-copy"><strong>{{ alert.title }}</strong><span>{{ alert.detail }}</span><small>{{ relativeTime(alert.occurredAt) }}</small></div>
              <button :aria-label="`${alert.action}（尚未开放）`" disabled><IconChevronRight :size="18" /></button>
            </div>
          </div>
          <div class="soft-limit-note"><IconFingerprint :size="18" /><span><strong>试点阶段为软额度</strong>达到 100% 仅产生提醒，当前不会阻断请求。</span></div>
        </article>
      </section>

      <section class="content-grid detail-grid">
        <article class="panel people-panel">
          <div class="panel-header"><div><h2>人员消耗排行</h2><p>按本月成本点数排序；未配置个人目标时不估算比例</p></div><button class="text-button" disabled>人员与部门 <IconChevronRight :size="16" /></button></div>
          <div class="table-responsive">
            <table class="data-table">
              <thead><tr><th>人员</th><th>主要用途</th><th class="number-cell">请求数</th><th>个人目标</th><th class="number-cell">成本点数</th></tr></thead>
              <tbody>
                <tr v-for="person in people" :key="person.id">
                  <td><div class="person-cell"><span class="person-avatar" :class="`avatar-${person.tone}`">{{ person.initials }}</span><span><strong>{{ person.name }}</strong><small>{{ person.department }}</small></span></div></td>
                  <td><span class="purpose-tag">{{ person.purpose }}</span></td>
                  <td class="number-cell">{{ person.requests.toLocaleString() }}</td>
                  <td><div v-if="person.targetConfigured" class="usage-cell"><div><i :class="{ warning: person.usagePercent >= 80 }" :style="{ width: `${Math.min(person.usagePercent, 100)}%` }" /></div><span :class="{ warning: person.usagePercent >= 80 }">{{ person.usagePercent }}%</span></div><span v-else class="muted-cell">未配置</span></td>
                  <td class="number-cell"><strong>{{ person.points.toLocaleString() }}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <article class="panel channel-panel">
          <div class="panel-header"><div><h2>渠道摘要</h2><p>基于模拟调用元数据聚合，不等同于实时健康检查</p></div><button class="text-button" disabled>模型与渠道 <IconChevronRight :size="16" /></button></div>
          <div class="channel-list">
            <div v-for="channel in channels" :key="channel.id" class="channel-row">
              <div class="channel-status" :class="{ unhealthy: channel.status !== 'healthy' }"><span /></div>
              <div class="channel-identity"><strong>{{ channel.name }} <em :class="{ experiment: channel.type === 'experiment' }">{{ channel.type === 'experiment' ? '实验' : '正式' }}</em></strong><span>{{ channel.model }}</span></div>
              <div class="channel-stat"><small>成功率</small><strong>{{ channel.successRate }}%</strong></div>
              <div class="channel-stat"><small>P95</small><strong>{{ channel.latencyMs === null ? '—' : seconds(channel.latencyMs) }}</strong></div>
              <div class="channel-stat"><small>请求</small><strong>{{ channel.requests.toLocaleString('zh-CN') }}</strong></div>
            </div>
          </div>
        </article>
      </section>

      <footer class="page-footer">数据来源：{{ sourceLabel }} · 时区：{{ overview.meta.timezone }} · 实时网关健康、真实账单与行级数据范围仍待单独验收</footer>
    </template>
  </div>
</template>
