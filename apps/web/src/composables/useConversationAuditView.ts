import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { IconAlertTriangle, IconCheck, IconChevronDown, IconChevronUp, IconClock, IconDatabase, IconDownload, IconEye, IconFileSearch, IconKey, IconLock, IconMessageCircle, IconRefresh, IconSearch, IconShieldCheck, IconTool, IconTrash, IconUser, IconX } from '@tabler/icons-vue'
import { ConversationAuditApiError, copyConversationAudit, deleteConversationAudit, exportConversationAudit, fetchConversationAccessHistory, fetchConversationAudits, requestConversationAccess, type ConversationAccessHistoryResponse, type ConversationAccessResponse, type ConversationAuditFilters, type ConversationAuditRecord, type ConversationAuditResponse } from '../conversation-audit-api'
import AppPagination from '../components/AppPagination.vue'
import { useDebouncedSearch } from '../composables/useDebouncedSearch'
import { conciseModelName } from '../model-display'

export function useConversationAuditView() {
/**
 * All state and behaviour for the ConversationAuditView view.
 * Extracted verbatim from the component so the template keeps rendering identically.
 */

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

  return { IconAlertTriangle, IconCheck, IconChevronDown, IconChevronUp, IconClock, IconDatabase, IconDownload, IconEye, IconFileSearch, IconKey, IconLock, IconMessageCircle, IconRefresh, IconSearch, IconShieldCheck, IconTool, IconTrash, IconUser, IconX, access, accessError, accessHistory, accessRequest, applyFilters, auditConversationTitle, auditModelName, auditStatusText, canOpen, cancelSearch, changePage, clearDeleteCountdown, clearFilters, closeConversationDelete, closeSelection, conciseModelName, confirmConversationDelete, copyContent, copyText, data, dateTime, deleteCountdown, deleteCountdownTimer, deleteError, deleteRequest, deletionNotice, errorMessage, expiryText, exportContent, filters, hasRealContent, historyError, historyExpanded, historyRequest, isDeletingConversation, isHistoryLoading, isLoading, isOpening, isOperating, isPostgres, key, linkedRecordFromLocation, linkedRecordId, loadAccessHistory, loadData, model, normalizeConversationText, openContent, openConversationDelete, operationKey, operationMessage, operationRequest, page, pageSize, pendingConversationDeletion, period, person, policy, purpose, removeConversationRecord, request, search, selectRecord, selected, selectedStatus, sourceText, stateText, summaryCards, updatedAt, userQueriesFromText, visibleAccessHistory, visibleMessages }
}
