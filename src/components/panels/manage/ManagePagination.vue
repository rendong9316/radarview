<template>
  <div class="pagination-bar">
    <span class="page-info">第 {{ page }} / {{ totalPages }} 页 (共 {{ total.toLocaleString() }} 条)</span>
    <div class="page-controls">
      <button class="page-btn" :disabled="page <= 1" title="跳转到上一页" @click="$emit('setPage', page - 1)">&lt; 上一页</button>
      <button class="page-btn" :disabled="page >= totalPages" title="跳转到下一页" @click="$emit('setPage', page + 1)">下一页 &gt;</button>
      <select class="ps-select" title="选择每页显示条数" :value="pageSize" @change="$emit('setPageSize', Number(($event.target as HTMLSelectElement).value))">
        <option :value="20">20条/页</option>
        <option :value="50">50条/页</option>
        <option :value="100">100条/页</option>
      </select>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ page: number; pageSize: number; total: number }>()
defineEmits<{ setPage: [n: number]; setPageSize: [n: number] }>()

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
</script>

<style scoped>
.pagination-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 3px 8px; border-top: 1px solid var(--border-secondary);
  font-size: 0.643rem; color: var(--text-secondary); flex-shrink: 0;
}
.page-info { white-space: nowrap; }
.page-controls { display: flex; align-items: center; gap: 4px; }
.page-btn {
  padding: 2px 6px; font-size: 0.643rem;
  border: 1px solid var(--border-secondary); border-radius: 3px;
  background: var(--button-secondary); color: var(--text-secondary); cursor: pointer;
}
.page-btn:hover:not(:disabled) { background: var(--button-hover); color: var(--text-primary); }
.page-btn:disabled { opacity: 0.4; cursor: default; }
.ps-select {
  padding: 1px 3px; font-size: 0.643rem;
  background: var(--bg-secondary); border: 1px solid var(--border-secondary);
  border-radius: 3px; color: var(--text-primary); outline: none;
}
</style>
