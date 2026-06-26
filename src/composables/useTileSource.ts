import { ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { scheduleSave } from './useSettingsPersistence'

export interface TileSourceInfo {
  file_name: string
  display_name: string
  max_zoom: number
}

/** List of available tile sources from the backend. */
const tileSources = ref<TileSourceInfo[]>([])

/** Currently active tile source file name. */
const activeSource = ref<string>('')

let _initialized = false

/** Whether any tile source is available. Updated after fetchTileSources or rescan. */
const hasTiles = ref(true)

/** Callback invoked after the tile source changes on the backend, so Cesium can refresh. */
let _onSourceChanged: (() => void) | null = null

export function useTileSource() {
  /** Fetch available tile sources from the backend. Call once on startup. */
  async function fetchTileSources() {
    if (_initialized) return
    _initialized = true
    try {
      const list = await invoke<TileSourceInfo[]>('list_tile_sources')
      console.log('[useTileSource] list_tile_sources returned:', list.length, 'sources:', list.map(s => s.file_name))
      tileSources.value = list
      hasTiles.value = list.length > 0
      // If no active source is set yet (first load), default to first available
      if (!activeSource.value && list.length > 0) {
        activeSource.value = list[0].file_name
      }
    } catch (e) {
      console.error('[useTileSource] fetch failed:', e)
      hasTiles.value = false
    }
  }

  /** Switch to a different tile source. */
  async function setActiveSource(fileName: string) {
    if (activeSource.value === fileName) return
    try {
      await invoke('set_active_tile_source', { fileName })
      activeSource.value = fileName
      // Notify Cesium to refresh the imagery layer
      _onSourceChanged?.()
    } catch (e) {
      console.error('[useTileSource] setActiveSource failed:', e)
    }
  }

  /** Register a callback for when the active source changes. */
  function onSourceChanged(cb: () => void) {
    _onSourceChanged = cb
  }

  /** Fetch the recommended directory for placing .mbtiles files. */
  async function getRecommendedDir(): Promise<string> {
    try {
      return await invoke<string>('get_recommended_tile_dir')
    } catch {
      return ''
    }
  }

  /** Re-scan directories for .mbtiles files (called after user dismisses no-tiles dialog). */
  async function rescanTileSources(): Promise<TileSourceInfo[]> {
    try {
      const list = await invoke<TileSourceInfo[]>('rescan_tile_sources')
      console.log('[useTileSource] rescan returned:', list.length, 'sources:', list.map(s => s.file_name))
      tileSources.value = list
      hasTiles.value = list.length > 0
      if (!activeSource.value && list.length > 0) {
        activeSource.value = list[0].file_name
      }
      return list
    } catch (e) {
      console.error('[useTileSource] rescan failed:', e)
      return []
    }
  }

  return { tileSources, activeSource, hasTiles, fetchTileSources, rescanTileSources, setActiveSource, onSourceChanged, getRecommendedDir }
}

// ── Persistence ──
// Watch for changes and persist to the settings DB
watch(activeSource, (v) => {
  if (_initialized && v) {
    scheduleSave('tile.source', JSON.stringify(v))
  }
})
