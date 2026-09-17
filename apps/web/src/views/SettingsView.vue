<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { IconAlertTriangle, IconArchive, IconBuilding, IconCheck, IconChevronRight, IconClock, IconDatabase, IconEdit, IconKey, IconLock, IconRefresh, IconRestore, IconServer2, IconSettings, IconShieldCheck, IconSwitch, IconUsers } from '@tabler/icons-vue'
import { fetchSettings, SettingsApiError, type SettingsResponse, type SettingsSection } from '../settings-api'

const settings = ref<SettingsResponse | null>(null)
const activeSection = ref<SettingsSection>('organization')
const isLoading = ref(false)
const errorMessage = ref('')
let request: AbortController | undefined

const sectionItems = [
  { id: 'organization' as const, label: '组织与角色', hint: '数据范围与权限', icon: IconUsers },
  { id: 'business' as const, label: '业务口径', hint: '时区、账期与计费', icon: IconSettings },
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
    { label: '设置分区', value: value?.sections ?? '—', hint: '均为只读展示', icon: IconSettings, tone: 'teal' },
    { label: '角色定义', value: value?.roles ?? '—', hint: '全局到本人数据范围', icon: IconUsers, tone: 'blue' },
    { label: '服务在线', value: value ? `${value.servicesOnline}/${value.servicesTotal}` : '—', hint: '实时连通探测', icon: IconServer2, tone: 'green' },
    { label: '高风险功能', value: value?.enabledFeatures ?? '—', hint: '当前启用数量', icon: IconLock, tone: 'amber' },
  ]
})
function dateTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)) }
async function loadData() { request?.abort(); const next = new AbortController(); request = next; isLoading.value = true; errorMessage.value = ''; try { settings.value = await fetchSettings(next.signal) } catch (error) { if (next.signal.aborted) return; const requestId = error instanceof SettingsApiError ? error.requestId : undefined; errorMessage.value = `${error instanceof Error ? error.message : '系统设置暂时无法加载'}${requestId ? ` · 请求 ID ${requestId}` : ''}` } finally { if (request === next) isLoading.value = false } }
onMounted(() => void loadData())
onBeforeUnmount(() => request?.abort())
</script>

