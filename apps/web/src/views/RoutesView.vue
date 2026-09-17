<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  IconAlertTriangle, IconArrowRight, IconArrowsExchange, IconBan, IconBrandOpenai, IconChevronRight,
  IconCircleCheck, IconClock, IconFilter, IconFlask, IconLock, IconRefresh, IconRoute, IconSearch,
  IconServer, IconSettings, IconShieldCheck, IconSparkles, IconX,
} from '@tabler/icons-vue'
import { fetchRoutes, RoutesApiError, updateLocalRoutePolicy, type RouteFilters, type RouteItem, type RoutePolicyUpdateBody, type RoutesResponse } from '../routes-api'

const routes = ref<RoutesResponse | null>(null)
const selected = ref<RouteItem | null>(null)
const search = ref('')
const category = ref<RouteFilters['category']>('all')
const environment = ref<RouteFilters['environment']>('all')
const status = ref<RouteFilters['status']>('all')
const isLoading = ref(false)
const errorMessage = ref('')
const showPolicyEdit = ref(false)
const isSavingPolicy = ref(false)
const policyError = ref('')
const policyResult = ref('')
const policyForm = ref<RoutePolicyUpdateBody>({ onTimeout: 'fail', onRateLimit: 'retry', onServerError: 'retry', maxRetries: 0, idempotencyKey: '', reason: '', acknowledgeImpact: true })
let request: AbortController | null = null

const updatedAt = computed(() => routes.value ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(routes.value.meta.generatedAt)) : '等待数据')
const summaryCards = computed(() => {
  const value = routes.value?.summary
  return [
    { label: '业务用途', value: value?.total ?? '—', hint: '统一使用稳定别名', icon: IconRoute, tone: 'teal' },
    { label: '正式路由', value: value?.production ?? '—', hint: '仅使用官方渠道组', icon: IconShieldCheck, tone: 'green' },
    { label: '实验路由', value: value?.experiment ?? '—', hint: 'CPA 隔离验证', icon: IconFlask, tone: 'violet' },
    { label: '需要关注', value: value?.degraded ?? '—', hint: '存在降级渠道', icon: IconAlertTriangle, tone: 'amber' },
  ]
})
const statusText = { healthy: '健康', degraded: '降级', disabled: '停用' }
const dataClassText = { internal: '内部', confidential: '机密', restricted: '受限' }
const eventText = { fallback: '切换备用', retry: '有限重试', fail: '直接失败' }

function filters(): RouteFilters { return { search: search.value.trim(), category: category.value, environment: environment.value, status: status.value } }
function clearFilters() { search.value = ''; category.value = 'all'; environment.value = 'all'; status.value = 'all'; void loadRoutes() }
function latencyText(value: number) { return value >= 1_000 ? `${(value / 1_000).toFixed(1)}s` : `${value}ms` }

function openPolicyEdit() {
  if (!selected.value) return
  const current = selected.value.policy
  policyForm.value = {
    onTimeout: current.onTimeout, onRateLimit: current.onRateLimit, onServerError: current.onServerError, maxRetries: current.maxRetries,
    idempotencyKey: `route-update-${crypto.randomUUID()}`, reason: '', acknowledgeImpact: true,
  }
  policyError.value = ''
  showPolicyEdit.value = true
}

