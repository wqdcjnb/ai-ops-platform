<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { IconAlertTriangle, IconCheck, IconCircleOff, IconPlus, IconRefresh, IconServer2, IconTrash } from '@tabler/icons-vue'
import {
  checkExternalProviderHealth,
  deleteExternalProvider,
  discoverExternalProviderModels,
  ExternalProvidersApiError,
  fetchExternalProviders,
  saveExternalProvider,
  setExternalProviderEnabled,
  syncExternalProviderModels,
  testExternalProviderModels,
  type ExternalProvider,
  type ExternalProviderInput,
  type ExternalProviderModelTest,
} from '../external-providers-api'

const providers = ref<ExternalProvider[]>([])
const notice = ref('')
const errorMessage = ref('')
const isLoading = ref(false)
const isSaving = ref(false)
const isDiscovering = ref(false)
const isTesting = ref(false)
const syncingId = ref<string | null>(null)
const checkingId = ref<string | null>(null)
const showForm = ref(false)
const editing = ref<ExternalProvider | null>(null)
const formError = ref('')
const discoveredModels = ref<string[]>([])
const discoveryLatencyMs = ref<number | null>(null)
const modelListFetched = ref(false)
const modelTests = ref<ExternalProviderModelTest[]>([])

function emptyForm(): ExternalProviderInput {
  return { name: '', baseUrl: '', apiKey: '', modelIds: [], enabled: true }
}

const form = ref<ExternalProviderInput>(emptyForm())
const enabledCount = computed(() => providers.value.filter((item) => item.enabled && item.credentialConfigured).length)
const modelCount = computed(() => providers.value.reduce((total, item) => total + item.models.length, 0))
const selectedModelCount = computed(() => form.value.modelIds?.length ?? 0)
const allModelsSelected = computed(() => discoveredModels.value.length > 0 && selectedModelCount.value === discoveredModels.value.length)
const isFormBusy = computed(() => isSaving.value || isDiscovering.value || isTesting.value)
const testSummary = computed(() => ({
  available: modelTests.value.filter((item) => item.status === 'available').length,
  catalogConfirmed: modelTests.value.filter((item) => item.status === 'catalog_confirmed').length,
  unavailable: modelTests.value.filter((item) => item.status === 'unavailable').length,
}))

function formatDate(value: string | null) {
  if (!value) return '尚未同步'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '尚未同步' : new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

function healthLabel(provider: ExternalProvider) {
  if (!provider.enabled) return '已停用'
  if (provider.health === 'healthy') return provider.latencyMs === null ? '健康' : `健康 · ${provider.latencyMs}ms`
  if (provider.health === 'error') return '检查异常'
  return '待检查'
}

function testStatusLabel(status: ExternalProviderModelTest['status']) {
  return ({ available: '可调用', catalog_confirmed: '目录已确认', unavailable: '不可用' })[status]
}

function resetModelPreview(models: string[] = [], latencyMs: number | null = null, fetched = false) {
  discoveredModels.value = models
  discoveryLatencyMs.value = latencyMs
  form.value.modelIds = [...models]
  modelListFetched.value = fetched
  modelTests.value = []
}

function invalidateModelPreview() {
  resetModelPreview()
}

function openCreate() {
  editing.value = null
  form.value = emptyForm()
  formError.value = ''
  resetModelPreview()
  errorMessage.value = ''
  showForm.value = true
}

function openEdit(provider: ExternalProvider) {
  editing.value = provider
  const models = provider.models.map((model) => model.upstreamId)
  form.value = { id: provider.id, name: provider.name, baseUrl: provider.baseUrl, apiKey: '', modelIds: models, enabled: provider.enabled }
  formError.value = ''
  resetModelPreview(models, provider.latencyMs, models.length > 0)
  errorMessage.value = ''
  showForm.value = true
}

function closeForm() {
  if (!isFormBusy.value) showForm.value = false
}

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const result = await fetchExternalProviders()
    providers.value = result.items
  } catch (error) {
    errorMessage.value = error instanceof ExternalProvidersApiError ? error.message : '第三方账号暂时无法加载。'
  } finally {
    isLoading.value = false
  }
}

