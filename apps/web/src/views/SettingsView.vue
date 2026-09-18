<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { IconAlertTriangle, IconArchive, IconBuilding, IconCheck, IconChevronRight, IconClock, IconDatabase, IconEdit, IconEye, IconHistory, IconKey, IconLock, IconRefresh, IconRestore, IconServer2, IconSettings, IconShieldCheck, IconSwitch, IconUsers, IconX } from '@tabler/icons-vue'
import { createBusinessRuleDraft, fetchSettings, previewBusinessRules, publishBusinessRuleVersion, rollbackBusinessRuleVersion, SettingsApiError, type BusinessRulePreview, type BusinessRuleVersion, type SettingsResponse, type SettingsSection } from '../settings-api'

const settings = ref<SettingsResponse | null>(null)
const activeSection = ref<SettingsSection>('organization')
const isLoading = ref(false)
const errorMessage = ref('')
let request: AbortController | undefined
const businessEditorMode = ref<'edit' | 'publish' | 'rollback' | null>(null)
const businessValues = ref<Record<string, string>>({})
const businessPreview = ref<BusinessRulePreview | null>(null)
const businessTarget = ref<BusinessRuleVersion | null>(null)
const businessReason = ref('')
const businessError = ref('')
const businessSuccess = ref('')
const isBusinessWorking = ref(false)

const sectionItems = [
  { id: 'organization' as const, label: '组织与角色', hint: '数据范围与权限', icon: IconUsers },
  { id: 'business' as const, label: '业务口径', hint: '草稿与版本审计', icon: IconSettings },
  { id: 'connections' as const, label: '服务连接', hint: '地址与验证状态', icon: IconServer2 },
  { id: 'retention' as const, label: '数据留存', hint: '最短必要期限', icon: IconClock },
  { id: 'features' as const, label: '功能开关', hint: '未验收能力关闭', icon: IconSwitch },
  { id: 'backup' as const, label: '备份状态', hint: '校验与恢复演练', icon: IconArchive },
]
const serviceStateText = { ready: '已就绪', reachable: '可达', auth_required: '认证异常', offline: '离线' }
const updatedAt = computed(() => settings.value ? dateTime(settings.value.meta.generatedAt) : '—')
const summaryCards = computed(() => {
  const value = settings.value?.summary
  return [
    { label: '设置分区', value: value?.sections ?? '—', hint: '业务口径支持本地版本', icon: IconSettings, tone: 'teal' },
    { label: '角色定义', value: value?.roles ?? '—', hint: '全局到本人数据范围', icon: IconUsers, tone: 'blue' },
    { label: '服务在线', value: value ? `${value.servicesOnline}/${value.servicesTotal}` : '—', hint: '实时连通探测', icon: IconServer2, tone: 'green' },
    { label: '高风险功能', value: value?.enabledFeatures ?? '—', hint: '当前启用数量', icon: IconLock, tone: 'amber' },
  ]
})
function dateTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)) }
async function loadData() { request?.abort(); const next = new AbortController(); request = next; isLoading.value = true; errorMessage.value = ''; try { settings.value = await fetchSettings(next.signal) } catch (error) { if (next.signal.aborted) return; const requestId = error instanceof SettingsApiError ? error.requestId : undefined; errorMessage.value = `${error instanceof Error ? error.message : '系统设置暂时无法加载'}${requestId ? ` · 请求 ID ${requestId}` : ''}` } finally { if (request === next) isLoading.value = false } }
function openBusinessEditor() {
  if (!settings.value) return
  const source = settings.value.businessRules.draft?.items ?? settings.value.businessRules.items
  businessValues.value = Object.fromEntries(source.map((item) => [item.id, item.value]))
  businessPreview.value = null
  businessTarget.value = null
  businessReason.value = ''
  businessError.value = ''
  businessSuccess.value = ''
  businessEditorMode.value = 'edit'
}
function openBusinessAction(mode: 'publish' | 'rollback', version: BusinessRuleVersion) {
  businessTarget.value = version
  businessEditorMode.value = mode
  businessReason.value = ''
  businessError.value = ''
  businessSuccess.value = ''
}
function closeBusinessEditor() { if (!isBusinessWorking.value) businessEditorMode.value = null }
async function previewBusinessEditor() {
  if (!settings.value) return
  businessError.value = ''
  try { businessPreview.value = await previewBusinessRules(Object.entries(businessValues.value).map(([id, value]) => ({ id, value }))) } catch (error) { businessError.value = error instanceof Error ? error.message : '业务口径预览失败' }
}
async function saveBusinessDraft() {
  if (!businessPreview.value || businessReason.value.trim().length < 8) return
  isBusinessWorking.value = true; businessError.value = ''
  try {
    const result = await createBusinessRuleDraft(Object.entries(businessValues.value).map(([id, value]) => ({ id, value })), businessReason.value.trim(), `settings-business-draft-${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`)
    businessSuccess.value = `草稿 ${result.version.version} 已保存；尚未改变当前生效口径。`
    await loadData()
  } catch (error) { businessError.value = error instanceof Error ? error.message : '本地草稿保存失败' } finally { isBusinessWorking.value = false }
}
async function submitBusinessAction() {
  if (!businessTarget.value || businessReason.value.trim().length < 8) return
  isBusinessWorking.value = true; businessError.value = ''
  const action = businessEditorMode.value
  try {
    const key = `settings-business-${action}-${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`
    const result = action === 'publish'
      ? await publishBusinessRuleVersion(businessTarget.value.id, businessReason.value.trim(), key)
      : await rollbackBusinessRuleVersion(businessTarget.value.id, businessReason.value.trim(), key)
    businessSuccess.value = `${action === 'publish' ? '版本已发布' : '版本已回滚'}：${result.version.version}`
    businessEditorMode.value = null
    await loadData()
  } catch (error) { businessError.value = error instanceof Error ? error.message : '本地版本操作失败' } finally { isBusinessWorking.value = false }
}
onMounted(() => void loadData())
onBeforeUnmount(() => request?.abort())
</script>

