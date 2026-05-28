<template>
  <div class="app-root" @dragover.prevent="onDragOver" @dragleave="onDragLeave" @drop.prevent="onDrop">
    <CesiumMap ref="mapRef" :tracks="displayTracks" :replay-time="unifiedReplayTime" :selected-id="selectedId" @track-pick="onTrackPick" />

    <div v-if="dragOver" class="drop-overlay">
      <div class="drop-hint">释放文件以导入</div>
    </div>

    <div class="top-bar">
      <span class="user-info" v-if="auth.user">
        {{ auth.user.nickname || auth.user.username }}
        <button class="logout-btn" @click="handleLogout">Logout</button>
      </span>
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
      <button class="side-btn adsb-btn" @click="handleImportAdsb" :disabled="loading">
        {{ loading ? `Importing ${progress}%` : 'Import ADS-B' }}
      </button>
      <button class="side-btn radar-btn" @click="handleImportRadar" :disabled="loading">
        {{ loading ? `Importing ${progress}%` : 'Import Radar' }}
      </button>
      <button class="side-btn radar-raw-btn" @click="handleImportRadarRaw" :disabled="loading">
        {{ loading ? `Importing ${progress}%` : 'Import Measurement' }}
      </button>
      <button v-if="trackCount" class="side-btn clear-btn" @click="onClear">Clear Display</button>
      <button class="side-btn util-btn" @click="showBatchPanel = !showBatchPanel">
        {{ showBatchPanel ? 'Hide Saved' : `Saved Data${batches.length ? ' ('+batches.length+')' : ''}` }}
      </button>
      <button class="side-btn util-btn" @click="toggleLabels">{{ showLabels ? 'Hide Labels' : 'Show Labels' }}</button>
      <button class="side-btn util-btn" @click="handleResetView">Reset View</button>
      <span v-if="errorMsg" class="error-msg">{{ errorMsg }}</span>

      <div v-if="showBatchPanel" class="batch-panel">
        <div v-if="batches.length === 0" class="batch-empty">No saved data in DB</div>
        <div v-for="b in batches" :key="b.id" class="batch-row" @click="handleLoadBatch(b.id)" title="Click to load">
          <div class="batch-info">
            <span class="batch-src" :class="sourceClass(b.source)">{{ b.source }}</span>
            <span class="batch-file">{{ b.fileName }}</span>
            <span class="batch-meta">{{ b.trackCount }} tracks · {{ b.importedAt }}</span>
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

    <input ref="fileInput" type="file" style="display:none" @change="onFileSelected" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import CesiumMap from './components/CesiumMap.vue'
import TrackPanel from './components/TrackPanel.vue'
import PlaybackBar from './components/PlaybackBar.vue'
import LayerControl from './components/LayerControl.vue'
import FlagPanel from './components/FlagPanel.vue'
import TimeFilterPanel from './components/TimeFilterPanel.vue'
import { useTracks } from './composables/useTracks'
import { useReplay } from './composables/useReplay'
import { useTrackFilter } from './composables/useTrackFilter'
import { useLabelVisibility } from './composables/useLabelVisibility'
import { trackApi, type BatchInfo, type TrackDetail, type TrackPoint } from './api/track'
import { useAuthStore } from './stores/auth'
import { useRouter } from 'vue-router'
import type { Track, DataSource } from './types/track'

const router = useRouter()
const auth = useAuthStore()

const mapRef = ref<InstanceType<typeof CesiumMap>>()
const { tracks, trackCount, selectedId, isolatedTrackId, addTracks, clearAll, setAll, isolateTrack, clearIsolation } = useTracks()
const { filteredTracks, globalTimeRange, hasActiveFilter, setUniversalTimeRange, clearAllTimeRanges } = useTrackFilter()
const { showLabels, toggle: toggleLabels } = useLabelVisibility()
const errorMsg = ref('')
const batches = ref<BatchInfo[]>([])
const showBatchPanel = ref(false)
const loading = ref(false)
const progress = ref(0)
const fileInput = ref<HTMLInputElement>()
const pendingImportType = ref<'adsb' | 'radar' | 'radar_raw'>('adsb')

