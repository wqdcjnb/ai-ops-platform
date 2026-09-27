<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { IconAlertTriangle, IconCheck, IconChevronDown, IconChevronUp, IconClock, IconDatabase, IconDownload, IconEye, IconFileSearch, IconKey, IconLock, IconMessageCircle, IconRefresh, IconSearch, IconShieldCheck, IconTool, IconTrash, IconUser, IconX } from '@tabler/icons-vue'
import { ConversationAuditApiError, copyConversationAudit, deleteConversationAudit, exportConversationAudit, fetchConversationAccessHistory, fetchConversationAudits, requestConversationAccess, type ConversationAccessHistoryResponse, type ConversationAccessResponse, type ConversationAuditFilters, type ConversationAuditRecord, type ConversationAuditResponse } from '../conversation-audit-api'
import AppPagination from '../components/AppPagination.vue'
import { useDebouncedSearch } from '../composables/useDebouncedSearch'
import { conciseModelName } from '../model-display'

const data = ref<ConversationAuditResponse | null>(null)
const selected = ref<ConversationAuditRecord | null>(null)
const access = ref<ConversationAccessResponse | null>(null)
const accessHistory = ref<ConversationAccessHistoryResponse | null>(null)
const period = ref<ConversationAuditFilters['period']>('7d')
const search = ref('')
const person = ref('all')
const key = ref('all')
const purpose = ref('all')
const model = ref('all')
const policy = ref('all')
const page = ref(1)
const pageSize = 10
const isLoading = ref(false)
const isOpening = ref(false)
const isHistoryLoading = ref(false)
const isOperating = ref(false)
const errorMessage = ref('')
const accessError = ref('')
const historyError = ref('')
const operationMessage = ref('')
const historyExpanded = ref(false)
const pendingConversationDeletion = ref<ConversationAuditRecord | null>(null)
const deleteError = ref('')
const deletionNotice = ref('')
const isDeletingConversation = ref(false)
const deleteCountdown = ref(0)

function linkedRecordFromLocation() {
  if (typeof window === 'undefined') return ''
  const value = new URLSearchParams(window.location.search).get('recordId')?.trim() ?? ''
  return /^conv-audit-[a-z0-9-]{1,80}$/.test(value) ? value : ''
}

const linkedRecordId = ref(linkedRecordFromLocation())
let request: AbortController | undefined
let accessRequest: AbortController | undefined
let historyRequest: AbortController | undefined
let operationRequest: AbortController | undefined
let deleteRequest: AbortController | undefined
let deleteCountdownTimer: ReturnType<typeof setInterval> | undefined

const stateText = { captured: '已采集', metadata_only: '仅元数据', deleted: '已删除', expired: '已到期' }
const auditStatusText = { streaming: '流式进行中', succeeded: '已完成', failed: '请求失败', cancelled: '已取消', body_unavailable: '正文不可用' }
const updatedAt = computed(() => data.value ? dateTime(data.value.meta.generatedAt) : '—')
const isPostgres = computed(() => data.value?.scope.retention.mode === 'encrypted_postgres')
const sourceText = computed(() => data.value?.meta.source === 'database' ? isPostgres.value ? '本地 PostgreSQL' : '本地 SQLite' : '演示数据')
const selectedStatus = computed(() => selected.value && selected.value.state !== 'captured' ? stateText[selected.value.state] : selected.value?.status ? auditStatusText[selected.value.status] : (selected.value ? stateText[selected.value.state] : '—'))
const hasRealContent = computed(() => Boolean(access.value?.content.decrypted))
const canOpen = computed(() => Boolean(selected.value?.contentAccess.available && !isOpening.value))

function normalizeConversationText(value: string) {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/<session\b[^>]*>[\s\S]*?<\/session>/gi, '')
    .replace(/<\/?session\b[^>]*>/gi, '')
    .trim()
}

function userQueriesFromText(value: string) {
  const text = normalizeConversationText(value)
  const queries: string[] = []
  for (const match of text.matchAll(/<user_query\b[^>]*>([\s\S]*?)<\/user_query>/gi)) {
    const query = normalizeConversationText(match[1] ?? '')
    if (query && !queries.includes(query)) queries.push(query)
  }
  return queries
}

