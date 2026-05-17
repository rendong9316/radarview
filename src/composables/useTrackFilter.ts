import { computed, ref, type Ref } from 'vue'
import type { Track } from '../types/track'

export interface SourceRange {
  min: number
  max: number
}

export function useTrackFilter(tracks: Ref<Track[]>) {
  const ranges = ref<Record<string, SourceRange>>({})
  const activeMin = ref<number | null>(null)
  const activeMax = ref<number | null>(null)
  const hasActiveFilter = ref(false)

  function updateRangeBounds() {
    const sourceMinMax: Record<string, { min: number; max: number }> = {}
    for (const t of tracks.value) {
      const src = t.source
      for (const p of t.positions) {
        if (!p.timestamp) continue
        if (!sourceMinMax[src]) {
          sourceMinMax[src] = { min: p.timestamp, max: p.timestamp }
        } else {
          if (p.timestamp < sourceMinMax[src].min) sourceMinMax[src].min = p.timestamp
          if (p.timestamp > sourceMinMax[src].max) sourceMinMax[src].max = p.timestamp
        }
      }
    }
    const result: Record<string, SourceRange> = {}
    for (const [src, mm] of Object.entries(sourceMinMax)) {
      result[src] = { min: mm.min, max: mm.max }
    }
    ranges.value = result
  }

  /** Returns the overall min/max across all sources (for time filter UI) */
  const globalTimeRange = computed(() => {
    let min = Infinity
    let max = -Infinity
    for (const r of Object.values(ranges.value)) {
      if (r.min < min) min = r.min
      if (r.max > max) max = r.max
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
    updateRangeBounds()

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

  return { ranges, filteredTracks, globalTimeRange, setUniversalTimeRange, clearAllTimeRanges, hasActiveFilter }
}