function backendToTrack(dto: TrackDetail): Track {
  const positions: TrackPoint[] = dto.positions.map((p: any) => ({
    timestamp: p.timestamp,
    latitude: p.latitude,
    longitude: p.longitude,
    altitude: p.altitude ?? 0,
    heading: p.heading ?? 0,
    groundSpeed: p.groundSpeed ?? 0,
    verticalRate: p.verticalRate ?? 0,
  }))
  const sourceMap: Record<string, DataSource> = { 'ADS-B': 'adsb', 'Radar': 'radar', 'RadarRaw': 'radar_raw' }
  return {
    id: dto.icaoAddress,
    source: sourceMap[dto.source] || 'adsb',
    positions,
    metadata: {
      flightNumber: dto.flightNo || undefined,
      icaoFlightNumber: dto.icaoFlightNo || undefined,
      registration: dto.registration || undefined,
      aircraftType: dto.aircraftType || undefined,
      airline: dto.airline || undefined,
      origin: dto.origin || undefined,
      destination: dto.destination || undefined,
    },
  }
}

function sourceClass(source: string): string {
  const m: Record<string, string> = { 'ADS-B': 'ads-b', 'Radar': 'radar', 'RadarRaw': 'radar-raw' }
  return m[source] || ''
}

function onTimeFilterApply(min: number, max: number) { setUniversalTimeRange(min, max) }
function onTimeFilterClear() { clearAllTimeRanges() }

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
    const res = await trackApi.getAllTracks()
    const dtos = res.data.data
    if (dtos && dtos.length > 0) {
      setAll(dtos.map(backendToTrack))
    }
  } catch (e) {
    console.error('[MapView] load persisted tracks failed:', e)
  }
  await refreshBatches()
})

async function refreshBatches() {
  try {
    const res = await trackApi.getAllBatches()
    batches.value = res.data.data || []
  } catch (e) { console.error('[MapView] refreshBatches failed:', e) }
}

function pickFile(accept: string, type: 'adsb' | 'radar' | 'radar_raw') {
  pendingImportType.value = type
  if (!fileInput.value) return
  fileInput.value.accept = accept
  fileInput.value.click()
}

async function onFileSelected(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  target.value = ''
  errorMsg.value = ''
  loading.value = true
  progress.value = 0

  try {
    let res
    if (pendingImportType.value === 'adsb') {
      res = await trackApi.importAdsb(file, (p) => { progress.value = p })
    } else if (pendingImportType.value === 'radar') {
      res = await trackApi.importRadar(file, (p) => { progress.value = p })
    } else {
      res = await trackApi.importRadarRaw(file, (p) => { progress.value = p })
    }

    progress.value = 100
    const result = res.data.data
    if (result.success) {
      const tracksRes = await trackApi.getTracksByBatch(result.batchId)
      const dtos = tracksRes.data.data
      if (dtos && dtos.length > 0) {
        addTracks(dtos.map(backendToTrack))
      }
    } else {
      errorMsg.value = result.errorMsg || 'Import failed'
    }
    await refreshBatches()
  } catch (e: any) {
    errorMsg.value = e.response?.data?.message || e.message || 'Import failed'
  } finally {
    loading.value = false
    progress.value = 0
  }
}

function handleImportAdsb() { pickFile('.csv', 'adsb') }
function handleImportRadar() { pickFile('.mat', 'radar') }
function handleImportRadarRaw() { pickFile('.mat', 'radar_raw') }

async function handleDeleteBatch(id: number) {
  try {
    await trackApi.deleteBatch(id)
    const res = await trackApi.getAllTracks()
    const dtos = res.data.data
    setAll((dtos || []).map(backendToTrack))
    await refreshBatches()
  } catch (e: any) { errorMsg.value = e.response?.data?.message || String(e) }
}

