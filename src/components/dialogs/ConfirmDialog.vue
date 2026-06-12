<template>
  <Teleport to="body">
    <div v-if="visible" class="dialog-overlay" @click.self="onCancel" @keydown.esc="onCancel">
      <div class="dialog-box" :class="{ 'dialog-danger': variant === 'danger' }">
        <div class="dialog-icon">
          <AlertTriangle v-if="variant === 'danger'" :size="32" />
          <Info v-else :size="32" />
        </div>
        <h3 class="dialog-title">{{ title }}</h3>
        <p class="dialog-message">{{ message }}</p>
        <div class="dialog-actions">
          <button class="dialog-btn dialog-btn-cancel" @click="onCancel">{{ cancelText }}</button>
          <button
            class="dialog-btn dialog-btn-confirm"
            :class="{ 'btn-danger': variant === 'danger' }"
            @click="onConfirm"
          >
            {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useConfirmDialog } from '../../composables/useConfirmDialog'
import { AlertTriangle, Info } from '@lucide/vue'

const { visible, title, message, confirmText, cancelText, variant, onConfirm, onCancel } =
  useConfirmDialog()
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dialog-box {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  padding: 24px 32px;
  text-align: center;
  min-width: 320px;
  max-width: 440px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.dialog-box.dialog-danger {
  border-color: rgba(220, 50, 50, 0.3);
}

.dialog-icon {
  margin-bottom: 8px;
}

.dialog-icon :deep(svg) {
  color: var(--error);
}

.dialog-box:not(.dialog-danger) .dialog-icon :deep(svg) {
  color: var(--accent-primary);
}

.dialog-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.dialog-message {
  font-size: 0.857rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 20px;
  white-space: pre-wrap;
  word-break: break-word;
}

.dialog-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
}

.dialog-btn {
  padding: 6px 20px;
  border-radius: 3px;
  font-size: 0.857rem;
  cursor: pointer;
  border: 1px solid var(--border-primary);
}

.dialog-btn-cancel {
  background: var(--button-secondary);
  color: var(--text-secondary);
}
.dialog-btn-cancel:hover {
  background: var(--button-hover);
  color: var(--text-primary);
}

.dialog-btn-confirm {
  background: var(--accent-primary);
  color: #fff;
  border-color: var(--accent-primary);
}
.dialog-btn-confirm:hover {
  opacity: 0.9;
}

.dialog-btn-confirm.btn-danger {
  background: #d32f2f;
  border-color: #d32f2f;
  color: #fff;
}
.dialog-btn-confirm.btn-danger:hover {
  background: #b71c1c;
  border-color: #b71c1c;
}
</style>
