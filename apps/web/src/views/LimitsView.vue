<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  IconAlertTriangle, IconBuilding, IconCheck, IconChevronDown, IconChevronRight, IconClock, IconDatabase,
  IconFilter, IconGauge, IconKey, IconRefresh, IconSearch, IconShieldLock, IconSparkles, IconUser, IconX,
} from '@tabler/icons-vue'
import { fetchLimits, LimitsApiError, updateMonthlySoftQuota, type LimitFilters, type LimitNode, type LimitsResponse, type QuotaUpdateBody, type QuotaUpdateResponse } from '../limits-api'
import { decideQuotaRequest, fetchQuotaRequests, QuotaRequestsApiError, type QuotaDecisionBody, type QuotaRequest, type QuotaRequestActionResponse, type QuotaRequestsResponse } from '../quota-requests-api'
import { createQuotaReservation, fetchQuotaReservations, QuotaReservationsApiError, updateQuotaReservation, type QuotaReservation, type QuotaReservationActionBody, type QuotaReservationActionResponse, type QuotaReservationBody, type QuotaReservationsResponse } from '../quota-reservations-api'
import { useDebouncedSearch } from '../composables/useDebouncedSearch'

const limits = ref<LimitsResponse | null>(null)
const selectedId = ref('company-xinzhi')
const level = ref<LimitFilters['level']>('all')
const search = ref('')
const collapsedIds = ref(new Set<string>())
const isLoading = ref(false)
const errorMessage = ref('')
const showAdjust = ref(false)
const adjustError = ref('')
const isAdjusting = ref(false)
const adjustResult = ref<QuotaUpdateResponse | null>(null)
const adjustForm = ref<QuotaUpdateBody>({ targetPoints: 1, idempotencyKey: '', reason: '', acknowledgeImpact: true })
const quotaRequests = ref<QuotaRequestsResponse | null>(null)
const quotaStatus = ref<'all' | 'pending' | 'approved' | 'rejected' | 'expired'>('all')
const quotaRequestError = ref('')
const quotaDecision = ref<{ request: QuotaRequest; decision: 'approve' | 'reject' } | null>(null)
const quotaDecisionForm = ref<QuotaDecisionBody>({ decision: 'approve', reason: '', acknowledgeImpact: true, idempotencyKey: '' })
const quotaDecisionResult = ref<QuotaRequestActionResponse | null>(null)
const isDecidingQuota = ref(false)
const reservations = ref<QuotaReservationsResponse | null>(null)
const reservationError = ref('')
const reservationDialog = ref<{ mode: 'create' | 'action'; item?: QuotaReservation; action?: 'settle' | 'cancel' } | null>(null)
const reservationResult = ref<QuotaReservationActionResponse | null>(null)
const isSavingReservation = ref(false)
const reservationForm = ref<QuotaReservationBody>({ nodeId: '', points: 10, concurrentUnits: 1, reason: '', acknowledgeSimulation: true, idempotencyKey: '' })
const reservationActionForm = ref<QuotaReservationActionBody>({ action: 'settle', reason: '', acknowledgeSimulation: true, idempotencyKey: '' })
let request: AbortController | null = null

const selected = computed(() => limits.value?.items.find((item) => item.id === selectedId.value) ?? limits.value?.items[0] ?? null)
const itemMap = computed(() => new Map((limits.value?.items ?? []).map((item) => [item.id, item])))
const parentIds = computed(() => new Set((limits.value?.items ?? []).map((item) => item.parentId).filter((id): id is string => Boolean(id))))
const expandableIds = computed(() => (limits.value?.items ?? []).filter((item) => parentIds.value.has(item.id)).map((item) => item.id))
const allCollapsed = computed(() => expandableIds.value.length > 0 && expandableIds.value.every((id) => collapsedIds.value.has(id)))
const month = computed(() => selected.value?.periods.find((period) => period.id === 'month') ?? null)
const adjustedProjectedPercent = computed(() => {
  if (!month.value || !Number.isFinite(adjustForm.value.targetPoints) || adjustForm.value.targetPoints < 1) return 0
  return Number(((month.value.used + month.value.reserved) / adjustForm.value.targetPoints * 100).toFixed(1))
})
const adjustedProjectionState = computed(() => adjustedProjectedPercent.value >= 100 ? 'reached' : adjustedProjectedPercent.value >= 80 ? 'near' : 'normal')
const updatedAt = computed(() => limits.value ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(limits.value.meta.generatedAt)) : '等待数据')
const levelLabels: Record<LimitNode['level'], string> = { company: '公司', department: '部门', person: '人员', purpose: '用途', key: 'Key' }
const levelIcons = { company: IconBuilding, department: IconDatabase, person: IconUser, purpose: IconSparkles, key: IconKey }
const stateText = { normal: '正常', near: '接近目标', reached: '达到目标' }
const summaryCards = computed(() => {
  const value = limits.value?.summary
  return [
    { label: '公司月度目标', value: value ? value.monthlyLimit.toLocaleString('zh-CN') : '—', suffix: '点', hint: '全公司统一软目标', icon: IconGauge, tone: 'teal' },
    { label: '已用与预留', value: value ? `${value.percent}%` : '—', suffix: '', hint: value ? `${value.used.toLocaleString('zh-CN')} 已用 · ${value.reserved} 预留` : '等待数据', icon: IconDatabase, tone: 'blue' },
    { label: '接近目标范围', value: value?.alertedScopes ?? '—', suffix: '个', hint: '达到 80% 后提示', icon: IconAlertTriangle, tone: 'amber' },
    { label: '本月限流命中', value: value?.hitCount ?? '—', suffix: '次', hint: '当前仅观测不阻断', icon: IconShieldLock, tone: 'violet' },
  ]
})

