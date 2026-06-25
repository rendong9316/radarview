<template>
  <div class="layer-panel">
    <!-- ═══ 数据源可见性 ═══ -->
    <div class="settings-group">
      <div class="group-header" @click="toggleSection('visibility')">
        <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: collapsedSections.has('visibility') }" />
        <Layers :size="13" class="group-icon" />
        <span>数据源</span><HelpTip text="控制各数据源航迹在地图上的显示或隐藏。关闭后航迹线和终点圆球将不可见，数据仍在内存中。" />
      </div>
      <div class="group-body" v-show="!collapsedSections.has('visibility')">
        <template v-for="item in layerItems" :key="item.source">
          <div class="setting-row" :class="{ 'has-sub': item.files.length > 1 }">
            <span v-if="item.files.length > 1" class="expand-arrow" @click="toggleSourceExpanded(item.source)">
              <ChevronDown :size="10" class="source-chevron" :class="{ collapsed: !expandedSources.has(item.source) }" />
            </span>
            <span v-else class="expand-arrow" style="visibility:hidden"><ChevronDown :size="10" /></span>
            <span class="layer-dot" :style="{ background: item.color }"></span>
            <span class="row-label" :style="{ color: item.color, width: 'auto', flex: 1 }">{{ item.label }}</span>
            <span class="row-value" style="min-width: 24px; text-align: right;">{{ item.count }}</span>
            <label class="toggle-switch" @click.stop>
              <input
                type="checkbox"
                :checked="visibility[item.source]"
                @change="toggleSourceWithFiles(item)"
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div v-if="item.files.length > 1 && expandedSources.has(item.source)" class="file-rows">
            <div v-for="f in item.files" :key="f.fileName" class="setting-row file-row">
              <span class="layer-dot" style="visibility:hidden; width:8px"></span>
              <span class="row-label file-label" :style="{ color: item.color }">{{ f.displayLabel }}</span>
              <span class="row-value" style="min-width: 24px; text-align: right;">{{ f.count }}</span>
              <label class="toggle-switch" @click.stop>
                <input type="checkbox" :checked="f.visible" @change="toggleFile(item.source, f.fileName)" />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- ═══ 行政边界 ═══ -->
    <div class="settings-group">
      <div class="group-header" @click="toggleSection('boundary')">
        <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: collapsedSections.has('boundary') }" />
        <MapIcon :size="13" class="group-icon" />
        <span>行政边界</span><HelpTip text="控制国界、海岸线、省界三种行政边界图层的显示、线宽和颜色。线宽在拖动滑块松手时生效，颜色即时切换。" />
      </div>
      <div class="group-body" v-show="!collapsedSections.has('boundary')">
        <div class="setting-row">
          <span class="row-label" style="color: var(--accent-primary)">国界</span>
          <label class="toggle-switch" title="显示或隐藏国界线图层">
            <input type="checkbox" :checked="boundaryVisible.admin0" @change="setBoundaryVisible('admin0', ($event.target as HTMLInputElement).checked)" />
            <span class="toggle-slider"></span>
          </label>
          <span class="switch-label">{{ boundaryVisible.admin0 ? '开' : '关' }}</span>
        </div>
        <div class="setting-row">
          <span class="row-label" style="color: var(--accent-primary)">海岸</span>
          <label class="toggle-switch" title="显示或隐藏海岸线图层">
            <input type="checkbox" :checked="boundaryVisible.coastline" @change="setBoundaryVisible('coastline', ($event.target as HTMLInputElement).checked)" />
            <span class="toggle-slider"></span>
          </label>
          <span class="switch-label">{{ boundaryVisible.coastline ? '开' : '关' }}</span>
        </div>
        <div class="setting-row">
          <span class="row-label" style="color: var(--accent-primary)">省界</span>
          <label class="toggle-switch" title="显示或隐藏省界线图层">
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
        <span>城市标注</span><HelpTip text="控制城市标注图层的显示。可按城市等级（首都/省会/地级市/主要城市）分别开关，按人口数量过滤，调节圆点大小和标签字号。高级选项中可设置不同相机高度下的可见阈值。" />
      </div>
      <div class="group-body" v-show="!collapsedSections.has('cities')">
        <div class="setting-row">
          <span class="row-label" style="color: var(--accent-primary)">城市图层</span>
          <label class="toggle-switch" title="显示或隐藏城市标注图层">
            <input type="checkbox" :checked="cityLayer.visible" @change="setCityVisible(($event.target as HTMLInputElement).checked)" />
            <span class="toggle-slider"></span>
          </label>
          <span class="switch-label">{{ cityLayer.visible ? '开' : '关' }}</span>
        </div>
        <div class="setting-row">
          <span class="row-label" style="color: var(--accent-primary)">中文标签</span>
          <label class="toggle-switch" title="显示或隐藏城市中文名称标签">
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
        <div class="setting-row advanced-toggle" title="展开高级显示阈值设置" @click="toggleSection('cityAdvanced')">
          <span class="row-label" style="color: var(--accent-primary)">高级</span>
          <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: collapsedSections.has('cityAdvanced') }" />
          <span class="advanced-summary">显示阈值</span><HelpTip text="设置不同等级城市在特定相机高度下的可见范围。相机拉远时低等级城市自动隐藏以提升性能。" />
          <button class="reset-btn show" title="恢复城市显示阈值到默认值" @click.stop="resetCityLod">
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
        <span>瓦片来源</span><HelpTip text="切换地图底图的瓦片数据源。支持在线瓦片（需联网）和离线 MBTiles 文件。" />
      </div>
      <div class="group-body" v-show="!collapsedSections.has('tiles')">
        <div class="setting-row">
          <select class="tile-select" title="切换地图瓦片数据源" :value="activeSource"
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
import { useFileVisibility } from '../composables/useFileVisibility'
import { getFileLabel } from '../composables/useFileLabels'
import { useTracks } from '../composables/useTracks'
import { useBoundaryLayers } from '../composables/useBoundaryLayers'
import { useCityLayer, type CityLevel, type CityLodLevel } from '../composables/useCityLayer'
import { getRawSetting, scheduleSave } from '../composables/useSettingsPersistence'
import HelpTip from './HelpTip.vue'
import { ChevronDown, Layers, Map as MapIcon, MapPin, Globe, RotateCcw } from '@lucide/vue'