const visibleMessages = computed(() => {
  const messages = access.value?.content.messages ?? []
  const seenQueries = new Set<string>()
  return messages.flatMap((message) => {
    const text = normalizeConversationText(message.text)
    const queries = userQueriesFromText(text)
    if (message.role === 'system' || message.role === 'developer') {
      return queries.flatMap((query, index) => {
        const key = query.replace(/\s+/g, ' ').trim()
        if (!key || seenQueries.has(key)) return []
        seenQueries.add(key)
        return [{ ...message, id: `${message.id}-user-query-${index}`, role: 'user' as const, label: '用户输入', text: query, tool: null }]
      })
    }
    const userText = message.role === 'user' && queries.length ? queries[0] : text
    if (!userText) return []
    if (message.role === 'user') {
      const key = userText.replace(/\s+/g, ' ').trim()
      if (!key || seenQueries.has(key)) return []
      seenQueries.add(key)
      return [{ ...message, label: '用户输入', text: userText, tool: null }]
    }
    return [{ ...message, text }]
  })
})
const visibleAccessHistory = computed(() => {
  const items = accessHistory.value?.items ?? []
  return historyExpanded.value ? items.slice(0, 5) : items.slice(0, 1)
})
const summaryCards = computed(() => {
  const value = data.value?.summary
  return [
    { label: '请求记录', value: value?.total ?? '—', hint: '当前筛选范围', icon: IconFileSearch, tone: 'teal' },
    { label: '已保存正文', value: value?.captured ?? '—', hint: '加密正文可按需解密', icon: IconShieldCheck, tone: 'green' },
    { label: '24h 内到期', value: value?.expiringSoon ?? '—', hint: '到期删除正文，保留证明', icon: IconClock, tone: 'amber' },
  ]
})

function dateTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) }
function expiryText(value: string) { const diff = new Date(value).getTime() - Date.now(); if (diff <= 0) return '已到期'; const hours = Math.ceil(diff / 3_600_000); return hours < 24 ? `${hours} 小时后` : `${Math.ceil(hours / 24)} 天后` }
function auditModelName(value: ConversationAuditRecord['model']) { return conciseModelName(value.actualModel?.trim() || value.label) }
function auditConversationTitle(value: string, record: ConversationAuditRecord) {
  const actual = record.model.actualModel?.trim()
  const display = auditModelName(record.model)
  if (actual && value.includes(actual)) return value.replace(actual, display)
  return value.replace(record.model.label, display)
}
function filters(): ConversationAuditFilters { return { period: period.value, search: search.value.trim(), person: person.value, key: key.value, purpose: purpose.value, model: model.value, policy: policy.value, page: page.value, pageSize } }
function applyFilters() { cancelSearch(); page.value = 1; closeSelection(); void loadData() }
function clearFilters() { period.value = '7d'; search.value = ''; person.value = 'all'; key.value = 'all'; purpose.value = 'all'; model.value = 'all'; policy.value = 'all'; applyFilters() }
function changePage(next: number) { if (!data.value || next < 1 || next > data.value.pagination.totalPages) return; page.value = next; closeSelection(); void loadData() }
function selectRecord(item: ConversationAuditRecord) { selected.value = item; access.value = null; accessHistory.value = null; accessError.value = ''; historyError.value = ''; operationMessage.value = ''; historyExpanded.value = false; void loadAccessHistory(item.id); void openContent() }
function closeSelection() {
  const selectedFromUsageLink = selected.value?.id === linkedRecordId.value
  selected.value = null; access.value = null; accessHistory.value = null; accessError.value = ''; historyError.value = ''; operationMessage.value = ''; historyExpanded.value = false
  accessRequest?.abort(); historyRequest?.abort(); operationRequest?.abort()
  if (selectedFromUsageLink && typeof window !== 'undefined') {
    linkedRecordId.value = ''
    const url = new URL(window.location.href)
    url.searchParams.delete('recordId')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }
}

