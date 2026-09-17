<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { IconAlertTriangle, IconArrowRight, IconBook2, IconCheck, IconClock, IconCode, IconCopy, IconHelpCircle, IconKey, IconLock, IconMessageCircle, IconRefresh, IconRobot, IconShieldCheck, IconSparkles, IconUser, IconWallet } from '@tabler/icons-vue'
import { EmployeeApiError, fetchEmployeeKeys, fetchEmployeeModels, fetchEmployeeProfile, fetchEmployeeUsage, type EmployeeKeys, type EmployeeModels, type EmployeeProfile, type EmployeeUsage } from '../employee-api'

const profile = ref<EmployeeProfile | null>(null)
const keys = ref<EmployeeKeys | null>(null)
const usage = ref<EmployeeUsage | null>(null)
const models = ref<EmployeeModels | null>(null)
const period = ref<'7d' | '30d'>('7d')
const activeGuide = ref<'codex' | 'workbuddy'>('codex')
const copied = ref('')
const isLoading = ref(false)
const usageLoading = ref(false)
const errorMessage = ref('')
const partialErrors = ref<string[]>([])
let request: AbortController | undefined
let usageRequest: AbortController | undefined
let copyTimer: ReturnType<typeof setTimeout> | undefined

const currentGuide = computed(() => keys.value?.connection.guides.find((item) => item.id === activeGuide.value))
const maxTrend = computed(() => Math.max(...(usage.value?.trend.map((item) => item.points) ?? [1]), 1))
const summaryCards = computed(() => {
  const value = usage.value?.summary
  return [
    { label: '本月点数', value: value ? value.pointsUsed.toLocaleString('zh-CN') : '—', hint: value ? `软目标 ${value.pointsTarget.toLocaleString('zh-CN')} 点` : '正在加载', icon: IconWallet, tone: 'teal' },
    { label: '剩余比例', value: value ? `${(100 - value.usagePercent).toFixed(1)}%` : '—', hint: value ? `剩余 ${value.pointsRemaining.toLocaleString('zh-CN')} 点` : '正在加载', icon: IconShieldCheck, tone: 'green' },
    { label: '请求次数', value: value ? value.requests.toLocaleString('zh-CN') : '—', hint: `${period.value === '7d' ? '近 7 天' : '近 30 天'}本人调用`, icon: IconMessageCircle, tone: 'blue' },
    { label: '成功率', value: value ? `${value.successRate}%` : '—', hint: value ? `${value.tokens.toLocaleString('zh-CN')} Token` : '正在加载', icon: IconSparkles, tone: 'violet' },
  ]
})

function dateText(value: string | null) { if (!value) return '尚未使用'; return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) }
function daysTo(value: string) { const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000); return days > 0 ? `${days} 天后到期` : '已到期' }
async function loadData() {
  request?.abort(); const next = new AbortController(); request = next; isLoading.value = true; errorMessage.value = ''; partialErrors.value = []
  const results = await Promise.allSettled([fetchEmployeeProfile(next.signal), fetchEmployeeKeys(next.signal), fetchEmployeeUsage(period.value, next.signal), fetchEmployeeModels(next.signal)])
  if (next.signal.aborted) return
  if (results[0].status === 'fulfilled') profile.value = results[0].value; else errorMessage.value = errorText(results[0].reason)
  if (results[1].status === 'fulfilled') keys.value = results[1].value; else partialErrors.value.push('我的 Key 与连接说明')
  if (results[2].status === 'fulfilled') usage.value = results[2].value; else partialErrors.value.push('我的用量')
  if (results[3].status === 'fulfilled') models.value = results[3].value; else partialErrors.value.push('可用模型')
  if (request === next) isLoading.value = false
}
function errorText(error: unknown) { const requestId = error instanceof EmployeeApiError ? error.requestId : undefined; return `${error instanceof Error ? error.message : '员工自助数据暂时无法加载'}${requestId ? ` · 请求 ID ${requestId}` : ''}` }
async function changePeriod(value: '7d' | '30d') { period.value = value; usageRequest?.abort(); const next = new AbortController(); usageRequest = next; usageLoading.value = true; try { usage.value = await fetchEmployeeUsage(value, next.signal) } catch (error) { if (!next.signal.aborted) partialErrors.value = ['我的用量']; } finally { if (usageRequest === next) usageLoading.value = false } }
async function copySafe(value: string, id: string) { try { await navigator.clipboard.writeText(value); copied.value = id; if (copyTimer) clearTimeout(copyTimer); copyTimer = setTimeout(() => copied.value = '', 1_800) } catch { copied.value = '' } }
onMounted(() => void loadData())
onBeforeUnmount(() => { request?.abort(); usageRequest?.abort(); if (copyTimer) clearTimeout(copyTimer) })
</script>

