<template>
  <div class="filter-panel">
    <div v-if="props.hasActiveFilter || hasPointCountFilter" class="active-indicator"><Circle :size="10" class="ai-dot" /> 筛选器已激活</div>
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
          <label class="pf-check-wrap" @click.stop>
            <input
              type="checkbox"
              :checked="pointCountFilters[item.source].enabled"
              @change="onPfToggle(item.source, ($event.target as HTMLInputElement).checked)"
            />
            <span class="pf-check-box"></span>
          </label>
          <span class="pf-check-label">{{ item.label }}</span>
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

      <!-- 分割线 -->
      <div class="filter-divider"></div>

      <!-- 空间套索筛选 -->
      <div class="filter-section-label">🔍 空间套索</div>
      <div class="lasso-section">
        <button
          class="lasso-toggle"
          :class="{ active: lasso.active.value }"
          @click="lasso.toggle()"
        >
          {{ lasso.active.value ? '退出套索' : '启用套索' }}
        </button>

        <template v-if="lasso.active.value">
          <p class="lasso-hint">
            <template v-if="!lasso.isClosed.value">
              单击地图添加顶点，双击闭合多边形
            </template>
            <template v-else>
              多边形已闭合（{{ lasso.vertices.value.length }} 个顶点）
            </template>
          </p>

          <div class="lasso-actions" v-if="lasso.isClosed.value">
            <button class="lasso-apply-btn" @click="handleApplyLasso" :disabled="lasso.loading.value">
              {{ lasso.loading.value ? '查询中...' : '应用空间筛选' }}
            </button>
            <button class="lasso-clear-btn" @click="lasso.clearAll()">重新绘制</button>
          </div>
          <div class="lasso-actions" v-else>
            <button class="lasso-clear-btn" @click="lasso.clearAll()" :disabled="lasso.vertices.value.length === 0">清除顶点</button>
          </div>

          <!-- Results -->
          <div v-if="lasso.results.value.length > 0" class="lasso-results">
            <div class="lasso-result-header">
              命中 {{ lasso.results.value.length }} 条航迹
              <button class="lasso-clear-results" @click="lasso.results.value = []">✕</button>
            </div>
            <div class="lasso-result-list">
              <div
                v-for="r in lasso.results.value"
                :key="`${r.icao}::${r.source}`"
                class="lasso-result-row"
                @click="handleFlyToResult(r)"
              >
                <span class="lasso-result-src" :style="{ color: sourceColor(r.source) }">●</span>
                <span class="lasso-result-icao">{{ r.icao }}</span>
                <span class="lasso-result-meta" v-if="r.flightNumber">{{ r.flightNumber }}</span>
                <span class="lasso-result-pts">{{ r.pointCount }}点</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { DataSource } from '../types/track'
import { useTrackFilter } from '../composables/useTrackFilter'
import { useSpatialLasso, type LassoResult } from '../composables/useSpatialLasso'
import { useTracks, trackKey } from '../composables/useTracks'
import { Circle } from '@lucide/vue'

const props = defineProps<{
  timeRange: { min: number; max: number } | null
  hasActiveFilter: boolean
}>()

const emit = defineEmits<{
  apply: [min: number, max: number]
  clear: []
}>()

const { pointCountFilters, setPointCountFilter, activeMin, activeMax } = useTrackFilter()
const lasso = useSpatialLasso()
const { tracks, isolateTrack } = useTracks()

const startInput = ref('')
const endInput = ref('')
const errorMsg = ref('')

