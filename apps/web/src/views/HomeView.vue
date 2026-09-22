<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  IconAlertTriangle,
  IconArrowUpRight,
  IconCheck,
  IconCircleCheck,
  IconClock,
  IconKey,
  IconRefresh,
  IconRoute,
  IconServer2,
  IconShieldCheck,
  IconUsers,
} from '@tabler/icons-vue'
import { fetchPlatformStatus, fetchTaskSummary, restartPlatform, type DockerRestartTarget, type DockerService, type PlatformStatus, type TaskSummary } from '../home-api'

const isLoading = ref(false)
const platform = ref<PlatformStatus | null>(null)
const tasks = ref<TaskSummary | null>(null)
const errors = ref<string[]>([])
const restartTarget = ref<DockerRestartTarget | null>(null)
const actionMessage = ref('')
const actionError = ref('')
let activeRequest: AbortController | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null

const serviceLabels: Record<DockerService['state'], string> = {
  healthy: '运行正常',
  reachable: '启动中',
  offline: '离线',
}

const taskTargets: Record<TaskSummary['items'][number]['target'], string> = {
  keys: 'Key 管理',
}

const taskRoutes: Record<TaskSummary['items'][number]['target'], string> = {
  keys: '/keys',
}

function legacyMatrix(value: PlatformStatus): DockerService[] {
  const find = (id: 'bff' | 'new-api' | 'cpa') => value.services.find((service) => service.id === id)
  const bff = find('bff')
  const newApi = find('new-api')
  const cpa = find('cpa')
  return [
    { id: 'web', name: 'AI OPS Web', role: '管理界面', state: 'healthy', detail: '前端由 Docker Compose 管理', checkedAt: value.meta.generatedAt, container: null },
    { id: 'server', name: 'AI OPS Server', role: 'BFF 与网关', state: bff?.state === 'offline' ? 'offline' : 'healthy', detail: bff?.detail ?? '页面数据与权限边界服务', checkedAt: bff?.checkedAt ?? value.meta.generatedAt, container: null },
    { id: 'new-api', name: 'New API', role: 'Token 与渠道管理', state: newApi?.state === 'offline' ? 'offline' : 'healthy', detail: newApi?.detail ?? '服务状态待检查', checkedAt: newApi?.checkedAt ?? value.meta.generatedAt, container: null },
    { id: 'cpa', name: 'CPA Codex OAuth', role: '账号池与模型上游', state: cpa?.state === 'offline' ? 'offline' : 'healthy', detail: cpa?.detail ?? '服务状态待检查', checkedAt: cpa?.checkedAt ?? value.meta.generatedAt, container: null },
  ]
}

const serviceMatrix = computed<DockerService[]>(() => {
  if (!platform.value) return []
  return platform.value.dockerServices ?? legacyMatrix(platform.value)
})

const healthyServices = computed(() => serviceMatrix.value.filter((service) => service.state === 'healthy').length)
const serviceTotal = computed(() => serviceMatrix.value.length)
const dockerControl = computed(() => platform.value?.dockerControl)
const canRestart = computed(() => Boolean(dockerControl.value?.enabled && dockerControl.value?.available))
const pendingTasks = computed(() => tasks.value?.total ?? 0)
const lastUpdated = computed(() => {
  const value = platform.value?.meta.generatedAt ?? tasks.value?.generatedAt
  if (!value) return '等待数据'
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value))
})

function checkedTime(service: DockerService) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(service.checkedAt))
}

function serviceIcon(service: DockerService) {
  if (service.id === 'web') return IconRoute
  if (service.id === 'server') return IconShieldCheck
  if (service.id === 'new-api') return IconKey
  return IconServer2
}

function statusClass(service: DockerService) {
  return `state-${service.state}`
}

