<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import {
  IconAlertTriangle, IconBan, IconCheck, IconChevronLeft, IconChevronRight, IconCopy, IconDeviceDesktop,
  IconFilter, IconKey, IconKeyOff, IconRefresh, IconRotate, IconSearch, IconShieldCheck, IconSparkles, IconUser, IconX,
} from '@tabler/icons-vue'
import { fetchKeyDetail, fetchKeys, KeysApiError, type KeyDetailResponse, type KeyFilters, type KeyListItem, type KeysResponse } from '../keys-api'

const route = useRoute()
const keys = ref<KeysResponse | null>(null)
const selected = ref<KeyDetailResponse | null>(null)
const isLoading = ref(false)
const isDetailLoading = ref(false)
const errorMessage = ref('')
const detailError = ref('')
const copied = ref('')
const search = ref('')
const owner = ref(typeof route.query.owner === 'string' ? route.query.owner : 'all')
const purpose = ref('all')
const model = ref('all')
const status = ref<KeyFilters['status']>('all')
const page = ref(1)
const pageSize = 10
let listRequest: AbortController | null = null
let detailRequest: AbortController | null = null

const totalPages = computed(() => Math.max(1, Math.ceil((keys.value?.total ?? 0) / pageSize)))
const updatedAt = computed(() => keys.value ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(keys.value.meta.generatedAt)) : '等待数据')
const rangeText = computed(() => {
  if (!keys.value?.total) return '0 条结果'
  const start = (keys.value.page - 1) * keys.value.pageSize + 1
  return `${start}–${Math.min(start + keys.value.items.length - 1, keys.value.total)} / ${keys.value.total}`
})
const summaryCards = computed(() => {
  const value = keys.value?.summary
  return [
    { label: '全部 Key', value: value?.total ?? '—', hint: '仅显示掩码标识', icon: IconKey, tone: 'teal' },
    { label: '正常启用', value: value?.active ?? '—', hint: '当前允许调用', icon: IconShieldCheck, tone: 'green' },
    { label: '30 天内到期', value: value?.expiring ?? '—', hint: '需要安排轮换', icon: IconAlertTriangle, tone: 'amber' },
    { label: '已停用', value: value?.disabled ?? '—', hint: '不可继续调用', icon: IconKeyOff, tone: 'violet' },
  ]
})

function relativeTime(value: string | null) {
  if (!value) return '从未使用'
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000))
  if (minutes < 60) return `${Math.max(1, minutes)} 分钟前`
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小时前`
  return `${Math.round(minutes / 1440)} 天前`
}

function dateText(value: string) { return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)) }
function currentFilters(): KeyFilters { return { search: search.value.trim(), owner: owner.value, purpose: purpose.value, model: model.value, status: status.value, page: page.value, pageSize } }

async function loadKeys() {
  listRequest?.abort()
  const request = new AbortController()
  listRequest = request
  isLoading.value = true
  errorMessage.value = ''
  try { keys.value = await fetchKeys(currentFilters(), request.signal) }
  catch (error) {
    if (request.signal.aborted) return
    const requestId = error instanceof KeysApiError ? error.requestId : undefined
    errorMessage.value = `${error instanceof Error ? error.message : 'Key 数据暂时无法加载'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally { if (listRequest === request) isLoading.value = false }
}

function applyFilters() { page.value = 1; void loadKeys() }
function clearFilters() { search.value = ''; owner.value = 'all'; purpose.value = 'all'; model.value = 'all'; status.value = 'all'; applyFilters() }
function goToPage(next: number) { if (next < 1 || next > totalPages.value || next === page.value) return; page.value = next; void loadKeys() }

async function openDetail(id: string) {
  detailRequest?.abort()
  const request = new AbortController()
  detailRequest = request
  selected.value = null
  detailError.value = ''
  copied.value = ''
  isDetailLoading.value = true
  try { selected.value = await fetchKeyDetail(id, request.signal) }
  catch (error) { if (!request.signal.aborted) detailError.value = error instanceof Error ? error.message : 'Key 详情暂时无法加载' }
  finally { if (detailRequest === request) isDetailLoading.value = false }
}

function closeDetail() { detailRequest?.abort(); selected.value = null; detailError.value = ''; isDetailLoading.value = false }
async function copyValue(label: string, value: string) { try { await navigator.clipboard.writeText(value); copied.value = label } catch { copied.value = '复制失败' } }

onMounted(() => void loadKeys())
onBeforeUnmount(() => { listRequest?.abort(); detailRequest?.abort() })
</script>

