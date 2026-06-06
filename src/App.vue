<template>
  <div class="app-root" @dragover.prevent="dragOver = true" @dragleave="onDragLeave">
    <!-- Title bar -->
    <TitleBar @menu-action="onMenuAction" />

    <!-- Main area: ActivityBar + SideBar + Editor -->
    <div class="app-main">
      <ActivityBar />
      <SideBar
        :tracks="tracks"
        :selected-id="selectedId"
        :isolated-track-id="isolatedTrackId"
        :time-range="globalTimeRange"
        :has-active-filter="hasActiveFilter"
        :line-widths="lineWidths"
        :dot-scale="dotScale"
        :batch-count="batches.length"
        :track-count="trackCount"
        @isolate="onIsolateTrack"
        @clear-isolation="onClearIsolation"
        @time-filter-apply="onTimeFilterApply"
        @time-filter-clear="onTimeFilterClear"
        @set-line-width="setLineWidth"
        @set-dot-scale="setDotScale"
        @toggle-batch-panel="batchPanelOpen = !batchPanelOpen"
        @toggle-labels="toggleLabels"
        @reset-view="handleResetView"
        @clear-all="onClear"
      />

      <!-- Editor area (CesiumMap) -->
      <div class="editor-area">
        <CesiumMap
          ref="mapRef"
          :tracks="displayTracks"
          :replay-time="unifiedReplayTime"
          :selected-id="selectedId"
          :line-widths="lineWidths"
          :dot-scale="dotScale"
          @track-pick="onTrackPick"
        />

        <!-- Drop overlay -->
        <div v-if="dragOver" class="drop-overlay" @drop.prevent="onDrop" @dragleave.prevent="onDragLeave">
          <div class="drop-hint">释放文件以导入</div>
        </div>

        <!-- Error toast -->
        <span v-if="errorMsg" class="error-toast">{{ errorMsg }}</span>

        <!-- Back-to-all floating button -->
        <button v-if="isolatedTrackId" class="back-all-btn" @click="onClearIsolation">← 返回全部</button>

        <!-- Batch panel (overlay on editor when open) -->
        <div v-if="batchPanelOpen" class="batch-overlay">
          <div class="batch-overlay-header">
            <span>批量数据管理</span>
            <button class="batch-overlay-close" @click="batchPanelOpen = false">✕</button>
          </div>
          <div v-if="batches.length === 0" class="batch-empty">暂无已保存的数据</div>
          <div v-for="b in batches" :key="b.id" class="batch-row" @click="handleLoadBatch(b.id)" title="点击加载">
            <div class="batch-info">
              <span class="batch-src" :class="b.source.toLowerCase()">{{ b.source }}</span>
              <span class="batch-file">{{ b.file_name }}</span>
              <span class="batch-meta">{{ b.track_count }} tracks · {{ b.imported_at }}</span>
            </div>
            <button
              class="batch-del"
              :class="{ deleting: deletingBatchId === b.id }"
              @click.stop="handleDeleteBatch(b.id)"
              :disabled="deletingBatchId !== null"
              title="从数据库中删除"
            >
              <span v-if="deletingBatchId === b.id" class="del-spinner"></span>
              <span v-else>×</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Status bar -->
    <StatusBar
      :is-playing="replay.isPlaying.value"
      :has-data="replay.hasData.value"
      :progress="replay.progress.value"
      :speed="replay.speed.value"
      :speed-options="(replay.speedOptions as unknown) as number[]"
      :current-time-formatted="replay.currentTimeFormatted.value"
      :duration-formatted="replay.durationFormatted.value"
      :track-count="trackCount"
      :error-msg="errorMsg"
      :sources="statusSources"
      :loading="loader.loading.value"
      :loading-progress="loader.progress.value"
      :persisting="loader.persisting.value"
      @toggle-playback="replay.isPlaying.value ? replay.pause() : replay.play()"
      @seek="replay.seek($event)"
      @set-speed="replay.setSpeed($event)"
      @toggle-source="(src: DataSource) => toggleVisible(src)"
      @cycle-theme="cycleTheme"
    />

    <!-- About dialog -->
    <AboutDialog v-if="showAbout" @close="showAbout = false" />
    <ShortcutsDialog v-if="showShortcuts" @close="showShortcuts = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import CesiumMap from './components/CesiumMap.vue'