async function savePolicy() {
  if (!selected.value) return
  policyError.value = ''
  isSavingPolicy.value = true
  try {
    const result = await updateLocalRoutePolicy(selected.value.id, policyForm.value)
    selected.value = result.route
    if (routes.value) routes.value = { ...routes.value, items: routes.value.items.map((item) => item.id === result.route.id ? result.route : item) }
    policyResult.value = result.operation.idempotent ? '此操作已完成，本地策略保持不变。' : '本地策略已保存；未调用 New API 或真实路由。'
    showPolicyEdit.value = false
  } catch (error) {
    const requestId = error instanceof RoutesApiError ? error.requestId : undefined
    policyError.value = `${error instanceof Error ? error.message : '保存失败'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally { isSavingPolicy.value = false }
}

async function loadRoutes() {
  request?.abort()
  const next = new AbortController()
  request = next
  isLoading.value = true
  errorMessage.value = ''
  try { routes.value = await fetchRoutes(filters(), next.signal) }
  catch (error) {
    if (next.signal.aborted) return
    const requestId = error instanceof RoutesApiError ? error.requestId : undefined
    errorMessage.value = `${error instanceof Error ? error.message : '用途与路由暂时无法加载'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally { if (request === next) isLoading.value = false }
}

onMounted(() => void loadRoutes())
onBeforeUnmount(() => request?.abort())
</script>

<template>
  <div class="dashboard routes-dashboard">
    <section class="page-heading"><div><div class="eyebrow">PURPOSE ROUTING</div><h1>用途与路由</h1><p>用稳定的业务别名连接用途、模型与渠道，并检查主备切换边界。</p></div><div class="heading-actions"><span class="updated-at">更新于 {{ updatedAt }}</span><button class="btn btn-white refresh-button" :disabled="isLoading" @click="loadRoutes"><IconRefresh :size="17" :class="{ spinning: isLoading }" />刷新</button><button class="btn" :disabled="!selected" :title="selected ? '调整本地模拟策略' : '请先打开一条路由详情'" @click="openPolicyEdit"><IconSettings :size="16" />配置策略</button></div></section>

    <div v-if="routes" class="source-banner"><span>{{ routes.meta.source === 'database' ? 'SQLITE' : 'DEMO' }}</span>{{ routes.meta.notice }}</div>
    <section class="route-summary-grid" aria-label="用途路由摘要"><article v-for="card in summaryCards" :key="card.label" class="metric-card"><div class="metric-top"><span class="metric-label">{{ card.label }}</span><span class="metric-icon" :class="`tone-${card.tone}`"><component :is="card.icon" :size="19" /></span></div><strong class="metric-value">{{ card.value }}</strong><div class="metric-foot">{{ card.hint }}</div></article></section>

    <section v-if="routes" class="route-isolation-banner"><span><IconLock :size="20" /></span><div><strong>正式与实验路由已隔离</strong><p>{{ routes.isolation.message }}</p></div><div class="isolation-groups"><em>OFFICIAL · 正式</em><IconBan :size="15" /><em class="experiment">CPA LAB · 实验</em></div></section>

    <section class="panel routes-main-panel">
      <form class="route-filters" @submit.prevent="loadRoutes"><label class="route-search"><IconSearch :size="16" /><input v-model="search" maxlength="60" type="search" placeholder="搜索用途、别名、渠道、模型或岗位" /></label><label><IconSparkles :size="15" /><select v-model="category" @change="loadRoutes"><option value="all">全部用途</option><option v-for="item in routes?.options.categories ?? []" :key="item.id" :value="item.id">{{ item.label }}</option></select></label><label><IconFilter :size="15" /><select v-model="environment" @change="loadRoutes"><option value="all">全部环境</option><option value="production">正式</option><option value="experiment">实验</option></select></label><label><IconShieldCheck :size="15" /><select v-model="status" @change="loadRoutes"><option value="all">全部状态</option><option value="healthy">健康</option><option value="degraded">降级</option><option value="disabled">停用</option></select></label><button class="btn filter-submit" type="submit">查询</button><button class="text-button" type="button" @click="clearFilters">清除</button></form>

      <div v-if="!routes && !errorMessage" class="data-state"><div class="state-icon"><IconRefresh :size="22" class="spinning" /></div><div><strong>正在读取用途路由</strong><p>正在加载业务别名、渠道和降级策略…</p></div></div>
      <div v-else-if="errorMessage" class="data-state failed"><div class="state-icon"><IconAlertTriangle :size="22" /></div><div><strong>用途与路由加载失败</strong><p>{{ errorMessage }}</p></div><button class="btn btn-white" @click="loadRoutes">重试</button></div>
      <template v-else-if="routes">
        <div v-if="routes.items.length" class="table-responsive"><table class="data-table routes-table"><thead><tr><th>业务用途</th><th>模型别名</th><th>环境</th><th>默认渠道 / 实际模型</th><th>备用路由</th><th>策略状态</th><th class="number-cell">7 天请求</th><th>成功率 / P95</th><th /></tr></thead><tbody><tr v-for="item in routes.items" :key="item.id"><td><div class="route-purpose"><span :class="`purpose-${item.category}`"><IconFlask v-if="item.environment === 'experiment'" :size="16" /><IconSparkles v-else :size="16" /></span><div><strong>{{ item.name }}</strong><small>{{ item.description }}</small></div></div></td><td><code class="route-alias">{{ item.alias }}</code></td><td><span class="environment-tag" :class="item.environment">{{ item.environment === 'production' ? '正式' : '实验' }}</span></td><td><div class="route-target"><span :class="`target-${item.primary.status}`" /><div><strong>{{ item.primary.channel }}</strong><small>{{ item.primary.model }}</small></div></div></td><td><div v-if="item.fallbacks.length" class="route-fallback"><IconArrowsExchange :size="14" /><span><strong>{{ item.fallbacks[0].channel }}</strong><small>{{ item.fallbacks[0].model }}</small></span></div><span v-else class="no-fallback">不跨组回退</span></td><td><span class="route-status" :class="`status-${item.status}`"><i />{{ statusText[item.status] }}</span></td><td class="number-cell">{{ item.usage.requests7d.toLocaleString('zh-CN') }}</td><td><div class="route-quality"><strong>{{ item.usage.successRate }}%</strong><small>{{ latencyText(item.usage.p95LatencyMs) }}</small></div></td><td><button class="row-action enabled" :aria-label="`查看 ${item.name} 路由详情`" @click="selected = item"><IconChevronRight :size="17" /></button></td></tr></tbody></table></div>
        <div v-else class="people-empty"><IconRoute :size="24" /><strong>没有符合条件的路由</strong><span>调整用途、环境、状态或搜索内容。</span><button class="text-button" @click="clearFilters">清除筛选</button></div>
        <footer class="table-footer"><span>显示 {{ routes.total }} 条路由</span><div><span class="environment-tag production">正式组内回退</span><span class="environment-tag experiment">实验组内回退</span></div></footer>
      </template>
    </section>
    <footer class="page-footer">数据来源：{{ routes?.meta.source === 'database' ? '本地 SQLite 模拟策略' : 'DEMO' }} · 客户端只能使用业务别名 · 正式与实验渠道禁止跨组回退</footer>

    <div v-if="selected" class="drawer-backdrop" @click.self="selected = null"><aside class="route-drawer" role="dialog" aria-modal="true" aria-label="路由详情"><header><div><span class="environment-tag" :class="selected.environment">{{ selected.environment === 'production' ? '正式' : '实验' }}</span><h2>{{ selected.name }}</h2></div><button class="icon-button" aria-label="关闭路由详情" @click="selected = null"><IconX :size="20" /></button></header>
      <section class="route-drawer-hero"><span><IconRoute :size="21" /></span><div><small>客户端稳定别名</small><code>{{ selected.alias }}</code><p>{{ selected.description }}</p></div></section>
      <section class="route-flow"><h3>路由链路</h3><div><article><span><IconSparkles :size="16" /></span><small>业务用途</small><strong>{{ selected.name }}</strong></article><IconArrowRight :size="17" /><article><span><IconRoute :size="16" /></span><small>模型别名</small><strong>{{ selected.alias }}</strong></article><IconArrowRight :size="17" /><article><span><IconBrandOpenai :size="16" /></span><small>默认渠道</small><strong>{{ selected.primary.channel }}</strong><em>{{ selected.primary.model }}</em></article></div><div v-if="selected.fallbacks.length" class="fallback-chain"><IconArrowsExchange :size="15" />故障时切换至 {{ selected.fallbacks[0].channel }} · {{ selected.fallbacks[0].model }}</div><div v-else class="fallback-chain blocked"><IconBan :size="15" />未设置备用路由，不允许跨环境寻找渠道</div></section>
      <section class="drawer-section"><h3>降级与熔断策略</h3><div class="policy-grid"><article><span>超时</span><strong>{{ eventText[selected.policy.onTimeout] }}</strong><small>{{ selected.policy.timeoutSeconds }} 秒</small></article><article><span>上游 429</span><strong>{{ eventText[selected.policy.onRateLimit] }}</strong><small>最多 {{ selected.policy.maxRetries }} 次</small></article><article><span>上游 5xx</span><strong>{{ eventText[selected.policy.onServerError] }}</strong><small>有限重试</small></article><article><span>熔断窗口</span><strong>{{ selected.policy.circuitBreakSeconds }} 秒</strong><small>自动恢复探测</small></article></div></section>
      <section class="drawer-section"><h3>权限与数据边界</h3><dl class="route-facts"><div><dt>数据等级</dt><dd>{{ dataClassText[selected.dataClass] }}</dd></div><div><dt>路由分组</dt><dd>{{ selected.primary.group === 'production' ? '官方正式组' : 'CPA 实验组' }}</dd></div><div><dt>客户端选渠道</dt><dd>禁止</dd></div><div><dt>跨组回退</dt><dd>禁止</dd></div></dl><div class="allowed-role-list"><span v-for="role in selected.allowedRoles" :key="role">{{ role }}</span></div></section>
      <section class="route-safety-note"><IconCircleCheck :size="17" /><span><strong>服务端强制执行</strong>客户端只提交业务别名，不能指定供应商、渠道或绕过隔离规则。</span></section>
      <p v-if="policyResult" class="route-policy-success">{{ policyResult }}</p>
      <footer class="drawer-actions"><button class="btn btn-white" disabled title="审计记录可在审计日志中按“路由”筛选"><IconClock :size="16" />审计日志</button><button class="btn" @click="openPolicyEdit"><IconSettings :size="16" />调整本地策略</button></footer>
    </aside></div>

    <div v-if="showPolicyEdit && selected" class="drawer-backdrop" @click.self="showPolicyEdit = false"><aside class="create-key-dialog route-policy-dialog" role="dialog" aria-modal="true" aria-label="调整本地路由策略"><header><div><IconSettings :size="18" /><h2>调整本地策略</h2></div><button class="icon-button" aria-label="关闭本地策略调整" :disabled="isSavingPolicy" @click="showPolicyEdit = false"><IconX :size="20" /></button></header>
      <form class="create-key-form" @submit.prevent="savePolicy"><div class="route-policy-heading"><strong>{{ selected.name }}</strong><code>{{ selected.alias }}</code><p>仅保存 SQLite 演示策略，不调用 New API，不改变真实请求、渠道或模型。</p></div>
        <label><span>请求超时</span><select v-model="policyForm.onTimeout"><option value="fail">直接失败</option><option value="fallback" :disabled="!selected.fallbacks.length">切换同组备用</option></select></label>
        <label><span>上游 429</span><select v-model="policyForm.onRateLimit"><option value="retry">有限重试</option><option value="fallback" :disabled="!selected.fallbacks.length">切换同组备用</option></select></label>
        <label><span>上游 5xx</span><select v-model="policyForm.onServerError"><option value="retry">有限重试</option><option value="fallback" :disabled="!selected.fallbacks.length">切换同组备用</option></select></label>
        <label><span>最大重试次数</span><select v-model.number="policyForm.maxRetries"><option :value="0">不重试</option><option :value="1">1 次</option><option :value="2">2 次</option><option :value="3">3 次</option></select></label>
        <p v-if="!selected.fallbacks.length" class="route-policy-warning"><IconAlertTriangle :size="15" />此用途未设置同组备用渠道，不能选择“切换同组备用”。</p>
        <label><span>调整说明（只校验长度，不保存原文）</span><textarea v-model.trim="policyForm.reason" maxlength="200" required placeholder="例如：本地演示需验证 429 的有限重试策略"></textarea></label>
        <label class="access-ack"><input v-model="policyForm.acknowledgeImpact" type="checkbox" /><span>我确认：这仅影响本地 SQLite 模拟策略，正式/实验隔离与禁止跨组回退保持不变。</span></label>
        <p v-if="policyError" class="create-person-error">{{ policyError }}</p>
        <footer><button class="btn btn-white" type="button" :disabled="isSavingPolicy" @click="showPolicyEdit = false">取消</button><button class="btn" type="submit" :disabled="isSavingPolicy || !policyForm.acknowledgeImpact"><IconSettings :size="16" />{{ isSavingPolicy ? '保存中…' : '保存本地策略' }}</button></footer>
      </form>
    </aside></div>
  </div>
</template>
