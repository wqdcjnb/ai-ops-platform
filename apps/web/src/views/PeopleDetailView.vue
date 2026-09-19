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
  IconKey,
  IconRefresh,
  IconShieldLock,
  IconSparkles,
  IconTrash,
  IconUser,
} from '@tabler/icons-vue'
import { deletePerson, disablePerson, fetchPersonDetail, fetchPersonUsage, PeopleApiError, type PersonDeleteBody, type PersonDeleteResponse, type PersonDetailResponse, type PersonDisableBody, type PersonDisableResponse, type PersonGoalUpdateBody, type PersonGoalUpdateResponse, type PersonUsagePeriod, type PersonUsageResponse, updatePersonMonthlyGoal } from '../people-api'
import { surnameInitial } from '../modules/people/person-display'

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, CanvasRenderer])

const route = useRoute()
const personId = computed(() => String(route.params.id ?? ''))
const detail = ref<PersonDetailResponse | null>(null)
const usage = ref<PersonUsageResponse | null>(null)
const period = ref<PersonUsagePeriod>('7d')
const isLoading = ref(false)
const isUsageLoading = ref(false)
const errorMessage = ref('')
const showDisable = ref(false)
const disableError = ref('')
const isDisabling = ref(false)
const disableResult = ref<PersonDisableResponse | null>(null)
const disableForm = ref<PersonDisableBody>({ idempotencyKey: '', reason: '', acknowledgeImpact: true })
const showDelete = ref(false)
const deleteError = ref('')
const isDeleting = ref(false)
const deleteResult = ref<PersonDeleteResponse | null>(null)
const deleteForm = ref<PersonDeleteBody>({ idempotencyKey: '', reason: '', acknowledgeImpact: true })
const showGoalAdjust = ref(false)
const goalAdjustError = ref('')
const isGoalAdjusting = ref(false)
const goalAdjustResult = ref<PersonGoalUpdateResponse | null>(null)
const goalAdjustForm = ref<PersonGoalUpdateBody>({ targetPoints: 1, idempotencyKey: '', reason: '', acknowledgeImpact: true })
const chartElement = ref<HTMLElement | null>(null)
let activeRequest: AbortController | null = null
let usageRequest: AbortController | null = null
let chart: ECharts | null = null
let resizeObserver: ResizeObserver | null = null

