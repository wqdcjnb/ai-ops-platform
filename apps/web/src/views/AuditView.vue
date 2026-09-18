<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  IconAlertTriangle, IconArrowLeft, IconArrowRight, IconBan, IconChevronRight, IconCircleCheck,
  IconDatabase, IconDownload, IconFingerprint, IconHistory, IconLock, IconRefresh, IconSearch, IconShieldLock, IconUser, IconX,
} from '@tabler/icons-vue'
import { AuditApiError, fetchAuditDetail, fetchAuditEvents, type AuditDetail, type AuditEvent, type AuditFilters, type AuditResponse } from '../audit-api'
import { useDebouncedSearch } from '../composables/useDebouncedSearch'

const audit = ref<AuditResponse | null>(null)
const detail = ref<AuditDetail | null>(null)
const initialQuery = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search)
function linkedAuditEventFromLocation() {
  const value = initialQuery?.get('eventId')?.trim() ?? ''
  return /^audit-[a-z0-9-]{1,80}$/.test(value) ? value : ''
}
function initialSearchFromLocation() {
  const value = initialQuery?.get('search')?.trim() ?? ''
  return value.length <= 80 ? value : ''
}
function initialResourceFromLocation(): AuditFilters['resource'] {
  const value = initialQuery?.get('resource') ?? 'all'
  return ['all', 'session', 'authorization', 'person', 'key', 'quota', 'route', 'channel', 'upstream', 'export', 'settings', 'alert', 'conversation'].includes(value)
    ? value as AuditFilters['resource']
    : 'all'
}
type LinkedAuditOrigin = 'alert_action' | 'direct'
function linkedAuditOriginFromLocation(): LinkedAuditOrigin { return initialQuery?.get('origin') === 'alert_action' ? 'alert_action' : 'direct' }
const period = ref<AuditFilters['period']>('7d')
const search = ref(initialSearchFromLocation())
const eventId = ref(linkedAuditEventFromLocation())
const linkedAuditOrigin = ref<LinkedAuditOrigin>(linkedAuditOriginFromLocation())
const actor = ref('all')
const action = ref<AuditFilters['action']>('all')
const resource = ref<AuditFilters['resource']>(initialResourceFromLocation())
const result = ref<AuditFilters['result']>('all')
const source = ref<AuditFilters['source']>('all')
const page = ref(1)
const pageSize = 10
const isLoading = ref(false)
const detailLoadingId = ref('')
const errorMessage = ref('')
let request: AbortController | undefined
let detailRequest: AbortController | undefined

const resultText = { success: '成功', failed: '失败', denied: '已拒绝' }
const resourceText = { session: '会话', authorization: '权限校验', person: '人员', key: 'Key', quota: '额度', route: '路由', channel: '模型渠道', upstream: '上游账号', export: '导出', settings: '设置', alert: '告警', conversation: '对话审计' }
const roleText = { super_admin: '超级管理员', admin: '管理员', department_lead: '部门负责人', finance: '财务', employee: '员工', system: '系统任务' }
const updatedAt = computed(() => audit.value ? timeText(audit.value.meta.generatedAt) : '—')
const sourceLabel = computed(() => audit.value?.meta.source === 'database' ? 'SQLite · 模拟数据' : '演示数据')
const detailSourceLabel = computed(() => detail.value?.meta.source === 'database' ? 'SQLite · 模拟数据' : '演示数据')
const hasLinkedAuditEvent = computed(() => Boolean(eventId.value))
const linkedAuditMessage = computed(() => linkedAuditOrigin.value === 'alert_action' ? '正在显示本次告警处置的审计记录' : '正在显示关联审计记录')
const summaryCards = computed(() => {
  const value = audit.value?.summary
  return [
    { label: '审计事件', value: value?.total ?? '—', hint: '当前筛选范围', icon: IconHistory, tone: 'teal' },
    { label: '操作成功', value: value?.success ?? '—', hint: '已完成的操作', icon: IconCircleCheck, tone: 'green' },
    { label: '执行失败', value: value?.failed ?? '—', hint: '服务或依赖异常', icon: IconAlertTriangle, tone: 'red' },
    { label: '权限拒绝', value: value?.denied ?? '—', hint: '被安全边界阻止', icon: IconBan, tone: 'amber' },
    { label: '敏感变更', value: value?.sensitiveChanges ?? '—', hint: '仅记录“已变化”', icon: IconLock, tone: 'violet' },
  ]
})