async function handleLoadBatch(id: number) {
  try {
    const res = await trackApi.getTracksByBatch(id)
    const dtos = res.data.data
    if (dtos && dtos.length > 0) {
      addTracks(dtos.map(backendToTrack))
    }
  } catch (e: any) { errorMsg.value = e.response?.data?.message || String(e) }
}

function onIsolateTrack(id: string) { isolateTrack(id) }
function onTrackPick(trackId: string | null) {
  if (trackId) isolateTrack(trackId)
  else clearIsolation()
}
function onClearIsolation() { clearIsolation() }
function onClear() { replay.pause(); clearAll() }
function handleResetView() { mapRef.value?.resetView() }

async function handleLogout() {
  await auth.logout()
  router.push('/login')
}

const dragOver = ref(false)
let dragCounter = 0
function onDragOver() { dragOver.value = true; dragCounter++ }
function onDragLeave() {
  dragCounter--
  if (dragCounter <= 0) { dragOver.value = false; dragCounter = 0 }
}
async function onDrop(e: DragEvent) {
  dragOver.value = false; dragCounter = 0
  const files = e.dataTransfer?.files
  if (!files?.length) return
  for (const file of Array.from(files)) {
    if (file.name.endsWith('.csv')) {
      const dt = new DataTransfer()
      dt.items.add(file)
      const input = fileInput.value
      if (input) { input.files = dt.files; pendingImportType.value = 'adsb'; onFileSelected({ target: input } as any) }
    } else if (file.name.endsWith('.mat')) {
      const dt = new DataTransfer()
      dt.items.add(file)
      const input = fileInput.value
      if (input) { input.files = dt.files; pendingImportType.value = 'radar'; onFileSelected({ target: input } as any) }
    }
  }
}
</script>

<style scoped>
.app-root { width:100vw; height:100vh; display:flex; position:relative; overflow:hidden; }

.top-bar {
  position:absolute; top:8px; right:16px; z-index:15;
  display:flex; align-items:center; gap:8px;
}
.user-info { font-size:12px; color:var(--color-text); display:flex; align-items:center; gap:8px; }
.logout-btn {
  padding:3px 8px; background:rgba(255,255,255,0.1); color:var(--color-text-dim);
  border:1px solid rgba(255,255,255,0.15); border-radius:4px; font-size:11px;
  cursor:pointer;
}
.logout-btn:hover { color:#f44; border-color:#f44; }

.drop-overlay { position:absolute; inset:0; z-index:20; background:rgba(0,212,255,0.1); border:3px dashed var(--color-accent); display:flex; align-items:center; justify-content:center; }
.drop-hint { font-size:24px; font-weight:700; color:var(--color-accent); text-shadow:0 0 20px rgba(0,212,255,0.5); }

.right-bar {
  position:absolute; top:40px; right:16px; z-index:10;
  display:flex; flex-direction:column; gap:5px; width:200px;
}
.side-btn {
  padding:7px 12px; border:none; border-radius:6px; font-size:12px;
  font-weight:600; cursor:pointer; transition:opacity 0.15s; text-align:center;
  background:#00d4ff; color:var(--color-bg);
}
.side-btn.adsb-btn { background:#00d4ff; color:#1a1a2e; }
.side-btn.radar-btn { background:#00ff88; color:#1a1a2e; }
.side-btn.radar-raw-btn { background:#ff8800; color:#1a1a2e; }
.side-btn:hover:not(:disabled) { opacity:0.85; }
.side-btn:disabled { opacity:0.5; cursor:not-allowed; }
.side-btn.clear-btn { background:rgba(255,255,255,0.1); color:var(--color-text); }
.side-btn.back-all-btn { background:rgba(0,212,255,0.15); color:#00d4ff; border:1px solid rgba(0,212,255,0.3); }
.side-btn.util-btn { background:rgba(255,255,255,0.08); color:var(--color-text-dim); border:1px solid rgba(255,255,255,0.15); }
.error-msg { color:#f44; font-size:11px; text-align:center; word-break:break-all; }

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
.batch-src.radar-raw { background:rgba(255,136,0,0.2); color:#f80; }
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
