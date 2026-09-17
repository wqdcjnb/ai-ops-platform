<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  IconAlertTriangle,
  IconBuilding,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconFilter,
  IconKey,
  IconRefresh,
  IconSearch,
  IconUserCheck,
  IconUserOff,
  IconUserPlus,
  IconUsers,
} from '@tabler/icons-vue'
import { createPerson, fetchPeople, PeopleApiError, type PeopleFilters, type PeopleResponse, type Person, type PersonCreateBody } from '../people-api'
import { useDebouncedSearch } from '../composables/useDebouncedSearch'

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
const createForm = ref<PersonCreateBody>({ username: '', displayName: '', departmentId: 'content', password: '' })
let activeRequest: AbortController | null = null

const statusLabels: Record<Person['status'], string> = { active: '在职', disabled: '已停用', offboarding: '离职待回收' }
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

const summaryCards = computed(() => {
  const value = people.value?.summary
  return [
    { label: '全部人员', value: value?.total ?? '—', hint: `${value?.departments ?? '—'} 个部门`, icon: IconUsers, tone: 'teal' },
    { label: '在职人员', value: value?.active ?? '—', hint: '可正常使用授权 Key', icon: IconUserCheck, tone: 'green' },
    { label: '离职待回收', value: value?.offboarding ?? '—', hint: '需要检查并停用 Key', icon: IconAlertTriangle, tone: 'amber' },
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

function selectDepartment(id: string) {
  department.value = department.value === id ? 'all' : id
  applyFilters()
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
  createForm.value = { username: '', displayName: '', departmentId: people.value?.departments[0]?.id ?? 'content', password: '' }
  showCreate.value = true
}

function closeCreate() {
  if (isCreating.value) return
  showCreate.value = false
}

async function submitCreate() {
  isCreating.value = true
  createError.value = ''
  try {
    await createPerson(createForm.value)
    showCreate.value = false
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
        <p>按组织归属查看人员状态、访问凭据和月度软目标。</p>
      </div>
      <div class="heading-actions">
        <span class="updated-at">更新于 {{ updatedAt }}</span>
        <button class="btn btn-white refresh-button" :disabled="isLoading" @click="loadPeople"><IconRefresh :size="17" :class="{ spinning: isLoading }" />刷新</button>
        <button class="btn btn-white" disabled title="真实数据与权限接入后开放"><IconDownload :size="16" />导出</button>
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

    <section v-if="people" class="department-strip" aria-label="部门概览">
      <button v-for="item in people.departments" :key="item.id" :class="{ active: department === item.id }" @click="selectDepartment(item.id)">
        <span class="department-icon"><IconBuilding :size="17" /></span>
        <span><strong>{{ item.name }}</strong><small>{{ item.people }} 人 · {{ item.activeKeys }} 个 Key</small></span>
        <em>{{ item.usagePercent }}%</em>
      </button>
    </section>

    <section class="panel people-panel-main">
      <form class="people-filters" @submit.prevent="applyFilters">
        <label class="people-search"><IconSearch :size="17" /><input v-model="search" aria-label="搜索人员" type="search" maxlength="60" placeholder="搜索姓名、岗位、负责人或用途" /></label>
        <label><IconBuilding :size="16" /><select v-model="department" @change="applyFilters"><option value="all">全部部门</option><option v-for="item in people?.departments ?? []" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
        <label><IconUsers :size="16" /><select v-model="status" @change="applyFilters"><option value="all">全部状态</option><option value="active">在职</option><option value="offboarding">离职待回收</option><option value="disabled">已停用</option></select></label>
        <label><IconFilter :size="16" /><select v-model="goal" @change="applyFilters"><option value="all">全部目标状态</option><option value="normal">正常</option><option value="near">接近目标</option><option value="reached">已达目标</option></select></label>
        <button class="btn filter-submit" type="submit"><IconSearch :size="15" />查询</button>
        <button class="text-button clear-filter" type="button" @click="clearFilters">清除</button>
      </form>

      <div v-if="!people && !errorMessage" class="data-state"><div class="state-icon"><IconRefresh :size="22" class="spinning" /></div><div><strong>正在读取人员数据</strong><p>正在从 BFF 获取经过校验的人员列表…</p></div></div>
      <div v-else-if="errorMessage" class="data-state failed"><div class="state-icon"><IconAlertTriangle :size="22" /></div><div><strong>人员数据加载失败</strong><p>{{ errorMessage }}</p></div><button class="btn btn-white" @click="loadPeople">重试</button></div>
      <template v-else-if="people">
        <div v-if="people.items.length" class="table-responsive">
          <table class="data-table people-table">
            <thead><tr><th>人员</th><th>部门 / 岗位</th><th>负责人</th><th>访问 Key</th><th>主要用途</th><th>月度软目标</th><th>状态</th><th>最近调用</th><th /></tr></thead>
            <tbody>
              <tr v-for="person in people.items" :key="person.id">
                <td><div class="person-cell"><span class="person-avatar" :class="`avatar-${person.tone}`">{{ person.initials }}</span><span><strong>{{ person.name }}</strong><small>ID · {{ person.id.replace('person-', '') }}</small></span></div></td>
                <td><div class="table-stack"><strong>{{ person.department.name }}</strong><small>{{ person.title }}</small></div></td>
                <td>{{ person.manager }}</td>
                <td><span class="key-count"><IconKey :size="13" />{{ person.keyCount }}</span></td>
                <td><span class="purpose-tag">{{ person.purpose }}</span></td>
                <td><div class="goal-cell"><div><i :class="`goal-${person.goal.state}`" :style="{ width: `${Math.min(person.goal.percent, 100)}%` }" /></div><span :class="`goal-${person.goal.state}`">{{ person.goal.percent }}%</span><small>{{ person.goal.used }}/{{ person.goal.limit }}</small></div></td>
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

    <footer class="page-footer">数据来源：{{ people?.meta.source.toUpperCase() ?? '等待数据' }} · 添加人员已开放（本地 SQLite），职位、用途和 Key 管理仍待接入</footer>

    <div v-if="showCreate" class="drawer-backdrop" @click.self="closeCreate">
      <aside class="create-person-dialog" role="dialog" aria-modal="true" aria-label="添加人员">
        <header><div><span class="source-tag demo">SQLITE</span><h2>添加人员</h2></div><button class="icon-button" aria-label="关闭添加人员" :disabled="isCreating" @click="closeCreate">×</button></header>
        <form class="create-person-form" @submit.prevent="submitCreate">
          <p class="create-person-note">创建本地演示账号并绑定部门。密码只用于本地登录测试，不会在列表或日志中展示。</p>
          <label><span>姓名</span><input v-model="createForm.displayName" required minlength="2" maxlength="40" placeholder="例如：王小明" /></label>
          <label><span>登录用户名</span><input v-model="createForm.username" required pattern="[A-Za-z][A-Za-z0-9._-]{2,39}" maxlength="40" placeholder="例如：wang.xiaoming" /></label>
          <label><span>所属部门</span><select v-model="createForm.departmentId" required><option v-for="item in people?.departments ?? []" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
          <label><span>初始密码</span><input v-model="createForm.password" required minlength="8" maxlength="200" type="password" placeholder="至少 8 位" /></label>
          <div v-if="createError" class="create-person-error"><IconAlertTriangle :size="16" />{{ createError }}</div>
          <footer><button class="btn btn-white" type="button" :disabled="isCreating" @click="closeCreate">取消</button><button class="btn create-key" type="submit" :disabled="isCreating">{{ isCreating ? '保存中…' : '保存人员' }}</button></footer>
        </form>
      </aside>
    </div>
  </div>
</template>
