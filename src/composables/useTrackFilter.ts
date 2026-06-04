import { computed, ref, watch } from 'vue'
import { useTracks } from './useTracks'
import type { Track, DataSource } from '../types/track'

const activeMin = ref<number | null>(null)
const activeMax = ref<number | null>(null)
const hasActiveFilter = ref(false)
const filterVersion = ref(0)

/** Per-source point count filter state */
export interface PointCountFilter {
  enabled: boolean
  min: number | null
  max: number | null
}

const pointCountFilters = ref<Record<DataSource, PointCountFilter>>({
  adsb: { enabled: false, min: null, max: null },
  radar: { enabled: false, min: null, max: null },
  radar_raw: { enabled: false, min: null, max: null },
  simulation: { enabled: false, min: null, max: null },
})

export function useTrackFilter() {
  const { tracks } = useTracks()

  /** Returns the overall min/max across all sources using cached metadata (O(N)) */
  const globalTimeRange = computed(() => {
    let min = Infinity
    let max = -Infinity
    for (const t of tracks.value) {
      if (t.minTimestamp && t.minTimestamp < min) min = t.minTimestamp
      if (t.maxTimestamp && t.maxTimestamp > max) max = t.maxTimestamp
    }
    return min < max ? { min, max } : null
  })

  function setUniversalTimeRange(min: number, max: number) {
    activeMin.value = min
    activeMax.value = max
    hasActiveFilter.value = true
    filterVersion.value++
  }

  function clearAllTimeRanges() {
    activeMin.value = null
    activeMax.value = null
    hasActiveFilter.value = false
    filterVersion.value++
  }

  /** Update per-source point count filter */
  function setPointCountFilter(source: DataSource, filter: Partial<PointCountFilter>) {
    const current = pointCountFilters.value[source]
    pointCountFilters.value[source] = { ...current, ...filter }
    filterVersion.value++
  }

  /** Check if any point count filter is active */
  const hasPointCountFilter = computed(() =>
    Object.values(pointCountFilters.value).some((f) => f.enabled && (f.min != null || f.max != null))
  )

  // Persist filter changes
  const _saveFilter = () => {
    import('./useSettingsPersistence').then(({ scheduleSave }) => {
      scheduleSave('filter.active_min', JSON.stringify(activeMin.value))
      scheduleSave('filter.active_max', JSON.stringify(activeMax.value))
      for (const [src, f] of Object.entries(pointCountFilters.value)) {
        scheduleSave(`filter.point_count.${src}`, JSON.stringify(f))
      }
    })
  }

  watch(activeMin, _saveFilter, { immediate: false })
  watch(activeMax, _saveFilter, { immediate: false })
  watch(pointCountFilters, _saveFilter, { deep: true, immediate: false })

  /** Filtered tracks using metadata for O(N) pre-filter, plus point-level time filtering */
  const filteredTracks = computed<Track[]>(() => {
    let result = tracks.value

    // Step 1: Time range pre-filter using metadata (O(N) — no position iteration)
    if (hasActiveFilter.value && activeMin.value != null && activeMax.value != null) {
      result = result.filter(
        (t) =>
          t.maxTimestamp >= activeMin.value! &&
          t.minTimestamp <= activeMax.value!,
      )
      // Step 2: Point-level time filter (only for tracks that passed pre-filter)
      result = result
        .map((track) => {
          const filtered = track.positions.filter(
            (p) => p.timestamp >= activeMin.value! && p.timestamp <= activeMax.value!,
          )
          if (filtered.length === 0) return null
          return { ...track, positions: filtered, pointCount: filtered.length }
        })
        .filter((t): t is Track => t !== null)
    }

    // Step 3: Per-source point count filter
    if (hasPointCountFilter.value) {
      result = result.filter((t) => {
        const pf = pointCountFilters.value[t.source]
        if (!pf || !pf.enabled) return true
        if (pf.min != null && t.pointCount < pf.min) return false
        if (pf.max != null && t.pointCount > pf.max) return false
        return true
      })
    }

    return result
  })

  return {
    filteredTracks,
    globalTimeRange,
    setUniversalTimeRange,
    clearAllTimeRanges,
    activeMin,
    activeMax,
    hasActiveFilter,
    hasPointCountFilter,
    pointCountFilters,
    setPointCountFilter,
    filterVersion,
  }
}