<template>
  <div class="dashboard keys-dashboard">
    <section class="page-heading">
      <div><div class="eyebrow">ACCESS CREDENTIALS</div><h1>Key 管理</h1><p>按人员、用途和模型检查访问凭据；完整 Key 永远不进入列表。</p></div>
      <div class="heading-actions"><span class="updated-at">更新于 {{ updatedAt }}</span><button class="btn btn-white refresh-button" :disabled="isLoading" @click="loadKeys"><IconRefresh :size="17" :class="{ spinning: isLoading }" />刷新</button><button class="btn create-key" disabled title="写接口、二次确认和审计完成后开放"><IconKey :size="17" />创建 Key</button></div>
    </section>

    <div v-if="keys" class="source-banner"><span>DEMO</span>{{ keys.meta.notice }}</div>
    <section class="key-summary-grid" aria-label="Key 状态摘要"><article v-for="card in summaryCards" :key="card.label" class="metric-card"><div class="metric-top"><span class="metric-label">{{ card.label }}</span><span class="metric-icon" :class="`tone-${card.tone}`"><component :is="card.icon" :size="19" /></span></div><strong class="metric-value">{{ card.value }}</strong><div class="metric-foot">{{ card.hint }}</div></article></section>

    <section class="panel keys-main-panel">
      <form class="key-filters" @submit.prevent="applyFilters">
        <label class="key-search"><IconSearch :size="17" /><input v-model="search" type="search" maxlength="60" placeholder="搜索 Key 掩码、人员、部门、用途或模型" /></label>
        <label><IconUser :size="15" /><select v-model="owner" @change="applyFilters"><option value="all">全部人员</option><option v-for="item in keys?.options.owners ?? []" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
        <label><IconFilter :size="15" /><select v-model="purpose" @change="applyFilters"><option value="all">全部用途</option><option v-for="item in keys?.options.purposes ?? []" :key="item" :value="item">{{ item }}</option></select></label>
        <label><IconSparkles :size="15" /><select v-model="model" @change="applyFilters"><option value="all">全部模型</option><option v-for="item in keys?.options.models ?? []" :key="item" :value="item">{{ item }}</option></select></label>
        <label><IconShieldCheck :size="15" /><select v-model="status" @change="applyFilters"><option value="all">全部状态</option><option value="active">正常启用</option><option value="expiring">30 天内到期</option><option value="disabled">已停用</option></select></label>
        <button class="btn filter-submit" type="submit"><IconSearch :size="15" />查询</button><button class="text-button" type="button" @click="clearFilters">清除</button>
      </form>

      <div v-if="!keys && !errorMessage" class="data-state"><div class="state-icon"><IconRefresh :size="22" class="spinning" /></div><div><strong>正在读取 Key 列表</strong><p>正在从 BFF 获取脱敏后的访问凭据…</p></div></div>
      <div v-else-if="errorMessage" class="data-state failed"><div class="state-icon"><IconAlertTriangle :size="22" /></div><div><strong>Key 数据加载失败</strong><p>{{ errorMessage }}</p></div><button class="btn btn-white" @click="loadKeys">重试</button></div>
      <template v-else-if="keys">
        <div v-if="keys.items.length" class="table-responsive"><table class="data-table keys-table"><thead><tr><th>Key 掩码</th><th>所属人员</th><th>用途</th><th>允许模型</th><th>状态</th><th>到期时间</th><th class="number-cell">本月请求</th><th>最后使用</th><th /></tr></thead><tbody><tr v-for="item in keys.items" :key="item.id"><td><button class="masked-key" @click="openDetail(item.id)">{{ item.masked }}</button></td><td><div class="person-cell"><span class="person-avatar avatar-blue">{{ item.owner.initials }}</span><span><strong>{{ item.owner.name }}</strong><small>{{ item.owner.department }}</small></span></div></td><td><span class="purpose-tag">{{ item.purpose }}</span></td><td><div class="model-tags"><span v-for="entry in item.models" :key="entry">{{ entry }}</span></div></td><td><span class="person-status" :class="`status-${item.status}`"><i />{{ item.status === 'active' ? '启用' : '停用' }}</span></td><td><div class="expiry-cell"><strong :class="`expiry-${item.expiryState}`">{{ dateText(item.expiresAt) }}</strong><small v-if="item.expiryState !== 'normal'">{{ item.expiryState === 'expiring' ? '即将到期' : '已过期' }}</small></div></td><td class="number-cell">{{ item.usage.requests.toLocaleString('zh-CN') }}</td><td>{{ relativeTime(item.lastUsedAt) }}</td><td><button class="row-action enabled" :aria-label="`查看 ${item.masked} 详情`" @click="openDetail(item.id)"><IconChevronRight :size="17" /></button></td></tr></tbody></table></div>
        <div v-else class="people-empty"><IconKey :size="24" /><strong>没有符合条件的 Key</strong><span>调整人员、用途、模型或状态筛选。</span><button class="text-button" @click="clearFilters">清除筛选</button></div>
        <footer class="table-footer"><span>{{ rangeText }}</span><div><button :disabled="page <= 1 || isLoading" aria-label="上一页" @click="goToPage(page - 1)"><IconChevronLeft :size="16" /></button><strong>第 {{ page }} / {{ totalPages }} 页</strong><button :disabled="page >= totalPages || isLoading" aria-label="下一页" @click="goToPage(page + 1)"><IconChevronRight :size="16" /></button></div></footer>
      </template>
    </section>

    <section v-if="keys" class="panel connection-panel"><div class="connection-icon"><IconDeviceDesktop :size="22" /></div><div><h2>客户端连接规范</h2><p>{{ keys.connection.note }}</p><code>{{ keys.connection.baseUrl }}</code></div><button class="btn btn-white" @click="copyValue('Base URL', keys.connection.baseUrl)"><IconCheck v-if="copied === 'Base URL'" :size="16" /><IconCopy v-else :size="16" />{{ copied === 'Base URL' ? '已复制' : '复制 Base URL' }}</button></section>
    <footer class="page-footer">数据来源：DEMO · Key 仅显示掩码 · 创建、停用与轮换功能尚未开放</footer>

    <div v-if="selected || isDetailLoading || detailError" class="drawer-backdrop" @click.self="closeDetail">
      <aside class="key-drawer" role="dialog" aria-modal="true" aria-label="Key 详情">
        <header><div><span class="source-tag demo">DEMO</span><h2>Key 详情</h2></div><button class="icon-button" aria-label="关闭 Key 详情" @click="closeDetail"><IconX :size="20" /></button></header>
        <div v-if="isDetailLoading" class="panel-empty"><IconRefresh :size="20" class="spinning" />正在加载脱敏详情…</div>
        <div v-else-if="detailError" class="panel-empty"><IconAlertTriangle :size="20" />{{ detailError }}</div>
        <template v-else-if="selected"><section class="drawer-key-hero"><IconKey :size="24" /><div><code>{{ selected.key.masked }}</code><span class="person-status" :class="`status-${selected.key.status}`"><i />{{ selected.key.status === 'active' ? '启用' : '停用' }}</span></div><small>{{ selected.key.id }}</small></section>
          <dl class="drawer-facts"><div><dt>所属人员</dt><dd><RouterLink :to="`/people/${selected.key.owner.id}`">{{ selected.key.owner.name }}</RouterLink></dd></div><div><dt>所属部门</dt><dd>{{ selected.key.owner.department }}</dd></div><div><dt>用途</dt><dd>{{ selected.key.purpose }}</dd></div><div><dt>设备备注</dt><dd>{{ selected.key.deviceNote }}</dd></div><div><dt>创建时间</dt><dd>{{ dateText(selected.key.createdAt) }}</dd></div><div><dt>到期时间</dt><dd>{{ dateText(selected.key.expiresAt) }}</dd></div><div><dt>来源限制</dt><dd>{{ selected.key.allowedIps.join('、') }}</dd></div><div><dt>限流</dt><dd>{{ selected.key.limits.rpm }} RPM · {{ (selected.key.limits.tpm / 1000).toFixed(0) }}K TPM · {{ selected.key.limits.concurrent }} 并发</dd></div></dl>
          <section class="drawer-section"><h3>允许模型</h3><div class="drawer-models"><span v-for="entry in selected.key.models" :key="entry">{{ entry }}</span></div></section>
          <section class="drawer-section"><h3>连接说明</h3><div class="drawer-copy-row"><code>{{ selected.connection.baseUrl }}</code><button @click="copyValue('drawer-url', selected.connection.baseUrl)"><IconCheck v-if="copied === 'drawer-url'" :size="14" /><IconCopy v-else :size="14" /></button></div><ol><li v-for="instruction in selected.connection.instructions" :key="instruction">{{ instruction }}</li></ol></section>
          <footer class="drawer-actions"><button class="btn btn-white" disabled><IconRotate :size="16" />轮换 Key</button><button class="btn danger-outline" disabled><IconBan :size="16" />停用 Key</button></footer>
        </template>
      </aside>
    </div>
  </div>
</template>
