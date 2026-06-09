import { ref, computed, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { DataSource } from '../types/track'
import type {
  TrackMetaFilter,
  TrackMetadataResponse,
  TrackStats,
  DistinctOptions,
  TrackMetaInfo,
  SortConfig,
} from '../types/manage'
import { defaultFilter, DEFAULT_SORT } from '../types/manage'

// ── Module-level singleton state ──

const stats = ref<TrackStats | null>(null)
const statsLoading = ref(false)

/** Current filter (all fields optional — empty = show all) */
export const filter = ref<TrackMetaFilter>(defaultFilter())

/** Current sort */
export const sortConfig = ref<SortConfig>({ ...DEFAULT_SORT })

/** Pagination */
const currentPage = ref(1)
export const pageSize = ref(20)

/** Table data */
const rows = ref<TrackMetaInfo[]>([])
const totalCount = ref(0)
const loading = ref(false)

/** Distinct options for dropdowns */
const distinctOptions = ref<DistinctOptions | null>(null)

/** Global visible set: keys = "icao::batchId" for tracks shown on map */
export const visibleTrackKeys = ref<Set<string>>(new Set())
const loadedTrackKeys = ref<Set<string>>(new Set())

// ── Persistence: filter, sortConfig, pageSize ──

let _persistEnabled = false

/** Enable persistence watchers (called after settings are loaded to avoid saving defaults) */
export function enableManagePersistence() {
  _persistEnabled = true
}

watch(filter, () => {
  if (!_persistEnabled) return
  import('./useSettingsPersistence').then(({ scheduleSave }) => {
    scheduleSave('manage.filter', JSON.stringify(filter.value))
  })
}, { deep: true, immediate: false })

watch(sortConfig, () => {
  if (!_persistEnabled) return
  import('./useSettingsPersistence').then(({ scheduleSave }) => {
    scheduleSave('manage.sort', JSON.stringify(sortConfig.value))
  })
}, { deep: true, immediate: false })

watch(pageSize, () => {
  if (!_persistEnabled) return
  import('./useSettingsPersistence').then(({ scheduleSave }) => {
    scheduleSave('manage.page_size', JSON.stringify(pageSize.value))
  })
}, { immediate: false })

watch(visibleTrackKeys, () => {
  if (!_persistEnabled) return
  import('./useSettingsPersistence').then(({ scheduleSave }) => {
    scheduleSave('manage.visible_keys', JSON.stringify(Array.from(visibleTrackKeys.value)))
  })
}, { deep: true, immediate: false })

// ── Visible set restore ──

/** Saved visible keys pending restoration after track data is loaded */
let _pendingRestoreKeys: string[] | null = null

/** Called by applySettings to stage saved keys for later restoration */
export function setPendingRestoreKeys(keys: string[]) {
  _pendingRestoreKeys = keys
}

/** Restore the visible set: re-load tracks from DB and add to map.
 *  Must be called after persisted tracks have been loaded into the tracks composable. */
export async function restoreVisibleSet() {
  if (!_pendingRestoreKeys || _pendingRestoreKeys.length === 0) return
  const keys = _pendingRestoreKeys
  _pendingRestoreKeys = null

  const tr = await (async () => {
    const { useTracks } = await import('./useTracks')
    return useTracks()
  })()
  const { fromBackendTracks } = await import('./convertTrack')

  for (const key of keys) {
    // key format: "icao::batchId"
    const sepIdx = key.lastIndexOf('::')
    if (sepIdx < 0) continue
    const icao = key.substring(0, sepIdx)
    const batchId = parseInt(key.substring(sepIdx + 2), 10)
    if (isNaN(batchId)) continue

    try {
      const tracksJson = JSON.stringify([[icao, batchId]])
      const fullTracks = await invoke<any[]>('export_tracks_cmd', { tracksJson })
      if (fullTracks.length > 0) {
        // fullTracks[0] has raw source string from backend (e.g. "ADS-B")
        const dbSource = fullTracks[0]?.source ?? ''
        const frontendSource = dbSourceToFrontend(dbSource)
        const trKey = `${icao}::${frontendSource}`

        // Check if already loaded (from load_persisted_tracks)
        const existing = tr.tracks.value.find(
          t => t.id === icao && t.source === frontendSource
        )
        if (!existing) {
          tr.addTracks(fromBackendTracks(fullTracks))
        }
        tr.addToVisibleSet(trKey)
        visibleTrackKeys.value = new Set(visibleTrackKeys.value).add(key)
      }
    } catch (e) {
      console.error('[manage] restoreVisibleSet failed for', key, e)
    }
  }
}

// ── Helpers ──

function dbKey(icao: string, batchId: number): string {
  return `${icao}::${batchId}`
}

function trKey(icao: string, source: string): string {
  return `${icao}::${source}`
}

/** Map DB source name to frontend DataSource */
function dbSourceToFrontend(dbSource: string): DataSource {
  switch (dbSource) {
    case 'ADS-B': return 'adsb'
    case 'Radar': return 'radar'
    case 'RadarRaw': return 'radar_raw'
    case 'Simulation': return 'simulation'
    default: return 'adsb'
  }
}

async function getUseTracks() {
  const { useTracks } = await import('./useTracks')
  return useTracks()
}

async function getConvertTrack() {
  const { fromBackendTracks } = await import('./convertTrack')
  return { fromBackendTracks }
}

// ── Exported composable ──

export function useTrackManagement() {
  // ── Data loading ──

  async function fetchStats() {
    statsLoading.value = true
    try {
      stats.value = await invoke<TrackStats>('get_track_statistics_cmd')
    } catch (e) {
      console.error('[manage] fetchStats failed:', e)
    } finally {
      statsLoading.value = false
    }
  }

  async function fetchDistinctOptions() {
    try {
      // Pass source filter if active, otherwise null to get all
      const src = filter.value.source ?? null
      distinctOptions.value = await invoke<DistinctOptions>('get_distinct_options_cmd', {
        source: src ?? undefined,
      })
    } catch (e) {
      console.error('[manage] fetchDistinctOptions failed:', e)
    }
  }

  async function fetchMetadata() {
    loading.value = true
    try {
      const f = filter.value
      const payload: Record<string, unknown> = {
        sortBy: sortConfig.value.column,
        sortDesc: sortConfig.value.desc,
      }
      // Only include non-undefined filter fields (JSON.stringify drops undefined)
      if (f.searchText) payload.searchText = f.searchText
      if (f.source) payload.source = f.source
      if (f.batchId != null) payload.batchId = f.batchId
      if (f.airline) payload.airline = f.airline
      if (f.aircraftType) payload.aircraftType = f.aircraftType
      if (f.minPoints != null) payload.minPoints = f.minPoints
      if (f.maxPoints != null) payload.maxPoints = f.maxPoints
      if (f.minTimeMs != null) payload.minTimeMs = f.minTimeMs
      if (f.maxTimeMs != null) payload.maxTimeMs = f.maxTimeMs

      const filterJson = JSON.stringify(payload)
      console.log('[manage] fetchMetadata — filter:', filterJson, '| limit:', pageSize.value, '| offset:', (currentPage.value - 1) * pageSize.value)
      const resp = await invoke<TrackMetadataResponse>('query_track_metadata_cmd', {
        filterJson,
        limit: pageSize.value,
        offset: (currentPage.value - 1) * pageSize.value,
      })
      rows.value = resp.rows
      totalCount.value = resp.total_count
    } catch (e) {
      console.error('[manage] fetchMetadata failed:', e)
      rows.value = []
      totalCount.value = 0
    } finally {
      loading.value = false
    }
  }

  /** Load everything: stats + distinct options + first page of data */
  async function loadAll() {
    await Promise.all([
      fetchStats(),
      fetchDistinctOptions(),
      fetchMetadata(),
    ])
  }

  // ── Filter / sort / page ──

  function setFilter(partial: Partial<TrackMetaFilter>) {
    Object.assign(filter.value, partial)
    currentPage.value = 1
    fetchMetadata()
    fetchDistinctOptions()
  }

  function setSearchText(text: string) {
    filter.value.searchText = text || undefined
  }

  function applySearch() {
    currentPage.value = 1
    fetchMetadata()
  }

  function clearFilters() {
    filter.value = defaultFilter()
    sortConfig.value = { ...DEFAULT_SORT }
    currentPage.value = 1
    fetchDistinctOptions()
    fetchMetadata()
  }

  function setPage(page: number) {
    currentPage.value = page
    fetchMetadata()
  }

  function setPageSize(size: number) {
    pageSize.value = size
    currentPage.value = 1
    fetchMetadata()
  }

  function setSort(column: string) {
    if (sortConfig.value.column === column) {
      sortConfig.value.desc = !sortConfig.value.desc
    } else {
      sortConfig.value.column = column
      sortConfig.value.desc = false
    }
    currentPage.value = 1
    fetchMetadata()
  }

  function sortIndicator(col: string): string {
    if (sortConfig.value.column !== col) return ''
    return sortConfig.value.desc ? '▼' : '▲'
  }

  // ── Visible set (map toggle) ──

  function isVisible(icao: string, batchId: number): boolean {
    return visibleTrackKeys.value.has(dbKey(icao, batchId))
  }

  async function toggleVisible(row: TrackMetaInfo) {
    const icao = row.icao_address
    const batchId = row.batch_id
    const source = dbSourceToFrontend(row.source)
    const key = dbKey(icao, batchId)
    const tKey = trKey(icao, source)

    if (visibleTrackKeys.value.has(key)) {
      // Remove from map
      const newSet = new Set(visibleTrackKeys.value)
      newSet.delete(key)
      visibleTrackKeys.value = newSet
      const tr = await getUseTracks()
      tr.removeFromVisibleSet(tKey)
    } else {
      // Add to map
      const newSet = new Set(visibleTrackKeys.value)
      newSet.add(key)
      visibleTrackKeys.value = newSet

      const tr = await getUseTracks()
      const existing = tr.tracks.value.find(t => `${t.id}::${t.source}` === tKey)
      if (!existing) {
        try {
          const tracksJson = JSON.stringify([[icao, batchId]])
          const fullTracks = await invoke<any[]>('export_tracks_cmd', { tracksJson })
          if (fullTracks.length > 0) {
            const { fromBackendTracks } = await getConvertTrack()
            tr.addTracks(fromBackendTracks(fullTracks))
          }
        } catch (e) {
          console.error('[manage] load track failed:', e)
          const revert = new Set(visibleTrackKeys.value)
          revert.delete(key)
          visibleTrackKeys.value = revert
          return
        }
      }
      tr.addToVisibleSet(tKey)
      const newLoaded = new Set(loadedTrackKeys.value)
      newLoaded.add(key)
      loadedTrackKeys.value = newLoaded
    }
  }

  async function showAllOnPage() {
    for (const row of rows.value) {
      if (!visibleTrackKeys.value.has(dbKey(row.icao_address, row.batch_id))) {
        await toggleVisible(row)
      }
    }
  }

  async function clearVisibleSet() {
    visibleTrackKeys.value = new Set()
    const tr = await getUseTracks()
    tr.clearVisibleSet()
  }

  const totalVisibleCount = computed(() => visibleTrackKeys.value.size)

  const visibleOnPage = computed(() => {
    let count = 0
    for (const row of rows.value) {
      if (visibleTrackKeys.value.has(dbKey(row.icao_address, row.batch_id))) count++
    }
    return count
  })

  // ── Delete ──

  async function deleteTrack(row: TrackMetaInfo) {
    const icao = row.icao_address
    const batchId = row.batch_id
    const source = dbSourceToFrontend(row.source)
    const { useConfirmDialog } = await import('./useConfirmDialog')
    const { show } = useConfirmDialog()
    const ok = await show({
      title: '删除航迹',
      message: `确定删除航迹 ${icao} (${row.source})？\n此操作不可撤销。`,
      variant: 'danger',
    })
    if (!ok) return
    try {
      await invoke('delete_track_cmd', { icaoAddress: icao, batchId })
      const key = dbKey(icao, batchId)
      const tKey = trKey(icao, source)
      const newVis = new Set(visibleTrackKeys.value); newVis.delete(key); visibleTrackKeys.value = newVis
      const newLd = new Set(loadedTrackKeys.value); newLd.delete(key); loadedTrackKeys.value = newLd
      const tr = await getUseTracks()
      tr.removeFromVisibleSet(tKey)
      tr.tracks.value = tr.tracks.value.filter(t => !(t.id === icao && t.source === source))
      await fetchStats()
      fetchMetadata()
    } catch (e) { console.error('[manage] deleteTrack failed:', e) }
  }

  async function deleteVisibleTracks() {
    const toDelete: [string, number, string][] = []
    for (const row of rows.value) {
      const key = dbKey(row.icao_address, row.batch_id)
      if (visibleTrackKeys.value.has(key)) {
        toDelete.push([row.icao_address, row.batch_id, dbSourceToFrontend(row.source)])
      }
    }
    if (toDelete.length === 0) return
    const { useConfirmDialog } = await import('./useConfirmDialog')
    const { show } = useConfirmDialog()
    const ok = await show({
      title: '批量删除航迹',
      message: `确定删除 ${toDelete.length} 条航迹？\n此操作不可撤销。`,
      variant: 'danger',
    })
    if (!ok) return

    try {
      const ids: [string, number][] = toDelete.map(([icao, bid]) => [icao, bid])
      await invoke('delete_tracks_bulk_cmd', { tracksJson: JSON.stringify(ids) })
      const tr = await getUseTracks()
      const newVis = new Set(visibleTrackKeys.value)
      const newLd = new Set(loadedTrackKeys.value)
      for (const [icao, batchId, source] of toDelete) {
        const key = dbKey(icao, batchId)
        newVis.delete(key); newLd.delete(key)
        tr.removeFromVisibleSet(`${icao}::${source}`)
        tr.tracks.value = tr.tracks.value.filter(t => !(t.id === icao && t.source === source))
      }
      visibleTrackKeys.value = newVis; loadedTrackKeys.value = newLd
      await fetchStats()
      fetchMetadata()
    } catch (e) { console.error('[manage] deleteVisibleTracks failed:', e) }
  }

  // ── Export ──

  async function exportVisibleTracks() {
    const toExport: [string, number][] = []
    for (const row of rows.value) {
      if (visibleTrackKeys.value.has(dbKey(row.icao_address, row.batch_id))) {
        toExport.push([row.icao_address, row.batch_id])
      }
    }
    if (toExport.length === 0) return
    try {
      const fullTracks = await invoke<any[]>('export_tracks_cmd', {
        tracksJson: JSON.stringify(toExport),
      })
      const { save } = await import('@tauri-apps/plugin-dialog')
      const filePath = await save({
        defaultPath: 'radarview_export.json',
        filters: [{ name: 'JSON', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }],
      })
      if (filePath) {
        await invoke('save_text_file', { path: filePath, content: JSON.stringify(fullTracks, null, 2) })
      }
    } catch (e) { console.error('[manage] exportVisibleTracks failed:', e) }
  }

  return {
    // State
    stats, statsLoading,
    filter, sortConfig,
    currentPage, pageSize,
    rows, totalCount, loading,
    distinctOptions,

    // Data loading
    fetchStats, fetchDistinctOptions, fetchMetadata, loadAll,

    // Filter / sort / page
    setFilter, setSearchText, applySearch, clearFilters,
    setPage, setPageSize, setSort, sortIndicator,

    // Visible set
    visibleTrackKeys, isVisible, toggleVisible,
    showAllOnPage, clearVisibleSet,
    totalVisibleCount, visibleOnPage,

    // Delete
    deleteTrack, deleteVisibleTracks,

    // Export
    exportVisibleTracks,
  }
}