async function discoverModels() {
  formError.value = ''
  const baseUrl = form.value.baseUrl.trim()
  const apiKey = form.value.apiKey?.trim() ?? ''
  if (!baseUrl || !apiKey) {
    formError.value = '请先填写 Base URL 和 API Key，再获取模型列表。'
    return
  }

  isDiscovering.value = true
  try {
    const result = await discoverExternalProviderModels({ baseUrl, apiKey })
    resetModelPreview(result.models, result.latencyMs, true)
    if (!result.models.length) formError.value = '该账号未返回可接入的模型，请检查 Base URL、API Key 和服务端兼容性。'
  } catch (error) {
    formError.value = error instanceof ExternalProvidersApiError ? error.message : '模型列表暂时无法获取。'
  } finally {
    isDiscovering.value = false
  }
}

function selectAllModels() {
  form.value.modelIds = [...discoveredModels.value]
  modelTests.value = []
}

function clearSelectedModels() {
  form.value.modelIds = []
  modelTests.value = []
}

function clearTestResults() {
  modelTests.value = []
}

async function testSelectedModels() {
  formError.value = ''
  const baseUrl = form.value.baseUrl.trim()
  const apiKey = form.value.apiKey?.trim() ?? ''
  const modelIds = [...(form.value.modelIds ?? [])]
  if (!baseUrl || !apiKey) {
    formError.value = '请填写 Base URL 和 API Key 后再测试模型。'
    return
  }
  if (!modelIds.length) {
    formError.value = '请至少选择一个模型后再测试。'
    return
  }

  isTesting.value = true
  try {
    const result = await testExternalProviderModels({ baseUrl, apiKey, modelIds })
    discoveryLatencyMs.value = result.catalogLatencyMs
    modelTests.value = result.results
  } catch (error) {
    formError.value = error instanceof ExternalProvidersApiError ? error.message : '模型测试暂时无法完成。'
  } finally {
    isTesting.value = false
  }
}

async function save() {
  formError.value = ''
  const modelIds = [...(form.value.modelIds ?? [])]
  if (!editing.value && !modelListFetched.value) {
    formError.value = '请先获取模型列表并选择需要接入的模型。'
    return
  }
  if (!modelIds.length) {
    formError.value = '请至少选择一个模型后再保存。'
    return
  }

  isSaving.value = true
  try {
    const provider = await saveExternalProvider({
      ...form.value,
      name: form.value.name.trim(),
      baseUrl: form.value.baseUrl.trim(),
      apiKey: form.value.apiKey?.trim() || undefined,
      modelIds,
    })
    notice.value = `已保存 ${provider.provider.name}，接入 ${provider.provider.models.length} 个已选模型。`
    showForm.value = false
    await load()
  } catch (error) {
    formError.value = error instanceof ExternalProvidersApiError ? error.message : '账号保存失败。'
  } finally {
    isSaving.value = false
  }
}

async function sync(provider: ExternalProvider) {
  syncingId.value = provider.id
  errorMessage.value = ''
  try {
    await syncExternalProviderModels(provider.id)
    await load()
  } catch (error) {
    errorMessage.value = error instanceof ExternalProvidersApiError ? error.message : '模型目录同步失败。'
  } finally {
    syncingId.value = null
  }
}

async function checkHealth(provider: ExternalProvider) {
  checkingId.value = provider.id
  errorMessage.value = ''
  try {
    await checkExternalProviderHealth(provider.id)
    await load()
  } catch (error) {
    errorMessage.value = error instanceof ExternalProvidersApiError ? error.message : '第三方账号健康检查失败。'
  } finally {
    checkingId.value = null
  }
}

async function toggle(provider: ExternalProvider) {
  try {
    await setExternalProviderEnabled(provider.id, !provider.enabled)
    await load()
  } catch (error) {
    errorMessage.value = error instanceof ExternalProvidersApiError ? error.message : '账号状态更新失败。'
  }
}

async function remove(provider: ExternalProvider) {
  if (!window.confirm(`确定删除第三方账号“${provider.name}”吗？其已选模型将从目录中移除。`)) return
  try {
    await deleteExternalProvider(provider.id)
    await load()
  } catch (error) {
    errorMessage.value = error instanceof ExternalProvidersApiError ? error.message : '账号删除失败。'
  }
}

onMounted(() => void load())
</script>

