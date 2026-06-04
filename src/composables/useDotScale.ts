import { reactive } from 'vue'
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
    dotScale[source] = Math.max(0.2, Math.min(3.0, s))
  }

  return { dotScale, setDotScale }
}