const statusLabels = { active: '在职', disabled: '已停用', offboarding: '待回收' } as const
const updatedAt = computed(() => detail.value ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(detail.value.meta.generatedAt)) : '等待数据')
const remainingPoints = computed(() => detail.value ? Math.max(0, detail.value.metrics.monthPointLimit - detail.value.metrics.monthPoints) : 0)
const goalProjectedPercent = computed(() => {
  if (!detail.value || !Number.isFinite(goalAdjustForm.value.targetPoints) || goalAdjustForm.value.targetPoints < 1) return 0
  return Number((detail.value.metrics.monthPoints / goalAdjustForm.value.targetPoints * 100).toFixed(1))
})
const goalProjectionState = computed(() => goalProjectedPercent.value >= 100 ? 'reached' : goalProjectedPercent.value >= 80 ? 'near' : 'normal')

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
    { label: '本月 Token', value: compact(detail.value.metrics.monthTokens), hint: `输入 ${compact(detail.value.metrics.monthInputTokens)} · 输出 ${compact(detail.value.metrics.monthOutputTokens)}`, icon: IconSparkles, tone: 'blue' },
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
    yAxis: { type: 'value', splitNumber: 4, axisLabel: { color: '#7a8795', fontSize: 9 }, splitLine: { lineStyle: { color: '#edf1f5', type: 'dashed' } } },
    series: [
      { name: '请求数', type: 'line', smooth: .35, showSymbol: period.value === '7d', symbolSize: 6, data: items.map((item) => item.requests), lineStyle: { color: '#146c70', width: 2.5 }, itemStyle: { color: '#146c70' }, areaStyle: { color: 'rgba(20,108,112,.09)' } },
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

function newDisableIdempotencyKey() { return `person-disable-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}` }
function newDeleteIdempotencyKey() { return `person-delete-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}` }
function newGoalIdempotencyKey() { return `quota-update-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}` }
function openGoalAdjust() {
  if (!detail.value || detail.value.profile.status === 'disabled') return
  goalAdjustError.value = ''; goalAdjustResult.value = null
  goalAdjustForm.value = { targetPoints: detail.value.profile.goal.limit, idempotencyKey: newGoalIdempotencyKey(), reason: '', acknowledgeImpact: true }
  showGoalAdjust.value = true
}
function closeGoalAdjust() { if (!isGoalAdjusting.value) { showGoalAdjust.value = false; goalAdjustError.value = ''; goalAdjustResult.value = null } }
async function submitGoalAdjust() {
  if (!detail.value) return
  isGoalAdjusting.value = true; goalAdjustError.value = ''
  try {
    goalAdjustResult.value = await updatePersonMonthlyGoal(detail.value.profile.id, goalAdjustForm.value)
    await loadPerson()
  } catch (error) {
    const requestId = error instanceof PeopleApiError ? error.requestId : undefined
    goalAdjustError.value = `${error instanceof Error ? error.message : '调整人员月度软目标失败'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally { isGoalAdjusting.value = false }
}
function openDisable() {
  if (!detail.value || detail.value.profile.status === 'disabled') return
  disableError.value = ''; disableResult.value = null
  disableForm.value = { idempotencyKey: newDisableIdempotencyKey(), reason: '', acknowledgeImpact: true }
  showDisable.value = true
}
function closeDisable() { if (!isDisabling.value) { showDisable.value = false; disableError.value = ''; disableResult.value = null } }
async function submitDisable() {
  if (!detail.value) return
  isDisabling.value = true; disableError.value = ''
  try {
    disableResult.value = await disablePerson(detail.value.profile.id, disableForm.value)
    await loadPerson()
  } catch (error) {
    const requestId = error instanceof PeopleApiError ? error.requestId : undefined
    disableError.value = `${error instanceof Error ? error.message : '停用人员失败'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally { isDisabling.value = false }
}
function openDelete() {
  if (!detail.value || detail.value.profile.status !== 'disabled') return
  deleteError.value = ''; deleteResult.value = null
  deleteForm.value = { idempotencyKey: newDeleteIdempotencyKey(), reason: '', acknowledgeImpact: true }
  showDelete.value = true
}
function closeDelete() { if (!isDeleting.value) { showDelete.value = false; deleteError.value = ''; deleteResult.value = null } }
async function submitDelete() {
  if (!detail.value || detail.value.profile.status !== 'disabled') return
  isDeleting.value = true; deleteError.value = ''
  try {
    deleteResult.value = await deletePerson(detail.value.profile.id, deleteForm.value)
  } catch (error) {
    const requestId = error instanceof PeopleApiError ? error.requestId : undefined
    deleteError.value = `${error instanceof Error ? error.message : '删除人员失败'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally { isDeleting.value = false }
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
        <div class="person-hero-avatar" :class="`avatar-${detail.profile.tone}`">{{ surnameInitial(detail.profile.name) }}</div>
        <div class="person-hero-copy">
          <div class="person-hero-name"><h1>{{ detail.profile.name }}</h1><span class="person-status" :class="`status-${detail.profile.status}`"><i />{{ statusLabels[detail.profile.status] }}</span></div>
          <p>{{ detail.profile.department.name }}</p>
          <div><span><IconKey :size="14" />{{ detail.profile.keyCount }} 个访问 Key</span><span><IconClock :size="14" />{{ relativeTime(detail.profile.lastActiveAt) }}</span></div>
        </div>
        <div class="person-hero-actions"><span>更新于 {{ updatedAt }}</span><button class="btn btn-white" :disabled="isLoading" @click="loadPerson"><IconRefresh :size="16" :class="{ spinning: isLoading }" />刷新</button><button class="btn danger-outline" :disabled="detail.profile.status === 'disabled'" @click="openDisable"><IconBan :size="16" />{{ detail.profile.status === 'disabled' ? '人员已停用' : '停用人员' }}</button></div>
      </section>

      <div class="source-banner detail-source"><span>{{ detail.meta.source.toUpperCase() }}</span>{{ detail.meta.notice }}</div>

      <section class="person-metric-grid" aria-label="个人核心指标">
        <article v-for="metric in metrics" :key="metric.label" class="metric-card">
          <div class="metric-top"><span class="metric-label">{{ metric.label }}</span><span class="metric-icon" :class="`tone-${metric.tone}`"><component :is="metric.icon" :size="19" /></span></div>
          <strong class="metric-value">{{ metric.value }}</strong><div class="metric-foot">{{ metric.hint }}</div>
        </article>
      </section>

      <section class="person-detail-grid">
        <article class="panel person-trend-panel">
          <div class="panel-header"><div><h2>个人用量趋势</h2><p>请求数；数据时区 Asia/Shanghai</p></div><div class="period-switch"><button :class="{ active: period === '7d' }" :disabled="isUsageLoading" @click="changePeriod('7d')">7 天</button><button :class="{ active: period === '30d' }" :disabled="isUsageLoading" @click="changePeriod('30d')">30 天</button></div></div>
          <div class="chart-legend"><span class="line-key" />请求数</div>
          <div ref="chartElement" class="person-trend-chart" role="img" :aria-label="`${detail.profile.name}用量趋势图`" />
        </article>

        <article class="panel profile-panel">
          <div class="panel-header"><div><h2>基础档案</h2><p>组织归属与访问权限</p></div><IconUser :size="18" /></div>
          <dl class="profile-facts">
            <div><dt>人员 ID</dt><dd>{{ detail.profile.id }}</dd></div><div><dt>所属部门</dt><dd><IconBuilding :size="13" />{{ detail.profile.department.name }}</dd></div>
          </dl>
        </article>
      </section>

      <section class="panel person-keys-panel">
        <div class="panel-header"><div><h2>访问 Key</h2><p>每个 Key 按绑定模型统计本自然月输入、输出和合计 Token；完整 Key 不进入浏览器、日志或导出</p></div><div class="key-summary-actions"><strong>本月合计 {{ compact(detail.metrics.monthTokens) }} Token</strong><RouterLink class="key-summary" :to="`/keys?owner=${detail.profile.id}`">查看 {{ detail.keys.length }} 个</RouterLink></div></div>
            <div v-if="detail.keys.length" class="table-responsive"><table class="data-table detail-key-table"><thead><tr><th>Key 掩码</th><th>用途</th><th>绑定模型</th><th>本月 Token</th><th>状态</th><th>到期时间</th><th>最后使用</th></tr></thead><tbody><tr v-for="key in detail.keys" :key="key.id"><td><code>{{ key.masked }}</code></td><td>{{ key.purpose }}</td><td><div class="model-tags"><span>{{ key.model }}</span></div></td><td><div class="key-token-cell"><strong>{{ compact(key.usage.totalTokens) }} Token</strong><small>{{ key.usage.requests }} 次 · 输入 {{ compact(key.usage.inputTokens) }} · 输出 {{ compact(key.usage.outputTokens) }}</small></div></td><td><span class="person-status" :class="`status-${key.status}`"><i />{{ key.status === 'active' ? '启用' : '停用' }}</span></td><td>{{ dateText(key.expiresAt) }}</td><td>{{ relativeTime(key.lastUsedAt) }}</td></tr></tbody></table></div>
        <div v-else class="panel-empty">该人员当前没有访问 Key</div>
      </section>

       <section class="person-bottom-grid">
         <article class="panel management-boundary"><div class="panel-header"><div><h2>管理操作</h2><p>仅开放本地模拟人员停用和删除</p></div><IconShieldLock :size="18" /></div><div class="boundary-copy"><strong>{{ detail.profile.status === 'disabled' ? '人员已停用，可从人员目录删除' : '停用会同时回收关联 Key' }}</strong><p>{{ detail.profile.status === 'disabled' ? '删除只移除人员目录记录，历史审计、用量与已回收 Key 记录会保留；操作要求管理员、CSRF、原因确认和幂等编号。' : '操作要求管理员、CSRF、原因确认和幂等编号；只影响 SQLite 模拟人员与 Key，不调用 New API。' }}</p><a class="btn btn-white" :href="`/audit?resource=person&search=${encodeURIComponent(detail.profile.name)}`"><IconClock :size="16" />操作审计</a><button v-if="detail.profile.status !== 'disabled'" class="btn danger-outline" @click="openDisable">停用并回收 Key</button><button v-else class="btn danger-outline" @click="openDelete"><IconTrash :size="16" />删除人员</button></div></article>
       </section>

      <footer class="page-footer">数据来源：{{ detail.meta.source.toUpperCase() }} · 人员状态与 Key 回收可写入本地 SQLite · 完整 Key 从不返回浏览器</footer>
    </template>

    <div v-if="showGoalAdjust && detail" class="drawer-backdrop" @click.self="closeGoalAdjust">
      <aside class="create-key-dialog quota-adjust-dialog" role="dialog" aria-modal="true" aria-label="调整人员月度软目标">
        <header><div><span class="source-tag demo">SQLITE</span><h2>{{ goalAdjustResult ? '人员软目标已更新' : '调整人员月度软目标' }}</h2></div><button class="icon-button" aria-label="关闭人员软目标调整" :disabled="isGoalAdjusting" @click="closeGoalAdjust">×</button></header>
        <template v-if="goalAdjustResult"><section class="created-key-success"><IconCheck :size="22" /><strong>{{ detail.profile.name }} 的月度软目标已更新</strong><p>{{ goalAdjustResult.meta.notice }}</p><small>{{ goalAdjustResult.impact.previousTargetPoints.toLocaleString('zh-CN') }} 点 → {{ goalAdjustResult.policy.targetPoints.toLocaleString('zh-CN') }} 点 · 预计 {{ goalAdjustResult.impact.projectedPercent }}%</small></section><footer class="create-key-dialog-footer"><a class="btn btn-white" :href="`/audit?eventId=${encodeURIComponent(goalAdjustResult.operation.auditEventId)}&origin=mutation`" :aria-label="`查看 ${goalAdjustResult.operation.auditEventId} 操作审计`"><IconClock :size="16" />查看操作审计</a><button class="btn create-key" @click="closeGoalAdjust">完成</button></footer></template>
        <form v-else class="create-key-form" @submit.prevent="submitGoalAdjust"><p class="create-person-note"><strong>{{ detail.profile.name }}</strong> 的月度软目标将写入本地 SQLite，并在详情页立即生效。此操作不启用硬额度、不阻断请求，也不会调用 New API 或修改真实预算。</p><label><span>本月软目标（点）</span><input v-model.number="goalAdjustForm.targetPoints" required min="1" max="1000000" type="number" /></label><div class="quota-adjust-impact"><span>当前已用点数</span><strong>{{ detail.metrics.monthPoints.toLocaleString('zh-CN') }} 点</strong><span>保存后预计使用率</span><strong :class="`state-${goalProjectionState}`">{{ goalProjectedPercent }}%</strong></div><p v-if="goalProjectedPercent >= 100" class="quota-adjust-warning"><IconAlertTriangle :size="15" />新目标低于当前已用点数；系统只会提示，不会拦截请求。</p><label><span>调整原因 <em>至少 8 个字符</em></span><textarea v-model="goalAdjustForm.reason" required minlength="8" maxlength="200" rows="4" placeholder="例如：本地演示活动需要提高人员月度提示阈值" /></label><label class="access-ack"><input v-model="goalAdjustForm.acknowledgeImpact" type="checkbox" /><span>我已确认：该操作只修改本地演示月度软目标，并写入不含原因原文的审计摘要；不会开启硬额度或影响真实预算。</span></label><div v-if="goalAdjustError" class="create-person-error"><IconAlertTriangle :size="16" />{{ goalAdjustError }}</div><footer><button class="btn btn-white" type="button" :disabled="isGoalAdjusting" @click="closeGoalAdjust">取消</button><button class="btn create-key" type="submit" :disabled="isGoalAdjusting || goalAdjustForm.targetPoints < 1 || goalAdjustForm.targetPoints > 1000000 || goalAdjustForm.reason.trim().length < 8 || !goalAdjustForm.acknowledgeImpact">{{ isGoalAdjusting ? '保存中…' : '确认更新软目标' }}</button></footer></form>
      </aside>
    </div>

    <div v-if="showDisable && detail" class="drawer-backdrop" @click.self="closeDisable">
      <aside class="create-person-dialog disable-person-dialog" role="dialog" aria-modal="true" aria-label="停用人员">
        <header><div><span class="source-tag demo">SQLITE</span><h2>停用本地演示人员</h2></div><button class="icon-button" aria-label="关闭停用人员" :disabled="isDisabling" @click="closeDisable">×</button></header>
        <template v-if="disableResult"><section class="created-key-success"><IconCheck :size="22" /><strong>{{ disableResult.person.name }} 已停用</strong><p>{{ disableResult.meta.notice }}</p><small>已回收 {{ disableResult.keysDisabled }} 个仍有效 Key；审计不保存原因原文。</small></section><footer class="create-key-dialog-footer"><a class="btn btn-white" :href="`/audit?eventId=${encodeURIComponent(disableResult.operation.auditEventId)}&origin=mutation`" :aria-label="`查看 ${disableResult.operation.auditEventId} 操作审计`"><IconClock :size="16" />查看操作审计</a><button class="btn create-key" @click="closeDisable">完成</button></footer></template>
        <form v-else class="create-person-form" @submit.prevent="submitDisable"><p class="create-person-note"><strong>{{ detail.profile.name }}</strong> 会在本地 SQLite 中标为停用，并立即回收其所有仍有效 Key。其后续本地登录和已有会话访问会被拒绝；不会调用 New API 或修改真实账户。</p><label><span>停用原因 <em>至少 8 个字符</em></span><textarea v-model="disableForm.reason" required minlength="8" maxlength="200" rows="4" placeholder="例如：本地演示账号已完成测试，需要停用" /></label><label class="access-ack"><input v-model="disableForm.acknowledgeImpact" type="checkbox" /><span>我已确认：人员状态和关联 Key 会立即改变，操作会写入不含原因原文或完整 Key 的审计摘要。</span></label><div v-if="disableError" class="create-person-error"><IconAlertTriangle :size="16" />{{ disableError }}</div><footer><button class="btn btn-white" type="button" :disabled="isDisabling" @click="closeDisable">取消</button><button class="btn danger-outline" type="submit" :disabled="isDisabling || disableForm.reason.trim().length < 8 || !disableForm.acknowledgeImpact">{{ isDisabling ? '停用中…' : '确认停用并回收 Key' }}</button></footer></form>
      </aside>
    </div>

    <div v-if="showDelete && detail" class="drawer-backdrop" @click.self="closeDelete">
      <aside class="create-person-dialog disable-person-dialog" role="dialog" aria-modal="true" aria-label="删除人员">
        <header><div><span class="source-tag demo">SQLITE</span><h2>{{ deleteResult ? '人员已删除' : '删除已停用人员' }}</h2></div><button class="icon-button" aria-label="关闭删除人员" :disabled="isDeleting" @click="closeDelete">×</button></header>
        <template v-if="deleteResult"><section class="created-key-success"><IconCheck :size="22" /><strong>{{ deleteResult.person.name }} 已删除</strong><p>{{ deleteResult.meta.notice }}</p><small>人员目录中已不可见；历史审计、用量与已回收 Key 记录已保留。</small></section><footer class="create-key-dialog-footer"><RouterLink class="btn create-key" to="/people">返回人员列表</RouterLink></footer></template>
        <form v-else class="create-person-form" @submit.prevent="submitDelete"><p class="create-person-note"><strong>{{ detail.profile.name }}</strong> 已经停用。删除后会从人员目录移除，历史审计、用量与已回收 Key 记录保留，且不能恢复。</p><label><span>删除原因 <em>至少 8 个字符</em></span><textarea v-model="deleteForm.reason" required minlength="8" maxlength="200" rows="4" placeholder="例如：本地演示人员已完成测试，需要从目录移除" /></label><label class="access-ack"><input v-model="deleteForm.acknowledgeImpact" type="checkbox" /><span>我已确认：该人员已经停用，删除后不能恢复；操作会写入不含原因原文的审计摘要。</span></label><div v-if="deleteError" class="create-person-error"><IconAlertTriangle :size="16" />{{ deleteError }}</div><footer><button class="btn btn-white" type="button" :disabled="isDeleting" @click="closeDelete">取消</button><button class="btn danger-outline" type="submit" :disabled="isDeleting || deleteForm.reason.trim().length < 8 || !deleteForm.acknowledgeImpact">{{ isDeleting ? '删除中…' : '确认删除人员' }}</button></footer></form>
      </aside>
    </div>
  </div>
</template>
