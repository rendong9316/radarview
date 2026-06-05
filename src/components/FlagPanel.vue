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

      <div v-if="flags.length === 0" class="empty-text">暂无旗标，双击地图放置</div>
      <div v-else class="flag-list">
        <button v-if="flags.length" class="clear-all-btn" @click="onClearAll">🗑️ 清除全部旗标</button>
        <div v-for="flag in flags" :key="flag.id" class="flag-row">
          <input
            type="checkbox"
            class="flag-check"
            :checked="selectedFlagIds.includes(flag.id)"
            @change="toggleSelectFlag(flag.id)"
            title="选择用于测距"
          />
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
              <span class="flag-label" @click="startRename(flag)" title="点击重命名">✎ {{ flag.label }}</span>
            </template>
            <span class="flag-coords">{{ fmt(flag.latitude) }}, {{ fmt(flag.longitude) }}</span>
          </div>
          <button class="flag-del" @click="removeFlag(flag.id)" title="删除旗标">×</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useFlags } from '../composables/useFlags'
import { vincentyKm, initialBearing, bearingToCardinal } from '../composables/useGeoCalc'

const { flags, selectedFlagIds, selectedPair, toggleSelectFlag, addFlag, removeFlag, renameFlag, clearAllFlags } = useFlags()
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

function fmt(v: number) {
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
  background: var(--error-bg);
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
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.flag-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px;
  border-bottom: 1px solid var(--border-secondary);
}

.flag-check {
  flex-shrink: 0;
  accent-color: var(--accent-primary);
  cursor: pointer;
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
</style>