import TitleBar from './components/layout/TitleBar.vue'
import ActivityBar from './components/layout/ActivityBar.vue'
import SideBar from './components/layout/SideBar.vue'
import StatusBar from './components/layout/StatusBar.vue'
import AboutDialog from './components/dialogs/AboutDialog.vue'
import ShortcutsDialog from './components/dialogs/ShortcutsDialog.vue'
import { useTrackLoader } from './composables/useTrackLoader'
import { useTracks, trackKey, parseTrackKey } from './composables/useTracks'
import { useReplay } from './composables/useReplay'
import { fromBackendTracks } from './composables/convertTrack'
import { useTrackFilter } from './composables/useTrackFilter'
import { useLabelVisibility } from './composables/useLabelVisibility'
import { useLineWidth } from './composables/useLineWidth'
import { useDotScale } from './composables/useDotScale'
import { usePanelStates } from './composables/usePanelStates'
import { useLayerVisibility } from './composables/useLayerVisibility'
import { useFlags } from './composables/useFlags'
import { useActivityBar } from './composables/useActivityBar'
import { useTheme } from './composables/useTheme'
import { loadAllSettings, getRawSetting, flushSaves } from './composables/useSettingsPersistence'
import { useTracks as useTracksModule } from './composables/useTracks'
import type { DataSource } from './types/track'

interface Batch {
  id: number; file_name: string; source: string; track_count: number; imported_at: string
}

const mapRef = ref<InstanceType<typeof CesiumMap>>()
const loader = useTrackLoader()
const { tracks, trackCount, selectedId, isolatedTrackId, visibleTrackIds, addTracks, clearAll, setAll, isolateTrack, clearIsolation } = useTracks()
const { tracksBySource } = useTracksModule()
const { filteredTracks, globalTimeRange, hasActiveFilter, setUniversalTimeRange, clearAllTimeRanges } = useTrackFilter()
const { toggle: toggleLabels } = useLabelVisibility()
const { lineWidths, setLineWidth } = useLineWidth()
const { dotScale, setDotScale } = useDotScale()
const { batchPanelOpen } = usePanelStates()
const { visibility, toggle: toggleVisible } = useLayerVisibility()
const { clearAllFlags } = useFlags()
const { activate: activatePanel } = useActivityBar()
const { cycleTheme } = useTheme()
const errorMsg = ref('')
const batches = ref<Batch[]>([])
const deletingBatchId = ref<number | null>(null)
const showAbout = ref(false)
const showShortcuts = ref(false)

// Resolve saved replay speed before creating the replay composable
const savedSpeedRaw = getRawSetting('replay.speed')
const initialReplaySpeed = savedSpeedRaw ? (() => { try { const v = JSON.parse(savedSpeedRaw); return typeof v === 'number' && v > 0 ? v : undefined } catch { return undefined } })() : undefined

function onTimeFilterApply(min: number, max: number) {
  setUniversalTimeRange(min, max)
}

function onTimeFilterClear() {
  clearAllTimeRanges()
}

const displayTracks = computed(() => {
  // Priority 1: Management panel multi-select visible set
  if (visibleTrackIds.value.size > 0) {
    return tracks.value.filter(tr => visibleTrackIds.value.has(trackKey(tr.id, tr.source)))
  }
  // Priority 2: TrackPanel single isolation
  if (isolatedTrackId.value) {
    const t = tracks.value.find(tr => trackKey(tr.id, tr.source) === isolatedTrackId.value)
    return t ? [t] : []
  }
  // Priority 3: Default — show all filtered tracks
  return filteredTracks.value
})

const replay = useReplay(displayTracks, initialReplaySpeed)
const unifiedReplayTime = computed(() =>
  replay.isReplayActive.value ? replay.currentTime.value : null
)

// StatusBar source indicators
const statusSources = computed(() => [
  { key: 'adsb' as DataSource, label: 'ADS-B', count: tracksBySource.value.adsb?.length ?? 0, visible: visibility.value.adsb },
  { key: 'radar' as DataSource, label: 'Radar', count: tracksBySource.value.radar?.length ?? 0, visible: visibility.value.radar },
  { key: 'radar_raw' as DataSource, label: 'Raw', count: tracksBySource.value.radar_raw?.length ?? 0, visible: visibility.value.radar_raw },
])

