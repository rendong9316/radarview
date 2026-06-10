<template>
  <div class="settings-panel">
    <!-- 线条颜色 -->
    <div class="section-header">线条颜色</div>
    <div v-for="src in dataSources" :key="'lc-'+src" class="setting-row">
      <span class="row-label" :style="{ color: `var(--source-${src})` }">{{ sourceLabel(src) }}</span>
      <div class="color-control">
        <input
          type="color"
          class="color-input"
          :value="effectiveColor(src)"
          @input="onColorChange(src, ($event.target as HTMLInputElement).value)"
        />
        <span class="color-hex">{{ effectiveColor(src) }}</span>
      </div>
      <button
        class="reset-btn"
        :class="{ visible: hasCustomColor(src) }"
        title="重置为默认颜色"
        @click="onResetColor(src)"
      >↺</button>
    </div>

    <!-- 线宽调节 -->
    <div class="section-header">线宽调节</div>
    <div v-for="src in dataSources" :key="'lw-'+src" class="setting-row">
      <span class="row-label" :style="{ color: `var(--source-${src})` }">{{ sourceLabel(src) }}</span>
      <input
        type="range"
        class="row-slider"
        min="0.5" max="8" step="0.5"
        :value="lineWidths[src]"
        @input="$emit('setLineWidth', src, Number(($event.target as HTMLInputElement).value))"
      />
      <span class="row-value">{{ lineWidths[src] }}</span>
    </div>

    <div class="section-divider"></div>

    <!-- 行政边界 -->
    <div class="section-header">行政边界</div>
    <div class="setting-row">
      <span class="row-label" style="color: var(--text-primary)">边界线</span>
      <label class="toggle-switch">
        <input type="checkbox" :checked="boundaryVisible" @change="setBoundaryVisible(($event.target as HTMLInputElement).checked)" />
        <span class="toggle-slider"></span>
      </label>
      <span class="row-value toggle-label">{{ boundaryVisible ? '开' : '关' }}</span>
    </div>
    <div class="setting-row">
      <span class="row-label" style="color: #d8dee9">国界</span>
      <input
        type="range"
        class="row-slider"
        min="0.2" max="5.0" step="0.1"
        :value="boundaryWidths.admin0"
        @input="setBoundaryWidth('admin0', Number(($event.target as HTMLInputElement).value))"
      />
      <span class="row-value">{{ boundaryWidths.admin0.toFixed(1) }}</span>
    </div>
    <div class="setting-row">
      <span class="row-label" style="color: #000000">海岸</span>
      <input
        type="range"
        class="row-slider"
        min="0.2" max="5.0" step="0.1"
        :value="boundaryWidths.coastline"
        @input="setBoundaryWidth('coastline', Number(($event.target as HTMLInputElement).value))"
      />
      <span class="row-value">{{ boundaryWidths.coastline.toFixed(1) }}</span>
    </div>
    <div class="setting-row">
      <span class="row-label" style="color: #77808f">省界</span>
      <input
        type="range"
        class="row-slider"
        min="0.2" max="5.0" step="0.1"
        :value="boundaryWidths.admin1"
        @input="setBoundaryWidth('admin1', Number(($event.target as HTMLInputElement).value))"
      />
      <span class="row-value">{{ boundaryWidths.admin1.toFixed(1) }}</span>
    </div>
    <div class="setting-row">
      <span class="row-label" style="color: #d8dee9">国界色</span>
      <div class="color-control">
        <input
          type="color"
          class="color-input"
          :value="boundaryColors.admin0"
          @input="setBoundaryColor('admin0', ($event.target as HTMLInputElement).value)"
        />
        <span class="color-hex">{{ boundaryColors.admin0 }}</span>
      </div>
    </div>
    <div class="setting-row">
      <span class="row-label" style="color: #000000">海岸色</span>
      <div class="color-control">
        <input
          type="color"
          class="color-input"
          :value="boundaryColors.coastline"
          @input="setBoundaryColor('coastline', ($event.target as HTMLInputElement).value)"
        />
        <span class="color-hex">{{ boundaryColors.coastline }}</span>
      </div>
    </div>
    <div class="setting-row">
      <span class="row-label" style="color: #77808f">省界色</span>
      <div class="color-control">
        <input
          type="color"
          class="color-input"
          :value="boundaryColors.admin1"
          @input="setBoundaryColor('admin1', ($event.target as HTMLInputElement).value)"
        />
        <span class="color-hex">{{ boundaryColors.admin1 }}</span>
      </div>
    </div>

    <div class="section-divider"></div>

    <!-- 瓦片来源 -->
    <div class="section-header">瓦片来源</div>
    <div class="setting-row">
      <select
        class="tile-select"
        :value="activeSource"
        @change="$emit('switchTileSource', ($event.target as HTMLSelectElement).value)"
      >
        <option
          v-for="ts in tileSources"
          :key="ts.file_name"
          :value="ts.file_name"
        >{{ ts.display_name }}</option>
      </select>
    </div>

    <div class="section-divider"></div>

    <!-- 圆球直径 -->
    <div class="section-header">圆球直径</div>
    <div v-for="src in dataSources" :key="'ds-'+src" class="setting-row">
      <span class="row-label" :style="{ color: `var(--source-${src})` }">{{ sourceLabel(src) }}</span>
      <input
        type="range"
        class="row-slider"
        min="0.2" max="3.0" step="0.1"
        :value="dotScale[src]"
        @input="$emit('setDotScale', src, Number(($event.target as HTMLInputElement).value))"
      />
      <span class="row-value">{{ dotScale[src].toFixed(1) }}</span>
    </div>

    <div class="section-divider"></div>

    <!-- 旗标大小 -->
    <div class="section-header">旗标大小</div>
    <div class="setting-row">
      <span class="row-label" style="color: var(--accent-primary)">图标&amp;文字</span>
      <input
        type="range"
        class="row-slider"
        min="0.5" max="3.0" step="0.1"
        :value="flagScaleVal"
        @input="setFlagScale(Number(($event.target as HTMLInputElement).value))"
      />
      <span class="row-value">{{ flagScaleVal.toFixed(1) }}</span>
    </div>

    <div class="section-divider"></div>

    <!-- 字号大小 -->
    <div class="section-header">字号大小</div>
    <div class="setting-row">
      <span class="row-label" style="color: var(--text-primary)">应用字号</span>
      <input
        type="range"
        class="row-slider"
        min="10" max="20" step="1"
        :value="fontSizeVal"
        @input="setFontSize(Number(($event.target as HTMLInputElement).value))"
      />
      <span class="row-value">{{ fontSizeVal }}px</span>
    </div>

    <div class="section-divider"></div>

    <!-- 点迹显示 -->
    <div class="section-header">点迹显示</div>
    <div class="setting-row">
      <span class="row-label" style="color: var(--accent-primary)">全局显示</span>
      <label class="toggle-switch">
        <input type="checkbox" :checked="showAllPointDots" @change="toggleAllPointDots()" />
        <span class="toggle-slider"></span>
      </label>
      <span class="row-value toggle-label">{{ showAllPointDots ? '开' : '关' }}</span>
    </div>
    <div class="setting-row">
      <span class="row-label" style="color: var(--accent-primary)">圆球大小</span>
      <input
        type="range"
        class="row-slider"
        min="0.2" max="5.0" step="0.1"
        :value="trackPointDotScaleVal"
        @input="setTrackPointDotScale(Number(($event.target as HTMLInputElement).value))"
      />
      <span class="row-value">{{ trackPointDotScaleVal.toFixed(1) }}</span>
    </div>
    <button class="section-btn" @click="requestClearAll()">🗑 清空所有点迹显示</button>

    <div class="section-divider"></div>

    <!-- 点迹颜色 -->
    <div class="section-header">点迹颜色</div>
    <div v-for="src in dataSources" :key="'pdc-'+src" class="setting-row">
      <span class="row-label" :style="{ color: `var(--source-${src})` }">{{ sourceLabel(src) }}</span>
      <div class="color-control">
        <input
          type="color"
          class="color-input"
          :value="effectivePointDotColor(src)"
          @input="onPointDotColorChange(src, ($event.target as HTMLInputElement).value)"
        />
        <span class="color-hex">{{ effectivePointDotColor(src) }}</span>
      </div>
      <button
        class="reset-btn"
        :class="{ visible: hasCustomPointDotColor(src) }"
        title="重置为自动对比色"
        @click="onResetPointDotColor(src)"
      >↺</button>
    </div>

    <div class="section-divider"></div>

    <!-- 工具 -->
    <div class="section-header">工具</div>
    <div class="tools-row">
      <button class="section-btn" @click="$emit('toggleBatchPanel')">
        💾 数据管理{{ batchCount ? ` (${batchCount})` : '' }}
      </button>
      <button class="section-btn" @click="$emit('toggleLabels')">
        🏷️ 切换标签显示
      </button>
      <button class="section-btn" @click="$emit('resetView')">
        🔍 重置视角
      </button>
      <button v-if="trackCount" class="section-btn danger" @click="$emit('clearAll')">
        🗑️ 清除显示
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { DataSource } from '../../types/track'
import type { TileSourceInfo } from '../../composables/useTileSource'
import { useFlagScale } from '../../composables/useFlagScale'
import { useFontSize } from '../../composables/useFontSize'
import { useLineColor } from '../../composables/useLineColor'
import { useTrackPointDots } from '../../composables/useTrackPointDots'
import { useBoundaryLayers } from '../../composables/useBoundaryLayers'