async function loadData() {
  request?.abort(); const next = new AbortController(); request = next; isLoading.value = true; errorMessage.value = ''
  try {
    data.value = await fetchConversationAudits(filters(), next.signal)
    const linked = linkedRecordId.value
    const record = linked ? data.value.items.find((item) => item.id === linked) : null
    if (record && selected.value?.id !== record.id) selectRecord(record)
  } catch (error) {
    if (next.signal.aborted) return
    const requestId = error instanceof ConversationAuditApiError ? error.requestId : undefined
    errorMessage.value = `${error instanceof Error ? error.message : '对话审计暂时无法加载'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally { if (request === next) isLoading.value = false }
}

async function openContent() {
  if (!selected.value || !canOpen.value) return
  accessRequest?.abort(); const next = new AbortController(); accessRequest = next; isOpening.value = true; accessError.value = ''; operationMessage.value = ''
  try { access.value = await requestConversationAccess(selected.value.id, next.signal); void loadAccessHistory(selected.value.id) }
  catch (error) { if (!next.signal.aborted) accessError.value = error instanceof Error ? error.message : '无法打开真实对话正文' }
  finally { if (accessRequest === next) isOpening.value = false }
}

async function loadAccessHistory(id: string) {
  historyRequest?.abort(); const next = new AbortController(); historyRequest = next; isHistoryLoading.value = true; historyError.value = ''
  try { const result = await fetchConversationAccessHistory(id, next.signal); if (selected.value?.id === id) accessHistory.value = result }
  catch (error) { if (!next.signal.aborted && selected.value?.id === id) historyError.value = error instanceof Error ? error.message : '查看访问记录暂时无法加载' }
  finally { if (historyRequest === next) isHistoryLoading.value = false }
}

function copyText() {
  if (!access.value || !hasRealContent.value) return ''
  return visibleMessages.value.map((message) => `[${message.label}]\n${message.text}`).join('\n\n')
}

async function copyContent() {
  if (!selected.value || !access.value?.access.copyAllowed || !hasRealContent.value) return
  operationRequest?.abort(); const next = new AbortController(); operationRequest = next; isOperating.value = true; operationMessage.value = ''
  try {
    await copyConversationAudit(selected.value.id, next.signal)
    await navigator.clipboard.writeText(copyText())
    operationMessage.value = '已复制到剪贴板；复制动作已写入审计。'
    void loadAccessHistory(selected.value.id)
  } catch (error) { if (!next.signal.aborted) operationMessage.value = error instanceof Error ? error.message : '复制正文失败' }
  finally { if (operationRequest === next) isOperating.value = false }
}

async function exportContent() {
  if (!selected.value || !access.value?.access.exportAllowed || !hasRealContent.value) return
  operationRequest?.abort(); const next = new AbortController(); operationRequest = next; isOperating.value = true; operationMessage.value = ''
  try {
    const blob = await exportConversationAudit(selected.value.id, next.signal)
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `conversation-audit-${selected.value.requestId}.json`; anchor.click(); URL.revokeObjectURL(url)
    operationMessage.value = '已导出受控 JSON；导出动作已写入审计。'
    void loadAccessHistory(selected.value.id)
  } catch (error) { if (!next.signal.aborted) operationMessage.value = error instanceof Error ? error.message : '导出正文失败' }
  finally { if (operationRequest === next) isOperating.value = false }
}

function operationKey(prefix: 'conversation-delete') {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`
}

function clearDeleteCountdown() {
  if (deleteCountdownTimer) {
    clearInterval(deleteCountdownTimer)
    deleteCountdownTimer = undefined
  }
  deleteCountdown.value = 0
}

function closeConversationDelete() {
  if (isDeletingConversation.value) return
  pendingConversationDeletion.value = null
  deleteError.value = ''
  clearDeleteCountdown()
}

function openConversationDelete(record?: ConversationAuditRecord) {
  const target = record ?? selected.value
  if (!target || !target.contentAccess.available || (!target.promptAvailable && !target.responseAvailable) || isDeletingConversation.value) return
  pendingConversationDeletion.value = target
  deleteError.value = ''
  deletionNotice.value = ''
  clearDeleteCountdown()
  deleteCountdown.value = 5
  deleteCountdownTimer = setInterval(() => {
    deleteCountdown.value = Math.max(0, deleteCountdown.value - 1)
    if (deleteCountdown.value === 0) clearDeleteCountdown()
  }, 1000)
}

function removeConversationRecord(id: string) {
  if (!data.value) return
  data.value.items = data.value.items.filter((item) => item.id !== id)
}

async function confirmConversationDelete() {
  const pending = pendingConversationDeletion.value
  if (!pending || isDeletingConversation.value || deleteCountdown.value > 0) return
  isDeletingConversation.value = true
  deleteError.value = ''
  const next = new AbortController()
  deleteRequest = next
  try {
    await deleteConversationAudit(pending.id, { idempotencyKey: operationKey('conversation-delete'), acknowledgeImpact: true }, next.signal)
    removeConversationRecord(pending.id)
    pendingConversationDeletion.value = null
    clearDeleteCountdown()
    deletionNotice.value = '这条对话审计记录已删除；列表中不再保留该条目。'
    closeSelection()
    await loadData()
  } catch (error) {
    if (!next.signal.aborted) {
      const requestId = error instanceof ConversationAuditApiError ? error.requestId : undefined
      deleteError.value = `${error instanceof Error ? error.message : '删除对话记录失败'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
    }
  } finally {
    if (deleteRequest === next) deleteRequest = undefined
    isDeletingConversation.value = false
  }
}

const { cancel: cancelSearch } = useDebouncedSearch(search, () => { page.value = 1; closeSelection(); void loadData() })
onMounted(() => void loadData())
onBeforeUnmount(() => { request?.abort(); accessRequest?.abort(); historyRequest?.abort(); operationRequest?.abort(); deleteRequest?.abort(); clearDeleteCountdown() })
</script>

<template>
  <div class="dashboard conversation-audit-dashboard">
    <section class="page-heading">
      <div><div class="eyebrow">KEY → REQUEST → BODY</div><h1>对话审计</h1><p>先按 API Key 定位请求，直接查看本地加密保存的真实正文。</p></div>
      <div class="heading-actions"><span class="updated-at">更新于 {{ updatedAt }}</span><button class="btn btn-white refresh-button" :disabled="isLoading" @click="loadData"><IconRefresh :size="17" :class="{ spinning: isLoading }" />刷新</button></div>
    </section>

    <div v-if="data" class="source-banner"><span>{{ data.meta.source === 'database' ? isPostgres ? 'LOCAL POSTGRES' : 'LOCAL SQLITE' : 'DEMO' }}</span>{{ data.meta.notice }}</div>
    <p v-if="deletionNotice" class="operation-message conversation-delete-notice" role="status">{{ deletionNotice }}</p>
    <section class="audit-summary-grid" aria-label="对话审计汇总"><article v-for="card in summaryCards" :key="card.label" class="metric-card"><div class="metric-top"><span class="metric-label">{{ card.label }}</span><span class="metric-icon" :class="`tone-${card.tone}`"><component :is="card.icon" :size="19" /></span></div><strong class="metric-value">{{ card.value }}</strong><div class="metric-foot">{{ card.hint }}</div></article></section>

    <div v-if="!data && !errorMessage" class="panel data-state"><div class="state-icon"><IconRefresh :size="22" class="spinning" /></div><div><strong>正在读取本地对话审计</strong><p>正在加载 Key、请求状态、正文引用和留存时间…</p></div></div>
    <div v-else-if="errorMessage && !data" class="panel data-state failed"><div class="state-icon"><IconAlertTriangle :size="22" /></div><div><strong>对话审计加载失败</strong><p>{{ errorMessage }}</p></div><button class="btn btn-white" @click="loadData">重试</button></div>

    <template v-else-if="data">
      <section class="conversation-scope-banner"><span><IconShieldCheck :size="19" /></span><div><strong>{{ data.scope.defaultCaptureEnabled ? '网关正文采集已启用' : '默认不采集正文' }} · {{ data.scope.activePolicies }} 条策略生效</strong><p>{{ data.scope.notice }} {{ data.scope.retention.notice }}</p></div><div class="conversation-scope-facts"><em>最近到期 {{ expiryText(data.scope.nearestExpiryAt) }}</em><em>服务端 RBAC 已验证</em><em>{{ data.scope.storageEncryptedVerified ? '正文 AES-GCM 已验证' : '当前仅元数据' }}</em><em>{{ data.scope.retention.proofRecords ? `${data.scope.retention.proofRecords} 条删除证明` : '暂无到期删除证明' }}</em></div></section>
      <section class="panel conversation-audit-panel">
        <form class="conversation-filters" @submit.prevent="applyFilters">
          <label class="conversation-search"><IconSearch :size="15" /><input v-model="search" aria-label="搜索对话审计" maxlength="80" type="search" placeholder="请求 ID、人员、Key、用途或模型" /></label>
          <label class="key-filter"><IconKey :size="14" /><select v-model="key" @change="applyFilters"><option value="all">全部 API Key</option><option v-for="option in data.options.keys" :key="option.id" :value="option.id">{{ option.label }}</option></select></label>
          <label><select v-model="period" @change="applyFilters"><option value="today">今天</option><option value="7d">近 7 天</option><option value="30d">近 30 天</option></select></label>
          <label><IconUser :size="14" /><select v-model="person" @change="applyFilters"><option value="all">全部人员</option><option v-for="option in data.options.people" :key="option.id" :value="option.id">{{ option.label }}</option></select></label>
          <label><select v-model="model" @change="applyFilters"><option value="all">全部模型</option><option v-for="option in data.options.models" :key="option.id" :value="option.id">{{ conciseModelName(option.label) }}</option></select></label>
          <span class="realtime-search-hint" aria-live="polite">输入即搜索</span><button class="text-button" type="button" @click="clearFilters">清除</button>
        </form>

        <div class="conversation-workbench">
          <section class="conversation-record-column"><header><div><strong>按 Key 的请求记录</strong><small>列表只返回元数据和加密引用，不返回正文</small></div><span>{{ data.pagination.total }} 条</span></header>
            <div v-if="data.items.length" class="conversation-record-list"><div v-for="item in data.items" :key="item.id" class="conversation-record-row"><button type="button" class="conversation-record" :class="{ active: selected?.id === item.id }" @click="selectRecord(item)"><span class="conversation-record-icon"><IconKey :size="18" /></span><div class="conversation-record-main"><div><strong>{{ item.key.masked }}</strong><span class="capture-state" :class="item.state">{{ item.promptAvailable || item.responseAvailable ? '正文已存' : stateText[item.state] }}</span></div><small>{{ item.person.name }} · {{ auditModelName(item.model) }}</small><code>{{ item.requestId }}</code><div class="conversation-record-meta"><span>{{ dateTime(item.capturedAt) }}</span><span>{{ item.responseAvailable ? '请求+回复' : item.promptAvailable ? '仅请求' : '无正文' }}</span></div></div></button><button v-if="item.contentAccess.available && (item.promptAvailable || item.responseAvailable)" type="button" class="conversation-record-delete" :aria-label="`删除 ${item.requestId} 的对话记录`" title="删除这条记录" :disabled="isDeletingConversation" @click.stop="openConversationDelete(item)"><IconTrash :size="15" /></button></div></div>
            <div v-else class="conversation-empty"><IconFileSearch :size="24" /><strong>没有符合条件的记录</strong><span>调整 Key、人员、模型或日期。</span><button class="text-button" @click="clearFilters">清除筛选</button></div>
            <AppPagination :page="data.pagination.page" :total-pages="data.pagination.totalPages" :total="data.pagination.total" aria-label="对话审计分页" @change="changePage" />
          </section>

          <section class="conversation-detail-column">
            <div v-if="!selected" class="conversation-detail-placeholder"><span><IconKey :size="24" /></span><strong>选择一个 Key 下的请求</strong><p>选择记录后会直接打开已采集的真实正文。仅元数据记录不会伪造内容。</p></div>
            <template v-else>
              <header class="conversation-detail-header"><div><span class="capture-state" :class="selected.state">{{ selectedStatus }}</span><h2>{{ selected.key.masked }}</h2><code>{{ selected.requestId }} · {{ selected.endpoint ?? '网关请求' }}</code></div><button class="icon-button" aria-label="关闭记录" @click="closeSelection"><IconX :size="18" /></button></header>
              <div v-if="!access" class="conversation-access-gate"><span class="access-lock"><IconLock :size="23" /></span><h3>{{ selected.contentAccess.available ? (isOpening ? '正在打开真实正文' : '重新打开真实正文') : '该请求没有可访问正文' }}</h3><p v-if="selected.contentAccess.available">选择记录后直接读取正文；查看、复制和导出动作仍会写入访问审计。</p><p v-else>{{ selected.bodyUnavailableReason ?? (selected.state === 'expired' ? '内容已到期，页面不允许恢复。' : '该请求未命中正文采集策略，只保存调用元数据。') }}</p>
                <p v-if="accessError" class="form-error">{{ accessError }}</p><button v-if="selected.contentAccess.available && !isOpening" class="btn access-submit" :disabled="!canOpen" @click="openContent"><IconEye :size="16" />重新打开真实正文</button>
                <div class="access-facts"><span><small>人员</small><strong>{{ selected.person.name }}</strong></span><span><small>模型</small><strong>{{ auditModelName(selected.model) }}</strong></span><span><small>策略到期</small><strong>{{ dateTime(selected.retentionUntil ?? selected.policy.expiresAt) }}</strong></span></div>
              </div>
              <div v-else class="conversation-content"><div class="conversation-content-status"><IconCheck :size="17" /><div><strong>真实正文 · 已从本地加密 {{ isPostgres ? 'PostgreSQL' : 'SQLite' }} 解密</strong><p>{{ access.meta.notice }}</p></div></div><header class="conversation-content-header"><div><h3>{{ auditConversationTitle(access.content.conversationTitle, selected) }}</h3><p>{{ access.record.metrics.turns }} 轮 · {{ access.record.metrics.toolCalls }} 次工具 · {{ access.record.metrics.totalTokens.toLocaleString('zh-CN') }} Token · {{ access.record.streamed ? `${access.record.chunkCount} 个流式片段` : '非流式响应' }}</p></div></header>
                <div class="conversation-message-list"><article v-for="message in visibleMessages" :key="message.id" class="conversation-message" :class="message.role"><header><span><IconTool v-if="message.role === 'tool'" :size="14" /><IconUser v-else-if="message.role === 'user'" :size="14" /><IconMessageCircle v-else :size="14" />{{ message.label }}<em v-if="message.role === 'assistant'" class="conversation-message-model">{{ auditModelName(selected.model) }}</em></span><small>{{ dateTime(message.occurredAt) }}</small></header><p>{{ message.text }}</p><div v-if="message.tool" class="tool-summary"><strong>{{ message.tool.name }}</strong><p>{{ message.tool.summary }}</p><small>{{ message.tool.argumentsAvailable || message.tool.outputAvailable ? '工具参数或输出已随正文采集' : '工具参数与输出不可用' }}</small></div></article></div>
                <section class="conversation-retention"><IconClock :size="17" /><div><strong>{{ access.retention.cleanupState === 'expired' ? '正文已按保留策略清理' : `计划于 ${dateTime(access.retention.expiresAt)} 清理正文` }}</strong><p>{{ access.retention.notice }}</p></div></section><section class="conversation-linked-usage" :class="{ unavailable: !access.linkedUsage.linkVerified }"><IconDatabase :size="17" /><div><strong>{{ access.linkedUsage.linkVerified ? '已关联同一 request_id 的网关记录' : '尚无可关联的网关记录' }}</strong><p>{{ access.linkedUsage.notice }}</p></div><div class="conversation-linked-usage-actions"><code>{{ access.linkedUsage.usageRequestId ?? '无映射' }}</code></div></section><footer class="conversation-content-actions"><span>访问记录 {{ access.access.accessRecordId }} · 直接查看，动作已写入审计</span><button class="btn btn-white" :disabled="!access.access.copyAllowed || !hasRealContent || isOperating" @click="copyContent"><IconCheck :size="15" />复制正文</button><button class="btn btn-white" :disabled="!access.access.exportAllowed || !hasRealContent || isOperating" @click="exportContent"><IconDownload :size="15" />导出 JSON</button><button v-if="access.access.deleteAllowed" class="btn danger-outline" :disabled="!hasRealContent || isOperating || isDeletingConversation" @click="openConversationDelete()"><IconTrash :size="15" />删除记录</button></footer><p v-if="operationMessage" class="operation-message">{{ operationMessage }}</p>
              </div>
              <section class="conversation-access-history" aria-label="正文操作记录"><header><div><span><IconEye :size="16" /></span><div><strong>正文操作记录</strong><small>仅显示操作者、动作和时间。</small></div></div><div class="access-history-heading-actions"><em>{{ accessHistory?.items.length ?? 0 }} 条</em><button v-if="(accessHistory?.items.length ?? 0) > 1" type="button" class="access-history-toggle" :aria-expanded="historyExpanded" :aria-label="historyExpanded ? '收起操作记录' : '展开操作记录'" @click="historyExpanded = !historyExpanded"><IconChevronUp v-if="historyExpanded" :size="13" /><IconChevronDown v-else :size="13" />{{ historyExpanded ? '收起' : '展开' }}</button></div></header><div v-if="isHistoryLoading" class="access-history-state">正在读取操作记录…</div><div v-else-if="historyError" class="access-history-state failed">{{ historyError }}</div><div v-else-if="accessHistory?.items.length" class="access-history-list"><article v-for="item in visibleAccessHistory" :key="item.id"><span><IconUser :size="15" /></span><div><strong>{{ item.actorName }} · {{ item.action === 'view' ? '查看正文' : item.action === 'copy' ? '复制正文' : '导出正文' }}</strong><small>{{ dateTime(item.occurredAt) }} · 请求 {{ item.requestId }}</small></div><em>{{ item.action === 'view' ? '直接查看' : item.action === 'copy' ? '复制正文' : '导出正文' }}</em></article></div><div v-else class="access-history-state">尚无已记录的正文操作。</div></section>
            </template>
          </section>
        </div>
      </section>
      <footer class="page-footer">数据来源：{{ sourceText }} · Key → 请求 → 正文 · 加密正文与元数据分离 · 仅经授权的运营者可见 · 到期只删除正文并保留证明</footer>
    </template>

    <div v-if="pendingConversationDeletion" class="drawer-backdrop" @click.self="closeConversationDelete">
      <aside class="person-action-dialog conversation-delete-dialog" role="dialog" aria-modal="true" aria-label="确认删除对话记录">
        <header><div><span class="person-action-dialog-icon dialog-delete"><IconTrash :size="17" /></span><div><span class="source-tag sqlite">对话记录</span><h2>确认删除对话记录</h2></div></div><button class="icon-button" aria-label="关闭确认窗口" :disabled="isDeletingConversation" @click="closeConversationDelete"><IconX :size="20" /></button></header>
        <section class="person-action-dialog-body"><strong>{{ pendingConversationDeletion.key.masked }} · {{ auditModelName(pendingConversationDeletion.model) }}</strong><p>删除后会立即清除该记录的用户输入、模型回复、附件索引和本地记录，不能恢复。</p><p>仅保留不含正文的删除证明与本次操作审计。</p><p v-if="deleteCountdown > 0" class="key-delete-countdown">为避免误删，请等待 {{ deleteCountdown }} 秒后确认。</p><div v-if="deleteError" class="create-person-error"><IconAlertTriangle :size="16" />{{ deleteError }}</div></section>
        <footer class="person-action-dialog-footer"><button class="btn btn-white" type="button" :disabled="isDeletingConversation" @click="closeConversationDelete">取消</button><button class="btn danger-outline" type="button" :disabled="isDeletingConversation || deleteCountdown > 0" @click="confirmConversationDelete">{{ isDeletingConversation ? '删除中…' : deleteCountdown > 0 ? `确认删除（${deleteCountdown}s）` : '确认删除' }}</button></footer>
      </aside>
    </div>
  </div>
</template>
