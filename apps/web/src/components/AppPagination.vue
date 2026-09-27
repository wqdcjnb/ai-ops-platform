<script setup lang="ts">
import { computed } from 'vue'
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-vue'

const props = withDefaults(defineProps<{
  page: number
  totalPages: number
  total?: number
  ariaLabel?: string
}>(), {
  ariaLabel: '分页导航',
})

const emit = defineEmits<{
  change: [page: number]
}>()

const resolvedTotalPages = computed(() => Math.max(props.totalPages, 1))
const currentPage = computed(() => Math.min(Math.max(props.page, 1), resolvedTotalPages.value))
const canGoPrevious = computed(() => currentPage.value > 1)
const canGoNext = computed(() => currentPage.value < resolvedTotalPages.value)

function goTo(next: number) {
  const target = Math.min(Math.max(next, 1), resolvedTotalPages.value)
  if (target !== currentPage.value) emit('change', target)
}
</script>

<template>
  <nav
    class="app-pagination"
    :aria-label="ariaLabel"
  >
    <span class="app-pagination-total">
      <template v-if="total !== undefined"><strong>{{ total.toLocaleString('zh-CN') }}</strong><span> 条记录</span></template>
      <template v-else>分页导航</template>
    </span>

    <div class="app-pagination-controls">
      <button
        class="app-pagination-arrow"
        type="button"
        :disabled="!canGoPrevious"
        aria-label="上一页"
        title="上一页"
        @click="goTo(currentPage - 1)"
      >
        <IconChevronLeft :size="16" stroke-width="2.2" />
      </button>

      <span class="app-pagination-progress" aria-live="polite"><strong>{{ currentPage }}</strong><span> / {{ resolvedTotalPages }}</span></span>

      <button
        class="app-pagination-arrow"
        type="button"
        :disabled="!canGoNext"
        aria-label="下一页"
        title="下一页"
        @click="goTo(currentPage + 1)"
      >
        <IconChevronRight :size="16" stroke-width="2.2" />
      </button>
    </div>
  </nav>
</template>

<style scoped>
.app-pagination {
  --pagination-ink: #405660;
  --pagination-muted: #82919a;
  --pagination-line: #e5ecef;
  --pagination-accent: #16797d;

  container-type: inline-size;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 48px;
  padding: 7px 14px;
  border-top: 1px solid var(--pagination-line);
  background: #fff;
}

.app-pagination-total {
  min-width: 0;
  color: var(--pagination-muted);
  font-size: 10px;
  line-height: 1.3;
  white-space: nowrap;
}

.app-pagination-total strong {
  margin-right: 3px;
  color: var(--pagination-ink);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.app-pagination-controls {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  min-width: 0;
}

.app-pagination-arrow {
  appearance: none;
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  color: #60737d;
  background: transparent;
  font: inherit;
  transition: color .16s ease, background .16s ease, opacity .16s ease;
}

.app-pagination-arrow:hover:not(:disabled) {
  color: #21676b;
  background: #edf7f7;
}

.app-pagination-arrow:disabled {
  cursor: not-allowed;
  color: #c9d2d6;
  background: transparent;
}

.app-pagination-arrow:focus-visible {
  outline: 0;
  box-shadow: 0 0 0 3px rgba(22, 121, 125, .18);
}

.app-pagination-progress {
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
  min-width: 38px;
  color: var(--pagination-muted);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.app-pagination-progress strong {
  color: var(--pagination-ink);
  font-size: 11px;
}

@container (max-width: 440px) {
  .app-pagination {
    gap: 8px;
    min-height: 44px;
    padding: 6px 12px;
  }

  .app-pagination-total {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .app-pagination-total span {
    display: none;
  }
}
</style>
