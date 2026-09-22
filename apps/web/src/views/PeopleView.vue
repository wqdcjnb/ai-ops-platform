<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  IconAlertTriangle,
  IconBan,
  IconBuilding,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconFileText,
  IconFilter,
  IconRefresh,
  IconSearch,
  IconUpload,
  IconUserCheck,
  IconUserPlus,
  IconUsers,
  IconTrash,
} from '@tabler/icons-vue'
import { createPeopleBatch, createPerson, deletePerson, disablePerson, enablePerson, fetchPeople, PeopleApiError, type PeopleFilters, type PeopleResponse, type Person, type PersonBatchCreateResponse, type PersonCreateBody, type PersonCreateResponse } from '../people-api'
import { useDebouncedSearch } from '../composables/useDebouncedSearch'
import { preflightPeopleImport, type PeopleImportRow, PEOPLE_IMPORT_HEADERS_ZH } from '../people-import'
import { surnameInitial } from '../modules/people/person-display'

const people = ref<PeopleResponse | null>(null)
const isLoading = ref(false)
const errorMessage = ref('')
const search = ref('')
const department = ref('all')
const status = ref<PeopleFilters['status']>('all')
const goal = ref<PeopleFilters['goal']>('all')
const page = ref(1)
const pageSize = 10
const showCreate = ref(false)
const createError = ref('')
const isCreating = ref(false)
const createdPerson = ref<PersonCreateResponse | null>(null)
const createForm = ref<PersonCreateBody>({ displayName: '', departmentId: 'content' })
const showImport = ref(false)
const importFileName = ref('')
const importError = ref('')
const importRows = ref<PeopleImportRow[]>([])
const importInput = ref<HTMLInputElement | null>(null)
const batchResult = ref<PersonBatchCreateResponse | null>(null)
const isImporting = ref(false)
let activeRequest: AbortController | null = null
let deleteCountdownTimer: ReturnType<typeof setInterval> | null = null

type PersonAction = 'enable' | 'disable' | 'delete'
type PendingPersonAction = { person: Person; action: Exclude<PersonAction, 'enable'> }
const personActionValues: PersonAction[] = ['enable', 'disable', 'delete']
const personActionLabels: Record<PersonAction, string> = { enable: '启用', disable: '停用', delete: '删除' }
const personActionSelections = ref<Record<string, PersonAction>>({})
const pendingPersonAction = ref<PendingPersonAction | null>(null)
const personActionError = ref('')
const isPersonActionLoading = ref(false)
const deleteCountdown = ref(0)

const statusLabels: Record<Person['status'], string> = { active: '在职', disabled: '已停用', offboarding: '待回收', unknown: '未知', external_missing: '外部已找不到' }
const goalLabels: Record<Person['goal']['state'], string> = { normal: '正常', near: '接近目标', reached: '已达目标' }
const totalPages = computed(() => Math.max(1, Math.ceil((people.value?.total ?? 0) / pageSize)))
const rangeText = computed(() => {
  if (!people.value?.total) return '0 条结果'
  const start = (people.value.page - 1) * people.value.pageSize + 1
  const end = Math.min(start + people.value.items.length - 1, people.value.total)
  return `${start}–${end} / ${people.value.total}`
})
const updatedAt = computed(() => {
  if (!people.value) return '等待数据'
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(people.value.meta.generatedAt))
})
const canImport = computed(() => importRows.value.length > 0 && !importRows.value.some((row) => row.error) && !importError.value && !isImporting.value)
const syncPending = computed(() => Boolean(people.value?.meta.notice.includes('尚未同步')))
const sourceBadge = computed(() => {
  if (!people.value) return { label: '等待', className: 'pending' }
  if (syncPending.value) return { label: '待同步', className: 'pending' }
  if (people.value.items.some((person) => person.source === 'new-api')) return { label: 'AUTO', className: 'live' }
  return { label: people.value.meta.source === 'database' ? 'LOCAL' : 'DEMO', className: people.value.meta.source === 'database' ? 'local' : 'demo' }
})

