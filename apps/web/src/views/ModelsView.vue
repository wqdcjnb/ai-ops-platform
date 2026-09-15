<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  IconAlertTriangle, IconBrain, IconChevronRight, IconCircleCheck, IconClock, IconCoin,
  IconDatabase, IconEye, IconFilter, IconFlask, IconGauge, IconRefresh, IconSearch,
  IconServer2, IconSettings, IconShieldCheck, IconSparkles, IconWorld, IconX,
} from '@tabler/icons-vue'
import { fetchChannels, fetchModels, ModelsApiError, type ChannelItem, type ChannelsResponse, type ModelFilters, type ModelItem, type ModelsResponse } from '../models-api'

const models = ref<ModelsResponse | null>(null)
const channels = ref<ChannelsResponse | null>(null)
const selectedModel = ref<ModelItem | null>(null)
const selectedChannel = ref<ChannelItem | null>(null)
const search = ref('')
const capability = ref<ModelFilters['capability']>('all')
const environment = ref<ModelFilters['environment']>('all')
const status = ref<ModelFilters['status']>('all')
const isLoading = ref(false)
const errorMessage = ref('')
let request: AbortController | null = null

const updatedAt = computed(() => models.value ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(models.value.meta.generatedAt)) : '等待数据')
const summaryCards = computed(() => [
  { label: '模型目录', value: models.value?.summary.total ?? '—', hint: models.value ? `${models.value.summary.production} 正式 · ${models.value.summary.experiment} 实验` : '等待数据', icon: IconBrain, tone: 'teal' },
  { label: '可用模型', value: models.value?.summary.available ?? '—', hint: '可被业务别名引用', icon: IconCircleCheck, tone: 'green' },
  { label: '健康渠道', value: channels.value ? `${channels.value.summary.healthy}/${channels.value.summary.total}` : '—', hint: '30 秒健康快照', icon: IconServer2, tone: 'blue' },
  { label: '降级项', value: (models.value?.summary.degraded ?? 0) + (channels.value?.summary.degraded ?? 0), hint: '需要检查延迟或余额', icon: IconAlertTriangle, tone: 'amber' },
])
const capabilityText = { text: '文本', reasoning: '推理', translation: '翻译', vision: '视觉', batch: '批处理' }
const modelStatusText = { available: '可用', degraded: '降级', unavailable: '不可用' }
const channelStatusText = { healthy: '健康', degraded: '降级', offline: '离线' }
const balanceText = { sufficient: '充足', low: '偏低', unknown: '未知' }
const errorText = { rate_limit: '限流', timeout: '超时', authentication: '认证', server: '服务端' }

function modelFilters(): ModelFilters { return { search: search.value.trim(), capability: capability.value, environment: environment.value, status: status.value } }
function clearFilters() { search.value = ''; capability.value = 'all'; environment.value = 'all'; status.value = 'all'; void loadData() }
function contextText(value: number) { return `${Math.round(value / 1000)}K` }
function latencyText(value: number) { return value >= 1_000 ? `${(value / 1_000).toFixed(1)}s` : `${value}ms` }
function timeText(value: string) { return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) }
function openChannel(item: ChannelItem) { selectedModel.value = null; selectedChannel.value = item }
function openModel(item: ModelItem) { selectedChannel.value = null; selectedModel.value = item }
function closeDrawer() { selectedModel.value = null; selectedChannel.value = null }

