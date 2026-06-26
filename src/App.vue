<template>
  <div class="app-root" @dragover.prevent="dragOver = true" @dragleave="onDragLeave">
    <!-- Title bar -->
    <TitleBar @menu-action="onMenuAction" @request-close="onRequestClose" />

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
        :tile-sources="tileSources"
        :active-source="activeSource"
        :source-elevations="sourceElevations"
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
        @reset-all-elevations="onResetAllElevations"
        @set-source-elevation="onSetSourceElevation"
        @reset-source-elevation="onResetSourceElevation"
        @switch-tile-source="onSwitchTileSource"
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
          @show-track-detail="onShowTrackDetail"
          @delete-track="onDeleteTrack"
          @view-track-points="onViewTrackPoints"
          @view-status="onMapViewStatus"
        />

        <!-- Drop overlay -->
        <div v-if="dragOver" class="drop-overlay" @drop.prevent="onDrop" @dragleave.prevent="onDragLeave">
          <div class="drop-hint" title="将文件拖放到此处以导入数据">释放文件以导入</div>
        </div>

        <!-- Error toast -->
        <span v-if="errorMsg" class="error-toast">{{ errorMsg }}</span>

        <!-- Back-to-all floating button -->
        <button v-if="isolatedTrackId" class="back-all-btn" @click="onClearIsolation" title="返回查看全部航迹">← 返回全部</button>

        <!-- Batch panel (overlay on editor when open) -->
        <div v-if="batchPanelOpen" class="batch-overlay">
          <div class="batch-overlay-header">
            <span>批量数据管理</span>
            <button class="batch-overlay-close" @click="batchPanelOpen = false" title="关闭批量数据管理面板"><X :size="14" /></button>
          </div>
          <div v-if="batches.length === 0" class="batch-empty">暂无已保存的数据</div>
          <div v-for="b in batches" :key="b.id" class="batch-row" @click="handleLoadBatch(b.id)" title="从数据库加载此批次数据">
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
              title="从数据库中永久删除此批次"
            >
              <span v-if="deletingBatchId === b.id" class="del-spinner"></span>
              <X v-else :size="14" />
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
      :camera-height-km="cameraHeightKm"
      :mouse-longitude="mouseLongitude"
      :mouse-latitude="mouseLatitude"
      :fps="currentFps"
      @toggle-playback="replay.isPlaying.value ? replay.pause() : replay.play()"
      @seek="replay.seek($event)"
      @set-speed="replay.setSpeed($event)"
      @toggle-source="(src: DataSource) => toggleVisible(src)"
      @cycle-theme="cycleTheme"
    />

    <!-- About dialog -->
    <AboutDialog v-if="showAbout" @close="showAbout = false" />
    <ShortcutsDialog v-if="showShortcuts" @close="showShortcuts = false" />
    <DocsDialog v-if="showDocs" @close="showDocs = false" />
    <TrackPointDialog v-if="viewingTrack" :track="viewingTrack" :loading="viewingTrackLoading" @close="closeTrackPointViewer" />

    <!-- No tiles dialog (first launch without offline map data) -->
    <NoTilesDialog v-if="showNoTiles" :app-data-dir="recommendedTileDir" @close="onNoTilesClose" />

    <!-- Confirm dialog (used for close confirmation and other confirmations) -->
    <ConfirmDialog />
    <PromptModal />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import CesiumMap from './components/CesiumMap.vue'
