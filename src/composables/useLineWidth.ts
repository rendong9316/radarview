import { reactive } from 'vue'
import type { DataSource } from '../types/track'

/** Per-source line width (pixels), shared across the app */
const lineWidths = reactive<Record<DataSource, number>>({
  adsb: 2.0,
  radar: 2.0,
  radar_raw: 2.0,
  simulation: 2.0,
})

export function useLineWidth() {
  function setLineWidth(source: DataSource, width: number) {
    lineWidths[source] = Math.max(0.5, Math.min(10, width))
  }

  return { lineWidths, setLineWidth }
}
