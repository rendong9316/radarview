<template>
  <div class="filter-panel">
    <div class="panel-body">
      <!-- 时间范围过滤 -->
      <div v-if="props.hasActiveFilter" class="filter-indicator"><Circle :size="8" class="fi-dot" /> 时间筛选已激活</div>
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
        <button class="apply-btn" @click="apply" :disabled="!canApply" title="应用时间范围过滤条件">应用过滤</button>
        <button v-if="props.hasActiveFilter" class="clear-btn" @click="clear" title="清除时间过滤条件">清除</button>
      </div>
      <p v-if="errorMsg" class="error-msg">{{ errorMsg }}</p>

      <!-- 分割线 -->
      <div class="filter-divider"></div>

      <!-- 航迹点长度筛选 -->
      <div v-if="hasPointCountFilter" class="filter-indicator"><Circle :size="8" class="fi-dot" /> 点数筛选已激活</div>
      <div class="filter-section-label">航迹点长度筛选</div><HelpTip text="按航迹点数过滤各数据源。勾选数据源后设置最小和最大点数阈值，仅显示点数在范围内的航迹。可用于过滤掉采样点过少的低质量航迹。" />
      <div class="point-filter-list">
        <div v-for="item in layerItems" :key="'pf-'+item.source" class="point-filter-row">
          <span class="layer-dot" :style="{ background: item.color }"></span>
          <label class="pf-check-wrap" @click.stop title="启用此数据源的点数筛选">
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
            class="pf-input" placeholder="最小" title="最小航迹点数阈值"
            min="0"
            :disabled="!pointCountFilters[item.source].enabled"
            :value="pointCountFilters[item.source].min"
            @change="onPfMin(item.source, ($event.target as HTMLInputElement).value)"
          />
          <span class="pf-sep">-</span>
          <input
            type="number"
            class="pf-input" placeholder="最大" title="最大航迹点数阈值"
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
      <div v-if="lasso.hasSpatialFilter.value" class="filter-indicator"><Circle :size="8" class="fi-dot" /> 空间筛选已激活</div>
      <div class="filter-section-label">空间套索</div><HelpTip text="空间多边形筛选工具。启用后在地图上单击添加顶点，双击闭合多边形。系统使用点入多边形和线段相交两种判定方法，查找所有与多边形相交的航迹。点击结果行可跳转到对应航迹。" />
      <div class="lasso-section">
        <!-- Mode selector -->
        <div v-if="!lasso.isClosed.value" class="lasso-mode-row">
          <button
            class="lasso-mode-btn"
            :class="{ active: lasso.lassoMode.value === 'vertex' }"
            @click="lasso.setMode('vertex')"
          >顶点</button>
          <button
            class="lasso-mode-btn"
            :class="{ active: lasso.lassoMode.value === 'freehand' }"
            @click="lasso.setMode('freehand')"
          >自由绘制</button>
        </div>

        <!-- Vertex size slider -->
        <div v-if="lasso.isClosed.value || lasso.vertices.value.length > 0" class="lasso-radius-row">
          <span class="lasso-radius-label">顶点大小</span>
          <input
            type="range"
            class="lasso-radius-slider"
            :value="lasso.lassoVertexRadius.value"
            @input="lasso.lassoVertexRadius.value = Number(($event.target as HTMLInputElement).value)"
            min="2"
            max="18"
            step="1"
          />
          <span class="lasso-radius-val">{{ lasso.lassoVertexRadius.value }}px</span>
        </div>

        <button
          class="lasso-toggle"
          :class="{ active: lasso.active.value }"
          @click="handleToggleLasso"
        >
          {{ lassoToggleLabel }}
        </button>

        <!-- Drawing mode UI -->
        <template v-if="lasso.active.value && !lasso.isClosed.value">
          <p class="lasso-hint">
            <template v-if="lasso.lassoMode.value === 'freehand'">按住左键拖动绘制，松手闭合</template>
            <template v-else>单击地图添加顶点，双击闭合多边形</template>
          </p>
          <div class="lasso-actions">
            <button class="lasso-clear-btn" @click="lasso.clearAll()" :disabled="lasso.vertices.value.length === 0">清除顶点</button>
          </div>
        </template>

        <!-- Closed polygon UI (visible regardless of active state) -->
        <template v-if="lasso.isClosed.value">
          <p class="lasso-hint">多边形已闭合（{{ lasso.vertices.value.length }} 个顶点）</p>
          <div class="lasso-actions">
            <button class="lasso-apply-btn" @click="handleApplyLasso" title="根据多边形筛选相交航迹">{{ lasso.hasSpatialFilter.value ? '重新应用' : '应用空间筛选' }}</button>
            <button class="lasso-clear-btn" @click="handleRedrawLasso">重新绘制</button>
          </div>
          <div v-if="lasso.hasSpatialFilter.value" class="lasso-actions">
            <button class="lasso-clear-filter-btn" @click="handleClearSpatialFilter">清除空间筛选</button>
          </div>

          <!-- Region info (shown once polygon is closed) -->
          <div v-if="lasso.isClosed.value" class="lasso-region-info">
            <!-- Perimeter & Area -->
            <div v-if="lasso.polygonPerimeterM.value != null" class="lri-section lri-summary">
              <div class="lri-summary-row">
                <span class="lri-title">周长</span>
                <span class="lri-area-val">{{ fmtDist(lasso.polygonPerimeterM.value) }}</span>
              </div>
              <div class="lri-summary-row">
                <span class="lri-title">面积</span>
                <span class="lri-area-val">{{ fmtArea(lasso.polygonAreaSqKm.value!) }}</span>
              </div>
            </div>

            <!-- Vertex coordinates (scrollable, max 3 rows) -->
            <div class="lri-section">
              <div class="lri-title">顶点坐标</div>
              <div class="lri-scroll">
                <table class="lri-table">
                  <thead>
                    <tr><th>#</th><th>经度</th><th>纬度</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="(v, i) in lasso.vertices.value" :key="v.id">
                      <td class="lri-idx">V{{ i + 1 }}</td>
                      <td class="lri-val">{{ v.longitude.toFixed(6) }}</td>
                      <td class="lri-val">{{ v.latitude.toFixed(6) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Edge lengths (scrollable, max 3 rows) -->
            <div v-if="lasso.edgeLengths.value.length > 0" class="lri-section">
              <div class="lri-title">边长</div>
              <div class="lri-scroll">
                <div v-for="e in lasso.edgeLengths.value" :key="`${e.fromIdx}-${e.toIdx}`" class="lri-edge-row">
                  <span class="lri-edge-label">{{ e.fromLabel }} → {{ e.toLabel }}</span>
                  <span class="lri-edge-val">{{ fmtDist(e.meters) }}</span>
                </div>
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
import { useSpatialLasso } from '../composables/useSpatialLasso'

import HelpTip from './HelpTip.vue'
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

const lassoToggleLabel = computed(() => {
  if (lasso.active.value && !lasso.isClosed.value) return '取消绘制'
  return '启用套索'
})

function handleToggleLasso() {
  if (lasso.active.value && !lasso.isClosed.value) {
    // Cancel drawing — clear partial vertices and deactivate
    lasso.clearAll()
  } else {
    lasso.activate()
  }
}

function handleRedrawLasso() {
  lasso.clearAll()
  lasso.activate()
}

function handleApplyLasso() {
  if (lasso.vertices.value.length < 3 || !lasso.isClosed.value) return
  lasso.applyFilter()
}

function handleClearSpatialFilter() {
  lasso.clearAll()
}

// ── Formatting helpers ──

function fmtDist(meters: number): string {
  if (meters >= 1000) return (meters / 1000).toFixed(2) + ' km'
  return meters.toFixed(1) + ' m'
}

function fmtArea(sqKm: number): string {
  if (sqKm >= 0.001) return sqKm.toFixed(3) + ' km²'
  return (sqKm * 1_000_000).toFixed(1) + ' m²'
}
</script>

<style scoped>
.filter-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.filter-indicator {
  font-size: 0.643rem;
  color: var(--accent-primary);
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 2px;
}

.fi-dot {
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

/* ── Lasso mode selector ── */
.lasso-mode-row {
  display: flex;
  gap: 4px;
}

.lasso-mode-btn {
  flex: 1;
  padding: 3px 6px;
  border: 1px solid var(--border-primary);
  border-radius: 2px;
  background: var(--input-bg);
  color: var(--text-tertiary);
  font-size: 0.714rem;
  cursor: pointer;
  text-align: center;
}
.lasso-mode-btn:hover {
  color: var(--text-primary);
}
.lasso-mode-btn.active {
  background: var(--accent-primary);
  border-color: var(--accent-primary);
  color: #fff;
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

.lasso-clear-filter-btn {
  width: 100%;
  padding: 4px 8px;
  background: var(--button-bg);
  color: var(--error);
  border: 1px solid var(--error);
  border-radius: 2px;
  font-size: 0.786rem;
  cursor: pointer;
}
.lasso-clear-filter-btn:hover {
  background: var(--error);
  color: #fff;
}

/* ── Vertex radius slider ── */
.lasso-radius-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.lasso-radius-label {
  font-size: 0.714rem;
  color: var(--text-tertiary);
  white-space: nowrap;
  flex-shrink: 0;
}

.lasso-radius-slider {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  border-radius: 2px;
  background: var(--border-primary);
  outline: none;
  cursor: pointer;
}

.lasso-radius-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #10b981;
  border: 1px solid #059669;
  cursor: pointer;
}

.lasso-radius-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #10b981;
  border: 1px solid #059669;
  cursor: pointer;
}

.lasso-radius-val {
  font-size: 0.714rem;
  color: var(--text-primary);
  font-weight: 600;
  min-width: 30px;
  text-align: right;
}

/* ── Region info ── */
.lasso-region-info {
  border: 1px solid var(--border-primary);
  border-radius: 3px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.lri-section {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-secondary);
}
.lri-section:last-child {
  border-bottom: none;
}

.lri-title {
  font-size: 0.714rem;
  font-weight: 600;
  color: #10b981;
  margin-bottom: 4px;
}

/* ── Perimeter / Area summary ── */
.lri-summary {
  display: flex;
  gap: 16px;
}
.lri-summary-row {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.lri-summary-row .lri-title {
  color: var(--text-tertiary);
  font-weight: 400;
  margin-bottom: 0;
}

/* ── Scrollable list (max 3 items visible) ── */
.lri-scroll {
  max-height: calc(3 * 20px + 4px);
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border-primary) transparent;
}

.lri-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.714rem;
}
.lri-table th {
  color: var(--text-tertiary);
  font-weight: 600;
  text-align: left;
  padding: 1px 4px;
}
.lri-table td {
  padding: 1px 4px;
  color: var(--text-primary);
}
.lri-idx {
  color: var(--text-tertiary) !important;
  font-weight: 600;
  width: 26px;
}
.lri-val {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 0.714rem;
}

.lri-edge-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.lri-edge-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.714rem;
}

.lri-edge-label {
  color: var(--text-secondary);
}

.lri-edge-val {
  color: var(--text-primary);
  font-weight: 600;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 0.714rem;
}

.lri-area-val {
  color: var(--text-primary);
  font-weight: 600;
  font-size: 0.857rem;
}
</style>