import TitleBar from './components/layout/TitleBar.vue'
import { X } from '@lucide/vue'
import ActivityBar from './components/layout/ActivityBar.vue'
import SideBar from './components/layout/SideBar.vue'
import StatusBar from './components/layout/StatusBar.vue'
import AboutDialog from './components/dialogs/AboutDialog.vue'
import ShortcutsDialog from './components/dialogs/ShortcutsDialog.vue'
import DocsDialog from './components/dialogs/DocsDialog.vue'
import TrackPointDialog from './components/dialogs/TrackPointDialog.vue'
import ConfirmDialog from './components/dialogs/ConfirmDialog.vue'
import NoTilesDialog from './components/dialogs/NoTilesDialog.vue'
import PromptModal from './components/PromptModal.vue'
import { useConfirmDialog } from './composables/useConfirmDialog'
import { ask } from '@tauri-apps/plugin-dialog'
import { viewingTrack, viewingTrackLoading, closeTrackPointViewer, openTrackPointViewer } from './composables/useTrackPointViewer'
import { deletedTrackKeys } from './composables/useTrackManagement'
import { useTrackLoader } from './composables/useTrackLoader'
import { useTracks, trackKey } from './composables/useTracks'
import { setBatchOrder } from './composables/useFileLabels'
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
import { useTileSource } from './composables/useTileSource'
import { loadAllSettings, getRawSetting, flushSaves, scheduleSave } from './composables/useSettingsPersistence'

import { useRuler } from './composables/useRuler'
import { useSpatialLasso } from './composables/useSpatialLasso'
import { resetElevation, getSourceElevationKm, setSourceElevation, resetSourceElevation, applySourceOffsetToTrack, clearAllFileElevations } from './composables/useTrackElevation'
import { applyPersistedOffsets, getFileTimeDelta, applyDeltaToSingleTrack } from './composables/useTrackTimeOffset'
import type { DataSource } from './types/track'

interface Batch {
  id: number; file_name: string; source: string; track_count: number; imported_at: string
}

const mapRef = ref<InstanceType<typeof CesiumMap>>()
const loader = useTrackLoader()
const { tracks, trackCount, selectedId, isolatedTrackId, visibleTrackIds, addTracks, clearAll, setAll, isolateTrack, clearIsolation } = useTracks()
const { filteredTracks, globalTimeRange, hasActiveFilter, setUniversalTimeRange, clearAllTimeRanges } = useTrackFilter()
const { toggle: toggleLabels } = useLabelVisibility()
const { lineWidths, setLineWidth } = useLineWidth()
const { dotScale, setDotScale } = useDotScale()
const { batchPanelOpen } = usePanelStates()
const { visibility, toggle: toggleVisible } = useLayerVisibility()
const { clearAllFlags } = useFlags()
const { activate: activatePanel, isActive } = useActivityBar()
const { cycleTheme } = useTheme()
const { tileSources, activeSource, hasTiles, fetchTileSources, rescanTileSources, setActiveSource, onSourceChanged, getRecommendedDir } = useTileSource()
const errorMsg = ref('')
const batches = ref<Batch[]>([])
const deletingBatchId = ref<number | null>(null)
const showAbout = ref(false)
const showShortcuts = ref(false)
const showDocs = ref(false)
const confirmDialog = useConfirmDialog()
const closeConfirmEnabled = ref(true)
const showNoTiles = ref(false)
const noTilesDismissed = ref(false)
const recommendedTileDir = ref('')
const ruler = useRuler()
const lasso = useSpatialLasso()

const sourceElevations = computed(() => ({
  adsb: getSourceElevationKm('adsb'),
  radar: getSourceElevationKm('radar'),
  radar_raw: getSourceElevationKm('radar_raw'),
}))

// Replay speed is restored from settings in onMounted after loadAllSettings()

function onTimeFilterApply(min: number, max: number) {
  setUniversalTimeRange(min, max)
}

function onTimeFilterClear() {
  clearAllTimeRanges()
}

/** Convert frontend DataSource to DB source string for deletedTrackKeys lookup */
function trackSourceToDbSource(source: string): string {
  switch (source) {
    case 'adsb': return 'ADS-B'
    case 'radar': return 'Radar'
    case 'radar_raw': return 'RadarRaw'
    case 'simulation': return 'Simulation'
    default: return 'ADS-B'
  }
}

