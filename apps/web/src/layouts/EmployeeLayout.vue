<script setup lang="ts">
import { IconCommand, IconLogout } from '@tabler/icons-vue'
import { RouterView } from 'vue-router'
</script>

<template>
  <div class="employee-shell">
    <header class="employee-topbar">
      <div class="employee-brand"><span><IconCommand :size="20" /></span><strong>AI OPS</strong><small>员工自助</small></div>
      <button class="btn btn-white" disabled title="登录与退出将在认证功能中实现"><IconLogout :size="16" /> 退出</button>
    </header>
    <RouterView />
  </div>
</template>
