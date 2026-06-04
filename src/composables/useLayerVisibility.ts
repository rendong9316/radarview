import { ref, watch } from 'vue'
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

  // Persist layer visibility changes
  watch(visibility, (val) => {
    import('./useSettingsPersistence').then(({ scheduleSave }) => {
      for (const src of Object.keys(val) as DataSource[]) {
        scheduleSave(`display.layer_visible.${src}`, JSON.stringify(val[src]))
      }
    })
  }, { deep: true, immediate: false })

  return { visibility, toggle, setVisible, isVisible }
}
