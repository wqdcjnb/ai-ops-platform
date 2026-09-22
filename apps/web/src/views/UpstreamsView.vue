<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  IconAlertTriangle, IconBrain, IconCircleCheck, IconClock, IconDownload, IconFileText, IconFilter,
  IconKey, IconRefresh, IconSearch, IconServer2, IconSettings, IconShieldCheck, IconTrash, IconUpload, IconX,
} from '@tabler/icons-vue'
import { checkUpstream, deleteCpaAuthFile, downloadCpaAuthFile, fetchCpaAuthFileDetail, fetchCpaAuthFileModels, fetchCpaAuthFileQuota, fetchCpaAuthFiles, fetchCpaOAuthStatus, fetchCpaOAuthUrl, fetchUpstreamHistory, fetchUpstreams, requestCpaAuthFileRefresh, setCpaAuthFileStatus, uploadCpaAuthFile, updateCpaAuthFileSettings, UpstreamsApiError, verifyCpaAuth, type CpaAuthFileDetail, type CpaAuthFileModel, type CpaAuthFileQuota, type CpaAuthFileSettings, type CpaAuthFilesResponse, type CpaAuthVerification, type UpstreamCheckResponse, type UpstreamFilters, type UpstreamHistoryResponse, type UpstreamItem, type UpstreamsResponse } from '../upstreams-api'
import { useDebouncedSearch } from '../composables/useDebouncedSearch'

const upstreams = ref<UpstreamsResponse | null>(null)
const selected = ref<UpstreamItem | null>(null)
const search = ref('')
const type = ref<UpstreamFilters['type']>('all')
type CpaStatusFilter = 'all' | 'enabled' | 'disabled' | 'problem'
const status = ref<CpaStatusFilter>('all')
const isLoading = ref(false)
const errorMessage = ref('')
const showCheck = ref(false)
const isChecking = ref(false)
const checkError = ref('')
const checkResult = ref<UpstreamCheckResponse | null>(null)
const checkForm = ref({ reason: '', acknowledgeSynthetic: false })
const showHistory = ref(false)
const isHistoryLoading = ref(false)
const historyError = ref('')
const history = ref<UpstreamHistoryResponse | null>(null)
const showCredentials = ref(false)
const cpaAuthFile = ref<File | null>(null)
const cpaAuthFileInput = ref<HTMLInputElement | null>(null)
const isUploadingCpaAuth = ref(false)
const cpaAuthError = ref('')
const cpaAuthSuccess = ref('')
const cpaVerification = ref<CpaAuthVerification | null>(null)
const isVerifyingCpa = ref(false)
const isStartingCpaOAuth = ref(false)
const oauthState = ref('')
const oauthStatus = ref<'wait' | 'ok' | 'error' | ''>('')
type CpaAuthFile = CpaAuthFilesResponse['files'][number]
const cpaAuthFiles = ref<CpaAuthFile[]>([])
const cpaAuthFilesLoading = ref(false)
const cpaAuthFilesError = ref('')
const notice = ref('')
const noticeTone = ref<'success' | 'error'>('success')
let noticeTimer: number | undefined
const busyAction = ref('')
const quotaByFile = ref<Record<string, CpaAuthFileQuota>>({})
const quotaLoading = ref<Record<string, boolean>>({})
const quotaErrors = ref<Record<string, string>>({})
const modelFile = ref<CpaAuthFile | null>(null)
const models = ref<CpaAuthFileModel[]>([])
const modelsLoading = ref(false)
const modelsError = ref('')
const settingsFile = ref<CpaAuthFile | null>(null)
const settingsDetail = ref<CpaAuthFileDetail | null>(null)
const settingsLoading = ref(false)
const settingsSaving = ref(false)
const settingsError = ref('')
const settingsCopied = ref(false)
const settingsForm = ref<CpaAuthFileSettings>({ prefix: '', proxyUrl: '', priority: null, weight: null, disableCooling: false, websockets: false, usingApi: false, note: '', excludedModels: [], headers: {} })
const settingsExcludedModels = ref('')
const settingsHeaders = ref('{}')
const deleteTarget = ref<CpaAuthFile | null>(null)
const deleteError = ref('')
const isDeleting = ref(false)
let request: AbortController | undefined

const statusText = { healthy: '健康', degraded: '需关注', auth_required: '认证异常', offline: '离线', unconfigured: '未配置' }
const validationText = { verified: '验证通过', failed: '验证失败', not_checked: '未验证' }
const errorText = { authentication: '认证', rate_limit: '限流', timeout: '超时', balance: '余额', server: '服务端', connection: '连接' }
const cpaVerificationText = { verified: '真实验证通过', accepted: '已接入，等待 CPA 状态', failed: '真实验证失败', unavailable: '验证暂不可用' }
const credentialFeedback = computed(() => {
  const verification = cpaVerification.value
  if (cpaAuthError.value) return { tone: 'error' as const, title: '配置失败', message: cpaAuthError.value }
  if (verification?.status === 'failed') return { tone: 'error' as const, title: '配置失败', message: cpaAuthSuccess.value || verification.detail }
  if (verification?.status === 'verified') return { tone: 'success' as const, title: '配置成功', message: cpaAuthSuccess.value || verification.detail }
  if (verification?.status === 'accepted') return { tone: 'pending' as const, title: '配置待确认', message: cpaAuthSuccess.value || verification.detail }
  if (verification?.status === 'unavailable') return { tone: 'pending' as const, title: '配置暂未完成', message: cpaAuthSuccess.value || verification.detail }
  if (cpaAuthSuccess.value) return { tone: 'pending' as const, title: '等待配置完成', message: cpaAuthSuccess.value }
  return null
})

const updatedAt = computed(() => upstreams.value ? timeText(upstreams.value.meta.generatedAt) : '—')
const visibleItems = computed(() => upstreams.value?.items.filter((item) => item.environment === 'production') ?? [])
const cpaGatewayItem = computed(() => visibleItems.value.find((item) => item.type === 'cpa_oauth'))
const visibleSummary = computed(() => {
  if (!upstreams.value) return null
  const items = visibleItems.value
  return {
    total: items.length,
    available: items.filter((item) => item.status === 'healthy').length,
    needsAttention: items.filter((item) => item.status !== 'healthy').length,
    configured: items.filter((item) => item.credentialConfigured).length,
  }
})
const cpaAccountCount = computed(() => cpaAuthFiles.value.length > 0 ? cpaAuthFiles.value.length : visibleSummary.value?.total ?? 0)
const visibleCpaAuthFiles = computed(() => {
  const query = search.value.trim().toLowerCase()
  return cpaAuthFiles.value.filter((file, index) => {
    const searchable = [authFileTitle(file, index), authFileSubtitle(file), file.provider, file.status].filter(Boolean).join(' ').toLowerCase()
    const matchesQuery = !query || searchable.includes(query)
    const matchesStatus = status.value === 'all' || authFileState(file) === status.value
    return matchesQuery && matchesStatus
  })
})
const cpaConnection = computed(() => {
  const item = upstreams.value?.items.find((candidate) => candidate.type === 'cpa_oauth')
  const managementConfigured = upstreams.value?.meta.live.managementConfigured
  if (item?.status === 'healthy' && item.credentialConfigured && managementConfigured) return { tone: 'healthy', title: 'CPA 服务已自动连接', detail: '连接地址、客户端凭据和管理凭据由 AI OPS 服务端自动读取。' }
  if (item?.status === 'healthy' && item.credentialConfigured && !managementConfigured) return { tone: 'warning', title: 'CPA 数据接口已连接，管理入口未配置', detail: '请在 AI OPS 服务端运行环境配置 CPA 管理凭据；不需要打开 CPA 管理页面。' }
  if (item?.status === 'auth_required') return { tone: 'warning', title: 'CPA 服务已发现，但认证未通过', detail: '请检查 AI OPS 服务端的 CPA 运行时配置；无需打开 CPA 管理页面。' }
  if (upstreams.value?.meta.live.cpa === 'reachable') return { tone: 'warning', title: 'CPA 服务已连通，等待认证配置', detail: managementConfigured ? 'AI OPS 已自动发现 CPA 服务，但服务端尚未读取到可用客户端凭据。' : 'AI OPS 已自动发现 CPA 服务，但服务端尚未读取到完整连接配置。' }
  return { tone: 'offline', title: '尚未连通 CPA 服务', detail: '请确认 CPA 已启动并已配置到 AI OPS 服务端运行环境。' }
})
const summaryCards = computed(() => {
  const value = visibleSummary.value
  return [
    { label: 'Codex 账号', value: cpaAccountCount.value || '—', hint: '来自 CPA 认证列表', icon: IconServer2, tone: 'teal' },
    { label: '当前健康', value: value?.available ?? '—', hint: '可继续承载请求', icon: IconCircleCheck, tone: 'green' },
    { label: '需要关注', value: value?.needsAttention ?? '—', hint: '余额、认证或配置', icon: IconAlertTriangle, tone: 'amber' },
    { label: '凭据已配置', value: value ? `${value.configured}/${value.total}` : '—', hint: '仅展示配置状态', icon: IconKey, tone: 'blue' },
  ]
})
function filters(): UpstreamFilters { return { search: '', type: 'all', status: 'all' } }
function applyFilters() { cancelSearch(); void loadData() }
function clearFilters() { search.value = ''; type.value = 'all'; status.value = 'all'; applyFilters() }
function timeText(value: string) { return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) }
function dateText(value: string | null | undefined) { return value ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '上游未提供' }
function latencyText(value: number | null) { return value === null ? '—' : value >= 1_000 ? `${(value / 1_000).toFixed(1)}s` : `${value}ms` }
function percentTone(value: number) { return value >= 90 ? 'danger' : value >= 75 ? 'warning' : 'healthy' }
function authFileTitle(file: CpaAuthFile, index: number) { return file.email?.trim() || file.name?.replace(/\.json$/i, '') || `Codex 账号 ${index + 1}` }
function authFileSubtitle(file: CpaAuthFile) { return file.name || file.id || file.provider || 'CPA OAuth 认证文件' }
function authFileState(file: CpaAuthFile): Exclude<CpaStatusFilter, 'all'> {
  if (file.disabled) return 'disabled'
  const raw = file.status?.trim().toLowerCase()
  return file.unavailable || ['error', 'failed', 'expired', 'auth_required'].includes(raw ?? '') ? 'problem' : 'enabled'
}
function authFileStatus(file: CpaAuthFile) {
  const state = authFileState(file)
  if (state === 'disabled') return { label: '未启用', tone: 'disabled' }
  if (state === 'problem') return { label: '问题', tone: 'problem' }
  return { label: '启用', tone: 'enabled' }
}
function openDetail(item: UpstreamItem) { selected.value = item }

