<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import {
  IconAlertTriangle, IconBan, IconCheck, IconChevronDown, IconChevronLeft, IconChevronRight, IconCopy,
  IconDotsVertical, IconFilter, IconKey, IconKeyOff, IconRefresh, IconSearch, IconShieldCheck, IconSparkles, IconTrash, IconUser, IconX,
} from '@tabler/icons-vue'
import { createKey, deleteKey, disableKey, enableKey, fetchKeySecret, fetchKeys, KeysApiError, type KeyCreateBody, type KeyCreateResponse, type KeyEnableBody, type KeyFilters, type KeyListItem, type KeysResponse } from '../keys-api'
import { useDebouncedSearch } from '../composables/useDebouncedSearch'
import { surnameInitial } from '../modules/people/person-display'
import { buildWorkBuddyModelsConfig, workBuddyConfigFileName } from '../workbuddy-config'

const route = useRoute()
const keys = ref<KeysResponse | null>(null)
const isLoading = ref(false)
const errorMessage = ref('')
const copied = ref('')
const copyingKeyId = ref<string | null>(null)
const copiedKeyId = ref<string | null>(null)
const keyCopyError = ref('')
const downloadingWorkBuddyKeyId = ref<string | null>(null)
const workBuddyConfigNotice = ref('')
let copiedKeyResetTimer: ReturnType<typeof setTimeout> | null = null
const search = ref('')
const owner = ref(typeof route.query.owner === 'string' ? route.query.owner : 'all')
const purpose = ref('all')
const model = ref('all')
const status = ref<KeyFilters['status']>('all')
const page = ref(1)
const pageSize = 10
const showCreate = ref(false)
const createError = ref('')
const isCreating = ref(false)
const createdKey = ref<KeyCreateResponse | null>(null)
type KeyAction = 'disable' | 'delete'
type PendingKeyAction = { key: KeyListItem; action: KeyAction }
type KeyActionForm = { idempotencyKey: string; reason: string; acknowledgeImpact: boolean }
const openMenuId = ref<string | null>(null)
const pendingKeyAction = ref<PendingKeyAction | null>(null)
const keyActionError = ref('')
const isKeyActionLoading = ref(false)
const keyDeleteCountdown = ref(0)
let keyDeleteCountdownTimer: ReturnType<typeof setInterval> | null = null
const disableForm = ref<KeyActionForm>({ idempotencyKey: '', reason: '', acknowledgeImpact: true })
const deleteForm = ref<KeyActionForm>({ idempotencyKey: '', reason: '', acknowledgeImpact: true })
const isEnabling = ref(false)
type LocalKeyCreateBody = Extract<KeyCreateBody, { ownerId: string }>
const createForm = ref<LocalKeyCreateBody>({ ownerId: '', purpose: '', model: '', expiresInDays: 90, deviceNote: '本地演示设备' })
const createIdempotencyKey = ref('')
const ownerSearch = ref('')
const modelSearch = ref('')
const ownerPickerOpen = ref(false)
const modelPickerOpen = ref(false)
const actionMenuPosition = ref({ top: 0, left: 0 })
let listRequest: AbortController | null = null

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
    { label: '30 天内到期', value: value?.expiring ?? '—', hint: '需要及时处理', icon: IconAlertTriangle, tone: 'amber' },
    { label: '已停用', value: value?.disabled ?? '—', hint: '不可继续调用', icon: IconKeyOff, tone: 'violet' },
  ]
})
const availableModels = computed(() => keys.value?.options.models.length ? keys.value.options.models : ['ecommerce-general'])
const managedKeys = computed(() => keys.value?.meta.source === 'new_api')
const selectedOwner = computed(() => keys.value?.options.owners.find(item => item.id === createForm.value.ownerId))
const ownerInputValue = computed(() => ownerSearch.value || (selectedOwner.value ? `${selectedOwner.value.name} · ${selectedOwner.value.department}` : ''))
const modelInputValue = computed(() => modelSearch.value || createForm.value.model)
const filteredOwners = computed(() => {
  const query = ownerSearch.value.trim().toLocaleLowerCase('zh-CN')
  return (keys.value?.options.owners ?? []).filter(item => {
    if (!query) return true
    return `${item.name} ${item.department}`.toLocaleLowerCase('zh-CN').includes(query)
  })
})
const filteredModels = computed(() => {
  const query = modelSearch.value.trim().toLocaleLowerCase('zh-CN')
  return availableModels.value.filter(item => !query || item.toLocaleLowerCase('zh-CN').includes(query))
})
const openMenuItem = computed(() => keys.value?.items.find(item => item.id === openMenuId.value) ?? null)
function dateText(value: string | null) { return value ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)) : '永久有效' }
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

