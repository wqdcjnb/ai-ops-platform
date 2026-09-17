<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type Component } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import {
  IconAlertTriangle,
  IconBell,
  IconBrain,
  IconBuildingCommunity,
  IconChevronRight,
  IconCommand,
  IconFileAnalytics,
  IconGauge,
  IconKey,
  IconLayoutDashboard,
  IconMenu2,
  IconRoute,
  IconSearch,
  IconServer2,
  IconSettings,
  IconShieldCheck,
  IconSpeedboat,
  IconUsers,
  IconX,
} from '@tabler/icons-vue'
import { fetchPlatformStatus, type PlatformService, type PlatformStatus } from '../home-api'
import { fetchCurrentUser, logout, type AuthUser } from '../auth-api'

interface NavItem {
  label: string
  icon: Component
  to?: string
  badge?: string
}

interface NavSection {
  label: string
  items: NavItem[]
}

const mobileNavOpen = ref(false)
const route = useRoute()
const currentUser = ref<AuthUser | null>(null)
const bffState = ref<'checking' | 'online' | 'offline'>('checking')
const platform = ref<PlatformStatus | null>(null)
const statusController = new AbortController()

const navSections: NavSection[] = [
  {
    label: '工作台',
    items: [
      { label: '统一入口', icon: IconLayoutDashboard, to: '/' },
      { label: '运营总览', icon: IconGauge, to: '/overview' },
    ],
  },
  {
    label: '人员与访问',
    items: [
      { label: '人员与部门', icon: IconUsers, to: '/people' },
      { label: 'Key 管理', icon: IconKey, to: '/keys' },
      { label: '额度与限流', icon: IconSpeedboat, to: '/limits' },
    ],
  },
  {
    label: '模型治理',
    items: [
      { label: '用途与路由', icon: IconRoute, to: '/routes' },
      { label: '模型与渠道', icon: IconBrain, to: '/models' },
      { label: '上游账号', icon: IconServer2, to: '/upstreams' },
    ],
  },
  {
    label: '运营监控',
    items: [
      { label: '用量与日志', icon: IconFileAnalytics, to: '/usage' },
      { label: '告警中心', icon: IconAlertTriangle, to: '/alerts' },
    ],
  },
  {
    label: '安全审计',
    items: [
      { label: '审计日志', icon: IconShieldCheck, to: '/audit' },
      { label: '对话审计', icon: IconBuildingCommunity, to: '/conversation-audit' },
    ],
  },
]

const service = (id: PlatformService['id']) => computed(() => platform.value?.services.find((item) => item.id === id))
const newApi = service('new-api')
const cpa = service('cpa')
const stateLabel = (value: PlatformService | undefined, name: string) => {
  if (!value) return `${name} 检查中`
  if (value.state === 'healthy') return `${name} 已认证`
  if (value.state === 'reachable') return `${name} 可达`
  if (value.state === 'auth_required') return `${name} 认证异常`
  return `${name} 离线`
}
const newApiLabel = computed(() => stateLabel(newApi.value, 'New API'))
const cpaLabel = computed(() => stateLabel(cpa.value, 'CPA'))
const degraded = computed(() => bffState.value !== 'online' || newApi.value?.state !== 'healthy' || cpa.value?.state === 'offline')

async function loadServiceStatus() {
  try {
    platform.value = await fetchPlatformStatus(statusController.signal)
    bffState.value = 'online'
  } catch {
    bffState.value = 'offline'
  }
}

onMounted(() => void loadServiceStatus())
onBeforeUnmount(() => statusController.abort())

async function loadCurrentUser() {
  currentUser.value = (await fetchCurrentUser().catch(() => null))?.user ?? null
}

async function signOut() {
  await logout().catch(() => undefined)
  window.location.assign('/login')
}

onMounted(() => void loadCurrentUser())
</script>

<template>
  <div class="app-shell">
    <div v-if="mobileNavOpen" class="nav-backdrop" @click="mobileNavOpen = false" />
    <aside class="app-sidebar" :class="{ 'is-open': mobileNavOpen }">
      <div class="brand-row">
        <div class="brand-mark"><IconCommand :size="22" stroke-width="2.2" /></div>
        <div>
          <div class="brand-name">AI OPS</div>
          <div class="brand-caption">运营管理平台</div>
        </div>
        <button class="icon-button mobile-close" aria-label="关闭导航" @click="mobileNavOpen = false"><IconX :size="20" /></button>
      </div>

      <div class="environment-pill"><span /> 本机验证环境 <strong>DEV</strong></div>

      <nav class="primary-nav" aria-label="管理端主导航">
        <section v-for="section in navSections" :key="section.label" class="nav-section">
          <div class="nav-section-label">{{ section.label }}</div>
          <template v-for="item in section.items" :key="item.label">
            <RouterLink v-if="item.to" :to="item.to" class="nav-item" active-class="" :class="{ active: route.path === item.to }" @click="mobileNavOpen = false">
              <component :is="item.icon" :size="18" stroke-width="1.8" />
              <span>{{ item.label }}</span>
            </RouterLink>
            <span v-else class="nav-item disabled" aria-disabled="true" :title="`${item.label}尚未开发`">
              <component :is="item.icon" :size="18" stroke-width="1.8" />
              <span>{{ item.label }}</span>
              <small>{{ item.badge ?? '待开发' }}</small>
            </span>
          </template>
        </section>
      </nav>

      <div class="sidebar-footer">
        <RouterLink to="/settings" class="nav-item" active-class="" :class="{ active: route.path === '/settings' }" @click="mobileNavOpen = false"><IconSettings :size="18" /> <span>系统设置</span></RouterLink>
        <button class="operator-card" type="button" @click="signOut">
          <div class="avatar avatar-sm">{{ currentUser?.displayName.slice(0, 1) ?? '—' }}</div>
          <div><strong>{{ currentUser?.displayName ?? '当前身份' }}</strong><small>{{ currentUser?.roleLabel ?? '会话加载中' }} · 退出登录</small></div>
          <IconChevronRight :size="17" />
        </button>
      </div>
    </aside>

    <main class="app-main">
      <header class="topbar">
        <button class="icon-button mobile-menu" aria-label="打开导航" @click="mobileNavOpen = true"><IconMenu2 :size="22" /></button>
        <label class="global-search" title="全局搜索将在人员页面完成后启用">
          <IconSearch :size="18" />
          <input type="search" aria-label="全局搜索尚未启用" placeholder="全局搜索将在人员页面完成后启用" disabled />
          <kbd>⌘ K</kbd>
        </label>
        <div class="topbar-actions">
          <div class="service-status" :class="{ degraded }" :title="`BFF ${bffState}；${newApiLabel}；${cpaLabel}`">
            <span /> {{ bffState === 'online' ? 'BFF 在线' : bffState === 'offline' ? 'BFF 离线' : '检查服务' }}
            <small>· {{ newApiLabel }} · {{ cpaLabel }}</small>
          </div>
          <RouterLink class="icon-button notification-button" to="/alerts" aria-label="打开告警中心"><IconBell :size="20" /></RouterLink>
          <button class="avatar-button" aria-label="退出登录" @click="signOut">{{ currentUser?.displayName.slice(0, 1) ?? '—' }}</button>
        </div>
      </header>

      <RouterView />
    </main>
  </div>
</template>
