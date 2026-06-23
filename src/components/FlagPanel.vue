<template>
  <div class="flag-panel">
    <div class="panel-body">
      <div class="input-row">
        <input
          v-model.number="inputLat"
          type="number"
          class="coord-input"
          placeholder="纬度 (-90~90)"
          min="-90"
          max="90"
          step="any"
        />
        <input
          v-model.number="inputLng"
          type="number"
          class="coord-input"
          placeholder="经度 (-180~180)"
          min="-180"
          max="180"
          step="any"
        />
        <button class="place-btn" @click="handlePlaceFlag">放置旗标</button>
      </div>
      <p v-if="coordError" class="coord-error">{{ coordError }}</p>

      <div v-if="geoResult" class="geo-result">
        <div class="geo-line">距离: {{ geoResult.distance }} km</div>
        <div class="geo-line">方位角: {{ geoResult.bearing }}° ({{ geoResult.cardinal }})</div>
      </div>

      <div v-if="flags.length === 0 && !ruler.active.value" class="empty-text">暂无旗标，双击地图放置</div>

      <!-- Scrollable area: flags + ruler share the remaining space -->
      <div class="panel-scroll">
        <div v-if="flags.length > 0" class="flag-list">
          <button class="clear-all-btn" @click="onClearAll"><Trash2 :size="13" /> 清除全部旗标</button>
          <div v-for="flag in flags" :key="flag.id" class="flag-row">
            <label class="flag-check-wrap" @click.stop>
              <input
                type="checkbox"
                class="flag-check"
                :checked="selectedFlagIds.includes(flag.id)"
                @change="toggleSelectFlag(flag.id)"
              />
              <span class="flag-check-box"></span>
            </label>
            <div class="flag-info">
              <template v-if="editingFlagId === flag.id">
                <input
                  v-model="editLabel"
                  class="rename-input"
                  @keydown.enter="commitRename"
                  @keydown.escape="cancelRename"
                  @blur="commitRename"
                  @click.stop
                  ref="renameInput"
                />
              </template>
              <template v-else>
                <span class="flag-label" @click="startRename(flag)" title="点击重命名"><Pencil :size="11" class="flag-label-icon" /> {{ flag.label }}</span>
              </template>
              <span class="flag-coords">{{ fmt(flag.latitude) }}, {{ fmt(flag.longitude) }}</span>
            </div>
            <button class="flag-del" @click="removeFlag(flag.id)" title="删除旗标"><X :size="13" /></button>
          </div>
        </div>

        <!-- ── 航线标尺 ── -->
        <div class="ruler-section">
          <div class="ruler-header">
            <span class="ruler-title">📏 航线标尺</span>
            <button
              class="ruler-toggle"
              :class="{ active: ruler.active.value }"
              @click="ruler.toggle()"
            >
              {{ ruler.active.value ? '关闭标尺' : '启用标尺' }}
            </button>
          </div>

          <template v-if="ruler.active.value">
            <p class="ruler-hint">单击地图添加航点，Esc 退出</p>

            <!-- Waypoint list -->
            <div v-if="ruler.waypoints.value.length === 0" class="empty-text ruler-empty">
              点击地图放置第一个航点
            </div>
            <div v-else class="ruler-list">
              <div v-for="(wp, i) in ruler.waypoints.value" :key="wp.id" class="ruler-row">
                <span class="ruler-index">{{ i + 1 }}</span>
                <span class="ruler-coords">{{ wp.latitude.toFixed(4) }}, {{ wp.longitude.toFixed(4) }}</span>
                <button class="ruler-del" @click="ruler.removeWaypoint(wp.id)" title="删除此航点"><X :size="12" /></button>
              </div>
            </div>

            <!-- Segments -->
            <div v-if="ruler.segments.value.length > 0" class="ruler-segments">
              <div v-for="seg in ruler.segments.value" :key="seg.index" class="ruler-seg">
                <span class="ruler-seg-label">{{ seg.index + 1 }} → {{ seg.index + 2 }}</span>
                <span class="ruler-seg-dist">{{ seg.distanceKm >= 1 ? seg.distanceKm.toFixed(1) + ' km' : (seg.distanceKm * 1000).toFixed(0) + ' m' }}</span>
                <span class="ruler-seg-bearing">{{ seg.bearingDeg.toFixed(0) }}° {{ seg.cardinal }}</span>
              </div>
            </div>

            <!-- Total -->
            <div v-if="ruler.segments.value.length > 0" class="ruler-total">
              <span class="ruler-total-label">总距离</span>
              <span class="ruler-total-val">{{ ruler.totalDistance.value >= 1 ? ruler.totalDistance.value.toFixed(1) + ' km' : (ruler.totalDistance.value * 1000).toFixed(0) + ' m' }}</span>
            </div>

            <!-- Direct bearing -->
            <div v-if="ruler.directBearing.value" class="ruler-direct">
              <span class="ruler-total-label">首尾方位</span>
              <span class="ruler-total-val">{{ ruler.directBearing.value.deg.toFixed(0) }}° {{ ruler.directBearing.value.cardinal }}</span>
            </div>

            <!-- Actions -->
            <div class="ruler-actions">
              <button class="ruler-action-btn" @click="ruler.undo()" :disabled="ruler.waypoints.value.length === 0">↩ 撤销</button>
              <button class="ruler-action-btn ruler-action-danger" @click="ruler.clearAll()" :disabled="ruler.waypoints.value.length === 0">清空</button>
            </div>
          </template>
        </div>
      </div><!-- .panel-scroll -->
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useFlags } from '../composables/useFlags'
import { useRuler } from '../composables/useRuler'
import { vincentyKm, initialBearing, bearingToCardinal } from '../composables/useGeoCalc'
import { Trash2, Pencil, X } from '@lucide/vue'

