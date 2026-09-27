<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { IconAlertTriangle, IconDotsVertical, IconKey, IconRefresh, IconTrash, IconUserCheck, IconUserOff, IconUsers } from '@tabler/icons-vue'
import { deletePerson, disablePerson, enablePerson, fetchPeople, PeopleApiError, resetPersonKey, resetPersonPassword, type PeopleFilters, type PeopleResponse, type Person } from '../people-api'
import AppPagination from '../components/AppPagination.vue'
import { useDebouncedSearch } from '../composables/useDebouncedSearch'

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
  return `${prefix}-${crypto.randomUUID()}`
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
</script>

<template>
  <div class="dashboard people-dashboard">
    <section class="page-heading">
      <div>
        <div class="eyebrow">PEOPLE & PLATFORM KEY</div>
        <h1>人员信息管理</h1>
      </div>
      <div class="heading-actions"><button class="btn btn-white refresh-button" :disabled="isLoading" @click="loadPeople"><IconRefresh :size="17" :class="{ spinning: isLoading }" />刷新</button></div>
    </section>

    <section class="people-summary-grid" aria-label="人员概览">
      <article class="metric-card people-summary-card"><div class="metric-top"><span class="metric-label">全部人员</span><span class="metric-icon tone-teal"><IconUsers :size="19" /></span></div><strong class="metric-value">{{ total }}</strong><div class="metric-foot">员工通过真实姓名和邮箱自助注册</div></article>
      <article class="metric-card people-summary-card"><div class="metric-top"><span class="metric-label">启用人员</span><span class="metric-icon tone-green"><IconUserCheck :size="19" /></span></div><strong class="metric-value">{{ active }}</strong><div class="metric-foot">可登录并使用 AI OPS</div></article>
    </section>

    <section class="panel people-panel-main">
      <form class="people-filters" @submit.prevent="applyFilters">
        <label class="people-search"><input v-model="search" aria-label="搜索人员" type="search" maxlength="60" placeholder="搜索姓名或邮箱" /></label>
        <label><select v-model="status" aria-label="按状态筛选" @change="applyFilters"><option value="all">全部状态</option><option value="active">启用</option><option value="disabled">停用</option></select></label>
        <button class="text-button" type="button" @click="clearFilters">清除筛选</button>
      </form>

      <div v-if="isLoading && !people" class="data-state"><div class="state-icon"><IconRefresh :size="22" class="spinning" /></div><div><strong>正在读取人员信息</strong><p>正在加载平台身份与 Key 掩码…</p></div></div>
      <div v-else-if="errorMessage" class="data-state failed"><div class="state-icon"><IconAlertTriangle :size="22" /></div><div><strong>人员数据加载失败</strong><p>{{ errorMessage }}</p></div><button class="btn btn-white" @click="loadPeople">重试</button></div>
      <template v-else-if="people">
        <div class="source-banner"><span class="local">平台身份库</span>{{ people.meta.notice }}</div>
        <p v-if="operationNotice" class="person-operation-notice" role="status">{{ operationNotice }}</p>
        <div v-if="people.items.length" class="table-responsive" :class="{ 'has-open-person-menu': openMenuId !== null }">
          <table class="data-table people-table">
            <thead><tr><th>人员</th><th>状态</th><th>API密钥（KEY掩码）</th><th :aria-sort="sortDirection('createdAt')"><button class="people-sort-button" type="button" :aria-label="sortButtonLabel('createdAt')" @click="toggleSort('createdAt')">创建时间 <span aria-hidden="true">{{ sortIcon('createdAt') }}</span></button></th><th :aria-sort="sortDirection('lastUsedAt')"><button class="people-sort-button" type="button" :aria-label="sortButtonLabel('lastUsedAt')" @click="toggleSort('lastUsedAt')">最后使用 <span aria-hidden="true">{{ sortIcon('lastUsedAt') }}</span></button></th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="person in displayedPeople" :key="person.id">
                <td><div class="person-cell"><span class="person-avatar" :class="`avatar-${person.tone}`">{{ person.name.slice(0, 1) }}</span><span><strong>{{ person.name }}</strong><small>{{ person.username }}</small></span></div></td>
                <td><span class="person-status" :class="`status-${person.status}`"><i />{{ statusLabel[person.status] }}</span></td>
                <td><code class="masked-key">{{ person.apiKeyMasked ?? '未创建' }}</code></td>
                <td class="last-active">{{ formatDate(person.createdAt) }}</td>
                <td class="last-active">{{ formatDate(person.lastUsedAt) }}</td>
                <td class="person-action-cell"><div class="person-action-menu" @click.stop>
                  <button class="person-menu-trigger" type="button" :aria-expanded="openMenuId === person.id" aria-haspopup="menu" :aria-label="`打开 ${person.name} 的操作菜单`" @click="toggleActionMenu(person.id)"><IconDotsVertical :size="19" /></button>
                  <div v-if="openMenuId === person.id" class="person-menu-popover" role="menu" :aria-label="`${person.name} 的操作`">
                    <button type="button" role="menuitem" @click="openAction(person, person.status === 'active' ? 'disable' : 'enable')"><IconUserOff v-if="person.status === 'active'" :size="15" /><IconUserCheck v-else :size="15" />{{ person.status === 'active' ? '停用员工' : '启用员工' }}</button>
                    <button type="button" role="menuitem" @click="openAction(person, 'resetKey')"><IconKey :size="15" />重置 Key</button>
                    <button type="button" role="menuitem" @click="openAction(person, 'resetPassword')"><IconKey :size="15" />重置密码</button>
                    <button class="danger" type="button" role="menuitem" @click="openAction(person, 'delete')"><IconTrash :size="15" />删除员工</button>
                  </div>
                </div></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="people-empty"><IconUsers :size="24" /><strong>没有符合条件的员工</strong><span>新员工需要在登录页自行注册。</span></div>
        <AppPagination :page="page" :total-pages="totalPages" :total="people.total" aria-label="人员信息管理分页" @change="changePage" />
      </template>
    </section>

    <div v-if="pending" class="drawer-backdrop" @click.self="!isOperating && (pending = null)">
      <aside class="person-action-dialog" role="dialog" aria-modal="true" :aria-label="actionTitle(pending.action)">
        <header><div><span class="person-action-dialog-icon"><IconKey v-if="pending.action === 'resetKey' || pending.action === 'resetPassword'" :size="17" /><IconTrash v-else-if="pending.action === 'delete'" :size="17" /><IconUserOff v-else :size="17" /></span><h2>{{ actionTitle(pending.action) }}</h2></div><button class="icon-button" :disabled="isOperating" aria-label="关闭" @click="pending = null">×</button></header>
        <section class="person-action-dialog-body"><strong>{{ pending.person.name }}</strong><p>{{ actionDescription(pending) }}</p><p v-if="operationError" class="dialog-error"><IconAlertTriangle :size="15" />{{ operationError }}</p></section>
        <footer><button class="btn btn-white" :disabled="isOperating" @click="pending = null">取消</button><button class="btn create-key" :disabled="isOperating" @click="confirmAction">{{ isOperating ? '处理中…' : '确认' }}</button></footer>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.people-dashboard { max-width: 1500px; }.people-summary-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-bottom: 16px; }.people-panel-main { padding: 0; overflow: visible; }.people-filters { display: flex; align-items: center; gap: 10px; padding: 15px 17px; border-bottom: 1px solid var(--line); }.people-filters label { display: flex; align-items: center; gap: 7px; min-width: 150px; padding: 0 9px; border: 1px solid var(--line); border-radius: 7px; color: var(--muted); }.people-filters input, .people-filters select { min-width: 0; width: 100%; padding: 8px 0; border: 0; outline: 0; color: var(--navy); background: transparent; font: inherit; font-size: 12px; }.people-search { flex: 1; max-width: 360px; }.people-table { min-width: 860px; }.people-table th { text-transform: none; }.people-sort-button { display: inline-flex; align-items: center; gap: 4px; padding: 0; border: 0; color: inherit; background: transparent; font: inherit; font-weight: inherit; cursor: pointer; }.people-sort-button:hover { color: var(--brand); }.people-sort-button:focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; border-radius: 3px; }.people-sort-button span { color: var(--brand); font-size: 13px; line-height: 1; }.people-table th:last-child { width: 64px; min-width: 64px; padding: 0; text-align: center; }.table-responsive.has-open-person-menu { padding-bottom: 164px; }.person-cell { display: flex; align-items: center; gap: 9px; min-width: 170px; }.person-cell > span:last-child { display: grid; gap: 2px; }.person-cell small { color: var(--muted); font-size: 10px; }.masked-key { color: var(--navy); font-size: 11px; }.person-operation-notice { display: flex; align-items: center; margin: 0 16px 12px; padding: 10px 12px; border: 1px solid #cfe8d6; border-radius: 8px; color: #26754e; background: #f4fbf6; font-size: 12px; }.person-action-cell { position: relative; width: 64px; min-width: 64px; padding: 0 !important; text-align: center; }.person-action-menu { position: relative; display: flex; justify-content: center; }.person-menu-trigger { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 1px solid transparent; border-radius: 7px; color: var(--muted); background: transparent; }.person-menu-trigger:hover, .person-menu-trigger[aria-expanded="true"] { border-color: var(--line); color: var(--navy); background: #f7fafb; }.person-menu-popover { position: absolute; z-index: 20; top: calc(100% + 5px); right: 0; display: grid; width: 158px; padding: 5px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); box-shadow: 0 14px 30px rgba(24, 36, 51, .16); }.person-menu-popover button { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 32px; padding: 0 9px; border: 0; border-radius: 6px; color: #40515e; background: transparent; font: inherit; font-size: 11px; text-align: left; }.person-menu-popover button:hover, .person-menu-popover button:focus-visible { outline: 0; color: var(--navy); background: #f1f6f7; }.person-menu-popover button.danger { margin-top: 3px; border-top: 1px solid #edf0f3; border-radius: 0 0 6px 6px; color: var(--danger); }.person-action-dialog { width: min(100% - 28px, 480px); border: 1px solid var(--line); border-radius: 12px; background: var(--surface); box-shadow: 0 22px 60px rgba(0, 0, 0, .25); }.person-action-dialog header { display: flex; align-items: center; justify-content: space-between; padding: 18px; border-bottom: 1px solid var(--line); }.person-action-dialog header > div { display: flex; align-items: center; gap: 10px; }.person-action-dialog h2 { margin: 0; color: var(--navy); font-size: 16px; }.person-action-dialog-icon { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 7px; color: var(--brand); background: #e7f2f2; }.person-action-dialog-body { padding: 20px 18px; }.person-action-dialog-body strong { color: var(--navy); }.person-action-dialog-body p { margin: 8px 0 0; color: var(--muted); font-size: 13px; line-height: 1.65; }.dialog-error { display: flex; align-items: flex-start; gap: 6px; color: var(--danger) !important; }.person-action-dialog footer { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 18px; border-top: 1px solid var(--line); }
@media (max-width: 720px) { .people-summary-grid { grid-template-columns: 1fr; }.people-filters { align-items: stretch; flex-direction: column; }.people-filters label, .people-search { width: 100%; max-width: none; } }
</style>
