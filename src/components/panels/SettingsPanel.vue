<template>
  <div class="settings-panel">
    <!-- ═══ 线条颜色 ═══ -->
    <div class="settings-group">
      <div class="group-header" @click="toggleSection('lineColor')">
        <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: isCollapsed('lineColor') }" />
        <Palette :size="13" class="group-icon" />
        <span>线条颜色</span>
      </div>
      <div class="group-body" v-show="!isCollapsed('lineColor')">
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
            :class="{ show: hasCustomColor(src) }"
            :title="`重置 ${sourceLabel(src)} 为默认颜色`"
            @click="onResetColor(src)"
          >
            <RotateCcw :size="12" />
          </button>
        </div>
      </div>
    </div>

    <!-- ═══ 线宽调节 ═══ -->
    <div class="settings-group">
      <div class="group-header" @click="toggleSection('lineWidth')">
        <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: isCollapsed('lineWidth') }" />
        <GripHorizontal :size="13" class="group-icon" />
        <span>线宽调节</span>
      </div>
      <div class="group-body" v-show="!isCollapsed('lineWidth')">
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
      </div>
    </div>

    <!-- ═══ 行政边界 ═══ -->
    <div class="settings-group">
      <div class="group-header" @click="toggleSection('boundary')">
        <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: isCollapsed('boundary') }" />
        <Map :size="13" class="group-icon" />
        <span>行政边界</span>
      </div>
      <div class="group-body" v-show="!isCollapsed('boundary')">
        <!-- 边界线独立显示/隐藏开关 -->
        <div class="setting-row">
          <span class="row-label boundary-label" data-type="admin0">国界</span>
          <label class="toggle-switch" title="切换国界线显示">
            <input type="checkbox" :checked="boundaryVisible.admin0" @change="setBoundaryVisible('admin0', ($event.target as HTMLInputElement).checked)" />
            <span class="toggle-slider"></span>
          </label>
          <span class="switch-label">{{ boundaryVisible.admin0 ? '开' : '关' }}</span>
        </div>
        <div class="setting-row">
          <span class="row-label boundary-label" data-type="coastline">海岸</span>
          <label class="toggle-switch" title="切换海岸线显示">
            <input type="checkbox" :checked="boundaryVisible.coastline" @change="setBoundaryVisible('coastline', ($event.target as HTMLInputElement).checked)" />
            <span class="toggle-slider"></span>
          </label>
          <span class="switch-label">{{ boundaryVisible.coastline ? '开' : '关' }}</span>
        </div>
        <div class="setting-row">
          <span class="row-label boundary-label" data-type="admin1">省界</span>
          <label class="toggle-switch" title="切换省界线显示">
            <input type="checkbox" :checked="boundaryVisible.admin1" @change="setBoundaryVisible('admin1', ($event.target as HTMLInputElement).checked)" />
            <span class="toggle-slider"></span>
          </label>
          <span class="switch-label">{{ boundaryVisible.admin1 ? '开' : '关' }}</span>
        </div>
        <!-- 边界线宽 -->
        <div class="setting-row">
          <span class="row-label boundary-label" data-type="admin0">国界</span>
          <input type="range" class="row-slider" min="0.2" max="5.0" step="0.1"
            :value="boundaryWidths.admin0"
            @input="setBoundaryWidth('admin0', Number(($event.target as HTMLInputElement).value))" />
          <span class="row-value">{{ boundaryWidths.admin0.toFixed(1) }}</span>
        </div>
        <div class="setting-row">
          <span class="row-label boundary-label" data-type="coastline">海岸</span>
          <input type="range" class="row-slider" min="0.2" max="5.0" step="0.1"
            :value="boundaryWidths.coastline"
            @input="setBoundaryWidth('coastline', Number(($event.target as HTMLInputElement).value))" />
          <span class="row-value">{{ boundaryWidths.coastline.toFixed(1) }}</span>
        </div>
        <div class="setting-row">
          <span class="row-label boundary-label" data-type="admin1">省界</span>
          <input type="range" class="row-slider" min="0.2" max="5.0" step="0.1"
            :value="boundaryWidths.admin1"
            @input="setBoundaryWidth('admin1', Number(($event.target as HTMLInputElement).value))" />
          <span class="row-value">{{ boundaryWidths.admin1.toFixed(1) }}</span>
        </div>
        <!-- 边界颜色 -->
        <div class="setting-row">
          <span class="row-label boundary-label" data-type="admin0">国界色</span>
          <div class="color-control">
            <input type="color" class="color-input" :value="boundaryColors.admin0"
              @input="setBoundaryColor('admin0', ($event.target as HTMLInputElement).value)" />
            <span class="color-hex">{{ boundaryColors.admin0 }}</span>
          </div>
          <div class="reset-slot"></div>
        </div>
        <div class="setting-row">
          <span class="row-label boundary-label" data-type="coastline">海岸色</span>
          <div class="color-control">
            <input type="color" class="color-input" :value="boundaryColors.coastline"
              @input="setBoundaryColor('coastline', ($event.target as HTMLInputElement).value)" />
            <span class="color-hex">{{ boundaryColors.coastline }}</span>
          </div>
          <div class="reset-slot"></div>
        </div>
        <div class="setting-row">
          <span class="row-label boundary-label" data-type="admin1">省界色</span>
          <div class="color-control">
            <input type="color" class="color-input" :value="boundaryColors.admin1"
              @input="setBoundaryColor('admin1', ($event.target as HTMLInputElement).value)" />
            <span class="color-hex">{{ boundaryColors.admin1 }}</span>
          </div>
          <div class="reset-slot"></div>
        </div>
      </div>
    </div>

    <!-- ═══ 瓦片来源 ═══ -->
    <div class="settings-group">
      <div class="group-header" @click="toggleSection('tiles')">
        <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: isCollapsed('tiles') }" />
        <Globe :size="13" class="group-icon" />
        <span>瓦片来源</span>
      </div>
      <div class="group-body" v-show="!isCollapsed('tiles')">
        <div class="setting-row">
          <select class="tile-select" :value="activeSource"
            @change="$emit('switchTileSource', ($event.target as HTMLSelectElement).value)">
            <option v-for="ts in tileSources" :key="ts.file_name" :value="ts.file_name">{{ ts.display_name }}</option>
          </select>
        </div>
      </div>
    </div>

    <!-- ═══ 圆球直径 ═══ -->
    <div class="settings-group">
      <div class="group-header" @click="toggleSection('dotScale')">
        <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: isCollapsed('dotScale') }" />
        <CircleDot :size="13" class="group-icon" />
        <span>圆球直径</span>
      </div>
      <div class="group-body" v-show="!isCollapsed('dotScale')">
        <div v-for="src in dataSources" :key="'ds-'+src" class="setting-row">
          <span class="row-label" :style="{ color: `var(--source-${src})` }">{{ sourceLabel(src) }}</span>
          <input type="range" class="row-slider" min="0.2" max="3.0" step="0.1"
            :value="dotScale[src]"
            @input="$emit('setDotScale', src, Number(($event.target as HTMLInputElement).value))" />
          <span class="row-value">{{ dotScale[src].toFixed(1) }}</span>
        </div>
      </div>
    </div>

    <!-- ═══ 旗标大小 ═══ -->
    <div class="settings-group">
      <div class="group-header" @click="toggleSection('flagScale')">
        <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: isCollapsed('flagScale') }" />
        <Flag :size="13" class="group-icon" />
        <span>旗标大小</span>
      </div>
      <div class="group-body" v-show="!isCollapsed('flagScale')">
        <div class="setting-row">
          <span class="row-label" style="color: var(--accent-primary)">图标&amp;文字</span>
          <input type="range" class="row-slider" min="0.5" max="3.0" step="0.1"
            :value="flagScaleVal"
            @input="setFlagScale(Number(($event.target as HTMLInputElement).value))" />
          <span class="row-value">{{ flagScaleVal.toFixed(1) }}</span>
        </div>
      </div>
    </div>

    <!-- ═══ 字号大小 ═══ -->
    <div class="settings-group">
      <div class="group-header" @click="toggleSection('fontSize')">
        <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: isCollapsed('fontSize') }" />
        <Type :size="13" class="group-icon" />
        <span>字号大小</span>
      </div>
      <div class="group-body" v-show="!isCollapsed('fontSize')">
        <div class="setting-row">
          <span class="row-label" style="color: var(--text-primary)">应用字号</span>
          <input type="range" class="row-slider" min="10" max="20" step="1"
            :value="fontSizeVal"
            @input="setFontSize(Number(($event.target as HTMLInputElement).value))" />
          <span class="row-value">{{ fontSizeVal }}px</span>
        </div>
      </div>
    </div>

    <!-- ═══ 点迹显示 ═══ -->
    <div class="settings-group">
      <div class="group-header" @click="toggleSection('pointDots')">
        <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: isCollapsed('pointDots') }" />
        <Dot :size="13" class="group-icon" />
        <span>点迹显示</span>
      </div>
      <div class="group-body" v-show="!isCollapsed('pointDots')">
        <div class="setting-row">
          <span class="row-label" style="color: var(--accent-primary)">全局显示</span>
          <label class="toggle-switch" title="切换航迹点显示">
            <input type="checkbox" :checked="showAllPointDots" @change="toggleAllPointDots()" />
            <span class="toggle-slider"></span>
          </label>
          <span class="switch-label">{{ showAllPointDots ? '开' : '关' }}</span>
        </div>
        <div class="setting-row">
          <span class="row-label" style="color: var(--accent-primary)">圆球大小</span>
          <input type="range" class="row-slider" min="0.2" max="5.0" step="0.1"
            :value="trackPointDotScaleVal"
            @input="setTrackPointDotScale(Number(($event.target as HTMLInputElement).value))" />
          <span class="row-value">{{ trackPointDotScaleVal.toFixed(1) }}</span>
        </div>
        <button class="action-btn" @click="requestClearAll()">
          <Eraser :size="13" />
          <span>清空所有点迹</span>
        </button>
      </div>
    </div>

    <!-- ═══ 点迹颜色 ═══ -->
    <div class="settings-group">
      <div class="group-header" @click="toggleSection('pointDotColors')">
        <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: isCollapsed('pointDotColors') }" />
        <PaintBucket :size="13" class="group-icon" />
        <span>点迹颜色</span>
      </div>
      <div class="group-body" v-show="!isCollapsed('pointDotColors')">
        <div v-for="src in dataSources" :key="'pdc-'+src" class="setting-row">
          <span class="row-label" :style="{ color: `var(--source-${src})` }">{{ sourceLabel(src) }}</span>
          <div class="color-control">
            <input type="color" class="color-input"
              :value="effectivePointDotColor(src)"
              @input="onPointDotColorChange(src, ($event.target as HTMLInputElement).value)" />
            <span class="color-hex">{{ effectivePointDotColor(src) }}</span>
          </div>
          <button
            class="reset-btn"
            :class="{ show: hasCustomPointDotColor(src) }"
            :title="`重置 ${sourceLabel(src)} 点迹为自动对比色`"
            @click="onResetPointDotColor(src)"
          >
            <RotateCcw :size="12" />
          </button>
        </div>
      </div>
    </div>

    <!-- ═══ 工具 ═══ -->
    <div class="settings-group">
      <div class="group-header" @click="toggleSection('tools')">
        <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: isCollapsed('tools') }" />
        <Wrench :size="13" class="group-icon" />
        <span>工具</span>
      </div>
      <div class="group-body" v-show="!isCollapsed('tools')">
        <div class="tools-grid">
          <button class="action-btn" @click="$emit('toggleBatchPanel')">
            <Database :size="13" />
            <span>数据管理</span>
            <span v-if="batchCount" class="badge">{{ batchCount }}</span>
          </button>
          <button class="action-btn" @click="$emit('toggleLabels')">
            <Eye :size="13" />
            <span>标签显示</span>
          </button>
          <button class="action-btn" @click="$emit('resetView')">
            <Maximize2 :size="13" />
            <span>重置视角</span>
          </button>
          <button v-if="trackCount" class="action-btn danger" @click="$emit('clearAll')">
            <Trash2 :size="13" />
            <span>清除显示</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import type { DataSource } from '../../types/track'
