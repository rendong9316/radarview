<template>
  <Teleport to="body">
    <Transition name="toast-slide">
      <div v-if="count > 0" class="undo-toast">
        <span class="toast-icon"><Trash2 :size="14" /></span>
        <span class="toast-text">
          已删除 <strong>{{ top?.label }}</strong>
          <template v-if="count > 1"> 等 {{ count }} 组</template>
        </span>
        <button class="toast-undo-btn" @click="$emit('undo')">撤销</button>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import type { UndoEntry } from '../../../composables/useUndoStack'
import { Trash2 } from '@lucide/vue'

defineProps<{
  top: UndoEntry | null
  count: number
}>()

defineEmits<{
  undo: []
}>()
</script>

<style scoped>
.undo-toast {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 300;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  font-size: 0.857rem;
  color: var(--text-primary);
}

.toast-icon {
  font-size: 1rem;
}

.toast-text strong {
  color: var(--error);
}

.toast-undo-btn {
  padding: 4px 12px;
  font-size: 0.786rem;
  font-weight: 600;
  color: #fff;
  background: var(--accent-primary);
  border: none;
  border-radius: 3px;
  cursor: pointer;
  white-space: nowrap;
}
.toast-undo-btn:hover {
  opacity: 0.9;
}

/* Transition */
.toast-slide-enter-active {
  transition: all 0.25s ease-out;
}
.toast-slide-leave-active {
  transition: all 0.2s ease-in;
}
.toast-slide-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(12px);
}
.toast-slide-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(12px);
}
</style>
