<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { IconAlertTriangle, IconArrowLeft, IconArrowRight, IconBan, IconClock, IconDatabase, IconDownload, IconEye, IconFileSearch, IconKey, IconLock, IconMessageCircle, IconRefresh, IconSearch, IconShieldCheck, IconTool, IconUser, IconX } from '@tabler/icons-vue'
import { ConversationAuditApiError, fetchConversationAudits, requestConversationAccess, type ConversationAccessResponse, type ConversationAuditFilters, type ConversationAuditRecord, type ConversationAuditResponse } from '../conversation-audit-api'

const data = ref<ConversationAuditResponse | null>(null)
const selected = ref<ConversationAuditRecord | null>(null)
const access = ref<ConversationAccessResponse | null>(null)
const period = ref<ConversationAuditFilters['period']>('7d')
const search = ref('')
const person = ref('all')
const key = ref('all')
const purpose = ref('all')
const model = ref('all')
const policy = ref('all')
const state = ref<ConversationAuditFilters['state']>('all')
const redaction = ref<ConversationAuditFilters['redaction']>('all')
const grouping = ref<ConversationAuditFilters['grouping']>('all')
const page = ref(1)
const pageSize = 10
const reason = ref('')
const acknowledged = ref(false)
const isLoading = ref(false)
const isOpening = ref(false)
const errorMessage = ref('')
const accessError = ref('')
let request: AbortController | undefined
let accessRequest: AbortController | undefined

const stateText = { captured: '已采集', metadata_only: '仅元数据', expired: '已到期' }
const redactionText = { passed: '脱敏通过', review_required: '需要复核', not_applicable: '不适用' }
const updatedAt = computed(() => data.value ? dateTime(data.value.meta.generatedAt) : '—')
const canOpen = computed(() => selected.value?.contentAccess.available && reason.value.trim().length >= 8 && acknowledged.value && !isOpening.value)
const summaryCards = computed(() => {
  const value = data.value?.summary
  return [
    { label: '审计记录', value: value?.total ?? '—', hint: '当前筛选范围', icon: IconFileSearch, tone: 'teal' },
    { label: '获准采集', value: value?.captured ?? '—', hint: '正文仍需原因门禁', icon: IconShieldCheck, tone: 'green' },
    { label: '仅元数据', value: value?.metadataOnly ?? '—', hint: '未保存请求与回答', icon: IconDatabase, tone: 'blue' },
    { label: '24h 内到期', value: value?.expiringSoon ?? '—', hint: '应进入清理任务', icon: IconClock, tone: 'amber' },
    { label: '脱敏待复核', value: value?.reviewRequired ?? '—', hint: '不等于原文可见', icon: IconAlertTriangle, tone: 'red' },
  ]
})

function dateTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) }
function expiryText(value: string) { const diff = new Date(value).getTime() - Date.now(); if (diff <= 0) return '已到期'; const hours = Math.ceil(diff / 3_600_000); return hours < 24 ? `${hours} 小时后` : `${Math.ceil(hours / 24)} 天后` }
function filters(): ConversationAuditFilters { return { period: period.value, search: search.value.trim(), person: person.value, key: key.value, purpose: purpose.value, model: model.value, policy: policy.value, state: state.value, redaction: redaction.value, grouping: grouping.value, page: page.value, pageSize } }
function applyFilters() { page.value = 1; closeSelection(); void loadData() }
function clearFilters() { period.value = '7d'; search.value = ''; person.value = 'all'; key.value = 'all'; purpose.value = 'all'; model.value = 'all'; policy.value = 'all'; state.value = 'all'; redaction.value = 'all'; grouping.value = 'all'; applyFilters() }
function changePage(next: number) { if (!data.value || next < 1 || next > data.value.pagination.totalPages) return; page.value = next; closeSelection(); void loadData() }
function selectRecord(item: ConversationAuditRecord) { selected.value = item; access.value = null; reason.value = ''; acknowledged.value = false; accessError.value = '' }
function closeSelection() { selected.value = null; access.value = null; reason.value = ''; acknowledged.value = false; accessError.value = ''; accessRequest?.abort() }