function numberText(value: number) { return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${Math.round(value / 1_000)}K` : value.toLocaleString('zh-CN') }
function resetText(value: string) { return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) }
function currentFilters(): LimitFilters { return { level: level.value, search: search.value.trim() } }
function hasChildren(id: string) { return parentIds.value.has(id) }
function isVisible(item: LimitNode) {
  let parentId = item.parentId
  while (parentId) {
    if (collapsedIds.value.has(parentId)) return false
    parentId = itemMap.value.get(parentId)?.parentId ?? null
  }
  return true
}
function toggleNode(id: string) {
  const next = new Set(collapsedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsedIds.value = next
  selectedId.value = id
}
function toggleAll() {
  collapsedIds.value = allCollapsed.value ? new Set() : new Set(expandableIds.value)
  if (!allCollapsed.value && limits.value?.items[0]) selectedId.value = limits.value.items[0].id
}

async function loadLimits() {
  request?.abort()
  const next = new AbortController()
  request = next
  isLoading.value = true
  errorMessage.value = ''
  try {
    limits.value = await fetchLimits(currentFilters(), next.signal)
    if (!limits.value.softQuotaEnabled) {
      quotaRequests.value = null
      reservations.value = null
      showAdjust.value = false
      quotaDecision.value = null
      reservationDialog.value = null
    } else {
      void loadQuotaRequests()
    }
    if (!limits.value.items.some((item) => item.id === selectedId.value)) selectedId.value = limits.value.items[0]?.id ?? ''
  } catch (error) {
    if (next.signal.aborted) return
    const requestId = error instanceof LimitsApiError ? error.requestId : undefined
    errorMessage.value = `${error instanceof Error ? error.message : '额度策略暂时无法加载'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally { if (request === next) isLoading.value = false }
}

async function loadQuotaRequests() {
  quotaRequestError.value = ''
  try { quotaRequests.value = await fetchQuotaRequests(quotaStatus.value) } catch (error) {
    const requestId = error instanceof QuotaRequestsApiError ? error.requestId : undefined
    quotaRequestError.value = `${error instanceof Error ? error.message : '临时额度申请暂时无法加载'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  }
}

async function loadReservations() {
  if (!selected.value) { reservations.value = null; return }
  reservationError.value = ''
  try { reservations.value = await fetchQuotaReservations(selected.value.id) } catch (error) {
    const requestId = error instanceof QuotaReservationsApiError ? error.requestId : undefined
    reservationError.value = `${error instanceof Error ? error.message : '并发预留演练暂时无法加载'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  }
}

function applyFilters() { cancelSearch(); void loadLimits() }
function clearFilters() { level.value = 'all'; search.value = ''; applyFilters() }

function openAdjust() {
  if (!selected.value || !month.value) return
  adjustError.value = ''
  adjustResult.value = null
  adjustForm.value = {
    targetPoints: month.value.limit,
    idempotencyKey: `quota-update-${crypto.randomUUID()}`,
    reason: '',
    acknowledgeImpact: true,
  }
  showAdjust.value = true
}

function closeAdjust() {
  if (isAdjusting.value) return
  showAdjust.value = false
}

async function submitAdjust() {
  if (!selected.value) return
  isAdjusting.value = true
  adjustError.value = ''
  try {
    adjustResult.value = await updateMonthlySoftQuota(selected.value.id, adjustForm.value)
    await loadLimits()
  } catch (error) {
    const requestId = error instanceof LimitsApiError ? error.requestId : undefined
    adjustError.value = `${error instanceof Error ? error.message : '调整月度软目标失败'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally {
    isAdjusting.value = false
  }
}

function openQuotaDecision(item: QuotaRequest, decision: 'approve' | 'reject') {
  quotaDecision.value = { request: item, decision }
  quotaDecisionResult.value = null
  quotaDecisionForm.value = { decision, reason: '', acknowledgeImpact: true, idempotencyKey: `quota-decision-${crypto.randomUUID()}` }
}
function closeQuotaDecision() { if (!isDecidingQuota.value) quotaDecision.value = null }
async function submitQuotaDecision() {
  if (!quotaDecision.value) return
  isDecidingQuota.value = true; quotaRequestError.value = ''
  try { quotaDecisionResult.value = await decideQuotaRequest(quotaDecision.value.request.id, quotaDecisionForm.value); await Promise.all([loadQuotaRequests(), loadLimits()]) } catch (error) {
    const requestId = error instanceof QuotaRequestsApiError ? error.requestId : undefined
    quotaRequestError.value = `${error instanceof Error ? error.message : '处理临时额度申请失败'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally { isDecidingQuota.value = false }
}

function openReservationCreate() {
  if (!selected.value) return
  reservationResult.value = null
  reservationError.value = ''
  reservationForm.value = { nodeId: selected.value.id, points: 10, concurrentUnits: 1, reason: '', acknowledgeSimulation: true, idempotencyKey: `quota-reservation-${crypto.randomUUID()}` }
  reservationDialog.value = { mode: 'create' }
}
function openReservationAction(item: QuotaReservation, action: 'settle' | 'cancel') {
  reservationResult.value = null
  reservationError.value = ''
  reservationActionForm.value = { action, reason: '', acknowledgeSimulation: true, idempotencyKey: `quota-reservation-${action}-${crypto.randomUUID()}` }
  reservationDialog.value = { mode: 'action', item, action }
}
function closeReservationDialog() { if (!isSavingReservation.value) reservationDialog.value = null }
async function submitReservation() {
  if (!reservationDialog.value) return
  isSavingReservation.value = true
  reservationError.value = ''
  try {
    reservationResult.value = reservationDialog.value.mode === 'create'
      ? await createQuotaReservation(reservationForm.value)
      : await updateQuotaReservation(reservationDialog.value.item!.id, reservationActionForm.value)
    await loadReservations()
  } catch (error) {
    const requestId = error instanceof QuotaReservationsApiError ? error.requestId : undefined
    reservationError.value = `${error instanceof Error ? error.message : '保存并发预留演练失败'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally { isSavingReservation.value = false }
}

const { cancel: cancelSearch } = useDebouncedSearch(search, () => void loadLimits())

onMounted(() => { void loadLimits() })
watch(selectedId, () => { void loadReservations() })
watch(limits, () => { void loadReservations() })
onBeforeUnmount(() => request?.abort())
</script>

<template>
  <div class="dashboard limits-dashboard">
    <section class="page-heading">
      <div><div class="eyebrow">BUDGET &amp; TRAFFIC POLICY</div><h1>额度与限流</h1><p>{{ limits?.softQuotaEnabled === false ? '软额度已废弃；当前页面仅保留限流能力状态说明。' : '从公司到 Key 检查五层软目标、周期用量与实时流量边界。' }}</p></div>
      <div class="heading-actions"><span class="updated-at">更新于 {{ updatedAt }}</span><button class="btn btn-white refresh-button" :disabled="isLoading" @click="loadLimits"><IconRefresh :size="17" :class="{ spinning: isLoading }" />刷新</button><button v-if="limits?.softQuotaEnabled !== false" class="btn" :disabled="!selected" @click="openAdjust">调整月度软目标</button></div>
    </section>

    <div v-if="limits" class="source-banner"><span>{{ limits.meta.source === 'database' ? 'SQLITE' : 'DEMO' }}</span>{{ limits.meta.notice }}</div>
    <section v-if="limits?.softQuotaEnabled !== false" class="limit-summary-grid" aria-label="额度状态摘要"><article v-for="card in summaryCards" :key="card.label" class="metric-card"><div class="metric-top"><span class="metric-label">{{ card.label }}</span><span class="metric-icon" :class="`tone-${card.tone}`"><component :is="card.icon" :size="19" /></span></div><strong class="metric-value">{{ card.value }} <small>{{ card.suffix }}</small></strong><div class="metric-foot">{{ card.hint }}</div></article></section>

    <section v-if="limits?.softQuotaEnabled" class="soft-mode-banner"><span><IconShieldLock :size="20" /></span><div><strong>当前为软额度模式</strong><p>达到 80% 或 100% 只产生提示，当前不会拒绝员工请求。硬额度开关已由服务端固定关闭。</p></div><em>不阻断</em></section>

    <div v-if="!limits && !errorMessage" class="panel data-state"><div class="state-icon"><IconRefresh :size="22" class="spinning" /></div><div><strong>正在读取额度策略</strong><p>正在聚合五层目标和实时限流指标…</p></div></div>
    <div v-else-if="errorMessage" class="panel data-state failed"><div class="state-icon"><IconAlertTriangle :size="22" /></div><div><strong>额度策略加载失败</strong><p>{{ errorMessage }}</p></div><button class="btn btn-white" @click="loadLimits">重试</button></div>

    <template v-else-if="limits">
      <section v-if="!limits.softQuotaEnabled" class="panel data-state deprecated-state"><div class="state-icon"><IconShieldLock :size="22" /></div><div><strong>软额度已废弃</strong><p>当前版本不再展示或生成软目标、临时额度申请和额度告警；硬限流尚未开启，后续将单独验收实时限流保护。</p></div></section>
      <template v-else>
      <section class="panel limit-workbench">
        <form class="limit-filters" @submit.prevent="applyFilters"><label class="limit-search"><IconSearch :size="16" /><input v-model="search" aria-label="搜索额度范围" maxlength="60" type="search" placeholder="搜索范围、人员、用途或 Key 掩码" /></label><label><IconFilter :size="15" /><select v-model="level" @change="applyFilters"><option value="all">全部层级</option><option v-for="item in limits.options.levels" :key="item.id" :value="item.id">{{ item.label }}</option></select></label><span class="realtime-search-hint" aria-live="polite">输入即搜索</span><button class="text-button" type="button" @click="clearFilters">清除</button></form>
        <div class="limit-workbench-grid">
          <div class="limit-tree-column">
              <header><div><strong>五层额度树</strong><small>{{ limits.total }} 个策略范围</small></div><button class="tree-collapse-all" :disabled="!expandableIds.length" @click="toggleAll">{{ allCollapsed ? '全部展开' : '全部收起' }}</button></header>
              <div v-if="limits.items.length" class="limit-tree">
              <div v-for="item in limits.items" v-show="isVisible(item)" :key="item.id" class="limit-tree-row" :style="{ '--tree-depth': item.depth }">
                <button v-if="hasChildren(item.id)" class="tree-toggle" :aria-label="`${collapsedIds.has(item.id) ? '展开' : '收起'}${item.name}`" @click="toggleNode(item.id)"><IconChevronRight v-if="collapsedIds.has(item.id)" :size="14" /><IconChevronDown v-else :size="14" /></button><span v-else class="tree-toggle-placeholder" />
                <button class="tree-node" :class="{ active: selected?.id === item.id }" @click="selectedId = item.id"><span class="tree-icon"><component :is="levelIcons[item.level]" :size="15" /></span><span class="tree-copy"><strong>{{ item.name }}</strong><small>{{ levelLabels[item.level] }} · {{ item.descriptor }}</small></span><span class="tree-usage"><em :class="`state-${item.state}`">{{ item.periods[3].percent }}%</em><small>{{ stateText[item.state] }}</small></span></button>
              </div>
            </div>
            <div v-else class="people-empty"><IconSearch :size="23" /><strong>没有符合条件的策略</strong><span>更换层级或搜索内容后重试。</span><button class="text-button" @click="clearFilters">清除筛选</button></div>
          </div>

          <div v-if="selected" class="limit-detail-column">
            <header class="limit-detail-header"><div><span class="scope-badge">{{ levelLabels[selected.level] }}</span><h2>{{ selected.name }}</h2><p>{{ selected.descriptor }}<template v-if="selected.inheritedFrom"> · 继承自 {{ selected.inheritedFrom }}</template></p></div><div class="limit-detail-actions"><button class="btn btn-white" @click="openAdjust">调整此范围</button></div></header>
            <section v-if="month" class="limit-progress-card"><div><span>本月软目标</span><strong>{{ month.percent }}%</strong></div><div class="limit-progress"><i :class="`state-${selected.state}`" :style="{ width: `${Math.min(month.percent, 100)}%` }" /><b :style="{ left: '80%' }" /></div><footer><span>{{ month.used.toLocaleString('zh-CN') }} 已用</span><span>{{ month.reserved }} 预留</span><span>{{ month.limit.toLocaleString('zh-CN') }} 目标</span></footer></section>

            <section class="period-grid" aria-label="周期用量"><article v-for="period in selected.periods" :key="period.id"><div><strong>{{ period.label }}</strong><em>{{ period.percent }}%</em></div><p>{{ period.used.toLocaleString('zh-CN') }} + {{ period.reserved }} 预留 / {{ period.limit.toLocaleString('zh-CN') }}</p><div><i :style="{ width: `${Math.min(period.percent, 100)}%` }" /></div><small><IconClock :size="12" />{{ resetText(period.resetAt) }} 重置</small></article></section>

            <section class="rate-section"><header><div><strong>实时限流</strong><small>当前值为观测快照，命中次数按本月累计</small></div><span>网关执行</span></header><div class="rate-grid"><article><span>RPM</span><strong>{{ numberText(selected.rates.rpm.current) }} <small>/ {{ numberText(selected.rates.rpm.limit) }}</small></strong><div><i :style="{ width: `${Math.min(selected.rates.rpm.current / selected.rates.rpm.limit * 100, 100)}%` }" /></div><em>{{ selected.rates.rpm.hits }} 次命中</em></article><article><span>TPM</span><strong>{{ numberText(selected.rates.tpm.current) }} <small>/ {{ numberText(selected.rates.tpm.limit) }}</small></strong><div><i :style="{ width: `${Math.min(selected.rates.tpm.current / selected.rates.tpm.limit * 100, 100)}%` }" /></div><em>{{ selected.rates.tpm.hits }} 次命中</em></article><article><span>最大并发</span><strong>{{ selected.rates.concurrent.current }} <small>/ {{ selected.rates.concurrent.limit }}</small></strong><div><i :style="{ width: `${Math.min(selected.rates.concurrent.current / selected.rates.concurrent.limit * 100, 100)}%` }" /></div><em>{{ selected.rates.concurrent.hits }} 次命中</em></article></div></section>
            <section class="reservation-panel">
              <header class="reservation-header"><div><strong>并发预留演练</strong><small>验证预留 → 结算 / 取消；只写本地 SQLite</small></div><div class="reservation-header-actions"><span>不阻断</span><button v-if="limits.meta.source === 'database'" class="btn" @click="openReservationCreate">开始预留</button></div></header>
              <p class="reservation-note">用于验证请求开始时占用、成功后结算、失败后释放的状态路径。不会改变真实网关额度，也不会调用 New API。</p>
              <div v-if="reservationError" class="quota-request-error"><IconAlertTriangle :size="15" />{{ reservationError }}</div>
              <div v-else-if="reservations?.items.length" class="reservation-list">
                <article v-for="item in reservations.items" :key="item.id" class="reservation-row">
                  <div class="reservation-state" :class="item.status"><span>{{ item.status === 'reserved' ? '预留中' : item.status === 'settled' ? '已结算' : '已取消' }}</span><small>{{ resetText(item.requestedAt) }}</small></div>
                  <div class="reservation-copy"><strong>{{ item.points.toLocaleString('zh-CN') }} 点 · {{ item.concurrentUnits }} 并发</strong><small>{{ item.nodeName }} · {{ item.actor?.name ?? '本地演练' }}</small></div>
                  <div v-if="item.status === 'reserved' && reservations?.scope?.canDecide !== false" class="reservation-actions"><button class="text-button" @click="openReservationAction(item, 'cancel')">取消释放</button><button class="text-button confirm" @click="openReservationAction(item, 'settle')">结算</button></div>
                </article>
              </div>
              <div v-else class="reservation-empty"><IconClock :size="17" />当前范围还没有预留演练记录</div>
            </section>
          </div>
        </div>
      </section>

      <section class="panel hard-mode-panel"><header class="panel-header"><div><span class="panel-title">硬额度上线条件</span><span class="panel-subtitle">全部验收后才允许开启阻断模式</span></div><span class="hard-mode-off">服务端已关闭</span></header><div class="hard-requirements"><article v-for="item in limits.hardMode.requirements" :key="item.label"><span><IconClock :size="16" /></span><div><strong>{{ item.label }}</strong><small>{{ item.detail }}</small></div><em>待验证</em></article></div><footer><IconCheck :size="16" />月度软目标和临时额度审批均可写入本地 SQLite；硬额度仍保持关闭，不会阻断请求。</footer></section>

      <section class="panel quota-approval-panel"><header class="panel-header"><div><span class="panel-title">临时额度申请</span><span class="panel-subtitle">本地审批轨道 · 申请原因只保存长度</span></div><div class="quota-approval-summary"><strong>{{ quotaRequests?.summary.pending ?? 0 }}</strong><small>待审批</small><strong>{{ quotaRequests?.summary.active ?? 0 }}</strong><small>活跃</small></div></header><div class="quota-approval-toolbar"><span>审批状态</span><select v-model="quotaStatus" @change="loadQuotaRequests"><option value="all">全部申请</option><option value="pending">待审批</option><option value="approved">已批准</option><option value="rejected">已拒绝</option><option value="expired">已到期</option></select><button class="text-button" @click="loadQuotaRequests"><IconRefresh :size="14" />刷新</button></div><div v-if="quotaRequestError" class="quota-request-error"><IconAlertTriangle :size="15" />{{ quotaRequestError }}</div><div v-else-if="quotaRequests?.items.length" class="quota-approval-list"><article v-for="item in quotaRequests.items" :key="item.id" class="quota-approval-card"><div class="quota-status-rail" :class="item.status" /><div class="quota-approval-main"><header><div><strong>{{ item.requester.name }}</strong><span>{{ item.requester.department }}</span></div><span class="quota-status" :class="item.status">{{ item.status === 'pending' ? '待审批' : item.status === 'approved' ? '已批准' : item.status === 'rejected' ? '已拒绝' : '已到期' }}</span></header><div class="quota-approval-metrics"><span><small>申请点数</small><strong>{{ item.targetPoints.toLocaleString('zh-CN') }} 点</strong></span><span><small>有效时长</small><strong>{{ item.durationHours }} 小时</strong></span><span><small>申请时间</small><strong>{{ resetText(item.requestedAt) }}</strong></span><span><small>原因记录</small><strong>{{ item.reasonLength }} 字（脱敏）</strong></span></div><footer><span v-if="item.expiresAt">{{ item.status === 'approved' ? `到期 ${resetText(item.expiresAt)}` : `处理于 ${resetText(item.decidedAt ?? item.requestedAt)}` }}</span><span v-else>审批操作会写入审计链</span><div v-if="quotaRequests?.scope.canDecide && item.status === 'pending'" class="quota-approval-actions"><button class="btn btn-white" @click="openQuotaDecision(item, 'reject')">拒绝</button><button class="btn" @click="openQuotaDecision(item, 'approve')">批准</button></div></footer></div></article></div><div v-else class="quota-approval-empty"><IconCheck :size="18" />当前筛选下没有申请记录</div></section>
    </template>
      </template>
      <footer class="page-footer">数据来源：{{ limits?.meta.source.toUpperCase() ?? '等待数据' }} · {{ limits?.softQuotaEnabled ? '软额度功能已启用' : '软额度已废弃' }} · 硬额度关闭 · 不调用 New API</footer>

    <div v-if="showAdjust && selected && month" class="drawer-backdrop" @click.self="closeAdjust">
      <aside class="create-key-dialog quota-adjust-dialog" role="dialog" aria-modal="true" aria-label="调整月度软目标">
        <header><div><span class="source-tag demo">SQLITE</span><h2>{{ adjustResult ? '月度软目标已更新' : '调整月度软目标' }}</h2></div><button class="icon-button" aria-label="关闭调整月度软目标" :disabled="isAdjusting" @click="closeAdjust"><IconX :size="20" /></button></header>
        <template v-if="adjustResult"><section class="created-key-success"><IconCheck :size="22" /><strong>{{ selected.name }} 的月度软目标已更新</strong><p>{{ adjustResult.meta.notice }}</p><small>{{ adjustResult.impact.previousTargetPoints.toLocaleString('zh-CN') }} 点 → {{ adjustResult.policy.targetPoints.toLocaleString('zh-CN') }} 点 · 预计 {{ adjustResult.impact.projectedPercent }}%</small></section><footer class="create-key-dialog-footer"><button class="btn create-key" @click="closeAdjust">完成</button></footer></template>
        <form v-else class="create-key-form" @submit.prevent="submitAdjust"><p class="create-person-note"><strong>{{ selected.name }}</strong> 的月度软目标将写入本地 SQLite，并在页面提示中立即生效。此操作不启用硬额度、不阻断请求，也不会调用 New API 或修改真实预算。</p><label><span>本月软目标（点）</span><input v-model.number="adjustForm.targetPoints" required min="1" max="1000000" type="number" /></label><div class="quota-adjust-impact"><span>当前已用 + 预留</span><strong>{{ month.used.toLocaleString('zh-CN') }} + {{ month.reserved.toLocaleString('zh-CN') }} 点</strong><span>保存后预计使用率</span><strong :class="`state-${adjustedProjectionState}`">{{ adjustedProjectedPercent }}%</strong></div><p v-if="adjustedProjectedPercent >= 100" class="quota-adjust-warning"><IconAlertTriangle :size="15" />新目标低于当前已用与预留总和；系统只会提示，不会拦截请求。</p><label><span>调整原因 <em>至少 8 个字符</em></span><textarea v-model="adjustForm.reason" required minlength="8" maxlength="200" rows="4" placeholder="例如：本地演示大促活动需要提高月度提示阈值" /></label><label class="access-ack"><input v-model="adjustForm.acknowledgeImpact" type="checkbox" /><span>我已确认：该操作只修改本地演示月度软目标，并写入不含原因原文的审计摘要；不会开启硬额度或影响真实预算。</span></label><div v-if="adjustError" class="create-person-error"><IconAlertTriangle :size="16" />{{ adjustError }}</div><footer><button class="btn btn-white" type="button" :disabled="isAdjusting" @click="closeAdjust">取消</button><button class="btn create-key" type="submit" :disabled="isAdjusting || adjustForm.targetPoints < 1 || adjustForm.targetPoints > 1000000 || adjustForm.reason.trim().length < 8 || !adjustForm.acknowledgeImpact">{{ isAdjusting ? '保存中…' : '确认更新软目标' }}</button></footer></form>
      </aside>
    </div>

    <div v-if="reservationDialog" class="drawer-backdrop" @click.self="closeReservationDialog"><aside class="create-key-dialog reservation-dialog" role="dialog" aria-modal="true" aria-label="并发预留演练"><header><div><span class="source-tag demo">LOCAL SQLITE</span><h2>{{ reservationResult ? '演练已完成' : reservationDialog.mode === 'create' ? '开始并发预留' : reservationDialog.action === 'settle' ? '结算并发预留' : '取消并释放预留' }}</h2></div><button class="icon-button" aria-label="关闭并发预留演练" :disabled="isSavingReservation" @click="closeReservationDialog"><IconX :size="20" /></button></header><template v-if="reservationResult"><section class="created-key-success"><IconCheck :size="22" /><strong>{{ reservationResult.reservation.status === 'reserved' ? '预留已创建' : reservationResult.reservation.status === 'settled' ? '预留已结算' : '预留已取消并释放' }}</strong><p>{{ reservationResult.meta.notice }}</p><small>{{ reservationResult.reservation.points.toLocaleString('zh-CN') }} 点 · {{ reservationResult.reservation.concurrentUnits }} 并发 · {{ reservationResult.reservation.nodeName }}</small><small>审计事件：{{ reservationResult.operation.auditEventId }}</small></section><footer class="create-key-dialog-footer"><button class="btn create-key" @click="closeReservationDialog">完成</button></footer></template><form v-else class="create-key-form" @submit.prevent="submitReservation"><p class="create-person-note">本地演练只验证状态流转：预留成功后可结算，模拟失败可取消释放。不会开启硬额度、拒绝员工请求或调用 New API。</p><template v-if="reservationDialog.mode === 'create'"><label><span>预留点数</span><input v-model.number="reservationForm.points" required min="1" max="1000000" type="number" /></label><label><span>并发单位</span><input v-model.number="reservationForm.concurrentUnits" required min="1" max="100" type="number" /></label></template><p v-else class="reservation-action-target"><strong>{{ reservationDialog.item?.nodeName }}</strong><span>{{ reservationDialog.item?.points.toLocaleString('zh-CN') }} 点 · {{ reservationDialog.item?.concurrentUnits }} 并发</span></p><label><span>{{ reservationDialog.mode === 'create' ? '演练说明' : '处理说明' }} <em>至少 8 个字符</em></span><textarea v-if="reservationDialog.mode === 'create'" v-model="reservationForm.reason" required minlength="8" maxlength="200" rows="4" placeholder="例如：验证本地并发预留路径" /><textarea v-else v-model="reservationActionForm.reason" required minlength="8" maxlength="200" rows="4" placeholder="例如：模拟上游失败后释放预留" /></label><label class="access-ack"><input v-if="reservationDialog.mode === 'create'" v-model="reservationForm.acknowledgeSimulation" type="checkbox" /><input v-else v-model="reservationActionForm.acknowledgeSimulation" type="checkbox" /><span>我已确认：这是本地演练，只写入 SQLite 和安全审计摘要，不改变真实额度。</span></label><div v-if="reservationError" class="create-person-error"><IconAlertTriangle :size="16" />{{ reservationError }}</div><footer><button class="btn btn-white" type="button" :disabled="isSavingReservation" @click="closeReservationDialog">取消</button><button class="btn create-key" type="submit" :disabled="isSavingReservation || (reservationDialog.mode === 'create' ? reservationForm.reason.trim().length < 8 || !reservationForm.acknowledgeSimulation || reservationForm.points < 1 || reservationForm.concurrentUnits < 1 : reservationActionForm.reason.trim().length < 8 || !reservationActionForm.acknowledgeSimulation)">{{ isSavingReservation ? '保存中…' : reservationDialog.mode === 'create' ? '确认开始预留' : reservationDialog.action === 'settle' ? '确认结算' : '确认取消释放' }}</button></footer></form></aside></div>

    <div v-if="quotaDecision" class="drawer-backdrop" @click.self="closeQuotaDecision"><aside class="create-key-dialog quota-decision-dialog" role="dialog" aria-modal="true" aria-label="处理临时额度申请"><header><div><span class="source-tag demo">LOCAL SQLITE</span><h2>{{ quotaDecisionResult ? '审批已完成' : quotaDecision.decision === 'approve' ? '批准临时额度' : '拒绝临时额度' }}</h2></div><button class="icon-button" aria-label="关闭临时额度审批" :disabled="isDecidingQuota" @click="closeQuotaDecision"><IconX :size="20" /></button></header><template v-if="quotaDecisionResult"><section class="created-key-success"><IconCheck :size="22" /><strong>{{ quotaDecisionResult.request.requester.name }} 的申请已{{ quotaDecisionResult.request.status === 'approved' ? '批准' : '拒绝' }}</strong><p>{{ quotaDecisionResult.meta.notice }}</p><small v-if="quotaDecisionResult.request.expiresAt">本次额度 {{ quotaDecisionResult.request.approvedPoints?.toLocaleString('zh-CN') }} 点 · 到期 {{ resetText(quotaDecisionResult.request.expiresAt) }}</small><small>审计事件：{{ quotaDecisionResult.operation.auditEventId }}</small></section><footer class="create-key-dialog-footer"><button class="btn create-key" @click="closeQuotaDecision">完成</button></footer></template><form v-else class="create-key-form" @submit.prevent="submitQuotaDecision"><p class="create-person-note"><strong>{{ quotaDecision.request.requester.name }}</strong> 申请 {{ quotaDecision.request.targetPoints.toLocaleString('zh-CN') }} 点、{{ quotaDecision.request.durationHours }} 小时。原申请说明仅保留 {{ quotaDecision.request.reasonLength }} 字长度，不在页面或审计中还原。</p><label><span>审批说明 <em>至少 8 个字符</em></span><textarea v-model="quotaDecisionForm.reason" required minlength="8" maxlength="200" rows="4" placeholder="说明批准或拒绝依据，不要填写密钥或敏感数据" /></label><label class="access-ack"><input v-model="quotaDecisionForm.acknowledgeImpact" type="checkbox" /><span>我已确认：这是本地演示审批，批准后只增加软目标展示，不阻断请求。</span></label><div v-if="quotaRequestError" class="create-person-error"><IconAlertTriangle :size="16" />{{ quotaRequestError }}</div><footer><button class="btn btn-white" type="button" :disabled="isDecidingQuota" @click="closeQuotaDecision">取消</button><button class="btn create-key" type="submit" :disabled="isDecidingQuota || quotaDecisionForm.reason.trim().length < 8 || !quotaDecisionForm.acknowledgeImpact">{{ isDecidingQuota ? '提交中…' : quotaDecision.decision === 'approve' ? '确认批准' : '确认拒绝' }}</button></footer></form></aside></div>
  </div>
</template>
