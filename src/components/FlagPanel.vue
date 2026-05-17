<template>
  <div class="flag-panel" :class="{ collapsed }">
    <div class="panel-header" @click="collapsed = !collapsed">
      旗标管理
      <span class="count-badge" v-if="flags.length">{{ flags.length }}</span>
      <span class="collapse-icon">{{ collapsed ? '+' : '−' }}</span>
    </div>
    <div v-if="!collapsed" class="panel-body">
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
        <div v-for="flag in flags" :key="flag.id" class="flag-row">
          <input
            type="checkbox"
            class="flag-check"
            :checked="selectedFlagIds.includes(flag.id)"
            @change="toggleSelectFlag(flag.id)"
            title="选择用于测距"
          />
          <div class="flag-info">
            <span class="flag-label">{{ flag.label }}</span>
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

const { flags, selectedFlagIds, selectedPair, toggleSelectFlag, addFlag, removeFlag } = useFlags()

const collapsed = ref(false)
const inputLat = ref<number | null>(null)
const inputLng = ref<number | null>(null)
const coordError = ref('')

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
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
}

.panel-header {
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-accent);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
}

.count-badge {
  background: var(--color-accent);
  color: var(--color-bg);
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 10px;
}

.collapse-icon {
  margin-left: auto;
  font-size: 16px;
  color: var(--color-text-dim);
}

.panel-body {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.input-row {
  display: flex;
  gap: 4px;
}

.coord-input {
  width: 80px;
  padding: 5px 6px;
  background: rgba(255,255,255,0.06);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text);
  font-size: 11px;
  outline: none;
}

.coord-input::placeholder {
  color: var(--color-text-dim);
  font-size: 10px;
}

.coord-input:focus {
  border-color: var(--color-accent);
}

.place-btn {
  padding: 5px 10px;
  background: var(--color-accent);
  color: var(--color-bg);
  border: none;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.place-btn:hover {
  opacity: 0.85;
}

.coord-error {
  color: #f44;
  font-size: 11px;
  text-align: center;
  margin: 0;
}

.geo-result {
  padding: 6px 8px;
  background: rgba(0,212,255,0.08);
  border: 1px solid rgba(0,212,255,0.2);
  border-radius: 4px;
}

.geo-line {
  font-size: 11px;
  color: var(--color-accent);
  line-height: 1.6;
}

.empty-text {
  color: var(--color-text-dim);
  font-size: 11px;
  text-align: center;
  padding: 8px 0;
}

.flag-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
}

.flag-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 4px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}

.flag-check {
  flex-shrink: 0;
  accent-color: var(--color-accent);
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
  font-size: 11px;
  color: var(--color-text);
  font-weight: 500;
}

.flag-coords {
  font-size: 10px;
  color: var(--color-text-dim);
  font-family: 'Cascadia Code', 'Fira Code', monospace;
}

.flag-del {
  padding: 0 4px;
  background: none;
  border: none;
  color: #f66;
  font-size: 16px;
  cursor: pointer;
  flex-shrink: 0;
}

.flag-del:hover {
  color: #f00;
}
</style>
