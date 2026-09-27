<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { IconAlertTriangle, IconBrandOpenai, IconCheck, IconCopy, IconKey, IconLogout, IconRefresh, IconSparkles } from '@tabler/icons-vue'
import { fetchCurrentUser, logout, type AuthUser } from '../auth-api'
import {
  createDeviceSetupTicket,
  createEmployeePortalKey,
  EmployeePortalApiError,
  fetchDeviceSetupTicket,
  fetchEmployeePortalKey,
  resetEmployeePortalKey,
  type DeviceSetupTarget,
  type DeviceSetupTicket,
  type EmployeePortalKeyResponse,
} from '../employee-portal-api'

const profile = ref<AuthUser | null>(null)
const keyState = ref<EmployeePortalKeyResponse | null>(null)
const revealedKey = ref('')
const errorMessage = ref('')
const notice = ref('')
const isLoading = ref(false)
const isMutating = ref(false)
const isStartingImport = ref(false)
const activeSetup = ref<DeviceSetupTicket | null>(null)
const showAssistantInstall = ref(false)
let setupPollTimer: number | null = null
let setupInstallHintTimer: number | null = null
let isPollingSetup = false

const hasKey = computed(() => Boolean(keyState.value?.key))
const keyMask = computed(() => keyState.value?.key?.masked ?? '尚未申请')
const isSetupRunning = computed(() => activeSetup.value?.state === 'pending' || activeSetup.value?.state === 'claimed')
const setupTargetLabel = computed(() => activeSetup.value?.target === 'codex' ? 'Codex' : 'WorkBuddy')
const setupStatusText = computed(() => {
  if (!activeSetup.value) return ''
  if (activeSetup.value.state === 'pending') return `正在打开本机 AI OPS 助手，准备导入 ${setupTargetLabel.value}…`
  if (activeSetup.value.state === 'claimed') return `正在将 AI OPS 写入 ${setupTargetLabel.value}…`
  return ''
})

function stopSetupPolling() {
  if (setupPollTimer !== null) window.clearInterval(setupPollTimer)
  if (setupInstallHintTimer !== null) window.clearTimeout(setupInstallHintTimer)
  setupPollTimer = null
  setupInstallHintTimer = null
  isPollingSetup = false
}

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [user, key] = await Promise.all([fetchCurrentUser(), fetchEmployeePortalKey()])
    profile.value = user?.user ?? null
    keyState.value = key
    revealedKey.value = key.secret ?? ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '无法加载员工账户。'
  } finally {
    isLoading.value = false
  }
}

async function issue(action: 'create' | 'reset') {
  if (isMutating.value) return
  if (action === 'reset' && !window.confirm('重置后旧 Key 会立即失效，已导入的客户端需要重新一键导入。确定继续吗？')) return
  isMutating.value = true
  errorMessage.value = ''
  notice.value = ''
  try {
    const result = action === 'create' ? await createEmployeePortalKey() : await resetEmployeePortalKey()
    keyState.value = result
    revealedKey.value = result.secret
    notice.value = action === 'create'
      ? 'Key 已申请。现在选择 Codex 或 WorkBuddy，一键完成导入。'
      : 'Key 已重置。请对正在使用的客户端重新点击一次导入。'
  } catch (error) {
    errorMessage.value = error instanceof EmployeePortalApiError ? error.message : '操作未完成，请稍后重试。'
  } finally {
    isMutating.value = false
  }
}

async function copyKey() {
  if (!revealedKey.value) return
  try {
    await navigator.clipboard.writeText(revealedKey.value)
    notice.value = '平台 Key 已复制。'
  } catch {
    errorMessage.value = '浏览器未允许复制，请手动选择后复制。'
  }
}

function importSuccess(target: DeviceSetupTarget) {
  notice.value = target === 'codex'
    ? 'Codex 已加入 AI OPS。重新打开 Codex 后即可使用，已有对话不会丢失。'
    : 'WorkBuddy 已加入 AI OPS。重新打开 WorkBuddy 后即可使用，已有对话不会丢失。'
  errorMessage.value = ''
}

async function pollSetup() {
  if (!activeSetup.value || isPollingSetup) return
  isPollingSetup = true
  try {
    const result = await fetchDeviceSetupTicket(activeSetup.value.id)
    activeSetup.value = result.ticket
    if (result.ticket.state === 'succeeded') {
      stopSetupPolling()
      showAssistantInstall.value = false
      importSuccess(result.ticket.target)
    } else if (result.ticket.state === 'failed' || result.ticket.state === 'expired') {
      stopSetupPolling()
      showAssistantInstall.value = result.ticket.state === 'expired'
      errorMessage.value = result.ticket.state === 'expired'
        ? '本机配置请求已过期，请重新点击导入。'
        : (result.ticket.failureMessage ?? '本机助手未能完成配置。请再试一次；如仍失败，请联系管理员。')
    }
  } catch (error) {
    stopSetupPolling()
    errorMessage.value = error instanceof EmployeePortalApiError ? error.message : '无法确认本机配置状态，请刷新页面后重试。'
  } finally {
    isPollingSetup = false
  }
}