const displayTracks = computed(() => {
  // Determine the candidate set
  let candidates: typeof tracks.value
  if (visibleTrackIds.value.size > 0) {
    // Priority 1: Management panel multi-select visible set
    candidates = tracks.value.filter(tr => visibleTrackIds.value.has(trackKey(tr.id, tr.source, tr.fileName)))
  } else if (isolatedTrackId.value) {
    // Priority 2: TrackPanel single isolation
    const t = tracks.value.find(tr => trackKey(tr.id, tr.source, tr.fileName) === isolatedTrackId.value)
    candidates = t ? [t] : []
  } else {
    // Priority 3: Default — show all filtered tracks
    candidates = filteredTracks.value
    // Spatial lasso filter (re-evaluated on every filter change against current positions)
    if (lasso.hasSpatialFilter.value && lasso.filterPolygon.value) {
      candidates = candidates.filter(tr => lasso.doesTrackIntersectPolygon(tr.positions, lasso.filterPolygon.value!))
    }
  }
  // Filter out soft-deleted tracks
  if (deletedTrackKeys.value.size > 0) {
    candidates = candidates.filter(tr => !deletedTrackKeys.value.has(`${tr.id}::${trackSourceToDbSource(tr.source)}::${tr.fileName}`))
  }
  return candidates
})

const replay = useReplay(displayTracks)
const unifiedReplayTime = computed(() =>
  replay.isReplayActive.value ? replay.currentTime.value : null
)

// StatusBar source indicators — with file count info for multi-file sources
const statusSources = computed(() => {
  function fileInfo(src: DataSource) {
    const srcTracks = tracks.value.filter(t => t.source === src)
    const fileSet = new Set(srcTracks.map(t => t.fileName).filter(Boolean))
    return { count: srcTracks.length, fileCount: fileSet.size }
  }
  const adsb = fileInfo('adsb'), radar = fileInfo('radar'), raw = fileInfo('radar_raw')
  return [
    { key: 'adsb' as DataSource, label: 'ADS-B', count: adsb.count, fileCount: adsb.fileCount, visible: visibility.value.adsb },
    { key: 'radar' as DataSource, label: 'Radar', count: radar.count, fileCount: radar.fileCount, visible: visibility.value.radar },
    { key: 'radar_raw' as DataSource, label: 'Raw', count: raw.count, fileCount: raw.fileCount, visible: visibility.value.radar_raw },
  ]
})

const cameraHeightKm = ref(0)
const mouseLongitude = ref(0)
const mouseLatitude = ref(0)
const currentFps = ref(0)

function onMapViewStatus(payload: { cameraHeightKm: number; longitude: number; latitude: number; fps: number }) {
  cameraHeightKm.value = payload.cameraHeightKm
  mouseLongitude.value = payload.longitude
  mouseLatitude.value = payload.latitude
  currentFps.value = payload.fps
}

// ── Close confirmation ──
async function onRequestClose() {
  // Skip dialog if user previously chose "don't show again"
  if (!closeConfirmEnabled.value) {
    await flushSaves()
    getCurrentWindow().close()
    return
  }

  const confirmed = await confirmDialog.show({
    title: '关闭 RadarView',
    message: '确定要关闭 RadarView 吗？\n\n用户做出的一切操作都已存储在记忆中。',
    confirmText: '关闭',
    cancelText: '取消',
    variant: 'default',
    checkboxLabel: '不再提醒',
  })
  if (confirmed) {
    if (confirmDialog.dontShowAgain.value) {
      closeConfirmEnabled.value = false
      scheduleSave('close.confirm_enabled', JSON.stringify(false))
    }
    await flushSaves()
    getCurrentWindow().close()
  }
}

// ── Menu action handler ──
function onMenuAction(action: string) {
  switch (action) {
    case 'import-adsb': handleImportAdsb(); break
    case 'import-radar': handleImportRadar(); break
    case 'import-radar-raw': handleImportRadarRaw(); break
    case 'exit': onRequestClose(); break
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
      ask('确定要清除地图上所有旗标吗？此操作不可撤销。', { title: '清除旗标' }).then(ok => { if (ok) clearAllFlags() })
      break
    }
    case 'about': showAbout.value = true; break
    case 'shortcuts': showShortcuts.value = true; break
    case 'docs': showDocs.value = true; break
  }
}

