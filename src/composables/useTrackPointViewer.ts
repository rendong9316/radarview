import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { Track } from '../types/track'
import { fromBackendTracks } from './convertTrack'

/** Currently viewed track (with full positions) — module-level singleton */
export const viewingTrack = ref<Track | null>(null)

/** Loading flag for async DB load (used when opening from ManageDataTable) */
export const viewingTrackLoading = ref(false)

/** Open the point viewer with an already-loaded Track (from CesiumMap) */
export function openTrackPointViewer(track: Track) {
  viewingTrack.value = track
}

/** Close the point viewer */
export function closeTrackPointViewer() {
  viewingTrack.value = null
}

/** Load full track from DB by icao + batch_id, then open viewer (from ManageDataTable) */
export async function loadAndOpenViewer(icao: string, batchId: number) {
  viewingTrackLoading.value = true
  try {
    const tracks = await invoke<any[]>('export_tracks_cmd', {
      tracksJson: JSON.stringify([[icao, batchId]]),
    })
    if (tracks.length > 0) {
      const converted = fromBackendTracks(tracks)
      if (converted.length > 0) {
        viewingTrack.value = converted[0]
      }
    }
  } catch (e) {
    console.error('[useTrackPointViewer] loadAndOpenViewer failed:', e)
  } finally {
    viewingTrackLoading.value = false
  }
}
