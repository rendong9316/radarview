import { ref, computed, watch } from 'vue'
import type { Track, DataSource } from '../types/track'

/** Compute a simple hash from positions length + first/last timestamps.
 *  Used to detect whether Cartesian3 arrays need rebuilding in syncEntities. */
function computePositionsHash(positions: Track['positions']): number {
  const n = positions.length
  if (n === 0) return 0
  return n * 1000003 + (positions[0].timestamp >>> 0) + (positions[n - 1].timestamp >>> 0)
}

const tracks = ref<Track[]>([])
const selectedId = ref<string | null>(null)
const isolatedTrackId = ref<string | null>(null)
/** Multi-select visible set from management panel (key = "icao::source") */
const visibleTrackIds = ref<Set<string>>(new Set())

/** Composite key for track identity: id + source + fileName.
 *  Different files from the same source produce independent tracks;
 *  same-file reimports still deduplicate. */
export function trackKey(id: string, source: DataSource, fileName: string): string {
  return `${id}::${source}::${fileName}`
}
/** Extract id, source, and fileName from a composite key.
 *  Backward-compatible with legacy 2-part keys (fileName becomes ''). */
export function parseTrackKey(key: string): { id: string; source: DataSource; fileName: string } {
  const parts = key.split('::')
  if (parts.length >= 3) {
    return { id: parts[0], source: parts[1] as DataSource, fileName: parts[2] }
  }
  // Legacy 2-part key (icao::source)
  return { id: parts[0], source: parts[1] as DataSource, fileName: '' }
}

export function useTracks() {
  const trackCount = computed(() => tracks.value.length)

  const totalPoints = computed(() =>
    tracks.value.reduce((sum, t) => sum + t.positions.length, 0),
  )

  const selectedTrack = computed(() => {
    if (!selectedId.value) return null
    return tracks.value.find((t) => trackKey(t.id, t.source, t.fileName) === selectedId.value) ?? null
  })

  const isolatedTrack = computed(() => {
    if (!isolatedTrackId.value) return null
    return tracks.value.find((t) => trackKey(t.id, t.source, t.fileName) === isolatedTrackId.value) ?? null
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
      map.set(trackKey(t.id, t.source, t.fileName), t)
    }
    for (const nt of newTracks) {
      const key = trackKey(nt.id, nt.source, nt.fileName)
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
        merged.positionsHash = computePositionsHash(merged.positions)
        for (const k of Object.keys(nt.metadata) as (keyof typeof nt.metadata)[]) {
          if (nt.metadata[k] && !merged.metadata[k]) {
            ;(merged.metadata as Record<string, unknown>)[k] = nt.metadata[k]
          }
        }
        map.set(key, merged)
      } else {
        const cloned: Track = { ...nt, positions: [...nt.positions] }
        cloned.positionsHash = computePositionsHash(cloned.positions)
        map.set(key, cloned)
      }
    }
    tracks.value = Array.from(map.values())
  }

  /** Remove a track by its full composite key (icao::source::fileName). */
  function removeTrackByCompositeKey(compositeKey: string) {
    tracks.value = tracks.value.filter((t) => trackKey(t.id, t.source, t.fileName) !== compositeKey)
    if (selectedId.value === compositeKey) {
      selectedId.value = null
    }
  }

  function removeTrack(id: string, source: DataSource) {
    const match = tracks.value.find(t => t.id === id && t.source === source)
    const key = match ? trackKey(match.id, match.source, match.fileName) : trackKey(id, source, '')
    removeTrackByCompositeKey(key)
  }

  function selectTrack(key: string | null) {
    selectedId.value = key
  }

  /** Isolate a single track by its full composite key. */
  function isolateTrack(compositeKey: string) {
    isolatedTrackId.value = compositeKey
    selectedId.value = compositeKey
  }

  /** Legacy — isolate by id+source only, falls back to first matching track. */
  function isolateTrackByIdSource(id: string, source: DataSource) {
    const match = tracks.value.find(t => t.id === id && t.source === source)
    const key = match ? trackKey(match.id, match.source, match.fileName) : trackKey(id, source, '')
    isolateTrack(key)
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
    removeTrackByCompositeKey,
    selectTrack,
    isolateTrack,
    isolateTrackByIdSource,
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
