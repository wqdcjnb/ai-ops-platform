<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import {
  IconCommand,
  IconLogout2,
  IconMenu2,
  IconX,
} from '@tabler/icons-vue'
import { fetchCurrentUser, logout, type AuthUser } from '../auth-api'
import { adminNavSections } from './admin-nav'

const mobileNavOpen = ref(false)
const route = useRoute()
const router = useRouter()
const currentUser = ref<AuthUser | null>(null)
const isLoggingOut = ref(false)
const logoutError = ref('')

async function loadCurrentUser() {
  currentUser.value = (await fetchCurrentUser().catch(() => null))?.user ?? null
}

onMounted(() => void loadCurrentUser())

async function handleLogout() {
  if (isLoggingOut.value) return
  isLoggingOut.value = true
  logoutError.value = ''
  try {
    await logout()
    currentUser.value = null
    await router.replace('/login')
  } catch (error) {
    logoutError.value = error instanceof Error ? error.message : '退出登录失败，请稍后重试。'
  } finally {
    isLoggingOut.value = false
  }
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
        <section v-for="section in adminNavSections" :key="section.label" class="nav-section">
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
        <div class="operator-card">
          <div class="avatar avatar-sm">{{ currentUser?.displayName.slice(0, 1) ?? '—' }}</div>
          <div><strong>{{ currentUser?.displayName ?? '当前身份' }}</strong></div>
        </div>
      </div>
    </aside>

    <main class="app-main">
      <header class="topbar">
        <button class="icon-button mobile-menu" aria-label="打开导航" @click="mobileNavOpen = true"><IconMenu2 :size="22" /></button>
        <div class="topbar-actions">
          <span v-if="logoutError" class="topbar-logout-error" role="alert">{{ logoutError }}</span>
          <button class="logout-button" type="button" :disabled="isLoggingOut" :aria-label="isLoggingOut ? '正在退出登录' : '退出登录'" :title="logoutError || '退出登录'" @click="handleLogout">
            <IconLogout2 :size="16" />
            <span>{{ isLoggingOut ? '正在退出…' : '退出登录' }}</span>
          </button>
        </div>
      </header>

      <RouterView />
    </main>
  </div>
</template>