const { flags, selectedFlagIds, selectedPair, toggleSelectFlag, addFlag, removeFlag, renameFlag, clearAllFlags } = useFlags()
const ruler = useRuler()
const inputLat = ref<number | null>(null)
const inputLng = ref<number | null>(null)
const coordError = ref('')
const editingFlagId = ref<string | null>(null)
const editLabel = ref('')

function startRename(flag: { id: string; label: string }) {
  editingFlagId.value = flag.id
  editLabel.value = flag.label
}

function commitRename() {
  if (editingFlagId.value && editLabel.value.trim()) {
    renameFlag(editingFlagId.value, editLabel.value)
  }
  editingFlagId.value = null
  editLabel.value = ''
}

function cancelRename() {
  editingFlagId.value = null
  editLabel.value = ''
}

function handlePlaceFlag() {
  coordError.value = ''
  if (inputLat.value == null || inputLng.value == null) {
    coordError.value = '请输入经纬度'
    return
  }
  if (isNaN(inputLat.value) || isNaN(inputLng.value)) {
    coordError.value = '请输入有效数字'
    return
  }
  if (inputLat.value < -90 || inputLat.value > 90) {
    coordError.value = '纬度范围 -90 ~ 90'
    return
  }
  if (inputLng.value < -180 || inputLng.value > 180) {
    coordError.value = '经度范围 -180 ~ 180'
    return
  }
  addFlag(inputLat.value, inputLng.value)
  inputLat.value = null
  inputLng.value = null
}

function onClearAll() {
  if (confirm('确定要清除地图上所有旗标吗？此操作不可撤销。')) {
    clearAllFlags()
  }
}

function fmt(v: number | undefined | null) {
  if (typeof v !== 'number' || !isFinite(v)) return '--'
  return v.toFixed(4)
}

const geoResult = computed(() => {
  if (!selectedPair.value) return null
  const [a, b] = selectedPair.value
  const dist = vincentyKm(a.latitude, a.longitude, b.latitude, b.longitude)
  const bearing = initialBearing(a.latitude, a.longitude, b.latitude, b.longitude)
  return {
    distance: dist.toFixed(1),
    bearing: bearing.toFixed(1),
    cardinal: bearingToCardinal(bearing),
  }
})
</script>

<style scoped>
.flag-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.panel-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.panel-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.input-row {
  display: flex;
  gap: 4px;
}

.coord-input {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: 2px;
  color: var(--input-fg);
  font-size: 0.786rem;
  outline: none;
}

.coord-input::placeholder {
  color: var(--text-tertiary);
  font-size: 0.714rem;
}

.coord-input:focus {
  border-color: var(--accent-primary);
}

.place-btn {
  padding: 4px 10px;
  background: var(--accent-primary);
  color: #fff;
  border: none;
  border-radius: 2px;
  font-size: 0.786rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.place-btn:hover {
  opacity: 0.85;
}

.coord-error {
  color: var(--error);
  font-size: 0.786rem;
  text-align: center;
  margin: 0;
}

.geo-result {
  padding: 6px 8px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-primary);
  border-radius: 2px;
}

.geo-line {
  font-size: 0.786rem;
  color: var(--accent-primary);
  line-height: 1.6;
}

.empty-text {
  color: var(--text-tertiary);
  font-size: 0.786rem;
  text-align: center;
  padding: 8px 0;
}

.flag-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.flag-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px;
  border-bottom: 1px solid var(--border-secondary);
}

.flag-check-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  cursor: pointer;
}

