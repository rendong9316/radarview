import { ref, watch } from 'vue'

/** Global scale for track point dots, shared across the app. */
const trackPointDotScale = ref(1.0)

/** Global toggle: when enabled, all displayed tracks show their point dots. */
const showAllPointDots = ref(false)

export function useTrackPointDots() {
  function setTrackPointDotScale(v: number) {
    trackPointDotScale.value = Math.max(0.2, Math.min(5.0, Math.round(v * 10) / 10))
  }

  function toggleAllPointDots() {
    showAllPointDots.value = !showAllPointDots.value
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

  return { trackPointDotScale, setTrackPointDotScale, showAllPointDots, toggleAllPointDots }
}