const summaryCards = computed(() => {
  const value = people.value?.summary
  return [
    { label: '全部人员', value: value?.total ?? '—', hint: `${value?.departments ?? '—'} 个部门`, icon: IconUsers, tone: 'teal' },
    { label: '在职人员', value: value?.active ?? '—', hint: '来自 New API 的启用状态', icon: IconUserCheck, tone: 'green' },
  ]
})

function relativeTime(value: string | null) {
  if (!value) return '从未调用'
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小时前`
  return `${Math.round(minutes / 1440)} 天前`
}

function formatDate(value: string | null | undefined) {
  if (!value) return '未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

function currentFilters(): PeopleFilters {
  return { search: search.value.trim(), department: department.value, status: status.value, goal: goal.value, page: page.value, pageSize }
}

async function loadPeople() {
  activeRequest?.abort()
  const request = new AbortController()
  activeRequest = request
  isLoading.value = true
  errorMessage.value = ''
  try {
    people.value = await fetchPeople(currentFilters(), request.signal)
  } catch (error) {
    if (request.signal.aborted) return
    const requestId = error instanceof PeopleApiError ? error.requestId : undefined
    errorMessage.value = `${error instanceof Error ? error.message : '人员数据暂时无法加载'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally {
    if (activeRequest === request) isLoading.value = false
  }
}

function applyFilters() {
  cancelSearch()
  page.value = 1
  void loadPeople()
}

function clearFilters() {
  search.value = ''
  department.value = 'all'
  status.value = 'all'
  goal.value = 'all'
  applyFilters()
}

function operationKey(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`
}

function actionSelection(person: Person): PersonAction {
  const selected = personActionSelections.value[person.id]
  return selected ?? (person.status === 'disabled' ? 'disable' : 'enable')
}

function actionValuesFor(_person: Person) {
  return personActionValues
}

function resetPersonAction(person: Person) {
  const next = { ...personActionSelections.value }
  delete next[person.id]
  personActionSelections.value = next
}

function clearDeleteCountdown() {
  if (deleteCountdownTimer) {
    clearInterval(deleteCountdownTimer)
    deleteCountdownTimer = null
  }
  deleteCountdown.value = 0
}

function closePersonAction() {
  if (isPersonActionLoading.value || !pendingPersonAction.value) return
  resetPersonAction(pendingPersonAction.value.person)
  pendingPersonAction.value = null
  personActionError.value = ''
  clearDeleteCountdown()
}

function openPersonAction(person: Person, action: Exclude<PersonAction, 'enable'>) {
  pendingPersonAction.value = { person, action }
  personActionError.value = ''
  clearDeleteCountdown()
  if (action === 'delete') {
    deleteCountdown.value = 5
    deleteCountdownTimer = setInterval(() => {
      deleteCountdown.value = Math.max(0, deleteCountdown.value - 1)
      if (deleteCountdown.value === 0) clearDeleteCountdown()
    }, 1000)
  }
}

async function enablePersonFromSlider(person: Person) {
  if (isPersonActionLoading.value) return
  if (person.status === 'active') {
    resetPersonAction(person)
    return
  }
  isPersonActionLoading.value = true
  personActionError.value = ''
  try {
    await enablePerson(person.id, { idempotencyKey: operationKey('person-enable'), acknowledgeImpact: true })
    resetPersonAction(person)
    await loadPeople()
  } catch (error) {
    const requestId = error instanceof PeopleApiError ? error.requestId : undefined
    personActionError.value = `${error instanceof Error ? error.message : '启用人员失败'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
    resetPersonAction(person)
  } finally {
    isPersonActionLoading.value = false
  }
}

function handlePersonActionInput(person: Person, index: number) {
  const values = actionValuesFor(person)
  const action = values[Math.max(0, Math.min(values.length - 1, index))] ?? 'enable'
  personActionSelections.value = { ...personActionSelections.value, [person.id]: action }
  if (action === 'enable') {
    void enablePersonFromSlider(person)
  } else {
    openPersonAction(person, action)
  }
}

async function confirmPersonAction() {
  const pending = pendingPersonAction.value
  if (!pending || isPersonActionLoading.value || (pending.action === 'delete' && deleteCountdown.value > 0)) return
  isPersonActionLoading.value = true
  personActionError.value = ''
  try {
    if (pending.action === 'disable') {
      await disablePerson(pending.person.id, { idempotencyKey: operationKey('person-disable'), acknowledgeImpact: true })
    } else {
      await deletePerson(pending.person.id, { idempotencyKey: operationKey('person-delete'), reason: '', acknowledgeImpact: true })
    }
    resetPersonAction(pending.person)
    pendingPersonAction.value = null
    clearDeleteCountdown()
    await loadPeople()
  } catch (error) {
    const requestId = error instanceof PeopleApiError ? error.requestId : undefined
    personActionError.value = `${error instanceof Error ? error.message : pending.action === 'disable' ? '停用人员失败' : '删除人员失败'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally {
    isPersonActionLoading.value = false
  }
}

function goToPage(nextPage: number) {
  if (nextPage < 1 || nextPage > totalPages.value || nextPage === page.value) return
  page.value = nextPage
  void loadPeople()
}

function openCreate() {
  createError.value = ''
  createdPerson.value = null
  createForm.value = { displayName: '', departmentId: '' }
  showCreate.value = true
}

function closeCreate() {
  if (isCreating.value) return
  showCreate.value = false
  createdPerson.value = null
}

function openImport() {
  importFileName.value = ''
  importError.value = ''
  importRows.value = []
  batchResult.value = null
  showImport.value = true
}

function closeImport() {
  showImport.value = false
  importFileName.value = ''
  importError.value = ''
  importRows.value = []
  batchResult.value = null
}

function downloadImportTemplate() {
  const csv = `\uFEFF${PEOPLE_IMPORT_HEADERS_ZH.join(',')}\n`
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'people-import-template.csv'
  link.click()
  URL.revokeObjectURL(url)
}

async function handleImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  importRows.value = []
  importError.value = ''
  if (!file) return
  if (!file.name.toLowerCase().endsWith('.csv')) {
    importError.value = '请选择 CSV 文件'
    input.value = ''
    return
  }
  if (file.size > 1_000_000) {
    importError.value = '文件不能超过 1 MB'
    input.value = ''
    return
  }
  importFileName.value = file.name
  const result = preflightPeopleImport(await file.text(), people.value?.departments ?? [])
  importRows.value = result.rows
  if (result.truncated) importError.value = '文件超过 200 行，仅预检前 200 行，请拆分文件后重试。'
}

async function submitImport() {
  if (!canImport.value) return
  isImporting.value = true
  importError.value = ''
  try {
    batchResult.value = await createPeopleBatch({
      idempotencyKey: `people-import-${crypto.randomUUID()}`,
      items: importRows.value.map(({ username, displayName, departmentId, password }) => ({ ...(username ? { username } : {}), displayName, departmentId, ...(password ? { password } : {}) })),
    })
    importRows.value = []
    page.value = 1
    await loadPeople()
  } catch (error) {
    const requestId = error instanceof PeopleApiError ? error.requestId : undefined
    importError.value = `${error instanceof Error ? error.message : '批量导入人员失败'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally {
    isImporting.value = false
  }
}

async function submitCreate() {
  isCreating.value = true
  createError.value = ''
  try {
    createdPerson.value = await createPerson(createForm.value)
    page.value = 1
    await loadPeople()
  } catch (error) {
    const requestId = error instanceof PeopleApiError ? error.requestId : undefined
    createError.value = `${error instanceof Error ? error.message : '添加人员失败'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  } finally {
    isCreating.value = false
  }
}

const { cancel: cancelSearch } = useDebouncedSearch(search, () => {
  page.value = 1
  void loadPeople()
})

onMounted(() => void loadPeople())
onBeforeUnmount(() => {
  activeRequest?.abort()
  clearDeleteCountdown()
})
</script>

<template>
  <div class="dashboard people-dashboard">
    <section class="page-heading">
      <div>
        <div class="eyebrow">PEOPLE & ORGANIZATION</div>
        <h1>人员与部门</h1>
        <p>按组织归属查看人员状态和访问凭据。</p>
      </div>
      <div class="heading-actions">
        <span class="updated-at">更新于 {{ updatedAt }}</span>
        <button class="btn btn-white refresh-button" :disabled="isLoading" @click="loadPeople"><IconRefresh :size="17" :class="{ spinning: isLoading }" />刷新</button>
        <button class="btn btn-white" disabled title="真实数据与权限接入后开放"><IconDownload :size="16" />导出</button>
        <button class="btn btn-white" type="button" @click="openImport"><IconUpload :size="16" />批量导入</button>
        <button class="btn create-key" type="button" @click="openCreate"><IconUserPlus :size="17" />添加人员</button>
      </div>
    </section>

    <div v-if="people" class="source-banner"><span :class="sourceBadge.className">{{ sourceBadge.label }}</span>{{ people.meta.notice }}</div>

    <section class="people-summary-grid" aria-label="人员状态摘要">
      <article v-for="card in summaryCards" :key="card.label" class="metric-card people-summary-card">
        <div class="metric-top"><span class="metric-label">{{ card.label }}</span><span class="metric-icon" :class="`tone-${card.tone}`"><component :is="card.icon" :size="19" /></span></div>
        <strong class="metric-value">{{ card.value }}</strong>
        <div class="metric-foot">{{ card.hint }}</div>
      </article>
    </section>

    <section class="panel people-panel-main">
      <form class="people-filters" @submit.prevent="applyFilters">
        <label class="people-search"><IconSearch :size="17" /><input v-model="search" aria-label="搜索姓名或岗位" type="search" maxlength="60" placeholder="搜索姓名或岗位" /></label>
        <label><IconBuilding :size="16" /><select v-model="department" @change="applyFilters"><option value="all">全部部门</option><option v-for="item in people?.departments ?? []" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
        <label><IconUsers :size="16" /><select v-model="status" @change="applyFilters"><option value="all">全部状态</option><option value="active">启用</option><option value="disabled">停用</option></select></label>
        <span class="realtime-search-hint" aria-live="polite">输入即搜索</span>
        <button class="text-button clear-filter" type="button" @click="clearFilters">清除</button>
      </form>

      <div v-if="!people && !errorMessage" class="data-state"><div class="state-icon"><IconRefresh :size="22" class="spinning" /></div><div><strong>正在读取人员数据</strong><p>正在从 BFF 获取经过校验的人员列表…</p></div></div>
      <div v-else-if="errorMessage" class="data-state failed"><div class="state-icon"><IconAlertTriangle :size="22" /></div><div><strong>人员数据加载失败</strong><p>{{ errorMessage }}</p></div><button class="btn btn-white" @click="loadPeople">重试</button></div>
      <template v-else-if="people">
        <div v-if="personActionError && !pendingPersonAction" class="person-action-inline-error"><IconAlertTriangle :size="15" />{{ personActionError }}<button type="button" aria-label="关闭操作错误" @click="personActionError = ''">×</button></div>
        <div v-if="people.items.length" class="table-responsive">
          <table class="data-table people-table">
            <thead><tr><th>人员</th><th>部门</th><th>Key 数量</th><th>状态</th><th>创建时间</th><th>最后使用</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="person in people.items" :key="person.id">
                <td><div class="person-cell"><span class="person-avatar" :class="`avatar-${person.tone}`">{{ surnameInitial(person.username || person.name) }}</span><span><strong>{{ person.username || person.name }}</strong></span></div></td>
                <td>{{ person.department.name }}</td>
                <td><span class="key-count">{{ person.keyCount }}</span></td>
                <td><span class="person-status" :class="`status-${person.status}`"><i />{{ statusLabels[person.status] }}</span></td>
                <td class="last-active">{{ formatDate(person.createdAt) }}</td>
                <td class="last-active">{{ formatDate(person.lastUsedAt || person.lastActiveAt) }}</td>
                <td class="person-action-cell">
                  <div class="person-action-control" :class="`action-${actionSelection(person)}`">
                    <div class="person-action-track" aria-hidden="true"><span class="action-enable">启用</span><span class="action-disable">停用</span><span class="action-delete">删除</span></div>
                    <input class="person-action-range" type="range" min="0" :max="actionValuesFor(person).length - 1" step="1" :value="actionValuesFor(person).indexOf(actionSelection(person))" :aria-label="`${person.name}操作`" :aria-valuetext="personActionLabels[actionSelection(person)]" @input="handlePersonActionInput(person, Number(($event.target as HTMLInputElement).value))" />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="people-empty"><IconUsers :size="24" /><strong>{{ syncPending ? '尚未同步 New API 用户' : '没有符合条件的人员' }}</strong><span>{{ syncPending ? '页面会自动读取普通用户目录，请稍后刷新查看。' : '调整搜索词或筛选条件后重试。' }}</span><button v-if="!syncPending" class="text-button" type="button" @click="clearFilters">清除筛选</button></div>
        <footer class="table-footer"><span>{{ rangeText }}</span><div><button :disabled="page <= 1 || isLoading" aria-label="上一页" @click="goToPage(page - 1)"><IconChevronLeft :size="16" /></button><strong>第 {{ page }} / {{ totalPages }} 页</strong><button :disabled="page >= totalPages || isLoading" aria-label="下一页" @click="goToPage(page + 1)"><IconChevronRight :size="16" /></button></div></footer>
      </template>
    </section>

    <footer class="page-footer">数据来源：{{ syncPending ? '等待 New API 自动同步' : people?.items.some((person) => person.source === 'new-api') ? 'New API 自动同步快照' : '本地兼容数据' }} · 本页只管理人员身份和状态，不创建 Key 或额度</footer>

    <div v-if="pendingPersonAction" class="drawer-backdrop" @click.self="closePersonAction">
      <aside class="person-action-dialog" role="dialog" aria-modal="true" :aria-label="pendingPersonAction.action === 'disable' ? '确认停用人员' : '确认删除人员'">
        <header>
          <div><span class="person-action-dialog-icon" :class="`dialog-${pendingPersonAction.action}`"><IconBan v-if="pendingPersonAction.action === 'disable'" :size="17" /><IconTrash v-else :size="17" /></span><div><span class="source-tag demo">人员状态</span><h2>{{ pendingPersonAction.action === 'disable' ? '确认停用人员' : '确认删除人员' }}</h2></div></div>
          <button class="icon-button" aria-label="关闭确认窗口" :disabled="isPersonActionLoading" @click="closePersonAction">×</button>
        </header>
        <section class="person-action-dialog-body">
          <strong>{{ pendingPersonAction.person.name }}</strong>
          <p v-if="pendingPersonAction.action === 'disable'">停用后，该人员将不能继续使用关联 Key；人员记录和历史用量仍会保留。</p>
          <p v-else>删除后，该人员将从人员目录移除；历史用量、审计记录和已回收 Key 会保留，且不能恢复。</p>
          <div v-if="personActionError" class="create-person-error"><IconAlertTriangle :size="16" />{{ personActionError }}</div>
        </section>
        <footer class="person-action-dialog-footer">
          <button class="btn btn-white" type="button" :disabled="isPersonActionLoading" @click="closePersonAction">取消</button>
          <button class="btn" :class="pendingPersonAction.action === 'disable' ? 'person-action-confirm-disable' : 'danger-outline'" type="button" :disabled="isPersonActionLoading || (pendingPersonAction.action === 'delete' && deleteCountdown > 0)" @click="confirmPersonAction">
            {{ isPersonActionLoading ? (pendingPersonAction.action === 'disable' ? '停用中…' : '删除中…') : pendingPersonAction.action === 'delete' && deleteCountdown > 0 ? `确认删除（${deleteCountdown}s）` : pendingPersonAction.action === 'disable' ? '确认停用' : '确认删除' }}
          </button>
        </footer>
      </aside>
    </div>

    <div v-if="showCreate" class="drawer-backdrop" @click.self="closeCreate">
      <aside class="create-person-dialog" role="dialog" aria-modal="true" aria-label="添加人员">
        <header><div><span class="source-tag live">NEW API</span><h2>添加人员</h2></div><button class="icon-button" aria-label="关闭添加人员" :disabled="isCreating" @click="closeCreate">×</button></header>
        <template v-if="createdPerson">
          <section class="created-key-success">
            <IconUserCheck :size="22" />
            <strong>{{ createdPerson.person.displayName }} 已添加</strong>
            <p>{{ createdPerson.meta.notice }}</p>
            <small>{{ createdPerson.person.department.name }} · 已写入 New API，AI OPS 自动保存对应镜像</small>
          </section>
          <footer class="create-key-dialog-footer">
            <button class="btn create-key" type="button" @click="closeCreate">完成</button>
          </footer>
        </template>
        <form v-else class="create-person-form" @submit.prevent="submitCreate">
          <p class="create-person-note">姓名会写入 New API 用户名，部门会写入 New API 显示名称；状态默认在职，员工密码只在服务端处理，不会返回页面。</p>
          <label><span>姓名</span><input v-model="createForm.displayName" required minlength="2" maxlength="40" placeholder="例如：王庆典" /></label>
          <label><span>所属部门</span><input v-model="createForm.departmentId" required minlength="1" maxlength="40" placeholder="例如：技术部" /><small class="create-person-field-hint">直接填写部门名称即可，不需要选择部门编号。</small></label>
          <div v-if="createError" class="create-person-error"><IconAlertTriangle :size="16" />{{ createError }}</div>
          <footer><button class="btn btn-white" type="button" :disabled="isCreating" @click="closeCreate">取消</button><button class="btn create-key" type="submit" :disabled="isCreating">{{ isCreating ? '保存中…' : '保存人员' }}</button></footer>
        </form>
      </aside>
    </div>

    <div v-if="showImport" class="drawer-backdrop" @click.self="closeImport">
      <aside class="create-person-dialog people-import-dialog" role="dialog" aria-modal="true" aria-label="批量导入人员">
        <header><div><span class="source-tag live">NEW API</span><h2>批量导入人员</h2></div><button class="icon-button" aria-label="关闭批量导入" @click="closeImport">×</button></header>
        <template v-if="batchResult">
          <section class="created-key-success"><IconUserCheck :size="22" /><strong>已导入 {{ batchResult.meta.createdCount }} 名人员</strong><p>{{ batchResult.meta.notice }}</p><small>批次幂等号：{{ batchResult.operation.idempotencyKey }} · New API 与 AI OPS 镜像已对齐</small></section>
          <footer class="create-key-dialog-footer"><button class="btn create-key" type="button" @click="closeImport">完成</button></footer>
        </template>
        <template v-else>
        <section class="people-import-content">
          <p class="create-person-note">下载模板后填写人员信息。姓名写入 New API 用户名，部门写入 New API 显示名称；已有部门会自动匹配，新部门会同步建立 AI OPS 部门镜像。预检通过后逐条写入 New API，再自动同步到 AI OPS。</p>
          <div class="people-import-actions"><button class="btn btn-white" type="button" @click="downloadImportTemplate"><IconDownload :size="15" />下载 CSV 模板</button><label class="btn btn-white" for="people-import-file"><IconUpload :size="15" />选择 CSV 文件</label><input id="people-import-file" ref="importInput" class="visually-hidden" type="file" accept=".csv,text/csv" @change="handleImportFile" /></div>
          <div v-if="importFileName" class="people-import-file"><IconFileText :size="16" /><span>{{ importFileName }}</span><strong>{{ importRows.length }} 行已预检</strong></div>
          <div v-if="importError" class="create-person-error"><IconAlertTriangle :size="16" />{{ importError }}</div>
          <div v-if="importRows.length" class="people-import-table-wrap">
            <table class="data-table people-import-table"><thead><tr><th>行</th><th>人员</th><th>部门</th><th>预检结果</th></tr></thead><tbody><tr v-for="row in importRows" :key="row.line"><td>{{ row.line }}</td><td>{{ row.displayName || '—' }}</td><td>{{ row.departmentName || '—' }}</td><td><span :class="row.error ? 'people-import-invalid' : 'people-import-valid'">{{ row.error || '可导入' }}</span></td></tr></tbody></table>
          </div>
          <div v-else class="people-import-empty"><IconUpload :size="24" /><strong>还没有选择文件</strong><span>先下载模板或选择已有 CSV 文件。</span></div>
        </section>
        <footer class="create-key-dialog-footer"><button class="btn btn-white" type="button" @click="closeImport">关闭</button><button class="btn create-key" type="button" :disabled="!canImport" @click="submitImport">{{ isImporting ? '导入中…' : '确认导入' }}</button></footer>
        </template>
      </aside>
    </div>
  </div>
</template>
