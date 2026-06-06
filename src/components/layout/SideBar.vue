<template>
  <aside v-if="sidebarVisible" class="sidebar" :style="{ width: `${sidebarWidth}px` }">
    <!-- Header -->
    <div class="sidebar-header">
      <span class="sidebar-title">{{ panelTitle }}</span>
      <button class="sidebar-close" @click="close" title="关闭侧边栏">✕</button>
    </div>

    <!-- Panel content -->
    <div class="sidebar-body">
      <TrackPanel
        v-if="activePanel === 'tracks'"
        :tracks="tracks"
        :selected-id="selectedId"
        :isolated-id="isolatedTrackId"
        @isolate="(key: string) => emit('isolate', key)"
        @clear-isolation="emit('clearIsolation')"
      />
      <ManagePanel v-else-if="activePanel === 'manage'" />
      <LayerControl v-else-if="activePanel === 'layers'" />
      <FlagPanel v-else-if="activePanel === 'flags'" />
      <TimeFilterPanel
        v-else-if="activePanel === 'timeFilter'"
        :time-range="timeRange"
        :has-active-filter="hasActiveFilter"
        @apply="(min: number, max: number) => emit('timeFilterApply', min, max)"
        @clear="emit('timeFilterClear')"
      />
      <SettingsPanel
        v-else-if="activePanel === 'settings'"
        :line-widths="lineWidths"
        :dot-scale="dotScale"
        :batch-count="batchCount"
        :track-count="trackCount"
        @set-line-width="(src: DataSource, v: number) => emit('setLineWidth', src, v)"
        @set-dot-scale="(src: DataSource, v: number) => emit('setDotScale', src, v)"
        @toggle-batch-panel="emit('toggleBatchPanel')"
        @toggle-labels="emit('toggleLabels')"
        @reset-view="emit('resetView')"
        @clear-all="emit('clearAll')"
      />
    </div>

    <!-- Resize handle -->
    <div class="sidebar-resize" @mousedown="onResizeStart" />
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useActivityBar, type PanelId } from '../../composables/useActivityBar'
import TrackPanel from '../TrackPanel.vue'
import LayerControl from '../LayerControl.vue'
import FlagPanel from '../FlagPanel.vue'
import TimeFilterPanel from '../TimeFilterPanel.vue'
import SettingsPanel from '../panels/SettingsPanel.vue'
import ManagePanel from '../panels/ManagePanel.vue'
import type { Track, DataSource } from '../../types/track'

defineProps<{
  tracks: Track[]
  selectedId: string | null
  isolatedTrackId: string | null
  timeRange: { min: number; max: number } | null
  hasActiveFilter: boolean
  lineWidths: Record<DataSource, number>
  dotScale: Record<DataSource, number>
  batchCount: number
  trackCount: number
}>()

const emit = defineEmits<{
  isolate: [key: string]
  clearIsolation: []
  timeFilterApply: [min: number, max: number]
  timeFilterClear: []
  setLineWidth: [src: DataSource, v: number]
  setDotScale: [src: DataSource, v: number]
  toggleBatchPanel: []
  toggleLabels: []
  resetView: []
  clearAll: []
}>()

const { activePanel, sidebarVisible, sidebarWidth, close } = useActivityBar()
const MIN_WIDTH = 200
const MAX_WIDTH = 900

const panelTitles: Record<PanelId, string> = {
  tracks: '轨迹面板',
  manage: '航迹管理系统',
  layers: '图层控制',
  flags: '旗标面板',
  timeFilter: '筛选',
  settings: '设置',
}

const panelTitle = computed(() => {
  return activePanel.value ? panelTitles[activePanel.value] : ''
})

// ── Resize ──
let resizeStartX = 0
let resizeStartWidth = 0

function onResizeStart(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  resizeStartX = e.clientX
  resizeStartWidth = sidebarWidth.value
  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', onResizeEnd)
}

function onResizeMove(e: MouseEvent) {
  const dx = e.clientX - resizeStartX
  sidebarWidth.value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, resizeStartWidth + dx))
}

function onResizeEnd() {
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
}
</script>

<style scoped>
.sidebar {
  background: var(--sidebar-bg);
  border-right: 1px solid var(--sidebar-border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  position: relative;
  z-index: 10;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  height: 32px;
  border-bottom: 1px solid var(--sidebar-border);
  flex-shrink: 0;
}

.sidebar-title {
  font-size: 0.786rem;
  font-weight: 600;
  color: var(--sidebar-header);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.sidebar-close {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.857rem;
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  border-radius: 3px;
  cursor: pointer;
}
.sidebar-close:hover {
  color: var(--text-primary);
  background: var(--button-hover);
}

.sidebar-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.sidebar-resize {
  position: absolute;
  top: 0;
  right: -2px;
  width: 4px;
  height: 100%;
  cursor: col-resize;
  z-index: 5;
}
.sidebar-resize:hover {
  background: var(--accent-primary);
}
</style>
