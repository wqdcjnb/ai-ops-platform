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

export function useExternalProvidersView() {
/**
 * All state and behaviour for the ExternalProvidersView view.
 * Extracted verbatim from the component so the template keeps rendering identically.
 */

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

  return { IconAlertTriangle, IconCheck, IconCircleOff, IconPlus, IconRefresh, IconServer2, IconTrash, providers, notice, errorMessage, isLoading, isSaving, isDiscovering, isTesting, syncingId, checkingId, showForm, editing, formError, discoveredModels, discoveryLatencyMs, modelListFetched, modelTests, emptyForm, form, enabledCount, modelCount, selectedModelCount, allModelsSelected, isFormBusy, testSummary, formatDate, healthLabel, testStatusLabel, resetModelPreview, invalidateModelPreview, openCreate, openEdit, closeForm, load, discoverModels, selectAllModels, clearSelectedModels, clearTestResults, testSelectedModels, save, sync, checkHealth, toggle, remove }
}
