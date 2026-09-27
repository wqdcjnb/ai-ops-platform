<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { IconAlertTriangle, IconBrandOpenai, IconCheck, IconCopy, IconEye, IconEyeOff, IconKey, IconLogout, IconRefresh, IconSparkles } from '@tabler/icons-vue'
import { fetchCurrentUser, logout, type AuthUser } from '../auth-api'
import { createEmployeePortalKey, EmployeePortalApiError, fetchEmployeePortalKey, resetEmployeePortalKey, type EmployeePortalKeyResponse } from '../employee-portal-api'

const profile = ref<AuthUser | null>(null)
const keyState = ref<EmployeePortalKeyResponse | null>(null)
const revealedKey = ref('')
const errorMessage = ref('')
const notice = ref('')
const isLoading = ref(false)
const isMutating = ref(false)
const isImportingWorkBuddy = ref(false)
const isImportingCodex = ref(false)
const isCheckingCodex = ref(false)
const showImport = ref(false)
const isKeyVisible = ref(false)
type CodexLocalStatus = {
  installation: 'detected' | 'not_detected'
  login: 'logged_in' | 'not_logged_in' | 'unknown'
  customProviderAvailableWithoutLogin: boolean
}
const codexStatus = ref<CodexLocalStatus | null>(null)
const codexStatusMessage = ref('打开后会检测本机 Codex 的安装与登录状态。')
const workBuddyConnectorUrl = (import.meta.env.VITE_WORKBUDDY_CONNECTOR_URL ?? 'http://127.0.0.1:4176').replace(/\/$/u, '')

const hasKey = computed(() => Boolean(keyState.value?.key))
const keyMask = computed(() => keyState.value?.key?.masked ?? '尚未创建')

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [user, key] = await Promise.all([fetchCurrentUser(), fetchEmployeePortalKey()])
    profile.value = user?.user ?? null
    keyState.value = key
    revealedKey.value = key.secret ?? ''
    isKeyVisible.value = false
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '无法加载员工账户。'
  } finally {
    isLoading.value = false
  }
}

async function issue(action: 'create' | 'reset') {
  if (isMutating.value) return
  if (action === 'reset' && !window.confirm('重置后旧 Key 会立即失效，确定继续吗？')) return
  isMutating.value = true
  errorMessage.value = ''
  notice.value = ''
  try {
    const result = action === 'create' ? await createEmployeePortalKey() : await resetEmployeePortalKey()
    keyState.value = result
    revealedKey.value = result.secret
    isKeyVisible.value = true
    notice.value = 'Key 已更新。之后你仍可在本人登录状态下查看、复制或导入配置。'
  } catch (error) {
    errorMessage.value = error instanceof EmployeePortalApiError ? error.message : '操作未完成，请稍后重试。'
  } finally {
    isMutating.value = false
  }
}

async function copy(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value)
    notice.value = `${label}已复制。`
  } catch {
    errorMessage.value = '浏览器未允许复制，请手动选择复制。'
  }
}

function isCodexLocalStatus(value: unknown): value is CodexLocalStatus {
  if (!value || typeof value !== 'object') return false
  const status = value as Partial<CodexLocalStatus>
  return (status.installation === 'detected' || status.installation === 'not_detected')
    && (status.login === 'logged_in' || status.login === 'not_logged_in' || status.login === 'unknown')
    && typeof status.customProviderAvailableWithoutLogin === 'boolean'
}

async function checkCodexStatus() {
  if (isCheckingCodex.value) return
  isCheckingCodex.value = true
  codexStatusMessage.value = '正在检测本机 Codex 状态…'
  try {
    const response = await fetch(`${workBuddyConnectorUrl}/v1/codex/status`)
    const payload = await response.json().catch(() => null) as { ok?: boolean; codex?: unknown; error?: unknown } | null
    if (!response.ok || !payload?.ok || !isCodexLocalStatus(payload.codex)) throw new Error(typeof payload?.error === 'string' ? payload.error : '未能取得 Codex 状态。')
    codexStatus.value = payload.codex
    if (payload.codex.login === 'logged_in') {
      codexStatusMessage.value = '已检测到 Codex 登录：会直接加入 AI OPS，自定义模型不会影响已有对话。'
    } else if (payload.codex.login === 'not_logged_in') {
      codexStatusMessage.value = 'Codex 当前未登录：仍可直接配置 AI OPS 的独立平台 Key；不会创建虚拟身份。'
    } else if (payload.codex.installation === 'not_detected') {
      codexStatusMessage.value = '尚未检测到 Codex：仍可写入用户级配置，安装或打开 Codex 后即可生效。'
    } else {
      codexStatusMessage.value = '已检测到 Codex，但登录状态暂时无法确认；AI OPS 仍使用独立平台 Key。'
    }
  } catch {
    codexStatus.value = null
    codexStatusMessage.value = '无法连接本机 AI OPS 配置服务。请通过 AI OPS 的 start-docker.cmd 启动平台后重试。'
  } finally {
    isCheckingCodex.value = false
  }
}