import type { TileSourceInfo } from '../../composables/useTileSource'
import { useFlagScale } from '../../composables/useFlagScale'
import { useFontSize } from '../../composables/useFontSize'
import { useLineColor } from '../../composables/useLineColor'
import { useTrackPointDots } from '../../composables/useTrackPointDots'
import { useBoundaryLayers } from '../../composables/useBoundaryLayers'
import { getRawSetting, scheduleSave } from '../../composables/useSettingsPersistence'
import {
  Palette, GripHorizontal, Map, Globe, CircleDot, Flag,
  Type, Eraser, PaintBucket, Wrench, Database, Eye,
  Maximize2, Trash2, RotateCcw, Dot, ChevronDown,
} from '@lucide/vue'

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

// ── Collapsible sections (persisted) ──
const SETTINGS_COLLAPSE_KEY = 'settings.collapsed_sections'
const collapsedSections = ref<Set<string>>(new Set())

function loadCollapsedState() {
  const raw = getRawSetting(SETTINGS_COLLAPSE_KEY)
  if (raw) {
    try {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        collapsedSections.value = new Set(arr)
      }
    } catch { /* keep default (all expanded) */ }
  }
}

function toggleSection(id: string) {
  if (collapsedSections.value.has(id)) {
    collapsedSections.value.delete(id)
  } else {
    collapsedSections.value.add(id)
  }
  collapsedSections.value = new Set(collapsedSections.value)
}