.flag-check {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.flag-check-box {
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

.flag-check-box::after {
  content: '';
  display: none;
  width: 4px;
  height: 8px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
  margin-top: -1px;
}

.flag-check:checked + .flag-check-box {
  background: var(--accent-primary);
  border-color: var(--accent-primary);
}

.flag-check:checked + .flag-check-box::after {
  display: block;
}

.flag-check:focus-visible + .flag-check-box {
  outline: 1px solid var(--accent-primary);
  outline-offset: 1px;
}

.flag-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  cursor: pointer;
}

.flag-label {
  font-size: 0.786rem;
  color: var(--text-primary);
  font-weight: 500;
  cursor: pointer;
  transition: color 0.15s;
}

.flag-label:hover {
  color: var(--accent-primary);
}

.rename-input {
  width: 100%;
  padding: 2px 4px;
  background: var(--input-bg);
  border: 1px solid var(--accent-primary);
  border-radius: 2px;
  color: var(--input-fg);
  font-size: 0.786rem;
  outline: none;
}

.flag-coords {
  font-size: 0.714rem;
  color: var(--text-tertiary);
  font-family: 'Cascadia Code', 'Fira Code', monospace;
}

.flag-del {
  padding: 0 4px;
  background: none;
  border: none;
  color: var(--error);
  font-size: 1rem;
  cursor: pointer;
  flex-shrink: 0;
}

.flag-del:hover {
  opacity: 0.8;
}

.clear-all-btn {
  width: 100%;
  padding: 5px 10px;
  margin-bottom: 6px;
  background: var(--error-bg);
  color: var(--error);
  border: 1px solid var(--error);
  border-radius: 2px;
  font-size: 0.857rem;
  cursor: pointer;
  text-align: center;
}
.clear-all-btn:hover {
  background: rgba(244, 71, 71, 0.25);
}

/* ── Ruler Section ── */
.ruler-section {
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--border-primary);
}

.ruler-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.ruler-title {
  font-size: 0.857rem;
  font-weight: 600;
  color: var(--text-primary);
}

.ruler-toggle {
  padding: 3px 10px;
  border: 1px solid var(--border-primary);
  border-radius: 3px;
  background: var(--button-secondary);
  color: var(--text-secondary);
  font-size: 0.714rem;
  cursor: pointer;
  white-space: nowrap;
}
.ruler-toggle:hover {
  background: var(--button-hover);
  color: var(--text-primary);
}
.ruler-toggle.active {
  background: #f59e0b;
  border-color: #f59e0b;
  color: #000;
  font-weight: 600;
}

.ruler-hint {
  font-size: 0.714rem;
  color: var(--text-tertiary);
  text-align: center;
  margin: 4px 0;
}

.ruler-empty {
  margin-top: 0;
}

.ruler-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ruler-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px;
  border-bottom: 1px solid var(--border-secondary);
}

.ruler-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  border-radius: 50%;
  background: #f59e0b;
  color: #000;
  font-size: 0.643rem;
  font-weight: 700;
}

.ruler-coords {
  flex: 1;
  min-width: 0;
  font-size: 0.714rem;
  color: var(--text-secondary);
  font-family: 'Cascadia Code', 'Fira Code', monospace;
}

.ruler-del {
  padding: 0 2px;
  background: none;
  border: none;
  color: var(--error);
  cursor: pointer;
  flex-shrink: 0;
}
.ruler-del:hover {
  opacity: 0.7;
}

.ruler-segments {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ruler-seg {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  background: var(--bg-tertiary);
  border-radius: 2px;
  font-size: 0.714rem;
}

.ruler-seg-label {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.ruler-seg-dist {
  color: var(--accent-primary);
  font-weight: 600;
  flex: 1;
}

.ruler-seg-bearing {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.ruler-total {
  margin-top: 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 6px;
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 3px;
}

.ruler-total-label {
  font-size: 0.714rem;
  color: var(--text-secondary);
}

.ruler-total-val {
  font-size: 0.857rem;
  font-weight: 700;
  color: #f59e0b;
}

.ruler-direct {
  margin-top: 2px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 6px;
  background: var(--bg-tertiary);
  border-radius: 2px;
}

.ruler-actions {
  margin-top: 6px;
  display: flex;
  gap: 6px;
}

.ruler-action-btn {
  flex: 1;
  padding: 4px 0;
  border: 1px solid var(--border-primary);
  border-radius: 2px;
  background: var(--button-secondary);
  color: var(--text-secondary);
  font-size: 0.714rem;
  cursor: pointer;
  text-align: center;
}
.ruler-action-btn:hover:not(:disabled) {
  background: var(--button-hover);
  color: var(--text-primary);
}
.ruler-action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ruler-action-danger {
  color: var(--error);
  border-color: var(--error);
}
.ruler-action-danger:hover:not(:disabled) {
  background: var(--error-bg);
}
</style>
