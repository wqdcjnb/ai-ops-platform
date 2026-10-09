import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { IconAlertTriangle, IconDotsVertical, IconKey, IconRefresh, IconTrash, IconUserCheck, IconUserOff, IconUsers } from '@tabler/icons-vue'
import { deletePerson, disablePerson, enablePerson, fetchPeople, PeopleApiError, resetPersonKey, resetPersonPassword, type PeopleFilters, type PeopleResponse, type Person } from '../people-api'
import AppPagination from '../components/AppPagination.vue'
import { useDebouncedSearch } from '../composables/useDebouncedSearch'
import { createIdempotencyKey } from '../idempotency'

export function usePeopleView() {
/**
 * All state and behaviour for the PeopleView view.
 * Extracted verbatim from the component so the template keeps rendering identically.
 */

const people = ref<PeopleResponse | null>(null)
const search = ref('')
const status = ref<PeopleFilters['status']>('all')
const page = ref(1)
const pageSize = 10
const isLoading = ref(false)
const errorMessage = ref('')
const operationError = ref('')
const operationNotice = ref('')
const pending = ref<{ person: Person; action: 'enable' | 'disable' | 'delete' | 'resetPassword' | 'resetKey' } | null>(null)
const openMenuId = ref<string | null>(null)
const isOperating = ref(false)
type PeopleSortKey = 'createdAt' | 'lastUsedAt'
type PeopleSortDirection = 'none' | 'ascending' | 'descending'
const sortDirections = ref<Record<PeopleSortKey, PeopleSortDirection>>({ createdAt: 'none', lastUsedAt: 'none' })
const sortPriority = ref<PeopleSortKey[]>([])
let request: AbortController | null = null

const statusLabel: Record<Person['status'], string> = { active: '启用', disabled: '停用' }
const total = computed(() => people.value?.summary.total ?? 0)
const active = computed(() => people.value?.summary.active ?? 0)
const totalPages = computed(() => Math.max(Math.ceil((people.value?.total ?? 0) / pageSize), 1))

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

function timestamp(value: string | null | undefined) {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

const displayedPeople = computed(() => {
  const items = people.value?.items ?? []
  if (!sortPriority.value.length) return items
  return [...items].sort((left, right) => {
    for (const key of sortPriority.value) {
      const direction = sortDirections.value[key]
      const leftTime = timestamp(left[key])
      const rightTime = timestamp(right[key])
      if (leftTime === null && rightTime === null) continue
      if (leftTime === null) return 1
      if (rightTime === null) return -1
      const comparison = direction === 'ascending' ? leftTime - rightTime : rightTime - leftTime
      if (comparison !== 0) return comparison
    }
    return 0
  })
})

function toggleSort(key: PeopleSortKey) {
  const current = sortDirections.value[key]
  const next: PeopleSortDirection = current === 'none' ? 'descending' : current === 'descending' ? 'ascending' : 'none'
  sortDirections.value = { ...sortDirections.value, [key]: next }
  sortPriority.value = next === 'none'
    ? sortPriority.value.filter((item) => item !== key)
    : [key, ...sortPriority.value.filter((item) => item !== key)]
}

function sortDirection(key: PeopleSortKey) {
  return sortDirections.value[key]
}

function sortButtonLabel(key: PeopleSortKey) {
  const label = key === 'createdAt' ? '创建时间' : '最后使用'
  const current = sortDirection(key)
  if (current === 'ascending') return `取消按${label}排序`
  if (current === 'descending') return `按${label}升序排序`
  return `按${label}降序排序`
}

function sortIcon(key: PeopleSortKey) {
  const current = sortDirection(key)
  return current === 'ascending' ? '↑' : current === 'descending' ? '↓' : '↕'
}

function operationKey(prefix: string) {
  return createIdempotencyKey(prefix)
}

async function loadPeople() {
  request?.abort()
  const next = new AbortController()
  request = next
  isLoading.value = true
  errorMessage.value = ''
  try {
    const nextPeople = await fetchPeople({ search: search.value.trim(), status: status.value, page: page.value, pageSize }, next.signal)
    const nextTotalPages = Math.max(Math.ceil(nextPeople.total / pageSize), 1)
    if (page.value > nextTotalPages) {
      page.value = nextTotalPages
      return void loadPeople()
    }
    people.value = nextPeople
  } catch (error) {
    if (!next.signal.aborted) errorMessage.value = `${error instanceof Error ? error.message : '人员数据暂时无法加载'}${error instanceof PeopleApiError && error.requestId ? ` · 请求 ID ${error.requestId}` : ''}`
  } finally {
    if (request === next) isLoading.value = false
  }
}

function applyFilters() {
  cancelSearch()
  page.value = 1
  void loadPeople()
}

function clearFilters() {
  search.value = ''
  status.value = 'all'
  applyFilters()
}

const { cancel: cancelSearch } = useDebouncedSearch(search, () => {
  page.value = 1
  void loadPeople()
})

function changePage(next: number) {
  if (!people.value || next < 1 || next > totalPages.value) return
  cancelSearch()
  openMenuId.value = null
  page.value = next
  void loadPeople()
}

function openAction(person: Person, action: NonNullable<typeof pending.value>['action']) {
  if (isOperating.value) return
  openMenuId.value = null
  operationError.value = ''
  pending.value = { person, action }
}

function toggleActionMenu(personId: string) {
  openMenuId.value = openMenuId.value === personId ? null : personId
}

function closeActionMenu() {
  openMenuId.value = null
}

function actionTitle(action: NonNullable<typeof pending.value>['action']) {
  return ({ enable: '启用员工', disable: '停用员工', delete: '删除员工', resetPassword: '重置登录密码', resetKey: '重置 API Key' })[action]
}

function actionDescription(item: NonNullable<typeof pending.value>) {
  if (item.action === 'enable') return '将恢复该员工登录和平台 Key 使用资格。'
  if (item.action === 'disable') return '该员工将无法登录，且当前 Key 会立即失效。'
  if (item.action === 'delete') return '仅删除人员可见档案；历史审计记录会保留。员工必须先停用才能删除。'
  if (item.action === 'resetPassword') return '登录密码将被重置为 123456。'
  return '系统会立即生成一把新 Key，旧 Key 失效。管理员仅看到新的掩码；员工登录后可自行查看和复制完整 Key。'
}

async function confirmAction() {
  const item = pending.value
  if (!item || isOperating.value) return
  isOperating.value = true
  operationError.value = ''
  operationNotice.value = ''
  try {
    if (item.action === 'enable') {
      await enablePerson(item.person.id, { idempotencyKey: operationKey('person-enable'), acknowledgeImpact: true })
      operationNotice.value = `已启用 ${item.person.name}。`
    }
    if (item.action === 'disable') {
      await disablePerson(item.person.id, { idempotencyKey: operationKey('person-disable'), acknowledgeImpact: true })
      operationNotice.value = `已停用 ${item.person.name}，其当前 Key 已失效。`
    }
    if (item.action === 'delete') {
      await deletePerson(item.person.id, { idempotencyKey: operationKey('person-delete'), reason: '', acknowledgeImpact: true })
      operationNotice.value = `已删除 ${item.person.name} 的人员档案。`
    }
    if (item.action === 'resetPassword') {
      await resetPersonPassword(item.person.id, { idempotencyKey: operationKey('person-password-reset'), acknowledgeImpact: true })
      operationNotice.value = `已将 ${item.person.name} 的登录密码重置为 123456。`
    }
    if (item.action === 'resetKey') {
      const result = await resetPersonKey(item.person.id, { idempotencyKey: operationKey('person-key-reset'), acknowledgeImpact: true })
      const masked = result.person.apiKeyMasked
      const row = people.value?.items.find((person) => person.id === item.person.id)
      if (row && masked !== undefined) row.apiKeyMasked = masked
      operationNotice.value = `已重置 ${item.person.name} 的平台 Key${masked ? `：${masked}` : ''}；旧 Key 已失效。`
    }
    pending.value = null
    await loadPeople()
  } catch (error) {
    operationError.value = `${error instanceof Error ? error.message : '操作未完成'}${error instanceof PeopleApiError && error.requestId ? ` · 请求 ID ${error.requestId}` : ''}`
  } finally {
    isOperating.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', closeActionMenu)
  void loadPeople()
})
onBeforeUnmount(() => { request?.abort(); cancelSearch(); document.removeEventListener('click', closeActionMenu) })

  return { IconAlertTriangle, IconDotsVertical, IconKey, IconRefresh, IconTrash, IconUserCheck, IconUserOff, IconUsers, actionDescription, actionTitle, active, applyFilters, cancelSearch, changePage, clearFilters, closeActionMenu, confirmAction, displayedPeople, errorMessage, formatDate, isLoading, isOperating, loadPeople, openAction, openMenuId, operationError, operationKey, operationNotice, page, pageSize, pending, people, request, search, sortButtonLabel, sortDirection, sortDirections, sortIcon, sortPriority, status, statusLabel, timestamp, toggleActionMenu, toggleSort, total, totalPages }
}
