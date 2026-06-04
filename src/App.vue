<template>
  <div class="app-root" @dragover.prevent="dragOver = true" @dragleave="onDragLeave">
    <CesiumMap ref="mapRef" :tracks="displayTracks" :replay-time="unifiedReplayTime" :selected-id="selectedId" :line-widths="lineWidths" :dot-scale="dotScale" @track-pick="onTrackPick" />

    <div v-if="dragOver" class="drop-overlay" @drop.prevent="onDrop" @dragleave.prevent="onDragLeave">
      <div class="drop-hint">释放文件以导入</div>
    </div>

    <button v-if="isolatedTrackId" class="back-all-btn" @click="onClearIsolation">← 返回全部</button>
    <span v-if="errorMsg" class="error-toast">{{ errorMsg }}</span>

    <!-- Unified Right Control Panel -->
    <div class="right-bar">
      <!-- Section: Import -->
      <div class="section" :class="{ collapsed: importCollapsed }">
        <div class="panel-header" @click="importCollapsed = !importCollapsed">
          数据导入 <span class="collapse-icon">{{ importCollapsed ? '+' : '−' }}</span>
        </div>
        <div v-if="!importCollapsed" class="panel-body import-btns">
          <button class="import-btn adsb" @click="handleImportAdsb" :disabled="loader.loading.value || loader.persisting.value">
            <span v-if="loader.loading.value || loader.persisting.value" class="spinner"></span>
            {{ loader.loading.value ? `${loader.progress.value}%` : loader.persisting.value ? '保存中' : 'ADS-B' }}
          </button>
          <button class="import-btn radar" @click="handleImportRadar" :disabled="loader.loading.value || loader.persisting.value">
            <span v-if="loader.loading.value || loader.persisting.value" class="spinner"></span>
            {{ loader.loading.value ? `${loader.progress.value}%` : loader.persisting.value ? '保存中' : 'Radar' }}
          </button>
          <button class="import-btn radar-raw" @click="handleImportRadarRaw" :disabled="loader.loading.value || loader.persisting.value">
            <span v-if="loader.loading.value || loader.persisting.value" class="spinner"></span>
            {{ loader.loading.value ? `${loader.progress.value}%` : loader.persisting.value ? '保存中' : 'Measurement' }}
          </button>
        </div>
      </div>

      <!-- Section: Layers -->
      <LayerControl />

      <!-- Section: Flags -->
      <FlagPanel />

      <!-- Section: Time Filter -->
      <TimeFilterPanel
        :time-range="globalTimeRange"
        :has-active-filter="hasActiveFilter"
        @apply="onTimeFilterApply"
        @clear="onTimeFilterClear"
      />

      <!-- Section: Tools -->
      <div class="section" :class="{ collapsed: toolsCollapsed }">
        <div class="panel-header" @click="toolsCollapsed = !toolsCollapsed">
          工具 <span class="collapse-icon">{{ toolsCollapsed ? '+' : '−' }}</span>
        </div>
        <div v-if="!toolsCollapsed" class="panel-body tools-list">
          <div class="line-width-group">
            <div class="lw-label">线宽调节</div>
            <div class="lw-row" v-for="src in (['adsb','radar','radar_raw'] as DataSource[])" :key="src">
              <span class="lw-src" :class="src">{{ sourceLabel(src) }}</span>
              <input type="range" class="lw-slider" min="0.5" max="8" step="0.5"
                :value="lineWidths[src]"
                @input="setLineWidth(src, Number(($event.target as HTMLInputElement).value))" />
              <span class="lw-val">{{ lineWidths[src] }}</span>
            </div>
          </div>
          <div class="line-width-group">
            <div class="lw-label">圆球直径</div>
            <div class="lw-row" v-for="src in (['adsb','radar','radar_raw'] as DataSource[])" :key="src">
              <span class="lw-src" :class="src">{{ sourceLabel(src) }}</span>
              <input type="range" class="lw-slider" min="0.2" max="3.0" step="0.1"
                :value="dotScale[src]"
                @input="setDotScale(src, Number(($event.target as HTMLInputElement).value))" />
              <span class="lw-val">{{ dotScale[src].toFixed(1) }}</span>
            </div>
          </div>
          <button class="tool-btn" @click="batchPanelOpen = !batchPanelOpen">
            💾 数据{{ batches.length ? ` (${batches.length})` : '' }}
          </button>
          <button class="tool-btn" @click="toggleLabels">{{ showLabels ? '🏷️ 隐藏标签' : '🏷️ 显示标签' }}</button>
          <button class="tool-btn" @click="handleResetView">🔍 重置视角</button>
          <button v-if="trackCount" class="tool-btn danger" @click="onClear">🗑️ 清除显示</button>
        </div>
      </div>

      <!-- Batch management (inside tools section area) -->
      <div v-if="batchPanelOpen" class="batch-panel">
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

    <div class="layout-right">
      <TrackPanel
        :tracks="tracks"
        :selected-id="selectedId"
        :isolated-id="isolatedTrackId"
        @isolate="onIsolateTrack"
        @clear-isolation="onClearIsolation"
      />
    </div>

    <div class="layout-bottom">
      <div v-if="trackCount" class="playback-row unified-row">
        <span class="source-tag unified-tag">Replay</span>
        <PlaybackBar
          :is-playing="replay.isPlaying.value"
          :has-data="replay.hasData.value"
          :progress="replay.progress.value"
          :speed="replay.speed.value"
          :speed-options="replay.speedOptions"
          :current-time-formatted="replay.currentTimeFormatted.value"
          :duration-formatted="replay.durationFormatted.value"
          @toggle="replay.isPlaying.value ? replay.pause() : replay.play()"
          @seek="replay.seek($event)"
          @speed="replay.setSpeed($event)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import CesiumMap from './components/CesiumMap.vue'