onMounted(async () => {
  // ── Load persisted user settings FIRST ──
  await loadAllSettings()
  invoke('push_splash_log', { message: '正在应用主题配置...' })

  // Restore persisted replay speed (must be after loadAllSettings because
  // getRawSetting reads from _raw which is empty at module level)
  const savedSpeedRaw = getRawSetting('replay.speed')
  if (savedSpeedRaw) {
    try {
      const v = JSON.parse(savedSpeedRaw)
      if (typeof v === 'number' && v > 0) replay.setSpeed(v)
    } catch { /* keep default */ }
  }

  // Restore "don't show close confirmation again" preference
  const closeConfirmRaw = getRawSetting('close.confirm_enabled')
  if (closeConfirmRaw !== undefined) {
    try { closeConfirmEnabled.value = JSON.parse(closeConfirmRaw) } catch { /* keep default */ }
  }

  // Restore "don't show no-tiles dialog again" preference
  const noTilesRaw = getRawSetting('no_tiles_dialog.dismissed')
  if (noTilesRaw !== undefined) {
    try { noTilesDismissed.value = JSON.parse(noTilesRaw) } catch { /* keep default */ }
  }

  // ── Initialize tile sources ──
  await fetchTileSources()
  invoke('push_splash_log', { message: '发现 ' + tileSources.value.length + ' 个地图源' })
  invoke('push_splash_log', { message: '正在同步默认地图源...' })
  onSourceChanged(() => {
    const info = tileSources.value.find(s => s.file_name === activeSource.value)
    mapRef.value?.switchTileLayer(info?.max_zoom)
  })

  // Sync backend ACTIVE_SOURCE to match persisted (or default) frontend state
  // Without this, the backend always serves sources[0] (alphabetically first),
  // causing a mismatch between the displayed dropdown and actual tiles.
  const resolvedInfo = tileSources.value.find(s => s.file_name === activeSource.value)
  if (resolvedInfo) {
    try {
      await invoke('set_active_tile_source', { fileName: activeSource.value })
    } catch (e) {
      console.error('[App] Failed to sync active tile source on startup:', e)
      // Fallback to first available source if persisted one is missing
      if (tileSources.value.length > 0) {
        activeSource.value = tileSources.value[0].file_name
        await invoke('set_active_tile_source', { fileName: activeSource.value })
      }
    }
  } else {
    // Persisted source no longer available, reset to first
    if (tileSources.value.length > 0) {
      activeSource.value = tileSources.value[0].file_name
      await invoke('set_active_tile_source', { fileName: activeSource.value })
    }
  }

  await nextTick()
  const initInfo = tileSources.value.find(s => s.file_name === activeSource.value)
  invoke('push_splash_log', { message: '正在加载瓦片图层...' })
  mapRef.value?.switchTileLayer(initInfo?.max_zoom)

  invoke('push_splash_log', { message: '正在连接航迹数据库...' })
  // Apply soft-deleted track keys (must be after loadAllSettings, before loading tracks)
  try {
    const { applyDeletedKeys, deletedTrackKeys } = await import('./composables/useTrackManagement')
    applyDeletedKeys()
    // Filter out soft-deleted tracks from persisted load
    const savedRaw = await invoke('load_persisted_tracks') as any[]
    invoke('push_splash_log', { message: '读取到 ' + savedRaw.length + ' 条记录' })
    console.log('[App] load_persisted_tracks returned', savedRaw.length, 'tracks')
    const saved = savedRaw.filter(
      (t: any) => !deletedTrackKeys.value.has(`${t.icao_address}::${t.source}::${t.file_name || ''}`)
    )
    console.log('[App] after soft-delete filter:', saved.length, 'tracks')
    // Save restored selectedId/isolatedTrackId before setAll() wipes them
    invoke('push_splash_log', { message: '过滤后剩余 ' + saved.length + ' 条有效航迹' })
    const savedSelectedId = selectedId.value
    const savedIsolatedId = isolatedTrackId.value

    if (saved.length > 0) {
      setAll(fromBackendTracks(saved))
      applyPersistedOffsets(tracks.value)
    }

    // Restore only if referenced tracks still exist in the loaded data
    if (savedSelectedId) {
      const exists = tracks.value.some(t => trackKey(t.id, t.source, t.fileName) === savedSelectedId)
      if (exists) selectedId.value = savedSelectedId
    }
    if (savedIsolatedId) {
      const exists = tracks.value.some(t => trackKey(t.id, t.source, t.fileName) === savedIsolatedId)
      if (exists) isolatedTrackId.value = savedIsolatedId
    }
  } catch (e) {
    console.error('[App] load_persisted_tracks failed:', e)
  }

  invoke('push_splash_log', { message: '正在恢复管理面板可见集...' })
  // Restore management panel visible track set (must be after tracks are loaded)
  try {
    const { restoreVisibleSet } = await import('./composables/useTrackManagement')
    invoke('push_splash_log', { message: '正在恢复可见航迹...' })
    await restoreVisibleSet()
  } catch (e) {
    console.error('[App] restoreVisibleSet failed:', e)
  }

  await refreshBatches()
  invoke('push_splash_log', { message: '已加载 ' + batches.value.length + ' 个批次' })

  // Background DB save completion → refresh batch list + clear persisting UI
  listen('batch-saved', () => {
    loader.onPersistComplete()
    refreshBatches()
    // Invalidate manage panel cache so next open fetches fresh data
    import('./composables/useTrackManagement').then(m => m.markManageDataStale())
  })

  // Background DB save failure → notify user (silent data loss prevention)
  listen('batch-save-failed', (event: any) => {
    const msg = typeof event.payload === 'string' ? event.payload : '未知错误'
    console.error('[App] batch-save-failed:', msg)
    errorMsg.value = `数据保存失败: ${msg}`
    setTimeout(() => {
      if (errorMsg.value === `数据保存失败: ${msg}`) {
        errorMsg.value = ''
      }
    }, 8000)
  })

  // Flush pending setting saves before the window closes
  window.addEventListener('beforeunload', flushSaves)

  invoke('push_splash_log', { message: '正在注册快捷键...' })
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
    else if (!ctrl && !shift && e.key === 'Escape') {
      if (lasso.active.value) { lasso.clearAll() }
      else if (ruler.active.value) { ruler.deactivate() }
      else { clearIsolation() }
    }
    else if (ctrl && shift && e.key === 'S') { e.preventDefault(); lasso.active.value ? lasso.clearAll() : lasso.activate() }
    else if (ctrl && shift && e.key === 'R') { e.preventDefault(); ruler.toggle() }
    else if (!ctrl && !shift && e.key === 'F12') { e.preventDefault(); /* Dev tools handled by Tauri natively */ }
  })

  invoke('push_splash_log', { message: '启动完成' })
  // Wait for Cesium map to fully initialize before showing main window
  invoke('push_splash_log', { message: '正在初始化三维地图...' })
  await mapRef.value?.whenMapReady()
  invoke('push_splash_log', { message: '三维地图就绪' })
  // Notify Rust: show main window, close splash
  invoke('app_ready').catch(e => console.error('[App] app_ready failed:', e))

  // ── Show no-tiles dialog after main window is visible ──
  if (!hasTiles.value && !noTilesDismissed.value) {
    recommendedTileDir.value = await getRecommendedDir()
    showNoTiles.value = true
  }
})