function msToDatetimeLocal(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 组件挂载时从全局筛选状态同步时间输入框，避免切换面板后显示空白占位符
onMounted(() => {
  if (activeMin.value != null) {
    startInput.value = msToDatetimeLocal(activeMin.value)
  }
  if (activeMax.value != null) {
    endInput.value = msToDatetimeLocal(activeMax.value)
  }
})

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

// ── Lasso handlers ──

function sourceColor(source: string): string {
  switch (source) {
    case 'ADS-B': return 'var(--source-adsb)'
    case 'Radar': return 'var(--source-radar)'
    case 'RadarRaw': return 'var(--source-radar_raw)'
    default: return 'var(--text-tertiary)'
  }
}

function handleApplyLasso() {
  if (lasso.vertices.value.length < 3 || !lasso.isClosed.value) return
  lasso.loading.value = true

  try {
    // Build position map from loaded tracks
    const posMap = new Map<string, Array<{ lat: number; lng: number }>>()
    for (const track of tracks.value) {
      const key = trackKey(track.id, track.source)
      const positions = track.positions.map(p => ({ lat: p.latitude, lng: p.longitude }))
      posMap.set(key, positions)
    }

    const matchingKeys = lasso.applySpatialFilter(posMap)

    // Build result objects from track metadata
    const results: LassoResult[] = []
    for (const key of matchingKeys) {
      const track = tracks.value.find(t => trackKey(t.id, t.source) === key)
      if (track) {
        results.push({
          icao: track.id,
          source: track.source,
          flightNumber: track.metadata?.flightNumber ?? null,
          aircraftType: track.metadata?.aircraftType ?? null,
          airline: track.metadata?.airline ?? null,
          origin: track.metadata?.origin ?? null,
          destination: track.metadata?.destination ?? null,
          pointCount: track.pointCount,
          minTime: track.minTimestamp,
          maxTime: track.maxTimestamp,
        })
      }
    }
    lasso.results.value = results
  } finally {
    lasso.loading.value = false
  }
}

function handleFlyToResult(result: LassoResult) {
  isolateTrack(result.icao, result.source as any)
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
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.ai-dot {
  flex-shrink: 0;
  fill: var(--accent-primary);
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

.pf-check-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  cursor: pointer;
}
.pf-check-wrap input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.pf-check-box {
  width: 14px;
  height: 14px;
  border: 1px solid var(--border-primary);
  border-radius: 2px;
  background: var(--input-bg);
  transition: background 0.15s, border-color 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pf-check-box::after {
  content: '';
  display: none;
  width: 4px;
  height: 8px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
  margin-top: -1px;
}
.pf-check-wrap input:checked + .pf-check-box {
  background: var(--accent-primary);
  border-color: var(--accent-primary);
}
.pf-check-wrap input:checked + .pf-check-box::after {
  display: block;
}
.pf-check-wrap input:focus-visible + .pf-check-box {
  outline: 1px solid var(--accent-primary);
  outline-offset: 1px;
}

.pf-check-label {
  color: var(--text-secondary);
  white-space: nowrap;
  font-size: 0.786rem;
  min-width: 52px;
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

/* ── Spatial Lasso ── */
.lasso-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.lasso-toggle {
  width: 100%;
  padding: 5px 10px;
  border: 1px solid var(--border-primary);
  border-radius: 3px;
  background: var(--button-secondary);
  color: var(--text-secondary);
  font-size: 0.786rem;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
}
.lasso-toggle:hover {
  background: var(--button-hover);
  color: var(--text-primary);
}
.lasso-toggle.active {
  background: #10b981;
  border-color: #10b981;
  color: #fff;
}

.lasso-hint {
  font-size: 0.714rem;
  color: var(--text-tertiary);
  text-align: center;
  margin: 0;
}

.lasso-actions {
  display: flex;
  gap: 4px;
}

.lasso-apply-btn {
  flex: 1;
  padding: 4px 8px;
  background: #10b981;
  color: #fff;
  border: none;
  border-radius: 2px;
  font-size: 0.786rem;
  font-weight: 600;
  cursor: pointer;
}
.lasso-apply-btn:hover:not(:disabled) {
  opacity: 0.85;
}
.lasso-apply-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.lasso-clear-btn {
  flex: 1;
  padding: 4px 8px;
  background: var(--button-bg);
  color: var(--button-fg);
  border: 1px solid var(--border-primary);
  border-radius: 2px;
  font-size: 0.786rem;
  cursor: pointer;
}
.lasso-clear-btn:hover:not(:disabled) {
  background: var(--button-hover);
}
.lasso-clear-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.lasso-results {
  margin-top: 4px;
  border: 1px solid var(--border-primary);
  border-radius: 3px;
  overflow: hidden;
}

.lasso-result-header {
  padding: 4px 8px;
  font-size: 0.714rem;
  font-weight: 600;
  color: #10b981;
  background: var(--bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.lasso-clear-results {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 0.714rem;
  padding: 0 2px;
}
.lasso-clear-results:hover {
  color: var(--error);
}

.lasso-result-list {
  max-height: 200px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.lasso-result-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-secondary);
  font-size: 0.714rem;
}
.lasso-result-row:hover {
  background: var(--button-hover);
}

.lasso-result-src {
  flex-shrink: 0;
}

.lasso-result-icao {
  color: var(--text-primary);
  font-weight: 600;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
}

.lasso-result-meta {
  color: var(--text-tertiary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lasso-result-pts {
  color: var(--text-tertiary);
  font-size: 0.643rem;
  flex-shrink: 0;
}
</style>