import TrackPanel from './components/TrackPanel.vue'
import PlaybackBar from './components/PlaybackBar.vue'
import LayerControl from './components/LayerControl.vue'
import FlagPanel from './components/FlagPanel.vue'
import TimeFilterPanel from './components/TimeFilterPanel.vue'
import { useTrackLoader } from './composables/useTrackLoader'
import { useTracks, trackKey, parseTrackKey } from './composables/useTracks'
import { useReplay } from './composables/useReplay'
import { fromBackendTracks } from './composables/convertTrack'
import { useTrackFilter } from './composables/useTrackFilter'
import { useLabelVisibility } from './composables/useLabelVisibility'
import { useLineWidth } from './composables/useLineWidth'
import { useDotScale } from './composables/useDotScale'
import { usePanelStates } from './composables/usePanelStates'
import { loadAllSettings, getRawSetting, flushSaves } from './composables/useSettingsPersistence'
import type { DataSource } from './types/track'

interface Batch {
  id: number; file_name: string; source: string; track_count: number; imported_at: string
}

const mapRef = ref<InstanceType<typeof CesiumMap>>()
const loader = useTrackLoader()
const { tracks, trackCount, selectedId, isolatedTrackId, addTracks, clearAll, setAll, isolateTrack, clearIsolation } = useTracks()
const { filteredTracks, globalTimeRange, hasActiveFilter, setUniversalTimeRange, clearAllTimeRanges } = useTrackFilter()
const { showLabels, toggle: toggleLabels } = useLabelVisibility()
const { lineWidths, setLineWidth } = useLineWidth()
const { dotScale, setDotScale } = useDotScale()
const { importCollapsed, toolsCollapsed, batchPanelOpen } = usePanelStates()
const errorMsg = ref('')
const batches = ref<Batch[]>([])
const deletingBatchId = ref<number | null>(null)

// Resolve saved replay speed before creating the replay composable
const savedSpeedRaw = getRawSetting('replay.speed')
const initialReplaySpeed = savedSpeedRaw ? (() => { try { const v = JSON.parse(savedSpeedRaw); return typeof v === 'number' && v > 0 ? v : undefined } catch { return undefined } })() : undefined

function sourceLabel(src: DataSource): string {
  const map: Record<DataSource, string> = { adsb: 'ADS-B', radar: 'Radar', radar_raw: 'Raw', simulation: 'Sim' }
  return map[src] ?? src
}

function onTimeFilterApply(min: number, max: number) {
  setUniversalTimeRange(min, max)
}

function onTimeFilterClear() {
  clearAllTimeRanges()
}

const displayTracks = computed(() => {
  if (isolatedTrackId.value) {
    const t = tracks.value.find(tr => trackKey(tr.id, tr.source) === isolatedTrackId.value)
    return t ? [t] : []
  }
  return filteredTracks.value
})

const replay = useReplay(displayTracks, initialReplaySpeed)
const unifiedReplayTime = computed(() =>
  replay.isPlaying.value ? replay.currentTime.value : null
)

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
})

async function refreshBatches() {
  try { batches.value = await invoke('get_batches_cmd') } catch (e) {
    console.error('[App] refreshBatches failed:', e)
  }
}

