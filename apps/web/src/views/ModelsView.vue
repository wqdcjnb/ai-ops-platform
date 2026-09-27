<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { IconAlertTriangle, IconBrain, IconRefresh, IconSearch } from '@tabler/icons-vue'
import { fetchModels, ModelsApiError, type ModelItem, type ModelsResponse } from '../models-api'
import AppPagination from '../components/AppPagination.vue'
import { useDebouncedSearch } from '../composables/useDebouncedSearch'

// This is an administrator-facing upstream catalogue. Employee clients never
// choose a row here: they call the single public virtual model, ai-ops.
const source = 'owned' as const
const models = ref<ModelsResponse | null>(null)
const search = ref('')
const modelSourceId = ref('all')
const page = ref(1)
const pageSize = 10
const isLoading = ref(false)
const errorMessage = ref('')
let request: AbortController | null = null

type ModelChannel = NonNullable<ModelItem['channels']>[number]
type ModelSourceOption = { id: string; label: string }

const isInitialLoading = computed(() => isLoading.value && !models.value)
const updatedAt = computed(() => models.value
  ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(models.value.meta.generatedAt))
  : '等待数据')
const modelSourceOptions = computed<ModelSourceOption[]>(() => {
  const sources = new Map<string, string>()
  for (const item of models.value?.items ?? []) {
    for (const channel of relaySources(item)) sources.set(channel.id, channel.name)
  }
  return [...sources.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
})
const visibleModels = computed(() => modelSourceId.value === 'all'
  ? models.value?.items ?? []
  : (models.value?.items ?? []).filter((item) => relaySources(item).some((channel) => channel.id === modelSourceId.value)))
const totalPages = computed(() => Math.max(Math.ceil(visibleModels.value.length / pageSize), 1))
const currentPage = computed(() => Math.min(Math.max(page.value, 1), totalPages.value))
const pagedModels = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return visibleModels.value.slice(start, start + pageSize)
})

function relaySources(item: ModelItem): ModelChannel[] {
  return item.channels ?? []
}

function statusLabel(status: ModelItem['status']) {
  return status === 'available' ? '可用' : '不可用'
}

function resetFilters() {
  search.value = ''
  modelSourceId.value = 'all'
}

function applyFilters() {
  cancelSearch()
  page.value = 1
  void loadData()
}

function manualRefresh() {
  cancelSearch()
  void loadData({ forceRefresh: true, retainVisibleModels: true })
}

function clearFilters() {
  resetFilters()
  applyFilters()
}

function changePage(next: number) {
  if (next < 1 || next > totalPages.value) return
  page.value = next
}

async function loadData(options: { forceRefresh?: boolean; retainVisibleModels?: boolean } = {}) {
  request?.abort()
  const next = new AbortController()
  request = next
  if (!options.retainVisibleModels) models.value = null
  isLoading.value = true
  errorMessage.value = ''
  try {
    const nextModels = await fetchModels({
      source,
      search: search.value.trim(),
      capability: 'all',
      environment: 'production',
      status: 'all',
      cacheMode: options.forceRefresh ? 'refresh' : 'default',
    }, next.signal)
    if (next.signal.aborted || request !== next) return
    if (nextModels.meta.source !== source) throw new ModelsApiError('数据来源与当前页面不一致，请重试。')
    models.value = nextModels
    if (modelSourceId.value !== 'all' && !nextModels.items.some((item) => relaySources(item).some((channel) => channel.id === modelSourceId.value))) modelSourceId.value = 'all'
    if (page.value > totalPages.value) page.value = totalPages.value
  } catch (error) {
    if (next.signal.aborted || request !== next) return
    const requestId = error instanceof ModelsApiError ? error.requestId : undefined
    errorMessage.value = (error instanceof ModelsApiError ? error.message : '连接失败，请确认后台服务已启动后重试。') + (requestId ? ` · 请求 ID ${requestId}` : '')
  } finally {
    if (request === next) isLoading.value = false
  }
}

const { cancel: cancelSearch } = useDebouncedSearch(search, () => {
  page.value = 1
  void loadData()
})
onMounted(() => void loadData())
onBeforeUnmount(() => request?.abort())
</script>