function beginSetupPolling(ticket: DeviceSetupTicket) {
  stopSetupPolling()
  activeSetup.value = ticket
  showAssistantInstall.value = false
  setupPollTimer = window.setInterval(() => void pollSetup(), 850)
  setupInstallHintTimer = window.setTimeout(() => {
    if (activeSetup.value?.id === ticket.id && activeSetup.value.state === 'pending') showAssistantInstall.value = true
  }, 7_000)
  void pollSetup()
}

async function importClient(target: DeviceSetupTarget) {
  if (!hasKey.value || isStartingImport.value || isSetupRunning.value) return
  isStartingImport.value = true
  errorMessage.value = ''
  notice.value = ''
  try {
    const result = await createDeviceSetupTicket(target)
    beginSetupPolling(result.ticket)
    // The URL carries only a one-time, five-minute ticket. The Key stays out
    // of browser history and is fetched by the registered local assistant.
    window.location.assign(result.launchUrl)
  } catch (error) {
    errorMessage.value = error instanceof EmployeePortalApiError ? error.message : '无法启动一键导入，请稍后重试。'
  } finally {
    isStartingImport.value = false
  }
}

async function signOut() {
  await logout().catch(() => undefined)
  window.location.assign('/login')
}

onMounted(() => void load())
onBeforeUnmount(stopSetupPolling)
</script>

<template>
  <main class="employee-page">
    <header class="employee-topbar"><div><strong>AI OPS</strong><span>我的 AI 工作台</span></div><button type="button" @click="signOut"><IconLogout :size="16" />退出登录</button></header>
    <section class="employee-shell">
      <div class="employee-heading"><div><p class="eyebrow">MY AI ACCESS</p><h1>你好，{{ profile?.displayName ?? '员工' }}</h1><p>申请一个平台 Key，再点一次即可把 AI OPS 导入 Codex 或 WorkBuddy。</p></div><button class="btn btn-white" :disabled="isLoading" @click="load"><IconRefresh :size="16" :class="{ spinning: isLoading }" />刷新</button></div>

      <p v-if="errorMessage" class="employee-message error" role="alert"><IconAlertTriangle :size="16" />{{ errorMessage }}</p>
      <p v-if="notice" class="employee-message success" role="status"><IconCheck :size="16" />{{ notice }}</p>

      <section class="employee-card key-card">
        <span class="card-icon"><IconKey :size="22" /></span>
        <div><p>我的平台 Key</p><h2>{{ keyMask }}</h2><small v-if="hasKey">你的 Key 已准备好，可以直接一键导入客户端。</small><small v-else>申请后即可接入 AI OPS。</small></div>
        <div class="card-actions"><button v-if="!hasKey" class="btn create-key" :disabled="isMutating" @click="issue('create')">{{ isMutating ? '正在申请…' : '申请 Key' }}</button></div>
      </section>

      <details v-if="hasKey" class="key-management">
        <summary>管理 Key</summary>
        <div><code>{{ revealedKey }}</code><span><button class="btn btn-white" type="button" :disabled="!revealedKey" @click="copyKey"><IconCopy :size="16" />复制 Key</button><button class="btn btn-white" :disabled="isMutating" @click="issue('reset')">重置 Key</button></span></div>
      </details>

      <section class="quick-import">
        <header><div><p class="eyebrow">ONE-CLICK IMPORT</p><h2>一键接入</h2><small>只新增 AI OPS 配置，不会删除已有模型或对话记录。</small></div><span class="card-icon"><IconSparkles :size="22" /></span></header>
        <div class="client-options">
          <button type="button" :disabled="!hasKey || isStartingImport || isSetupRunning" @click="importClient('codex')"><IconBrandOpenai :size="21" /><span><strong>{{ activeSetup?.target === 'codex' && isSetupRunning ? '正在导入 Codex…' : '导入 Codex' }}</strong><small>点击一次，AI OPS 自动加入 Codex。</small></span></button>
          <button type="button" :disabled="!hasKey || isStartingImport || isSetupRunning" @click="importClient('workbuddy')"><IconSparkles :size="21" /><span><strong>{{ activeSetup?.target === 'workbuddy' && isSetupRunning ? '正在导入 WorkBuddy…' : '导入 WorkBuddy' }}</strong><small>点击一次，AI OPS 自动加入 WorkBuddy。</small></span></button>
        </div>
        <p v-if="setupStatusText" class="setup-status" role="status">{{ setupStatusText }}</p>
        <p v-if="showAssistantInstall" class="assistant-install">这台电脑尚未安装 AI OPS 助手？<a href="/AI-OPS-助手安装.cmd" download>下载并运行一次安装助手</a>，以后直接点击上面的导入按钮即可。</p>
        <p v-if="!hasKey" class="setup-status">请先申请 Key，随后即可一键导入。</p>
      </section>
    </section>
  </main>