function openImport() {
  errorMessage.value = ''
  showImport.value = true
  void checkCodexStatus()
}

async function importCodex() {
  if (!revealedKey.value) { errorMessage.value = '当前没有可用 Key，请先创建 Key。'; return }
  const gatewayBaseUrl = keyState.value?.gateway.baseUrl
  if (!gatewayBaseUrl) { errorMessage.value = '未取得 AI OPS 网关地址，请刷新后重试。'; return }

  isImportingCodex.value = true
  errorMessage.value = ''
  try {
    const response = await fetch(`${workBuddyConnectorUrl}/v1/codex/configure`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: revealedKey.value, gatewayBaseUrl }),
    })
    const payload = await response.json().catch(() => null) as { ok?: boolean; error?: unknown; login?: CodexLocalStatus['login']; backupCreated?: boolean } | null
    if (!response.ok || !payload?.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : '本机 Codex 配置服务未能写入配置。')
    notice.value = `已直接写入 Codex 的 AI OPS 配置${payload.backupCreated ? '，并已备份原有配置' : ''}。请重新打开 Codex 后使用；已有对话不会丢失。`
    if (codexStatus.value && payload.login) codexStatus.value = { ...codexStatus.value, login: payload.login }
    showImport.value = false
  } catch (error) {
    const connectionUnavailable = error instanceof TypeError
    const message = connectionUnavailable
      ? '无法连接本机 AI OPS 配置服务（127.0.0.1:4176）。'
      : error instanceof Error ? error.message : '本机 Codex 配置服务未能完成写入。'
    errorMessage.value = `${message} 请通过 AI OPS 的 start-docker.cmd 启动平台后重试。`
  } finally {
    isImportingCodex.value = false
  }
}

async function importWorkBuddy() {
  if (!revealedKey.value) { errorMessage.value = '当前没有可用 Key，请先创建 Key。'; return }
  const gatewayBaseUrl = keyState.value?.gateway.baseUrl
  if (!gatewayBaseUrl) { errorMessage.value = '未取得 AI OPS 网关地址，请刷新后重试。'; return }

  isImportingWorkBuddy.value = true
  errorMessage.value = ''
  try {
    const response = await fetch(`${workBuddyConnectorUrl}/v1/workbuddy/configure`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: revealedKey.value, gatewayBaseUrl }),
    })
    const payload = await response.json().catch(() => null) as { ok?: boolean; error?: unknown; preservedModels?: number } | null
    if (!response.ok || !payload?.ok) {
      const message = typeof payload?.error === 'string' ? payload.error : '本机 WorkBuddy 连接器未能写入配置。'
      throw new Error(message)
    }
    const preserved = payload.preservedModels ?? 0
    notice.value = `已直接写入 WorkBuddy 的 AI OPS 配置${preserved ? `，并保留 ${preserved} 个原有自定义模型` : ''}；不会删除任何对话。`
    showImport.value = false
  } catch (error) {
    const connectionUnavailable = error instanceof TypeError
    const message = connectionUnavailable
      ? '无法连接本机 WorkBuddy 配置服务（127.0.0.1:4176）。'
      : error instanceof Error ? error.message : '本机 WorkBuddy 配置服务未能完成写入。'
    errorMessage.value = `${message} 请通过 AI OPS 的 start-docker.cmd 启动平台后重试。`
  } finally {
    isImportingWorkBuddy.value = false
  }
}

async function signOut() {
  await logout().catch(() => undefined)
  window.location.assign('/login')
}

onMounted(() => void load())
</script>

