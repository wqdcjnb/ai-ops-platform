<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  IconAlertTriangle, IconBuilding, IconCheck, IconChevronDown, IconChevronRight, IconClock, IconDatabase,
  IconFilter, IconGauge, IconKey, IconRefresh, IconSearch, IconShieldLock, IconSparkles, IconUser, IconX,
} from '@tabler/icons-vue'
import { fetchLimits, LimitsApiError, updateMonthlySoftQuota, type LimitFilters, type LimitNode, type LimitsResponse, type QuotaUpdateBody, type QuotaUpdateResponse } from '../limits-api'
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
    if (!limits.value.items.some((item) => item.id === selectedId.value)) selectedId.value = limits.value.items[0]?.id ?? ''
  } catch (error) {
    if (next.signal.aborted) return
    const requestId = error instanceof LimitsApiError ? error.requestId : undefined
    errorMessage.value = `${error instanceof Error ? error.message : '额度策略暂时无法加载'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally { if (request === next) isLoading.value = false }
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

const { cancel: cancelSearch } = useDebouncedSearch(search, () => void loadLimits())

onMounted(() => void loadLimits())
onBeforeUnmount(() => request?.abort())
</script>

<template>
  <div class="dashboard limits-dashboard">
    <section class="page-heading">
      <div><div class="eyebrow">BUDGET &amp; TRAFFIC POLICY</div><h1>额度与限流</h1><p>从公司到 Key 检查五层软目标、周期用量与实时流量边界。</p></div>
      <div class="heading-actions"><span class="updated-at">更新于 {{ updatedAt }}</span><button class="btn btn-white refresh-button" :disabled="isLoading" @click="loadLimits"><IconRefresh :size="17" :class="{ spinning: isLoading }" />刷新</button><button class="btn" :disabled="!selected" @click="openAdjust">调整月度软目标</button></div>
    </section>

    <div v-if="limits" class="source-banner"><span>{{ limits.meta.source === 'database' ? 'SQLITE' : 'DEMO' }}</span>{{ limits.meta.notice }}</div>
    <section class="limit-summary-grid" aria-label="额度状态摘要"><article v-for="card in summaryCards" :key="card.label" class="metric-card"><div class="metric-top"><span class="metric-label">{{ card.label }}</span><span class="metric-icon" :class="`tone-${card.tone}`"><component :is="card.icon" :size="19" /></span></div><strong class="metric-value">{{ card.value }} <small>{{ card.suffix }}</small></strong><div class="metric-foot">{{ card.hint }}</div></article></section>

    <section v-if="limits" class="soft-mode-banner"><span><IconShieldLock :size="20" /></span><div><strong>当前为软额度模式</strong><p>达到 80% 或 100% 只产生提示，当前不会拒绝员工请求。硬额度开关已由服务端固定关闭。</p></div><em>不阻断</em></section>

    <div v-if="!limits && !errorMessage" class="panel data-state"><div class="state-icon"><IconRefresh :size="22" class="spinning" /></div><div><strong>正在读取额度策略</strong><p>正在聚合五层目标和实时限流指标…</p></div></div>
    <div v-else-if="errorMessage" class="panel data-state failed"><div class="state-icon"><IconAlertTriangle :size="22" /></div><div><strong>额度策略加载失败</strong><p>{{ errorMessage }}</p></div><button class="btn btn-white" @click="loadLimits">重试</button></div>

    <template v-else-if="limits">
      <section class="panel limit-workbench">
        <form class="limit-filters" @submit.prevent="applyFilters"><label class="limit-search"><IconSearch :size="16" /><input v-model="search" aria-label="搜索额度范围" maxlength="60" type="search" placeholder="搜索范围、人员、用途或 Key 掩码" /></label><label><IconFilter :size="15" /><select v-model="level" @change="applyFilters"><option value="all">全部层级</option><option v-for="item in limits.options.levels" :key="item.id" :value="item.id">{{ item.label }}</option></select></label><button class="btn filter-submit" type="submit">查询</button><button class="text-button" type="button" @click="clearFilters">清除</button></form>
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
            <header class="limit-detail-header"><div><span class="scope-badge">{{ levelLabels[selected.level] }}</span><h2>{{ selected.name }}</h2><p>{{ selected.descriptor }}<template v-if="selected.inheritedFrom"> · 继承自 {{ selected.inheritedFrom }}</template></p></div><div class="limit-detail-actions"><a class="btn btn-white" :href="`/audit?resource=quota&search=${encodeURIComponent(selected.name)}`"><IconClock :size="16" />操作审计</a><button class="btn btn-white" @click="openAdjust">调整此范围</button></div></header>
            <section v-if="month" class="limit-progress-card"><div><span>本月软目标</span><strong>{{ month.percent }}%</strong></div><div class="limit-progress"><i :class="`state-${selected.state}`" :style="{ width: `${Math.min(month.percent, 100)}%` }" /><b :style="{ left: '80%' }" /></div><footer><span>{{ month.used.toLocaleString('zh-CN') }} 已用</span><span>{{ month.reserved }} 预留</span><span>{{ month.limit.toLocaleString('zh-CN') }} 目标</span></footer></section>

            <section class="period-grid" aria-label="周期用量"><article v-for="period in selected.periods" :key="period.id"><div><strong>{{ period.label }}</strong><em>{{ period.percent }}%</em></div><p>{{ period.used.toLocaleString('zh-CN') }} + {{ period.reserved }} 预留 / {{ period.limit.toLocaleString('zh-CN') }}</p><div><i :style="{ width: `${Math.min(period.percent, 100)}%` }" /></div><small><IconClock :size="12" />{{ resetText(period.resetAt) }} 重置</small></article></section>

            <section class="rate-section"><header><div><strong>实时限流</strong><small>当前值为观测快照，命中次数按本月累计</small></div><span>网关执行</span></header><div class="rate-grid"><article><span>RPM</span><strong>{{ numberText(selected.rates.rpm.current) }} <small>/ {{ numberText(selected.rates.rpm.limit) }}</small></strong><div><i :style="{ width: `${Math.min(selected.rates.rpm.current / selected.rates.rpm.limit * 100, 100)}%` }" /></div><em>{{ selected.rates.rpm.hits }} 次命中</em></article><article><span>TPM</span><strong>{{ numberText(selected.rates.tpm.current) }} <small>/ {{ numberText(selected.rates.tpm.limit) }}</small></strong><div><i :style="{ width: `${Math.min(selected.rates.tpm.current / selected.rates.tpm.limit * 100, 100)}%` }" /></div><em>{{ selected.rates.tpm.hits }} 次命中</em></article><article><span>最大并发</span><strong>{{ selected.rates.concurrent.current }} <small>/ {{ selected.rates.concurrent.limit }}</small></strong><div><i :style="{ width: `${Math.min(selected.rates.concurrent.current / selected.rates.concurrent.limit * 100, 100)}%` }" /></div><em>{{ selected.rates.concurrent.hits }} 次命中</em></article></div></section>
          </div>
        </div>
      </section>

      <section class="panel hard-mode-panel"><header class="panel-header"><div><span class="panel-title">硬额度上线条件</span><span class="panel-subtitle">全部验收后才允许开启阻断模式</span></div><span class="hard-mode-off">服务端已关闭</span></header><div class="hard-requirements"><article v-for="item in limits.hardMode.requirements" :key="item.label"><span><IconClock :size="16" /></span><div><strong>{{ item.label }}</strong><small>{{ item.detail }}</small></div><em>待验证</em></article></div><footer><IconCheck :size="16" />月度软目标可在本地 SQLite 调整；硬额度和临时额度申请仍需并发、审批与自动到期能力。</footer></section>
    </template>
    <footer class="page-footer">数据来源：{{ limits?.meta.source.toUpperCase() ?? '等待数据' }} · 月度软目标可调整（本地 SQLite）· 硬额度与临时申请仍未开放</footer>

    <div v-if="showAdjust && selected && month" class="drawer-backdrop" @click.self="closeAdjust">
      <aside class="create-key-dialog quota-adjust-dialog" role="dialog" aria-modal="true" aria-label="调整月度软目标">
        <header><div><span class="source-tag demo">SQLITE</span><h2>{{ adjustResult ? '月度软目标已更新' : '调整月度软目标' }}</h2></div><button class="icon-button" aria-label="关闭调整月度软目标" :disabled="isAdjusting" @click="closeAdjust"><IconX :size="20" /></button></header>
        <template v-if="adjustResult"><section class="created-key-success"><IconCheck :size="22" /><strong>{{ selected.name }} 的月度软目标已更新</strong><p>{{ adjustResult.meta.notice }}</p><small>{{ adjustResult.impact.previousTargetPoints.toLocaleString('zh-CN') }} 点 → {{ adjustResult.policy.targetPoints.toLocaleString('zh-CN') }} 点 · 预计 {{ adjustResult.impact.projectedPercent }}%</small></section><footer class="create-key-dialog-footer"><a class="btn btn-white" :href="`/audit?eventId=${encodeURIComponent(adjustResult.operation.auditEventId)}&origin=mutation`" :aria-label="`查看 ${adjustResult.operation.auditEventId} 操作审计`"><IconClock :size="16" />查看操作审计</a><button class="btn create-key" @click="closeAdjust">完成</button></footer></template>
        <form v-else class="create-key-form" @submit.prevent="submitAdjust"><p class="create-person-note"><strong>{{ selected.name }}</strong> 的月度软目标将写入本地 SQLite，并在页面提示中立即生效。此操作不启用硬额度、不阻断请求，也不会调用 New API 或修改真实预算。</p><label><span>本月软目标（点）</span><input v-model.number="adjustForm.targetPoints" required min="1" max="1000000" type="number" /></label><div class="quota-adjust-impact"><span>当前已用 + 预留</span><strong>{{ month.used.toLocaleString('zh-CN') }} + {{ month.reserved.toLocaleString('zh-CN') }} 点</strong><span>保存后预计使用率</span><strong :class="`state-${adjustedProjectionState}`">{{ adjustedProjectedPercent }}%</strong></div><p v-if="adjustedProjectedPercent >= 100" class="quota-adjust-warning"><IconAlertTriangle :size="15" />新目标低于当前已用与预留总和；系统只会提示，不会拦截请求。</p><label><span>调整原因 <em>至少 8 个字符</em></span><textarea v-model="adjustForm.reason" required minlength="8" maxlength="200" rows="4" placeholder="例如：本地演示大促活动需要提高月度提示阈值" /></label><label class="access-ack"><input v-model="adjustForm.acknowledgeImpact" type="checkbox" /><span>我已确认：该操作只修改本地演示月度软目标，并写入不含原因原文的审计摘要；不会开启硬额度或影响真实预算。</span></label><div v-if="adjustError" class="create-person-error"><IconAlertTriangle :size="16" />{{ adjustError }}</div><footer><button class="btn btn-white" type="button" :disabled="isAdjusting" @click="closeAdjust">取消</button><button class="btn create-key" type="submit" :disabled="isAdjusting || adjustForm.targetPoints < 1 || adjustForm.targetPoints > 1000000 || adjustForm.reason.trim().length < 8 || !adjustForm.acknowledgeImpact">{{ isAdjusting ? '保存中…' : '确认更新软目标' }}</button></footer></form>
      </aside>
    </div>
  </div>
</template>