async function refreshBatches() {
  try {
    batches.value = await invoke('get_batches_cmd')
    setBatchOrder(batches.value)
  } catch (e) {
    console.error('[App] refreshBatches failed:', e)
  }
}

async function restoreDeletedAndRefresh(icaos: string[], dbSource: string, fileName: string) {
  const { restoreSoftDeletedTracks, deletedTrackKeys, useTrackManagement: mgmt } =
    await import('./composables/useTrackManagement')
  console.log(`[import:${dbSource}] before restore — deletedKeys size:`, deletedTrackKeys.value.size)
  const restored = restoreSoftDeletedTracks(icaos, dbSource, fileName)
  console.log(`[import:${dbSource}] after restore — restored:`, restored, 'deletedKeys size:', deletedTrackKeys.value.size)
  if (restored > 0) {
    await mgmt().fetchMetadata()
    console.log(`[import:${dbSource}] fetchMetadata done, rows:`, mgmt().rows.value.length)
  }
}

async function handleImportAdsb() {
  errorMsg.value = ''
  try {
    const result = await loader.loadAdsbFile()
    console.log('[import:ADS-B] loaded', result.length, 'tracks')
    if (result.length) {
      // Apply existing time offsets to newly imported tracks before merging
      for (const t of result) {
        const delta = getFileTimeDelta(t.source, t.fileName)
        if (delta !== 0) applyDeltaToSingleTrack(t, delta)
      }
      if (trackCount.value === 0) setAll(result)
      else addTracks(result)
      autoApplySourceElevation(result)
      await restoreDeletedAndRefresh(result.map(t => t.id), 'ADS-B', result[0]?.fileName || '')
      await nextTick()
    }
    await refreshBatches()
  } catch (e) { errorMsg.value = String(e) }
}

