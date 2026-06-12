import { reactive, watch } from 'vue'
import type { DataSource } from '../types/track'

/** Per-source dot (billboard) scale multiplier, shared across the app.
 *  1.0 = original size, all billboard scales are multiplied by this factor. */
const dotScale = reactive<Record<DataSource, number>>({
  adsb: 1.0,
  radar: 1.0,
  radar_raw: 1.0,
  simulation: 1.0,
})

export function useDotScale() {
  function setDotScale(source: DataSource, s: number) {
    if (isNaN(s)) return
    dotScale[source] = Math.max(0.2, Math.min(3.0, s))
  }

  // Persist dot scale changes
  watch(dotScale, (val) => {
    import('./useSettingsPersistence').then(({ scheduleSave }) => {
      for (const [src, v] of Object.entries(val)) {
        scheduleSave(`display.dot_scale.${src}`, JSON.stringify(v))
      }
    })
  }, { deep: true, immediate: false })

  return { dotScale, setDotScale }
}