function isCollapsed(id: string): boolean {
  return collapsedSections.value.has(id)
}

// Persist on change
watch(collapsedSections, (val) => {
  scheduleSave(SETTINGS_COLLAPSE_KEY, JSON.stringify([...val]))
}, { deep: true })

onMounted(() => {
  loadCollapsedState()
})

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
/* ── Panel root ── */
.settings-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0;
}

/* ── Settings group (VS Code flat section) ── */
.settings-group {
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border-secondary);
  border-radius: 0;
  overflow: visible;
}
.settings-group:last-child {
  border-bottom: none;
}

/* ── Group header ── */
.group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px 6px;
  font-size: 0.786rem;
  font-weight: 600;
  color: var(--text-secondary);
  background: transparent;
  border-bottom: none;
  user-select: none;
  cursor: pointer;
  transition: color 0.15s;
}
.group-header:hover {
  color: var(--text-primary);
}

.group-chevron {
  color: var(--text-tertiary);
  flex-shrink: 0;
  transition: transform 0.15s ease;
}
.group-chevron.collapsed {
  transform: rotate(-90deg);
}

.group-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

/* ── Group body ── */
.group-body {
  padding: 2px 12px 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

/* ── Setting row ── */
.setting-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 26px;
}

.row-label {
  font-size: 0.786rem;
  font-weight: 400;
  width: 52px;
  flex-shrink: 0;
  white-space: nowrap;
  color: var(--text-primary);
}

