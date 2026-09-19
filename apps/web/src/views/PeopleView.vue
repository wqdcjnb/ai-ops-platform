<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  IconAlertTriangle,
  IconBuilding,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconFileText,
  IconFilter,
  IconKey,
  IconRefresh,
  IconSearch,
  IconShieldCheck,
  IconUpload,
  IconUserCheck,
  IconUserOff,
  IconUserPlus,
  IconUsers,
} from '@tabler/icons-vue'
import { createPeopleBatch, createPerson, fetchPeople, PeopleApiError, type PeopleFilters, type PeopleResponse, type Person, type PersonBatchCreateResponse, type PersonCreateBody, type PersonCreateResponse } from '../people-api'
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

const statusLabels: Record<Person['status'], string> = { active: '在职', disabled: '已停用', offboarding: '待回收' }
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

const summaryCards = computed(() => {
  const value = people.value?.summary
  return [
    { label: '全部人员', value: value?.total ?? '—', hint: `${value?.departments ?? '—'} 个部门`, icon: IconUsers, tone: 'teal' },
    { label: '在职人员', value: value?.active ?? '—', hint: '可正常使用授权 Key', icon: IconUserCheck, tone: 'green' },
    { label: '已停用', value: value?.disabled ?? '—', hint: '当前不可继续调用', icon: IconUserOff, tone: 'violet' },
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
onBeforeUnmount(() => activeRequest?.abort())
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

    <div v-if="people" class="source-banner"><span>DEMO</span>{{ people.meta.notice }}</div>

    <section class="people-summary-grid" aria-label="人员状态摘要">
      <article v-for="card in summaryCards" :key="card.label" class="metric-card people-summary-card">
        <div class="metric-top"><span class="metric-label">{{ card.label }}</span><span class="metric-icon" :class="`tone-${card.tone}`"><component :is="card.icon" :size="19" /></span></div>
        <strong class="metric-value">{{ card.value }}</strong>
        <div class="metric-foot">{{ card.hint }}</div>
      </article>
    </section>

    <section class="panel people-panel-main">
      <form class="people-filters" @submit.prevent="applyFilters">
        <label class="people-search"><IconSearch :size="17" /><input v-model="search" aria-label="搜索人员" type="search" maxlength="60" placeholder="搜索姓名、岗位或负责人" /></label>
        <label><IconBuilding :size="16" /><select v-model="department" @change="applyFilters"><option value="all">全部部门</option><option v-for="item in people?.departments ?? []" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
        <label><IconUsers :size="16" /><select v-model="status" @change="applyFilters"><option value="all">全部状态</option><option value="active">在职</option><option value="disabled">已停用</option></select></label>
        <span class="realtime-search-hint" aria-live="polite">输入即搜索</span>
        <button class="text-button clear-filter" type="button" @click="clearFilters">清除</button>
      </form>

      <div v-if="!people && !errorMessage" class="data-state"><div class="state-icon"><IconRefresh :size="22" class="spinning" /></div><div><strong>正在读取人员数据</strong><p>正在从 BFF 获取经过校验的人员列表…</p></div></div>
      <div v-else-if="errorMessage" class="data-state failed"><div class="state-icon"><IconAlertTriangle :size="22" /></div><div><strong>人员数据加载失败</strong><p>{{ errorMessage }}</p></div><button class="btn btn-white" @click="loadPeople">重试</button></div>
      <template v-else-if="people">
        <div v-if="people.items.length" class="table-responsive">
          <table class="data-table people-table">
            <thead><tr><th>人员</th><th>部门</th><th>访问 Key</th><th>状态</th><th>最近调用</th><th /></tr></thead>
            <tbody>
              <tr v-for="person in people.items" :key="person.id">
                <td><div class="person-cell"><span class="person-avatar" :class="`avatar-${person.tone}`">{{ surnameInitial(person.name) }}</span><span><strong>{{ person.name }}</strong></span></div></td>
                <td>{{ person.department.name }}</td>
                <td><span class="key-count"><IconKey :size="13" />{{ person.keyCount }}</span></td>
                <td><span class="person-status" :class="`status-${person.status}`"><i />{{ statusLabels[person.status] }}</span></td>
                <td class="last-active">{{ relativeTime(person.lastActiveAt) }}</td>
                <td><RouterLink class="row-action enabled" :to="`/people/${person.id}`" :aria-label="`查看${person.name}详情`"><IconChevronRight :size="17" /></RouterLink></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="people-empty"><IconUsers :size="24" /><strong>没有符合条件的人员</strong><span>调整搜索词或筛选条件后重试。</span><button class="text-button" @click="clearFilters">清除筛选</button></div>
        <footer class="table-footer"><span>{{ rangeText }}</span><div><button :disabled="page <= 1 || isLoading" aria-label="上一页" @click="goToPage(page - 1)"><IconChevronLeft :size="16" /></button><strong>第 {{ page }} / {{ totalPages }} 页</strong><button :disabled="page >= totalPages || isLoading" aria-label="下一页" @click="goToPage(page + 1)"><IconChevronRight :size="16" /></button></div></footer>
      </template>
    </section>

    <footer class="page-footer">数据来源：{{ people?.meta.source.toUpperCase() ?? '等待数据' }} · 添加人员已开放（本地 SQLite），Key 用途在 Key 管理中维护</footer>

    <div v-if="showCreate" class="drawer-backdrop" @click.self="closeCreate">
      <aside class="create-person-dialog" role="dialog" aria-modal="true" aria-label="添加人员">
        <header><div><span class="source-tag demo">SQLITE</span><h2>添加人员</h2></div><button class="icon-button" aria-label="关闭添加人员" :disabled="isCreating" @click="closeCreate">×</button></header>
        <template v-if="createdPerson">
          <section class="created-key-success">
            <IconUserCheck :size="22" />
            <strong>{{ createdPerson.person.displayName }} 已添加</strong>
            <p>{{ createdPerson.meta.notice }}</p>
            <small>{{ createdPerson.person.department.name }} · 登录名和初始密码由系统自动生成</small>
          </section>
          <footer class="create-key-dialog-footer">
            <a class="btn btn-white" :href="`/audit?eventId=${encodeURIComponent(createdPerson.operation.auditEventId)}&origin=mutation`" :aria-label="`查看 ${createdPerson.operation.auditEventId} 操作审计`"><IconShieldCheck :size="16" />查看操作审计</a>
            <button class="btn create-key" type="button" @click="closeCreate">完成</button>
          </footer>
        </template>
        <form v-else class="create-person-form" @submit.prevent="submitCreate">
          <p class="create-person-note">创建本地演示账号并绑定部门。登录名和初始密码由系统自动生成，仅保存安全摘要。</p>
          <label><span>姓名</span><input v-model="createForm.displayName" required minlength="2" maxlength="40" placeholder="例如：王庆典" /></label>
          <label><span>所属部门</span><input v-model="createForm.departmentId" required minlength="1" maxlength="40" placeholder="例如：技术部" /><small class="create-person-field-hint">直接填写部门名称即可，不需要选择部门编号。</small></label>
          <div v-if="createError" class="create-person-error"><IconAlertTriangle :size="16" />{{ createError }}</div>
          <footer><button class="btn btn-white" type="button" :disabled="isCreating" @click="closeCreate">取消</button><button class="btn create-key" type="submit" :disabled="isCreating">{{ isCreating ? '保存中…' : '保存人员' }}</button></footer>
        </form>
      </aside>
    </div>

    <div v-if="showImport" class="drawer-backdrop" @click.self="closeImport">
      <aside class="create-person-dialog people-import-dialog" role="dialog" aria-modal="true" aria-label="批量导入人员">
        <header><div><span class="source-tag demo">CSV</span><h2>批量导入人员</h2></div><button class="icon-button" aria-label="关闭批量导入" @click="closeImport">×</button></header>
        <template v-if="batchResult">
          <section class="created-key-success"><IconUserCheck :size="22" /><strong>已导入 {{ batchResult.meta.createdCount }} 名人员</strong><p>{{ batchResult.meta.notice }}</p><small>批次幂等号：{{ batchResult.operation.idempotencyKey }} · 系统凭据已生成，仅保存哈希</small></section>
          <footer class="create-key-dialog-footer"><a class="btn btn-white" :href="`/audit?eventId=${encodeURIComponent(batchResult.operation.auditEventId)}&origin=mutation`" :aria-label="`查看 ${batchResult.operation.auditEventId} 操作审计`"><IconShieldCheck :size="16" />查看操作审计</a><button class="btn create-key" type="button" @click="closeImport">完成</button></footer>
        </template>
        <template v-else>
        <section class="people-import-content">
          <p class="create-person-note">下载模板后填写人员信息。部门直接填写名称即可，已有部门会自动匹配，新部门会写入本地目录；登录名及初始密码由系统自动生成，预检通过后会一次性写入本地 SQLite，不会调用 New API。</p>
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