defineProps<{
  lineWidths: Record<DataSource, number>
  dotScale: Record<DataSource, number>
  batchCount: number
  trackCount: number
  tileSources: TileSourceInfo[]
  activeSource: string
}>()

defineEmits<{
  setLineWidth: [src: DataSource, v: number]
  setDotScale: [src: DataSource, v: number]
  toggleBatchPanel: []
  toggleLabels: []
  resetView: []
  clearAll: []
  switchTileSource: [fileName: string]
}>()

const dataSources: DataSource[] = ['adsb', 'radar', 'radar_raw']

const { flagScale, setFlagScale } = useFlagScale()
const { fontSize, setFontSize } = useFontSize()
const { getEffectiveHex, setLineColor, hasCustomColor } = useLineColor()
const { trackPointDotScale, setTrackPointDotScale, showAllPointDots, toggleAllPointDots, requestClearAll, pointDotColors, setPointDotColor, hasCustomPointDotColor } = useTrackPointDots()
const { boundaryVisible, boundaryWidths, boundaryColors, setBoundaryVisible, setBoundaryWidth, setBoundaryColor } = useBoundaryLayers()

const flagScaleVal = computed(() => flagScale.value)
const fontSizeVal = computed(() => fontSize.value)
const trackPointDotScaleVal = computed(() => trackPointDotScale.value)

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

