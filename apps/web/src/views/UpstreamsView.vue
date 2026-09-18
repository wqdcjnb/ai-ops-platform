<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  IconAlertTriangle, IconBan, IconChevronRight, IconCircleCheck, IconClock, IconFilter,
  IconFlask, IconKey, IconLock, IconRefresh, IconSearch, IconServer2, IconShieldCheck, IconX,
} from '@tabler/icons-vue'
import { useRouter } from 'vue-router'
import { checkUpstream, fetchUpstreamHistory, fetchUpstreams, UpstreamsApiError, type UpstreamCheckResponse, type UpstreamFilters, type UpstreamHistoryResponse, type UpstreamItem, type UpstreamsResponse } from '../upstreams-api'
import { useDebouncedSearch } from '../composables/useDebouncedSearch'

const router = useRouter()
const upstreams = ref<UpstreamsResponse | null>(null)
const selected = ref<UpstreamItem | null>(null)
const search = ref('')
const type = ref<UpstreamFilters['type']>('all')
const status = ref<UpstreamFilters['status']>('all')
const isLoading = ref(false)
const errorMessage = ref('')
const showCheck = ref(false)
const isChecking = ref(false)
const checkError = ref('')
const checkResult = ref<UpstreamCheckResponse | null>(null)
const checkForm = ref({ reason: '', acknowledgeSynthetic: false })
const showHistory = ref(false)
const isHistoryLoading = ref(false)
const historyError = ref('')
const history = ref<UpstreamHistoryResponse | null>(null)
let request: AbortController | undefined

const statusText = { healthy: '健康', degraded: '需关注', auth_required: '认证异常', offline: '离线', unconfigured: '未配置' }
const validationText = { verified: '验证通过', failed: '验证失败', not_checked: '未验证' }
const errorText = { authentication: '认证', rate_limit: '限流', timeout: '超时', balance: '余额', server: '服务端', connection: '连接' }
const liveText = { healthy: '已认证', reachable: '可达', auth_required: '认证异常', offline: '离线' }

const updatedAt = computed(() => upstreams.value ? timeText(upstreams.value.meta.generatedAt) : '—')
const summaryCards = computed(() => {
  const value = upstreams.value?.summary
  return [
    { label: '上游账号', value: value?.total ?? '—', hint: `${value?.official ?? 0} 正式 · ${value?.experiment ?? 0} 实验`, icon: IconServer2, tone: 'teal' },
    { label: '当前健康', value: value?.available ?? '—', hint: '可继续承载请求', icon: IconCircleCheck, tone: 'green' },
    { label: '需要关注', value: value?.needsAttention ?? '—', hint: '余额、认证或配置', icon: IconAlertTriangle, tone: 'amber' },
    { label: '凭据已配置', value: value ? `${value.configured}/${value.total}` : '—', hint: '仅展示配置状态', icon: IconKey, tone: 'blue' },
  ]
})

function filters(): UpstreamFilters { return { search: search.value.trim(), type: type.value, status: status.value } }
function applyFilters() { cancelSearch(); void loadData() }
function clearFilters() { search.value = ''; type.value = 'all'; status.value = 'all'; applyFilters() }
function timeText(value: string) { return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) }
function dateText(value: string | null | undefined) { return value ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '上游未提供' }
function latencyText(value: number | null) { return value === null ? '—' : value >= 1_000 ? `${(value / 1_000).toFixed(1)}s` : `${value}ms` }
function percentTone(value: number) { return value >= 90 ? 'danger' : value >= 75 ? 'warning' : 'healthy' }
function openDetail(item: UpstreamItem) { selected.value = item }
function canViewRelatedAlerts(item: UpstreamItem) { return item.status !== 'unconfigured' && Boolean(item.recentError) }
function viewRelatedAlerts(item: UpstreamItem) {
  selected.value = null
  void router.push({ path: '/alerts', query: { subjectId: item.id } })
}

