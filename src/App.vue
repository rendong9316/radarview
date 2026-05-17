<template>
  <div class="app-root" @dragover.prevent="dragOver = true" @dragleave="onDragLeave">
    <CesiumMap ref="mapRef" :tracks="displayTracks" :replay-time="unifiedReplayTime" :selected-id="selectedId" @track-pick="onTrackPick" />

    <div v-if="dragOver" class="drop-overlay" @drop.prevent="onDrop" @dragleave.prevent="onDragLeave">
      <div class="drop-hint">释放文件以导入</div>
    </div>

    <LayerControl />

    <div class="right-bar">
      <FlagPanel />
      <TimeFilterPanel
        :time-range="globalTimeRange"
        :has-active-filter="hasActiveFilter"
        @apply="onTimeFilterApply"
        @clear="onTimeFilterClear"
      />
      <button v-if="isolatedTrackId" class="side-btn back-all-btn" @click="onClearIsolation">
        返回全部航迹
      </button>
      <button class="side-btn adsb-btn" @click="handleImportAdsb" :disabled="loader.loading.value">
        {{ loader.loading.value ? `Importing ${loader.progress.value}%` : 'Import ADS-B' }}
      </button>
      <button class="side-btn radar-btn" @click="handleImportRadar" :disabled="loader.loading.value">
        {{ loader.loading.value ? `Importing ${loader.progress.value}%` : 'Import Radar' }}
      </button>
      <button v-if="trackCount" class="side-btn clear-btn" @click="onClear">Clear Display</button>
      <button class="side-btn util-btn" @click="showBatchPanel = !showBatchPanel">
        {{ showBatchPanel ? 'Hide Saved' : `Saved Data${batches.length ? ' ('+batches.length+')' : ''}` }}
      </button>
      <button class="side-btn util-btn" @click="toggleLabels">{{ showLabels ? 'Hide Labels' : 'Show Labels' }}</button>
      <button class="side-btn util-btn" @click="handleResetView">Reset View</button>
      <span v-if="errorMsg" class="error-msg">{{ errorMsg }}</span>

      <!-- Batch management panel -->
      <div v-if="showBatchPanel" class="batch-panel">
        <div v-if="batches.length === 0" class="batch-empty">No saved data in DB</div>
        <div v-for="b in batches" :key="b.id" class="batch-row" @click="handleLoadBatch(b.id)" title="Click to load">
          <div class="batch-info">
            <span class="batch-src" :class="b.source.toLowerCase()">{{ b.source }}</span>
            <span class="batch-file">{{ b.file_name }}</span>
            <span class="batch-meta">{{ b.track_count }} tracks · {{ b.imported_at }}</span>
          </div>
          <button class="batch-del" @click.stop="handleDeleteBatch(b.id)" title="Delete from database">×</button>
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
import { ref, computed, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import CesiumMap from './components/CesiumMap.vue'
import TrackPanel from './components/TrackPanel.vue'
import PlaybackBar from './components/PlaybackBar.vue'
import LayerControl from './components/LayerControl.vue'
import FlagPanel from './components/FlagPanel.vue'
import TimeFilterPanel from './components/TimeFilterPanel.vue'
import { useTrackLoader } from './composables/useTrackLoader'
import { useTracks } from './composables/useTracks'
import { useReplay } from './composables/useReplay'
import { fromBackendTracks } from './composables/convertTrack'
import { useTrackFilter } from './composables/useTrackFilter'
import { useLabelVisibility } from './composables/useLabelVisibility'

interface Batch {
  id: number; file_name: string; source: string; track_count: number; imported_at: string
}

const mapRef = ref<InstanceType<typeof CesiumMap>>()
const loader = useTrackLoader()
const { tracks, trackCount, selectedId, isolatedTrackId, addTracks, clearAll, setAll, isolateTrack, clearIsolation } = useTracks()
const { filteredTracks, globalTimeRange, hasActiveFilter, setUniversalTimeRange, clearAllTimeRanges } = useTrackFilter()
const { showLabels, toggle: toggleLabels } = useLabelVisibility()
const errorMsg = ref('')
const batches = ref<Batch[]>([])
const showBatchPanel = ref(false)

function onTimeFilterApply(min: number, max: number) {
  setUniversalTimeRange(min, max)
}

function onTimeFilterClear() {
  clearAllTimeRanges()
}

const displayTracks = computed(() => {
  if (isolatedTrackId.value) {
    const t = tracks.value.find(tr => tr.id === isolatedTrackId.value)
    return t ? [t] : []
  }
  return filteredTracks.value
})

const replay = useReplay(displayTracks)
const unifiedReplayTime = computed(() =>
  replay.isPlaying.value ? replay.currentTime.value : null
)

onMounted(async () => {
  try {
    const saved = await invoke('load_persisted_tracks') as any[]
    if (saved.length > 0) setAll(fromBackendTracks(saved))
  } catch (_) { }
  await refreshBatches()
})

async function refreshBatches() {
  try { batches.value = await invoke('get_batches_cmd') } catch (_) { }
}

async function handleImportAdsb() {
  errorMsg.value = ''
  try {
    const result = await loader.loadAdsbFile()
    if (result.length) addTracks(result)
    await refreshBatches()
  } catch (e) { errorMsg.value = String(e) }
}

async function handleImportRadar() {
  errorMsg.value = ''
  try {
    const result = await loader.loadRadarFile()
    if (result.length) addTracks(result)
    await refreshBatches()
  } catch (e) { errorMsg.value = String(e) }
}

async function handleDeleteBatch(id: number) {
  try {
    await invoke('delete_batch_cmd', { batchId: id })
    const saved = await invoke('load_persisted_tracks') as any[]
    setAll(fromBackendTracks(saved))
    await refreshBatches()
  } catch (e) { errorMsg.value = String(e) }
}

async function handleLoadBatch(id: number) {
  try {
    const raw = await invoke('load_batch_tracks_cmd', { batchId: id }) as any[]
    if (raw.length) addTracks(fromBackendTracks(raw))
  } catch (e) { errorMsg.value = String(e) }
}

function onIsolateTrack(id: string) {
  isolateTrack(id)
}

function onTrackPick(trackId: string | null) {
  if (trackId) isolateTrack(trackId)
  else clearIsolation()
}

function onClearIsolation() {
  clearIsolation()
}

function onClear() {
  replay.pause()
  clearAll()
}

function handleResetView() { mapRef.value?.resetView() }

const dragOver = ref(false)
let dragCounter = 0
function onDragLeave() {
  dragCounter--
  if (dragCounter <= 0) { dragOver.value = false; dragCounter = 0 }
}
async function onDrop(_e: DragEvent) {
  dragOver.value = false; dragCounter = 0
}
</script>

<style scoped>
.app-root { width:100vw; height:100vh; display:flex; position:relative; overflow:hidden; }

.drop-overlay { position:absolute; inset:0; z-index:20; background:rgba(0,212,255,0.1); border:3px dashed var(--color-accent); display:flex; align-items:center; justify-content:center; }
.drop-hint { font-size:24px; font-weight:700; color:var(--color-accent); text-shadow:0 0 20px rgba(0,212,255,0.5); }

.right-bar {
  position:absolute; top:130px; right:16px; z-index:10;
  display:flex; flex-direction:column; gap:5px; width:200px;
}
.side-btn {
  padding:7px 12px; border:none; border-radius:6px; font-size:12px;
  font-weight:600; cursor:pointer; transition:opacity 0.15s; text-align:center;
  background:#00d4ff; color:var(--color-bg);
}
.side-btn.adsb-btn { background:#00d4ff; color:#1a1a2e; }
.side-btn.radar-btn { background:#00ff88; color:#1a1a2e; }
.side-btn:hover:not(:disabled) { opacity:0.85; }
.side-btn:disabled { opacity:0.5; cursor:not-allowed; }
.side-btn.clear-btn { background:rgba(255,255,255,0.1); color:var(--color-text); }
.side-btn.back-all-btn { background:rgba(0,212,255,0.15); color:#00d4ff; border:1px solid rgba(0,212,255,0.3); }
.side-btn.util-btn { background:rgba(255,255,255,0.08); color:var(--color-text-dim); border:1px solid rgba(255,255,255,0.15); }
.error-msg { color:#f44; font-size:11px; text-align:center; word-break:break-all; }

/* Batch panel */
.batch-panel {
  margin-top:4px; background:var(--color-surface); border:1px solid var(--color-border);
  border-radius:6px; padding:8px; max-height:250px; overflow-y:auto;
  display:flex; flex-direction:column; gap:6px;
}
.batch-empty { color:var(--color-text-dim); font-size:11px; text-align:center; padding:8px 0; }
.batch-row { display:flex; align-items:center; justify-content:space-between; padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.05); cursor:pointer; }
.batch-row:hover { background:rgba(255,255,255,0.03); }
.batch-info { display:flex; flex-direction:column; gap:1px; min-width:0; }
.batch-src { font-size:10px; padding:0 5px; border-radius:3px; width:fit-content; }
.batch-src.ads-b { background:rgba(0,212,255,0.2); color:#0ff; }
.batch-src.radar { background:rgba(0,255,136,0.2); color:#0f0; }
.batch-file { font-size:11px; color:var(--color-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.batch-meta { font-size:10px; color:var(--color-text-dim); }
.batch-del { background:none; border:none; color:#f66; font-size:16px; cursor:pointer; padding:0 4px; line-height:1; }
.batch-del:hover { color:#f00; }

.layout-right { z-index:5; display:flex; flex-shrink:0; }

.layout-bottom { position:absolute; bottom:0; left:0; right:0; z-index:5; display:flex; flex-direction:column; }
.playback-row { display:flex; align-items:center; gap:0; }
.unified-tag { background:rgba(0,212,255,0.12); color:#00d4ff; padding:0 10px; font-size:11px; font-weight:700; min-width:56px; text-align:center; flex-shrink:0; height:48px; display:flex; align-items:center; justify-content:center; }
.playback-row > :deep(.playback-bar) { flex:1; }
</style>
