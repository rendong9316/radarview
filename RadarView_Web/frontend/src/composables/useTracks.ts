import { ref, computed } from 'vue'
import type { Track } from '../types/track'

const tracks = ref<Track[]>([])
const selectedId = ref<string | null>(null)
const isolatedTrackId = ref<string | null>(null)

export function useTracks() {
  const trackCount = computed(() => tracks.value.length)

  const totalPoints = computed(() =>
    tracks.value.reduce((sum, t) => sum + t.positions.length, 0),
  )

  const selectedTrack = computed(() => {
    if (!selectedId.value) return null
    return tracks.value.find((t) => t.id === selectedId.value) ?? null
  })

  const isolatedTrack = computed(() => {
    if (!isolatedTrackId.value) return null
    return tracks.value.find((t) => t.id === isolatedTrackId.value) ?? null
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
    for (const t of tracks.value) {
      map.set(t.id, { ...t, positions: [...t.positions] })
    }
    for (const nt of newTracks) {
      const old = map.get(nt.id)
      if (old) {
        const tsSet = new Set(old.positions.map((p) => p.timestamp))
        const newPoints = nt.positions.filter((p) => !tsSet.has(p.timestamp))
        old.positions = [...old.positions, ...newPoints].sort(
          (a, b) => a.timestamp - b.timestamp,
        )
        for (const key of Object.keys(nt.metadata) as (keyof typeof nt.metadata)[]) {
          if (nt.metadata[key] && !old.metadata[key]) {
            ;(old.metadata as Record<string, unknown>)[key] = nt.metadata[key]
          }
        }
      } else {
        map.set(nt.id, { ...nt, positions: [...nt.positions] })
      }
    }
    tracks.value = Array.from(map.values())
  }

  function removeTrack(id: string) {
    tracks.value = tracks.value.filter((t) => t.id !== id)
    if (selectedId.value === id) {
      selectedId.value = null
    }
  }

  function selectTrack(id: string | null) {
    selectedId.value = id
  }

  function isolateTrack(id: string) {
    isolatedTrackId.value = id
    selectedId.value = id
  }

  function clearIsolation() {
    isolatedTrackId.value = null
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

  return {
    tracks,
    trackCount,
    totalPoints,
    selectedId,
    selectedTrack,
    isolatedTrackId,
    isolatedTrack,
    tracksBySource,
    addTracks,
    removeTrack,
    selectTrack,
    isolateTrack,
    clearIsolation,
    clearAll,
    setAll,
  }
}
