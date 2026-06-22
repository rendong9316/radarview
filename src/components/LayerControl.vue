<template>
  <div class="layer-panel">
    <!-- ═══ 数据源可见性 ═══ -->
    <div class="settings-group">
      <div class="group-header" @click="toggleSection('visibility')">
        <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: collapsedSections.has('visibility') }" />
        <Layers :size="13" class="group-icon" />
        <span>数据源</span>
      </div>
      <div class="group-body" v-show="!collapsedSections.has('visibility')">
        <div
          v-for="item in layerItems"
          :key="item.source"
          class="setting-row"
        >
          <span class="layer-dot" :style="{ background: item.color }"></span>
          <span class="row-label" :style="{ color: item.color, width: 'auto', flex: 1 }">{{ item.label }}</span>
          <span class="row-value" style="min-width: 24px; text-align: right;">{{ item.count }}</span>
          <label class="toggle-switch" @click.stop>
            <input
              type="checkbox"
              :checked="visibility[item.source]"
              @change="toggle(item.source)"
            />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    </div>

    <!-- ═══ 行政边界 ═══ -->
    <div class="settings-group">
      <div class="group-header" @click="toggleSection('boundary')">
        <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: collapsedSections.has('boundary') }" />
        <Map :size="13" class="group-icon" />
        <span>行政边界</span>
      </div>
      <div class="group-body" v-show="!collapsedSections.has('boundary')">
        <div class="setting-row">
          <span class="row-label" style="color: var(--accent-primary)">国界</span>
          <label class="toggle-switch" title="切换国界线显示">
            <input type="checkbox" :checked="boundaryVisible.admin0" @change="setBoundaryVisible('admin0', ($event.target as HTMLInputElement).checked)" />
            <span class="toggle-slider"></span>
          </label>
          <span class="switch-label">{{ boundaryVisible.admin0 ? '开' : '关' }}</span>
        </div>
        <div class="setting-row">
          <span class="row-label" style="color: var(--accent-primary)">海岸</span>
          <label class="toggle-switch" title="切换海岸线显示">
            <input type="checkbox" :checked="boundaryVisible.coastline" @change="setBoundaryVisible('coastline', ($event.target as HTMLInputElement).checked)" />
            <span class="toggle-slider"></span>
          </label>
          <span class="switch-label">{{ boundaryVisible.coastline ? '开' : '关' }}</span>
        </div>
        <div class="setting-row">
          <span class="row-label" style="color: var(--accent-primary)">省界</span>
          <label class="toggle-switch" title="切换省界线显示">
            <input type="checkbox" :checked="boundaryVisible.admin1" @change="setBoundaryVisible('admin1', ($event.target as HTMLInputElement).checked)" />
            <span class="toggle-slider"></span>
          </label>
          <span class="switch-label">{{ boundaryVisible.admin1 ? '开' : '关' }}</span>
        </div>
        <!-- 边界线宽 -->
        <div class="setting-row">
          <span class="row-label">国界线宽</span>
          <input type="range" class="row-slider" min="0.2" max="5.0" step="0.1"
            :value="boundaryWidths.admin0"
            @input="setBoundaryWidth('admin0', Number(($event.target as HTMLInputElement).value))" />
          <span class="row-value">{{ boundaryWidths.admin0.toFixed(1) }}</span>
        </div>
        <div class="setting-row">
          <span class="row-label">海岸线宽</span>
          <input type="range" class="row-slider" min="0.2" max="5.0" step="0.1"
            :value="boundaryWidths.coastline"
            @input="setBoundaryWidth('coastline', Number(($event.target as HTMLInputElement).value))" />
          <span class="row-value">{{ boundaryWidths.coastline.toFixed(1) }}</span>
        </div>
        <div class="setting-row">
          <span class="row-label">省界线宽</span>
          <input type="range" class="row-slider" min="0.2" max="5.0" step="0.1"
            :value="boundaryWidths.admin1"
            @input="setBoundaryWidth('admin1', Number(($event.target as HTMLInputElement).value))" />
          <span class="row-value">{{ boundaryWidths.admin1.toFixed(1) }}</span>
        </div>
        <!-- 边界颜色 -->
        <div class="setting-row">
          <span class="row-label">国界色</span>
          <div class="color-control">
            <input type="color" class="color-input" :value="boundaryColors.admin0"
              @input="setBoundaryColor('admin0', ($event.target as HTMLInputElement).value)" />
            <span class="color-hex">{{ boundaryColors.admin0 }}</span>
          </div>
          <div class="reset-slot"></div>
        </div>
        <div class="setting-row">
          <span class="row-label">海岸色</span>
          <div class="color-control">
            <input type="color" class="color-input" :value="boundaryColors.coastline"
              @input="setBoundaryColor('coastline', ($event.target as HTMLInputElement).value)" />
            <span class="color-hex">{{ boundaryColors.coastline }}</span>
          </div>
          <div class="reset-slot"></div>
        </div>
        <div class="setting-row">
          <span class="row-label">省界色</span>
          <div class="color-control">
            <input type="color" class="color-input" :value="boundaryColors.admin1"
              @input="setBoundaryColor('admin1', ($event.target as HTMLInputElement).value)" />
            <span class="color-hex">{{ boundaryColors.admin1 }}</span>
          </div>
          <div class="reset-slot"></div>
        </div>
      </div>
    </div>

    <!-- ═══ 城市标注 ═══ -->
    <div class="settings-group">
      <div class="group-header" @click="toggleSection('cities')">
        <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: collapsedSections.has('cities') }" />
        <MapPin :size="13" class="group-icon" />
        <span>城市标注</span>
      </div>
      <div class="group-body" v-show="!collapsedSections.has('cities')">
        <div class="setting-row">
          <span class="row-label" style="color: var(--accent-primary)">城市图层</span>
          <label class="toggle-switch" title="切换城市点和标签显示">
            <input type="checkbox" :checked="cityLayer.visible" @change="setCityVisible(($event.target as HTMLInputElement).checked)" />
            <span class="toggle-slider"></span>
          </label>
          <span class="switch-label">{{ cityLayer.visible ? '开' : '关' }}</span>
        </div>
        <div class="setting-row">
          <span class="row-label" style="color: var(--accent-primary)">中文标签</span>
          <label class="toggle-switch" title="切换城市中文标签显示">
            <input type="checkbox" :checked="cityLayer.labels" @change="setCityLabels(($event.target as HTMLInputElement).checked)" />
            <span class="toggle-slider"></span>
          </label>
          <span class="switch-label">{{ cityLayer.labels ? '开' : '关' }}</span>
        </div>
        <div v-for="level in cityLevelRows" :key="level.key" class="setting-row">
          <span class="row-label" style="color: var(--accent-primary)">{{ level.label }}</span>
          <label class="toggle-switch" :title="`切换${level.label}显示`">
            <input
              type="checkbox"
              :checked="cityLayer.levels[level.key]"
              @change="setCityLevelVisible(level.key, ($event.target as HTMLInputElement).checked)"
            />
            <span class="toggle-slider"></span>
          </label>
          <span class="switch-label">{{ cityLayer.levels[level.key] ? '开' : '关' }}</span>
        </div>
        <div class="setting-row">
          <span class="row-label" style="color: var(--accent-primary)">人口下限</span>
          <input type="range" class="row-slider" min="0" max="10000000" step="100000"
            :value="cityLayer.minPopulation"
            @input="setCityMinPopulation(Number(($event.target as HTMLInputElement).value))" />
          <span class="row-value">{{ cityPopulationLabel }}</span>
        </div>
        <div class="setting-row">
          <span class="row-label" style="color: var(--accent-primary)">圆点大小</span>
          <input type="range" class="row-slider" min="2" max="12" step="1"
            :value="cityLayer.pointSize"
            @input="setCityPointSize(Number(($event.target as HTMLInputElement).value))" />
          <span class="row-value">{{ cityLayer.pointSize }}px</span>
        </div>
        <div class="setting-row">
          <span class="row-label" style="color: var(--accent-primary)">标签字号</span>
          <input type="range" class="row-slider" min="9" max="24" step="1"
            :value="cityLayer.fontSize"
            @input="setCityFontSize(Number(($event.target as HTMLInputElement).value))" />
          <span class="row-value">{{ cityLayer.fontSize }}px</span>
        </div>
        <div class="setting-row">
          <span class="row-label" style="color: var(--accent-primary)">圆点颜色</span>
          <div class="color-control">
            <input type="color" class="color-input" :value="cityLayer.color"
              @input="setCityColor(($event.target as HTMLInputElement).value)" />
            <span class="color-hex">{{ cityLayer.color }}</span>
          </div>
          <div class="reset-slot"></div>
        </div>
        <div class="setting-row">
          <span class="row-label" style="color: var(--accent-primary)">标签颜色</span>
          <div class="color-control">
            <input type="color" class="color-input" :value="cityLayer.labelColor"
              @input="setCityLabelColor(($event.target as HTMLInputElement).value)" />
            <span class="color-hex">{{ cityLayer.labelColor }}</span>
          </div>
          <div class="reset-slot"></div>
        </div>
        <div class="setting-row advanced-toggle" @click="toggleSection('cityAdvanced')">
          <span class="row-label" style="color: var(--accent-primary)">高级</span>
          <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: collapsedSections.has('cityAdvanced') }" />
          <span class="advanced-summary">显示阈值</span>
          <button class="reset-btn show" title="恢复默认城市显示阈值" @click.stop="resetCityLod">
            <RotateCcw :size="12" />
          </button>
        </div>
        <div class="advanced-body" v-show="!collapsedSections.has('cityAdvanced')">
          <div v-for="level in cityLodRows" :key="`city-point-${level.key}`" class="setting-row">
            <span class="row-label" style="color: var(--accent-primary)">{{ level.short }}点高</span>
            <input type="range" class="row-slider" min="100000" max="40000000" step="100000"
              :value="cityLayer.lod.pointMaxHeight[level.key]"
              @input="setCityPointMaxHeight(level.key, Number(($event.target as HTMLInputElement).value))" />
            <span class="row-value lod-value">{{ formatCityHeight(cityLayer.lod.pointMaxHeight[level.key]) }}</span>
          </div>
          <div v-for="level in cityLodRows" :key="`city-label-${level.key}`" class="setting-row">
            <span class="row-label" style="color: var(--accent-primary)">{{ level.short }}标高</span>
            <input type="range" class="row-slider" min="100000" max="40000000" step="100000"
              :value="cityLayer.lod.labelMaxHeight[level.key]"
              @input="setCityLabelMaxHeight(level.key, Number(($event.target as HTMLInputElement).value))" />
            <span class="row-value lod-value">{{ formatCityHeight(cityLayer.lod.labelMaxHeight[level.key]) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ 瓦片来源 ═══ -->
    <div class="settings-group">
      <div class="group-header" @click="toggleSection('tiles')">
        <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: collapsedSections.has('tiles') }" />
        <Globe :size="13" class="group-icon" />
        <span>瓦片来源</span>
      </div>
      <div class="group-body" v-show="!collapsedSections.has('tiles')">
        <div class="setting-row">
          <select class="tile-select" :value="activeSource"
            @change="$emit('switchTileSource', ($event.target as HTMLSelectElement).value)">
            <option v-for="ts in tileSources" :key="ts.file_name" :value="ts.file_name">{{ ts.display_name }}</option>
          </select>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import type { DataSource } from '../types/track'
import type { TileSourceInfo } from '../composables/useTileSource'
import { useLayerVisibility } from '../composables/useLayerVisibility'
import { useTracks } from '../composables/useTracks'
import { useBoundaryLayers } from '../composables/useBoundaryLayers'
import { useCityLayer, type CityLevel, type CityLodLevel } from '../composables/useCityLayer'
import { getRawSetting, scheduleSave } from '../composables/useSettingsPersistence'
import { ChevronDown, Layers, Map, MapPin, Globe, RotateCcw } from '@lucide/vue'

defineProps<{
  tileSources: TileSourceInfo[]
  activeSource: string
}>()

defineEmits<{
  switchTileSource: [fileName: string]
}>()

const { visibility, toggle } = useLayerVisibility()
const { tracksBySource } = useTracks()
const { boundaryVisible, boundaryWidths, boundaryColors, setBoundaryVisible, setBoundaryWidth, setBoundaryColor } = useBoundaryLayers()
const {
  cityLayer,
  setCityVisible,
  setCityLabels,
  setCityMinPopulation,
  setCityLevelVisible,
  setCityPointMaxHeight,
  setCityLabelMaxHeight,
  resetCityLod,
  setCityPointSize,
  setCityFontSize,
  setCityColor,
  setCityLabelColor,
} = useCityLayer()

const layerItems = computed(() => [
  { source: 'adsb' as DataSource, label: 'ADS-B', color: 'var(--source-adsb)', count: tracksBySource.value.adsb?.length ?? 0 },
  { source: 'radar' as DataSource, label: 'Radar', color: 'var(--source-radar)', count: tracksBySource.value.radar?.length ?? 0 },
  { source: 'radar_raw' as DataSource, label: 'Raw', color: 'var(--source-radar_raw)', count: tracksBySource.value.radar_raw?.length ?? 0 },
])

const cityLevelRows: { key: CityLevel; label: string }[] = [
  { key: 'capital', label: '首都' },
  { key: 'regional', label: '省会/直辖' },
  { key: 'prefecture', label: '地级市' },
  { key: 'major', label: '主要城市' },
]
const cityLodRows: { key: CityLodLevel; short: string }[] = [
  { key: 'regional', short: '省会' },
  { key: 'prefecture', short: '地级' },
  { key: 'major', short: '主要' },
]
const cityPopulationLabel = computed(() => {
  const value = cityLayer.minPopulation
  if (value <= 0) return '全部'
  if (value >= 10000) return `${Math.round(value / 10000)}万`
  return String(value)
})

function formatCityHeight(value: number) {
  return `${Math.round(value / 1000)}km`
}

// ── Collapsible sections ──
const LAYERS_COLLAPSE_KEY = 'layers.collapsed_sections'
const collapsedSections = ref<Set<string>>(new Set())

function loadCollapsedState() {
  const raw = getRawSetting(LAYERS_COLLAPSE_KEY)
  if (raw) {
    try {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        collapsedSections.value = new Set(arr)
      }
    } catch { /* keep default */ }
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

watch(collapsedSections, (val) => {
  scheduleSave(LAYERS_COLLAPSE_KEY, JSON.stringify([...val]))
}, { deep: true })

onMounted(() => {
  loadCollapsedState()
})
</script>

<style scoped>
/* ── Panel root ── */
.layer-panel {
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

/* ── Layer dot in data source rows ── */
.layer-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* ── Slider ── */
.advanced-toggle {
  margin-top: 4px;
  cursor: pointer;
  color: var(--text-secondary);
}

.advanced-summary {
  flex: 1;
  font-size: 0.714rem;
  color: var(--text-tertiary);
}

.advanced-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 2px 0 4px 0;
}

.lod-value {
  min-width: 46px;
}

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
  cursor: pointer;
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
</style>
