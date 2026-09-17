<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { IconAlertTriangle, IconBrain, IconChevronRight, IconCircleCheck, IconClock, IconCoin, IconFlask, IconGauge, IconRefresh, IconSearch, IconServer2, IconShieldCheck, IconX } from '@tabler/icons-vue'
import { checkSyntheticChannel, fetchChannels, fetchModels, ModelsApiError, type CatalogSource, type ChannelCheckBody, type ChannelFilters, type ChannelItem, type ChannelsResponse, type ModelFilters, type ModelItem, type ModelsResponse } from '../models-api'
import { useDebouncedSearch } from '../composables/useDebouncedSearch'

const source = ref<CatalogSource>('demo')
const models = ref<ModelsResponse | null>(null)
const channels = ref<ChannelsResponse | null>(null)
const selectedModel = ref<ModelItem | null>(null)
const selectedChannel = ref<ChannelItem | null>(null)
const search = ref('')
const capability = ref<ModelFilters['capability']>('all')
const environment = ref<ModelFilters['environment']>('all')
const status = ref<ModelFilters['status']>('all')
const channelEnvironment = ref<ChannelFilters['environment']>('all')
const channelStatus = ref<ChannelFilters['status']>('all')
const isLoading = ref(false)
const errorMessage = ref('')
const showChannelCheck = ref(false)
const isCheckingChannel = ref(false)
const channelCheckError = ref('')
const channelCheckResult = ref('')
const channelCheckForm = ref<ChannelCheckBody>({ idempotencyKey: '', reason: '', acknowledgeSynthetic: true })
const drawerClose = ref<HTMLButtonElement | null>(null)
let previousFocus: HTMLElement | null = null
let request: AbortController | null = null

const isLive = computed(() => source.value === 'new_api')
const sourceLabel = computed(() => isLive.value ? 'New API · 只读配置' : '模拟数据')
const updatedAt = computed(() => models.value ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(models.value.meta.generatedAt)) : '等待数据')
const summaryCards = computed(() => [
  { label: '模型目录', value: models.value?.summary.total ?? '—', hint: isLive.value ? '模型元数据与渠道模型合并去重' : '示例能力与用途', icon: IconBrain, tone: 'teal' },
  { label: '可用模型', value: isLive.value ? '未验证' : models.value?.summary.available ?? '—', hint: isLive.value ? '配置记录不代表实际调用可用' : '模拟可用状态', icon: IconCircleCheck, tone: 'green' },
  { label: isLive.value ? '渠道配置' : '健康渠道', value: channels.value ? (isLive.value ? channels.value.summary.total : channels.value.summary.healthy + '/' + channels.value.summary.total) : '—', hint: isLive.value ? '调用健康指标尚未接入' : '模拟健康快照', icon: IconServer2, tone: 'blue' },
  { label: isLive.value ? '停用渠道' : '降级项', value: models.value && channels.value ? (isLive.value ? channels.value.summary.offline : models.value.summary.degraded + channels.value.summary.degraded) : '—', hint: isLive.value ? '手动或自动停用的配置' : '模拟延迟或余额异常', icon: IconAlertTriangle, tone: 'amber' },
])
const capabilityText = { text: '文本', reasoning: '推理', translation: '翻译', vision: '视觉', batch: '批处理' }
const environmentText = { production: '正式', experiment: '实验', unassigned: '未归类' }
const modelStatusText = { available: '可用', degraded: '降级', unavailable: '不可用', unverified: '待验证' }
const channelStatusText = { healthy: '健康', degraded: '降级', offline: '停用 / 离线', unverified: '待验证' }
const balanceText = { sufficient: '充足', low: '偏低', unknown: '未提供' }
const errorText = { rate_limit: '限流', timeout: '超时', authentication: '认证', server: '服务端' }
const numberText = (value: number | null) => value === null ? '未提供' : value.toLocaleString('zh-CN')
const contextText = (value: number | null) => value === null ? '未提供' : Math.round(value / 1000) + 'K'
const latencyText = (value: number | null) => value === null ? '未提供' : value >= 1_000 ? (value / 1_000).toFixed(1) + 's' : value + 'ms'
const rateText = (value: number | null) => value === null ? '未提供' : value + '%'
const timeText = (value: string | null) => value === null ? '未检测' : new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))