defineProps<{
  tileSources: TileSourceInfo[]
  activeSource: string
}>()

defineEmits<{
  switchTileSource: [fileName: string]
}>()

const { visibility, toggle: toggleSource } = useLayerVisibility()
const { isFileVisible, setFileVisible } = useFileVisibility()
const { tracks } = useTracks()
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

/** Which sources have their file sub-list expanded */
const expandedSources = ref<Set<string>>(new Set())

function toggleSourceExpanded(src: string) {
  const next = new Set(expandedSources.value)
  if (next.has(src)) next.delete(src)
  else next.add(src)
  expandedSources.value = next
}

interface LayerItem {
  source: DataSource
  label: string
  color: string
  count: number
  files: FileInfo[]
}
interface FileInfo { fileName: string; displayLabel: string; count: number; visible: boolean }

const layerItems = computed<LayerItem[]>(() => {
  const sourceInfo: { source: DataSource; label: string; color: string }[] = [
    { source: 'adsb', label: 'ADS-B', color: 'var(--source-adsb)' },
    { source: 'radar', label: 'Radar', color: 'var(--source-radar)' },
    { source: 'radar_raw', label: 'Raw', color: 'var(--source-radar_raw)' },
  ]
  return sourceInfo.map(si => {
    const srcTracks = tracks.value.filter(t => t.source === si.source)
    // Group by file
    const fileMap = new Map<string, number>()
    for (const t of srcTracks) {
      const fn = t.fileName || ''
      fileMap.set(fn, (fileMap.get(fn) || 0) + 1)
    }
    const files: FileInfo[] = []
    fileMap.forEach((count: number, fileName: string) => {
      files.push({ fileName, displayLabel: getFileLabel(si.source, fileName), count, visible: isFileVisible(si.source, fileName) })
    })
    return { source: si.source, label: si.label, color: si.color, count: srcTracks.length, files }
  })
})

/** Toggle source visibility */
function toggleSourceWithFiles(item: LayerItem) {
  toggleSource(item.source)
}

function toggleFile(source: DataSource, fileName: string) {
  setFileVisible(source, fileName, !isFileVisible(source, fileName))
}

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

.expand-arrow { width: 10px; flex-shrink: 0; cursor: pointer; display: flex; align-items: center; }
.source-chevron { transition: transform 0.15s ease; }
.source-chevron.collapsed { transform: rotate(-90deg); }
.file-rows { padding-left: 0; }
.file-row { padding-left: 4px; }
.file-label { font-size: 0.714rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

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
