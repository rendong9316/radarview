import { ref } from 'vue'
import type { DataSource, LayerVisibility } from '../types/track'

const visibility = ref<LayerVisibility>({
  adsb: true,
  radar: true,
  radar_raw: true,
  simulation: true,
})

export function useLayerVisibility() {
  function toggle(source: DataSource) {
    visibility.value[source] = !visibility.value[source]
  }

  function setVisible(source: DataSource, visible: boolean) {
    visibility.value[source] = visible
  }

  function isVisible(source: DataSource): boolean {
    return visibility.value[source]
  }

  return { visibility, toggle, setVisible, isVisible }
}