async function handleImportRadar() {
  errorMsg.value = ''
  try {
    const result = await loader.loadRadarFile()
    console.log('[import:Radar] loaded', result.length, 'tracks')
    if (result.length) {
      // Apply existing time offsets to newly imported tracks before merging
      for (const t of result) {
        const delta = getFileTimeDelta(t.source, t.fileName)
        if (delta !== 0) applyDeltaToSingleTrack(t, delta)
      }
      if (trackCount.value === 0) setAll(result)
      else addTracks(result)
      autoApplySourceElevation(result)
      await restoreDeletedAndRefresh(result.map(t => t.id), 'Radar', result[0]?.fileName || '')
    }
    await refreshBatches()
  } catch (e) { errorMsg.value = String(e) }
}

async function handleImportRadarRaw() {
  errorMsg.value = ''
  try {
    const result = await loader.loadRadarRawFile()
    console.log('[import:RadarRaw] loaded', result.length, 'tracks')
    if (result.length) {
      // Apply existing time offsets to newly imported tracks before merging
      for (const t of result) {
        const delta = getFileTimeDelta(t.source, t.fileName)
        if (delta !== 0) applyDeltaToSingleTrack(t, delta)
      }
      if (trackCount.value === 0) setAll(result)
      else addTracks(result)
      autoApplySourceElevation(result)
      await restoreDeletedAndRefresh(result.map(t => t.id), 'RadarRaw', result[0]?.fileName || '')
    }
    await refreshBatches()
  } catch (e) { errorMsg.value = String(e) }
}

async function handleDeleteBatch(id: number) {
  const batch = batches.value.find(b => b.id === id)
  const ok = await ask(`确定从数据库中删除 "${batch?.file_name}"？\n\n该操作不可撤销。`, { title: '删除确认' })
  if (!ok) return
  deletingBatchId.value = id
  try {
    await invoke('delete_batch_cmd', { batchId: id })
    const saved = await invoke('load_persisted_tracks') as any[]
    setAll(fromBackendTracks(saved))
    applyPersistedOffsets(tracks.value)
    await refreshBatches()
    import('./composables/useTrackManagement').then(m => m.markManageDataStale())
  } catch (e) { errorMsg.value = String(e) }
  finally { deletingBatchId.value = null }
}

async function handleLoadBatch(id: number) {
  try {
    const raw = await invoke('load_batch_tracks_cmd', { batchId: id }) as any[]
    if (raw.length) {
      const loaded = fromBackendTracks(raw)
      // Apply existing time offsets before merging into tracks
      for (const t of loaded) {
        const delta = getFileTimeDelta(t.source, t.fileName)
        if (delta !== 0) applyDeltaToSingleTrack(t, delta)
      }
      addTracks(loaded)
      autoApplySourceElevation(loaded)
    }
  } catch (e) { errorMsg.value = String(e) }
}

