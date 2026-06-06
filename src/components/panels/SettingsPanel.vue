<template>
  <div class="settings-panel">
    <!-- Line color group -->
    <div class="setting-group">
      <div class="setting-group-title">线条颜色</div>
      <div v-for="src in dataSources" :key="'lc-'+src" class="setting-row">
        <span class="setting-label" :class="src">{{ sourceLabel(src) }}</span>
        <div class="color-picker-wrapper">
          <input
            type="color"
            class="setting-color-input"
            :value="effectiveColor(src)"
            @input="onColorChange(src, ($event.target as HTMLInputElement).value)"
          />
          <span class="setting-value color-hex">{{ effectiveColor(src) }}</span>
        </div>
        <button
          v-if="hasCustomColor(src)"
          class="color-reset-btn"
          title="重置为默认颜色"
          @click="onResetColor(src)"
        >↺</button>
      </div>
    </div>

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

    <!-- Flag scale group -->
    <div class="setting-group">
      <div class="setting-group-title">旗标大小</div>
      <div class="setting-row">
        <span class="setting-label flag-label">图标&amp;文字</span>
        <input
          type="range"
          class="setting-slider"
          min="0.5"
          max="3.0"
          step="0.1"
          :value="flagScaleVal"
          @input="setFlagScale(Number(($event.target as HTMLInputElement).value))"
        />
        <span class="setting-value">{{ flagScaleVal.toFixed(1) }}</span>
      </div>
    </div>

    <!-- Font size group -->
    <div class="setting-group">
      <div class="setting-group-title">字号大小</div>
      <div class="setting-row">
        <span class="setting-label font-label">应用字号</span>
        <input
          type="range"
          class="setting-slider"
          min="10"
          max="20"
          step="1"
          :value="fontSizeVal"
          @input="setFontSize(Number(($event.target as HTMLInputElement).value))"
        />
        <span class="setting-value">{{ fontSizeVal }}px</span>
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
import { computed } from 'vue'
import type { DataSource } from '../../types/track'
import { useFlagScale } from '../../composables/useFlagScale'
import { useFontSize } from '../../composables/useFontSize'
import { useLineColor } from '../../composables/useLineColor'

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

const { flagScale, setFlagScale } = useFlagScale()
const { fontSize, setFontSize } = useFontSize()
const { getEffectiveHex, setLineColor, hasCustomColor } = useLineColor()

const flagScaleVal = computed(() => flagScale.value)
const fontSizeVal = computed(() => fontSize.value)

function effectiveColor(src: DataSource): string {
  return getEffectiveHex(src)
}

function onColorChange(src: DataSource, hex: string) {
  setLineColor(src, hex)
}

function onResetColor(src: DataSource) {
  setLineColor(src, null)
}

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
  font-size: 0.714rem;
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
  font-size: 0.786rem;
  font-weight: 600;
  width: 48px;
  flex-shrink: 0;
}
.setting-label.adsb { color: var(--source-adsb); }
.setting-label.radar { color: var(--source-radar); }
.setting-label.radar_raw { color: var(--source-radar_raw); }
.setting-label.flag-label { color: var(--accent-primary); }
.setting-label.font-label { color: var(--text-primary); }

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
  font-size: 0.786rem;
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
  font-size: 0.857rem;
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

/* ── Color picker ── */
.color-picker-wrapper {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
}

.setting-color-input {
  width: 28px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border-primary);
  border-radius: 3px;
  cursor: pointer;
  background: transparent;
}
.setting-color-input::-webkit-color-swatch-wrapper {
  padding: 1px;
}
.setting-color-input::-webkit-color-swatch {
  border: none;
  border-radius: 2px;
}

.color-hex {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 0.714rem;
  width: 56px;
  text-transform: uppercase;
}

.color-reset-btn {
  width: 22px;
  height: 22px;
  padding: 0;
  font-size: 0.857rem;
  color: var(--text-tertiary);
  background: transparent;
  border: 1px solid var(--border-secondary);
  border-radius: 3px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.color-reset-btn:hover {
  color: var(--accent-primary);
  border-color: var(--accent-primary);
}
</style>