async function handleImportAdsb() {
  errorMsg.value = ''
  try {
    const t0 = performance.now()
    const result = await loader.loadAdsbFile()
    const t1 = performance.now()
    if (result.length) {
      if (trackCount.value === 0) setAll(result)
      else addTracks(result)
      const t2 = performance.now()
      console.log(`[perf] setAll+reactivity: ${(t2 - t1).toFixed(0)}ms  |  tracks=${result.length}`)
      // Force Vue to flush so Cesium starts rendering now
      await nextTick()
      const t3 = performance.now()
      console.log(`[perf] Cesium first-paint (nextTick after setAll): ${(t3 - t2).toFixed(0)}ms`)
      console.log(`[perf] TOTAL (click→render): ${(t3 - t0).toFixed(0)}ms`)
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
.app-root { width:100vw; height:100vh; display:flex; position:relative; overflow:hidden; }

.drop-overlay { position:absolute; inset:0; z-index:20; background:rgba(0,212,255,0.1); border:3px dashed var(--color-accent); display:flex; align-items:center; justify-content:center; }
.drop-hint { font-size:24px; font-weight:700; color:var(--color-accent); text-shadow:0 0 20px rgba(0,212,255,0.5); }

/* ---- Right control panel ---- */
.right-bar {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 220px;
  max-height: calc(100vh - 64px);
  overflow-y: auto;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* Collapsible section shared style */
.section {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
}

.panel-header {
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-accent);
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  user-select: none;
}

.collapse-icon { font-size: 14px; color: var(--color-text-dim); }

.panel-body { padding: 6px; display: flex; flex-direction: column; gap: 4px; }

/* Import buttons */
.import-btns { flex-direction: row; gap: 4px; }
.import-btn {
  flex: 1;
  padding: 5px 4px;
  border: none;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
  transition: opacity 0.15s;
}
.import-btn.adsb { background:#00d4ff; color:#1a1a2e; }
.import-btn.radar { background:#00ff88; color:#1a1a2e; }
.import-btn.radar-raw { background:#ff8800; color:#1a1a2e; }
.import-btn:hover:not(:disabled) { opacity:0.8; }
.import-btn:disabled { opacity:0.5; cursor:not-allowed; }

.spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  margin-right: 3px;
  vertical-align: middle;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Tools section */
.tools-list { gap: 3px; }
.tool-btn {
  width: 100%;
  padding: 5px 10px;
  background: rgba(255,255,255,0.06);
  color: var(--color-text-dim);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s;
}
.tool-btn:hover { background: rgba(255,255,255,0.12); }
.tool-btn.danger { color: #f88; border-color: rgba(255,100,100,0.2); }
.tool-btn.danger:hover { background: rgba(255,80,80,0.15); }

/* Line width controls */
.line-width-group {
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 4px;
  padding: 4px 6px;
  margin-bottom: 4px;
}
.lw-label {
  font-size: 9px;
  color: var(--color-text-dim);
  margin-bottom: 2px;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.lw-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 2px;
}
.lw-src {
  font-size: 10px;
  font-weight: 600;
  width: 36px;
  flex-shrink: 0;
}
.lw-src.adsb { color: #00d4ff; }
.lw-src.radar { color: #00ff88; }
.lw-src.radar_raw { color: #ff8800; }
.lw-src.simulation { color: #aaa; }
.lw-slider {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255,255,255,0.1);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}
.lw-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #00d4ff;
  cursor: pointer;
}
.lw-val {
  font-size: 10px;
  color: var(--color-text-dim);
  width: 20px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* Back-to-all floating button */
.back-all-btn {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 16px;
  background: rgba(0,212,255,0.15);
  color: #00d4ff;
  border: 1px solid rgba(0,212,255,0.3);
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  z-index: 10;
}
.back-all-btn:hover { background: rgba(0,212,255,0.25); }

/* Error toast */
.error-toast {
  position: absolute;
  bottom: 60px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 16px;
  background: rgba(255,60,60,0.2);
  color: #f66;
  border: 1px solid rgba(255,60,60,0.4);
  border-radius: 6px;
  font-size: 11px;
  z-index: 20;
  pointer-events: none;
}

/* Batch panel */
.batch-panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 6px;
  max-height: 200px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.batch-empty { color:var(--color-text-dim); font-size:11px; text-align:center; padding:6px 0; }
.batch-row { display:flex; align-items:center; justify-content:space-between; padding:3px 0; border-bottom:1px solid rgba(255,255,255,0.04); cursor:pointer; }
.batch-row:hover { background:rgba(255,255,255,0.03); }
.batch-info { display:flex; flex-direction:column; gap:1px; min-width:0; }
.batch-src { font-size:9px; padding:0 4px; border-radius:3px; width:fit-content; }
.batch-src.ads-b { background:rgba(0,212,255,0.2); color:#0ff; }
.batch-src.radar { background:rgba(0,255,136,0.2); color:#0f0; }
.batch-file { font-size:11px; color:var(--color-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.batch-meta { font-size:9px; color:var(--color-text-dim); }
.batch-del { background:none; border:none; color:#f66; font-size:14px; cursor:pointer; padding:0 4px; line-height:1; display:flex; align-items:center; }
.batch-del:hover:not(:disabled) { color:#f00; }
.batch-del:disabled { cursor:not-allowed; }
.del-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255,100,100,0.3);
  border-top-color: #f66;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

.layout-right { z-index:5; display:flex; flex-shrink:0; }

.layout-bottom { position:absolute; bottom:0; left:0; right:0; z-index:5; display:flex; flex-direction:column; }
.playback-row { display:flex; align-items:center; gap:0; }
.unified-tag { background:rgba(0,212,255,0.12); color:#00d4ff; padding:0 10px; font-size:11px; font-weight:700; min-width:56px; text-align:center; flex-shrink:0; height:48px; display:flex; align-items:center; justify-content:center; }
.playback-row > :deep(.playback-bar) { flex:1; }
</style>