<template>
  <main class="employee-page">
    <header class="employee-topbar"><div><strong>AI OPS</strong><span>统一模型工作台</span></div><button type="button" @click="signOut"><IconLogout :size="16" />退出登录</button></header>
    <section class="employee-shell">
      <div class="employee-heading"><div><p class="eyebrow">MY AI ACCESS</p><h1>你好，{{ profile?.displayName ?? '员工' }}</h1><p>一个平台 Key，接入文本、图片、视频等 AI OPS 能力。中转站与实际模型路由由平台自动处理。</p></div><button class="btn btn-white" :disabled="isLoading" @click="load"><IconRefresh :size="16" :class="{ spinning: isLoading }" />刷新</button></div>

      <p v-if="errorMessage" class="employee-message error" role="alert"><IconAlertTriangle :size="16" />{{ errorMessage }}</p>
      <p v-if="notice" class="employee-message success" role="status"><IconCheck :size="16" />{{ notice }}</p>

      <section class="employee-grid">
        <article class="employee-card model-card"><span class="card-icon"><IconSparkles :size="22" /></span><div><p>统一模型</p><h2>AI OPS</h2><code>ai-ops</code><small>在 Codex 与 WorkBuddy 中使用 AI OPS；无需选择或了解上游模型。</small></div></article>
        <article class="employee-card key-card"><span class="card-icon"><IconKey :size="22" /></span><div><p>我的平台 Key</p><h2>{{ keyMask }}</h2><small v-if="keyState?.key">创建于 {{ new Date(keyState.key.createdAt).toLocaleString('zh-CN', { hour12: false }) }} · 最后使用 {{ keyState.key.lastUsedAt ? new Date(keyState.key.lastUsedAt).toLocaleString('zh-CN', { hour12: false }) : '尚未使用' }}</small><small v-else>首次创建后可调用 AI OPS。</small></div><div class="card-actions"><button v-if="!hasKey" class="btn create-key" :disabled="isMutating" @click="issue('create')">创建 Key</button><template v-else><button class="btn btn-white" type="button" :disabled="!revealedKey" @click="isKeyVisible = !isKeyVisible"><IconEyeOff v-if="isKeyVisible" :size="16" /><IconEye v-else :size="16" />{{ isKeyVisible ? '隐藏 Key' : '显示 Key' }}</button><button class="btn btn-white" type="button" :disabled="!revealedKey" @click="copy(revealedKey, '平台 Key')"><IconCopy :size="16" />复制 Key</button><button class="btn btn-white" :disabled="isMutating" @click="issue('reset')">重置 Key</button></template></div></article>
      </section>

      <section v-if="hasKey && isKeyVisible" class="revealed-key" aria-live="polite"><div><strong>当前平台 Key</strong><code>{{ revealedKey }}</code><small>仅本人登录后可查看；管理员不会看到完整 Key。</small></div><button class="btn btn-white" @click="copy(revealedKey, '平台 Key')"><IconCopy :size="16" />复制 Key</button></section>

      <section class="employee-card import-card"><div><span class="card-icon"><IconSparkles :size="22" /></span><div><p>客户端配置</p><h2>导入配置</h2><small>选择客户端后接入 AI OPS。配置只新增 AI OPS，不会删除或重置已有对话记录。</small></div></div><button class="btn create-key" :disabled="!hasKey || !revealedKey" @click="openImport">导入配置</button></section>
    </section>

    <div v-if="showImport" class="drawer-backdrop" @click.self="showImport = false"><aside class="import-dialog" role="dialog" aria-modal="true" aria-label="导入配置"><header><div><p class="eyebrow">ONE-CLICK CONFIG</p><h2>导入配置</h2></div><button class="icon-button" aria-label="关闭" @click="showImport = false">×</button></header><p>配置会使用你的当前平台 Key。它只添加 AI OPS，不会删除或重置已有对话记录。</p><p class="import-status" :class="{ loading: isCheckingCodex }">{{ codexStatusMessage }}</p><div class="import-options"><button type="button" :disabled="isImportingCodex" @click="importCodex"><IconBrandOpenai :size="20" /><span><strong>{{ isImportingCodex ? '正在配置 Codex…' : '直接接入 Codex' }}</strong><small>直接写入本机 Codex 配置与 AI OPS 平台 Key，不下载文件。</small></span></button><button type="button" :disabled="isImportingWorkBuddy" @click="importWorkBuddy"><IconSparkles :size="20" /><span><strong>{{ isImportingWorkBuddy ? '正在配置 WorkBuddy…' : '导入 WorkBuddy' }}</strong><small>直接写入本机 WorkBuddy 的 AI OPS 配置，不下载文件。</small></span></button></div></aside></div>
  </main>
