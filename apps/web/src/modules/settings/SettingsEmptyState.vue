<script setup lang="ts">
import { IconSettings } from '@tabler/icons-vue'
</script>

<template>
  <section class="panel settings-empty-state" aria-labelledby="settings-empty-title">
    <div class="settings-empty-icon" aria-hidden="true">
      <IconSettings :size="28" stroke-width="1.7" />
    </div>
    <div>
      <span class="source-tag sqlite">暂未配置</span>
      <h2 id="settings-empty-title">系统设置暂时留空</h2>
      <p>当前阶段只有超级管理员，组织、角色、服务连接和策略配置暂不在页面展开。</p>
      <small>等真实配置来源和网关职责确定后，再逐项补充。</small>
    </div>
  </section>
</template>

<style scoped>
.settings-empty-state {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-4, 1rem);
  align-items: start;
  max-width: 720px;
  margin: 0 auto;
  padding: var(--space-8, 2rem);
  border: 1px solid var(--border-subtle, #d9e2ea);
  background: var(--surface-raised, #fff);
}

.settings-empty-icon {
  display: grid;
  width: 52px;
  height: 52px;
  place-items: center;
  color: var(--accent-strong, #0f766e);
  border-radius: var(--radius-md, 12px);
  background: var(--accent-soft, #e6f4f2);
}

.settings-empty-state h2 {
  margin: var(--space-3, 0.75rem) 0 var(--space-2, 0.5rem);
  color: var(--text-strong, #172b3a);
  font-size: 1.2rem;
}

.settings-empty-state p,
.settings-empty-state small {
  display: block;
  margin: 0;
  color: var(--text-muted, #64748b);
  line-height: 1.65;
}

.settings-empty-state small {
  margin-top: var(--space-2, 0.5rem);
}

@media (max-width: 640px) {
  .settings-empty-state {
    grid-template-columns: 1fr;
    padding: var(--space-5, 1.25rem);
  }
}
</style>
