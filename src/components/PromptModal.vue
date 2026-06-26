<template>
  <Teleport to="body">
    <div v-if="promptState" class="prompt-overlay" @click.self="cancel">
      <div class="prompt-dialog" @keydown.escape="cancel" @keydown.enter="onConfirm">
        <p class="prompt-message">{{ promptState.message }}</p>
        <input
          ref="inputEl"
          class="prompt-input"
          :value="promptState.defaultValue"
          @input="inputVal = ($event.target as HTMLInputElement).value"
          type="text"
        />
        <div class="prompt-actions">
          <button class="prompt-btn prompt-btn-cancel" @click="cancel">取消</button>
          <button class="prompt-btn prompt-btn-ok" @click="onConfirm">确定</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useDialogPrompt } from '../composables/useDialogPrompt'

const { promptState, confirm, cancel: doCancel } = useDialogPrompt()
const inputEl = ref<HTMLInputElement | null>(null)
const inputVal = ref('')

watch(promptState, async (s) => {
  if (s) {
    inputVal.value = s.defaultValue
    await nextTick()
    inputEl.value?.focus()
    inputEl.value?.select()
  }
})

function onConfirm() {
  confirm(inputVal.value)
}

function cancel() {
  doCancel()
}
</script>

<style scoped>
.prompt-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}
.prompt-dialog {
  background: var(--bg-primary, #1e1e1e);
  border: 1px solid var(--border-primary, #3c3c3c);
  border-radius: 6px;
  padding: 20px 24px;
  min-width: 320px;
  max-width: 440px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}
.prompt-message {
  margin: 0 0 12px 0;
  font-size: 0.857rem;
  color: var(--text-primary);
  line-height: 1.5;
  white-space: pre-wrap;
}
.prompt-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 10px;
  font-size: 0.857rem;
  font-family: inherit;
  color: var(--text-primary);
  background: var(--input-bg, #2d2d2d);
  border: 1px solid var(--input-border, #555);
  border-radius: 4px;
  outline: none;
}
.prompt-input:focus {
  border-color: var(--accent-primary);
}
.prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
.prompt-btn {
  padding: 5px 16px;
  border-radius: 4px;
  font-size: 0.786rem;
  cursor: pointer;
  border: 1px solid transparent;
  font-family: inherit;
  transition: background 0.15s;
}
.prompt-btn-cancel {
  background: transparent;
  color: var(--text-secondary);
  border-color: var(--border-secondary);
}
.prompt-btn-cancel:hover {
  background: var(--bg-tertiary);
}
.prompt-btn-ok {
  background: var(--accent-primary);
  color: #fff;
}
.prompt-btn-ok:hover {
  filter: brightness(1.15);
}
</style>