function newCheckIdempotencyKey() { return `upstream-check-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}` }
function openCheck() {
  if (!selected.value?.credentialConfigured) return
  checkError.value = ''
  checkResult.value = null
  checkForm.value = { reason: '', acknowledgeSynthetic: false }
  showCheck.value = true
}
function closeCheck() {
  if (isChecking.value) return
  showCheck.value = false
  checkResult.value = null
}
async function submitCheck() {
  if (!selected.value || !checkForm.value.acknowledgeSynthetic || checkForm.value.reason.trim().length < 8) return
  isChecking.value = true
  checkError.value = ''
  try {
    const result = await checkUpstream(selected.value.id, { idempotencyKey: newCheckIdempotencyKey(), reason: checkForm.value.reason, acknowledgeSynthetic: true })
    checkResult.value = result
    selected.value = result.upstream
    await loadData()
  } catch (error) {
    checkError.value = `${error instanceof Error ? error.message : '验证上游账号失败'}${error instanceof UpstreamsApiError && error.requestId ? ` · 请求 ID ${error.requestId}` : ''}`
  } finally { isChecking.value = false }
}
async function openHistory() {
  if (!selected.value) return
  showHistory.value = true
  isHistoryLoading.value = true
  historyError.value = ''
  history.value = null
  try { history.value = await fetchUpstreamHistory(selected.value.id) }
  catch (error) { historyError.value = `${error instanceof Error ? error.message : '上游认证历史暂时无法加载'}${error instanceof UpstreamsApiError && error.requestId ? ` · 请求 ID ${error.requestId}` : ''}` }
  finally { isHistoryLoading.value = false }
}
function closeHistory() {
  if (isHistoryLoading.value) return
  showHistory.value = false
}

function openCredentials() {
  cpaAuthError.value = ''
  cpaAuthSuccess.value = ''
  cpaVerification.value = null
  oauthStatus.value = ''
  showCredentials.value = true
}

function closeCredentials() {
  if (isUploadingCpaAuth.value || isStartingCpaOAuth.value) return
  showCredentials.value = false
}

function selectCpaAuthFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  cpaAuthError.value = ''
  cpaAuthSuccess.value = ''
  cpaAuthFile.value = file
  if (file && (!/\.json$/i.test(file.name) || file.size > 2_000_000)) cpaAuthError.value = '请选择 2 MB 以内的 Codex auth.json 或 CPA JSON 文件'
}

async function importCpaAuthFile() {
  const file = cpaAuthFile.value
  if (!file || cpaAuthError.value) return
  isUploadingCpaAuth.value = true
  cpaAuthError.value = ''
  cpaAuthSuccess.value = ''
  try {
    const result = await uploadCpaAuthFile(file)
    cpaVerification.value = result.verification
    cpaAuthSuccess.value = result.verification.status === 'verified'
      ? 'Codex 认证已转换、导入 CPA，并完成真实验证'
      : result.verification.status === 'failed'
        ? '文件已交给 CPA，但真实认证验证失败，请检查账号状态'
        : '文件已交给 CPA；账号正在热加载，稍后刷新账号池确认状态'
    cpaAuthFile.value = null
    if (cpaAuthFileInput.value) cpaAuthFileInput.value.value = ''
    if (result.verification.status === 'verified') {
      await finishCredentialSetup(`Codex 账号已添加并验证：${result.verification.fileName || result.fileName}`)
    } else if (result.verification.status === 'accepted') {
      await finishCredentialSetup(`Codex 账号已添加，CPA 正在热加载：${result.verification.fileName || result.fileName}`)
    } else {
      await loadData()
    }
  } catch (error) {
    cpaAuthError.value = `${error instanceof Error ? error.message : 'CPA 认证文件导入失败'}${error instanceof UpstreamsApiError && error.requestId ? ` · 请求 ID ${error.requestId}` : ''}`
  } finally { isUploadingCpaAuth.value = false }
}

async function startCpaOAuth() {
  isStartingCpaOAuth.value = true
  cpaAuthError.value = ''
  cpaAuthSuccess.value = ''
  try {
    const result = await fetchCpaOAuthUrl()
    oauthState.value = result.state
    oauthStatus.value = 'wait'
    window.open(result.url, '_blank', 'noopener,noreferrer')
    cpaAuthSuccess.value = 'OAuth 页面已打开；完成授权后回到这里点击“刷新账号池”'
  } catch (error) {
    cpaAuthError.value = `${error instanceof Error ? error.message : '无法启动 CPA OAuth 登录'}${error instanceof UpstreamsApiError && error.requestId ? ` · 请求 ID ${error.requestId}` : ''}`
  } finally { isStartingCpaOAuth.value = false }
}

async function refreshCpaOAuthStatus() {
  if (!oauthState.value) { await loadData(); return }
  try {
    const result = await fetchCpaOAuthStatus(oauthState.value)
    oauthStatus.value = result.status
    if (result.status === 'ok') {
      cpaVerification.value = result.verification ?? null
      cpaAuthSuccess.value = result.verification?.status === 'verified'
        ? 'OAuth 授权完成，CPA 已保存认证文件并通过真实验证'
        : 'OAuth 授权完成，CPA 已保存认证文件；真实验证结果见下方'
      if (result.verification?.status === 'verified') {
        await finishCredentialSetup(`Codex 账号已添加并验证${result.verification.fileName ? `：${result.verification.fileName}` : ''}`)
        return
      }
      if (result.verification?.status === 'accepted') {
        await finishCredentialSetup(`Codex 账号已添加，CPA 正在热加载${result.verification.fileName ? `：${result.verification.fileName}` : ''}`)
        return
      }
    }
    else if (result.status === 'error') cpaAuthError.value = 'OAuth 授权未完成，请重试'
    await loadData()
  } catch (error) {
    cpaAuthError.value = `${error instanceof Error ? error.message : 'OAuth 状态暂时无法读取'}${error instanceof UpstreamsApiError && error.requestId ? ` · 请求 ID ${error.requestId}` : ''}`
  }
}

async function verifyCurrentCpaAccount() {
  isVerifyingCpa.value = true
  cpaAuthError.value = ''
  try {
    cpaVerification.value = (await verifyCpaAuth()).verification
  } catch (error) {
    cpaAuthError.value = `${error instanceof Error ? error.message : 'CPA 认证验证失败'}${error instanceof UpstreamsApiError && error.requestId ? ` · 请求 ID ${error.requestId}` : ''}`
  } finally { isVerifyingCpa.value = false }
}

async function loadData() {
  request?.abort()
  const next = new AbortController()
  request = next
  isLoading.value = true
  errorMessage.value = ''
  cpaAuthFilesError.value = ''
  cpaAuthFilesLoading.value = true
  try { upstreams.value = await fetchUpstreams(filters(), next.signal) }
  catch (error) {
    if (next.signal.aborted) return
    const requestId = error instanceof UpstreamsApiError ? error.requestId : undefined
    errorMessage.value = `${error instanceof Error ? error.message : '上游账号暂时无法加载'}${requestId ? ` · 请求 ID ${requestId}` : ''}`
  }
  if (!next.signal.aborted && upstreams.value?.meta.live.managementConfigured) {
    try { cpaAuthFiles.value = (await fetchCpaAuthFiles()).files }
    catch (error) {
      cpaAuthFiles.value = []
      cpaAuthFilesError.value = `${error instanceof Error ? error.message : 'CPA 认证账号列表暂时无法加载'}${error instanceof UpstreamsApiError && error.requestId ? ` · 请求 ID ${error.requestId}` : ''}`
    }
  } else if (!upstreams.value?.meta.live.managementConfigured) {
    cpaAuthFiles.value = []
    cpaAuthFilesError.value = 'CPA 管理接口未配置，暂时无法读取认证账号明细。'
  }
  cpaAuthFilesLoading.value = false
  if (request === next) isLoading.value = false
}