function applyFilters() { cancelSearch(); page.value = 1; void loadKeys() }
function clearFilters() { search.value = ''; owner.value = 'all'; purpose.value = 'all'; model.value = 'all'; status.value = 'all'; applyFilters() }
function goToPage(next: number) { if (next < 1 || next > totalPages.value || next === page.value) return; page.value = next; void loadKeys() }

function openCreate() {
  createError.value = ''
  createdKey.value = null
  createIdempotencyKey.value = `key-create-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`
  createForm.value = { ownerId: '', purpose: '', model: '', expiresInDays: 90, deviceNote: '本地演示设备' }
  closePickers()
  showCreate.value = true
}

function closeCreate() {
  if (isCreating.value) return
  showCreate.value = false
  createdKey.value = null
  createError.value = ''
  closePickers()
}

function closePickers() {
  ownerPickerOpen.value = false
  modelPickerOpen.value = false
  ownerSearch.value = ''
  modelSearch.value = ''
}

function openOwnerPicker(event: FocusEvent) {
  ownerPickerOpen.value = true
  modelPickerOpen.value = false
  modelSearch.value = ''
  const input = event.currentTarget as HTMLInputElement | null
  if (input && createForm.value.ownerId) input.select()
}

function openModelPicker(event: FocusEvent) {
  modelPickerOpen.value = true
  ownerPickerOpen.value = false
  ownerSearch.value = ''
  const input = event.currentTarget as HTMLInputElement | null
  if (input && createForm.value.model) input.select()
}

function handleOwnerInput(event: Event) {
  const value = (event.target as HTMLInputElement).value
  const selected = selectedOwner.value
  ownerSearch.value = value
  if (createForm.value.ownerId && (!selected || value !== `${selected.name} · ${selected.department}`)) createForm.value.ownerId = ''
  ownerPickerOpen.value = true
  modelPickerOpen.value = false
}

function handleModelInput(event: Event) {
  const value = (event.target as HTMLInputElement).value
  modelSearch.value = value
  if (createForm.value.model && value !== createForm.value.model) createForm.value.model = ''
  modelPickerOpen.value = true
  ownerPickerOpen.value = false
}

function chooseOwner(id: string) {
  createForm.value.ownerId = id
  closePickers()
}

function chooseModel(value: string) {
  createForm.value.model = value
  closePickers()
}