async function loadData() {
  request?.abort()
  const next = new AbortController()
  request = next
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [nextModels, nextChannels] = await Promise.all([fetchModels(modelFilters(), next.signal), fetchChannels({ environment: 'all', status: 'all' }, next.signal)])
    models.value = nextModels
    channels.value = nextChannels
  } catch (error) {
    if (next.signal.aborted) return
    const requestId = error instanceof ModelsApiError ? error.requestId : undefined
    errorMessage.value = `${error instanceof Error ? error.message : '模型与渠道暂时无法加载'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally { if (request === next) isLoading.value = false }
}

onMounted(() => void loadData())
onBeforeUnmount(() => request?.abort())
</script>

<template>
  <div class="dashboard models-dashboard">
    <section class="page-heading"><div><div class="eyebrow">MODEL CATALOG &amp; CHANNELS</div><h1>模型与渠道</h1><p>比较模型能力、价格口径和渠道健康，确认每个业务别名的实际能力来源。</p></div><div class="heading-actions"><span class="updated-at">更新于 {{ updatedAt }}</span><button class="btn btn-white refresh-button" :disabled="isLoading" @click="loadData"><IconRefresh :size="17" :class="{ spinning: isLoading }" />刷新</button><button class="btn" disabled title="受限服务端探测完成后开放"><IconGauge :size="16" />重新检测</button></div></section>
    <div v-if="models" class="source-banner"><span>DEMO</span>{{ models.meta.notice }}</div>
    <section class="model-summary-grid" aria-label="模型渠道摘要"><article v-for="card in summaryCards" :key="card.label" class="metric-card"><div class="metric-top"><span class="metric-label">{{ card.label }}</span><span class="metric-icon" :class="`tone-${card.tone}`"><component :is="card.icon" :size="19" /></span></div><strong class="metric-value">{{ card.value }}</strong><div class="metric-foot">{{ card.hint }}</div></article></section>

    <div v-if="!models && !errorMessage" class="panel data-state"><div class="state-icon"><IconRefresh :size="22" class="spinning" /></div><div><strong>正在读取模型与渠道</strong><p>正在加载能力目录、价格口径和健康快照…</p></div></div>
    <div v-else-if="errorMessage" class="panel data-state failed"><div class="state-icon"><IconAlertTriangle :size="22" /></div><div><strong>模型与渠道加载失败</strong><p>{{ errorMessage }}</p></div><button class="btn btn-white" @click="loadData">重试</button></div>

    <template v-else-if="models && channels">
      <section class="panel models-main-panel"><header class="panel-header"><div><span class="panel-title">模型目录</span><span class="panel-subtitle">官方实际价格与 CPA 估算口径分开标识</span></div><span class="source-tag demo">DEMO</span></header>
        <form class="model-filters" @submit.prevent="loadData"><label class="model-search"><IconSearch :size="16" /><input v-model="search" maxlength="60" type="search" placeholder="搜索模型、别名、用途、供应商或区域" /></label><label><IconSparkles :size="15" /><select v-model="capability" @change="loadData"><option value="all">全部能力</option><option v-for="item in models.options.capabilities" :key="item.id" :value="item.id">{{ item.label }}</option></select></label><label><IconFilter :size="15" /><select v-model="environment" @change="loadData"><option value="all">全部环境</option><option value="production">正式</option><option value="experiment">实验</option></select></label><label><IconShieldCheck :size="15" /><select v-model="status" @change="loadData"><option value="all">全部状态</option><option value="available">可用</option><option value="degraded">降级</option><option value="unavailable">不可用</option></select></label><button class="btn filter-submit" type="submit">查询</button><button class="text-button" type="button" @click="clearFilters">清除</button></form>
        <div v-if="models.items.length" class="table-responsive"><table class="data-table models-table"><thead><tr><th>模型</th><th>环境</th><th>能力</th><th>上下文</th><th>输入 / 输出价格</th><th>业务别名与用途</th><th>区域</th><th>状态</th><th /></tr></thead><tbody><tr v-for="item in models.items" :key="item.id"><td><div class="model-identity"><span :class="{ experiment: item.environment === 'experiment' }"><IconFlask v-if="item.environment === 'experiment'" :size="17" /><IconBrain v-else :size="17" /></span><div><strong>{{ item.displayName }}</strong><small>{{ item.actualModel }} · {{ item.provider }}</small></div></div></td><td><span class="environment-tag" :class="item.environment">{{ item.environment === 'production' ? '正式' : '实验' }}</span></td><td><div class="capability-tags"><span v-for="entry in item.capabilities" :key="entry">{{ capabilityText[entry] }}</span></div></td><td><strong class="context-value">{{ contextText(item.contextWindow) }}</strong></td><td><div class="price-cell"><strong>${{ item.pricing.inputPerMillion }} / ${{ item.pricing.outputPerMillion }}</strong><small :class="{ estimated: item.pricing.basis === 'estimated' }">{{ item.pricing.basis === 'official' ? '官方价 · 每百万 Token' : '估算消耗 · 不作账单' }}</small></div></td><td><div class="model-purpose-list"><span v-for="purpose in item.purposes.slice(0, 2)" :key="purpose.alias"><code>{{ purpose.alias }}</code><em :class="purpose.role">{{ purpose.role === 'primary' ? '默认' : '备用' }}</em></span><small v-if="item.purposes.length > 2">另有 {{ item.purposes.length - 2 }} 个用途</small></div></td><td>{{ item.region }}</td><td><span class="route-status" :class="`status-${item.status === 'available' ? 'healthy' : item.status}`"><i />{{ modelStatusText[item.status] }}</span></td><td><button class="row-action enabled" :aria-label="`查看 ${item.displayName} 模型详情`" @click="openModel(item)"><IconChevronRight :size="17" /></button></td></tr></tbody></table></div>
        <div v-else class="people-empty"><IconBrain :size="24" /><strong>没有符合条件的模型</strong><span>调整能力、环境、状态或搜索内容。</span><button class="text-button" @click="clearFilters">清除筛选</button></div>
      </section>

      <section class="panel channel-panel"><header class="panel-header"><div><span class="panel-title">渠道健康矩阵</span><span class="panel-subtitle">{{ channels.meta.healthCacheSeconds }} 秒缓存 · 错误仅显示分类和摘要</span></div><span class="channel-count">{{ channels.summary.healthy }}/{{ channels.summary.total }} 健康</span></header><div class="channel-card-grid"><button v-for="item in channels.items" :key="item.id" @click="openChannel(item)"><div class="channel-card-head"><span class="channel-health-dot" :class="`status-${item.status}`" /><div><strong>{{ item.name }}</strong><small>{{ item.provider }}</small></div><span class="environment-tag" :class="item.environment">{{ item.environment === 'production' ? '正式' : '实验' }}</span></div><div class="channel-metrics"><span><small>成功率</small><strong>{{ item.successRate }}%</strong></span><span><small>P95 延迟</small><strong>{{ latencyText(item.latencyMs) }}</strong></span><span><small>余额</small><strong :class="`balance-${item.balanceState}`">{{ balanceText[item.balanceState] }}</strong></span></div><div class="channel-card-foot"><span v-if="item.recentError" class="channel-error"><IconAlertTriangle :size="13" />{{ errorText[item.recentError.category] }} · {{ item.recentError.summary }}</span><span v-else class="channel-ok"><IconCircleCheck :size="13" />最近检查无异常</span><IconChevronRight :size="15" /></div></button></div></section>
      <footer class="page-footer">数据来源：DEMO · 不返回上游凭据或完整错误响应 · 手动检测和配置修改尚未开放</footer>
    </template>

    <div v-if="selectedModel || selectedChannel" class="drawer-backdrop" @click.self="closeDrawer"><aside class="model-drawer" role="dialog" aria-modal="true" :aria-label="selectedModel ? '模型详情' : '渠道详情'"><header><div><span class="source-tag demo">DEMO</span><h2>{{ selectedModel ? '模型详情' : '渠道详情' }}</h2></div><button class="icon-button" aria-label="关闭详情" @click="closeDrawer"><IconX :size="20" /></button></header>
      <template v-if="selectedModel"><section class="model-drawer-hero"><span><IconBrain :size="22" /></span><div><strong>{{ selectedModel.displayName }}</strong><code>{{ selectedModel.actualModel }}</code><small>{{ selectedModel.provider }} · {{ selectedModel.region }}</small></div><span class="environment-tag" :class="selectedModel.environment">{{ selectedModel.environment === 'production' ? '正式' : '实验' }}</span></section><section class="drawer-section"><h3>能力与上下文</h3><div class="capability-tags"><span v-for="entry in selectedModel.capabilities" :key="entry">{{ capabilityText[entry] }}</span></div><dl class="model-facts"><div><dt>上下文窗口</dt><dd>{{ selectedModel.contextWindow.toLocaleString('zh-CN') }} Token</dd></div><div><dt>关联渠道</dt><dd>{{ selectedModel.channelIds.length }} 个</dd></div><div><dt>模型状态</dt><dd>{{ modelStatusText[selectedModel.status] }}</dd></div><div><dt>价格口径</dt><dd>{{ selectedModel.pricing.basis === 'official' ? '官方实际价格' : '平台估算消耗' }}</dd></div></dl></section><section class="drawer-section"><h3>输入 / 输出价格</h3><div class="price-detail"><span><IconCoin :size="18" /><small>输入</small><strong>${{ selectedModel.pricing.inputPerMillion }}</strong><em>每百万 Token</em></span><span><IconCoin :size="18" /><small>输出</small><strong>${{ selectedModel.pricing.outputPerMillion }}</strong><em>每百万 Token</em></span></div><p class="price-note">{{ selectedModel.pricing.basis === 'official' ? '用于成本估算，最终以供应商账单为准。' : 'CPA 实验消耗不能与官方账单混算，当前仅作内部估算。' }}</p></section><section class="drawer-section"><h3>业务别名关联</h3><div class="purpose-route-list"><article v-for="purpose in selectedModel.purposes" :key="purpose.alias"><div><strong>{{ purpose.name }}</strong><code>{{ purpose.alias }}</code></div><span :class="purpose.role">{{ purpose.role === 'primary' ? '默认模型' : '备用模型' }}</span></article></div></section></template>
      <template v-else-if="selectedChannel"><section class="model-drawer-hero channel"><span><IconServer2 :size="22" /></span><div><strong>{{ selectedChannel.name }}</strong><code>{{ selectedChannel.provider }}</code><small>{{ selectedChannel.type === 'official_api' ? '官方 API 渠道' : 'CPA OAuth 实验渠道' }}</small></div><span class="route-status" :class="`status-${selectedChannel.status}`"><i />{{ channelStatusText[selectedChannel.status] }}</span></section><section class="channel-detail-metrics"><article><small>成功率</small><strong>{{ selectedChannel.successRate }}%</strong></article><article><small>P95 延迟</small><strong>{{ latencyText(selectedChannel.latencyMs) }}</strong></article><article><small>余额状态</small><strong :class="`balance-${selectedChannel.balanceState}`">{{ balanceText[selectedChannel.balanceState] }}</strong></article></section><section class="drawer-section"><h3>限流与检查</h3><dl class="model-facts"><div><dt>RPM</dt><dd>{{ selectedChannel.rateLimits.rpm.toLocaleString('zh-CN') }}</dd></div><div><dt>TPM</dt><dd>{{ selectedChannel.rateLimits.tpm.toLocaleString('zh-CN') }}</dd></div><div><dt>凭据状态</dt><dd>{{ selectedChannel.credentialConfigured ? '已配置' : '未配置' }}</dd></div><div><dt>最近检查</dt><dd>{{ timeText(selectedChannel.checkedAt) }}</dd></div></dl></section><section class="drawer-section"><h3>最近错误</h3><div v-if="selectedChannel.recentError" class="channel-error-detail"><IconAlertTriangle :size="18" /><div><strong>{{ errorText[selectedChannel.recentError.category] }}</strong><p>{{ selectedChannel.recentError.summary }}</p><small>{{ timeText(selectedChannel.recentError.occurredAt) }}</small></div></div><div v-else class="channel-clear"><IconCircleCheck :size="18" />最近检查未发现异常</div></section><section class="safe-probe-note"><IconShieldCheck :size="18" /><span><strong>安全探测边界</strong>详情仅返回分类、摘要和布尔凭据状态；不返回 API Key、OAuth Token 或上游完整响应。</span></section></template>
      <footer class="drawer-actions"><button class="btn btn-white" disabled><IconClock :size="16" />历史记录</button><button class="btn" disabled><IconRefresh :size="16" />重新检测</button></footer>
    </aside></div>
  </div>
</template>