async function loadHome() {
  activeRequest?.abort()
  const request = new AbortController()
  activeRequest = request
  isLoading.value = true
  errors.value = []
  actionError.value = ''

  const [platformResult, taskResult] = await Promise.allSettled([
    fetchPlatformStatus(request.signal),
    fetchTaskSummary(request.signal),
  ])
  if (request.signal.aborted) return

  if (platformResult.status === 'fulfilled') platform.value = platformResult.value
  else errors.value.push('服务矩阵加载失败')
  if (taskResult.status === 'fulfilled') tasks.value = taskResult.value
  else errors.value.push('待处理事项加载失败')

  if (activeRequest === request) isLoading.value = false
}

async function restart(target: DockerRestartTarget) {
  if (!canRestart.value || restartTarget.value) return
  const label = target === 'all' ? '整套 Docker Compose 服务' : serviceMatrix.value.find((service) => service.id === target)?.name ?? target
  if (typeof window !== 'undefined' && !window.confirm(`确认重启${label}？重启期间对应服务会短暂不可用。`)) return

  restartTarget.value = target
  actionMessage.value = ''
  actionError.value = ''
  try {
    const result = await restartPlatform(target)
    actionMessage.value = result.message
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => void loadHome(), target === 'all' ? 3_000 : 1_800)
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '重启请求未提交'
  } finally {
    restartTarget.value = null
  }
}

onMounted(() => void loadHome())
onBeforeUnmount(() => {
  activeRequest?.abort()
  if (refreshTimer) clearTimeout(refreshTimer)
})
</script>