// ── Menu action handler ──
function onMenuAction(action: string) {
  switch (action) {
    case 'import-adsb': handleImportAdsb(); break
    case 'import-radar': handleImportRadar(); break
    case 'import-radar-raw': handleImportRadarRaw(); break
    case 'exit': getCurrentWindow().close(); break
    case 'clear-selection': clearIsolation(); break
    case 'open-settings': activatePanel('settings'); break
    case 'toggle-track-panel': activatePanel('tracks'); break
    case 'toggle-manage-panel': activatePanel('manage'); break
    case 'toggle-layer-panel': activatePanel('layers'); break
    case 'toggle-flag-panel': case 'open-flags': activatePanel('flags'); break
    case 'toggle-time-filter': activatePanel('timeFilter'); break
    case 'reset-view': handleResetView(); break
    case 'toggle-labels': toggleLabels(); break
    case 'toggle-batch-panel': batchPanelOpen.value = !batchPanelOpen.value; break
    case 'clear-all-flags': {
      if (confirm('确定要清除地图上所有旗标吗？此操作不可撤销。')) clearAllFlags()
      break
    }
    case 'about': showAbout.value = true; break
    case 'shortcuts': showShortcuts.value = true; break
    case 'docs': {
      import('@tauri-apps/plugin-opener').then(({ openUrl }) => {
        openUrl('https://github.com/rendong9316/RadarView_BiuldByTauri')
      })
      break
    }
  }
}

onMounted(async () => {
  // ── Load persisted user settings FIRST ──
  await loadAllSettings()

  try {
    const saved = await invoke('load_persisted_tracks') as any[]
    console.log('[App] load_persisted_tracks returned', saved.length, 'tracks')
    if (saved.length > 0) setAll(fromBackendTracks(saved))
  } catch (e) {
    console.error('[App] load_persisted_tracks failed:', e)
  }
  await refreshBatches()

  // Background DB save completion → refresh batch list + clear persisting UI
  listen('batch-saved', () => {
    loader.onPersistComplete()
    refreshBatches()
  })

  // Flush pending setting saves before the window closes
  window.addEventListener('beforeunload', flushSaves)

  // ── Keyboard shortcuts ──
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey
    const shift = e.shiftKey

    if (ctrl && !shift && e.key === 'o') { e.preventDefault(); handleImportAdsb() }
    else if (ctrl && shift && e.key === 'O') { e.preventDefault(); handleImportRadar() }
    else if (ctrl && !shift && e.key === 'r') { e.preventDefault(); handleResetView() }
    else if (ctrl && !shift && e.key === 't') { e.preventDefault(); toggleLabels() }
    else if (ctrl && shift && e.key === 'T') { e.preventDefault(); activatePanel('tracks') }
    else if (ctrl && shift && e.key === 'M') { e.preventDefault(); activatePanel('manage') }
    else if (ctrl && shift && e.key === 'L') { e.preventDefault(); activatePanel('layers') }
    else if (ctrl && shift && e.key === 'F') { e.preventDefault(); activatePanel('flags') }
    else if (ctrl && shift && e.key === 'E') { e.preventDefault(); activatePanel('timeFilter') }
    else if (ctrl && !shift && e.key === ',') { e.preventDefault(); activatePanel('settings') }
    else if (!ctrl && !shift && e.key === 'Escape') { clearIsolation() }
    else if (!ctrl && !shift && e.key === 'F12') { e.preventDefault(); /* Dev tools handled by Tauri natively */ }
  })
})

async function refreshBatches() {
  try { batches.value = await invoke('get_batches_cmd') } catch (e) {
    console.error('[App] refreshBatches failed:', e)
  }
}

async function handleImportAdsb() {
  errorMsg.value = ''
  try {
    const result = await loader.loadAdsbFile()
    if (result.length) {
      if (trackCount.value === 0) setAll(result)
      else addTracks(result)
      await nextTick()
    }
    await refreshBatches()
  } catch (e) {
    errorMsg.value = String(e)
  }
}

async function handleImportRadar() {
  errorMsg.value = ''
  try {
    const result = await loader.loadRadarFile()
    if (result.length) {
      if (trackCount.value === 0) setAll(result)
      else addTracks(result)
    }
    await refreshBatches()
  } catch (e) { errorMsg.value = String(e) }
}