<template>
  <div class="dashboard settings-dashboard">
    <section class="page-heading"><div><div class="eyebrow">SYSTEM CONFIGURATION</div><h1>系统设置</h1><p>集中查看权限范围、全站口径、服务连接、留存策略和上线安全门槛。</p></div><div class="heading-actions"><span class="updated-at">更新于 {{ updatedAt }}</span><button class="btn btn-white refresh-button" :disabled="isLoading" @click="loadData"><IconRefresh :size="17" :class="{ spinning: isLoading }" />刷新</button><button class="btn" @click="activeSection = 'business'"><IconEdit :size="16" />管理业务口径</button></div></section>
    <div v-if="settings" class="source-banner partial"><span>PARTIAL</span>{{ settings.meta.notice }}</div>
    <section class="settings-summary-grid" aria-label="系统设置汇总"><article v-for="card in summaryCards" :key="card.label" class="metric-card"><div class="metric-top"><span class="metric-label">{{ card.label }}</span><span class="metric-icon" :class="`tone-${card.tone}`"><component :is="card.icon" :size="19" /></span></div><strong class="metric-value">{{ card.value }}</strong><div class="metric-foot">{{ card.hint }}</div></article></section>

    <div v-if="!settings && !errorMessage" class="panel data-state"><div class="state-icon"><IconRefresh :size="22" class="spinning" /></div><div><strong>正在读取系统设置</strong><p>正在检查服务连接、配置口径、留存和安全开关…</p></div></div>
    <div v-else-if="errorMessage && !settings" class="panel data-state failed"><div class="state-icon"><IconAlertTriangle :size="22" /></div><div><strong>系统设置加载失败</strong><p>{{ errorMessage }}</p></div><button class="btn btn-white" @click="loadData">重试</button></div>

    <template v-else-if="settings">
      <section class="settings-security-banner"><span><IconShieldCheck :size="19" /></span><div><strong>当前为受保护的本地版本模式</strong><p>{{ settings.access.notice }}</p></div><div><em><IconEdit :size="14" />业务口径可写</em><em><IconLock :size="14" />其他设置只读</em></div></section>
      <section class="settings-workbench">
        <nav class="settings-section-nav" aria-label="设置分区"><header><strong>配置目录</strong><small>1 个可版本化分区 · 其余只读</small></header><button v-for="item in sectionItems" :key="item.id" :class="{ active: activeSection === item.id }" @click="activeSection = item.id"><span><component :is="item.icon" :size="17" /></span><div><strong>{{ item.label }}</strong><small>{{ item.hint }}</small></div><IconChevronRight :size="16" /></button></nav>

        <div class="settings-section-content">
          <section v-if="activeSection === 'organization'" class="panel settings-section-panel"><header class="settings-panel-heading"><div><span class="source-tag sqlite">SQLITE</span><h2>组织与角色</h2><p>SQLite 模拟组织 · {{ settings.organization.company }} · {{ settings.organization.departments }} 个部门 · {{ settings.organization.people }} 人</p></div><button class="btn btn-white" disabled>管理角色</button></header><div class="settings-role-table"><div class="settings-table-head"><span>角色</span><span>成员</span><span>数据范围</span><span>权限摘要</span><span>级别</span></div><article v-for="role in settings.organization.roles" :key="role.id"><span class="settings-role-name"><i>{{ role.name.slice(0, 1) }}</i><strong>{{ role.name }}</strong></span><span>{{ role.memberCount }} 人</span><span>{{ role.dataScope }}</span><span>{{ role.permissionSummary }}</span><span class="privilege-tag" :class="{ high: role.highPrivilege }">{{ role.highPrivilege ? '高权限' : '普通' }}</span></article></div><footer class="settings-section-note"><IconAlertTriangle :size="15" />组织、角色目录与人数均从 SQLite 模拟数据读取；真实高权限变更仍必须二次确认并写入操作审计。</footer></section>

          <section v-else-if="activeSection === 'business'" class="panel settings-section-panel"><header class="settings-panel-heading"><div><span class="source-tag sqlite">SQLITE</span><h2>业务口径</h2><p>当前生效 {{ settings.businessRules.version }} · 草稿、预览、发布、回滚均只写本地 SQLite</p></div><button class="btn" @click="openBusinessEditor"><IconEdit :size="15" />创建本地草稿</button></header><div v-if="businessSuccess" class="business-feedback success"><IconCheck :size="15" />{{ businessSuccess }}</div><div class="business-rule-grid"><article v-for="item in settings.businessRules.items" :key="item.id"><header><strong>{{ item.label }}</strong><span :class="item.status">{{ item.status === 'fixed' ? '已固定' : '待验证' }}</span></header><p>{{ item.value }}</p><small>影响：{{ item.impact }}</small></article></div><section class="business-version-panel"><header><div><strong>版本历史</strong><small>发布和回滚会写入操作审计；原因只保留长度，不保存原文。</small></div><span>{{ settings.businessRules.versions.length }} 个版本</span></header><article v-for="version in settings.businessRules.versions" :key="version.id" :class="{ current: version.isCurrent }"><div><strong>{{ version.version }}</strong><span class="business-version-status" :class="version.status">{{ version.isCurrent ? '当前生效' : version.status === 'draft' ? '草稿' : '历史版本' }}</span><small>{{ version.note }} · {{ dateTime(version.createdAt) }}</small></div><div class="business-version-actions"><button v-if="version.status === 'draft'" class="btn btn-white" @click="openBusinessEditor"><IconEdit :size="14" />继续编辑</button><button v-if="version.status === 'draft'" class="btn" @click="openBusinessAction('publish', version)"><IconCheck :size="14" />发布</button><button v-if="!version.isCurrent && version.status !== 'draft'" class="btn btn-white" @click="openBusinessAction('rollback', version)"><IconRestore :size="14" />回滚</button></div></article></section><footer class="settings-section-note"><IconShieldCheck :size="15" />仅业务口径允许本地版本写入；不会调用真实财务、网关或 New API 配置。</footer></section>

          <section v-else-if="activeSection === 'connections'" class="panel settings-section-panel"><header class="settings-panel-heading"><div><span class="source-tag live">LIVE</span><h2>服务连接</h2><p>状态与检查时间来自 BFF 实时探测，浏览器不接收凭据内容。</p></div><button class="btn btn-white" disabled>验证全部</button></header><div class="settings-connection-grid"><article v-for="service in settings.connections.items" :key="service.id"><header><span><IconServer2 :size="17" /></span><div><strong>{{ service.name }}</strong><small>{{ service.category }}</small></div><em class="service-state" :class="service.state"><i />{{ serviceStateText[service.state] }}</em></header><code>{{ service.url }}</code><p>{{ service.detail }}</p><footer><span>凭据：{{ service.credentialConfigured ? '已配置' : '未配置/无需配置' }}</span><span>检查于 {{ dateTime(service.checkedAt) }}</span></footer></article></div><section class="credential-boundary"><IconKey :size="17" /><div><strong>凭据只通过受保护的部署环境配置</strong><p>接口仅返回是否配置与验证状态；完整 API Key、OAuth Token 和管理密钥不会进入页面或网络响应。</p></div></section></section>

          <section v-else-if="activeSection === 'retention'" class="panel settings-section-panel"><header class="settings-panel-heading"><div><span class="source-tag sqlite">SQLITE</span><h2>数据留存</h2><p>SQLite 模拟策略采用最短必要期限；仅合成对话元数据具备启动时到期状态处理。</p></div><button class="btn btn-white" disabled>调整留存</button></header><div class="retention-list"><article v-for="item in settings.retention.items" :key="item.id"><span class="retention-days"><strong>{{ item.days }}</strong><small>天</small></span><div><strong>{{ item.label }}</strong><p>{{ item.appliesTo }}</p></div><span class="cleanup-state">{{ item.cleanupState === 'not_configured' ? '清理未配置' : '清理待验证' }}</span></article></div><section class="retention-job-card"><span><IconClock :size="18" /></span><div><strong>合成对话元数据到期状态</strong><p>{{ settings.retention.syntheticMetadataExpiry.notice }}</p></div><em>启动时检查</em><footer><span><small>本地无正文证明</small><strong>{{ settings.retention.syntheticMetadataExpiry.proofRecords }} 条</strong></span><span><small>最近检查</small><strong>{{ settings.retention.syntheticMetadataExpiry.lastRun ? dateTime(settings.retention.syntheticMetadataExpiry.lastRun.completedAt) : '暂无到期记录' }}</strong></span><span><small>真实正文清理</small><strong>未接入</strong></span></footer></section><footer class="settings-section-note"><IconAlertTriangle :size="15" />只读策略已保存至 SQLite；该状态只说明合成元数据到期与未存正文，不包含真实清理、删除影响预览或真实删除证明。</footer></section>

          <section v-else-if="activeSection === 'features'" class="panel settings-section-panel"><header class="settings-panel-heading"><div><span class="source-tag sqlite">SQLITE</span><h2>功能开关</h2><p>SQLite 模拟配置中未验收的能力统一保持关闭。</p></div><button class="btn btn-white" disabled>管理开关</button></header><div class="feature-flag-list"><article v-for="feature in settings.features.items" :key="feature.id"><span class="feature-icon"><IconSwitch :size="17" /></span><div><strong>{{ feature.label }}</strong><p>{{ feature.reason }}</p></div><span class="risk-tag" :class="feature.risk">{{ feature.risk === 'high' ? '高风险' : feature.risk === 'medium' ? '中风险' : '低风险' }}</span><span class="readonly-switch" :class="{ on: feature.enabled }" role="switch" :aria-checked="feature.enabled" aria-disabled="true"><i /></span><em>{{ feature.enabled ? '已开启' : '已关闭' }}</em></article></div><footer class="settings-section-note success"><IconCheck :size="15" />当前 5 项未验收能力均由服务端 SQLite 配置保持关闭，前端不提供绕过入口。</footer></section>

          <section v-else class="panel settings-section-panel"><header class="settings-panel-heading"><div><span class="source-tag sqlite">SQLITE</span><h2>备份状态</h2><p>SQLite 安全状态元数据只读展示，不允许从浏览器下载数据库。</p></div><button class="btn btn-white" disabled><IconRestore :size="15" />发起恢复演练</button></header><div class="backup-empty"><span><IconArchive :size="27" /></span><h3>尚未配置平台数据库备份</h3><p>{{ settings.backup.notice }}</p><div><article><small>存储目标</small><strong>{{ settings.backup.storageTargetConfigured ? '已配置' : '未配置' }}</strong></article><article><small>最近备份</small><strong>{{ settings.backup.lastBackupAt ? dateTime(settings.backup.lastBackupAt) : '无记录' }}</strong></article><article><small>最近校验</small><strong>{{ settings.backup.lastVerifiedAt ? dateTime(settings.backup.lastVerifiedAt) : '无记录' }}</strong></article><article><small>恢复演练</small><strong>{{ settings.backup.lastRestoreDrillAt ? dateTime(settings.backup.lastRestoreDrillAt) : '无记录' }}</strong></article></div><button class="btn" disabled>配置受保护备份作业</button></div><footer class="settings-section-note"><IconDatabase :size="15" />备份安全状态已保存至 SQLite；备份文件、数据库、密钥和认证资料不得通过浏览器直接下载。</footer></section>
        </div>
      </section>
      <footer class="page-footer">数据来源：服务状态 LIVE；组织、业务口径、开关、留存与备份状态为 SQLite 模拟配置 · 仅业务口径支持受保护的本地版本操作</footer>
    </template>
    <div v-if="businessEditorMode" class="drawer-backdrop" @click.self="closeBusinessEditor"><aside class="model-drawer settings-business-dialog" role="dialog" aria-modal="true" aria-label="业务口径本地版本管理"><header><div><span class="source-tag sqlite">本地 SQLite</span><h2>{{ businessEditorMode === 'edit' ? '编辑业务口径草稿' : businessEditorMode === 'publish' ? '发布业务口径版本' : '回滚业务口径版本' }}</h2></div><button class="icon-button" aria-label="关闭业务口径窗口" :disabled="isBusinessWorking" @click="closeBusinessEditor"><IconX :size="19" /></button></header><template v-if="businessEditorMode === 'edit'"><p class="settings-dialog-copy">修改后先预览差异，再保存草稿。当前生效版本不会被直接覆盖。</p><div class="business-edit-fields"><label v-for="item in settings?.businessRules.items ?? []" :key="item.id"><span>{{ item.label }}<small>{{ item.impact }}</small></span><input v-model.trim="businessValues[item.id]" :aria-label="item.label" maxlength="240" /></label></div><button class="btn btn-white settings-preview-button" :disabled="isBusinessWorking" @click="previewBusinessEditor"><IconEye :size="15" />{{ businessPreview ? `已预览 ${businessPreview.changedCount} 项变更` : '预览变更' }}</button><div v-if="businessPreview" class="business-preview"><header><strong>预览 {{ businessPreview.baseVersion }} → 草稿</strong><span>{{ businessPreview.changedCount }} 项变更</span></header><article v-for="change in businessPreview.changes" :key="change.id"><strong>{{ change.label }}</strong><span>{{ change.before }}</span><IconChevronRight :size="13" /><span class="after">{{ change.after }}</span></article><p v-if="businessPreview.changedCount === 0">当前没有字段变化，可以直接关闭窗口。</p></div><label class="settings-reason-field"><span>变更原因 <em>至少 8 个字符，仅记录长度</em></span><textarea v-model.trim="businessReason" rows="3" maxlength="200" placeholder="例如：统一新财年业务账期口径" /></label><label class="settings-ack"><input type="checkbox" checked disabled /><span>我确认：这只会保存 SQLite 草稿，并写入不含原因原文的审计摘要。</span></label><p v-if="businessError" class="settings-dialog-error">{{ businessError }}</p><p v-if="businessSuccess" class="settings-dialog-success">{{ businessSuccess }}</p><footer><button class="btn btn-white" type="button" :disabled="isBusinessWorking" @click="closeBusinessEditor">取消</button><button class="btn" type="button" :disabled="isBusinessWorking || !businessPreview || businessReason.trim().length < 8 || businessPreview.changedCount === 0" @click="saveBusinessDraft"><IconCheck :size="15" />{{ isBusinessWorking ? '保存中…' : '保存草稿' }}</button></footer></template><template v-else><div class="settings-action-target"><IconHistory :size="21" /><strong>{{ businessTarget?.version }}</strong><p>{{ businessEditorMode === 'publish' ? '发布后该版本会成为当前生效口径，旧版本保留以便回滚。' : '回滚后该历史版本会成为当前生效口径，当前版本仍保留在审计历史。' }}</p></div><label class="settings-reason-field"><span>操作原因 <em>至少 8 个字符，仅记录长度</em></span><textarea v-model.trim="businessReason" rows="4" maxlength="200" placeholder="例如：经评审确认，需要恢复上一版业务口径" /></label><label class="settings-ack"><input type="checkbox" checked disabled /><span>我确认：这只会改变本地 SQLite 业务口径，不会触达真实配置中心。</span></label><p v-if="businessError" class="settings-dialog-error">{{ businessError }}</p><footer><button class="btn btn-white" type="button" :disabled="isBusinessWorking" @click="closeBusinessEditor">取消</button><button class="btn" type="button" :disabled="isBusinessWorking || businessReason.trim().length < 8" @click="submitBusinessAction"><IconCheck :size="15" />{{ isBusinessWorking ? '提交中…' : businessEditorMode === 'publish' ? '确认发布' : '确认回滚' }}</button></footer></template></aside></div>
  </div>
</template>