<template>
  <div class="dashboard settings-dashboard">
    <section class="page-heading"><div><div class="eyebrow">SYSTEM CONFIGURATION</div><h1>系统设置</h1><p>集中查看权限范围、全站口径、服务连接、留存策略和上线安全门槛。</p></div><div class="heading-actions"><span class="updated-at">更新于 {{ updatedAt }}</span><button class="btn btn-white refresh-button" :disabled="isLoading" @click="loadData"><IconRefresh :size="17" :class="{ spinning: isLoading }" />刷新</button><button class="btn" disabled title="服务端 RBAC、二次确认和审计完成后开放"><IconEdit :size="16" />编辑设置</button></div></section>
    <div v-if="settings" class="source-banner partial"><span>PARTIAL</span>{{ settings.meta.notice }}</div>
    <section class="settings-summary-grid" aria-label="系统设置汇总"><article v-for="card in summaryCards" :key="card.label" class="metric-card"><div class="metric-top"><span class="metric-label">{{ card.label }}</span><span class="metric-icon" :class="`tone-${card.tone}`"><component :is="card.icon" :size="19" /></span></div><strong class="metric-value">{{ card.value }}</strong><div class="metric-foot">{{ card.hint }}</div></article></section>

    <div v-if="!settings && !errorMessage" class="panel data-state"><div class="state-icon"><IconRefresh :size="22" class="spinning" /></div><div><strong>正在读取系统设置</strong><p>正在检查服务连接、配置口径、留存和安全开关…</p></div></div>
    <div v-else-if="errorMessage && !settings" class="panel data-state failed"><div class="state-icon"><IconAlertTriangle :size="22" /></div><div><strong>系统设置加载失败</strong><p>{{ errorMessage }}</p></div><button class="btn btn-white" @click="loadData">重试</button></div>

    <template v-else-if="settings">
      <section class="settings-security-banner"><span><IconShieldCheck :size="19" /></span><div><strong>当前为只读安全模式</strong><p>{{ settings.access.notice }}</p></div><div><em><IconLock :size="14" />写入已关闭</em><em><IconKey :size="14" />凭据值不回传</em></div></section>
      <section class="settings-workbench">
        <nav class="settings-section-nav" aria-label="设置分区"><header><strong>配置目录</strong><small>6 个只读分区</small></header><button v-for="item in sectionItems" :key="item.id" :class="{ active: activeSection === item.id }" @click="activeSection = item.id"><span><component :is="item.icon" :size="17" /></span><div><strong>{{ item.label }}</strong><small>{{ item.hint }}</small></div><IconChevronRight :size="16" /></button></nav>

        <div class="settings-section-content">
          <section v-if="activeSection === 'organization'" class="panel settings-section-panel"><header class="settings-panel-heading"><div><span class="source-tag sqlite">SQLITE</span><h2>组织与角色</h2><p>SQLite 模拟组织 · {{ settings.organization.company }} · {{ settings.organization.departments }} 个部门 · {{ settings.organization.people }} 人</p></div><button class="btn btn-white" disabled>管理角色</button></header><div class="settings-role-table"><div class="settings-table-head"><span>角色</span><span>成员</span><span>数据范围</span><span>权限摘要</span><span>级别</span></div><article v-for="role in settings.organization.roles" :key="role.id"><span class="settings-role-name"><i>{{ role.name.slice(0, 1) }}</i><strong>{{ role.name }}</strong></span><span>{{ role.memberCount }} 人</span><span>{{ role.dataScope }}</span><span>{{ role.permissionSummary }}</span><span class="privilege-tag" :class="{ high: role.highPrivilege }">{{ role.highPrivilege ? '高权限' : '普通' }}</span></article></div><footer class="settings-section-note"><IconAlertTriangle :size="15" />组织、角色目录与人数均从 SQLite 模拟数据读取；真实高权限变更仍必须二次确认并写入操作审计。</footer></section>

          <section v-else-if="activeSection === 'business'" class="panel settings-section-panel"><header class="settings-panel-heading"><div><span class="source-tag sqlite">SQLITE</span><h2>业务口径</h2><p>SQLite 模拟配置 · 版本 {{ settings.businessRules.version }} · 尚未完成财务和网关对账</p></div><button class="btn btn-white" disabled>创建新版本</button></header><div class="business-rule-grid"><article v-for="item in settings.businessRules.items" :key="item.id"><header><strong>{{ item.label }}</strong><span :class="item.status">{{ item.status === 'fixed' ? '已固定' : '待验证' }}</span></header><p>{{ item.value }}</p><small>影响：{{ item.impact }}</small></article></div><footer class="settings-section-note"><IconAlertTriangle :size="15" />只读模拟配置已保存至 SQLite；口径变更仍需版本化、影响范围展示、生效与回滚审计后才会开放。</footer></section>

          <section v-else-if="activeSection === 'connections'" class="panel settings-section-panel"><header class="settings-panel-heading"><div><span class="source-tag live">LIVE</span><h2>服务连接</h2><p>状态与检查时间来自 BFF 实时探测，浏览器不接收凭据内容。</p></div><button class="btn btn-white" disabled>验证全部</button></header><div class="settings-connection-grid"><article v-for="service in settings.connections.items" :key="service.id"><header><span><IconServer2 :size="17" /></span><div><strong>{{ service.name }}</strong><small>{{ service.category }}</small></div><em class="service-state" :class="service.state"><i />{{ serviceStateText[service.state] }}</em></header><code>{{ service.url }}</code><p>{{ service.detail }}</p><footer><span>凭据：{{ service.credentialConfigured ? '已配置' : '未配置/无需配置' }}</span><span>检查于 {{ dateTime(service.checkedAt) }}</span></footer></article></div><section class="credential-boundary"><IconKey :size="17" /><div><strong>凭据只通过受保护的部署环境配置</strong><p>接口仅返回是否配置与验证状态；完整 API Key、OAuth Token 和管理密钥不会进入页面或网络响应。</p></div></section></section>

          <section v-else-if="activeSection === 'retention'" class="panel settings-section-panel"><header class="settings-panel-heading"><div><span class="source-tag sqlite">SQLITE</span><h2>数据留存</h2><p>SQLite 模拟策略采用最短必要期限；仅合成对话元数据具备启动时到期状态处理。</p></div><button class="btn btn-white" disabled>调整留存</button></header><div class="retention-list"><article v-for="item in settings.retention.items" :key="item.id"><span class="retention-days"><strong>{{ item.days }}</strong><small>天</small></span><div><strong>{{ item.label }}</strong><p>{{ item.appliesTo }}</p></div><span class="cleanup-state">{{ item.cleanupState === 'not_configured' ? '清理未配置' : '清理待验证' }}</span></article></div><section class="retention-job-card"><span><IconClock :size="18" /></span><div><strong>合成对话元数据到期状态</strong><p>{{ settings.retention.syntheticMetadataExpiry.notice }}</p></div><em>启动时检查</em><footer><span><small>本地无正文证明</small><strong>{{ settings.retention.syntheticMetadataExpiry.proofRecords }} 条</strong></span><span><small>最近检查</small><strong>{{ settings.retention.syntheticMetadataExpiry.lastRun ? dateTime(settings.retention.syntheticMetadataExpiry.lastRun.completedAt) : '暂无到期记录' }}</strong></span><span><small>真实正文清理</small><strong>未接入</strong></span></footer></section><footer class="settings-section-note"><IconAlertTriangle :size="15" />只读策略已保存至 SQLite；该状态只说明合成元数据到期与未存正文，不包含真实清理、删除影响预览或真实删除证明。</footer></section>

          <section v-else-if="activeSection === 'features'" class="panel settings-section-panel"><header class="settings-panel-heading"><div><span class="source-tag sqlite">SQLITE</span><h2>功能开关</h2><p>SQLite 模拟配置中未验收的能力统一保持关闭。</p></div><button class="btn btn-white" disabled>管理开关</button></header><div class="feature-flag-list"><article v-for="feature in settings.features.items" :key="feature.id"><span class="feature-icon"><IconSwitch :size="17" /></span><div><strong>{{ feature.label }}</strong><p>{{ feature.reason }}</p></div><span class="risk-tag" :class="feature.risk">{{ feature.risk === 'high' ? '高风险' : feature.risk === 'medium' ? '中风险' : '低风险' }}</span><span class="readonly-switch" :class="{ on: feature.enabled }" role="switch" :aria-checked="feature.enabled" aria-disabled="true"><i /></span><em>{{ feature.enabled ? '已开启' : '已关闭' }}</em></article></div><footer class="settings-section-note success"><IconCheck :size="15" />当前 5 项未验收能力均由服务端 SQLite 配置保持关闭，前端不提供绕过入口。</footer></section>

          <section v-else class="panel settings-section-panel"><header class="settings-panel-heading"><div><span class="source-tag sqlite">SQLITE</span><h2>备份状态</h2><p>SQLite 安全状态元数据只读展示，不允许从浏览器下载数据库。</p></div><button class="btn btn-white" disabled><IconRestore :size="15" />发起恢复演练</button></header><div class="backup-empty"><span><IconArchive :size="27" /></span><h3>尚未配置平台数据库备份</h3><p>{{ settings.backup.notice }}</p><div><article><small>存储目标</small><strong>{{ settings.backup.storageTargetConfigured ? '已配置' : '未配置' }}</strong></article><article><small>最近备份</small><strong>{{ settings.backup.lastBackupAt ? dateTime(settings.backup.lastBackupAt) : '无记录' }}</strong></article><article><small>最近校验</small><strong>{{ settings.backup.lastVerifiedAt ? dateTime(settings.backup.lastVerifiedAt) : '无记录' }}</strong></article><article><small>恢复演练</small><strong>{{ settings.backup.lastRestoreDrillAt ? dateTime(settings.backup.lastRestoreDrillAt) : '无记录' }}</strong></article></div><button class="btn" disabled>配置受保护备份作业</button></div><footer class="settings-section-note"><IconDatabase :size="15" />备份安全状态已保存至 SQLite；备份文件、数据库、密钥和认证资料不得通过浏览器直接下载。</footer></section>
        </div>
      </section>
      <footer class="page-footer">数据来源：服务状态 LIVE；组织、业务口径、开关、留存与备份状态为 SQLite 模拟配置 · 设置写入、凭据查看、备份下载与恢复操作均禁用</footer>
    </template>
  </div>
</template>