<template>
  <main class="employee-dashboard">
    <div v-if="profile" class="employee-demo-banner"><span>DEMO</span>{{ profile.scope.notice }}</div>
    <section v-if="profile" class="employee-hero"><div class="employee-hero-avatar">{{ profile.person.initials }}</div><div class="employee-hero-copy"><span>欢迎回来</span><h1>{{ profile.person.name }}</h1><p>{{ profile.person.department }} · {{ profile.person.employeeCode }} · 负责人：{{ profile.person.manager }}</p><div><em><IconUser :size="13" />仅本人数据</em><em><IconShieldCheck :size="13" />会话与权限已验证</em></div></div><div class="employee-hero-actions"><button class="employee-secondary-button"><IconHelpCircle :size="16" />获取帮助</button><button class="employee-primary-button" disabled title="临时额度申请将在二期开放">申请临时额度</button></div></section>
    <section v-if="profile" class="employee-metric-grid" aria-label="本人用量汇总"><article v-for="card in summaryCards" :key="card.label"><header><span>{{ card.label }}</span><i :class="`tone-${card.tone}`"><component :is="card.icon" :size="19" /></i></header><strong>{{ card.value }}</strong><small>{{ card.hint }}</small></article></section>

    <div v-if="!profile && !errorMessage" class="employee-state"><IconRefresh :size="23" class="spinning" /><div><strong>正在加载员工自助</strong><p>正在读取本人 Key、用量和授权模型…</p></div></div>
    <div v-else-if="errorMessage && !profile" class="employee-state failed"><IconAlertTriangle :size="23" /><div><strong>员工自助加载失败</strong><p>{{ errorMessage }}</p></div><button class="employee-secondary-button" @click="loadData">重试</button></div>
    <div v-if="partialErrors.length" class="employee-partial-warning"><IconAlertTriangle :size="17" />部分区域暂时不可用：{{ partialErrors.join('、') }}。其他本人数据仍可查看。</div>

    <div v-if="profile" class="employee-content-grid">
      <div class="employee-primary-column">
        <section class="employee-panel"><header class="employee-panel-heading"><div><span><IconKey :size="17" /></span><div><h2>我的 Key</h2><p>只显示掩码、用途和有效期</p></div></div><em>{{ keys?.items.length ?? 0 }} 个</em></header><div v-if="keys" class="employee-key-list"><article v-for="item in keys.items" :key="item.id"><header><code>{{ item.masked }}</code><span :class="item.status">{{ item.status === 'active' ? '使用中' : '即将到期' }}</span></header><h3>{{ item.purpose }}</h3><p>业务别名 <code>{{ item.alias }}</code></p><div><span><small>允许模型</small><strong>{{ item.allowedModels.join('、') }}</strong></span><span><small>最后使用</small><strong>{{ dateText(item.lastUsedAt) }}</strong></span><span><small>有效期</small><strong>{{ daysTo(item.expiresAt) }}</strong></span></div><footer><span><IconLock :size="13" />完整 Key 不可再次查看</span><button disabled>轮换 Key</button></footer></article></div><div v-else class="employee-panel-loading"><IconRefresh :size="18" class="spinning" />正在读取 Key…</div></section>

        <section class="employee-panel"><header class="employee-panel-heading"><div><span><IconWallet :size="17" /></span><div><h2>我的用量</h2><p>个人软目标，不会自动阻断</p></div></div><div class="employee-period-tabs"><button :class="{ active: period === '7d' }" @click="changePeriod('7d')">7 天</button><button :class="{ active: period === '30d' }" @click="changePeriod('30d')">30 天</button></div></header><template v-if="usage"><div class="employee-usage-progress"><header><span>本月软目标</span><strong>{{ usage.summary.usagePercent }}%</strong></header><div><i :style="{ width: `${Math.min(usage.summary.usagePercent, 100)}%` }" /></div><footer><span>{{ usage.summary.pointsUsed.toLocaleString('zh-CN') }} 已用</span><span>{{ usage.summary.pointsRemaining.toLocaleString('zh-CN') }} 剩余</span><span>{{ usage.summary.pointsTarget.toLocaleString('zh-CN') }} 目标</span></footer></div><div class="employee-trend" :class="{ loading: usageLoading }"><div v-for="item in usage.trend" :key="item.date" :title="`${item.date} · ${item.points} 点`"><i :style="{ height: `${Math.max((item.points / maxTrend) * 100, 5)}%` }" /><small v-if="period === '7d'">{{ item.date.slice(5) }}</small></div></div><div class="employee-purpose-list"><article v-for="item in usage.purposes" :key="item.id"><span>{{ item.name }}</span><div><i :style="{ width: `${item.percent}%` }" /></div><strong>{{ item.points.toLocaleString('zh-CN') }} 点</strong><em>{{ item.percent }}%</em></article></div><footer class="employee-soft-note"><IconShieldCheck :size="15" />达到 100% 后仍按一期规则继续提供服务；请优先使用匹配用途的业务模型。</footer></template><div v-else class="employee-panel-loading"><IconRefresh :size="18" class="spinning" />正在读取本人用量…</div></section>

        <section class="employee-panel"><header class="employee-panel-heading"><div><span><IconCode :size="17" /></span><div><h2>连接说明</h2><p>Codex Desktop / WorkBuddy</p></div></div><span class="employee-safe-tag">安全配置</span></header><template v-if="keys"><div class="employee-guide-tabs"><button v-for="guide in keys.connection.guides" :key="guide.id" :class="{ active: activeGuide === guide.id }" @click="activeGuide = guide.id">{{ guide.name }}</button></div><div class="employee-guide-body"><p>{{ currentGuide?.description }}</p><div class="employee-config-line"><span><small>Base URL</small><code>{{ keys.connection.baseUrl }}</code></span><button :aria-label="`复制 Base URL`" @click="copySafe(keys.connection.baseUrl, 'base-url')"><IconCheck v-if="copied === 'base-url'" :size="15" /><IconCopy v-else :size="15" />{{ copied === 'base-url' ? '已复制' : '复制' }}</button></div><ol><li v-for="(step, index) in currentGuide?.steps" :key="step"><span>{{ index + 1 }}</span>{{ step }}</li></ol><div class="employee-credential-note"><IconLock :size="15" />{{ keys.connection.credentialDelivery }}</div></div></template></section>
      </div>

      <aside class="employee-secondary-column">
        <section class="employee-panel"><header class="employee-panel-heading"><div><span><IconRobot :size="17" /></span><div><h2>可用模型</h2><p>只展示业务别名</p></div></div><em>{{ models?.items.length ?? 0 }} 个</em></header><div v-if="models" class="employee-model-list"><article v-for="item in models.items" :key="item.id"><header><div><strong>{{ item.name }}</strong><code>{{ item.alias }}</code></div><span :class="item.status">{{ item.status === 'available' ? '可用' : '受限' }}</span></header><p>{{ item.description }}</p><div class="employee-model-tags"><span v-for="tag in item.capabilityTags" :key="tag">{{ tag }}</span><span>{{ item.contextLabel }}</span></div><small><IconSparkles :size="13" />{{ item.useAdvice }}</small><button :aria-label="`复制模型别名 ${item.alias}`" @click="copySafe(item.alias, item.id)"><IconCheck v-if="copied === item.id" :size="14" /><IconCopy v-else :size="14" />{{ copied === item.id ? '已复制' : '复制别名' }}</button></article></div></section>

        <section class="employee-panel"><header class="employee-panel-heading"><div><span><IconBook2 :size="17" /></span><div><h2>常见错误</h2><p>根据稳定错误码处理</p></div></div></header><div class="employee-error-list"><details v-for="item in profile.commonErrors" :key="item.code"><summary><span>{{ item.code }}</span><strong>{{ item.title }}</strong><IconArrowRight :size="15" /></summary><div><p>{{ item.explanation }}</p><small>{{ item.action }}</small></div></details></div></section>

        <section class="employee-help-card"><span><IconHelpCircle :size="21" /></span><div><strong>仍然无法解决？</strong><p>{{ profile.support.contact }} · {{ profile.support.serviceHours }}</p></div><button>查看联系说明</button></section>
      </aside>
    </div>
    <footer v-if="profile" class="employee-page-footer">DEMO 数据 · 会话已认证 · 服务端员工 RBAC 已启用 · 仅展示本人范围 · 不含完整 Key、供应商、实际模型、上游渠道或管理配置</footer>
  </main>
</template>
