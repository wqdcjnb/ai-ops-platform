<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type Component } from 'vue'
import { RouterLink } from 'vue-router'
import {
  IconAlertTriangle,
  IconArrowUpRight,
  IconCheck,
  IconCircleDashedCheck,
  IconGauge,
  IconKey,
  IconRefresh,
  IconServer2,
  IconUsers,
} from '@tabler/icons-vue'
import { fetchPlatformStatus, fetchTaskSummary, type PlatformService, type PlatformServiceState, type PlatformStatus, type TaskSummary } from '../home-api'
import { fetchOverview, type OverviewResponse } from '../overview-api'

const isLoading = ref(false)
const platform = ref<PlatformStatus | null>(null)
const tasks = ref<TaskSummary | null>(null)
const overview = ref<OverviewResponse | null>(null)
const errors = ref<string[]>([])
let activeRequest: AbortController | null = null

const serviceLabels: Record<PlatformServiceState, string> = {
  healthy: '正常',
  reachable: '可达',
  auth_required: '认证异常',
  offline: '离线',
}

const taskTargets: Record<TaskSummary['items'][number]['target'], string> = {
  alerts: '告警中心',
  keys: 'Key 管理',
}

const taskRoutes: Record<TaskSummary['items'][number]['target'], string> = {
  alerts: '/alerts',
  keys: '/keys',
}

const setupDone = computed(() => platform.value?.setup.filter((item) => item.state === 'done').length ?? 0)
const setupTotal = computed(() => platform.value?.setup.length ?? 0)
const setupPercent = computed(() => setupTotal.value ? Math.round(setupDone.value / setupTotal.value * 100) : 0)
const newApi = computed(() => platform.value?.services.find((service) => service.id === 'new-api'))
const cpa = computed(() => platform.value?.services.find((service) => service.id === 'cpa'))
const reachableUpstreams = computed(() => [newApi.value, cpa.value].filter((service) => service && service.state !== 'offline').length)
const lastUpdated = computed(() => {
  const value = platform.value?.meta.generatedAt ?? tasks.value?.generatedAt ?? overview.value?.meta.generatedAt
  if (!value) return '等待数据'
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value))
})

interface EntryCard {
  title: string
  description: string
  icon: Component
  tone: string
  source: string
  value: string
  detail: string
  to?: string
}

const entryCards = computed<EntryCard[]>(() => [
  {
    title: '运营总览',
    description: '查看今日请求、Token、成本点数和链路健康',
    icon: IconGauge,
    tone: 'teal',
    source: overview.value ? 'SQLITE' : '等待数据',
    value: overview.value ? overview.value.metrics.todayRequests.toLocaleString('zh-CN') : '—',
    detail: overview.value ? `今日请求 · 成功率 ${overview.value.metrics.successRate}% · 模拟元数据` : 'SQLite 模拟数据暂未加载',
    to: '/overview',
  },
  {
    title: '人员与 Key',
    description: '管理人员归属和访问凭据',
    icon: IconUsers,
    tone: 'blue',
    source: tasks.value ? 'SQLITE' : '等待数据',
    value: tasks.value ? tasks.value.summary.activeKeys.toLocaleString('zh-CN') : '—',
    detail: tasks.value ? `${tasks.value.summary.activeKeys} 个有效 Key · ${tasks.value.summary.expiringKeys} 个临期` : 'SQLite Key 摘要暂未加载',
    to: '/people',
  },
  {
    title: '上游账号',
    description: '检查正式服务与隔离实验服务的连接状态',
    icon: IconServer2,
    tone: 'violet',
    source: 'LIVE',
    value: platform.value ? `${reachableUpstreams.value}/2` : '—',
    detail: platform.value ? '上游入口当前可达' : '服务状态暂未加载',
    to: '/upstreams',
  },
  {
    title: '待处理事项',
    description: '集中查看告警和临期 Key 风险',
    icon: IconAlertTriangle,
    tone: 'amber',
    source: tasks.value ? 'SQLITE' : '等待数据',
    value: tasks.value ? String(tasks.value.total) : '—',
    detail: tasks.value ? (tasks.value.total ? `${tasks.value.summary.openAlerts} 项告警与 ${tasks.value.summary.expiringKeys} 个临期 Key` : '当前没有待处理事项') : 'SQLite 任务摘要暂未加载',
    to: '/alerts',
  },
])

function checkedTime(service: PlatformService) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(service.checkedAt))
}

async function loadHome() {
  activeRequest?.abort()
  const request = new AbortController()
  activeRequest = request
  isLoading.value = true
  errors.value = []

  const [platformResult, taskResult, overviewResult] = await Promise.allSettled([
    fetchPlatformStatus(request.signal),
    fetchTaskSummary(request.signal),
    fetchOverview('7d', request.signal),
  ])
  if (request.signal.aborted) return

  if (platformResult.status === 'fulfilled') platform.value = platformResult.value
  else errors.value.push('服务矩阵加载失败')
  if (taskResult.status === 'fulfilled') tasks.value = taskResult.value
  else errors.value.push('待处理事项加载失败')
  if (overviewResult.status === 'fulfilled') overview.value = overviewResult.value
  else errors.value.push('运营摘要加载失败')

  if (activeRequest === request) isLoading.value = false
}

onMounted(() => void loadHome())
onBeforeUnmount(() => activeRequest?.abort())
</script>

