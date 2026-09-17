<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { IconCommand, IconLogout } from '@tabler/icons-vue'
import { RouterView } from 'vue-router'
import { fetchCurrentUser, logout, type AuthUser } from '../auth-api'

const currentUser = ref<AuthUser | null>(null)
onMounted(async () => { currentUser.value = (await fetchCurrentUser().catch(() => null))?.user ?? null })
async function signOut() { await logout().catch(() => undefined); window.location.assign('/login') }
</script>

<template>
  <div class="employee-shell">
    <header class="employee-topbar">
      <div class="employee-brand"><span><IconCommand :size="20" /></span><strong>AI OPS</strong><small>{{ currentUser?.displayName ?? '员工自助' }}</small></div>
      <button class="btn btn-white" @click="signOut"><IconLogout :size="16" /> 退出</button>
    </header>
    <RouterView />
  </div>
</template>