function currentFilters(): AuditFilters { return { period: period.value, search: search.value.trim(), eventId: eventId.value, actor: actor.value, action: action.value, resource: resource.value, result: result.value, source: source.value, page: page.value, pageSize } }
function timeText(value: string) { return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)) }
function applyFilters() { cancelSearch(); page.value = 1; void loadData() }
function removeLinkedAuditQuery() {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  params.delete('eventId'); params.delete('origin'); params.delete('search'); params.delete('resource')
  window.history.replaceState({}, '', `${window.location.pathname}${params.size ? `?${params}` : ''}${window.location.hash}`)
}
function clearLinkedAuditFilter() { eventId.value = ''; linkedAuditOrigin.value = 'direct'; removeLinkedAuditQuery(); applyFilters() }
function clearFilters() { period.value = '7d'; search.value = ''; eventId.value = ''; linkedAuditOrigin.value = 'direct'; actor.value = 'all'; action.value = 'all'; resource.value = 'all'; result.value = 'all'; source.value = 'all'; removeLinkedAuditQuery(); applyFilters() }
function changePage(next: number) { if (!audit.value || next < 1 || next > audit.value.pagination.totalPages) return; page.value = next; void loadData() }

async function loadData() {
  request?.abort()
  const next = new AbortController()
  request = next; isLoading.value = true; errorMessage.value = ''
  try { audit.value = await fetchAuditEvents(currentFilters(), next.signal) }
  catch (error) { if (next.signal.aborted) return; const requestId = error instanceof AuditApiError ? error.requestId : undefined; errorMessage.value = `${error instanceof Error ? error.message : '审计日志暂时无法加载'}${requestId ? ` · 请求 ID ${requestId}` : ''}` }
  finally { if (request === next) isLoading.value = false }
}

async function openDetail(item: AuditEvent) {
  detailRequest?.abort()
  const next = new AbortController()
  detailRequest = next; detailLoadingId.value = item.id
  try { detail.value = await fetchAuditDetail(item.id, next.signal) }
  catch (error) { if (!next.signal.aborted) errorMessage.value = error instanceof Error ? error.message : '审计详情暂时无法加载' }
  finally { if (detailRequest === next) detailLoadingId.value = '' }
}

const { cancel: cancelSearch } = useDebouncedSearch(search, () => { page.value = 1; void loadData() })

onMounted(() => void loadData())
onBeforeUnmount(() => { request?.abort(); detailRequest?.abort() })
</script>