</template>

<style scoped>
.employee-page { min-height: 100vh; color: var(--navy); background: var(--canvas, #f6f8f8); }.employee-topbar { display: flex; align-items: center; justify-content: space-between; padding: 17px max(24px, calc((100vw - 1120px) / 2)); border-bottom: 1px solid var(--line); background: var(--surface); }.employee-topbar > div { display: grid; gap: 2px; }.employee-topbar strong { letter-spacing: .05em; }.employee-topbar span, .employee-topbar button { color: var(--muted); font-size: 11px; }.employee-topbar button { display: inline-flex; align-items: center; gap: 5px; border: 0; background: transparent; cursor: pointer; }.employee-shell { width: min(100% - 36px, 1120px); margin: 0 auto; padding: 54px 0; }.employee-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 24px; }.employee-heading h1 { margin: 4px 0 8px; font-size: 32px; }.employee-heading p:not(.eyebrow) { max-width: 660px; margin: 0; color: var(--muted); line-height: 1.75; }.employee-grid { display: grid; grid-template-columns: .88fr 1.12fr; gap: 16px; }.employee-card { display: flex; gap: 15px; padding: 22px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); box-shadow: 0 5px 18px rgba(25, 55, 59, .04); }.employee-card > div:nth-child(2) { min-width: 0; flex: 1; display: grid; align-content: start; gap: 5px; }.employee-card p { margin: 0; color: var(--muted); font-size: 12px; }.employee-card h2 { overflow: hidden; margin: 0; color: var(--navy); font-size: 18px; text-overflow: ellipsis; white-space: nowrap; }.employee-card code { color: var(--brand); font-size: 12px; }.employee-card small { color: var(--muted); font-size: 11px; line-height: 1.65; }.card-icon { display: grid; flex: none; place-items: center; width: 42px; height: 42px; border-radius: 11px; color: var(--brand); background: #e7f2f2; }.card-actions { display: flex; flex: none; flex-wrap: wrap; justify-content: flex-end; gap: 8px; align-self: center; }.import-card { align-items: center; justify-content: space-between; margin-top: 16px; }.import-card > div { display: flex; gap: 15px; }.revealed-key { display: flex; align-items: center; justify-content: space-between; gap: 15px; margin-top: 16px; padding: 15px 17px; border: 1px solid #d6eade; border-radius: 11px; background: #f5fcf7; }.revealed-key > div { display: grid; gap: 5px; min-width: 0; }.revealed-key strong { font-size: 13px; }.revealed-key code { overflow: hidden; color: var(--navy); text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }.employee-message { display: flex; align-items: center; gap: 7px; margin: 0 0 16px; padding: 10px 12px; border-radius: 8px; font-size: 12px; }.employee-message.error { color: var(--danger); background: #fff4f4; }.employee-message.success { color: #26754e; background: #effaf2; }.import-dialog { width: min(100% - 28px, 570px); padding: 22px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); box-shadow: 0 22px 60px rgba(0, 0, 0, .25); }.import-dialog header { display: flex; align-items: flex-start; justify-content: space-between; }.import-dialog h2 { margin: 3px 0 0; font-size: 20px; }.import-dialog > p { color: var(--muted); font-size: 12px; line-height: 1.7; }.import-status { margin: 12px 0 0; padding: 9px 10px; border-radius: 8px; color: #376272 !important; background: #f2f7f7; }.import-status.loading { color: var(--brand) !important; }.import-options { display: grid; gap: 10px; margin-top: 18px; }.import-options button { display: flex; align-items: center; gap: 12px; padding: 15px; border: 1px solid var(--line); border-radius: 9px; color: var(--brand); background: var(--surface); text-align: left; cursor: pointer; }.import-options span { display: grid; gap: 3px; color: var(--navy); }.import-options small { color: var(--muted); font-size: 11px; line-height: 1.5; }
@media (max-width: 760px) { .employee-shell { padding-top: 34px; }.employee-heading { align-items: stretch; flex-direction: column; }.employee-grid { grid-template-columns: 1fr; }.import-card, .revealed-key { align-items: stretch; flex-direction: column; }.card-actions { align-self: stretch; }.card-actions button, .import-card > button { width: 100%; } }
</style>
