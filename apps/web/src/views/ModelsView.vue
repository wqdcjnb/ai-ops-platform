<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { IconAlertTriangle, IconBrain, IconRefresh, IconSearch } from '@tabler/icons-vue'
import { fetchModels, ModelsApiError, testModel, type CatalogSource, type ModelFilters, type ModelItem, type ModelsResponse, type ModelTestResponse } from '../models-api'
import { useDebouncedSearch } from '../composables/useDebouncedSearch'

// The catalog itself remains CPA-backed. New API is used only for the
// explicit channel probe, so the browser never receives a channel key.
const source = ref<CatalogSource>('cpa')
const models = ref<ModelsResponse | null>(null)
const search = ref('')
const capability = ref<ModelFilters['capability']>('all')
const isLoading = ref(false)
const errorMessage = ref('')
const testingModelId = ref<string | null>(null)
const testError = ref('')
let request: AbortController | null = null
let testRequest: AbortController | null = null

const sourceLabel = computed(() => source.value === 'cpa' ? 'CPA Codex OAuth · 实时目录' : 'New API · 只读目录')
const updatedAt = computed(() => models.value
  ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(models.value.meta.generatedAt))
  : '等待数据')
const capabilityText: Record<string, string> = { text: '文本', reasoning: '推理', translation: '翻译', vision: '视觉', batch: '批处理' }
const testStatusText = { passed: '通过', failed: '失败', not_tested: '未测试', unavailable: '不可用' } as const
type ModelChannel = NonNullable<ModelItem['channels']>[number]

function resetFilters() {
  search.value = ''
  capability.value = 'all'
}

function applyFilters() {
  cancelSearch()
  void loadData()
}

function changeSource() {
  resetFilters()
  applyFilters()
}

function clearFilters() {
  resetFilters()
  applyFilters()
}

function requestEnvironment(): ModelFilters['environment'] {
  return source.value === 'cpa' ? 'production' : 'all'
}

async function loadData() {
  request?.abort()
  const next = new AbortController()
  request = next
  models.value = null
  isLoading.value = true
  errorMessage.value = ''
  const requestedSource = source.value
  try {
    const nextModels = await fetchModels({
      source: requestedSource,
      search: search.value.trim(),
      capability: capability.value,
      environment: requestEnvironment(),
      status: 'all',
    }, next.signal)
    if (next.signal.aborted || request !== next) return
    if (nextModels.meta.source !== requestedSource) throw new ModelsApiError('数据来源与当前选择不一致，请重试。')
    models.value = nextModels
  } catch (error) {
    if (next.signal.aborted || request !== next) return
    const requestId = error instanceof ModelsApiError ? error.requestId : undefined
    errorMessage.value = (error instanceof ModelsApiError ? error.message : '连接失败，请确认后台服务已启动后重试。') + (requestId ? ' · 请求 ID ' + requestId : '')
  } finally {
    if (request === next) isLoading.value = false
  }
}

function channelRefs(item: ModelItem): ModelChannel[] {
  if (item.channels?.length) return item.channels
  if (source.value === 'cpa') return [{ id: 'cpa-auth-source-codex', name: 'Codex', provider: 'Codex', source: 'cpa_auth_file' }]
  if (item.channelIds.length) return item.channelIds.map((id): ModelChannel => ({ id, name: id, source: 'new_api' }))
  return [{ id: 'cpa-auth-source-codex', name: 'Codex', provider: 'Codex', source: 'cpa_auth_file' }]
}

function resultLabel(item: ModelItem) {
  const result = item.testResult
  if (!result) return '未测试'
  if (result.status === 'passed' && result.latencyMs !== null) return `通过 · ${result.latencyMs} ms`
  return testStatusText[result.status]
}