<template>
  <div class="dashboard audit-dashboard">
    <section class="page-heading"><div><div class="eyebrow">AUDIT TRAIL</div><h1>审计日志</h1><p>按请求 ID 复核管理员操作、配置变化、权限拒绝与执行结果。</p></div><div class="heading-actions"><span class="updated-at">更新于 {{ updatedAt }}</span><button class="btn btn-white refresh-button" :disabled="isLoading" @click="loadData"><IconRefresh :size="17" :class="{ spinning: isLoading }" />刷新</button><button class="btn" disabled title="异步导出、授权和导出审计完成后开放"><IconDownload :size="16" />导出审计</button></div></section>
    <div v-if="audit" class="source-banner"><span>{{ sourceLabel }}</span>{{ audit.meta.notice }}</div>
    <div v-if="hasLinkedAuditEvent" class="audit-related-filter" role="status"><span><IconFingerprint :size="15" />{{ linkedAuditMessage }}</span><button class="text-button" type="button" aria-label="清除告警处置审计关联" @click="clearLinkedAuditFilter">清除关联</button></div>
    <section class="audit-summary-grid" aria-label="审计汇总"><article v-for="card in summaryCards" :key="card.label" class="metric-card"><div class="metric-top"><span class="metric-label">{{ card.label }}</span><span class="metric-icon" :class="`tone-${card.tone}`"><component :is="card.icon" :size="19" /></span></div><strong class="metric-value">{{ card.value }}</strong><div class="metric-foot">{{ card.hint }}</div></article></section>

    <div v-if="!audit && !errorMessage" class="panel data-state"><div class="state-icon"><IconRefresh :size="22" class="spinning" /></div><div><strong>正在读取审计事件</strong><p>正在加载操作者、资源、请求链路与字段变化摘要…</p></div></div>
    <div v-else-if="errorMessage && !audit" class="panel data-state failed"><div class="state-icon"><IconAlertTriangle :size="22" /></div><div><strong>审计日志加载失败</strong><p>{{ errorMessage }}</p></div><button class="btn btn-white" @click="loadData">重试</button></div>

    <template v-else-if="audit">
      <section class="audit-integrity-banner"><span><IconShieldLock :size="19" /></span><div><strong>{{ audit.integrity.verified ? '本地完整性校验通过' : '本地完整性校验失败' }}</strong><p>{{ audit.integrity.notice }}</p></div><div><em><IconDatabase :size="14" />{{ audit.integrity.eventCount }} 条已检查</em><em><IconLock :size="14" />{{ audit.integrity.checkpointVerified ? '检查点匹配' : '检查点不一致' }}</em></div></section>

      <section class="panel audit-main-panel"><header class="panel-header"><div><span class="panel-title">操作事件</span><span class="panel-subtitle">登录、退出、访问拒绝、人员、Key、额度、路由、导出、告警、对话查看与管理配置</span></div><span class="source-tag" :class="audit.meta.source">{{ sourceLabel }}</span></header>
        <form class="audit-filters" @submit.prevent="applyFilters"><label class="audit-search"><IconSearch :size="15" /><input v-model="search" aria-label="搜索审计事件" maxlength="80" type="search" placeholder="请求 ID、事件 ID、操作人、对象或摘要" /></label><label><select v-model="period" aria-label="审计时间范围" @change="applyFilters"><option value="today">今天</option><option value="7d">近 7 天</option><option value="30d">近 30 天</option></select></label><label><IconUser :size="14" /><select v-model="actor" aria-label="审计操作人" @change="applyFilters"><option value="all">全部操作人</option><option v-for="option in audit.options.actors" :key="option.id" :value="option.id">{{ option.label }}</option></select></label><label><select v-model="action" aria-label="审计动作" @change="applyFilters"><option value="all">全部动作</option><option value="login">登录</option><option value="logout">退出登录</option><option value="access">访问拒绝</option><option value="create">创建</option><option value="update">更新</option><option value="disable">停用</option><option value="rotate">轮换</option><option value="export">导出</option><option value="acknowledge">确认</option><option value="verify">验证连接</option><option value="view">查看</option></select></label><label><select v-model="resource" aria-label="审计对象" @change="applyFilters"><option value="all">全部对象</option><option value="session">会话</option><option value="authorization">权限校验</option><option value="person">人员</option><option value="key">Key</option><option value="quota">额度</option><option value="route">路由</option><option value="channel">模型渠道</option><option value="upstream">上游账号</option><option value="export">导出</option><option value="settings">设置</option><option value="alert">告警</option><option value="conversation">对话审计</option></select></label><label><select v-model="result" aria-label="审计结果" @change="applyFilters"><option value="all">全部结果</option><option value="success">成功</option><option value="failed">失败</option><option value="denied">已拒绝</option></select></label><label><select v-model="source" aria-label="审计来源" @change="applyFilters"><option value="all">全部来源</option><option value="web">管理页面</option><option value="api">管理接口</option><option value="system">系统任务</option></select></label><button class="btn filter-submit" type="submit">查询</button><button class="text-button" type="button" @click="clearFilters">清除</button></form>

        <div v-if="audit.items.length" class="table-responsive"><table class="data-table audit-table"><thead><tr><th>时间 / 事件</th><th>操作人</th><th>动作</th><th>对象</th><th>变更摘要</th><th>来源</th><th>请求 ID</th><th>结果</th><th /></tr></thead><tbody><tr v-for="item in audit.items" :key="item.id"><td><div class="audit-event-id"><strong>{{ timeText(item.occurredAt) }}</strong><code>{{ item.id }}</code></div></td><td><div class="audit-actor"><span>{{ item.actor.name.slice(0, 1) }}</span><div><strong>{{ item.actor.name }}</strong><small>{{ roleText[item.actor.role] }}</small></div></div></td><td><span class="audit-action">{{ item.actionLabel }}</span></td><td><div class="audit-resource"><strong>{{ item.resource.name }}</strong><small>{{ resourceText[item.resource.type] }} · {{ item.resource.id }}</small></div></td><td><div class="audit-summary"><p>{{ item.summary }}</p><small v-if="item.changes.length">{{ item.changes.length }} 个字段{{ item.changes.some((change) => change.sensitive) ? ' · 含敏感变化' : '' }}</small><small v-else>无字段变化</small></div></td><td><div class="audit-source"><strong>{{ item.source.label }}</strong><small>{{ item.source.ipMasked ?? '内部任务' }} · {{ item.source.client }}</small></div></td><td><code class="request-id">{{ item.requestId }}</code></td><td><span class="audit-result" :class="item.result.status"><i />{{ resultText[item.result.status] }}</span><small class="result-code">{{ item.result.code }}</small></td><td><button class="row-action enabled" :disabled="detailLoadingId === item.id" :aria-label="`查看 ${item.id} 审计详情`" @click="openDetail(item)"><IconRefresh v-if="detailLoadingId === item.id" :size="15" class="spinning" /><IconChevronRight v-else :size="17" /></button></td></tr></tbody></table></div>
        <div v-else class="people-empty"><IconFingerprint :size="25" /><strong>没有符合条件的审计事件</strong><span>调整日期、操作人、动作、对象、结果或来源。</span><button class="text-button" @click="clearFilters">清除筛选</button></div>
        <footer class="usage-pagination"><span>共 {{ audit.pagination.total }} 条 · 第 {{ audit.pagination.page }}/{{ Math.max(audit.pagination.totalPages, 1) }} 页</span><div><button :disabled="audit.pagination.page <= 1" aria-label="上一页" @click="changePage(audit.pagination.page - 1)"><IconArrowLeft :size="15" /></button><button :disabled="audit.pagination.page >= audit.pagination.totalPages" aria-label="下一页" @click="changePage(audit.pagination.page + 1)"><IconArrowRight :size="15" /></button></div></footer>
      </section>
      <footer class="page-footer">数据来源：{{ sourceLabel }} · 只展示字段级摘要 · 不保存完整 Key、认证信息、请求正文或对话正文 · 页面无删除入口</footer>
    </template>

    <div v-if="detail" class="drawer-backdrop" @click.self="detail = null"><aside class="model-drawer audit-drawer" role="dialog" aria-modal="true" aria-label="审计事件详情"><header><div><span class="source-tag" :class="detail.meta.source">{{ detailSourceLabel }}</span><h2>审计事件详情</h2></div><button class="icon-button" aria-label="关闭详情" @click="detail = null"><IconX :size="20" /></button></header>
      <section class="audit-drawer-hero"><span><IconFingerprint :size="21" /></span><div><span class="audit-result" :class="detail.event.result.status"><i />{{ resultText[detail.event.result.status] }}</span><strong>{{ detail.event.actionLabel }} · {{ detail.event.resource.name }}</strong><code>{{ detail.event.id }}</code></div><small>{{ timeText(detail.event.occurredAt) }}</small></section>
      <section class="drawer-section"><h3>操作上下文</h3><dl class="model-facts"><div><dt>操作人</dt><dd>{{ detail.event.actor.name }}</dd></div><div><dt>角色</dt><dd>{{ roleText[detail.event.actor.role] }}</dd></div><div><dt>资源类型</dt><dd>{{ resourceText[detail.event.resource.type] }}</dd></div><div><dt>目标 ID</dt><dd>{{ detail.event.resource.id }}</dd></div><div><dt>来源</dt><dd>{{ detail.event.source.label }}</dd></div><div><dt>客户端</dt><dd>{{ detail.event.source.client }}</dd></div><div><dt>请求 ID</dt><dd>{{ detail.request.requestId }}</dd></div><div><dt>结果码</dt><dd>{{ detail.request.responseCode }} · {{ detail.event.result.code }}</dd></div></dl><p class="audit-detail-summary">{{ detail.event.summary }}</p></section>
      <section v-if="detail.event.resource.type === 'alert'" class="drawer-section"><h3>关联告警</h3><div class="audit-linked-alert"><div><strong>关联的本地模拟告警</strong><p>按告警 ID 精确筛选，不返回其他告警。</p></div><a :href="`/alerts?alertId=${encodeURIComponent(detail.event.resource.id)}`" :aria-label="`查看 ${detail.event.resource.id} 关联告警`">查看告警<IconChevronRight :size="15" /></a></div></section>
      <section class="drawer-section"><h3>字段级变更</h3><div v-if="detail.event.changes.length" class="audit-change-list"><article v-for="change in detail.event.changes" :key="change.field" :class="{ sensitive: change.sensitive }"><header><strong>{{ change.label }}</strong><span v-if="change.sensitive"><IconLock :size="13" />敏感字段</span></header><div><span><small>变更前</small><em>{{ change.before ?? '—' }}</em></span><IconChevronRight :size="16" /><span><small>变更后</small><em>{{ change.after ?? '—' }}</em></span></div></article></div><div v-else class="drawer-empty">本事件没有字段变化。</div></section>
      <section class="drawer-section"><h3>请求关联</h3><div class="audit-request-card"><code>{{ detail.request.requestId }}</code><span>HTTP {{ detail.request.responseCode }} · {{ detail.request.durationMs }}ms</span><small>链路状态：{{ detail.request.traceState === 'database_unverified' ? 'SQLite 事件，真实 x-request-id 透传待验证' : '演示数据，尚未验证真实 x-request-id 透传' }}</small></div><div v-if="detail.relatedAuditIds.length" class="related-requests"><code v-for="id in detail.relatedAuditIds" :key="id">{{ id }}</code></div></section>
      <section class="audit-integrity-detail"><IconShieldLock :size="19" /><div><strong>{{ detail.integrity.verified ? '本地完整性校验通过' : '本地完整性校验失败' }}</strong><p>{{ detail.integrity.notice }}</p><small>删除：禁止 · 追加写入：待验证 · 哈希链：{{ detail.integrity.hashChainVerified ? `已校验 ${detail.integrity.eventCount} 条` : '未通过' }} · 检查点：{{ detail.integrity.checkpointVerified ? '匹配' : '不一致' }}</small></div></section>
      <footer class="drawer-actions"><button class="btn btn-white" disabled><IconDownload :size="16" />导出此事件</button><button class="btn" disabled><IconHistory :size="16" />查看完整链路</button></footer>
    </aside></div>
  </div>
</template>
