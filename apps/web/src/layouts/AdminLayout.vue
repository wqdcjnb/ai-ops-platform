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
import { fetchGlobalSearch, GlobalSearchApiError, type GlobalSearchResponse } from '../search-api'
import { useDebouncedSearch } from '../composables/useDebouncedSearch'

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
const globalSearchInput = ref<HTMLInputElement | null>(null)
const globalSearch = ref('')
const globalSearchOpen = ref(false)
const globalSearchLoading = ref(false)
const globalSearchError = ref('')
const globalSearchResults = ref<GlobalSearchResponse | null>(null)
let globalSearchController: AbortController | null = null

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

onMounted(() => {
  void loadServiceStatus()
  window.addEventListener('keydown', focusGlobalSearch)
})
onBeforeUnmount(() => {
  statusController.abort()
  globalSearchController?.abort()
  cancelGlobalSearch()
  window.removeEventListener('keydown', focusGlobalSearch)
})

async function loadCurrentUser() {
  currentUser.value = (await fetchCurrentUser().catch(() => null))?.user ?? null
}

async function signOut() {
  await logout().catch(() => undefined)
  window.location.assign('/login')
}

onMounted(() => void loadCurrentUser())

async function runGlobalSearch() {
  const query = globalSearch.value.trim()
  globalSearchController?.abort()
  globalSearchController = null
  globalSearchError.value = ''
  if (!query) {
    globalSearchOpen.value = false
    globalSearchLoading.value = false
    globalSearchResults.value = null
    return
  }

  const controller = new AbortController()
  globalSearchController = controller
  globalSearchOpen.value = true
  globalSearchLoading.value = true
  try {
    const result = await fetchGlobalSearch(query, controller.signal)
    if (globalSearchController !== controller) return
    globalSearchResults.value = result
  } catch (error) {
    if (controller.signal.aborted || globalSearchController !== controller) return
    globalSearchError.value = error instanceof GlobalSearchApiError ? error.message : '全局搜索暂时无法加载'
    globalSearchResults.value = null
  } finally {
    if (globalSearchController === controller) globalSearchLoading.value = false
  }
}

const { cancel: cancelGlobalSearch } = useDebouncedSearch(globalSearch, () => void runGlobalSearch())

function clearGlobalSearch() {
  cancelGlobalSearch()
  globalSearchController?.abort()
  globalSearchController = null
  globalSearch.value = ''
  globalSearchOpen.value = false
  globalSearchLoading.value = false
  globalSearchError.value = ''
  globalSearchResults.value = null
}

function focusGlobalSearch(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    globalSearchInput.value?.focus()
  }
}

function handleGlobalSearchFocus() {
  if (globalSearch.value.trim()) globalSearchOpen.value = true
}
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
        <div class="global-search-wrap">
          <label class="global-search" :class="{ 'is-active': globalSearchOpen || globalSearchLoading }">
            <IconSearch :size="18" />
            <input
              ref="globalSearchInput"
              v-model="globalSearch"
              type="search"
              aria-label="全局搜索人员、Key 掩码或请求 ID"
              placeholder="搜索人员、Key 掩码或请求 ID"
              autocomplete="off"
              @focus="handleGlobalSearchFocus"
              @keydown.esc.prevent="clearGlobalSearch"
            />
            <kbd>⌘ K</kbd>
          </label>
          <div v-if="globalSearchOpen" class="global-search-popover" role="status" aria-live="polite">
            <div v-if="globalSearchLoading" class="global-search-state">正在搜索…</div>
            <div v-else-if="globalSearchError" class="global-search-state is-error" role="alert">{{ globalSearchError }}</div>
            <template v-else-if="globalSearchResults?.total">
              <div class="global-search-notice">{{ globalSearchResults.meta.notice }}</div>
              <section v-for="group in globalSearchResults.groups" :key="group.id" class="global-search-group">
                <div class="global-search-group-label">{{ group.label }}</div>
                <RouterLink v-for="item in group.items" :key="item.id" :to="item.href" class="global-search-result" @click="clearGlobalSearch">
                  <span>{{ item.title }}</span>
                  <small>{{ item.detail }}</small>
                </RouterLink>
              </section>
            </template>
            <div v-else class="global-search-state">没有匹配内容</div>
          </div>
        </div>
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
