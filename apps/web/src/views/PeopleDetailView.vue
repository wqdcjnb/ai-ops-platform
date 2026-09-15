<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import * as echarts from 'echarts/core'
import type { ECharts, EChartsCoreOption } from 'echarts/core'
import {
  IconActivityHeartbeat,
  IconAlertTriangle,
  IconArrowLeft,
  IconBan,
  IconBuilding,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconCoins,
  IconKey,
  IconRefresh,
  IconRoute,
  IconShieldLock,
  IconSparkles,
  IconUser,
} from '@tabler/icons-vue'
import { fetchPersonDetail, fetchPersonUsage, PeopleApiError, type PersonDetailResponse, type PersonUsagePeriod, type PersonUsageResponse } from '../people-api'

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, CanvasRenderer])

const route = useRoute()
const personId = computed(() => String(route.params.id ?? ''))
const detail = ref<PersonDetailResponse | null>(null)
const usage = ref<PersonUsageResponse | null>(null)
const period = ref<PersonUsagePeriod>('7d')
const isLoading = ref(false)
const isUsageLoading = ref(false)
const errorMessage = ref('')
const chartElement = ref<HTMLElement | null>(null)
let activeRequest: AbortController | null = null
let usageRequest: AbortController | null = null
let chart: ECharts | null = null
let resizeObserver: ResizeObserver | null = null

const statusLabels = { active: '在职', disabled: '已停用', offboarding: '离职待回收' } as const
const updatedAt = computed(() => detail.value ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(detail.value.meta.generatedAt)) : '等待数据')
const remainingPoints = computed(() => detail.value ? Math.max(0, detail.value.metrics.monthPointLimit - detail.value.metrics.monthPoints) : 0)
const allowedModels = computed(() => detail.value?.models.filter((model) => model.allowed) ?? [])

function compact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
  return value.toLocaleString('zh-CN')
}

function dateText(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', year: 'numeric' }).format(new Date(value))
}

function relativeTime(value: string | null) {
  if (!value) return '从未调用'
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000))
  if (minutes < 60) return `${Math.max(1, minutes)} 分钟前`
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小时前`
  return `${Math.round(minutes / 1440)} 天前`
}

const metrics = computed(() => {
  if (!detail.value) return []
  return [
    { label: '今日请求', value: detail.value.metrics.todayRequests.toLocaleString('zh-CN'), hint: '当前人员全部 Key', icon: IconActivityHeartbeat, tone: 'teal' },
    { label: '本月 Token', value: compact(detail.value.metrics.monthTokens), hint: '输入与输出合计', icon: IconSparkles, tone: 'blue' },
    { label: '本月成本点数', value: detail.value.metrics.monthPoints.toLocaleString('zh-CN'), hint: `剩余 ${remainingPoints.value} 点`, icon: IconCoins, tone: 'amber' },
    { label: '调用质量', value: `${detail.value.metrics.successRate}%`, hint: `P95 ${(detail.value.metrics.p95LatencyMs / 1000).toFixed(1)}s`, icon: IconClock, tone: 'green' },
  ]
})

function chartOptions(): EChartsCoreOption {
  const items = usage.value?.items ?? []
  return {
    animationDuration: 450,
    grid: { left: 42, right: 12, top: 24, bottom: 28 },
    tooltip: { trigger: 'axis', backgroundColor: '#182433', borderWidth: 0, textStyle: { color: '#fff', fontSize: 11 } },
    xAxis: { type: 'category', boundaryGap: false, data: items.map((item) => item.date), axisLine: { lineStyle: { color: '#dce3ea' } }, axisTick: { show: false }, axisLabel: { color: '#7a8795', fontSize: 10, interval: period.value === '30d' ? 4 : 0 } },
    yAxis: [
      { type: 'value', splitNumber: 4, axisLabel: { color: '#7a8795', fontSize: 9 }, splitLine: { lineStyle: { color: '#edf1f5', type: 'dashed' } } },
      { type: 'value', show: false },
    ],
    series: [
      { name: '请求数', type: 'line', smooth: .35, showSymbol: period.value === '7d', symbolSize: 6, data: items.map((item) => item.requests), lineStyle: { color: '#146c70', width: 2.5 }, itemStyle: { color: '#146c70' }, areaStyle: { color: 'rgba(20,108,112,.09)' } },
      { name: '成本点数', type: 'bar', yAxisIndex: 1, barMaxWidth: 10, data: items.map((item) => item.points), itemStyle: { color: 'rgba(245,159,0,.25)', borderRadius: [3, 3, 0, 0] } },
    ],
  }
}

function renderChart() {
  if (!chartElement.value || !usage.value) return
  chart ??= echarts.init(chartElement.value)
  chart.setOption(chartOptions(), true)
  if (!resizeObserver) {
    resizeObserver = new ResizeObserver(() => chart?.resize())
    resizeObserver.observe(chartElement.value)
  }
}

async function loadPerson() {
  activeRequest?.abort()
  const request = new AbortController()
  activeRequest = request
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [personResult, usageResult] = await Promise.all([
      fetchPersonDetail(personId.value, request.signal),
      fetchPersonUsage(personId.value, period.value, request.signal),
    ])
    detail.value = personResult
    usage.value = usageResult
    await nextTick()
    renderChart()
  } catch (error) {
    if (request.signal.aborted) return
    const requestId = error instanceof PeopleApiError ? error.requestId : undefined
    errorMessage.value = `${error instanceof Error ? error.message : '人员详情暂时无法加载'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally {
    if (activeRequest === request) isLoading.value = false
  }
}