function authFileKey(file: CpaAuthFile, index = 0) { return file.name || file.id || file.email || `auth-file-${index}` }
function fileSizeText(size: number | undefined) { return size === undefined ? '文件大小未提供' : `${(size / 1024).toFixed(2)} KB` }
function requestBuckets(file: CpaAuthFile) { return file.recentRequests?.length ? file.recentRequests : Array.from({ length: 20 }, (_, index) => ({ time: `窗口 ${index + 1}`, success: 0, failed: 0 })) }
function requestCount(file: CpaAuthFile, field: 'success' | 'failed') { return file[field] ?? (file.recentRequests ?? []).reduce((total, item) => total + item[field], 0) }
function quotaKey(file: CpaAuthFile) { return authFileKey(file) }
function quotaPercent(value: number | null) { return value === null ? '—' : `${Math.round(value)}%` }
type QuotaTone = 'healthy' | 'warning' | 'danger' | 'unknown'
type QuotaWindow = CpaAuthFileQuota['windows'][number]
function quotaRemainingPercent(window: QuotaWindow) {
  if (window.remainingPercent !== null) return window.remainingPercent
  return window.usedPercent === null ? null : Math.max(0, 100 - window.usedPercent)
}
function quotaWindowTone(window: QuotaWindow): QuotaTone {
  const remaining = quotaRemainingPercent(window)
  if (remaining === null) return 'unknown'
  return remaining <= 10 ? 'danger' : remaining <= 25 ? 'warning' : 'healthy'
}
function quotaTone(quota: CpaAuthFileQuota | undefined): QuotaTone {
  if (!quota?.windows.length) return 'unknown'
  const tones = quota.windows.map(quotaWindowTone)
  if (tones.includes('danger')) return 'danger'
  if (tones.includes('warning')) return 'warning'
  return tones.includes('healthy') ? 'healthy' : 'unknown'
}
function quotaToneLabel(tone: QuotaTone) {
  return tone === 'danger' ? '额度紧张' : tone === 'warning' ? '接近上限' : tone === 'healthy' ? '额度充足' : '额度未知'
}
function quotaResetText(window: CpaAuthFileQuota['windows'][number]) { return window.resetAt ? `重置 ${dateText(window.resetAt)}` : window.resetAfterSeconds !== null ? `${Math.ceil(window.resetAfterSeconds / 3600)} 小时后重置` : '重置时间未提供' }
function operationError(error: unknown, fallback: string) { const requestId = error instanceof UpstreamsApiError ? error.requestId : undefined; return `${error instanceof Error ? error.message : fallback}${requestId ? ` · 请求 ID ${requestId}` : ''}` }
function clearNoticeTimer() { if (noticeTimer !== undefined) { window.clearTimeout(noticeTimer); noticeTimer = undefined } }
function showNotice(message: string, tone: 'success' | 'error' = 'success') { clearNoticeTimer(); notice.value = message; noticeTone.value = tone; noticeTimer = window.setTimeout(() => { notice.value = ''; noticeTimer = undefined }, 3_000) }
async function finishCredentialSetup(message: string) {
  await loadData()
  const refreshFailed = Boolean(cpaAuthFilesError.value)
  showCredentials.value = false
  cpaAuthError.value = ''
  cpaAuthSuccess.value = ''
  cpaVerification.value = null
  oauthStatus.value = ''
  showNotice(refreshFailed ? `${message}；账号信息暂时未能刷新，请稍后点击刷新。` : `${message}；账号信息已刷新。`, refreshFailed ? 'error' : 'success')
}
async function toggleAuthFile(file: CpaAuthFile, event: Event) {
  const name = file.name
  if (!name || busyAction.value) return
  const enabled = (event.target as HTMLInputElement).checked
  busyAction.value = `status:${name}`
  try { await setCpaAuthFileStatus(name, !enabled); showNotice(enabled ? '账号已启用，CPA 将把它重新加入账号池。' : '账号已停用，CPA 将不再选用它。'); await loadData() }
  catch (error) { showNotice(operationError(error, 'CPA 账号启用状态暂时无法更新'), 'error'); await loadData() }
  finally { busyAction.value = '' }
}
async function refreshAuthFile(file: CpaAuthFile) { const name = file.name; if (!name || busyAction.value) return; busyAction.value = `refresh:${name}`; try { await requestCpaAuthFileRefresh(name); showNotice('刷新请求已发送，账号状态会在 CPA 完成热加载后更新。'); await loadData() } catch (error) { showNotice(operationError(error, 'CPA OAuth 凭证刷新暂时无法执行'), 'error') } finally { busyAction.value = '' } }
async function refreshQuota(file: CpaAuthFile) { const name = file.name; const key = quotaKey(file); if (!name || quotaLoading.value[key]) return; quotaLoading.value[key] = true; quotaErrors.value[key] = ''; try { quotaByFile.value[key] = (await fetchCpaAuthFileQuota(name)).quota; showNotice(`已刷新 "${name}" 的额度`) } catch (error) { const message = operationError(error, 'CPA 额度暂时无法读取'); quotaErrors.value[key] = message; showNotice(`额度刷新失败：${message}`, 'error') } finally { quotaLoading.value[key] = false } }
async function downloadAuthFile(file: CpaAuthFile) { const name = file.name; if (!name || busyAction.value) return; busyAction.value = `download:${name}`; try { const blob = await downloadCpaAuthFile(name); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url); showNotice('认证文件已开始下载；文件内容只由你的浏览器接收。') } catch (error) { showNotice(operationError(error, 'CPA 认证文件暂时无法下载'), 'error') } finally { busyAction.value = '' } }
async function openModels(file: CpaAuthFile) { modelFile.value = file; models.value = []; modelsError.value = ''; modelsLoading.value = true; try { models.value = (await fetchCpaAuthFileModels(file.name || '')).models } catch (error) { modelsError.value = operationError(error, 'CPA 模型列表暂时无法读取') } finally { modelsLoading.value = false } }
function closeModels() { if (!modelsLoading.value) modelFile.value = null }
function emptySettings(): CpaAuthFileSettings { return { prefix: '', proxyUrl: '', priority: null, weight: null, disableCooling: false, websockets: false, usingApi: false, note: '', excludedModels: [], headers: {} } }
async function loadSettingsDetail(name: string) {
  settingsLoading.value = true
  settingsError.value = ''
  try {
    const result = await fetchCpaAuthFileDetail(name)
    settingsDetail.value = result.detail
    settingsForm.value = result.detail.settings
    settingsExcludedModels.value = result.detail.settings.excludedModels.join('\n')
    settingsHeaders.value = JSON.stringify(result.detail.settings.headers, null, 2)
  } catch (error) {
    settingsDetail.value = null
    settingsError.value = operationError(error, 'CPA 认证文件详情暂时无法读取')
  } finally {
    settingsLoading.value = false
  }
}
async function openSettings(file: CpaAuthFile) {
  settingsFile.value = file
  settingsDetail.value = null
  settingsCopied.value = false
  settingsForm.value = emptySettings()
  settingsExcludedModels.value = ''
  settingsHeaders.value = '{}'
  if (file.name) await loadSettingsDetail(file.name)
}
function closeSettings() { if (!settingsSaving.value) { settingsFile.value = null; settingsDetail.value = null } }
function numberOrNull(value: unknown) { if (value === '' || value === null || value === undefined) return null; const number = Number(value); return Number.isFinite(number) ? number : null }
async function saveSettings() {
  const file = settingsFile.value
  if (!file?.name) return
  let headers: Record<string, string>
  try {
    const parsed = JSON.parse(settingsHeaders.value || '{}') as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some((value) => typeof value !== 'string')) throw new Error('请求头必须是字符串键值对象')
    headers = parsed as Record<string, string>
  } catch (error) {
    settingsError.value = error instanceof Error ? error.message : '请求头 JSON 格式无效'
    return
  }
  settingsSaving.value = true
  settingsError.value = ''
  try {
    await updateCpaAuthFileSettings(file.name, { ...settingsForm.value, priority: numberOrNull(settingsForm.value.priority), weight: numberOrNull(settingsForm.value.weight), excludedModels: settingsExcludedModels.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean), headers })
    await loadSettingsDetail(file.name)
    showNotice('认证文件设置已保存到 CPA，两个页面现在使用同一份数据。')
    await loadData()
  } catch (error) {
    settingsError.value = operationError(error, 'CPA 认证文件设置暂时无法保存')
  } finally {
    settingsSaving.value = false
  }
}
async function copySettingsJson() {
  const detail = settingsDetail.value
  if (!detail) return
  try {
    await navigator.clipboard.writeText(detail.jsonPreview)
    settingsCopied.value = true
    showNotice('已复制 CPA 认证文件 JSON 预览（敏感字段已隐藏）。')
    window.setTimeout(() => { settingsCopied.value = false }, 2200)
  } catch {
    settingsError.value = '浏览器暂时无法访问剪贴板，请手动选择 JSON 预览复制。'
  }
}
function openDelete(file: CpaAuthFile) { deleteTarget.value = file; deleteError.value = '' }
function closeDelete() { if (!isDeleting.value) deleteTarget.value = null }
async function confirmDelete() { const file = deleteTarget.value; if (!file?.name) return; isDeleting.value = true; deleteError.value = ''; try { await deleteCpaAuthFile(file.name); showNotice('认证文件已从 CPA 账号池删除。'); deleteTarget.value = null; await loadData() } catch (error) { deleteError.value = operationError(error, 'CPA 认证文件暂时无法删除') } finally { isDeleting.value = false } }

const { cancel: cancelSearch } = useDebouncedSearch(search, () => void loadData())

onMounted(() => void loadData())
onBeforeUnmount(() => { request?.abort(); clearNoticeTimer() })
</script>

