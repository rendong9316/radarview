import { ref, reactive, watch } from 'vue'
import type { DataSource } from '../types/track'

/** Global scale for track point dots, shared across the app. */
const trackPointDotScale = ref(1.0)

/** Global toggle: when enabled, all displayed tracks show their point dots. */
const showAllPointDots = ref(false)

/** Incremented each time the user requests "clear all point dots". Watched by CesiumMap. */
const clearAllCounter = ref(0)

/** Per-source custom point dot colors. null = auto (contrast of line color). */
const pointDotColors = reactive<Record<DataSource, string | null>>({
  adsb: null,
  radar: null,
  radar_raw: null,
  simulation: null,
})

export function useTrackPointDots() {
  function setTrackPointDotScale(v: number) {
    trackPointDotScale.value = Math.max(0.2, Math.min(5.0, Math.round(v * 10) / 10))
  }

  function toggleAllPointDots() {
    showAllPointDots.value = !showAllPointDots.value
  }

  function requestClearAll() {
    clearAllCounter.value++
  }

  function setPointDotColor(source: DataSource, hex: string | null) {
    pointDotColors[source] = hex
  }

  function hasCustomPointDotColor(source: DataSource): boolean {
    return pointDotColors[source] !== null
  }

  // Persist dot scale changes
  watch(trackPointDotScale, () => {
    import('./useSettingsPersistence').then(({ scheduleSave }) => {
      scheduleSave('display.track_point_dot_scale', JSON.stringify(trackPointDotScale.value))
    })
  }, { immediate: false })

  // Persist global toggle
  watch(showAllPointDots, () => {
    import('./useSettingsPersistence').then(({ scheduleSave }) => {
      scheduleSave('display.show_all_point_dots', JSON.stringify(showAllPointDots.value))
    })
  }, { immediate: false })

  // Persist point dot colors
  watch(pointDotColors, () => {
    import('./useSettingsPersistence').then(({ scheduleSave }) => {
      for (const [src, v] of Object.entries(pointDotColors)) {
        scheduleSave(`display.point_dot_color.${src}`, JSON.stringify(v))
      }
    })
  }, { deep: true, immediate: false })

  return {
    trackPointDotScale, setTrackPointDotScale,
    showAllPointDots, toggleAllPointDots,
    clearAllCounter, requestClearAll,
    pointDotColors, setPointDotColor, hasCustomPointDotColor,
  }
}