async function loadData() {
  request?.abort(); const next = new AbortController(); request = next; isLoading.value = true; errorMessage.value = ''
  try { data.value = await fetchConversationAudits(filters(), next.signal) }
  catch (error) { if (next.signal.aborted) return; const requestId = error instanceof ConversationAuditApiError ? error.requestId : undefined; errorMessage.value = `${error instanceof Error ? error.message : '对话审计暂时无法加载'}${requestId ? ` · 请求 ID ${requestId}` : ''}` }
  finally { if (request === next) isLoading.value = false }
}
async function openContent() {
  if (!selected.value || !canOpen.value) return
  accessRequest?.abort(); const next = new AbortController(); accessRequest = next; isOpening.value = true; accessError.value = ''
  try { access.value = await requestConversationAccess(selected.value.id, reason.value.trim(), next.signal) }
  catch (error) { if (!next.signal.aborted) accessError.value = error instanceof Error ? error.message : '无法打开脱敏轮次' }
  finally { if (accessRequest === next) isOpening.value = false }
}

onMounted(() => void loadData())
onBeforeUnmount(() => { request?.abort(); accessRequest?.abort() })
</script>

<template>
  <div class="dashboard conversation-audit-dashboard">
    <section class="page-heading"><div><div class="eyebrow">CONVERSATION AUDIT</div><h1>对话审计</h1><p>按获准策略复核脱敏轮次；正文采集与普通调用日志完全隔离。</p></div><div class="heading-actions"><span class="updated-at">更新于 {{ updatedAt }}</span><button class="btn btn-white refresh-button" :disabled="isLoading" @click="loadData"><IconRefresh :size="17" :class="{ spinning: isLoading }" />刷新</button><button class="btn" disabled title="正式访问审计与异步导出接入后开放"><IconDownload :size="16" />导出</button></div></section>
    <div v-if="data" class="source-banner"><span>DEMO</span>{{ data.meta.notice }}</div>
    <section class="audit-summary-grid" aria-label="对话审计汇总"><article v-for="card in summaryCards" :key="card.label" class="metric-card"><div class="metric-top"><span class="metric-label">{{ card.label }}</span><span class="metric-icon" :class="`tone-${card.tone}`"><component :is="card.icon" :size="19" /></span></div><strong class="metric-value">{{ card.value }}</strong><div class="metric-foot">{{ card.hint }}</div></article></section>

    <div v-if="!data && !errorMessage" class="panel data-state"><div class="state-icon"><IconRefresh :size="22" class="spinning" /></div><div><strong>正在读取对话审计记录</strong><p>正在加载采集策略、脱敏状态、留存时间与请求关联…</p></div></div>
    <div v-else-if="errorMessage && !data" class="panel data-state failed"><div class="state-icon"><IconAlertTriangle :size="22" /></div><div><strong>对话审计加载失败</strong><p>{{ errorMessage }}</p></div><button class="btn btn-white" @click="loadData">重试</button></div>

    <template v-else-if="data">
      <section class="conversation-scope-banner"><span><IconShieldCheck :size="19" /></span><div><strong>默认不采集 · {{ data.scope.activePolicies }} 条演示策略生效</strong><p>{{ data.scope.notice }}</p></div><div class="conversation-scope-facts"><em>最近到期 {{ expiryText(data.scope.nearestExpiryAt) }}</em><em>服务端 RBAC 待验证</em><em>访问审计未持久化</em></div></section>
      <section class="panel conversation-audit-panel">
        <form class="conversation-filters" @submit.prevent="applyFilters"><label class="conversation-search"><IconSearch :size="15" /><input v-model="search" maxlength="80" type="search" placeholder="请求 ID、人员、Key、用途、模型或策略" /></label><label><select v-model="period" @change="applyFilters"><option value="today">今天</option><option value="7d">近 7 天</option><option value="30d">近 30 天</option></select></label><label><IconUser :size="14" /><select v-model="person" @change="applyFilters"><option value="all">全部人员</option><option v-for="option in data.options.people" :key="option.id" :value="option.id">{{ option.label }}</option></select></label><label><IconKey :size="14" /><select v-model="key" @change="applyFilters"><option value="all">全部 Key</option><option v-for="option in data.options.keys" :key="option.id" :value="option.id">{{ option.label }}</option></select></label><label><select v-model="purpose" @change="applyFilters"><option value="all">全部用途</option><option v-for="option in data.options.purposes" :key="option.id" :value="option.id">{{ option.label }}</option></select></label><label><select v-model="model" @change="applyFilters"><option value="all">全部模型</option><option v-for="option in data.options.models" :key="option.id" :value="option.id">{{ option.label }}</option></select></label><label><select v-model="policy" @change="applyFilters"><option value="all">全部策略</option><option v-for="option in data.options.policies" :key="option.id" :value="option.id">{{ option.label }}</option></select></label><label><select v-model="state" @change="applyFilters"><option value="all">全部采集状态</option><option value="captured">已采集</option><option value="metadata_only">仅元数据</option><option value="expired">已到期</option></select></label><label><select v-model="redaction" @change="applyFilters"><option value="all">全部脱敏状态</option><option value="passed">脱敏通过</option><option value="review_required">需要复核</option><option value="not_applicable">不适用</option></select></label><label><select v-model="grouping" @change="applyFilters"><option value="all">全部归组</option><option value="conversation">可靠会话</option><option value="independent_call">独立调用</option></select></label><button class="btn filter-submit" type="submit">查询</button><button class="text-button" type="button" @click="clearFilters">清除</button></form>

        <div class="conversation-workbench">
          <section class="conversation-record-column"><header><div><strong>审计记录</strong><small>不会按时间接近强行合并</small></div><span>{{ data.pagination.total }} 条</span></header>
            <div v-if="data.items.length" class="conversation-record-list"><button v-for="item in data.items" :key="item.id" class="conversation-record" :class="{ active: selected?.id === item.id }" @click="selectRecord(item)"><span class="conversation-record-icon"><IconMessageCircle :size="18" /></span><div class="conversation-record-main"><div><strong>{{ item.person.name }} · {{ item.purpose.label }}</strong><span class="capture-state" :class="item.state">{{ stateText[item.state] }}</span></div><small>{{ item.key.masked }} · {{ item.model.label }}</small><code>{{ item.requestId }}</code><div class="conversation-record-meta"><span>{{ dateTime(item.capturedAt) }}</span><span :class="{ warning: item.redaction.status === 'review_required' }">{{ redactionText[item.redaction.status] }}</span><span>{{ item.grouping.label }}</span></div></div></button></div>
            <div v-else class="conversation-empty"><IconFileSearch :size="24" /><strong>没有符合条件的记录</strong><span>调整人员、Key、用途、模型、策略或日期。</span><button class="text-button" @click="clearFilters">清除筛选</button></div>
            <footer class="usage-pagination"><span>第 {{ data.pagination.page }}/{{ Math.max(data.pagination.totalPages, 1) }} 页</span><div><button :disabled="data.pagination.page <= 1" aria-label="上一页" @click="changePage(data.pagination.page - 1)"><IconArrowLeft :size="15" /></button><button :disabled="data.pagination.page >= data.pagination.totalPages" aria-label="下一页" @click="changePage(data.pagination.page + 1)"><IconArrowRight :size="15" /></button></div></footer>
          </section>

          <section class="conversation-detail-column">
            <div v-if="!selected" class="conversation-detail-placeholder"><span><IconLock :size="24" /></span><strong>选择一条审计记录</strong><p>列表只显示脱敏元数据。选择记录后仍需填写查看原因，才能打开合成的演示轮次。</p></div>
            <template v-else>
              <header class="conversation-detail-header"><div><span class="capture-state" :class="selected.state">{{ stateText[selected.state] }}</span><h2>{{ selected.person.name }} · {{ selected.purpose.label }}</h2><code>{{ selected.requestId }}</code></div><button class="icon-button" aria-label="关闭记录" @click="closeSelection"><IconX :size="18" /></button></header>
              <div v-if="!access" class="conversation-access-gate"><span class="access-lock"><IconLock :size="23" /></span><h3>{{ selected.contentAccess.available ? '填写原因后查看脱敏轮次' : '该记录没有可访问正文' }}</h3><p v-if="selected.contentAccess.available">每次查看都应写入不可删除的访问审计。当前仅验证交互门禁，演示原因不会持久化，也不会解密真实内容。</p><p v-else>{{ selected.state === 'expired' ? '内容已到期，页面不允许恢复或查看。' : '该请求未命中采集策略，只保存调用元数据。' }}</p>
                <template v-if="selected.contentAccess.available"><label class="reason-field"><span>查看原因 <em>至少 8 个字符</em></span><textarea v-model="reason" maxlength="200" rows="4" placeholder="例如：复核客户投诉关联请求与脱敏结果" /></label><label class="access-ack"><input v-model="acknowledged" type="checkbox" /><span>我确认仅为获准的排障或合规复核查看，并知晓当前为 DEMO。</span></label><p v-if="accessError" class="form-error">{{ accessError }}</p><button class="btn access-submit" :disabled="!canOpen" @click="openContent"><IconEye :size="16" />{{ isOpening ? '正在打开…' : '打开脱敏轮次' }}</button></template>
                <div class="access-facts"><span><small>采集策略</small><strong>{{ selected.policy.label }}</strong></span><span><small>策略范围</small><strong>{{ selected.policy.scope }}</strong></span><span><small>到期时间</small><strong>{{ dateTime(selected.policy.expiresAt) }}</strong></span><span><small>归组依据</small><strong>{{ selected.grouping.label }}</strong></span></div>
              </div>
              <div v-else class="conversation-content"><div class="conversation-demo-warning"><IconAlertTriangle :size="17" /><div><strong>合成演示内容 · 未解密真实正文</strong><p>{{ access.meta.notice }}</p></div></div><header class="conversation-content-header"><div><h3>{{ access.content.conversationTitle }}</h3><p>{{ access.record.metrics.turns }} 轮 · {{ access.record.metrics.toolCalls }} 次工具 · {{ access.record.metrics.totalTokens.toLocaleString('zh-CN') }} Token</p></div><span :class="{ warning: !access.content.redactionPassed }">{{ access.content.redactionPassed ? '脱敏通过' : '需要复核' }}</span></header>
                <div class="conversation-message-list"><article v-for="message in access.content.messages" :key="message.id" class="conversation-message" :class="message.role"><header><span><IconTool v-if="message.role === 'tool'" :size="14" /><IconUser v-else-if="message.role === 'user'" :size="14" /><IconMessageCircle v-else :size="14" />{{ message.label }}</span><small>{{ dateTime(message.occurredAt) }}</small></header><p>{{ message.text }}</p><div v-if="message.redactionLabels.length" class="redaction-tags"><span v-for="label in message.redactionLabels" :key="label"><IconShieldCheck :size="12" />已脱敏：{{ label }}</span></div><div v-if="message.tool" class="tool-summary"><strong>{{ message.tool.name }}</strong><p>{{ message.tool.summary }}</p><small>参数与原始输出不可用</small></div></article></div>
                <section class="conversation-retention"><IconClock :size="17" /><div><strong>计划于 {{ dateTime(access.retention.expiresAt) }} 到期</strong><p>{{ access.retention.notice }}</p></div></section><footer class="conversation-content-actions"><span>访问记录 {{ access.access.accessRecordId }} · 未持久化</span><button class="btn btn-white" disabled>复制</button><button class="btn btn-white" disabled>导出</button><button class="btn danger" disabled><IconBan :size="15" />删除</button></footer>
              </div>
            </template>
          </section>
        </div>
      </section>
      <footer class="page-footer">数据来源：DEMO · 默认关闭采集 · 原始正文永不返回 · 仅超级管理员路由可见 · 复制、导出、删除均禁用</footer>
    </template>
  </div>
</template>