<template>
  <div class="dashboard relay-accounts-dashboard">
    <section class="page-heading">
      <div>
        <div class="eyebrow">THIRD-PARTY ACCOUNTS</div>
        <h1>第三方账号</h1>
        <p>接入已授权的 OpenAI 兼容服务，选择可纳入 AI OPS 路由的模型。</p>
      </div>
      <div class="heading-actions">
        <button class="btn btn-white refresh-button" :disabled="isLoading" @click="load"><IconRefresh :size="16" :class="{ spinning: isLoading }" />刷新</button>
        <button class="btn create-key" @click="openCreate"><IconPlus :size="16" />接入第三方账号</button>
      </div>
    </section>

    <p v-if="errorMessage" class="relay-message error"><IconAlertTriangle :size="16" />{{ errorMessage }}</p>
    <p v-else-if="notice" class="relay-message"><IconCheck :size="16" />{{ notice }}</p>

    <section class="relay-summary">
      <article class="metric-card"><span>已接入账号</span><strong>{{ providers.length }}</strong><small>管理员维护的第三方账号</small></article>
      <article class="metric-card"><span>可路由账号</span><strong>{{ enabledCount }}</strong><small>已启用且凭据可用</small></article>
      <article class="metric-card"><span>已选模型</span><strong>{{ modelCount }}</strong><small>只统计已选择纳入路由的模型</small></article>
    </section>

    <section class="panel relay-list">
      <div v-if="isLoading && !providers.length" class="data-state"><div class="state-icon"><IconRefresh :size="22" class="spinning" /></div><div><strong>正在读取第三方账号</strong><p>凭据不会返回浏览器。</p></div></div>
      <template v-else>
        <div v-if="providers.length" class="relay-cards">
          <article v-for="provider in providers" :key="provider.id" class="relay-card" :class="{ disabled: !provider.enabled }">
            <header>
              <div><span class="relay-icon"><IconServer2 :size="19" /></span><div><h2>{{ provider.name }}</h2><code>{{ provider.id }}</code></div></div>
              <span class="relay-status" :class="provider.enabled && provider.credentialConfigured ? 'healthy' : 'disabled'">{{ provider.enabled && provider.credentialConfigured ? '可路由' : provider.enabled ? '凭据异常' : '已停用' }}</span>
            </header>
            <dl>
              <div><dt>Base URL</dt><dd>{{ provider.host }}</dd></div>
              <div><dt>已选模型</dt><dd>{{ provider.models.length }} 个</dd></div>
              <div><dt>健康状态</dt><dd>{{ healthLabel(provider) }}</dd></div>
              <div><dt>最后同步</dt><dd>{{ formatDate(provider.lastSyncedAt) }}</dd></div>
            </dl>
            <p v-if="provider.lastSyncError" class="sync-error"><IconAlertTriangle :size="14" />{{ provider.lastSyncError }}</p>
            <footer>
              <button class="action-link" :disabled="checkingId === provider.id" @click="checkHealth(provider)"><IconRefresh :size="14" :class="{ spinning: checkingId === provider.id }" />{{ checkingId === provider.id ? '检查中…' : '连接测试' }}</button>
              <button class="action-link" :disabled="syncingId === provider.id" @click="sync(provider)"><IconRefresh :size="14" :class="{ spinning: syncingId === provider.id }" />{{ syncingId === provider.id ? '同步中…' : '同步模型目录' }}</button>
              <button class="action-link" @click="openEdit(provider)">编辑账号</button>
              <button class="action-link" @click="toggle(provider)">{{ provider.enabled ? '停用' : '启用' }}</button>
              <button class="action-link danger" @click="remove(provider)"><IconTrash :size="14" />删除</button>
            </footer>
          </article>
        </div>
        <div v-else class="people-empty"><IconCircleOff :size="25" /><strong>暂未接入第三方账号</strong><span>接入后，选择需要纳入 AI OPS 路由的模型。</span><button class="btn create-key" @click="openCreate">接入第一个账号</button></div>
      </template>
    </section>

    <div v-if="showForm" class="drawer-backdrop">
      <aside class="relay-form" role="dialog" aria-modal="true" :aria-label="editing ? '编辑第三方账号' : '接入第三方账号'">
        <header>
          <div><p class="eyebrow">THIRD-PARTY ACCOUNT</p><h2>{{ editing ? '编辑第三方账号' : '接入第三方账号' }}</h2><p>填写连接信息，获取模型列表后选择接入范围。</p></div>
          <button class="icon-button" :disabled="isFormBusy" aria-label="关闭" @click="closeForm">×</button>
        </header>

        <form @submit.prevent="save">
          <div class="relay-form-fields">
            <label class="relay-input-field"><span>名称</span><input v-model="form.name" required maxlength="80" placeholder="请输入名称" /></label>
            <label class="relay-input-field"><span>Base URL</span><small>填写服务的 API 根地址（例如以 <code>/v1</code> 结尾），不要填写服务商控制台网址。</small><input v-model="form.baseUrl" required type="url" placeholder="请输入 Base URL" @input="invalidateModelPreview" /></label>
            <label class="relay-input-field relay-input-wide"><span>API Key</span><small>{{ editing ? '留空即继续使用服务端已加密保存的 Key' : '仅用于服务端验证和加密保存，不会返回浏览器' }}</small><input v-model="form.apiKey" :required="!editing" type="password" autocomplete="new-password" maxlength="2048" placeholder="请输入 API Key" @input="invalidateModelPreview" /></label>
          </div>

          <section class="relay-model-workbench" aria-label="模型选择">
            <header class="relay-section-header">
              <div><h3>模型列表</h3><p>获取后可逐项选择，保存时会再次校验所选模型。</p></div>
              <button class="btn btn-white relay-fetch-button" type="button" :disabled="isFormBusy" @click="discoverModels"><IconRefresh :size="15" :class="{ spinning: isDiscovering }" />{{ isDiscovering ? '获取中…' : '获取模型列表' }}</button>
            </header>

            <div v-if="!modelListFetched" class="relay-model-empty"><IconServer2 :size="18" /><span>填写 Base URL 和 API Key 后，点击“获取模型列表”。</span></div>
            <template v-else>
              <div class="relay-model-toolbar">
                <span>共 {{ discoveredModels.length }} 个模型<span v-if="discoveryLatencyMs !== null"> · 目录延迟 {{ discoveryLatencyMs }}ms</span></span>
                <div><button class="text-button" type="button" :disabled="isFormBusy || allModelsSelected" @click="selectAllModels">全选</button><button class="text-button" type="button" :disabled="isFormBusy || selectedModelCount === 0" @click="clearSelectedModels">取消全选</button></div>
              </div>
              <div v-if="discoveredModels.length" class="relay-model-selection">
                <label v-for="model in discoveredModels" :key="model" class="relay-model-option" :class="{ selected: form.modelIds?.includes(model) }">
                  <input v-model="form.modelIds" type="checkbox" :value="model" :disabled="isFormBusy" @change="clearTestResults" />
                  <span><strong>{{ model }}</strong><small>{{ form.modelIds?.includes(model) ? '已选择' : '未选择' }}</small></span>
                </label>
              </div>
              <p v-else class="relay-model-empty">该账号没有返回可接入模型。</p>
            </template>
          </section>

          <section v-if="modelListFetched" class="relay-test-workbench" aria-label="模型测试">
            <header class="relay-section-header">
              <div><h3>模型测试</h3><p>检查目录可达性，并测试文本模型的响应延迟。</p></div>
              <button class="btn btn-white relay-test-button" type="button" :disabled="isFormBusy || selectedModelCount === 0" @click="testSelectedModels"><IconRefresh :size="15" :class="{ spinning: isTesting }" />{{ isTesting ? '测试中…' : '测试已选模型' }}</button>
            </header>
            <p class="relay-test-note">文本模型会先测试 Chat Completions，失败后自动再测试 Responses；已识别的图片、视频或语音模型不会自动提交可能计费的生成任务，目录确认后仅在对应专用接口中参与路由。</p>
            <div v-if="modelTests.length" class="relay-test-results">
              <div class="relay-test-summary"><span>可调用 {{ testSummary.available }}</span><span>目录已确认 {{ testSummary.catalogConfirmed }}</span><span>不可用 {{ testSummary.unavailable }}</span></div>
              <article v-for="result in modelTests" :key="result.id" class="relay-test-result">
                <div><strong>{{ result.id }}</strong><small>{{ result.message }}</small></div>
                <span class="relay-test-status" :class="result.status">{{ testStatusLabel(result.status) }}</span>
                <code>{{ result.latencyMs === null ? '—' : `${result.latencyMs}ms` }}</code>
              </article>
            </div>
          </section>

          <p v-if="formError" class="relay-form-error"><IconAlertTriangle :size="16" />{{ formError }}</p>
          <footer>
            <button class="btn btn-white" type="button" :disabled="isFormBusy" @click="closeForm">取消</button>
            <button class="btn create-key" :disabled="isFormBusy || selectedModelCount === 0" type="submit">{{ isSaving ? '保存中…' : `保存并接入 ${selectedModelCount} 个模型` }}</button>
          </footer>
        </form>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.relay-accounts-dashboard { max-width: 1500px; }
