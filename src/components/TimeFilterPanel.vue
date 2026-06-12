<template>
  <div class="filter-panel">
    <div v-if="props.hasActiveFilter || hasPointCountFilter" class="active-indicator">⬤ 筛选器已激活</div>
    <div class="panel-body">
      <!-- 时间范围过滤 -->
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

      <!-- 分割线 -->
      <div class="filter-divider"></div>

      <!-- 航迹点长度筛选 -->
      <div class="filter-section-label">航迹点长度筛选</div>
      <div class="point-filter-list">
        <div v-for="item in layerItems" :key="'pf-'+item.source" class="point-filter-row">
          <span class="layer-dot" :style="{ background: item.color }"></span>
          <label class="pf-check-label">
            <input
              type="checkbox"
              :checked="pointCountFilters[item.source].enabled"
              @change="onPfToggle(item.source, ($event.target as HTMLInputElement).checked)"
            />
            {{ item.label }}
          </label>
          <input
            type="number"
            class="pf-input"
            placeholder="最小"
            min="0"
            :disabled="!pointCountFilters[item.source].enabled"
            :value="pointCountFilters[item.source].min"
            @change="onPfMin(item.source, ($event.target as HTMLInputElement).value)"
          />
          <span class="pf-sep">-</span>
          <input
            type="number"
            class="pf-input"
            placeholder="最大"
            min="0"
            :disabled="!pointCountFilters[item.source].enabled"
            :value="pointCountFilters[item.source].max"
            @change="onPfMax(item.source, ($event.target as HTMLInputElement).value)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { DataSource } from '../types/track'
import { useTrackFilter } from '../composables/useTrackFilter'

const props = defineProps<{
  timeRange: { min: number; max: number } | null
  hasActiveFilter: boolean
}>()

const emit = defineEmits<{
  apply: [min: number, max: number]
  clear: []
}>()

const { pointCountFilters, setPointCountFilter } = useTrackFilter()

const startInput = ref('')
const endInput = ref('')
const errorMsg = ref('')

const hasPointCountFilter = computed(() =>
  (['adsb', 'radar', 'radar_raw'] as DataSource[]).some(s => pointCountFilters.value[s].enabled)
)

const layerItems = [
  { source: 'adsb' as DataSource, label: 'ADS-B', color: 'var(--source-adsb)' },
  { source: 'radar' as DataSource, label: 'Radar', color: 'var(--source-radar)' },
  { source: 'radar_raw' as DataSource, label: 'Raw', color: 'var(--source-radar_raw)' },
]

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

function onPfToggle(source: DataSource, enabled: boolean) {
  setPointCountFilter(source, { enabled })
}

function onPfMin(source: DataSource, val: string) {
  const n = val === '' ? null : parseInt(val, 10)
  setPointCountFilter(source, { min: n != null && !isNaN(n) ? n : null })
}

function onPfMax(source: DataSource, val: string) {
  const n = val === '' ? null : parseInt(val, 10)
  setPointCountFilter(source, { max: n != null && !isNaN(n) ? n : null })
}
</script>

<style scoped>
.filter-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.active-indicator {
  font-size: 0.714rem;
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
  font-size: 0.714rem;
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
  font-size: 0.786rem;
  outline: none;
  min-width: 0;
}

.time-input:focus {
  border-color: var(--accent-primary);
}

.time-sep {
  color: var(--text-tertiary);
  font-size: 0.786rem;
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
  font-size: 0.786rem;
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
  font-size: 0.786rem;
  cursor: pointer;
}

.clear-btn:hover {
  background: var(--button-hover);
}

.error-msg {
  color: var(--error);
  font-size: 0.786rem;
  text-align: center;
  margin: 0;
}

/* ── Point count filter ── */
.filter-divider {
  height: 1px;
  background: var(--border-primary);
  margin: 2px 0;
}

.filter-section-label {
  font-size: 0.786rem;
  color: var(--text-tertiary);
  font-weight: 600;
}

.point-filter-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.point-filter-row {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.786rem;
}

.layer-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.pf-check-label {
  display: flex;
  align-items: center;
  gap: 2px;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  min-width: 52px;
  font-size: 0.786rem;
}

.pf-input {
  width: 50px;
  padding: 2px 4px;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: 2px;
  color: var(--input-fg);
  font-size: 0.786rem;
  outline: none;
}

.pf-input:focus {
  border-color: var(--accent-primary);
}

.pf-input:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.pf-sep {
  color: var(--text-tertiary);
  font-size: 0.786rem;
}
</style>