<template>
  <div class="dashboard upstreams-dashboard">
    <section class="page-heading"><div><div class="eyebrow">UPSTREAM ACCOUNTS</div><h1>上游账号</h1><p>管理 CPA Codex OAuth 账号池；模型目录在模型页查看。</p></div><div class="heading-actions"><span class="updated-at">更新于 {{ updatedAt }}</span><button class="btn btn-white refresh-button" :disabled="isLoading" @click="loadData"><IconRefresh :size="17" :class="{ spinning: isLoading }" />刷新</button><button class="btn" @click="openCredentials"><IconKey :size="16" />配置凭据</button></div></section>

    <div v-if="upstreams" class="source-banner"><span>{{ upstreams.summary.total ? '真实上游实时快照' : '等待真实上游配置' }}</span>{{ upstreams.meta.notice }}</div>
    <Transition name="account-notice"><div v-if="notice" class="account-notice" :class="noticeTone" role="status" aria-live="polite"><span class="account-notice-icon"><IconCircleCheck v-if="noticeTone === 'success'" :size="17" /><IconAlertTriangle v-else :size="17" /></span><span>{{ notice }}</span></div></Transition>

    <div v-if="!upstreams && !errorMessage" class="panel data-state"><div class="state-icon"><IconRefresh :size="22" class="spinning" /></div><div><strong>正在读取上游账号</strong><p>正在探测服务并加载安全账号摘要…</p></div></div>
    <div v-else-if="errorMessage" class="panel data-state failed"><div class="state-icon"><IconAlertTriangle :size="22" /></div><div><strong>上游账号加载失败</strong><p>{{ errorMessage }}</p></div><button class="btn btn-white" @click="loadData">重试</button></div>

    <template v-else-if="upstreams">
      <section class="panel upstream-list-panel account-workbench"><header class="panel-header"><div><span class="panel-title">认证文件</span><span class="panel-subtitle">CPA 管理接口返回的真实账号资产；每张卡片只展示安全摘要，不回传 Token</span></div><span class="source-tag live">{{ cpaAuthFiles.length }} 个账号 · CPA 实时</span></header>
      <form class="upstream-filters account-toolbar" @submit.prevent><label class="upstream-search account-search"><IconSearch :size="16" /><input v-model="search" aria-label="搜索 CPA Codex 账号" maxlength="80" type="search" placeholder="输入名称、账号、类型或提供方关键字，支持 * 通配" /></label><label class="account-filter"><IconFilter :size="15" /><select v-model="status"><option value="all">全部状态</option><option value="enabled">启用</option><option value="disabled">未启用</option><option value="problem">问题</option></select></label><button class="text-button" type="button" @click="clearFilters">清除</button></form>

        <div v-if="cpaAuthFilesLoading" class="cpa-account-loading"><IconRefresh :size="18" class="spinning" /><span><strong>正在读取 CPA 认证账号</strong><small>AI OPS 正在从 CPA 管理接口同步真实账号列表…</small></span></div>
        <div v-else-if="cpaAuthFilesError" class="cpa-account-sync-note"><IconAlertTriangle :size="16" /><span>{{ cpaAuthFilesError }} 当前仍展示 CPA 网关实时状态。</span></div>
        <div v-if="!cpaAuthFilesLoading && visibleCpaAuthFiles.length" class="codex-account-grid">
          <article v-for="(account, index) in visibleCpaAuthFiles" :key="authFileKey(account, index)" class="codex-account-card">
            <header class="codex-account-head"><span class="account-file-mark"><IconFileText :size="18" /></span><span class="codex-account-badge">Codex</span><div class="account-identity"><strong>{{ authFileTitle(account, index) }}</strong><small>{{ authFileSubtitle(account) }}</small></div><span class="route-status" :class="'status-' + authFileStatus(account).tone"><i />{{ authFileStatus(account).label }}</span></header>
            <section class="request-record"><div class="request-record-head"><span>请求记录</span><span><strong>{{ requestCount(account, 'success') }}</strong> 成功&nbsp;&nbsp;<strong>{{ requestCount(account, 'failed') }}</strong> 失败</span></div><div class="request-bars"><i v-for="(bucket, bucketIndex) in requestBuckets(account)" :key="`${bucket.time}-${bucketIndex}`" :class="{ success: bucket.success > 0, failed: bucket.failed > 0 }" :title="`${bucket.time} · 成功 ${bucket.success} · 失败 ${bucket.failed}`" /></div></section>
            <div class="codex-account-meta"><span>{{ fileSizeText(account.size) }}</span><span>·</span><span>{{ dateText(account.modtime || account.updatedAt || account.lastRefresh) }}</span></div>
            <button class="codex-account-quota" :class="`quota-state-${quotaTone(quotaByFile[quotaKey(account)])}`" type="button" :disabled="quotaLoading[quotaKey(account)]" @click="refreshQuota(account)"><template v-if="quotaByFile[quotaKey(account)]"><div class="quota-heading"><strong>{{ quotaByFile[quotaKey(account)].planType || 'Codex 额度' }}</strong><span :class="`quota-tone-${quotaTone(quotaByFile[quotaKey(account)])}`">{{ quotaToneLabel(quotaTone(quotaByFile[quotaKey(account)])) }}</span></div><div class="quota-windows"><div v-for="window in quotaByFile[quotaKey(account)].windows" :key="window.id" class="quota-window" :class="`quota-window-${quotaWindowTone(window)}`"><span>{{ window.label }}</span><strong>剩余 {{ quotaPercent(quotaRemainingPercent(window)) }}</strong><small>{{ quotaResetText(window) }}</small></div><div v-if="!quotaByFile[quotaKey(account)].windows.length" class="quota-window"><span>额度窗口</span><strong>CPA 未返回</strong><small>点击重试或稍后检查</small></div></div></template><template v-else><strong>点击此处刷新额度</strong><span>首次点击后从 CPA 实时探测 Codex 使用窗口</span></template><small class="quota-note">窗口数据来自 CPA 实时探测，不代表单账号额度。<template v-if="quotaErrors[quotaKey(account)]">{{ quotaErrors[quotaKey(account)] }}</template></small></button>
            <footer class="codex-account-actions"><button class="btn btn-white" type="button" @click="openModels(account)"><IconBrain :size="15" />模型</button><button class="icon-button" type="button" aria-label="刷新 OAuth 凭证" @click="refreshAuthFile(account)"><IconRefresh :size="16" /></button><button class="icon-button" type="button" aria-label="下载认证文件" @click="downloadAuthFile(account)"><IconDownload :size="16" /></button><button class="icon-button" type="button" aria-label="设置认证文件" @click="openSettings(account)"><IconSettings :size="16" /></button><button class="icon-button danger-icon" type="button" aria-label="删除认证文件" @click="openDelete(account)"><IconTrash :size="16" /></button><label class="enable-control"><span>启用</span><input type="checkbox" :checked="!account.disabled" :disabled="busyAction === `status:${account.name}`" @change="toggleAuthFile(account, $event)" /><span class="enable-switch"><i /></span></label></footer><div class="codex-account-source"><IconCircleCheck :size="13" />CPA 实时</div>
          </article>
        </div>
        <div v-else-if="!cpaAuthFilesLoading && cpaAuthFiles.length" class="people-empty"><IconServer2 :size="24" /><strong>没有符合条件的 Codex 账号</strong><span>调整状态或搜索内容。</span><button class="text-button" type="button" @click="clearFilters">清除筛选</button></div>
         <div v-else-if="!cpaAuthFilesLoading && !cpaAuthFiles.length && visibleItems.length" class="cpa-account-fallback">
          <div class="cpa-account-fallback-heading"><IconServer2 :size="20" /><span><strong>CPA 网关已连接</strong><small>CPA 暂未返回认证文件明细，先展示网关级实时状态。</small></span></div>
          <article v-for="item in visibleItems" :key="item.id" class="codex-account-card codex-account-card-fallback"><header class="codex-account-head"><span class="codex-account-badge">Codex</span><div><strong>{{ item.name }}</strong><small>{{ item.provider }} · {{ item.models.length }} 个模型</small></div><span class="route-status" :class="'status-' + item.status"><i />{{ statusText[item.status] }}</span></header><div class="codex-account-facts"><span><small>凭据</small><strong>{{ item.credentialConfigured ? validationText[item.credentialValidation] : '未配置' }}</strong></span><span><small>成功率</small><strong>{{ item.health.successRate === null ? '—' : item.health.successRate + '%' }}</strong></span><span><small>最近检查</small><strong>{{ timeText(item.health.checkedAt) }}</strong></span></div><div class="codex-account-window"><div><span>账号窗口</span><strong>{{ item.windows.length ? item.windows[0].usedPercent + '% 已用' : '由 CPA 管理' }}</strong></div><span v-if="item.windows.length" class="window-preview"><i :class="percentTone(item.windows[0].usedPercent)" :style="{ width: item.windows[0].usedPercent + '%' }" /></span><small>CPA 未提供单账号用量，页面不估算。</small></div><footer class="codex-account-actions"><button class="btn btn-white" type="button" disabled title="认证文件同步后可读取模型"><IconBrain :size="15" />模型</button><button class="btn btn-white" type="button" @click="loadData"><IconRefresh :size="15" />刷新</button><span class="codex-account-source"><IconCircleCheck :size="14" />CPA 实时</span></footer></article>
        </div>
        <div v-else-if="!cpaAuthFilesLoading" class="people-empty"><IconServer2 :size="24" /><strong>{{ upstreams.summary.total ? '暂无可显示的 CPA 账号' : '暂无真实 CPA 账号池' }}</strong><span>{{ upstreams.summary.total ? 'CPA 尚未返回认证文件明细，刷新后重试。' : '本地模拟账号已移除；AI OPS 服务端读取到 CPA 配置后会在这里显示。' }}</span><button v-if="upstreams.summary.total" class="text-button" type="button" @click="loadData">刷新</button></div>

      </section>
      <footer class="page-footer">数据来源：{{ cpaAuthFiles.length ? 'CPA 实时认证列表 + 上游探测' : upstreams.summary.total ? '真实上游实时探测' : '暂无真实上游配置' }} · 浏览器不读取已保存的 API Key、OAuth Token 或管理密钥</footer>
    </template>

    <div v-if="showCredentials" class="drawer-backdrop" @click.self="closeCredentials"><aside class="model-drawer credential-dialog" role="dialog" aria-modal="true" aria-label="配置凭据"><header><div><span class="source-tag live">自动连接</span><h2>配置凭据</h2></div><button class="icon-button" aria-label="关闭凭据配置" :disabled="isUploadingCpaAuth || isStartingCpaOAuth" @click="closeCredentials"><IconX :size="20" /></button></header>
      <div v-if="credentialFeedback" class="credential-result-banner" :class="`credential-result-${credentialFeedback.tone}`" :role="credentialFeedback.tone === 'error' ? 'alert' : 'status'" aria-live="polite"><span class="credential-result-icon"><IconAlertTriangle v-if="credentialFeedback.tone === 'error'" :size="18" /><IconCircleCheck v-else-if="credentialFeedback.tone === 'success'" :size="18" /><IconClock v-else :size="18" /></span><div><strong>{{ credentialFeedback.title }}</strong><p>{{ credentialFeedback.message }}</p></div></div>
      <div class="credential-success" :class="{ 'credential-auto-warning': cpaConnection.tone !== 'healthy' }"><span><component :is="cpaConnection.tone === 'healthy' ? IconCircleCheck : IconAlertTriangle" :size="22" /></span><div><strong>{{ cpaConnection.title }}</strong><p>{{ cpaConnection.detail }}</p></div></div>
      <div class="credential-intro"><strong>仅用于 Codex 登录。</strong><p>CPA 已由 AI OPS 自动连接，这里不打开 CPA 管理页面。你可以继续用浏览器 OAuth，也可以直接导入其他电脑的 <code>~/.codex/auth.json</code>。</p></div>
      <section class="credential-guide" aria-labelledby="credential-guide-title"><div class="credential-guide-heading"><div><span class="credential-section-label">操作步骤</span><strong id="credential-guide-title">导入后由 CPA 完成账号池认证</strong></div><span class="credential-guide-state">服务端自动读取</span></div><ol><li><span>01</span><div><strong>选择登录方式</strong><small>浏览器 OAuth，或选择 Codex CLI 的 auth.json；CPA 原生 JSON 也兼容。</small></div></li><li><span>02</span><div><strong>完成授权或导入</strong><small>AI OPS 会在服务端把 Codex CLI 格式转换成 CPA 格式，再交给 CPA 热加载。</small></div></li><li><span>03</span><div><strong>确认真实验证结果</strong><small>服务端会用 CPA 的账号索引探测 Codex usage；只有返回有效结果才显示“真实验证通过”。</small></div></li></ol></section>
      <section class="credential-role cpa-auth-methods"><div class="credential-role-heading"><span class="credential-role-number">1</span><div><strong>浏览器 OAuth 登录</strong><small>由 AI OPS 请求 CPA 授权地址并打开浏览器；完成后回到这里刷新账号池。</small></div></div><div class="credential-method-row"><button class="btn btn-white" type="button" :disabled="isStartingCpaOAuth" @click="startCpaOAuth"><IconKey :size="16" :class="{ spinning: isStartingCpaOAuth }" />{{ isStartingCpaOAuth ? '正在请求 OAuth…' : '浏览器 OAuth 登录' }}</button><span>不需要打开 CPA 管理页面。</span></div></section>
      <section class="credential-role cpa-auth-methods"><div class="credential-role-heading"><span class="credential-role-number">2</span><div><strong>导入 Codex 认证文件</strong><small>支持其他电脑导出的 <code>~/.codex/auth.json</code>，也支持 CPA 生成的 Codex JSON。AI OPS 只在内存中转换，随后交给 CPA 热加载。</small></div></div><div class="credential-method-row"><label class="file-picker"><span><IconUpload :size="16" />选择 Codex auth.json / CPA JSON</span><input ref="cpaAuthFileInput" type="file" accept=".json,application/json" @change="selectCpaAuthFile" /></label><button class="btn btn-white" type="button" :disabled="!cpaAuthFile || !!cpaAuthError || isUploadingCpaAuth" @click="importCpaAuthFile"><IconUpload :size="16" :class="{ spinning: isUploadingCpaAuth }" />{{ isUploadingCpaAuth ? '正在导入并验证…' : '导入并验证' }}</button><span>{{ cpaAuthFile ? cpaAuthFile.name : '最大 2 MB，仅支持 JSON' }}</span></div></section>
      <div v-if="oauthStatus" class="oauth-status">OAuth 状态：{{ oauthStatus === 'wait' ? '等待授权完成' : oauthStatus === 'ok' ? '已完成' : '失败' }} <button v-if="oauthStatus === 'wait'" class="text-button" type="button" @click="refreshCpaOAuthStatus">刷新账号池</button></div>
      <div v-if="cpaVerification" class="credential-verification" :class="`verification-${cpaVerification.status}`"><span class="verification-icon"><IconCircleCheck v-if="cpaVerification.status === 'verified'" :size="17" /><IconAlertTriangle v-else :size="17" /></span><div><strong>{{ cpaVerificationText[cpaVerification.status] }}</strong><p>{{ cpaVerification.detail }}</p><small>检查时间 {{ timeText(cpaVerification.checkedAt) }}</small></div><button class="text-button" type="button" :disabled="isVerifyingCpa || isUploadingCpaAuth || isStartingCpaOAuth" @click="verifyCurrentCpaAccount"><IconRefresh :size="14" :class="{ spinning: isVerifyingCpa }" />{{ isVerifyingCpa ? '验证中…' : '重新验证' }}</button></div>
      <section class="credential-notes" aria-label="配置注意事项"><div class="credential-notes-heading"><IconShieldCheck :size="17" /><strong>注意事项</strong></div><ul><li>不需要进入 CPA 管理页面，也不需要在这里填写地址或 Key。</li><li>上传的是 Codex CLI 的 OAuth 文件；如果文件只有 <code>OPENAI_API_KEY</code>，它不是可转换的账号池 OAuth 凭据。</li><li>原文件和 Token 只在服务端处理；AI OPS 不把原文件写入自己的数据库或日志。</li><li>模型目录请前往“模型目录”页面查看；本页只处理 Codex 登录。</li></ul></section>
      <div class="safe-probe-note"><IconShieldCheck :size="18" /><span><strong>凭据只在服务端</strong>浏览器不会回显或保存 CPA Key、管理 Key、OAuth Token 或认证文件内容。</span></div><footer class="drawer-actions credential-actions"><button class="btn btn-white" type="button" :disabled="isUploadingCpaAuth || isStartingCpaOAuth" @click="closeCredentials">关闭</button></footer>
    </aside></div>

    <div v-if="modelFile" class="drawer-backdrop" @click.self="closeModels"><aside class="auth-action-dialog model-dialog" role="dialog" aria-modal="true" aria-label="CPA 认证文件模型"><header><div><span class="source-tag live">CPA 实时</span><h2>模型</h2><p>{{ authFileTitle(modelFile, 0) }}</p></div><button class="icon-button" aria-label="关闭模型列表" :disabled="modelsLoading" @click="closeModels"><IconX :size="20" /></button></header><div v-if="modelsLoading" class="dialog-state"><IconRefresh :size="22" class="spinning" /><strong>正在读取模型</strong><span>从 CPA 认证文件模型接口获取真实列表…</span></div><div v-else-if="modelsError" class="dialog-state error"><IconAlertTriangle :size="22" /><strong>模型列表加载失败</strong><span>{{ modelsError }}</span><button class="btn btn-white" @click="openModels(modelFile)">重试</button></div><div v-else-if="models.length" class="model-list"><article v-for="model in models" :key="model.id"><span><IconBrain :size="16" /></span><div><strong>{{ model.displayName }}</strong><small>{{ model.id }}<template v-if="model.ownedBy"> · {{ model.ownedBy }}</template></small></div><em>{{ model.type || 'chat' }}</em></article></div><div v-else class="dialog-state"><IconBrain :size="22" /><strong>CPA 未返回模型</strong><span>该认证文件当前没有可用模型。</span></div><footer class="dialog-footer"><button class="btn" type="button" @click="closeModels">完成</button></footer></aside></div>

    <div v-if="settingsFile" class="drawer-backdrop" @click.self="closeSettings"><aside class="auth-action-dialog cpa-file-editor" role="dialog" aria-modal="true" aria-label="认证文件详情编辑"><header class="cpa-editor-header"><div><span class="cpa-editor-kicker">认证文件详情 / 编辑</span><h2>{{ settingsFile.name || authFileTitle(settingsFile, 0) }}</h2></div><button class="icon-button" aria-label="关闭认证文件设置" :disabled="settingsSaving" @click="closeSettings"><IconX :size="20" /></button></header><div v-if="settingsLoading" class="dialog-state"><IconRefresh :size="22" class="spinning" /><strong>正在读取认证文件</strong><span>正在从 CPA 读取 INFO、JSON 预览和可编辑字段…</span></div><template v-else><div class="cpa-editor-scroll"><section class="cpa-json-section"><div class="cpa-field-label"><strong>认证文件信息</strong><span>（INFO）</span></div><pre class="cpa-json-preview cpa-info-preview">{{ settingsDetail?.infoJson || 'CPA 暂未返回 INFO' }}</pre></section><section class="cpa-json-section"><div class="cpa-field-label"><strong>认证文件 JSON</strong><span>（预览）</span><em>敏感字段已隐藏</em></div><pre class="cpa-json-preview">{{ settingsDetail?.jsonPreview || 'CPA 暂未返回 JSON 预览' }}</pre></section><form id="cpa-auth-file-settings-form" class="cpa-settings-form" @submit.prevent="saveSettings"><label><span>前缀（prefix）</span><input v-model="settingsForm.prefix" maxlength="512" placeholder="" /></label><label><span>代理 URL（proxy_url）</span><input v-model="settingsForm.proxyUrl" maxlength="2048" placeholder="socks5://username:password@proxy_ip:port/" /></label><label><span>优先级（priority）</span><input v-model.number="settingsForm.priority" min="0" type="number" placeholder="例如: 10 或 -1" /><small>仅支持整数；非法值会被忽略，数值越大优先级越高。</small></label><label><span>权重（weight）</span><input v-model.number="settingsForm.weight" min="0" type="number" placeholder="默认" /></label><label><span>备注（note）</span><input v-model="settingsForm.note" maxlength="1000" placeholder="" /></label><label><span>排除模型（excluded_models）</span><textarea v-model="settingsExcludedModels" rows="3" placeholder="每行一个模型名称" /></label><label><span>自定义请求头（headers）</span><textarea v-model="settingsHeaders" rows="4" spellcheck="false" /></label><div class="cpa-settings-toggles"><label class="settings-check"><input v-model="settingsForm.disableCooling" type="checkbox" /><span>禁用冷却（disable_cooling）</span></label><label class="settings-check"><input v-model="settingsForm.websockets" type="checkbox" /><span>启用 WebSocket（websockets）</span></label><label class="settings-check"><input v-model="settingsForm.usingApi" type="checkbox" /><span>使用 API 模式（using_api）</span></label></div><div v-if="settingsError" class="create-person-error"><IconAlertTriangle :size="16" />{{ settingsError }}</div></form></div><footer class="dialog-footer cpa-editor-footer"><button class="btn btn-white" type="button" :disabled="settingsSaving" @click="closeSettings">关闭</button><button class="btn btn-white" type="button" :disabled="!settingsDetail || settingsSaving" @click="copySettingsJson">{{ settingsCopied ? '已复制' : '复制' }}</button><button class="btn" type="submit" form="cpa-auth-file-settings-form" :disabled="settingsSaving || !settingsDetail">{{ settingsSaving ? '保存中…' : '保存' }}</button></footer></template></aside></div>

    <div v-if="deleteTarget" class="drawer-backdrop" @click.self="closeDelete"><aside class="auth-action-dialog delete-dialog" role="dialog" aria-modal="true" aria-label="删除 CPA 认证文件"><header><div><span class="source-tag demo">危险操作</span><h2>删除认证文件</h2></div><button class="icon-button" aria-label="关闭删除确认" :disabled="isDeleting" @click="closeDelete"><IconX :size="20" /></button></header><div class="delete-content"><span class="delete-icon"><IconTrash :size="22" /></span><strong>确认删除 {{ authFileTitle(deleteTarget, 0) }}？</strong><p>这会直接从 CPA 账号池删除该认证文件，AI OPS 不保留可恢复副本。</p><code>{{ deleteTarget.name }}</code><div v-if="deleteError" class="create-person-error"><IconAlertTriangle :size="16" />{{ deleteError }}</div></div><footer class="dialog-footer"><button class="btn btn-white" type="button" :disabled="isDeleting" @click="closeDelete">取消</button><button class="btn danger-button" type="button" :disabled="isDeleting" @click="confirmDelete"><IconTrash :size="15" />{{ isDeleting ? '删除中…' : '确认删除' }}</button></footer></aside></div>

    <div v-if="selected" class="drawer-backdrop" @click.self="selected = null"><aside class="model-drawer upstream-drawer" role="dialog" aria-modal="true" aria-label="上游账号详情"><header><div><span class="source-tag live">正式配置</span><h2>上游账号详情</h2></div><button class="icon-button" aria-label="关闭详情" @click="selected = null"><IconX :size="20" /></button></header>
      <section class="model-drawer-hero upstream"><span><IconServer2 :size="22" /></span><div><strong>{{ selected.name }}</strong><code>{{ selected.provider }}</code><small>CPA OAuth 账号池</small></div><span class="route-status" :class="`status-${selected.status}`"><i />{{ statusText[selected.status] }}</span></section>
      <section class="channel-detail-metrics"><article><small>成功率</small><strong>{{ selected.health.successRate === null ? '—' : `${selected.health.successRate}%` }}</strong></article><article><small>P95 延迟</small><strong>{{ latencyText(selected.health.latencyMs) }}</strong></article><article><small>余额状态</small><strong :class="`balance-${selected.balance.state}`">{{ selected.balance.label }}</strong></article></section>
      <section class="drawer-section"><h3>凭据与检查</h3><dl class="model-facts"><div><dt>凭据配置</dt><dd>{{ selected.credentialConfigured ? '已配置' : '未配置' }}</dd></div><div><dt>验证结果</dt><dd>{{ validationText[selected.credentialValidation] }}</dd></div><div><dt>最近检查</dt><dd>{{ timeText(selected.health.checkedAt) }}</dd></div><div><dt>可用模型</dt><dd>{{ selected.models.length }} 个</dd></div></dl></section>
      <section class="drawer-section"><h3>OAuth 认证与窗口</h3><dl class="model-facts"><div><dt>认证有效期</dt><dd>{{ dateText(selected.auth?.expiresAt) }}</dd></div><div><dt>最后刷新</dt><dd>{{ dateText(selected.auth?.lastRefreshedAt) }}</dd></div></dl><div v-if="selected.windows.length" class="account-window-list"><article v-for="window in selected.windows" :key="window.id"><div><strong>{{ window.label }}</strong><em>{{ window.usedPercent }}% 已用</em></div><span><i :class="percentTone(window.usedPercent)" :style="{ width: `${window.usedPercent}%` }" /></span><small>{{ timeText(window.resetsAt) }} 重置</small></article></div><div v-else class="price-note">CPA OpenAI 兼容接口只返回模型目录；账号窗口和余额由 CPA 管理，平台不猜测或复制这些字段。</div><div v-if="selected.windows.length" class="cooldown-state" :class="{ active: selected.cooldown?.active }"><IconClock :size="17" /><span><strong>{{ selected.cooldown?.active ? '账号处于冷却' : '当前无冷却' }}</strong><small v-if="selected.cooldown?.active">{{ selected.cooldown.reason }} · {{ timeText(selected.cooldown.until!) }} 结束</small><small v-else>当前可以承载请求</small></span></div></section>
      <section class="drawer-section"><h3>最近错误</h3><div v-if="selected.recentError" class="channel-error-detail"><IconAlertTriangle :size="18" /><div><strong>{{ errorText[selected.recentError.category] }}</strong><p>{{ selected.recentError.summary }}</p><small>首次 {{ timeText(selected.recentError.firstSeenAt) }} · 最近 {{ timeText(selected.recentError.lastSeenAt) }}</small></div></div><div v-else class="channel-clear"><IconCircleCheck :size="18" />最近检查未发现异常</div></section>
      <section class="safe-probe-note"><IconShieldCheck :size="18" /><span><strong>凭据安全边界</strong>页面只返回是否配置和验证结果；不返回完整密钥、可识别片段、OAuth Token 或上游响应正文。</span></section>
      <footer class="drawer-actions"><a class="btn btn-white" :href="`/audit?resource=upstream&search=${encodeURIComponent(selected.name)}`"><IconShieldCheck :size="16" />操作审计</a><button class="btn btn-white" :disabled="isHistoryLoading || selected.id === 'upstream-cpa-gateway'" :title="selected.id === 'upstream-cpa-gateway' ? 'CPA 认证历史由 CPA 管理后台维护' : ''" @click="openHistory"><IconClock :size="16" />认证历史</button><button class="btn" :disabled="selected.id === 'upstream-cpa-gateway' || !selected.credentialConfigured" :title="selected.id === 'upstream-cpa-gateway' ? 'CPA 状态通过刷新实时读取，不写入本地模拟验证记录' : selected.credentialConfigured ? '更新本地模拟验证记录' : '尚未配置模拟凭据'" @click="openCheck"><IconRefresh :size="16" />验证连接</button></footer>
    </aside></div>

    <div v-if="showCheck && selected" class="drawer-backdrop" @click.self="closeCheck"><aside class="model-drawer channel-check-dialog" role="dialog" aria-modal="true" aria-label="本地模拟上游验证"><header><div><span class="source-tag demo">本地模拟</span><h2>{{ checkResult ? '验证记录已更新' : '验证上游账号' }}</h2></div><button class="icon-button" aria-label="关闭上游验证" :disabled="isChecking" @click="closeCheck"><IconX :size="20" /></button></header>
      <template v-if="checkResult"><div class="data-state success"><div class="state-icon"><IconCircleCheck :size="22" /></div><div><strong>{{ selected.name }} 已完成本地模拟验证</strong><p>{{ checkResult.meta.notice }}</p></div></div><section class="quota-adjust-impact"><span>验证时间</span><strong>{{ timeText(checkResult.meta.completedAt) }}</strong><span>凭据结果</span><strong>{{ validationText[selected.credentialValidation] }}</strong></section><footer class="drawer-actions"><a class="btn btn-white" :href="`/audit?eventId=${encodeURIComponent(checkResult.operation.auditEventId)}&origin=mutation`" :aria-label="`查看 ${checkResult.operation.auditEventId} 操作审计`"><IconShieldCheck :size="16" />查看操作审计</a><button class="btn" @click="closeCheck">完成</button></footer></template>
      <form v-else class="create-key-form" @submit.prevent="submitCheck"><p class="create-person-note"><strong>{{ selected.name }}</strong> 的验证只会写入本地 SQLite 模拟记录，用于更新最近检查时间；不会访问真实上游、读取或修改 API Key、OAuth Token 或管理密钥。</p><label><span>验证说明 <em>至少 8 个字符</em></span><textarea v-model="checkForm.reason" required minlength="8" maxlength="200" rows="4" placeholder="例如：确认本地演示账号状态展示与异常提示" /></label><label class="access-ack"><input v-model="checkForm.acknowledgeSynthetic" type="checkbox" /><span>我已确认：这是本地模拟验证，不会触发真实网络探测或修改外部账号。</span></label><div v-if="checkError" class="create-person-error"><IconAlertTriangle :size="16" />{{ checkError }}</div><footer><button class="btn btn-white" type="button" :disabled="isChecking" @click="closeCheck">取消</button><button class="btn" type="submit" :disabled="isChecking || checkForm.reason.trim().length < 8 || !checkForm.acknowledgeSynthetic"><IconRefresh :size="16" />{{ isChecking ? '验证中…' : '更新模拟验证记录' }}</button></footer></form>
    </aside></div>

    <div v-if="showHistory && selected" class="drawer-backdrop" @click.self="closeHistory"><aside class="model-drawer history-dialog" role="dialog" aria-modal="true" aria-label="上游认证历史"><header><div><span class="source-tag demo">SQLITE</span><h2>认证历史</h2></div><button class="icon-button" aria-label="关闭认证历史" :disabled="isHistoryLoading" @click="closeHistory"><IconX :size="20" /></button></header>
      <div v-if="isHistoryLoading" class="data-state"><div class="state-icon"><IconRefresh :size="22" class="spinning" /></div><div><strong>正在读取认证历史</strong><p>仅查询本地 SQLite 审计摘要…</p></div></div>
      <div v-else-if="historyError" class="data-state failed"><div class="state-icon"><IconAlertTriangle :size="22" /></div><div><strong>认证历史加载失败</strong><p>{{ historyError }}</p></div><button class="btn btn-white" @click="openHistory">重试</button></div>
      <template v-else-if="history"><div class="history-heading"><strong>{{ history.upstream.name }}</strong><span>{{ history.meta.notice }}</span></div><div v-if="history.items.length" class="history-list"><article v-for="item in history.items" :key="item.id"><span class="history-dot" :class="item.result"><IconCircleCheck v-if="item.result === 'success'" :size="14" /><IconAlertTriangle v-else :size="14" /></span><div><strong>{{ item.result === 'success' ? '验证通过' : item.result === 'denied' ? '验证被拒绝' : '验证失败' }}</strong><small>{{ timeText(item.checkedAt) }} · {{ item.actorName }}</small><p>{{ item.summary }}</p><code>{{ item.requestId }}</code></div></article></div><div v-else class="people-empty history-empty"><IconClock :size="24" /><strong>暂无本地认证记录</strong><span>完成一次本地模拟验证后，这里会保留时间和审计摘要。</span></div></template>
      <footer class="drawer-actions"><button class="btn" @click="closeHistory">完成</button></footer>
    </aside></div>
  </div>