</template>

<style scoped>
.employee-page { min-height: 100vh; color: var(--navy); background: var(--canvas, #f6f8f8); }.employee-topbar { display: flex; align-items: center; justify-content: space-between; padding: 17px max(24px, calc((100vw - 1000px) / 2)); border-bottom: 1px solid var(--line); background: var(--surface); }.employee-topbar > div { display: grid; gap: 2px; }.employee-topbar strong { letter-spacing: .05em; }.employee-topbar span, .employee-topbar button { color: var(--muted); font-size: 11px; }.employee-topbar button { display: inline-flex; align-items: center; gap: 5px; border: 0; background: transparent; cursor: pointer; }.employee-shell { width: min(100% - 36px, 860px); margin: 0 auto; padding: 54px 0; }.employee-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 24px; }.employee-heading h1 { margin: 4px 0 8px; font-size: 32px; }.employee-heading p:not(.eyebrow) { max-width: 580px; margin: 0; color: var(--muted); line-height: 1.75; }.employee-card, .quick-import { border: 1px solid var(--line); border-radius: 14px; background: var(--surface); box-shadow: 0 5px 18px rgba(25, 55, 59, .04); }.employee-card { display: flex; gap: 15px; padding: 22px; }.employee-card > div:nth-child(2) { min-width: 0; flex: 1; display: grid; align-content: start; gap: 5px; }.employee-card p, .quick-import p { margin: 0; color: var(--muted); font-size: 12px; }.employee-card h2, .quick-import h2 { margin: 0; color: var(--navy); font-size: 18px; }.employee-card small, .quick-import small { color: var(--muted); font-size: 11px; line-height: 1.65; }.card-icon { display: grid; flex: none; place-items: center; width: 42px; height: 42px; border-radius: 11px; color: var(--brand); background: #e7f2f2; }.card-actions { display: flex; align-self: center; }.key-management { margin-top: 10px; padding: 0 4px; color: var(--muted); font-size: 12px; }.key-management summary { width: max-content; color: var(--brand); cursor: pointer; font-weight: 700; }.key-management > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 11px; padding: 12px; border-radius: 9px; background: #f5f8f8; }.key-management code { overflow: hidden; min-width: 0; color: var(--navy); text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }.key-management span { display: flex; flex: none; gap: 8px; }.quick-import { margin-top: 18px; padding: 23px; }.quick-import header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }.quick-import header > div { display: grid; gap: 5px; }.client-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 18px; }.client-options button { display: flex; align-items: center; gap: 12px; min-height: 78px; padding: 14px; border: 1px solid #bfdadc; border-radius: 10px; color: var(--brand); background: #f8fcfc; text-align: left; transition: .18s ease; }.client-options button:hover:not(:disabled) { border-color: var(--brand); background: #eff9f9; transform: translateY(-1px); }.client-options button:disabled { cursor: not-allowed; opacity: .6; }.client-options span { display: grid; gap: 3px; }.client-options strong { color: var(--navy); font-size: 13px; }.setup-status, .assistant-install { margin-top: 14px !important; padding: 10px 11px; border-radius: 8px; background: #f1f7f7; line-height: 1.6; }.assistant-install { color: #516672 !important; background: #fff8e8; }.assistant-install a { color: var(--brand); font-weight: 700; }.employee-message { display: flex; align-items: center; gap: 7px; margin: 0 0 16px; padding: 10px 12px; border-radius: 8px; font-size: 12px; }.employee-message.error { color: var(--danger); background: #fff4f4; }.employee-message.success { color: #26754e; background: #effaf2; }
@media (max-width: 640px) { .employee-shell { padding-top: 34px; }.employee-heading { align-items: stretch; flex-direction: column; }.key-management > div { align-items: stretch; flex-direction: column; }.key-management span, .key-management span button { width: 100%; }.client-options { grid-template-columns: 1fr; }.employee-topbar { padding-inline: 18px; } }
</style>