<template>
  <div class="dashboard home-dashboard">
    <section class="page-heading home-heading">
      <div>
        <div class="eyebrow">CONTROL CENTER</div>
        <h1>统一入口</h1>
        <p>先确认环境状态，再进入运营、人员和上游管理任务。</p>
      </div>
      <div class="heading-actions">
        <span class="updated-at">检查时间 {{ lastUpdated }}</span>
        <button class="btn btn-white refresh-button" :disabled="isLoading" @click="loadHome">
          <IconRefresh :size="17" :class="{ spinning: isLoading }" /> {{ isLoading ? '检查中' : '刷新状态' }}
        </button>
      </div>
    </section>

    <div v-if="errors.length" class="partial-warning" role="status">
      <IconAlertTriangle :size="17" />
      <span>部分数据未更新：{{ errors.join('、') }}。其余区域仍可使用。</span>
    </div>

    <section class="entry-grid" aria-label="业务入口">
      <article v-for="card in entryCards" :key="card.title" class="entry-card" :class="{ disabled: !card.to }">
        <div class="entry-card-top">
          <span class="entry-icon" :class="`tone-${card.tone}`"><component :is="card.icon" :size="21" /></span>
          <span class="source-tag" :class="card.source.toLowerCase()">{{ card.source }}</span>
        </div>
        <div class="entry-title"><h2>{{ card.title }}</h2><span>{{ card.value }}</span></div>
        <p>{{ card.description }}</p>
        <div class="entry-foot">
          <small>{{ card.detail }}</small>
          <RouterLink v-if="card.to" :to="card.to" :aria-label="`进入${card.title}`">进入 <IconArrowUpRight :size="15" /></RouterLink>
          <span v-else title="对应页面尚未开发">页面待开发</span>
        </div>
      </article>
    </section>

    <section class="home-content-grid">
      <article class="panel service-panel">
        <div class="panel-header">
          <div><h2>服务矩阵</h2><p>逐项展示真实探测结果，不再使用含义模糊的可用数汇总</p></div>
          <span class="source-tag live">LIVE</span>
        </div>
        <div v-if="platform" class="service-list">
          <div v-for="service in platform.services" :key="service.id" class="service-row">
            <span class="service-dot" :class="`state-${service.state}`" />
            <div class="service-copy"><strong>{{ service.name }}</strong><small>{{ service.detail }}</small></div>
            <div class="service-check"><strong :class="`state-${service.state}`">{{ serviceLabels[service.state] }}</strong><small>{{ checkedTime(service) }}</small></div>
          </div>
        </div>
        <div v-else class="panel-empty">{{ isLoading ? '正在探测 BFF、New API 与 CPA…' : '服务矩阵暂时不可用' }}</div>
      </article>

      <article class="panel task-panel">
        <div class="panel-header">
          <div><h2>待处理事项</h2><p>根据 SQLite 模拟告警和掩码 Key 汇总，不包含完整凭据</p></div>
          <span class="source-tag sqlite">SQLITE</span>
        </div>
        <div v-if="tasks?.items.length" class="home-task-list">
          <div v-for="task in tasks.items" :key="task.id" class="home-task-item">
            <span class="task-symbol" :class="`level-${task.level}`"><IconAlertTriangle :size="17" /></span>
            <div><strong>{{ task.title }}</strong><small>{{ task.detail }}</small></div>
            <RouterLink class="task-target-link" :to="taskRoutes[task.target]" :aria-label="`进入${taskTargets[task.target]}`">{{ taskTargets[task.target] }} <IconArrowUpRight :size="13" /></RouterLink>
          </div>
        </div>
        <div v-else-if="tasks" class="panel-empty success"><IconCheck :size="20" />当前没有待处理事项</div>
        <div v-else class="panel-empty">{{ isLoading ? '正在汇总 SQLite 模拟任务…' : '待处理事项暂时不可用' }}</div>
      </article>
    </section>

    <section class="home-bottom-grid">
      <article class="panel setup-panel">
        <div class="panel-header">
          <div><h2>首次配置清单</h2><p>完成最小可用链路所需的环境步骤</p></div>
          <strong class="setup-count">{{ setupDone }}/{{ setupTotal || '—' }}</strong>
        </div>
        <div class="setup-progress" :aria-label="`配置完成 ${setupPercent}%`"><i :style="{ width: `${setupPercent}%` }" /></div>
        <div v-if="platform" class="setup-list">
          <div v-for="item in platform.setup" :key="item.id" class="setup-item" :class="{ done: item.state === 'done' }">
            <span><IconCheck v-if="item.state === 'done'" :size="15" /><IconCircleDashedCheck v-else :size="15" /></span>
            <div><strong>{{ item.label }}</strong><small>{{ item.detail }}</small></div>
          </div>
        </div>
        <div v-else class="panel-empty">配置状态暂未加载</div>
      </article>

      <article class="panel quick-panel">
        <div class="panel-header"><div><h2>系统入口</h2><p>只返回安全地址，不携带登录参数或凭据</p></div><IconKey :size="18" /></div>
        <div v-if="platform" class="quick-links">
          <a v-for="link in platform.links" :key="link.id" :href="link.url" target="_blank" rel="noreferrer">
            <span><IconServer2 :size="18" /></span>
            <div><strong>{{ link.label }}</strong><small>{{ link.url }}</small></div>
            <IconArrowUpRight :size="16" />
          </a>
        </div>
        <div v-else class="panel-empty">系统入口暂未加载</div>
      </article>
    </section>

    <footer class="page-footer">服务状态：LIVE · 运营摘要与待办：SQLite 模拟数据 · 不代表真实网关事件或 Key 到期状态</footer>
  </div>
</template>