async function changePeriod(nextPeriod: PersonUsagePeriod) {
  if (period.value === nextPeriod || isUsageLoading.value) return
  period.value = nextPeriod
  usageRequest?.abort()
  const request = new AbortController()
  usageRequest = request
  isUsageLoading.value = true
  try {
    usage.value = await fetchPersonUsage(personId.value, nextPeriod, request.signal)
    await nextTick()
    renderChart()
  } catch (error) {
    if (!request.signal.aborted) errorMessage.value = error instanceof Error ? error.message : '趋势数据暂时无法加载'
  } finally {
    if (usageRequest === request) isUsageLoading.value = false
  }
}

onMounted(() => void loadPerson())
onBeforeUnmount(() => {
  activeRequest?.abort()
  usageRequest?.abort()
  resizeObserver?.disconnect()
  chart?.dispose()
})
</script>

<template>
  <div class="dashboard person-detail-dashboard">
    <RouterLink to="/people" class="back-link"><IconArrowLeft :size="16" />返回人员列表</RouterLink>

    <section v-if="!detail" class="panel data-state" :class="{ failed: errorMessage }">
      <div class="state-icon"><IconAlertTriangle v-if="errorMessage" :size="22" /><IconRefresh v-else :size="22" class="spinning" /></div>
      <div><strong>{{ errorMessage ? '无法打开人员详情' : '正在读取人员详情' }}</strong><p>{{ errorMessage || '正在从 BFF 获取经过校验的个人数据…' }}</p></div>
      <button v-if="errorMessage" class="btn btn-white" @click="loadPerson">重新加载</button>
    </section>

    <template v-else>
      <section class="person-hero panel">
        <div class="person-hero-avatar" :class="`avatar-${detail.profile.tone}`">{{ detail.profile.initials }}</div>
        <div class="person-hero-copy">
          <div class="person-hero-name"><h1>{{ detail.profile.name }}</h1><span class="person-status" :class="`status-${detail.profile.status}`"><i />{{ statusLabels[detail.profile.status] }}</span></div>
          <p>{{ detail.profile.department.name }} · {{ detail.profile.title }} · 负责人 {{ detail.profile.manager }}</p>
          <div><span><IconRoute :size="14" />{{ detail.profile.purpose }}</span><span><IconKey :size="14" />{{ detail.profile.keyCount }} 个访问 Key</span><span><IconClock :size="14" />{{ relativeTime(detail.profile.lastActiveAt) }}</span></div>
        </div>
        <div class="person-hero-actions"><span>更新于 {{ updatedAt }}</span><button class="btn btn-white" :disabled="isLoading" @click="loadPerson"><IconRefresh :size="16" :class="{ spinning: isLoading }" />刷新</button><button class="btn danger-outline" disabled title="写接口和审计完成后开放"><IconBan :size="16" />停用人员</button></div>
      </section>

      <div class="source-banner detail-source"><span>DEMO</span>{{ detail.meta.notice }}</div>

      <section class="person-metric-grid" aria-label="个人核心指标">
        <article v-for="metric in metrics" :key="metric.label" class="metric-card">
          <div class="metric-top"><span class="metric-label">{{ metric.label }}</span><span class="metric-icon" :class="`tone-${metric.tone}`"><component :is="metric.icon" :size="19" /></span></div>
          <strong class="metric-value">{{ metric.value }}</strong><div class="metric-foot">{{ metric.hint }}</div>
        </article>
      </section>

      <section class="person-detail-grid">
        <article class="panel person-trend-panel">
          <div class="panel-header"><div><h2>个人用量趋势</h2><p>请求数与内部成本点数；数据时区 Asia/Shanghai</p></div><div class="period-switch"><button :class="{ active: period === '7d' }" :disabled="isUsageLoading" @click="changePeriod('7d')">7 天</button><button :class="{ active: period === '30d' }" :disabled="isUsageLoading" @click="changePeriod('30d')">30 天</button></div></div>
          <div class="chart-legend"><span class="line-key" />请求数 <span class="bar-key" />成本点数</div>
          <div ref="chartElement" class="person-trend-chart" role="img" :aria-label="`${detail.profile.name}用量趋势图`" />
        </article>

        <article class="panel profile-panel">
          <div class="panel-header"><div><h2>基础档案</h2><p>组织归属与软目标状态</p></div><IconUser :size="18" /></div>
          <dl class="profile-facts">
            <div><dt>人员 ID</dt><dd>{{ detail.profile.id }}</dd></div><div><dt>所属部门</dt><dd><IconBuilding :size="13" />{{ detail.profile.department.name }}</dd></div>
            <div><dt>岗位</dt><dd>{{ detail.profile.title }}</dd></div><div><dt>负责人</dt><dd>{{ detail.profile.manager }}</dd></div>
            <div><dt>主要用途</dt><dd>{{ detail.profile.purpose }}</dd></div><div><dt>允许模型</dt><dd>{{ allowedModels.length }} 个业务别名</dd></div>
          </dl>
          <div class="detail-goal"><div><span>月度软目标</span><strong>{{ detail.profile.goal.percent }}%</strong></div><div><i :class="`goal-${detail.profile.goal.state}`" :style="{ width: `${Math.min(detail.profile.goal.percent, 100)}%` }" /></div><small>已用 {{ detail.profile.goal.used }} 点 · 目标 {{ detail.profile.goal.limit }} 点 · 达到 100% 当前仅提醒</small></div>
        </article>
      </section>

      <section class="panel person-keys-panel">
        <div class="panel-header"><div><h2>访问 Key</h2><p>固定返回掩码；完整 Key 不进入浏览器、日志或导出</p></div><RouterLink class="key-summary" :to="`/keys?owner=${detail.profile.id}`">查看 {{ detail.keys.length }} 个</RouterLink></div>
        <div v-if="detail.keys.length" class="table-responsive"><table class="data-table detail-key-table"><thead><tr><th>Key 掩码</th><th>用途</th><th>允许模型</th><th>状态</th><th>到期时间</th><th>最后使用</th></tr></thead><tbody><tr v-for="key in detail.keys" :key="key.id"><td><code>{{ key.masked }}</code></td><td>{{ key.purpose }}</td><td><div class="model-tags"><span v-for="model in key.models" :key="model">{{ model }}</span></div></td><td><span class="person-status" :class="`status-${key.status}`"><i />{{ key.status === 'active' ? '启用' : '停用' }}</span></td><td>{{ dateText(key.expiresAt) }}</td><td>{{ relativeTime(key.lastUsedAt) }}</td></tr></tbody></table></div>
        <div v-else class="panel-empty">该人员当前没有访问 Key</div>
      </section>

      <section class="person-bottom-grid">
        <article class="panel allowed-models-panel"><div class="panel-header"><div><h2>允许模型</h2><p>客户端使用业务别名，不接触实际渠道</p></div><IconSparkles :size="18" /></div><div class="allowed-model-list"><div v-for="model in detail.models" :key="model.alias" :class="{ blocked: !model.allowed }"><span><IconCheck v-if="model.allowed" :size="15" /><IconShieldLock v-else :size="15" /></span><div><strong>{{ model.alias }}<em :class="{ experiment: model.type === 'experiment' }">{{ model.type === 'experiment' ? '实验' : '正式' }}</em></strong><small>{{ model.name }} · {{ model.purpose }}</small></div><b>{{ model.allowed ? '允许' : '未授权' }}</b></div></div></article>
        <article class="panel management-boundary"><div class="panel-header"><div><h2>管理操作</h2><p>当前阶段保持只读</p></div><IconShieldLock :size="18" /></div><div class="boundary-copy"><strong>写操作尚未开放</strong><p>停用人员、调整软目标和回收 Key 必须具备服务端授权、二次确认、幂等处理及操作审计。</p><button class="btn btn-white" disabled>调整软目标</button><button class="btn danger-outline" disabled>停用并回收 Key</button></div></article>
      </section>

      <footer class="page-footer">数据来源：DEMO · 人员详情与趋势均为演示契约 · 完整 Key 从不返回浏览器</footer>
    </template>
  </div>
</template>