<template>
  <div class="dashboard home-dashboard home-v2">
    <section class="page-heading home-heading">
      <div>
        <div class="eyebrow">COMPOSE CONTROL CENTER</div>
        <h1>统一入口</h1>
        <p>只看当前真正运行的四个 Docker 服务，并在同一处完成健康检查与重启。</p>
      </div>
      <div class="heading-actions">
        <span class="updated-at">最近检查 {{ lastUpdated }}</span>
        <button class="btn btn-white refresh-button" :disabled="isLoading" @click="loadHome">
          <IconRefresh :size="17" :class="{ spinning: isLoading }" /> {{ isLoading ? '检查中' : '刷新状态' }}
        </button>
      </div>
    </section>

    <div v-if="errors.length" class="partial-warning" role="status">
      <IconAlertTriangle :size="17" />
      <span>部分数据未更新：{{ errors.join('、') }}。可以稍后再次刷新。</span>
    </div>
    <div v-if="actionMessage" class="home-action-notice success" role="status"><IconCheck :size="16" />{{ actionMessage }}</div>
    <div v-if="actionError" class="home-action-notice error" role="alert"><IconAlertTriangle :size="16" />{{ actionError }}</div>

    <section class="home-summary-strip" aria-label="平台摘要">
      <article><span class="summary-icon tone-green"><IconCircleCheck :size="18" /></span><div><small>服务正常</small><strong>{{ healthyServices }}/{{ serviceTotal || 4 }}</strong></div></article>
      <article><span class="summary-icon tone-blue"><IconServer2 :size="18" /></span><div><small>Docker 控制</small><strong>{{ canRestart ? '已连接' : '只读模式' }}</strong></div></article>
      <article><span class="summary-icon tone-amber"><IconAlertTriangle :size="18" /></span><div><small>待处理事项</small><strong>{{ pendingTasks }}</strong></div></article>
      <article><span class="summary-icon tone-violet"><IconClock :size="18" /></span><div><small>检查时间</small><strong>{{ lastUpdated }}</strong></div></article>
    </section>

    <section class="home-primary-grid">
      <article class="panel compose-panel">
        <div class="panel-header compose-header">
          <div><h2>服务矩阵</h2><p>Compose 项目：{{ dockerControl?.projectName ?? 'ai-ops-platform' }} · {{ dockerControl?.notice ?? '正在读取 Docker 状态' }}</p></div>
          <button class="btn btn-primary compact-action" :disabled="!canRestart || Boolean(restartTarget)" @click="restart('all')">
            <IconRefresh :size="15" :class="{ spinning: restartTarget === 'all' }" /> 重启全部服务
          </button>
        </div>

        <div v-if="serviceMatrix.length" class="compose-service-grid">
          <article v-for="service in serviceMatrix" :key="service.id" class="compose-service-card" :class="statusClass(service)">
            <header>
              <span class="compose-service-icon"><component :is="serviceIcon(service)" :size="20" /></span>
              <div><strong>{{ service.name }}</strong><small>{{ service.role }}</small></div>
              <span class="service-state-pill" :class="statusClass(service)"><i />{{ serviceLabels[service.state] }}</span>
            </header>
            <div class="compose-service-detail"><span>{{ service.detail }}</span></div>
            <footer>
              <span>检查 {{ checkedTime(service) }}</span>
              <button class="service-restart-button" :disabled="!canRestart || Boolean(restartTarget) || !service.container" :title="!canRestart ? 'Docker 控制未连接，当前为只读模式' : !service.container ? '未找到容器' : `重启 ${service.name}`" @click="restart(service.id)">
                <IconRefresh :size="14" :class="{ spinning: restartTarget === service.id }" /> 重启
              </button>
            </footer>
          </article>
        </div>
        <div v-else class="panel-empty">{{ isLoading ? '正在读取 Docker Compose 服务…' : '服务矩阵暂时不可用' }}</div>
      </article>

      <aside class="home-side-stack">
        <article class="panel action-panel">
          <div class="panel-header"><div><h2>运维动作</h2><p>仅管理员可执行，所有操作写入审计日志</p></div><IconShieldCheck :size="18" /></div>
          <div class="action-panel-body">
            <div class="action-explainer"><span><IconRefresh :size="18" /></span><div><strong>按需重启，不修改配置</strong><p>重启只作用于当前 Compose 项目容器，不会删除数据卷或认证文件。</p></div></div>
            <div class="control-state" :class="{ ready: canRestart }"><i />{{ canRestart ? 'Docker Engine 已连接，可执行重启' : '当前为只读模式' }}</div>
            <small class="control-note">{{ dockerControl?.notice ?? '刷新后显示 Docker 控制状态' }}</small>
          </div>
        </article>

        <article class="panel quick-panel home-quick-panel">
          <div class="panel-header"><div><h2>常用管理</h2><p>业务管理入口保持不变，系统接口不再单独暴露</p></div></div>
          <nav class="home-quick-links" aria-label="常用管理入口">
            <RouterLink to="/people"><span><IconUsers :size="17" /></span><div><strong>人员与部门</strong><small>同步人员归属与权限</small></div><IconArrowUpRight :size="15" /></RouterLink>
            <RouterLink to="/keys"><span><IconKey :size="17" /></span><div><strong>Key 管理</strong><small>创建、停用与轮换凭据</small></div><IconArrowUpRight :size="15" /></RouterLink>
            <RouterLink to="/upstreams"><span><IconServer2 :size="17" /></span><div><strong>上游账号</strong><small>检查模型与 OAuth 连接</small></div><IconArrowUpRight :size="15" /></RouterLink>
          </nav>
        </article>
      </aside>
    </section>

    <section class="panel home-tasks-panel">
      <div class="panel-header"><div><h2>待处理事项</h2><p>只展示临期 Key 摘要，不包含完整凭据或运营指标</p></div></div>
      <div v-if="tasks?.items.length" class="home-task-list">
        <div v-for="task in tasks.items" :key="task.id" class="home-task-item">
          <span class="task-symbol" :class="`level-${task.level}`"><IconAlertTriangle :size="17" /></span>
          <div><strong>{{ task.title }}</strong><small>{{ task.detail }}</small></div>
          <RouterLink class="task-target-link" :to="taskRoutes[task.target]" :aria-label="`进入${taskTargets[task.target]}`">{{ taskTargets[task.target] }} <IconArrowUpRight :size="13" /></RouterLink>
        </div>
      </div>
      <div v-else-if="tasks" class="panel-empty success"><IconCheck :size="20" />当前没有待处理事项</div>
      <div v-else class="panel-empty">{{ isLoading ? '正在汇总待处理事项…' : '待处理事项暂时不可用' }}</div>
    </section>

    <footer class="page-footer">服务矩阵来自 Docker Engine；重启不会删除 Compose 数据卷。业务待办来自本地审计与 Key 摘要。</footer>
  </div>
</template>
