import { computed, ref } from 'vue'
import { useTracks } from './useTracks'
import type { Track } from '../types/track'

const activeMin = ref<number | null>(null)
const activeMax = ref<number | null>(null)
const hasActiveFilter = ref(false)

export function useTrackFilter() {
  const { tracks } = useTracks()

  /** Returns the overall min/max across all sources (for time filter UI) */
  const globalTimeRange = computed(() => {
    let min = Infinity
    let max = -Infinity
    for (const t of tracks.value) {
      for (const p of t.positions) {
        if (!p.timestamp) continue
        if (p.timestamp < min) min = p.timestamp
        if (p.timestamp > max) max = p.timestamp
      }
    }
    return min < max ? { min, max } : null
  })

  function setUniversalTimeRange(min: number, max: number) {
    activeMin.value = min
    activeMax.value = max
    hasActiveFilter.value = true
  }

  function clearAllTimeRanges() {
    activeMin.value = null
    activeMax.value = null
    hasActiveFilter.value = false
  }

  const filteredTracks = computed<Track[]>(() => {
    if (!hasActiveFilter.value || activeMin.value == null || activeMax.value == null) {
      return tracks.value
    }

    return tracks.value
      .map((track) => {
        const filtered = track.positions.filter(
          (p) => p.timestamp >= activeMin.value! && p.timestamp <= activeMax.value!,
        )
        if (filtered.length === 0) return null
        return { ...track, positions: filtered }
      })
      .filter((t): t is Track => t !== null)
  })

  return { filteredTracks, globalTimeRange, setUniversalTimeRange, clearAllTimeRanges, hasActiveFilter }
}