function newCheckIdempotencyKey() { return `upstream-check-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}` }
function openCheck() {
  if (!selected.value?.credentialConfigured) return
  checkError.value = ''
  checkResult.value = null
  checkForm.value = { reason: '', acknowledgeSynthetic: false }
  showCheck.value = true
}
function closeCheck() {
  if (isChecking.value) return
  showCheck.value = false
  checkResult.value = null
}
async function submitCheck() {
  if (!selected.value || !checkForm.value.acknowledgeSynthetic || checkForm.value.reason.trim().length < 8) return
  isChecking.value = true
  checkError.value = ''
  try {
    const result = await checkUpstream(selected.value.id, { idempotencyKey: newCheckIdempotencyKey(), reason: checkForm.value.reason, acknowledgeSynthetic: true })
    checkResult.value = result
    selected.value = result.upstream
    await loadData()
  } catch (error) {
    checkError.value = `${error instanceof Error ? error.message : '验证上游账号失败'}${error instanceof UpstreamsApiError && error.requestId ? ` · 请求 ID ${error.requestId}` : ''}`
  } finally { isChecking.value = false }
}
async function openHistory() {
  if (!selected.value) return
  showHistory.value = true
  isHistoryLoading.value = true
  historyError.value = ''
  history.value = null
  try { history.value = await fetchUpstreamHistory(selected.value.id) }
  catch (error) { historyError.value = `${error instanceof Error ? error.message : '上游认证历史暂时无法加载'}${error instanceof UpstreamsApiError && error.requestId ? ` · 请求 ID ${error.requestId}` : ''}` }
  finally { isHistoryLoading.value = false }
}
function closeHistory() {
  if (isHistoryLoading.value) return
  showHistory.value = false
}

