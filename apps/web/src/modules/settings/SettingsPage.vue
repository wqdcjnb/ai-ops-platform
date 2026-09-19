<script setup lang="ts">
import { IconSettings } from '@tabler/icons-vue'
import SettingsEmptyState from './SettingsEmptyState.vue'
</script>

<template>
  <div class="dashboard settings-dashboard settings-page">
    <section class="page-heading">
      <div>
        <div class="eyebrow">SYSTEM SETTINGS</div>
        <h1>系统设置</h1>
        <p>当前阶段保留入口，具体配置等待真实数据和网关职责确定后再开放。</p>
      </div>
      <span class="settings-page-status"><IconSettings :size="15" />暂未配置</span>
    </section>

    <SettingsEmptyState />
  </div>
</template>

<style scoped>
.settings-page-status {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  align-self: flex-start;
  padding: 0.45rem 0.7rem;
  color: var(--text-muted, #64748b);
  border: 1px solid var(--border-subtle, #d9e2ea);
  border-radius: 999px;
  background: var(--surface-soft, #f7fafc);
  font-size: 0.78rem;
  font-weight: 650;
}
</style>