function onIsolateTrack(compositeKey: string) {
  isolateTrack(compositeKey)
}
function onTrackPick(compositeKey: string | null) {
  if (compositeKey) {
    isolateTrack(compositeKey)
  } else {
    clearIsolation()
  }
}
function onShowTrackDetail(payload: { icao: string; source: string }) {
  // Set filter BEFORE opening panel to avoid race: loadAll() reads filter on mount
  import('./composables/useTrackManagement').then((mod) => {
    const { setFilter } = mod.useTrackManagement()
    setFilter({
      source: (payload.source || undefined) as any,
      searchText: payload.icao,
    })
    if (!isActive('manage')) {
      activatePanel('manage')
    }
  })
}
async function onDeleteTrack(payload: { icao: string; source: string; fileName?: string }) {
  const mod = await import('./composables/useTrackManagement')
  const { deleteTrackByKey } = mod.useTrackManagement()
  await deleteTrackByKey(payload.icao, payload.source as DataSource, payload.fileName || '')
}
function onViewTrackPoints(track: import('./types/track').Track) {
  openTrackPointViewer(track)
}
function onClearIsolation() { clearIsolation() }
async function onClear() {
  replay.pause()
  clearAll()
  // Also clear management panel visible set to prevent stale keys after re-import
  import('./composables/useTrackManagement').then(mod => {
    mod.useTrackManagement().clearVisibleSet()
  })
}
function handleResetView() { mapRef.value?.resetView() }

function onResetAllElevations() {
  for (const t of tracks.value) {
    resetElevation(trackKey(t.id, t.source, t.fileName))
  }
  for (const src of ['adsb', 'radar', 'radar_raw', 'simulation'] as DataSource[]) {
    resetSourceElevation(src, [])
  }
  clearAllFileElevations()
  mapRef.value?.refreshTracks()
}

function onSetSourceElevation(src: DataSource, km: number) {
  setSourceElevation(src, km, tracks.value)
  mapRef.value?.refreshTracks()
}

function onResetSourceElevation(src: DataSource) {
  resetSourceElevation(src, tracks.value)
  mapRef.value?.refreshTracks()
}

/** 对新导入的航迹自动应用其数据源的高度偏移 */
function autoApplySourceElevation(newTracks: import('./types/track').Track[]) {
  for (const t of newTracks) {
    applySourceOffsetToTrack(t)
  }
}
async function onSwitchTileSource(fileName: string) {
  await setActiveSource(fileName)
  const info = tileSources.value.find(s => s.file_name === fileName)
  mapRef.value?.switchTileLayer(info?.max_zoom)
}

async function onNoTilesClose(dontShowAgain: boolean) {
  showNoTiles.value = false
  if (dontShowAgain) {
    noTilesDismissed.value = true
    scheduleSave('no_tiles_dialog.dismissed', JSON.stringify(true))
  }
  // Re-scan in case user placed files while the dialog was open
  const newList = await rescanTileSources()
  if (newList.length > 0) {
    await invoke('set_active_tile_source', { fileName: newList[0].file_name })
    activeSource.value = newList[0].file_name
    mapRef.value?.switchTileLayer(newList[0].max_zoom)
  }
}

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
  min-width: 0;
  overflow: hidden;
}

.editor-area {
  flex: 1;
  min-width: 0;
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
  padding: 4px 14px;
  background: var(--error-bg);
  color: var(--error);
  border: 1px solid var(--error);
  border-radius: 2px;
  font-size: 0.786rem;
  z-index: 20;
  pointer-events: none;
}

/* Back-to-all floating button */
.back-all-btn {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 12px;
  background: var(--accent-primary);
  color: #fff;
  border: none;
  border-radius: 2px;
  font-size: 0.786rem;
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
  border-radius: 3px;
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