function effectivePointDotColor(src: DataSource): string {
  return pointDotColors[src] ?? '#00ffcc'
}
function onPointDotColorChange(src: DataSource, hex: string) {
  setPointDotColor(src, hex)
}
function onResetPointDotColor(src: DataSource) {
  setPointDotColor(src, null)
}
</script>

<style scoped>
.settings-panel {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 6px;
}

/* ── Section header ── */
.section-header {
  font-size: 0.714rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 8px 0 4px 0;
}
.section-header:first-child {
  padding-top: 0;
}

/* ── Row ── */
.setting-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
}

.row-label {
  font-size: 0.786rem;
  font-weight: 600;
  width: 50px;
  flex-shrink: 0;
}

.row-value {
  font-size: 0.786rem;
  color: var(--text-tertiary);
  min-width: 28px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.toggle-label {
  min-width: 22px;
}

/* ── Slider ── */
.row-slider {
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
.row-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--accent-primary);
  cursor: pointer;
  border: none;
}
.row-slider:hover::-webkit-slider-thumb {
  filter: brightness(1.3);
}

/* ── Color picker ── */
.color-control {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 1;
}

.color-input {
  width: 24px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--border-primary);
  border-radius: 2px;
  cursor: pointer;
  background: transparent;
}
.color-input::-webkit-color-swatch-wrapper { padding: 1px; }
.color-input::-webkit-color-swatch { border: none; border-radius: 1px; }

.color-hex {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 0.714rem;
  color: var(--text-secondary);
  text-transform: uppercase;
}

/* ── Reset button ── */
.reset-btn {
  width: 20px;
  height: 20px;
  padding: 0;
  font-size: 0.786rem;
  color: var(--text-tertiary);
  background: transparent;
  border: 1px solid var(--border-secondary);
  border-radius: 2px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  visibility: hidden;
}
.reset-btn.visible { visibility: visible; }
.reset-btn:hover { color: var(--accent-primary); border-color: var(--accent-primary); }

/* ── Action button ── */
.section-btn {
  padding: 3px 10px;
  background: var(--button-bg);
  color: var(--button-fg);
  border: 1px solid var(--border-secondary);
  border-radius: 2px;
  font-size: 0.786rem;
  cursor: pointer;
  transition: background 0.15s;
}
.section-btn:hover { background: var(--button-hover); }
.section-btn.danger { color: var(--error); border-color: var(--error); background: var(--error-bg); }
.section-btn.danger:hover { background: rgba(244,71,71,0.25); }

.tools-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 2px 0;
}

/* ── Toggle switch ── */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 28px;
  height: 16px;
  flex-shrink: 0;
}
.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.toggle-slider {
  position: absolute;
  inset: 0;
  background: var(--bg-tertiary);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.toggle-slider::before {
  content: '';
  position: absolute;
  width: 12px;
  height: 12px;
  left: 2px;
  top: 2px;
  background: var(--text-primary);
  border-radius: 50%;
  transition: transform 0.15s;
}
.toggle-switch input:checked + .toggle-slider {
  background: var(--accent-primary);
}
.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(12px);
}

/* ── Tile source select ── */
.tile-select {
  flex: 1;
  padding: 4px 8px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-secondary);
  border-radius: 2px;
  font-size: 0.786rem;
  cursor: pointer;
  outline: none;
  font-family: inherit;
}
.tile-select:hover { border-color: var(--accent-primary); }
.tile-select:focus { border-color: var(--accent-primary); box-shadow: 0 0 0 1px rgba(0,212,255,0.2); }
.tile-select option { background: var(--bg-secondary); color: var(--text-primary); }
</style>