async function handleImportRadarRaw() {
  errorMsg.value = ''
  try {
    const result = await loader.loadRadarRawFile()
    if (result.length) {
      if (trackCount.value === 0) setAll(result)
      else addTracks(result)
    }
    await refreshBatches()
  } catch (e) { errorMsg.value = String(e) }
}

async function handleDeleteBatch(id: number) {
  const batch = batches.value.find(b => b.id === id)
  if (!confirm(`确定从数据库中删除 "${batch?.file_name}"？\n\n该操作不可撤销。`)) return
  deletingBatchId.value = id
  try {
    await invoke('delete_batch_cmd', { batchId: id })
    const saved = await invoke('load_persisted_tracks') as any[]
    setAll(fromBackendTracks(saved))
    await refreshBatches()
  } catch (e) { errorMsg.value = String(e) }
  finally { deletingBatchId.value = null }
}

async function handleLoadBatch(id: number) {
  try {
    const raw = await invoke('load_batch_tracks_cmd', { batchId: id }) as any[]
    if (raw.length) addTracks(fromBackendTracks(raw))
  } catch (e) { errorMsg.value = String(e) }
}

function onIsolateTrack(compositeKey: string) {
  const { id, source } = parseTrackKey(compositeKey)
  isolateTrack(id, source)
}
function onTrackPick(compositeKey: string | null) {
  if (compositeKey) {
    const { id, source } = parseTrackKey(compositeKey)
    isolateTrack(id, source)
  } else {
    clearIsolation()
  }
}
function onClearIsolation() { clearIsolation() }
function onClear() { replay.pause(); clearAll() }
function handleResetView() { mapRef.value?.resetView() }

const dragOver = ref(false)
let dragCounter = 0
function onDragLeave() { dragCounter--; if (dragCounter <= 0) { dragOver.value = false; dragCounter = 0 } }
async function onDrop(_e: DragEvent) { dragOver.value = false; dragCounter = 0 }
</script>

<style scoped>
.app-root {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.app-main {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.editor-area {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: var(--editor-bg);
}

/* Drop overlay */
.drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  background: rgba(0, 212, 255, 0.1);
  border: 3px dashed var(--accent-primary);
  display: flex;
  align-items: center;
  justify-content: center;
}
.drop-hint {
  font-size: 1.714rem;
  font-weight: 700;
  color: var(--accent-primary);
  text-shadow: 0 0 20px rgba(0, 212, 255, 0.5);
}

/* Error toast */
.error-toast {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 16px;
  background: var(--error-bg);
  color: var(--error);
  border: 1px solid var(--error);
  border-radius: 4px;
  font-size: 0.857rem;
  z-index: 20;
  pointer-events: none;
}

/* Back-to-all floating button */
.back-all-btn {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  padding: 5px 14px;
  background: var(--accent-primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 0.857rem;
  font-weight: 600;
  cursor: pointer;
  z-index: 10;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}
.back-all-btn:hover {
  opacity: 0.9;
}

/* Batch overlay */
.batch-overlay {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 300px;
  max-height: 400px;
  overflow-y: auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  z-index: 10;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

.batch-overlay-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-size: 0.857rem;
  font-weight: 600;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-primary);
}

.batch-overlay-close {
  font-size: 1rem;
  color: var(--text-tertiary);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0 4px;
}
.batch-overlay-close:hover {
  color: var(--text-primary);
}

.batch-empty {
  color: var(--text-tertiary);
  font-size: 0.786rem;
  text-align: center;
  padding: 12px 0;
}

.batch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-secondary);
  cursor: pointer;
}
.batch-row:hover {
  background: var(--button-hover);
}

.batch-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.batch-src {
  font-size: 0.643rem;
  padding: 0 4px;
  border-radius: 3px;
  width: fit-content;
  font-weight: 600;
}
.batch-src.ads-b {
  background: rgba(0, 212, 255, 0.2);
  color: var(--source-adsb);
}

.batch-file {
  font-size: 0.786rem;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.batch-meta {
  font-size: 0.643rem;
  color: var(--text-tertiary);
}

.batch-del {
  background: none;
  border: none;
  color: var(--error);
  font-size: 1rem;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.batch-del:hover:not(:disabled) {
  opacity: 0.8;
}
.batch-del:disabled {
  cursor: not-allowed;
}

.del-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 100, 100, 0.3);
  border-top-color: var(--error);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