.row-value {
  font-size: 0.714rem;
  color: var(--text-tertiary);
  min-width: 24px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  flex-shrink: 0;
}

.switch-label {
  font-size: 0.714rem;
  color: var(--text-tertiary);
  min-width: 18px;
  flex-shrink: 0;
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
  border: 2px solid var(--bg-primary);
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
}
.row-slider:hover::-webkit-slider-thumb {
  filter: brightness(1.2);
}

/* ── Color picker ── */
.color-control {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
}

.color-input {
  width: 26px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--border-primary);
  border-radius: 2px;
  cursor: pointer;
  background: transparent;
  flex-shrink: 0;
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
  color: var(--text-tertiary);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 2px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s, border-color 0.15s, color 0.15s;
}
.setting-row:hover .reset-btn,
.reset-btn.show {
  opacity: 1;
}
.reset-btn:hover {
  color: var(--accent-primary);
  border-color: var(--accent-primary);
  background: rgba(0, 122, 204, 0.1);
}

/* Spacer for rows without reset button */
.reset-slot {
  width: 20px;
  flex-shrink: 0;
}

/* ── Toggle switch ── */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 30px;
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
  transition: background 0.15s ease;
  border: 1px solid var(--border-secondary);
}
.toggle-slider::before {
  content: '';
  position: absolute;
  width: 12px;
  height: 12px;
  left: 1px;
  top: 1px;
  background: var(--text-primary);
  border-radius: 50%;
  transition: transform 0.15s ease, background 0.15s ease;
}
.toggle-switch input:checked + .toggle-slider {
  background: var(--accent-primary);
  border-color: var(--accent-primary);
}
.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(14px);
  background: #fff;
}

/* ── Tile source select ── */
.tile-select {
  flex: 1;
  padding: 3px 6px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-secondary);
  border-radius: 2px;
  font-size: 0.786rem;
  cursor: pointer;
  outline: none;
  font-family: inherit;
  transition: border-color 0.15s;
}
.tile-select:hover { border-color: var(--accent-primary); }
.tile-select:focus { border-color: var(--accent-primary); }
.tile-select option { background: var(--bg-secondary); color: var(--text-primary); }

/* ── Action button ── */
.action-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  background: var(--button-bg);
  color: var(--button-fg);
  border: 1px solid transparent;
  border-radius: 2px;
  font-size: 0.786rem;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}
.action-btn:hover {
  background: var(--button-hover);
}
.action-btn.danger {
  color: var(--error);
  border-color: transparent;
  background: transparent;
}
.action-btn.danger:hover {
  background: rgba(220, 38, 38, 0.12);
}

.badge {
  font-size: 0.643rem;
  background: var(--accent-primary);
  color: #fff;
  border-radius: 8px;
  padding: 0 5px;
  min-width: 16px;
  text-align: center;
  font-weight: 600;
  line-height: 16px;
}

/* ── Tools grid ── */
.tools-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 2px 0;
}

.tools-grid .action-btn {
  justify-content: center;
}
</style>