</template>

<style scoped>
.credential-dialog { width: min(560px, 100vw); }
.credential-form { display: grid; gap: 15px; padding: 18px; }
.credential-intro { margin: 0; padding: 12px 14px; border: 1px solid #d5e8e9; border-radius: 7px; color: #49636d; background: #f1f8f8; font-size: 12px; line-height: 1.6; }
.credential-intro p { margin: 4px 0 0; color: #607982; }
.credential-guide { display: grid; gap: 0; margin: 0 18px 14px; padding: 14px; border: 1px solid #dce8ea; border-radius: 9px; background: linear-gradient(135deg, #f8fcfc, #f2f8f8); }
.credential-guide-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.credential-guide-heading > div { display: grid; gap: 4px; }
.credential-section-label { color: var(--brand); font-size: 10px; font-weight: 800; letter-spacing: .08em; }
.credential-guide-heading strong { color: #2f4651; font-size: 13px; }
.credential-guide-state { flex: 0 0 auto; padding: 4px 7px; border-radius: 5px; color: #287a63; background: #e7f5ee; font-size: 10px; font-weight: 700; }
.credential-guide ol { display: grid; gap: 10px; margin: 14px 0 0; padding: 0; list-style: none; }
.credential-guide li { display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 8px; align-items: start; }
.credential-guide li > span { display: grid; place-items: center; width: 25px; height: 25px; border: 1px solid #bedcdd; border-radius: 7px; color: var(--brand); background: #fff; font: 700 10px ui-monospace, SFMono-Regular, Consolas, monospace; }
.credential-guide li > div { display: grid; gap: 2px; padding-top: 2px; }
.credential-guide li strong { color: #3b5660; font-size: 11px; }
.credential-guide li small { color: #71858d; font-size: 10px; line-height: 1.45; }
.credential-intro code { color: #176d71; font: 11px ui-monospace, SFMono-Regular, Consolas, monospace; }
.credential-flow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 9px 0 4px; color: #176d71; }
.credential-flow b { padding: 4px 7px; border-radius: 5px; background: #e2f1f1; font-size: 11px; }
.credential-flow i { color: #82969d; font-style: normal; }
.credential-role { display: grid; gap: 12px; padding: 13px 14px; border: 1px solid #e1e9eb; border-radius: 8px; background: #fff; }
.credential-role-heading { display: flex; gap: 9px; align-items: flex-start; }
.credential-role-heading > div { display: grid; gap: 3px; }
.credential-role-heading strong { color: #2f4651; font-size: 13px; }
.credential-role-heading small, .credential-role label small { color: #7b8b93; font-size: 11px; line-height: 1.45; }
.credential-role-number { display: grid; place-items: center; width: 21px; height: 21px; flex: 0 0 21px; border-radius: 50%; color: #fff; background: var(--brand); font-size: 11px; font-weight: 700; }
.cpa-auth-methods { gap: 10px; }
.credential-method-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 9px 10px; border: 1px solid #e4ecee; border-radius: 7px; background: #fbfdfd; }
.credential-method-row > span { color: #71818b; font-size: 11px; line-height: 1.45; }
.file-picker { display: inline-flex !important; align-items: center; gap: 6px; color: #36535d !important; cursor: pointer; }
.file-picker input { display: none; }
.credential-method-row code, .credential-notes code { color: #176d71; font: 10px ui-monospace, SFMono-Regular, Consolas, monospace; }
.oauth-status { color: #54727b; font-size: 11px; }
.credential-result-banner { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 9px; align-items: start; margin: 12px 18px 0; padding: 10px 12px; border: 1px solid #cde9d2; border-radius: 8px; color: #35674b; background: #f3fbf4; }
.credential-result-banner > div { min-width: 0; display: grid; gap: 3px; }
.credential-result-banner strong { font-size: 12px; }
.credential-result-banner p { margin: 0; color: inherit; opacity: .84; font-size: 10px; line-height: 1.45; overflow-wrap: anywhere; }
.credential-result-icon { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; color: inherit; background: rgba(255,255,255,.72); }
.credential-result-banner.credential-result-error { border-color: #f0caca; color: #994848; background: #fff7f7; }
.credential-result-banner.credential-result-pending { border-color: #f0ddb0; color: #806126; background: #fffaf0; }
.credential-verification { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 9px; align-items: center; margin: 0 18px 14px; padding: 11px 12px; border: 1px solid #cde9d2; border-radius: 8px; color: #35674b; background: #f3fbf4; }
.credential-verification.verification-failed { border-color: #f0caca; color: #994848; background: #fff7f7; }
.credential-verification.verification-unavailable, .credential-verification.verification-accepted { border-color: #f0ddb0; color: #806126; background: #fffaf0; }
.verification-icon { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; color: inherit; background: rgba(255,255,255,.72); }
.credential-verification > div { min-width: 0; display: grid; gap: 3px; }
.credential-verification strong { font-size: 11px; }
.credential-verification p { margin: 0; color: inherit; opacity: .82; font-size: 10px; line-height: 1.45; }
.credential-verification small { color: inherit; opacity: .66; font-size: 9px; }
.credential-verification .text-button { white-space: nowrap; color: inherit; }
.credential-role label { gap: 5px; }
.credential-advanced { display: grid; gap: 11px; padding: 12px 14px; border: 1px dashed #d6e0e3; border-radius: 8px; }
.credential-advanced summary { cursor: pointer; color: #4e6973; font-size: 12px; font-weight: 700; }
.credential-advanced p { margin: -3px 0 0; color: #7b8b93; font-size: 11px; line-height: 1.5; }
.credential-form label { display: grid; gap: 6px; color: #45606a; font-size: 12px; }
.credential-form label > span { font-weight: 600; }
.credential-form input, .credential-form select { width: 100%; min-height: 38px; padding: 9px 11px; border: 1px solid #d8e1e5; border-radius: 6px; outline: 0; color: #344754; background: #fff; font: 13px inherit; }
.credential-form input:focus, .credential-form select:focus { border-color: var(--brand); box-shadow: 0 0 0 2px rgba(20, 108, 112, .08); }
.credential-divider { display: grid; gap: 3px; margin-top: 2px; padding-top: 14px; border-top: 1px solid var(--line); }
.credential-divider span { color: #36535d; font-size: 12px; font-weight: 700; }
.credential-divider small { color: #7b8b93; font-size: 11px; }
.credential-success { display: grid; grid-template-columns: 38px minmax(0, 1fr); gap: 12px; margin: 18px; padding: 15px; border: 1px solid #cde9d2; border-radius: 8px; background: #f2fbf3; }
.credential-success > span { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 50%; color: #2f9e44; background: #e1f4e4; }
.credential-success strong { color: #2f5c3a; font-size: 14px; }
.credential-success p { margin: 4px 0 0; color: #668070; font-size: 12px; line-height: 1.5; }
.credential-success.credential-auto-warning { border-color: #f0ddb0; background: #fffaf0; }
.credential-success.credential-auto-warning > span { color: #a96812; background: #fff0cc; }
.credential-success.credential-auto-warning strong { color: #76531f; }
.credential-success.credential-auto-warning p { color: #8b7652; }
.credential-result-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 0 18px 16px; }
.credential-result-facts div { display: grid; gap: 5px; padding: 11px; border: 1px solid #e2e9eb; border-radius: 6px; background: #fbfcfc; }
.credential-result-facts dt { color: #7b8b93; font-size: 11px; }
.credential-result-facts dd { margin: 0; color: #2f4651; font-size: 13px; font-weight: 700; }
.credential-notes { display: grid; gap: 8px; margin: 0 18px 14px; padding: 13px 14px; border: 1px solid #e5e9e8; border-radius: 8px; background: #fff; }
.credential-notes-heading { display: flex; align-items: center; gap: 6px; color: #3b5660; font-size: 12px; }
.credential-notes-heading svg { color: var(--brand); }
.credential-notes ul { display: grid; gap: 6px; margin: 0; padding-left: 17px; color: #71818a; font-size: 10px; line-height: 1.5; }
.credential-notes li::marker { color: #8ab5b6; }
.credential-dialog > .safe-probe-note { margin: 0 18px; }
.credential-dialog > .drawer-actions { display: flex; grid-template-columns: none; justify-content: center; margin-top: 18px; }
.credential-dialog > .drawer-actions .btn { min-width: 190px; justify-content: center; }
.cpa-account-loading, .cpa-account-sync-note { display: flex; align-items: center; gap: 9px; margin: 14px 15px; padding: 11px 12px; border: 1px solid #dce8ea; border-radius: 8px; color: #57727b; background: #f7fbfb; font-size: 10px; }
.cpa-account-loading > svg { color: var(--brand); flex: 0 0 auto; }
.cpa-account-loading > span { display: grid; gap: 2px; }
.cpa-account-loading strong { color: #36535d; font-size: 11px; }
.cpa-account-loading small { color: #7b8d95; font-size: 10px; }
.cpa-account-sync-note { color: #8b651d; border-color: #f0dfb7; background: #fffaf0; }
.cpa-account-sync-note svg { flex: 0 0 auto; }
.codex-account-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 12px; padding: 15px; }
.codex-account-card { min-width: 0; display: grid; gap: 0; overflow: hidden; border: 1px solid #dfe8e9; border-radius: 10px; color: #435660; background: #fff; box-shadow: 0 2px 8px rgba(26, 40, 51, .035); transition: .18s ease; }
.codex-account-card:hover { border-color: #9dc6c8; box-shadow: 0 6px 16px rgba(26, 40, 51, .07); transform: translateY(-1px); }
.codex-account-head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 9px; align-items: center; padding: 14px 14px 12px; }
.codex-account-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 40px; padding: 4px 7px; border: 1px solid #c9e4e4; border-radius: 6px; color: #176d71; background: #eaf6f6; font-size: 9px; font-weight: 800; }
.codex-account-head > div { min-width: 0; display: grid; gap: 3px; }
.codex-account-head strong { overflow: hidden; color: #2f4651; font-size: 12px; white-space: nowrap; text-overflow: ellipsis; }
.codex-account-head small { overflow: hidden; color: #8b9aa2; font: 9px ui-monospace, SFMono-Regular, Consolas, monospace; white-space: nowrap; text-overflow: ellipsis; }
.codex-account-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; margin: 0 14px 11px; padding: 10px 0; border-top: 1px solid #edf0f3; border-bottom: 1px solid #edf0f3; }
.codex-account-facts > span { min-width: 0; display: grid; gap: 4px; padding-right: 7px; border-right: 1px solid #edf0f3; }
.codex-account-facts > span:last-child { padding-right: 0; border-right: 0; }
.codex-account-facts small { color: #98a2aa; font-size: 8px; }
.codex-account-facts strong { overflow: hidden; color: #3f515d; font-size: 9px; white-space: nowrap; text-overflow: ellipsis; }
.codex-account-window { display: grid; gap: 7px; margin: 0 14px 12px; padding: 10px; border: 1px solid #e5edef; border-radius: 8px; background: #fbfdfd; }
.codex-account-window > div { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.codex-account-window > div span { color: #71818a; font-size: 9px; }
.codex-account-window > div strong { color: #3d5962; font-size: 10px; }
.codex-account-window > .window-preview { display: block; height: 6px; margin: 0; overflow: hidden; border-radius: 99px; background: #e9eff0; }
.codex-account-window > .window-preview i { display: block; height: 100%; border-radius: inherit; }
.codex-account-window > small { color: #8a989f; font-size: 8px; line-height: 1.4; }
.codex-account-actions { display: flex; align-items: center; gap: 7px; min-height: 49px; padding: 9px 14px; border-top: 1px solid #edf0f3; }
.codex-account-actions .btn { min-height: 29px; padding: 5px 9px; font-size: 9px; }
.codex-account-source { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; color: #36804a; font-size: 8px; }
.cpa-account-fallback { padding: 0 15px 15px; }
.cpa-account-fallback-heading { display: flex; align-items: center; gap: 8px; padding: 11px 2px; color: #57808a; }
.cpa-account-fallback-heading > svg { color: var(--brand); }
.cpa-account-fallback-heading > span { display: grid; gap: 2px; }
.cpa-account-fallback-heading strong { color: #36535d; font-size: 11px; }
.cpa-account-fallback-heading small { color: #7d8c94; font-size: 9px; }
.cpa-account-fallback .codex-account-card { max-width: 560px; }
@media (max-width: 720px) {
  .credential-guide-heading { display: grid; }
  .credential-guide-state { justify-self: start; }
  .codex-account-grid { grid-template-columns: 1fr; padding: 12px; }
  .codex-account-head { grid-template-columns: auto minmax(0, 1fr); }
  .codex-account-head > .route-status { grid-column: 2; justify-self: start; }
}
.channel-check-dialog { width: min(500px, 100vw); }
.history-dialog { width: min(520px, 100vw); }
.history-heading { display: grid; gap: 5px; margin: 18px 18px 6px; padding: 12px; border: 1px solid #d9e8e9; border-radius: 7px; background: #f3f9f9; }
.history-heading strong { color: #36535d; font-size: 14px; }
.history-heading span { color: #71818b; font-size: 11px; line-height: 1.5; }
.history-list { display: grid; gap: 0; padding: 8px 18px 18px; overflow: auto; }
.history-list article { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 10px; padding: 14px 0; border-bottom: 1px solid #edf0f3; }
.history-list article:last-child { border-bottom: 0; }
.history-dot { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 50%; color: #2f9e44; background: #eaf7ec; }
.history-dot.failed, .history-dot.denied { color: #b04444; background: #fceded; }
.history-list article > div { display: grid; gap: 4px; min-width: 0; }
.history-list strong { color: #2f4651; font-size: 13px; }
.history-list small { color: #7c8b94; font-size: 11px; }
.history-list p { margin: 2px 0 0; color: #647680; font-size: 11px; line-height: 1.55; }
.history-list code { color: #54727b; font: 10px ui-monospace, SFMono-Regular, Consolas, monospace; }
.history-empty { min-height: 210px; margin: 8px 18px 0; }
.channel-check-dialog .create-key-form textarea { width: 100%; min-height: 82px; resize: vertical; padding: 10px; border: 1px solid var(--line); border-radius: 6px; outline: 0; color: #344754; background: #fff; font: 13px/1.5 inherit; }
.channel-check-dialog .create-key-form textarea:focus { border-color: var(--brand); box-shadow: 0 0 0 2px rgba(20, 108, 112, .08); }
.channel-check-dialog .create-key-form footer { display: flex; justify-content: flex-end; gap: 8px; padding-top: 14px; border-top: 1px solid var(--line); }
.channel-check-dialog .data-state { min-height: 150px; justify-content: flex-start; padding: 22px 18px 10px; }
.channel-check-dialog .data-state.success .state-icon { color: #2f9e44; background: #eef9ef; }
.upstreams-dashboard { --account-ink: #263e4a; --account-muted: #81929a; --account-teal: #146c70; --account-green: #27945b; --account-red: #c75252; }
.account-notice { position: fixed; top: 78px; left: 50%; z-index: 90; display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 10px; align-items: center; width: min(420px, calc(100vw - 32px)); min-height: 58px; margin: 0; padding: 12px 16px 12px 12px; border: 1px solid #dfe7e2; border-radius: 12px; color: #34453d; background: #fff; box-shadow: 0 8px 22px rgba(35, 57, 48, .12), 0 2px 5px rgba(35, 57, 48, .06); font-size: 12px; line-height: 1.45; pointer-events: none; transform: translateX(-50%); }
.account-notice-icon { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; color: #17864c; background: #d9f7e5; }
.account-notice.success { border-color: #dfe7e2; }
.account-notice.error { border-color: #f0cccc; color: #a04e4e; }
.account-notice.error .account-notice-icon { color: #b94c4c; background: #ffe4e2; }
.account-notice-enter-active, .account-notice-leave-active { transition: opacity .3s ease, transform .3s ease; }
.account-notice-enter-from, .account-notice-leave-to { opacity: 0; transform: translate(-50%, -8px) scale(.98); }
.account-workbench { overflow: hidden; border: 1px solid #dfe8ea; border-radius: 11px; background: #fff; box-shadow: 0 5px 18px rgba(34, 57, 66, .035); }
.account-workbench .panel-header { padding: 17px 18px 15px; }
.account-toolbar { display: grid !important; grid-template-columns: minmax(220px, 1fr) 150px auto; gap: 9px; align-items: center; padding: 0 17px 15px !important; border-bottom: 1px solid #edf1f2; }
.account-toolbar .account-search, .account-toolbar .account-filter { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 38px; padding: 0 11px; border: 1px solid #dce5e8; border-radius: 7px; color: #809198; background: #fff; }
.account-toolbar input, .account-toolbar select { width: 100%; min-width: 0; border: 0; outline: 0; color: #415660; background: transparent; font: 12px inherit; }
.codex-account-grid { grid-template-columns: repeat(auto-fit, minmax(390px, 1fr)); gap: 12px; padding: 15px 17px 17px; }
.codex-account-card { position: relative; border: 1px solid #dfe8e9; border-radius: 10px; background: #fff; box-shadow: 0 2px 8px rgba(26, 40, 51, .035); }
.codex-account-head { grid-template-columns: auto auto minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 14px 14px 12px; }
.account-file-mark { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; color: var(--account-teal); background: #e6f4f3; }
.account-identity { min-width: 0; display: grid; gap: 3px; }
.account-identity strong, .account-identity small { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.account-identity strong { color: var(--account-ink); font-size: 12px; }
.account-identity small { color: #8b9aa2; font: 9px ui-monospace, SFMono-Regular, Consolas, monospace; }
.status-enabled { color: #2d8b55 !important; background: #eaf7ee !important; }
.status-disabled { color: #7e898d !important; background: #eff2f2 !important; }
.status-problem { color: #ad6a22 !important; background: #fff5df !important; }
.request-record { margin: 0 14px; padding: 10px 0 11px; border-top: 1px solid #edf0f3; border-bottom: 1px solid #edf0f3; }
.request-record-head { display: flex; justify-content: space-between; margin-bottom: 8px; color: #819199; font-size: 9px; }
.request-record-head strong { color: #4d626b; }
.request-bars { display: grid; grid-template-columns: repeat(20, minmax(4px, 1fr)); gap: 3px; }
.request-bars i { display: block; height: 12px; border-radius: 2px; background: #e8ecee; }
.request-bars i.success { background: #9ed4b1; }
.request-bars i.failed { background: #efb3ab; }
.request-bars i.success.failed { background: linear-gradient(90deg, #9ed4b1 50%, #efb3ab 50%); }
.codex-account-meta { display: flex; gap: 7px; padding: 10px 14px 0; color: #8b999f; font: 9px ui-monospace, SFMono-Regular, Consolas, monospace; }
.codex-account-quota { display: grid; gap: 7px; width: calc(100% - 28px); min-height: 74px; margin: 13px 14px; padding: 13px 12px; border: 1px solid #e1e9ea; border-radius: 9px; outline: 0; color: #6c7e85; background: #fbfdfd; text-align: left; cursor: pointer; }
.codex-account-quota { transition: border-color .18s ease, background-color .18s ease, box-shadow .18s ease, color .18s ease; }
.codex-account-quota:hover:not(:disabled) { box-shadow: 0 3px 10px rgba(26, 40, 51, .06); }
.codex-account-quota.quota-state-healthy { border-color: #cde9d2; color: #35674b; background: #f3fbf4; }
.codex-account-quota.quota-state-warning { border-color: #f0ddb0; color: #806126; background: #fffaf0; }
.codex-account-quota.quota-state-danger { border-color: #f0caca; color: #994848; background: #fff7f7; }
.codex-account-quota.quota-state-healthy:hover:not(:disabled) { border-color: #a9d9b1; }
.codex-account-quota.quota-state-warning:hover:not(:disabled) { border-color: #dfc37f; }
.codex-account-quota.quota-state-danger:hover:not(:disabled) { border-color: #e4a4a4; }
.codex-account-quota > strong, .codex-account-quota > span { text-align: center; }
.codex-account-quota > strong { color: #63777f; font-size: 11px; }
.codex-account-quota > span { color: #91a0a5; font-size: 9px; }
.quota-heading, .quota-window { display: flex; align-items: center; gap: 8px; }
.quota-heading { justify-content: space-between; }
.quota-heading strong { color: #405b63; font-size: 11px; }
.quota-heading span { color: #2f8b58; font-size: 9px; }
.quota-heading span.quota-tone-healthy { color: #2f8b58; }
.quota-heading span.quota-tone-warning { color: #a96812; }
.quota-heading span.quota-tone-danger { color: #b04444; }
.quota-heading span.quota-tone-unknown { color: #7f8d92; }
.quota-windows { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.quota-window { display: grid; grid-template-columns: 1fr auto; gap: 3px 7px; padding: 7px 8px; border-radius: 6px; background: #f1f7f7; }
.quota-window.quota-window-healthy { background: #e8f6ee; }
.quota-window.quota-window-warning { background: #fff0cc; }
.quota-window.quota-window-danger { background: #ffe4e2; }
.quota-window span, .quota-window strong, .quota-window small { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.quota-window span { color: #71858b; font-size: 9px; }
.quota-window strong { color: #3b7455; font-size: 9px; }
.quota-window-warning strong { color: #8a641b; }
.quota-window-danger strong { color: #a13e3e; }
.quota-window small { grid-column: 1 / -1; color: #8b9ba0; font-size: 8px; }
.quota-note { color: #9aa6aa; font-size: 8px; }
.codex-account-actions .icon-button { width: 30px; height: 30px; border: 1px solid #dfe7e8; border-radius: 7px; color: #64777f; background: #fff; }
.codex-account-actions .icon-button:hover { color: var(--account-teal); border-color: #a3c9ca; background: #f4fbfb; }
.danger-icon:hover { color: var(--account-red) !important; border-color: #e7b3b3 !important; background: #fff7f7 !important; }
.enable-control { display: inline-flex; align-items: center; gap: 7px; margin-left: auto; color: #89979c; font-size: 9px; cursor: pointer; }
.enable-control input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.enable-switch { display: inline-flex; align-items: center; width: 35px; height: 20px; padding: 2px; border-radius: 99px; background: #8c9698; }
.enable-switch i { width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .18s ease; }
.enable-control input:checked + .enable-switch { background: var(--account-green); }
.enable-control input:checked + .enable-switch i { transform: translateX(15px); }
.auth-action-dialog { width: min(600px, 100vw); max-height: min(840px, 100vh); overflow: auto; border: 1px solid #dbe7e9; border-radius: 11px; background: #fff; box-shadow: 0 18px 60px rgba(27, 46, 55, .18); }
.auth-action-dialog > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 19px 20px 15px; border-bottom: 1px solid #edf1f2; }
.auth-action-dialog h2 { margin: 0; color: var(--account-ink); font-size: 18px; }
.auth-action-dialog header p { margin: 0; color: #829198; font: 10px ui-monospace, SFMono-Regular, Consolas, monospace; }
.dialog-state { display: grid; place-items: center; gap: 7px; min-height: 220px; padding: 28px; color: #89999f; text-align: center; font-size: 10px; }
.dialog-state strong { color: #556e77; font-size: 13px; }
.model-list { display: grid; padding: 8px 19px 14px; }
.model-list article { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; gap: 9px; align-items: center; padding: 12px 0; border-bottom: 1px solid #edf1f2; }
.model-list article > span { display: grid; place-items: center; width: 29px; height: 29px; color: var(--account-teal); background: #eaf6f6; }
.model-list article > div { min-width: 0; display: grid; gap: 3px; }
.model-list strong, .model-list small { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.model-list strong { color: #3d5760; font-size: 11px; }
.model-list small { color: #8a9aa0; font: 9px ui-monospace, SFMono-Regular, Consolas, monospace; }
.model-list em { padding: 3px 5px; color: #73868c; background: #f1f5f5; font-size: 8px; font-style: normal; }
.settings-form { display: grid; gap: 12px; padding: 17px 19px 19px; }
.settings-form label:not(.settings-check) { display: grid; gap: 5px; color: #506971; font-size: 10px; font-weight: 700; }
.settings-form input:not([type='checkbox']), .settings-form textarea { width: 100%; padding: 9px 10px; border: 1px solid #dce6e8; border-radius: 6px; outline: 0; color: #3e5660; background: #fff; font: 12px/1.45 inherit; }
.settings-form textarea { resize: vertical; }
.settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.settings-check { display: flex; align-items: center; gap: 7px; color: #5f747b; font-size: 10px; }
.settings-check input { accent-color: var(--account-teal); }
.dialog-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 13px 19px 17px; border-top: 1px solid #edf1f2; }
.delete-content { display: grid; gap: 9px; justify-items: center; padding: 25px; color: #6e8087; text-align: center; }
.delete-icon { display: grid; place-items: center; width: 43px; height: 43px; border-radius: 50%; color: var(--account-red); background: #fff0f0; }
.delete-content strong { color: #4d5f66; font-size: 14px; }
.delete-content p { max-width: 330px; margin: 0; font-size: 10px; }
.danger-button { color: #fff; background: var(--account-red); }
.cpa-file-editor { display: flex; flex-direction: column; width: min(640px, calc(100vw - 28px)); max-height: min(900px, calc(100vh - 24px)); overflow: hidden; border-radius: 10px; }
.cpa-editor-header { flex: 0 0 auto; padding: 19px 22px 17px !important; background: #fff; }
.cpa-editor-kicker { display: block; margin-bottom: 8px; color: #777f7c; font-size: 12px; font-weight: 650; letter-spacing: .02em; }
.cpa-editor-header h2 { max-width: calc(100% - 28px); overflow: hidden; color: #303735; font-size: 18px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.cpa-editor-scroll { min-height: 0; overflow-y: auto; padding: 21px 22px 26px; scrollbar-color: #d4d9d7 transparent; }
.cpa-json-section { margin-bottom: 20px; }
.cpa-field-label { display: flex; align-items: baseline; gap: 5px; margin-bottom: 7px; color: #77807c; font-size: 11px; }
.cpa-field-label strong { color: #727b77; font-weight: 700; }
.cpa-field-label span { color: #909794; font: 10px ui-monospace, SFMono-Regular, Consolas, monospace; }
.cpa-field-label em { margin-left: auto; color: #9b7770; font-size: 9px; font-style: normal; }
.cpa-json-preview { min-height: 102px; max-height: 190px; overflow: auto; margin: 0; padding: 11px 12px; border: 1px solid #dce2df; border-radius: 9px; color: #5e6864; background: #fff; font: 11px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre; tab-size: 2; }
.cpa-info-preview { max-height: 162px; color: #65716c; background: #fcfdfc; }
.cpa-settings-form { display: grid; gap: 15px; }
.cpa-settings-form > label:not(.settings-check) { display: grid; gap: 6px; color: #353b39; font-size: 16px; font-weight: 650; }
.cpa-settings-form > label:not(.settings-check) input, .cpa-settings-form > label:not(.settings-check) textarea { width: 100%; min-height: 44px; padding: 10px 11px; border: 1px solid #dbe0dd; border-radius: 8px; outline: 0; color: #4d5753; background: #fff; font: 14px/1.45 inherit; }
.cpa-settings-form > label:not(.settings-check) textarea { min-height: 94px; resize: vertical; }
.cpa-settings-form > label:not(.settings-check) input:focus, .cpa-settings-form > label:not(.settings-check) textarea:focus { border-color: #86a9a1; box-shadow: 0 0 0 3px rgba(80, 137, 125, .1); }
.cpa-settings-form > label:not(.settings-check) small { margin-top: -1px; color: #909895; font-size: 10px; font-weight: 400; }
.cpa-settings-toggles { display: grid; gap: 8px; padding-top: 2px; }
.cpa-settings-toggles .settings-check { min-height: 30px; padding: 7px 9px; border: 1px solid #e5e9e7; border-radius: 7px; background: #fbfcfb; }
.cpa-editor-footer { flex: 0 0 auto; justify-content: flex-end; padding: 13px 22px 16px; background: #fff; }
.cpa-editor-footer .btn { min-width: 62px; min-height: 38px; }
.cpa-editor-footer .btn:not(.btn-white) { color: #fff; background: #b7b9b7; }
.cpa-editor-footer .btn:not(.btn-white):not(:disabled) { background: #587c70; }
.cpa-editor-footer .btn:disabled { cursor: not-allowed; opacity: .65; }
@media (max-width: 760px) { .account-toolbar { grid-template-columns: 1fr; } .codex-account-grid { grid-template-columns: 1fr; } .quota-windows { grid-template-columns: 1fr; } .account-notice { top: 70px; left: 50%; width: calc(100vw - 32px); } }
</style>
