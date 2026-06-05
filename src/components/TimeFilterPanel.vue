<template>
  <div class="time-filter-panel">
    <div v-if="props.hasActiveFilter" class="active-indicator">⬤ 时间过滤器已激活</div>
    <div class="panel-body">
      <div v-if="props.timeRange" class="range-info">
        数据范围: {{ fmtTime(props.timeRange.min) }} — {{ fmtTime(props.timeRange.max) }}
      </div>
      <div class="input-row">
        <input
          v-model="startInput"
          type="datetime-local"
          class="time-input"
          :min="dtMin"
          :max="dtMax"
        />
        <span class="time-sep">至</span>
        <input
          v-model="endInput"
          type="datetime-local"
          class="time-input"
          :min="dtMin"
          :max="dtMax"
        />
      </div>
      <div class="btn-row">
        <button class="apply-btn" @click="apply" :disabled="!canApply">应用过滤</button>
        <button v-if="props.hasActiveFilter" class="clear-btn" @click="clear">清除</button>
      </div>
      <p v-if="errorMsg" class="error-msg">{{ errorMsg }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  timeRange: { min: number; max: number } | null
  hasActiveFilter: boolean
}>()

const emit = defineEmits<{
  apply: [min: number, max: number]
  clear: []
}>()

const startInput = ref('')
const endInput = ref('')
const errorMsg = ref('')

const dtMin = computed(() => {
  if (!props.timeRange) return ''
  const d = new Date(props.timeRange.min - 3600000)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
})

const dtMax = computed(() => {
  if (!props.timeRange) return ''
  const d = new Date(props.timeRange.max + 3600000)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
})

const canApply = computed(() => startInput.value && endInput.value)

function fmtTime(ms: number) {
  const d = new Date(ms)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function apply() {
  errorMsg.value = ''
  if (!startInput.value || !endInput.value) {
    errorMsg.value = '请设置起始和结束时间'
    return
  }
  const start = new Date(startInput.value).getTime()
  const end = new Date(endInput.value).getTime()
  if (isNaN(start) || isNaN(end)) {
    errorMsg.value = '时间格式无效'
    return
  }
  if (start >= end) {
    errorMsg.value = '起始时间必须早于结束时间'
    return
  }
  emit('apply', start, end)
}

function clear() {
  emit('clear')
  startInput.value = ''
  endInput.value = ''
  errorMsg.value = ''
}
</script>

<style scoped>
.time-filter-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.active-indicator {
  font-size: 10px;
  color: var(--accent-primary);
  padding: 4px 8px;
  background: var(--bg-tertiary);
  border-radius: 2px;
  text-align: center;
}

.panel-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.range-info {
  font-size: 10px;
  color: var(--text-tertiary);
  text-align: center;
}

.input-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.time-input {
  flex: 1;
  padding: 4px 6px;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: 2px;
  color: var(--input-fg);
  font-size: 11px;
  outline: none;
  min-width: 0;
}

.time-input:focus {
  border-color: var(--accent-primary);
}

.time-sep {
  color: var(--text-tertiary);
  font-size: 11px;
  flex-shrink: 0;
}

.btn-row {
  display: flex;
  gap: 4px;
}

.apply-btn {
  flex: 1;
  padding: 4px 8px;
  background: var(--accent-primary);
  color: #fff;
  border: none;
  border-radius: 2px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.apply-btn:hover:not(:disabled) {
  opacity: 0.85;
}

.apply-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.clear-btn {
  padding: 4px 8px;
  background: var(--button-bg);
  color: var(--button-fg);
  border: 1px solid var(--border-primary);
  border-radius: 2px;
  font-size: 11px;
  cursor: pointer;
}

.clear-btn:hover {
  background: var(--button-hover);
}

.error-msg {
  color: var(--error);
  font-size: 11px;
  text-align: center;
  margin: 0;
}
</style>