<template>
  <div class="dashboard models-dashboard">
    <section class="page-heading">
      <div>
        <div class="eyebrow">RELAY MODEL CATALOG</div>
        <h1>模型目录</h1>
      </div>
      <div class="heading-actions">
        <span class="updated-at">更新于 {{ updatedAt }}</span>
        <button class="btn btn-white refresh-button" :disabled="isLoading" @click="manualRefresh"><IconRefresh :size="17" :class="{ spinning: isLoading }" />{{ isLoading ? '刷新中…' : '刷新' }}</button>
      </div>
    </section>

    <section class="catalog-source-control panel" aria-label="模型目录说明">
      <div>
        <span class="catalog-source-kicker">对外统一模型</span>
        <strong>AI OPS <code>ai-ops</code></strong>
        <p>统一查看已同步模型及其来源。</p>
      </div>
      <div class="catalog-source-assurance"><span><i />按来源合并</span><small>由第三方账号同步触发更新</small></div>
    </section>

    <div v-if="models" class="source-banner"><span class="live">中转站目录</span>{{ models.meta.notice }}</div>
    <p v-if="errorMessage && models" class="model-sync-warning" role="status">{{ errorMessage }}</p>

    <div v-if="isInitialLoading" class="panel data-state" role="status"><div class="state-icon"><IconRefresh :size="22" class="spinning" /></div><div><strong>正在读取模型目录</strong><p>正在汇总已同步中转站的模型来源…</p></div></div>
    <div v-else-if="errorMessage && !models" class="panel data-state failed" role="alert"><div class="state-icon"><IconAlertTriangle :size="22" /></div><div><strong>模型目录加载失败</strong><p>{{ errorMessage }}</p></div><button class="btn btn-white" @click="manualRefresh">重试</button></div>

    <template v-else-if="models">
      <section class="panel models-main-panel">
        <header class="panel-header"><div><span class="panel-title">已同步模型</span><span class="panel-subtitle">来源标签显示当前可用的账号。</span></div><span class="source-tag live">{{ visibleModels.length }} 个模型</span></header>
        <form class="model-filters" @submit.prevent="applyFilters">
          <label class="model-search"><IconSearch :size="16" /><input v-model="search" aria-label="搜索模型" maxlength="60" type="search" placeholder="搜索模型名称" /></label>
          <label><select v-model="modelSourceId" aria-label="模型来源" @change="page = 1"><option value="all">全部来源</option><option v-for="item in modelSourceOptions" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
          <span class="realtime-search-hint" aria-live="polite">输入即搜索</span>
          <button class="text-button" type="button" @click="clearFilters">清除</button>
        </form>

        <div v-if="pagedModels.length" class="table-responsive">
          <table class="data-table models-table">
            <thead><tr><th>模型</th><th>来源中转站</th><th>状态</th></tr></thead>
            <tbody>
              <tr v-for="item in pagedModels" :key="item.id">
                <td><div class="model-identity"><span><IconBrain :size="17" /></span><div><strong>{{ item.displayName }}</strong></div></div></td>
                <td><div class="channel-list-cell"><span v-for="channel in relaySources(item)" :key="channel.id" class="channel-chip" :title="channel.name">{{ channel.name }}</span><small v-if="!relaySources(item).length">未标注来源</small></div></td>
                <td><span class="model-status" :class="`status-${item.status}`">{{ statusLabel(item.status) }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="people-empty"><IconBrain :size="24" /><strong>{{ models.items.length === 0 ? '暂未同步到模型' : '没有符合条件的模型' }}</strong><span>{{ models.items.length === 0 ? '请先在“第三方账号”接入中转站并同步模型目录。' : '调整搜索词或来源筛选后重试。' }}</span><button v-if="models.items.length > 0" class="text-button" @click="clearFilters">清除筛选</button></div>
        <AppPagination :page="currentPage" :total-pages="totalPages" :total="visibleModels.length" aria-label="模型目录分页" @change="changePage" />
      </section>
      <footer class="page-footer">该目录只记录中转站的模型和来源。员工始终使用一个平台 Key 调用 <code>ai-ops</code>，不需要管理上游模型或上游凭据。</footer>
    </template>
  </div>
</template>

<style scoped>
.models-dashboard { max-width: 1500px; }.panel-header > div { display: grid; gap: 5px; min-width: 0; }.panel-title { font-size: 15px; font-weight: 600; color: var(--navy); }.panel-subtitle { font-size: 13px; line-height: 1.6; color: var(--muted); }
.catalog-source-control { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding: 17px 18px; margin-bottom: 16px; border-color: #cce6df; background: linear-gradient(110deg, #fbfffd, #f4fbfa); }.catalog-source-kicker { display: block; margin-bottom: 6px; color: #327879; font-size: 10px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }.catalog-source-control strong { display: block; font-size: 16px; color: var(--navy); }.catalog-source-control strong code { margin-left: 4px; color: #287175; font: 12px ui-monospace, SFMono-Regular, Consolas, monospace; }.catalog-source-control p { max-width: 720px; margin: 6px 0 0; font-size: 13px; line-height: 1.65; color: var(--muted); }.catalog-source-assurance { display: grid; gap: 5px; min-width: 150px; padding: 10px 12px; border: 1px solid #d6ece7; border-radius: 8px; background: rgba(255, 255, 255, .72); text-align: right; }.catalog-source-assurance span { display: inline-flex; justify-content: flex-end; align-items: center; gap: 6px; color: #24766e; font-size: 12px; font-weight: 700; }.catalog-source-assurance i { width: 7px; height: 7px; border-radius: 50%; background: #28a878; box-shadow: 0 0 0 3px #dff5eb; }.catalog-source-assurance small { color: #78898f; font-size: 10px; }
.model-filters { flex-wrap: wrap; }.model-filters .model-search { min-width: 0; }.models-dashboard .models-table { min-width: 720px; }.models-dashboard .models-table td { vertical-align: middle; white-space: normal; }.models-dashboard .models-table th { text-transform: none; }.model-identity { min-width: 220px; }.channel-list-cell { min-width: 270px; display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }.channel-chip { max-width: 240px; overflow: hidden; padding: 4px 7px; border: 1px solid #cfe7e1; border-radius: 999px; color: #1f6b64; background: #f0faf7; font-size: 9px; font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }.channel-list-cell small { color: #86969c; font-size: 9px; }.model-status { display: inline-flex; padding: 4px 7px; border-radius: 999px; color: #287a49; background: #eaf7ee; font-size: 9px; font-weight: 700; }.model-status.status-degraded, .model-status.status-unverified { color: #956615; background: #fff3d9; }.model-status.status-unavailable { color: #9b4a4a; background: #fdecec; }.model-sync-warning { margin: 10px 0 0; padding: 9px 12px; border: 1px solid #f1d9a7; border-radius: 7px; color: #7b5a18; background: #fffaf0; font-size: 11px; line-height: 1.5; }
@media (max-width: 850px) { .catalog-source-control { align-items: flex-start; flex-direction: column; gap: 14px; }.catalog-source-assurance { width: 100%; text-align: left; }.catalog-source-assurance span { justify-content: flex-start; } }
</style>