function resultTime(item: ModelItem) {
  const value = item.testResult?.testedAt
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

function applyTestResponse(response: ModelTestResponse) {
  if (!models.value) return
  const result = response.result
  const updated = models.value.items.map((item) => item.actualModel === result.model
    ? { ...item, testResult: { status: result.status, latencyMs: result.latencyMs, testedAt: result.testedAt, channelId: result.channelId, message: result.message, testPath: result.testPath } }
    : item)
  models.value = { ...models.value, items: updated }
}

async function runModelTest(item: ModelItem) {
  testRequest?.abort()
  const next = new AbortController()
  testRequest = next
  testingModelId.value = item.id
  testError.value = ''
  try {
    const response = await testModel({ model: item.actualModel, channelId: item.testResult?.channelId ?? undefined }, next.signal)
    if (!next.signal.aborted && testRequest === next) applyTestResponse(response)
  } catch (error) {
    if (next.signal.aborted || testRequest !== next) return
    const requestId = error instanceof ModelsApiError ? error.requestId : undefined
    testError.value = (error instanceof ModelsApiError ? error.message : '模型测试失败，请稍后重试。') + (requestId ? ' · 请求 ID ' + requestId : '')
  } finally {
    if (testRequest === next) {
      testRequest = null
      testingModelId.value = null
    }
  }
}

const { cancel: cancelSearch } = useDebouncedSearch(search, () => void loadData())
onMounted(() => void loadData())
onBeforeUnmount(() => {
  request?.abort()
  testRequest?.abort()
})
</script>

<template>
  <div class="dashboard models-dashboard">
    <section class="page-heading">
      <div>
        <h1>模型目录</h1>
        <p>只展示名称、能力、CPA 认证渠道和模型测试结果。</p>
      </div>
      <div class="heading-actions">
        <span class="updated-at">更新于 {{ updatedAt }}</span>
        <button class="btn btn-white refresh-button" :disabled="isLoading" @click="applyFilters">
          <IconRefresh :size="17" :class="{ spinning: isLoading }" />刷新
        </button>
      </div>
    </section>

    <section class="catalog-source-control panel" aria-label="数据源">
      <div>
        <strong>CPA 认证文件模型</strong>
        <p>渠道名称来自 CPA 的认证文件（例如 Codex）；点击“测试”时直接调用 New API 渠道测试。</p>
      </div>
      <label class="catalog-source-select">
        <span>目录来源</span>
        <select v-model="source" aria-label="模型目录来源" @change="changeSource">
          <option value="cpa">CPA Codex OAuth</option>
          <option value="new_api">New API</option>
        </select>
      </label>
    </section>

    <div v-if="models" class="source-banner"><span class="live">{{ sourceLabel }}</span>{{ models.meta.notice }}</div>

    <div v-if="isLoading" class="panel data-state" role="status">
      <div class="state-icon"><IconRefresh :size="22" class="spinning" /></div>
      <div><strong>正在读取{{ sourceLabel }}</strong><p>正在加载模型目录…</p></div>
    </div>
    <div v-else-if="errorMessage" class="panel data-state failed" role="alert">
      <div class="state-icon"><IconAlertTriangle :size="22" /></div>
      <div><strong>模型目录加载失败</strong><p>{{ errorMessage }}</p></div>
      <button class="btn btn-white" @click="loadData">重试</button>
    </div>

    <template v-else-if="models">
      <section class="panel models-main-panel">
        <header class="panel-header">
          <div><span class="panel-title">模型</span><span class="panel-subtitle">名称、能力、渠道与测试结果</span></div>
          <span class="source-tag live">{{ models.items.length }} 个模型</span>
        </header>
        <form class="model-filters" @submit.prevent="applyFilters">
          <label class="model-search"><IconSearch :size="16" /><input v-model="search" aria-label="搜索模型" maxlength="60" type="search" placeholder="搜索模型名称或 ID" /></label>
          <label><select v-model="capability" aria-label="模型能力" @change="applyFilters"><option value="all">全部能力</option><option v-for="item in models.options.capabilities" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
          <span class="realtime-search-hint" aria-live="polite">输入即搜索</span>
          <button class="text-button" type="button" @click="clearFilters">清除</button>
        </form>

        <div v-if="models.items.length" class="table-responsive">
          <table class="data-table models-table">
            <thead><tr><th>名称</th><th>能力</th><th>渠道</th><th>模型测试结果</th></tr></thead>
            <tbody>
              <tr v-for="item in models.items" :key="item.id">
                <td><div class="model-identity"><span><IconBrain :size="17" /></span><div><strong>{{ item.displayName }}</strong><small v-if="item.actualModel !== item.displayName">{{ item.actualModel }}</small></div></div></td>
                <td><div class="capability-tags"><span v-for="entry in item.capabilities" :key="entry">{{ capabilityText[entry] ?? entry }}</span><small v-if="!item.capabilities.length">未提供</small></div></td>
                <td><div class="channel-list-cell"><span v-for="channel in channelRefs(item).slice(0, 3)" :key="channel.id" class="channel-chip" :title="channel.name">{{ channel.name }}</span><small v-if="channelRefs(item).length > 3">+{{ channelRefs(item).length - 3 }}</small></div></td>
                <td><div class="test-result-cell"><span class="test-result" :class="'test-' + (item.testResult?.status ?? 'not_tested')"><i />{{ resultLabel(item) }}</span><small v-if="resultTime(item)">{{ resultTime(item) }}</small><div class="test-result-actions"><button class="btn btn-white test-button" :disabled="testingModelId === item.id" :aria-label="'测试 ' + item.displayName" @click.stop="runModelTest(item)">{{ testingModelId === item.id ? '测试中…' : '测试' }}</button></div></div></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="people-empty"><IconBrain :size="24" /><strong>{{ models.summary.total === 0 ? '暂无正式模型配置' : '没有符合条件的模型' }}</strong><span>{{ models.summary.total === 0 ? '接入 CPA 认证文件后刷新即可查看。' : '调整搜索或能力筛选。' }}</span><button v-if="models.summary.total > 0" class="text-button" @click="clearFilters">清除筛选</button></div>
      </section>
      <p v-if="testError" class="model-test-error" role="alert">{{ testError }}</p>
      <footer class="page-footer">渠道来自 CPA 认证文件；测试结果来自 New API 渠道测试接口。</footer>
    </template>

  </div>
</template>

<style scoped>
.models-dashboard { max-width: 1500px; }
.panel-header > div { display: grid; gap: 5px; min-width: 0; }
.panel-title { font-size: 15px; font-weight: 600; color: var(--navy); }
.panel-subtitle { font-size: 13px; line-height: 1.6; color: var(--muted); }
.catalog-source-control { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 16px 18px; margin-bottom: 16px; }
.catalog-source-control strong { font-size: 15px; color: var(--navy); }
.catalog-source-control p { margin: 5px 0 0; font-size: 13px; line-height: 1.6; color: var(--muted); }
.catalog-source-select { display: grid; gap: 5px; min-width: 180px; color: var(--muted); font-size: 11px; }
.catalog-source-select select { min-height: 36px; padding: 0 30px 0 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--navy); }
.model-filters { flex-wrap: wrap; }
.model-filters .model-search { min-width: 0; }
.models-dashboard .models-table { min-width: 900px; }
.models-dashboard .models-table td { vertical-align: middle; white-space: normal; }
.models-dashboard .models-table th { text-transform: none; }
.model-identity { min-width: 190px; }
.model-identity small { overflow-wrap: anywhere; }
.channel-list-cell { min-width: 180px; display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.channel-chip { max-width: 180px; overflow: hidden; padding: 4px 6px; border: 1px solid #dce9ea; border-radius: 4px; color: #2d686c; background: #eef7f7; font-size: 8px; white-space: nowrap; text-overflow: ellipsis; }
.channel-list-cell small { color: #86969c; font-size: 8px; }
.test-result-cell { min-width: 230px; display: flex; align-items: center; flex-wrap: wrap; gap: 7px; }
.test-result { display: inline-flex; align-items: center; gap: 5px; color: #687982; font-size: 9px; font-weight: 700; white-space: nowrap; }
.test-result i { width: 7px; height: 7px; border-radius: 99px; background: currentColor; }
.test-result.test-passed { color: #2d8242; }
.test-result.test-failed { color: #c13d3d; }
.test-result.test-unavailable { color: #a06d11; }
.test-result-cell > small { color: #9aa5ab; font-size: 8px; white-space: nowrap; }
.test-result-actions { display: inline-flex; align-items: center; gap: 3px; margin-left: auto; }
.test-button { height: 29px; min-width: 48px; padding: 0 9px; font-size: 10px; }
.test-button:disabled { opacity: .65; cursor: wait; }
.model-test-error { margin: 10px 0 0; padding: 9px 12px; border-radius: 6px; color: #a34343; background: #fff0f0; font-size: 11px; }
@media (max-width: 850px) {
  .catalog-source-control { align-items: flex-start; flex-direction: column; }
  .catalog-source-select { width: 100%; }
  .test-result-actions { margin-left: 0; }
}
</style>
