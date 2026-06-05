<template>
  <div class="settings-panel">
    <!-- Line width group -->
    <div class="setting-group">
      <div class="setting-group-title">线宽调节</div>
      <div v-for="src in dataSources" :key="src" class="setting-row">
        <span class="setting-label" :class="src">{{ sourceLabel(src) }}</span>
        <input
          type="range"
          class="setting-slider"
          min="0.5"
          max="8"
          step="0.5"
          :value="lineWidths[src]"
          @input="$emit('setLineWidth', src, Number(($event.target as HTMLInputElement).value))"
        />
        <span class="setting-value">{{ lineWidths[src] }}</span>
      </div>
    </div>

    <!-- Dot scale group -->
    <div class="setting-group">
      <div class="setting-group-title">圆球直径</div>
      <div v-for="src in dataSources" :key="src" class="setting-row">
        <span class="setting-label" :class="src">{{ sourceLabel(src) }}</span>
        <input
          type="range"
          class="setting-slider"
          min="0.2"
          max="3.0"
          step="0.1"
          :value="dotScale[src]"
          @input="$emit('setDotScale', src, Number(($event.target as HTMLInputElement).value))"
        />
        <span class="setting-value">{{ dotScale[src].toFixed(1) }}</span>
      </div>
    </div>

    <!-- Tools -->
    <div class="setting-group">
      <div class="setting-group-title">工具</div>
      <button class="setting-btn" @click="$emit('toggleBatchPanel')">
        💾 数据管理{{ batchCount ? ` (${batchCount})` : '' }}
      </button>
      <button class="setting-btn" @click="$emit('toggleLabels')">
        🏷️ 切换标签显示
      </button>
      <button class="setting-btn" @click="$emit('resetView')">
        🔍 重置视角
      </button>
      <button v-if="trackCount" class="setting-btn danger" @click="$emit('clearAll')">
        🗑️ 清除显示
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { DataSource } from '../../types/track'

defineProps<{
  lineWidths: Record<DataSource, number>
  dotScale: Record<DataSource, number>
  batchCount: number
  trackCount: number
}>()

defineEmits<{
  setLineWidth: [src: DataSource, v: number]
  setDotScale: [src: DataSource, v: number]
  toggleBatchPanel: []
  toggleLabels: []
  resetView: []
  clearAll: []
}>()

const dataSources: DataSource[] = ['adsb', 'radar', 'radar_raw']

function sourceLabel(src: DataSource): string {
  const map: Record<DataSource, string> = { adsb: 'ADS-B', radar: 'Radar', radar_raw: 'Raw', simulation: 'Sim' }
  return map[src] ?? src
}
</script>

<style scoped>
.settings-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.setting-group {
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  padding: 8px;
}

.setting-group-title {
  font-size: 10px;
  color: var(--text-tertiary);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.setting-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.setting-label {
  font-size: 11px;
  font-weight: 600;
  width: 48px;
  flex-shrink: 0;
}
.setting-label.adsb { color: var(--source-adsb); }
.setting-label.radar { color: var(--source-radar); }
.setting-label.radar_raw { color: var(--source-radar_raw); }

.setting-slider {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--bg-tertiary);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
  border: none;
  padding: 0;
}
.setting-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--accent-primary);
  cursor: pointer;
  border: none;
}

.setting-value {
  font-size: 11px;
  color: var(--text-tertiary);
  width: 24px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.setting-btn {
  width: 100%;
  padding: 5px 10px;
  margin-top: 4px;
  background: var(--button-bg);
  color: var(--button-fg);
  border: 1px solid var(--border-secondary);
  border-radius: 3px;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
}
.setting-btn:hover {
  background: var(--button-hover);
}
.setting-btn.danger {
  color: var(--error);
  border-color: var(--error);
  background: var(--error-bg);
}
.setting-btn.danger:hover {
  background: rgba(244,71,71,0.25);
}
</style>