.relay-message { display: flex; align-items: center; gap: 7px; margin: 0 0 15px; padding: 10px 12px; border: 1px solid #d6ebe6; border-radius: 8px; color: #28746b; background: #f4fbf9; font-size: 12px; }
.relay-message.error { border-color: #f0d0d0; color: var(--danger); background: #fff6f6; }
.relay-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-bottom: 16px; }
.relay-summary .metric-card { display: grid; gap: 5px; }
.relay-summary span, .relay-summary small { color: var(--muted); font-size: 11px; }
.relay-summary strong { color: var(--navy); font-size: 27px; }
.relay-list { min-height: 280px; padding: 18px; }
.relay-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(310px, 1fr)); gap: 14px; }
.relay-card { display: grid; gap: 17px; padding: 17px; border: 1px solid var(--line); border-radius: 11px; background: var(--surface); }
.relay-card.disabled { opacity: .72; }
.relay-card header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.relay-card header > div { display: flex; align-items: center; gap: 9px; min-width: 0; }
.relay-icon { display: grid; flex: none; place-items: center; width: 35px; height: 35px; border-radius: 8px; color: var(--brand); background: #e7f2f2; }
.relay-card h2 { overflow: hidden; margin: 0 0 3px; color: var(--navy); font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
.relay-card code { color: var(--muted); font-size: 10px; }
.relay-status { flex: none; padding: 4px 7px; border-radius: 999px; color: #28734c; background: #ebf8ef; font-size: 10px; font-weight: 700; }
.relay-status.disabled { color: #7e5b18; background: #fff3d9; }
.relay-card dl { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 0; }
.relay-card dt { margin-bottom: 4px; color: var(--muted); font-size: 10px; }
.relay-card dd { overflow: hidden; margin: 0; color: var(--navy); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.sync-error { display: flex; gap: 5px; margin: -5px 0 0; color: var(--danger); font-size: 11px; line-height: 1.5; }
.relay-card footer { display: flex; flex-wrap: wrap; gap: 11px; padding-top: 12px; border-top: 1px solid var(--line); }
.action-link { display: inline-flex; align-items: center; gap: 4px; padding: 0; border: 0; color: var(--brand); background: transparent; font: inherit; font-size: 11px; cursor: pointer; }
.action-link:disabled { opacity: .6; cursor: wait; }
.action-link.danger { color: var(--danger); }

.relay-form { width: min(100%, 980px); max-height: min(84vh, 820px); border: 1px solid var(--line); border-radius: 13px; background: var(--surface); box-shadow: 0 24px 65px rgba(0, 0, 0, .25); }
.relay-form > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 22px 26px 18px; border-bottom: 1px solid var(--line); }
.relay-form > header .eyebrow { margin: 0; }
.relay-form h2 { margin: 4px 0 0; color: var(--navy); font-size: 21px; }
.relay-form > header p:last-child { margin: 7px 0 0; color: var(--muted); font-size: 12px; }
.relay-form form { display: grid; gap: 16px; padding: 22px 26px 24px; }
.relay-form-fields { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); gap: 14px; }
.relay-input-field { display: grid; gap: 7px; min-width: 0; color: var(--navy); font-size: 12px; font-weight: 700; }
.relay-input-field > small { margin-top: -3px; color: var(--muted); font-size: 10px; font-weight: 400; }
.relay-input-wide { grid-column: 1 / -1; }
.relay-input-field input { width: 100%; min-height: 42px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; outline: 0; color: var(--navy); background: #fbfcfd; font: inherit; font-size: 13px; }
.relay-input-field input:focus { border-color: #77afb1; box-shadow: 0 0 0 3px rgba(20, 108, 112, .09); }
.relay-input-field input::placeholder { color: #9aa8b0; }
.relay-model-workbench, .relay-test-workbench { border: 1px solid #dce7e9; border-radius: 10px; background: #fbfdfd; }
.relay-section-header { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 15px 16px; border-bottom: 1px solid #e3ecee; }
.relay-section-header > div { min-width: 0; }
.relay-section-header h3 { margin: 0; color: var(--navy); font-size: 14px; }
.relay-section-header p { margin: 4px 0 0; color: var(--muted); font-size: 11px; line-height: 1.5; }
.relay-fetch-button, .relay-test-button { flex: 0 0 auto; min-height: 32px; white-space: nowrap; }
.relay-model-empty { display: flex; align-items: center; gap: 8px; min-height: 76px; padding: 16px; color: var(--muted); font-size: 12px; }
.relay-model-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 11px 16px; color: var(--muted); font-size: 11px; }
.relay-model-toolbar > div { display: flex; align-items: center; gap: 8px; }
.relay-model-toolbar .text-button { padding: 2px 0; }
.relay-model-selection { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; max-height: 234px; overflow: auto; padding: 0 16px 16px; }
.relay-model-option { display: flex; align-items: flex-start; gap: 8px; min-width: 0; min-height: 58px; padding: 10px; border: 1px solid #e2eaec; border-radius: 8px; color: #60717b; background: #fff; cursor: pointer; transition: border-color .16s, background .16s; }
.relay-model-option:hover { border-color: #a5c7c9; }
.relay-model-option.selected { border-color: #6aa9ad; color: var(--brand-dark); background: #f0f8f8; }
.relay-model-option input { flex: 0 0 auto; margin: 3px 0 0; accent-color: var(--brand); }
.relay-model-option span { display: grid; min-width: 0; gap: 3px; }
.relay-model-option strong { overflow: hidden; color: var(--navy); font: 11px ui-monospace, SFMono-Regular, Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
.relay-model-option small { color: var(--muted); font-size: 10px; }
.relay-test-workbench { overflow: hidden; }
.relay-test-note { margin: 0; padding: 11px 16px; color: #7b8991; background: #f6fafb; font-size: 10px; line-height: 1.55; }
.relay-test-results { max-height: 250px; overflow: auto; border-top: 1px solid #e3ecee; }
.relay-test-summary { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 16px; border-bottom: 1px solid #e8eff0; color: #4b6670; font-size: 10px; }
.relay-test-summary span { padding: 4px 6px; border-radius: 999px; background: #edf5f5; }
.relay-test-result { display: grid; grid-template-columns: minmax(0, 1fr) auto 72px; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid #edf2f3; }
.relay-test-result:last-child { border-bottom: 0; }
.relay-test-result > div { display: grid; min-width: 0; gap: 3px; }
.relay-test-result strong { overflow: hidden; color: var(--navy); font: 11px ui-monospace, SFMono-Regular, Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
.relay-test-result small { overflow: hidden; color: var(--muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.relay-test-status { padding: 4px 6px; border-radius: 999px; font-size: 10px; font-weight: 700; white-space: nowrap; }
.relay-test-status.available { color: #28734c; background: #ebf8ef; }
.relay-test-status.catalog_confirmed { color: #79601d; background: #fff4d9; }
.relay-test-status.unavailable { color: #a94242; background: #fff0f0; }
.relay-test-result code { color: #5d7079; font: 11px ui-monospace, SFMono-Regular, Consolas, monospace; text-align: right; }
.relay-form-error { display: flex; align-items: flex-start; gap: 7px; margin: 0; padding: 10px 12px; border-radius: 8px; color: var(--danger); background: #fff2f2; font-size: 12px; line-height: 1.5; }
.relay-form footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px; padding-top: 16px; border-top: 1px solid var(--line); }

@media (max-width: 720px) {
  .relay-summary { grid-template-columns: 1fr; }
  .relay-card dl { grid-template-columns: 1fr; }
  .relay-form { max-height: calc(100vh - 28px); }
  .relay-form > header, .relay-form form { padding-right: 18px; padding-left: 18px; }
  .relay-form-fields, .relay-model-selection { grid-template-columns: 1fr; }
  .relay-section-header { align-items: flex-start; flex-direction: column; }
  .relay-fetch-button, .relay-test-button { width: 100%; }
}

@media (max-width: 520px) {
  .relay-model-toolbar, .relay-form footer { align-items: flex-start; flex-direction: column; }
  .relay-form footer .btn { width: 100%; }
  .relay-model-toolbar > div { width: 100%; justify-content: space-between; }
  .relay-test-result { grid-template-columns: minmax(0, 1fr) auto; }
  .relay-test-result code { grid-column: 1 / -1; text-align: left; }
}
</style>