async function loadData() {
  request?.abort()
  const next = new AbortController()
  request = next
  isLoading.value = true
  errorMessage.value = ''
  try { upstreams.value = await fetchUpstreams(filters(), next.signal) }
  catch (error) {
    if (next.signal.aborted) return
    const requestId = error instanceof UpstreamsApiError ? error.requestId : undefined
    errorMessage.value = `${error instanceof Error ? error.message : '上游账号暂时无法加载'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally { if (request === next) isLoading.value = false }
}

const { cancel: cancelSearch } = useDebouncedSearch(search, () => void loadData())

onMounted(() => void loadData())
onBeforeUnmount(() => request?.abort())
</script>

<template>
  <div class="dashboard upstreams-dashboard">
    <section class="page-heading"><div><div class="eyebrow">UPSTREAM ACCOUNTS</div><h1>上游账号</h1><p>统一查看官方正式容量和 CPA 隔离实验账号的认证、窗口与异常状态。</p></div><div class="heading-actions"><span class="updated-at">更新于 {{ updatedAt }}</span><button class="btn btn-white refresh-button" :disabled="isLoading" @click="loadData"><IconRefresh :size="17" :class="{ spinning: isLoading }" />刷新</button><button class="btn" disabled title="凭据仅通过受保护部署流程配置"><IconKey :size="16" />配置凭据</button></div></section>

    <div v-if="upstreams" class="source-banner"><span>DEMO</span>{{ upstreams.meta.notice }}</div>
    <section v-if="upstreams" class="upstream-live-strip" aria-label="实时服务连通性">
      <article><span class="live-dot" :class="`state-${upstreams.meta.live.newApi}`" /><div><strong>New API</strong><small>实时探测 · {{ liveText[upstreams.meta.live.newApi] }}</small></div><em>LIVE</em></article>
      <article><span class="live-dot" :class="`state-${upstreams.meta.live.cpa}`" /><div><strong>CPA 实验服务</strong><small>实时探测 · {{ liveText[upstreams.meta.live.cpa] }}</small></div><em>LIVE</em></article>
      <p>账号明细仍为 DEMO；连通不等于管理认证与账号配置已经完成。</p>
    </section>
    <section class="model-summary-grid" aria-label="上游账号摘要"><article v-for="card in summaryCards" :key="card.label" class="metric-card"><div class="metric-top"><span class="metric-label">{{ card.label }}</span><span class="metric-icon" :class="`tone-${card.tone}`"><component :is="card.icon" :size="19" /></span></div><strong class="metric-value">{{ card.value }}</strong><div class="metric-foot">{{ card.hint }}</div></article></section>

    <div v-if="!upstreams && !errorMessage" class="panel data-state"><div class="state-icon"><IconRefresh :size="22" class="spinning" /></div><div><strong>正在读取上游账号</strong><p>正在探测服务并加载安全账号摘要…</p></div></div>
    <div v-else-if="errorMessage" class="panel data-state failed"><div class="state-icon"><IconAlertTriangle :size="22" /></div><div><strong>上游账号加载失败</strong><p>{{ errorMessage }}</p></div><button class="btn btn-white" @click="loadData">重试</button></div>

    <template v-else-if="upstreams">
      <section class="route-isolation-banner upstream-isolation"><span><IconLock :size="20" /></span><div><strong>正式账号与实验账号已隔离</strong><p>{{ upstreams.isolation.statement }}</p></div><div class="isolation-groups"><em>OFFICIAL · 正式</em><IconBan :size="15" /><em class="experiment">CPA PRO · 实验</em></div></section>

      <section class="panel upstream-list-panel"><header class="panel-header"><div><span class="panel-title">账号状态清单</span><span class="panel-subtitle">凭据仅显示配置和验证结果，不显示掩码或片段</span></div><span class="source-tag demo">DEMO</span></header>
      <form class="upstream-filters" @submit.prevent="applyFilters"><label class="upstream-search"><IconSearch :size="16" /><input v-model="search" aria-label="搜索上游账号" maxlength="60" type="search" placeholder="搜索账号、供应商或模型" /></label><label><IconServer2 :size="15" /><select v-model="type" @change="applyFilters"><option value="all">全部类型</option><option value="official_api">官方 API</option><option value="cpa_oauth">CPA OAuth</option></select></label><label><IconFilter :size="15" /><select v-model="status" @change="applyFilters"><option value="all">全部状态</option><option value="healthy">健康</option><option value="degraded">需关注</option><option value="auth_required">认证异常</option><option value="offline">离线</option><option value="unconfigured">未配置</option></select></label><button class="btn filter-submit" type="submit">查询</button><button class="text-button" type="button" @click="clearFilters">清除</button></form>

        <div v-if="upstreams.items.length" class="upstream-account-grid">
          <button v-for="item in upstreams.items" :key="item.id" class="upstream-account-card" :class="{ experiment: item.environment === 'experiment' }" :aria-label="`查看 ${item.name} 账号详情`" @click="openDetail(item)">
            <div class="upstream-card-head"><span><IconFlask v-if="item.environment === 'experiment'" :size="19" /><IconServer2 v-else :size="19" /></span><div><strong>{{ item.name }}</strong><small>{{ item.provider }} · {{ item.models.join(' / ') }}</small></div><span class="route-status" :class="`status-${item.status}`"><i />{{ statusText[item.status] }}</span></div>
            <div class="upstream-card-facts"><span><small>凭据</small><strong>{{ item.credentialConfigured ? validationText[item.credentialValidation] : '未配置' }}</strong></span><span><small>{{ item.type === 'official_api' ? '余额' : '5 小时窗口' }}</small><strong>{{ item.type === 'official_api' ? item.balance.label : `${item.windows[0]?.usedPercent ?? 0}% 已用` }}</strong></span><span><small>成功率</small><strong>{{ item.health.successRate === null ? '—' : `${item.health.successRate}%` }}</strong></span><span><small>最近检查</small><strong>{{ timeText(item.health.checkedAt) }}</strong></span></div>
            <div v-if="item.type === 'cpa_oauth'" class="window-preview"><span><i :class="percentTone(item.windows[0]?.usedPercent ?? 0)" :style="{ width: `${item.windows[0]?.usedPercent ?? 0}%` }" /></span><small v-if="item.cooldown?.active">冷却至 {{ timeText(item.cooldown.until!) }}</small><small v-else>当前无冷却</small></div>
            <div class="upstream-card-foot"><span v-if="item.recentError" class="channel-error"><IconAlertTriangle :size="14" />{{ errorText[item.recentError.category] }} · {{ item.recentError.summary }}</span><span v-else class="channel-ok"><IconCircleCheck :size="14" />最近检查无异常</span><IconChevronRight :size="17" /></div>
          </button>
        </div>
        <div v-else class="people-empty"><IconServer2 :size="24" /><strong>没有符合条件的账号</strong><span>调整账号类型、状态或搜索内容。</span><button class="text-button" @click="clearFilters">清除筛选</button></div>
      </section>
      <footer class="page-footer">实时连通性来自本机探测 · 账号明细来自 DEMO · 浏览器永不接触 API Key、OAuth Token 或 CPA 管理密钥</footer>
    </template>

    <div v-if="selected" class="drawer-backdrop" @click.self="selected = null"><aside class="model-drawer upstream-drawer" role="dialog" aria-modal="true" aria-label="上游账号详情"><header><div><span class="source-tag demo">DEMO</span><h2>上游账号详情</h2></div><button class="icon-button" aria-label="关闭详情" @click="selected = null"><IconX :size="20" /></button></header>
      <section class="model-drawer-hero upstream"><span><IconFlask v-if="selected.environment === 'experiment'" :size="22" /><IconServer2 v-else :size="22" /></span><div><strong>{{ selected.name }}</strong><code>{{ selected.provider }}</code><small>{{ selected.type === 'official_api' ? '官方 API 正式账号' : 'CPA Pro OAuth 隔离实验账号' }}</small></div><span class="route-status" :class="`status-${selected.status}`"><i />{{ statusText[selected.status] }}</span></section>
      <section class="channel-detail-metrics"><article><small>成功率</small><strong>{{ selected.health.successRate === null ? '—' : `${selected.health.successRate}%` }}</strong></article><article><small>P95 延迟</small><strong>{{ latencyText(selected.health.latencyMs) }}</strong></article><article><small>余额状态</small><strong :class="`balance-${selected.balance.state}`">{{ selected.balance.label }}</strong></article></section>
      <section class="drawer-section"><h3>凭据与检查</h3><dl class="model-facts"><div><dt>凭据配置</dt><dd>{{ selected.credentialConfigured ? '已配置' : '未配置' }}</dd></div><div><dt>验证结果</dt><dd>{{ validationText[selected.credentialValidation] }}</dd></div><div><dt>最近检查</dt><dd>{{ timeText(selected.health.checkedAt) }}</dd></div><div><dt>可用模型</dt><dd>{{ selected.models.length }} 个</dd></div></dl></section>
      <section v-if="selected.type === 'official_api'" class="drawer-section"><h3>正式容量</h3><dl class="model-facts"><div><dt>RPM</dt><dd>{{ selected.capacity?.rpm.toLocaleString('zh-CN') ?? '等待配置' }}</dd></div><div><dt>TPM</dt><dd>{{ selected.capacity?.tpm.toLocaleString('zh-CN') ?? '等待配置' }}</dd></div><div><dt>余额</dt><dd>{{ selected.balance.label }}</dd></div><div><dt>余额更新</dt><dd>{{ dateText(selected.balance.updatedAt) }}</dd></div></dl></section>
      <section v-else class="drawer-section"><h3>CPA 认证与窗口</h3><dl class="model-facts"><div><dt>认证有效期</dt><dd>{{ dateText(selected.auth?.expiresAt) }}</dd></div><div><dt>最后刷新</dt><dd>{{ dateText(selected.auth?.lastRefreshedAt) }}</dd></div></dl><div class="account-window-list"><article v-for="window in selected.windows" :key="window.id"><div><strong>{{ window.label }}</strong><em>{{ window.usedPercent }}% 已用</em></div><span><i :class="percentTone(window.usedPercent)" :style="{ width: `${window.usedPercent}%` }" /></span><small>{{ timeText(window.resetsAt) }} 重置</small></article></div><div class="cooldown-state" :class="{ active: selected.cooldown?.active }"><IconClock :size="17" /><span><strong>{{ selected.cooldown?.active ? '账号处于冷却' : '当前无冷却' }}</strong><small v-if="selected.cooldown?.active">{{ selected.cooldown.reason }} · {{ timeText(selected.cooldown.until!) }} 结束</small><small v-else>可以承载隔离实验流量</small></span></div></section>
      <section class="drawer-section"><h3>最近错误</h3><div v-if="selected.recentError" class="channel-error-detail"><IconAlertTriangle :size="18" /><div><strong>{{ errorText[selected.recentError.category] }}</strong><p>{{ selected.recentError.summary }}</p><small>首次 {{ timeText(selected.recentError.firstSeenAt) }} · 最近 {{ timeText(selected.recentError.lastSeenAt) }}</small></div></div><button v-if="canViewRelatedAlerts(selected)" class="text-button related-alert-link" type="button" :aria-label="`查看 ${selected.name} 的关联模拟告警`" @click="viewRelatedAlerts(selected)"><IconAlertTriangle :size="15" />查看关联模拟告警</button><div v-else-if="!selected.recentError" class="channel-clear"><IconCircleCheck :size="18" />最近检查未发现异常</div></section>
      <section class="safe-probe-note"><IconShieldCheck :size="18" /><span><strong>凭据安全边界</strong>页面只返回是否配置和验证结果；不返回完整密钥、可识别片段、OAuth Token 或上游响应正文。</span></section>
      <footer class="drawer-actions"><a class="btn btn-white" :href="`/audit?resource=upstream&search=${encodeURIComponent(selected.name)}`"><IconShieldCheck :size="16" />操作审计</a><button class="btn btn-white" :disabled="isHistoryLoading" @click="openHistory"><IconClock :size="16" />认证历史</button><button class="btn" :disabled="!selected.credentialConfigured" :title="selected.credentialConfigured ? '更新本地模拟验证记录' : '尚未配置模拟凭据'" @click="openCheck"><IconRefresh :size="16" />验证连接</button></footer>
    </aside></div>

    <div v-if="showCheck && selected" class="drawer-backdrop" @click.self="closeCheck"><aside class="model-drawer channel-check-dialog" role="dialog" aria-modal="true" aria-label="本地模拟上游验证"><header><div><span class="source-tag demo">本地模拟</span><h2>{{ checkResult ? '验证记录已更新' : '验证上游账号' }}</h2></div><button class="icon-button" aria-label="关闭上游验证" :disabled="isChecking" @click="closeCheck"><IconX :size="20" /></button></header>
      <template v-if="checkResult"><div class="data-state success"><div class="state-icon"><IconCircleCheck :size="22" /></div><div><strong>{{ selected.name }} 已完成本地模拟验证</strong><p>{{ checkResult.meta.notice }}</p></div></div><section class="quota-adjust-impact"><span>验证时间</span><strong>{{ timeText(checkResult.meta.completedAt) }}</strong><span>凭据结果</span><strong>{{ validationText[selected.credentialValidation] }}</strong></section><footer class="drawer-actions"><button class="btn" @click="closeCheck">完成</button></footer></template>
      <form v-else class="create-key-form" @submit.prevent="submitCheck"><p class="create-person-note"><strong>{{ selected.name }}</strong> 的验证只会写入本地 SQLite 模拟记录，用于更新最近检查时间；不会访问真实上游、读取或修改 API Key、OAuth Token 或管理密钥。</p><label><span>验证说明 <em>至少 8 个字符</em></span><textarea v-model="checkForm.reason" required minlength="8" maxlength="200" rows="4" placeholder="例如：确认本地演示账号状态展示与异常提示" /></label><label class="access-ack"><input v-model="checkForm.acknowledgeSynthetic" type="checkbox" /><span>我已确认：这是本地模拟验证，不会触发真实网络探测或修改外部账号。</span></label><div v-if="checkError" class="create-person-error"><IconAlertTriangle :size="16" />{{ checkError }}</div><footer><button class="btn btn-white" type="button" :disabled="isChecking" @click="closeCheck">取消</button><button class="btn" type="submit" :disabled="isChecking || checkForm.reason.trim().length < 8 || !checkForm.acknowledgeSynthetic"><IconRefresh :size="16" />{{ isChecking ? '验证中…' : '更新模拟验证记录' }}</button></footer></form>
    </aside></div>

    <div v-if="showHistory && selected" class="drawer-backdrop" @click.self="closeHistory"><aside class="model-drawer history-dialog" role="dialog" aria-modal="true" aria-label="上游认证历史"><header><div><span class="source-tag demo">SQLITE</span><h2>认证历史</h2></div><button class="icon-button" aria-label="关闭认证历史" :disabled="isHistoryLoading" @click="closeHistory"><IconX :size="20" /></button></header>
      <div v-if="isHistoryLoading" class="data-state"><div class="state-icon"><IconRefresh :size="22" class="spinning" /></div><div><strong>正在读取认证历史</strong><p>仅查询本地 SQLite 审计摘要…</p></div></div>
      <div v-else-if="historyError" class="data-state failed"><div class="state-icon"><IconAlertTriangle :size="22" /></div><div><strong>认证历史加载失败</strong><p>{{ historyError }}</p></div><button class="btn btn-white" @click="openHistory">重试</button></div>
      <template v-else-if="history"><div class="history-heading"><strong>{{ history.upstream.name }}</strong><span>{{ history.meta.notice }}</span></div><div v-if="history.items.length" class="history-list"><article v-for="item in history.items" :key="item.id"><span class="history-dot" :class="item.result"><IconCircleCheck v-if="item.result === 'success'" :size="14" /><IconAlertTriangle v-else :size="14" /></span><div><strong>{{ item.result === 'success' ? '验证通过' : item.result === 'denied' ? '验证被拒绝' : '验证失败' }}</strong><small>{{ timeText(item.checkedAt) }} · {{ item.actorName }}</small><p>{{ item.summary }}</p><code>{{ item.requestId }}</code></div></article></div><div v-else class="people-empty history-empty"><IconClock :size="24" /><strong>暂无本地认证记录</strong><span>完成一次本地模拟验证后，这里会保留时间和审计摘要。</span></div></template>
      <footer class="drawer-actions"><button class="btn" @click="closeHistory">完成</button></footer>
    </aside></div>
  </div>
</template>

<style scoped>
.channel-check-dialog { width: min(500px, 100vw); }
.history-dialog { width: min(520px, 100vw); }
.history-heading { display: grid; gap: 5px; margin: 18px 18px 6px; padding: 12px; border: 1px solid #d9e8e9; border-radius: 7px; background: #f3f9f9; }
.history-heading strong { color: #36535d; font-size: 14px; }
.history-heading span { color: #71818b; font-size: 11px; line-height: 1.5; }
.history-list { display: grid; gap: 0; padding: 8px 18px 18px; overflow: auto; }
.history-list article { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 10px; padding: 14px 0; border-bottom: 1px solid #edf0f3; }
.history-list article:last-child { border-bottom: 0; }
.history-dot { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 50%; color: #2f9e44; background: #eaf7ec; }
.history-dot.failed, .history-dot.denied { color: #b04444; background: #fceded; }
.history-list article > div { display: grid; gap: 4px; min-width: 0; }
.history-list strong { color: #2f4651; font-size: 13px; }
.history-list small { color: #7c8b94; font-size: 11px; }
.history-list p { margin: 2px 0 0; color: #647680; font-size: 11px; line-height: 1.55; }
.history-list code { color: #54727b; font: 10px ui-monospace, SFMono-Regular, Consolas, monospace; }
.history-empty { min-height: 210px; margin: 8px 18px 0; }
.channel-check-dialog .create-key-form textarea { width: 100%; min-height: 82px; resize: vertical; padding: 10px; border: 1px solid var(--line); border-radius: 6px; outline: 0; color: #344754; background: #fff; font: 13px/1.5 inherit; }
.channel-check-dialog .create-key-form textarea:focus { border-color: var(--brand); box-shadow: 0 0 0 2px rgba(20, 108, 112, .08); }
.channel-check-dialog .create-key-form footer { display: flex; justify-content: flex-end; gap: 8px; padding-top: 14px; border-top: 1px solid var(--line); }
.channel-check-dialog .data-state { min-height: 150px; justify-content: flex-start; padding: 22px 18px 10px; }
.channel-check-dialog .data-state.success .state-icon { color: #2f9e44; background: #eef9ef; }
</style>