function resetFilters() {
  search.value = ''; capability.value = 'all'; environment.value = 'all'; status.value = 'all'
  channelEnvironment.value = 'all'; channelStatus.value = 'all'
}
function applyFilters() { cancelSearch(); void loadData() }
function clearFilters() { resetFilters(); applyFilters() }
function changeSource(value: CatalogSource) { if (value !== source.value) { source.value = value; resetFilters(); applyFilters() } }
function closeDrawer() { selectedModel.value = null; selectedChannel.value = null; previousFocus?.focus(); previousFocus = null }
function openChannelCheck() {
  if (!selectedChannel.value || isLive.value) return
  channelCheckForm.value = { idempotencyKey: `channel-check-${crypto.randomUUID()}`, reason: '', acknowledgeSynthetic: true }
  channelCheckError.value = ''
  showChannelCheck.value = true
}
async function saveChannelCheck() {
  if (!selectedChannel.value || isLive.value) return
  channelCheckError.value = ''
  isCheckingChannel.value = true
  try {
    const result = await checkSyntheticChannel(selectedChannel.value.id, channelCheckForm.value)
    selectedChannel.value = result.channel
    if (channels.value) channels.value = { ...channels.value, items: channels.value.items.map((item) => item.id === result.channel.id ? result.channel : item) }
    channelCheckResult.value = result.operation.idempotent ? '此模拟复检已完成，快照保持不变。' : '本地模拟复检已完成；未探测真实渠道或调用 New API。'
    showChannelCheck.value = false
  } catch (error) {
    const requestId = error instanceof ModelsApiError ? error.requestId : undefined
    channelCheckError.value = `${error instanceof Error ? error.message : '本地模拟复检失败'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally { isCheckingChannel.value = false }
}
async function openDetail(item: ModelItem | ChannelItem, kind: 'model' | 'channel') {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  selectedModel.value = kind === 'model' ? item as ModelItem : null
  selectedChannel.value = kind === 'channel' ? item as ChannelItem : null
  channelCheckResult.value = ''
  await nextTick(); drawerClose.value?.focus()
}
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const focusable = (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, select, [tabindex="0"]')
  const first = focusable[0]; const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}

async function loadData() {
  request?.abort()
  const next = new AbortController(); request = next
  closeDrawer(); models.value = null; channels.value = null
  isLoading.value = true; errorMessage.value = ''
  const requestedSource = source.value
  try {
    const [nextModels, nextChannels] = await Promise.all([
      fetchModels({ source: requestedSource, search: search.value.trim(), capability: capability.value, environment: environment.value, status: status.value }, next.signal),
      fetchChannels({ source: requestedSource, environment: channelEnvironment.value, status: channelStatus.value }, next.signal),
    ])
    if (next.signal.aborted || request !== next) return
    if (nextModels.meta.source !== requestedSource || nextChannels.meta.source !== requestedSource) throw new ModelsApiError('数据来源与当前选择不一致，请重试。')
    models.value = nextModels; channels.value = nextChannels
  } catch (error) {
    if (next.signal.aborted || request !== next) return
    const requestId = error instanceof ModelsApiError ? error.requestId : undefined
    errorMessage.value = (error instanceof ModelsApiError ? error.message : '连接失败，请确认后台服务已启动后重试。') + (requestId ? ' · 请求 ID ' + requestId : '')
  } finally { if (request === next) isLoading.value = false }
}
const { cancel: cancelSearch } = useDebouncedSearch(search, () => void loadData())
onMounted(() => void loadData())
onBeforeUnmount(() => request?.abort())
</script>

<template>
  <div class="dashboard models-dashboard">
    <section class="page-heading">
      <div><h1>模型与渠道</h1><p>查看模型目录、用途关联与渠道状态。</p></div>
      <div class="heading-actions"><span class="updated-at">更新于 {{ updatedAt }}</span><button class="btn btn-white refresh-button" :disabled="isLoading" @click="applyFilters"><IconRefresh :size="17" :class="{ spinning: isLoading }" />刷新</button><button class="btn" :disabled="isLive || !selectedChannel" :title="isLive ? 'New API 目录保持只读' : selectedChannel ? '更新本地模拟健康快照' : '请先打开一条模拟渠道详情'" @click="openChannelCheck"><IconGauge :size="16" />模拟复检</button></div>
    </section>
    <section class="catalog-source-control panel" aria-label="数据来源">
      <div><strong>数据来源</strong><p>{{ isLive ? '只读取 New API 已保存的配置，空列表表示尚未配置。仅管理员可查看。' : '供开发和功能演示使用，无需真实上游账号或调用流量。' }}</p></div>
      <div class="catalog-source-buttons"><button :aria-pressed="!isLive" @click="changeSource('demo')">模拟数据</button><button :aria-pressed="isLive" @click="changeSource('new_api')">New API 数据</button></div>
    </section>
    <div v-if="models" class="source-banner"><span>{{ sourceLabel }}</span>{{ models.meta.notice }}</div>
    <section class="model-summary-grid" aria-label="模型渠道摘要"><article v-for="card in summaryCards" :key="card.label" class="metric-card"><div class="metric-top"><span class="metric-label">{{ card.label }}</span><span class="metric-icon" :class="'tone-' + card.tone"><component :is="card.icon" :size="19" /></span></div><strong class="metric-value">{{ card.value }}</strong><div class="metric-foot">{{ card.hint }}</div></article></section>

    <div v-if="isLoading" class="panel data-state" role="status"><div class="state-icon"><IconRefresh :size="22" class="spinning" /></div><div><strong>正在读取{{ sourceLabel }}</strong><p>正在加载模型目录与渠道列表…</p></div></div>
    <div v-else-if="errorMessage" class="panel data-state failed" role="alert"><div class="state-icon"><IconAlertTriangle :size="22" /></div><div><strong>模型与渠道加载失败</strong><p>{{ errorMessage }}</p></div><button class="btn btn-white" @click="loadData">重试</button><button v-if="isLive" class="text-button" @click="changeSource('demo')">查看模拟数据</button></div>

    <template v-else-if="models && channels">
      <section class="panel models-main-panel">
        <header class="panel-header"><div><span class="panel-title">模型目录</span><span class="panel-subtitle">{{ isLive ? '配置与调用可用性分别展示；缺少的字段不会填入估计值' : '价格、能力与用途均为示例，不用于实际结算' }}</span></div><span class="source-tag" :class="isLive ? 'live' : 'demo'">{{ sourceLabel }}</span></header>
        <form class="model-filters" @submit.prevent="applyFilters">
          <label class="model-search"><IconSearch :size="16" /><input v-model="search" aria-label="搜索模型" maxlength="60" type="search" placeholder="搜索模型、别名或用途" /></label>
          <label><select v-model="capability" aria-label="模型能力" @change="applyFilters"><option value="all">全部能力</option><option v-for="item in models.options.capabilities" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
          <label><select v-model="environment" aria-label="模型环境" @change="applyFilters"><option value="all">全部环境</option><option v-for="(label, value) in environmentText" :key="value" :value="value">{{ label }}</option></select></label>
          <label><select v-model="status" aria-label="模型状态" @change="applyFilters"><option value="all">全部状态</option><option v-for="(label, value) in modelStatusText" :key="value" :value="value">{{ label }}</option></select></label>
          <button class="btn filter-submit" type="submit">查询</button><button class="text-button" type="button" @click="clearFilters">清除</button>
        </form>
        <div v-if="models.items.length" class="table-responsive"><table class="data-table models-table"><thead><tr><th>模型</th><th>环境</th><th>能力</th><th>上下文</th><th>输入 / 输出价格</th><th>业务别名与用途</th><th>区域</th><th>状态</th><th><span class="catalog-sr-only">详情</span></th></tr></thead><tbody>
          <tr v-for="item in models.items" :key="item.id">
            <td><div class="model-identity"><span :class="{ experiment: item.environment === 'experiment' }"><IconFlask v-if="item.environment === 'experiment'" :size="17" /><IconBrain v-else :size="17" /></span><div><strong>{{ item.displayName }}</strong><small>{{ item.actualModel }} · {{ item.provider }}</small></div></div></td>
            <td><span class="environment-tag" :class="item.environment">{{ environmentText[item.environment] }}</span></td>
            <td><div class="capability-tags"><span v-for="entry in item.capabilities" :key="entry">{{ capabilityText[entry] }}</span><small v-if="!item.capabilities.length">未提供</small></div></td>
            <td><strong class="context-value">{{ contextText(item.contextWindow) }}</strong></td>
            <td><div v-if="item.pricing" class="price-cell"><strong>${{ item.pricing.inputPerMillion }} / ${{ item.pricing.outputPerMillion }}</strong><small>{{ item.pricing.basis === 'official' ? '示例价格 · 每百万 Token' : '模拟估算 · 不作账单' }}</small></div><span v-else>未提供</span></td>
            <td><div class="model-purpose-list"><span v-for="purpose in item.purposes.slice(0, 2)" :key="purpose.alias"><code>{{ purpose.alias }}</code><em :class="purpose.role">{{ purpose.role === 'primary' ? '默认' : '备用' }}</em></span><small v-if="item.purposes.length > 2">另有 {{ item.purposes.length - 2 }} 个用途</small><small v-if="!item.purposes.length">未关联</small></div></td>
            <td>{{ item.region }}</td><td><span class="route-status" :class="'status-' + (item.status === 'available' ? 'healthy' : item.status)"><i />{{ modelStatusText[item.status] }}</span></td><td><button class="row-action enabled" :aria-label="'查看 ' + item.displayName + ' 模型详情'" @click="openDetail(item, 'model')"><IconChevronRight :size="17" /></button></td>
          </tr>
        </tbody></table></div>
        <div v-else class="people-empty"><IconBrain :size="24" /><strong>{{ models.summary.total === 0 ? 'New API 暂无模型配置' : '没有符合条件的模型' }}</strong><span>{{ models.summary.total === 0 ? '接入模型配置后刷新即可查看；现在可以继续使用模拟数据。' : '调整能力、环境、状态或搜索内容。' }}</span><button v-if="models.summary.total > 0" class="text-button" @click="clearFilters">清除筛选</button><button v-else class="text-button" @click="changeSource('demo')">查看模拟数据</button></div>
      </section>

      <section class="panel channel-panel">
        <header class="panel-header"><div><span class="panel-title">{{ isLive ? '渠道配置' : '渠道健康矩阵' }}</span><span class="panel-subtitle">{{ isLive ? channels.meta.healthCacheSeconds + ' 秒配置缓存 · 调用健康尚未验证' : '模拟健康指标与错误摘要' }}</span></div><span class="channel-count">{{ channels.total }} 个结果 / {{ channels.summary.total }} 个渠道</span></header>
        <div class="model-filters"><label><select v-model="channelEnvironment" aria-label="渠道环境" @change="applyFilters"><option value="all">全部环境</option><option v-for="(label, value) in environmentText" :key="value" :value="value">{{ label }}</option></select></label><label><select v-model="channelStatus" aria-label="渠道状态" @change="applyFilters"><option value="all">全部状态</option><option v-for="(label, value) in channelStatusText" :key="value" :value="value">{{ label }}</option></select></label></div>
        <div v-if="channels.items.length" class="channel-card-grid"><button v-for="item in channels.items" :key="item.id" :aria-label="'查看 ' + item.name + ' 渠道详情'" @click="openDetail(item, 'channel')"><div class="channel-card-head"><span class="channel-health-dot" :class="'status-' + item.status" /><div><strong>{{ item.name }}</strong><small>{{ item.provider }} · {{ channelStatusText[item.status] }}</small></div><span class="environment-tag" :class="item.environment">{{ environmentText[item.environment] }}</span></div><div class="channel-metrics"><span><small>成功率</small><strong>{{ rateText(item.successRate) }}</strong></span><span><small>P95 延迟</small><strong>{{ latencyText(item.latencyMs) }}</strong></span><span><small>余额</small><strong :class="'balance-' + item.balanceState">{{ balanceText[item.balanceState] }}</strong></span></div><div class="channel-card-foot"><span v-if="item.recentError" class="channel-error"><IconAlertTriangle :size="13" />{{ errorText[item.recentError.category] }} · {{ item.recentError.summary }}</span><span v-else :class="isLive ? 'catalog-unknown' : 'channel-ok'">{{ isLive ? '尚未接入调用健康数据' : '模拟检查无异常' }}</span><IconChevronRight :size="15" /></div></button></div>
        <div v-else class="people-empty"><IconServer2 :size="24" /><strong>{{ channels.summary.total === 0 ? 'New API 暂无渠道配置' : '没有符合条件的渠道' }}</strong><span>{{ channels.summary.total === 0 ? '当前未配置上游渠道，可先使用模拟数据完成开发与验收。' : '调整渠道环境或状态后重试。' }}</span><button v-if="channels.summary.total > 0" class="text-button" @click="clearFilters">清除筛选</button></div>
      </section>
      <footer class="page-footer">数据来源：{{ sourceLabel }} · {{ isLive ? '真实探测和配置修改尚未开放' : '可更新本地模拟复检快照；不探测真实渠道' }}</footer>
    </template>

    <div v-if="selectedModel || selectedChannel" class="drawer-backdrop" @click.self="closeDrawer" @keydown.esc="closeDrawer"><aside class="model-drawer" role="dialog" aria-modal="true" :aria-label="selectedModel ? '模型详情' : '渠道详情'" @keydown="trapFocus">
      <header><div><span class="source-tag" :class="isLive ? 'live' : 'demo'">{{ sourceLabel }}</span><h2>{{ selectedModel ? '模型详情' : '渠道详情' }}</h2></div><button ref="drawerClose" class="icon-button" aria-label="关闭详情" @click="closeDrawer"><IconX :size="20" /></button></header>
      <template v-if="selectedModel">
        <section class="model-drawer-hero"><span><IconBrain :size="22" /></span><div><strong>{{ selectedModel.displayName }}</strong><code>{{ selectedModel.actualModel }}</code><small>{{ selectedModel.provider }} · {{ selectedModel.region }}</small></div><span class="environment-tag" :class="selectedModel.environment">{{ environmentText[selectedModel.environment] }}</span></section>
        <section class="drawer-section"><h3>能力与上下文</h3><div class="capability-tags"><span v-for="entry in selectedModel.capabilities" :key="entry">{{ capabilityText[entry] }}</span><small v-if="!selectedModel.capabilities.length">上游尚未提供能力信息</small></div><dl class="model-facts"><div><dt>上下文窗口</dt><dd>{{ numberText(selectedModel.contextWindow) }}{{ selectedModel.contextWindow === null ? '' : ' Token' }}</dd></div><div><dt>关联渠道</dt><dd>{{ selectedModel.channelIds.length }} 个</dd></div><div><dt>模型状态</dt><dd>{{ modelStatusText[selectedModel.status] }}</dd></div><div><dt>价格口径</dt><dd>{{ selectedModel.pricing ? '模拟价格' : '未提供' }}</dd></div></dl></section>
        <section class="drawer-section"><h3>输入 / 输出价格</h3><div v-if="selectedModel.pricing" class="price-detail"><span><IconCoin :size="18" /><small>输入</small><strong>${{ selectedModel.pricing.inputPerMillion }}</strong><em>每百万 Token</em></span><span><IconCoin :size="18" /><small>输出</small><strong>${{ selectedModel.pricing.outputPerMillion }}</strong><em>每百万 Token</em></span></div><p class="price-note">{{ selectedModel.pricing ? '价格用于功能演示，不代表实际报价或账单。' : '价格数据尚未接入；未提供不表示免费。' }}</p></section>
        <section class="drawer-section"><h3>业务别名关联</h3><div class="purpose-route-list"><article v-for="purpose in selectedModel.purposes" :key="purpose.alias"><div><strong>{{ purpose.name }}</strong><code>{{ purpose.alias }}</code></div><span :class="purpose.role">{{ purpose.role === 'primary' ? '默认模型' : '备用模型' }}</span></article><p v-if="!selectedModel.purposes.length" class="price-note">尚未关联平台业务用途。</p></div></section>
      </template>
      <template v-else-if="selectedChannel">
        <section class="model-drawer-hero channel"><span><IconServer2 :size="22" /></span><div><strong>{{ selectedChannel.name }}</strong><small>{{ selectedChannel.provider }} · {{ environmentText[selectedChannel.environment] }}</small></div><span class="route-status" :class="'status-' + selectedChannel.status"><i />{{ channelStatusText[selectedChannel.status] }}</span></section>
        <section class="channel-detail-metrics"><article><small>成功率</small><strong>{{ rateText(selectedChannel.successRate) }}</strong></article><article><small>P95 延迟</small><strong>{{ latencyText(selectedChannel.latencyMs) }}</strong></article><article><small>余额状态</small><strong>{{ balanceText[selectedChannel.balanceState] }}</strong></article></section>
        <section class="drawer-section"><h3>限流与检查</h3><dl class="model-facts"><div><dt>RPM</dt><dd>{{ numberText(selectedChannel.rateLimits.rpm) }}</dd></div><div><dt>TPM</dt><dd>{{ numberText(selectedChannel.rateLimits.tpm) }}</dd></div><div><dt>凭据状态</dt><dd>{{ selectedChannel.credentialConfigured === null ? '未提供' : selectedChannel.credentialConfigured ? '已配置' : '未配置' }}</dd></div><div><dt>最近检查</dt><dd>{{ timeText(selectedChannel.checkedAt) }}</dd></div><div><dt>关联模型</dt><dd>{{ selectedChannel.modelIds.length }} 个</dd></div></dl></section>
        <section class="drawer-section"><h3>最近错误</h3><div v-if="selectedChannel.recentError" class="channel-error-detail"><IconAlertTriangle :size="18" /><div><strong>{{ errorText[selectedChannel.recentError.category] }}</strong><p>{{ selectedChannel.recentError.summary }}</p><small>{{ timeText(selectedChannel.recentError.occurredAt) }}</small></div></div><p v-else class="price-note">{{ isLive ? '调用错误数据尚未接入，暂无检查结论。' : '模拟检查未发现异常。' }}</p></section>
        <section class="safe-probe-note"><IconShieldCheck :size="18" /><span><strong>{{ isLive ? '只读详情' : '本地模拟边界' }}</strong>{{ isLive ? '仅展示配置摘要和已验证字段，管理凭据不会出现在页面中。' : '复检只会更新本地 SQLite 模拟快照，不会访问渠道、使用凭据或变更配置。' }}</span></section>
        <p v-if="channelCheckResult" class="channel-check-success">{{ channelCheckResult }}</p>
      </template>
      <footer class="drawer-actions"><button class="btn btn-white" disabled title="完整复检历史暂未开放；可在审计日志中按“模型渠道”筛选"><IconClock :size="16" />审计日志</button><button class="btn" :disabled="isLive || !selectedChannel" :title="isLive ? 'New API 目录保持只读' : '更新本地模拟健康快照'" @click="openChannelCheck"><IconRefresh :size="16" />模拟复检</button></footer>
    </aside></div>

    <div v-if="showChannelCheck && selectedChannel" class="drawer-backdrop" @click.self="showChannelCheck = false"><aside class="model-drawer channel-check-dialog" role="dialog" aria-modal="true" aria-label="本地模拟渠道复检"><header><div><span class="source-tag demo">本地模拟</span><h2>模拟渠道复检</h2></div><button class="icon-button" aria-label="关闭模拟复检" :disabled="isCheckingChannel" @click="showChannelCheck = false"><IconX :size="20" /></button></header>
      <form class="channel-check-form" @submit.prevent="saveChannelCheck"><div class="channel-check-heading"><strong>{{ selectedChannel.name }}</strong><span>{{ selectedChannel.provider }} · {{ environmentText[selectedChannel.environment] }}</span><p>将刷新 SQLite 中的合成健康快照；不会对任何上游发起请求。</p></div>
        <label><span>复检说明（只校验长度，不保存原文）</span><textarea v-model.trim="channelCheckForm.reason" required maxlength="200" placeholder="例如：确认本地演示渠道健康状态展示"></textarea></label>
        <label class="channel-check-ack"><input v-model="channelCheckForm.acknowledgeSynthetic" type="checkbox" /><span>我确认：这是本地模拟复检，不调用 New API、不访问真实渠道，也不修改渠道配置。</span></label>
        <p v-if="channelCheckError" class="channel-check-error">{{ channelCheckError }}</p>
        <footer><button class="btn btn-white" type="button" :disabled="isCheckingChannel" @click="showChannelCheck = false">取消</button><button class="btn" type="submit" :disabled="isCheckingChannel || !channelCheckForm.acknowledgeSynthetic"><IconGauge :size="16" />{{ isCheckingChannel ? '复检中…' : '更新本地快照' }}</button></footer>
      </form>
    </aside></div>
  </div>
</template>

<style scoped>
.panel-header > div { display: grid; gap: 5px; min-width: 0; }
.panel-title { font-size: 15px; font-weight: 600; color: var(--navy); }
.panel-subtitle { font-size: 13px; line-height: 1.6; color: var(--muted); }
.table-responsive { position: relative; }
.model-filters { flex-wrap: wrap; }
.model-filters .model-search { min-width: 0; }
.catalog-source-control { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 16px 18px; margin-bottom: 16px; }
.catalog-source-control strong { font-size: 15px; color: var(--navy); }
.catalog-source-control p { margin: 5px 0 0; font-size: 13px; line-height: 1.6; color: var(--muted); }
.catalog-source-buttons { display: flex; flex-shrink: 0; padding: 3px; border: 1px solid var(--line); border-radius: 8px; background: #f6f8fb; }
.catalog-source-buttons button { padding: 9px 14px; border: 0; border-radius: 5px; background: transparent; color: #52616e; font-size: 14px; }
.catalog-source-buttons button[aria-pressed="true"] { color: white; background: var(--brand); }
.catalog-source-buttons button:focus-visible, .model-filters select:focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; }
.environment-tag.unassigned, .route-status.status-unverified { color: #667480; background: #edf1f4; }
.route-status.status-unavailable, .route-status.status-offline { color: #a33232; background: #fae8e8; }
.channel-health-dot.status-unverified { background: #83909b; box-shadow: none; }
.channel-health-dot.status-offline { background: var(--danger); }
.catalog-unknown { color: var(--muted); }
.catalog-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.model-drawer-hero strong, .model-drawer-hero code { overflow-wrap: anywhere; }
.channel-check-success { margin: 0 18px 13px; padding: 9px 10px; border: 1px solid #b9dfc0; border-radius: 6px; color: #2f6240; background: #f1faf2; font-size: 12px; line-height: 1.5; }.channel-check-dialog { width: min(500px, 100vw); }.channel-check-form { display: grid; gap: 15px; padding: 18px; }.channel-check-heading { display: grid; gap: 4px; padding: 12px; border: 1px solid #cfe2e4; border-radius: 7px; color: #526a73; background: #f2f9f9; }.channel-check-heading strong { color: #36545e; font-size: 14px; }.channel-check-heading span { font-size: 12px; }.channel-check-heading p { margin: 2px 0 0; font-size: 12px; line-height: 1.55; }.channel-check-form label { display: grid; gap: 7px; }.channel-check-form label > span { color: #687b86; font-size: 12px; font-weight: 650; }.channel-check-form textarea { width: 100%; min-height: 78px; padding: 10px; resize: vertical; border: 1px solid #d8e1e5; border-radius: 6px; outline: 0; color: #344754; background: #fff; font: 13px/1.5 inherit; }.channel-check-form textarea:focus { border-color: #19808a; box-shadow: 0 0 0 2px rgba(25,128,138,.08); }.channel-check-ack { display: flex !important; grid-template-columns: 16px minmax(0, 1fr); align-items: flex-start; gap: 8px !important; color: #536873; font-size: 12px; line-height: 1.5; }.channel-check-ack input { margin: 2px 0 0; accent-color: var(--brand); }.channel-check-error { margin: -3px 0 0; padding: 9px 10px; border-radius: 6px; color: #a33232; background: #fff1f1; font-size: 12px; line-height: 1.5; }.channel-check-form footer { display: flex; justify-content: flex-end; gap: 8px; padding-top: 14px; border-top: 1px solid var(--line); }
@media (max-width: 850px) { .catalog-source-control { align-items: flex-start; flex-direction: column; } }
@media (max-width: 480px) { .catalog-source-buttons { width: 100%; } .catalog-source-buttons button { flex: 1; } }
</style>
