<script setup lang="ts">
import { IconClockHour4 } from '@tabler/icons-vue'
import { useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
  <div class="dashboard planned-page">
    <div class="planned-icon"><IconClockHour4 :size="24" /></div>
    <h1>{{ route.meta.title }}</h1>
    <p>该页面已纳入 {{ route.meta.stage }} 开发计划，本次仅完成角色布局和路由边界。</p>
  </div>
</template>