async function submitCreate() {
  if (!createForm.value.ownerId) { createError.value = '请选择所属人员'; return }
  if (createForm.value.purpose.trim().length < 2) { createError.value = '请输入用途（至少 2 个字符）'; return }
  if (!createForm.value.model) { createError.value = '请选择一个绑定模型'; return }
  if (!availableModels.value.includes(createForm.value.model)) { createError.value = '请选择有效的业务模型'; return }
  isCreating.value = true
  createError.value = ''
  try {
    const payload: KeyCreateBody = managedKeys.value
      ? { personId: createForm.value.ownerId, purpose: createForm.value.purpose.trim(), model: createForm.value.model }
      : createForm.value
    createdKey.value = await createKey(payload, createIdempotencyKey.value)
    await loadKeys()
  } catch (error) {
    const requestId = error instanceof KeysApiError ? error.requestId : undefined
    createError.value = `${error instanceof Error ? error.message : '创建 Key 失败'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally { isCreating.value = false }
}

async function copyValue(label: string, value: string) { try { await navigator.clipboard.writeText(value); copied.value = label } catch { copied.value = '复制失败' } }
async function copyKeySecret(key: KeyListItem) {
  if (copyingKeyId.value) return
  copyingKeyId.value = key.id
  if (copiedKeyId.value === key.id) copiedKeyId.value = null
  keyCopyError.value = ''
  try {
    const response = await fetchKeySecret(key.id)
    if (!navigator.clipboard?.writeText) throw new Error('当前浏览器不支持复制到剪贴板')
    await navigator.clipboard.writeText(response.secret)
    copiedKeyId.value = key.id
    if (copiedKeyResetTimer) clearTimeout(copiedKeyResetTimer)
    copiedKeyResetTimer = setTimeout(() => {
      if (copiedKeyId.value === key.id) copiedKeyId.value = null
      copiedKeyResetTimer = null
    }, 2_200)
  } catch (error) {
    const requestId = error instanceof KeysApiError ? error.requestId : undefined
    keyCopyError.value = `${error instanceof Error ? error.message : '复制 Key 失败'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally {
    copyingKeyId.value = null
  }
}
function operationKey(prefix: 'key-disable' | 'key-enable' | 'key-delete') { return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}` }
function closeActionMenu() { openMenuId.value = null }
async function toggleActionMenu(id: string, event: MouseEvent) {
  if (openMenuId.value === id) {
    closeActionMenu()
    return
  }
  const button = event.currentTarget as HTMLElement | null
  if (!button) return
  const rect = button.getBoundingClientRect()
  const viewportPadding = 8
  const estimatedWidth = 160
  const estimatedHeight = 120
  const left = Math.min(Math.max(viewportPadding, rect.right - estimatedWidth), Math.max(viewportPadding, window.innerWidth - estimatedWidth - viewportPadding))
  let top = rect.bottom + 6
  if (top + estimatedHeight > window.innerHeight - viewportPadding) top = Math.max(viewportPadding, rect.top - estimatedHeight - 6)
  actionMenuPosition.value = { top, left }
  openMenuId.value = id
  await nextTick()
  if (openMenuId.value !== id) return
  const menu = document.querySelector<HTMLElement>('.key-action-menu')
  if (!menu) return
  const menuRect = menu.getBoundingClientRect()
  const boundedLeft = Math.min(Math.max(viewportPadding, rect.right - menuRect.width), Math.max(viewportPadding, window.innerWidth - menuRect.width - viewportPadding))
  const belowTop = rect.bottom + 6
  const boundedTop = belowTop + menuRect.height <= window.innerHeight - viewportPadding
    ? belowTop
    : Math.max(viewportPadding, rect.top - menuRect.height - 6)
  actionMenuPosition.value = { top: boundedTop, left: boundedLeft }
}
function clearDeleteCountdown() {
  if (keyDeleteCountdownTimer) {
    clearInterval(keyDeleteCountdownTimer)
    keyDeleteCountdownTimer = null
  }
  keyDeleteCountdown.value = 0
}
function closeKeyAction() {
  if (isKeyActionLoading.value) return
  pendingKeyAction.value = null
  keyActionError.value = ''
  clearDeleteCountdown()
}
function openKeyAction(key: KeyListItem, action: KeyAction) {
  closeActionMenu()
  pendingKeyAction.value = { key, action }
  keyActionError.value = ''
  clearDeleteCountdown()
  if (action === 'disable') {
    disableForm.value = { idempotencyKey: operationKey('key-disable'), reason: '', acknowledgeImpact: true }
    return
  }
  deleteForm.value = { idempotencyKey: operationKey('key-delete'), reason: '', acknowledgeImpact: true }
  keyDeleteCountdown.value = 5
  keyDeleteCountdownTimer = setInterval(() => {
    keyDeleteCountdown.value = Math.max(0, keyDeleteCountdown.value - 1)
    if (keyDeleteCountdown.value === 0) clearDeleteCountdown()
  }, 1000)
}
async function enableKeyFromMenu(key: KeyListItem) {
  closeActionMenu()
  if (isEnabling.value || key.status !== 'disabled') return
  isEnabling.value = true
  keyActionError.value = ''
  const payload: KeyEnableBody = { idempotencyKey: operationKey('key-enable'), acknowledgeImpact: true }
  try {
    await enableKey(key.id, payload)
    await loadKeys()
  } catch (error) {
    const requestId = error instanceof KeysApiError ? error.requestId : undefined
    keyActionError.value = `${error instanceof Error ? error.message : '启用 Key 失败'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally { isEnabling.value = false }
}
async function downloadWorkBuddyConfig(key: KeyListItem) {
  if (downloadingWorkBuddyKeyId.value) return
  const baseUrl = keys.value?.connection.baseUrl
  if (!baseUrl) {
    keyCopyError.value = '未获取到平台地址，无法生成 WorkBuddy 配置'
    closeActionMenu()
    return
  }

  downloadingWorkBuddyKeyId.value = key.id
  keyCopyError.value = ''
  workBuddyConfigNotice.value = ''
  try {
    const response = await fetchKeySecret(key.id)
    const config = buildWorkBuddyModelsConfig({ baseUrl, apiKey: response.secret, model: key.model })
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = workBuddyConfigFileName
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    workBuddyConfigNotice.value = `已下载 WorkBuddy ${workBuddyConfigFileName}；文件内 apiKey 已写入完整 Key，导入后可直接使用 ${key.model}。`
  } catch (error) {
    const requestId = error instanceof KeysApiError ? error.requestId : undefined
    keyCopyError.value = `${error instanceof Error ? error.message : '生成 WorkBuddy 配置失败'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally {
    downloadingWorkBuddyKeyId.value = null
    closeActionMenu()
  }
}
async function submitKeyAction() {
  const pending = pendingKeyAction.value
  if (!pending || isKeyActionLoading.value) return
  if (pending.action === 'delete' && keyDeleteCountdown.value > 0) return
  isKeyActionLoading.value = true
  keyActionError.value = ''
  try {
    if (pending.action === 'disable') await disableKey(pending.key.id, { ...disableForm.value, acknowledgeImpact: true })
    else await deleteKey(pending.key.id, { ...deleteForm.value, acknowledgeImpact: true })
    await loadKeys()
    pendingKeyAction.value = null
    keyActionError.value = ''
    clearDeleteCountdown()
  } catch (error) {
    const requestId = error instanceof KeysApiError ? error.requestId : undefined
    keyActionError.value = `${error instanceof Error ? error.message : pending.action === 'disable' ? '禁用 Key 失败' : '删除 Key 失败'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally { isKeyActionLoading.value = false }
}

const { cancel: cancelSearch } = useDebouncedSearch(search, () => { page.value = 1; void loadKeys() })

function handleDocumentClick() { closeActionMenu() }
onMounted(() => {
  document.addEventListener('click', handleDocumentClick)
  void loadKeys()
})
onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick)
  listRequest?.abort()
  clearDeleteCountdown()
  if (copiedKeyResetTimer) clearTimeout(copiedKeyResetTimer)
})
</script>

<template>
  <div class="dashboard keys-dashboard">
    <section class="page-heading">
      <div><div class="eyebrow">ACCESS CREDENTIALS</div><h1>Key 管理</h1><p>按人员、用途和模型检查访问凭据；完整 Key 不在列表展示，可点击复制按钮按需获取。</p></div>
      <div class="heading-actions"><span class="updated-at">更新于 {{ updatedAt }}</span><button class="btn btn-white refresh-button" :disabled="isLoading" @click="loadKeys"><IconRefresh :size="17" :class="{ spinning: isLoading }" />刷新</button><button class="btn create-key" type="button" :disabled="isLoading || !keys" @click="openCreate"><IconKey :size="17" />创建 Key</button></div>
    </section>

    <div v-if="keys" class="source-banner"><span>{{ keys.meta.source.toUpperCase() }}</span>{{ keys.meta.notice }}</div>
    <section class="key-summary-grid" aria-label="Key 状态摘要"><article v-for="card in summaryCards" :key="card.label" class="metric-card"><div class="metric-top"><span class="metric-label">{{ card.label }}</span><span class="metric-icon" :class="`tone-${card.tone}`"><component :is="card.icon" :size="19" /></span></div><strong class="metric-value">{{ card.value }}</strong><div class="metric-foot">{{ card.hint }}</div></article></section>

    <section class="panel keys-main-panel">
      <form class="key-filters" @submit.prevent="applyFilters">
        <label class="key-search"><IconSearch :size="17" /><input v-model="search" aria-label="搜索 Key" type="search" maxlength="60" placeholder="搜索 Key 掩码、人员、部门、用途或模型" /></label>
        <label><IconUser :size="15" /><select v-model="owner" @change="applyFilters"><option value="all">全部人员</option><option v-for="item in keys?.options.owners ?? []" :key="item.id" :value="item.id">{{ item.name }} · {{ item.department }}</option></select></label>
        <label><IconFilter :size="15" /><select v-model="purpose" @change="applyFilters"><option value="all">全部用途</option><option v-for="item in keys?.options.purposes ?? []" :key="item" :value="item">{{ item }}</option></select></label>
        <label><IconSparkles :size="15" /><select v-model="model" @change="applyFilters"><option value="all">全部模型</option><option v-for="item in keys?.options.models ?? []" :key="item" :value="item">{{ item }}</option></select></label>
        <label><IconShieldCheck :size="15" /><select v-model="status" @change="applyFilters"><option value="all">全部状态</option><option value="active">正常启用</option><option value="expiring">30 天内到期</option><option value="disabled">已停用</option></select></label>
        <span class="realtime-search-hint" aria-live="polite">输入即搜索</span><button class="text-button" type="button" @click="clearFilters">清除</button>
      </form>

      <div v-if="!keys && !errorMessage" class="data-state"><div class="state-icon"><IconRefresh :size="22" class="spinning" /></div><div><strong>正在读取 Key 列表</strong><p>正在从 BFF 获取脱敏后的访问凭据…</p></div></div>
      <div v-else-if="errorMessage" class="data-state failed"><div class="state-icon"><IconAlertTriangle :size="22" /></div><div><strong>Key 数据加载失败</strong><p>{{ errorMessage }}</p></div><button class="btn btn-white" @click="loadKeys">重试</button></div>
      <template v-else-if="keys">
        <div v-if="keyActionError && !pendingKeyAction" class="person-action-inline-error"><IconAlertTriangle :size="15" />{{ keyActionError }}<button type="button" aria-label="关闭操作错误" @click="keyActionError = ''">×</button></div>
        <div v-if="keyCopyError" class="person-action-inline-error key-copy-error"><IconAlertTriangle :size="15" />{{ keyCopyError }}<button type="button" aria-label="关闭复制错误" @click="keyCopyError = ''">×</button></div>
        <div v-if="workBuddyConfigNotice" class="person-action-inline-success key-copy-error"><IconCheck :size="15" />{{ workBuddyConfigNotice }}<button type="button" aria-label="关闭 WorkBuddy 配置提示" @click="workBuddyConfigNotice = ''">×</button></div>
         <div v-if="keys.items.length" class="table-responsive" @click="closeActionMenu"><table class="data-table keys-table"><thead><tr><th>所属人员</th><th>部门</th><th>用途</th><th>API密钥（KEY掩码）</th><th>绑定模型</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="item in keys.items" :key="item.id"><td><div class="person-cell"><span class="person-avatar avatar-blue">{{ surnameInitial(item.owner.name) }}</span><span><strong>{{ item.owner.name }}</strong></span></div></td><td><span class="department-cell">{{ item.owner.department }}</span></td><td><span class="purpose-tag">{{ item.purpose }}</span></td><td><span class="key-copy-cell"><code class="masked-key">{{ item.masked }}</code><button class="key-copy-button" type="button" :disabled="copyingKeyId === item.id" :aria-label="`复制 ${item.masked}`" :title="copiedKeyId === item.id ? '已复制完整 Key' : '复制完整 Key'" @click.stop="copyKeySecret(item)"><IconRefresh v-if="copyingKeyId === item.id" :size="13" class="spinning" /><IconCheck v-else-if="copiedKeyId === item.id" :size="13" /><IconCopy v-else :size="13" /></button></span></td><td><div class="model-tags"><span>{{ item.model }}</span></div></td><td><span class="person-status" :class="`status-${item.status}`"><i />{{ item.status === 'active' ? '启用' : '停用' }}</span></td><td class="key-action-cell"><button class="key-more-button" type="button" :aria-label="`${item.masked} 操作`" :aria-expanded="openMenuId === item.id" @click.stop="toggleActionMenu(item.id, $event)"><IconDotsVertical :size="18" aria-hidden="true" /></button></td></tr></tbody></table><Teleport to="body"><div v-if="openMenuItem" class="key-action-menu" role="menu" :style="{ top: `${actionMenuPosition.top}px`, left: `${actionMenuPosition.left}px` }" @click.stop><button type="button" role="menuitem" @click="openMenuItem.status === 'active' ? openKeyAction(openMenuItem, 'disable') : enableKeyFromMenu(openMenuItem)">{{ openMenuItem.status === 'active' ? '禁用' : '启用' }}</button><button type="button" role="menuitem" :disabled="downloadingWorkBuddyKeyId === openMenuItem.id" @click="downloadWorkBuddyConfig(openMenuItem)">{{ downloadingWorkBuddyKeyId === openMenuItem.id ? '正在生成 WorkBuddy 配置…' : '下载 WorkBuddy 配置' }}</button><button type="button" role="menuitem" class="danger-menu-item" @click="openKeyAction(openMenuItem, 'delete')">删除</button></div></Teleport></div>
        <div v-else class="people-empty"><IconKey :size="24" /><strong>没有符合条件的 Key</strong><span>调整人员、用途、模型或状态筛选。</span><button class="text-button" @click="clearFilters">清除筛选</button></div>
        <footer class="table-footer"><span>{{ rangeText }}</span><div><button :disabled="page <= 1 || isLoading" aria-label="上一页" @click="goToPage(page - 1)"><IconChevronLeft :size="16" /></button><strong>第 {{ page }} / {{ totalPages }} 页</strong><button :disabled="page >= totalPages || isLoading" aria-label="下一页" @click="goToPage(page + 1)"><IconChevronRight :size="16" /></button></div></footer>
      </template>
    </section>

    <footer class="page-footer">数据来源：{{ keys?.meta.source.toUpperCase() ?? '等待数据' }} · {{ managedKeys ? '创建、启用、禁用与删除通过 New API 生效；管理员可按需复制完整 Key，服务端不保存明文。' : '新建、启用、禁用与删除仅作用于本地 SQLite 演示数据；管理员可按需复制完整 Key。' }}</footer>

    <div v-if="showCreate" class="drawer-backdrop" @click.self="closeCreate">
       <aside class="create-key-dialog" :class="{ 'has-open-picker': ownerPickerOpen || modelPickerOpen }" role="dialog" aria-modal="true" aria-label="创建 Key">
        <header><div><span class="source-tag demo">{{ managedKeys ? 'NEW API' : 'SQLITE' }}</span><h2>{{ createdKey ? 'Key 已创建' : '创建 Key' }}</h2></div><button class="icon-button" aria-label="关闭创建 Key" :disabled="isCreating" @click="closeCreate"><IconX :size="20" /></button></header>
        <template v-if="createdKey">
          <section class="created-key-success"><IconCheck :size="22" /><strong>Key 已创建</strong><p>{{ managedKeys ? 'Key 由 New API 管理员账号创建，AI OPS 按所选人员显示归属；创建响应会返回一次，之后也可在列表点击复制按钮按需获取。' : '请复制保存；关闭窗口后列表只显示 Key 掩码，也可在列表按需复制。' }}</p><div><code>{{ createdKey.secret }}</code><button class="btn btn-white" @click="copyValue('created-secret', createdKey.secret)"><IconCheck v-if="copied === 'created-secret'" :size="15" /><IconCopy v-else :size="15" />{{ copied === 'created-secret' ? '已复制' : '复制' }}</button></div><small>{{ createdKey.key.owner.name }} · {{ createdKey.key.purpose }} · {{ createdKey.key.expiresAt ? `${dateText(createdKey.key.expiresAt)} 到期` : '永久有效' }}</small></section>
          <footer class="create-key-dialog-footer"><button class="btn create-key" @click="closeCreate">完成</button></footer>
        </template>
        <form v-else class="create-key-form" @submit.prevent="submitCreate" @click="closePickers">
          <p class="create-person-note">{{ managedKeys ? 'Key 会在 AI OPS 按当前有效人员显示归属；New API 由管理员账号创建，并绑定一个 CPA 模型，额度不限且永久有效。完整凭据会在创建响应中返回，之后可在列表按需复制。' : '创建本地演示 Key。数据库保存加密凭据，列表默认仅显示掩码，管理员可按需复制完整值。' }}</p>
          <label>
            <span>所属人员</span>
            <div class="key-picker" :class="{ 'is-open': ownerPickerOpen }" @click.stop>
              <IconSearch :size="14" />
              <input id="owner-picker-trigger" :value="ownerInputValue" type="search" role="combobox" aria-haspopup="listbox" aria-controls="owner-picker-menu" :aria-expanded="ownerPickerOpen" aria-autocomplete="list" autocomplete="off" maxlength="60" aria-label="搜索所属人员" placeholder="搜索或选择人员" @focus="openOwnerPicker" @input="handleOwnerInput" @keydown.esc="closePickers" />
              <IconChevronDown :size="16" :class="{ rotated: ownerPickerOpen }" />
              <div v-if="ownerPickerOpen" id="owner-picker-menu" class="key-picker-menu" role="listbox" aria-label="所属人员选项">
                <button v-for="item in filteredOwners" :key="item.id" type="button" class="key-picker-option" :class="{ 'is-selected': createForm.ownerId === item.id }" role="option" :aria-selected="createForm.ownerId === item.id" @click="chooseOwner(item.id)"><span>{{ item.name }} · {{ item.department }}</span><IconCheck v-if="createForm.ownerId === item.id" :size="15" /></button>
                <p v-if="!filteredOwners.length" class="key-picker-empty">没有匹配的人员</p>
              </div>
            </div>
          </label>
          <label><span>用途</span><input v-model="createForm.purpose" required minlength="2" maxlength="40" placeholder="例如：Codex 开发、接口测试" /></label>
          <label>
            <span>绑定模型</span>
            <div class="key-picker" :class="{ 'is-open': modelPickerOpen }" @click.stop>
              <IconSearch :size="14" />
              <input id="model-picker-trigger" :value="modelInputValue" type="search" role="combobox" aria-haspopup="listbox" aria-controls="model-picker-menu" :aria-expanded="modelPickerOpen" aria-autocomplete="list" autocomplete="off" maxlength="80" aria-label="搜索绑定模型" placeholder="搜索或选择模型" @focus="openModelPicker" @input="handleModelInput" @keydown.esc="closePickers" />
              <IconChevronDown :size="16" :class="{ rotated: modelPickerOpen }" />
              <div v-if="modelPickerOpen" id="model-picker-menu" class="key-picker-menu" role="listbox" aria-label="绑定模型选项">
                <button v-for="item in filteredModels" :key="item" type="button" class="key-picker-option" :class="{ 'is-selected': createForm.model === item }" role="option" :aria-selected="createForm.model === item" @click="chooseModel(item)"><span>{{ item }}</span><IconCheck v-if="createForm.model === item" :size="15" /></button>
                <p v-if="!filteredModels.length" class="key-picker-empty">没有匹配的模型</p>
              </div>
            </div>
            <small class="create-person-field-hint">一个 Key 只能调用一个模型；需要多个模型时，请分别创建多个 Key。</small>
          </label>
          <label v-if="!managedKeys"><span>有效期（天）</span><input v-model.number="createForm.expiresInDays" required min="1" max="365" type="number" /></label>
          <label v-if="!managedKeys"><span>设备备注</span><input v-model="createForm.deviceNote" maxlength="120" placeholder="本地演示设备" /></label>
          <div v-if="createError" class="create-person-error"><IconAlertTriangle :size="16" />{{ createError }}</div>
          <footer><button class="btn btn-white" type="button" :disabled="isCreating" @click="closeCreate">取消</button><button class="btn create-key" type="submit" :disabled="isCreating">{{ isCreating ? '生成中…' : '生成 Key' }}</button></footer>
        </form>
      </aside>
    </div>

    <div v-if="pendingKeyAction" class="drawer-backdrop" @click.self="closeKeyAction">
        <aside class="person-action-dialog key-action-dialog" role="dialog" aria-modal="true" :aria-label="pendingKeyAction.action === 'delete' ? '确认删除 Key' : '确认禁用 Key'">
         <header><div><span class="person-action-dialog-icon" :class="pendingKeyAction.action === 'delete' ? 'dialog-delete' : 'dialog-disable'"><IconBan v-if="pendingKeyAction.action === 'disable'" :size="17" /><IconTrash v-else :size="17" /></span><div><span class="source-tag demo">Key 操作</span><h2>{{ pendingKeyAction.action === 'delete' ? '确认删除 Key' : '确认禁用 Key' }}</h2></div></div><button class="icon-button" aria-label="关闭确认窗口" :disabled="isKeyActionLoading" @click="closeKeyAction"><IconX :size="20" /></button></header>
         <section class="person-action-dialog-body"><strong>{{ pendingKeyAction.key.masked }}</strong><p v-if="pendingKeyAction.action === 'disable'">禁用后，该 Key 将不能继续调用；人员、用途和历史用量仍会保留。</p><p v-else>删除后，该 Key 将从列表移除；历史用量和审计记录会保留，且不能恢复。</p><p v-if="pendingKeyAction.action === 'delete' && keyDeleteCountdown > 0" class="key-delete-countdown">为避免误删，请等待 {{ keyDeleteCountdown }} 秒后确认。</p><div v-if="keyActionError" class="create-person-error"><IconAlertTriangle :size="16" />{{ keyActionError }}</div></section>
         <footer class="person-action-dialog-footer"><button class="btn btn-white" type="button" :disabled="isKeyActionLoading" @click="closeKeyAction">取消</button><button class="btn" :class="pendingKeyAction.action === 'delete' ? 'danger-outline' : 'person-action-confirm-disable'" type="button" :disabled="isKeyActionLoading || (pendingKeyAction.action === 'delete' && keyDeleteCountdown > 0)" @click="submitKeyAction">{{ isKeyActionLoading ? (pendingKeyAction.action === 'delete' ? '删除中…' : '禁用中…') : pendingKeyAction.action === 'delete' && keyDeleteCountdown > 0 ? `确认删除（${keyDeleteCountdown}s）` : pendingKeyAction.action === 'delete' ? '确认删除' : '确认禁用' }}</button></footer>
      </aside>
    </div>
  </div>
</template>
