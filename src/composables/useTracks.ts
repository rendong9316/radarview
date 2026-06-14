import { ref, computed, watch } from 'vue'
import type { Track, DataSource } from '../types/track'

const tracks = ref<Track[]>([])
const selectedId = ref<string | null>(null)
const isolatedTrackId = ref<string | null>(null)
/** Multi-select visible set from management panel (key = "icao::source") */
const visibleTrackIds = ref<Set<string>>(new Set())

/** Composite key for track identity: id + source. Radar and Measurement
 *  data may share the same Target ID but are different tracks. */
export function trackKey(id: string, source: DataSource): string {
  return `${id}::${source}`
}
/** Extract id and source from a composite key */
export function parseTrackKey(key: string): { id: string; source: DataSource } {
  const idx = key.lastIndexOf('::')
  return {
    id: key.substring(0, idx),
    source: key.substring(idx + 2) as DataSource,
  }
}

export function useTracks() {
  const trackCount = computed(() => tracks.value.length)

  const totalPoints = computed(() =>
    tracks.value.reduce((sum, t) => sum + t.positions.length, 0),
  )

  const selectedTrack = computed(() => {
    if (!selectedId.value) return null
    return tracks.value.find((t) => trackKey(t.id, t.source) === selectedId.value) ?? null
  })

  const isolatedTrack = computed(() => {
    if (!isolatedTrackId.value) return null
    return tracks.value.find((t) => trackKey(t.id, t.source) === isolatedTrackId.value) ?? null
  })

  const tracksBySource = computed(() => {
    const groups: Record<string, Track[]> = {}
    for (const t of tracks.value) {
      ;(groups[t.source] ??= []).push(t)
    }
    return groups
  })

  function addTracks(newTracks: Track[]) {
    const map = new Map<string, Track>()
    // Store existing tracks by reference — only clone on merge conflict.
    // No downstream code mutates Track objects or positions arrays.
    for (const t of tracks.value) {
      map.set(trackKey(t.id, t.source), t)
    }
    for (const nt of newTracks) {
      const key = trackKey(nt.id, nt.source)
      const existing = map.get(key)
      if (existing) {
        // Clone positions for this track only — the merge path mutates array
        const merged: Track = { ...existing, positions: [...existing.positions] }
        const tsSet = new Set(merged.positions.map((p) => p.timestamp))
        const newPoints = nt.positions.filter((p) => !tsSet.has(p.timestamp))
        merged.positions = [...merged.positions, ...newPoints].sort(
          (a, b) => a.timestamp - b.timestamp,
        )
        // Update metadata after merge
        merged.pointCount = merged.positions.length
        if (merged.pointCount > 0) {
          merged.minTimestamp = merged.positions[0].timestamp
          merged.maxTimestamp = merged.positions[merged.pointCount - 1].timestamp
        }
        for (const k of Object.keys(nt.metadata) as (keyof typeof nt.metadata)[]) {
          if (nt.metadata[k] && !merged.metadata[k]) {
            ;(merged.metadata as Record<string, unknown>)[k] = nt.metadata[k]
          }
        }
        map.set(key, merged)
      } else {
        map.set(key, { ...nt, positions: [...nt.positions] })
      }
    }
    tracks.value = Array.from(map.values())
  }

  function removeTrack(id: string, source: DataSource) {
    const key = trackKey(id, source)
    tracks.value = tracks.value.filter((t) => trackKey(t.id, t.source) !== key)
    if (selectedId.value === key) {
      selectedId.value = null
    }
  }

  function selectTrack(key: string | null) {
    selectedId.value = key
  }

  function isolateTrack(id: string, source: DataSource) {
    const key = trackKey(id, source)
    isolatedTrackId.value = key
    selectedId.value = key
  }

  function clearIsolation() {
    isolatedTrackId.value = null
  }

  // ── Management panel visible set ──

  function addToVisibleSet(key: string) {
    const next = new Set(visibleTrackIds.value)
    next.add(key)
    visibleTrackIds.value = next
  }

  function removeFromVisibleSet(key: string) {
    const next = new Set(visibleTrackIds.value)
    next.delete(key)
    visibleTrackIds.value = next
  }

  function clearVisibleSet() {
    visibleTrackIds.value = new Set()
  }

  function isInVisibleSet(key: string): boolean {
    return visibleTrackIds.value.has(key)
  }

  function clearAll() {
    tracks.value = []
    selectedId.value = null
    isolatedTrackId.value = null
  }

  function setAll(newTracks: Track[]) {
    tracks.value = newTracks
    selectedId.value = null
    isolatedTrackId.value = null
  }

  // Persist track selection state
  watch(selectedId, (v) => {
    import('./useSettingsPersistence').then(({ scheduleSave }) => {
      scheduleSave('track.selected_id', JSON.stringify(v))
    })
  }, { immediate: false })

  watch(isolatedTrackId, (v) => {
    import('./useSettingsPersistence').then(({ scheduleSave }) => {
      scheduleSave('track.isolated_id', JSON.stringify(v))
    })
  }, { immediate: false })

  return {
    tracks,
    trackCount,
    totalPoints,
    selectedId,
    selectedTrack,
    isolatedTrackId,
    isolatedTrack,
    visibleTrackIds,
    tracksBySource,
    addTracks,
    removeTrack,
    selectTrack,
    isolateTrack,
    clearIsolation,
    addToVisibleSet,
    removeFromVisibleSet,
    clearVisibleSet,
    isInVisibleSet,
    clearAll,
    setAll,
    trackKey,
    parseTrackKey,
  }
}
