import { reactive, ref, watch } from 'vue'

export type BoundaryLayerKey = 'coastline' | 'admin0' | 'admin1'

const boundaryVisible = ref(true)
const boundaryWidths = reactive<Record<BoundaryLayerKey, number>>({
  coastline: 1.0,
  admin0: 1.4,
  admin1: 0.8,
})
const boundaryColors = reactive<Record<BoundaryLayerKey, string>>({
  coastline: '#000000',
  admin0: '#000000',
  admin1: '#000000',
})

let persistenceWatchersStarted = false

export function useBoundaryLayers() {
  if (!persistenceWatchersStarted) {
    persistenceWatchersStarted = true

    watch(boundaryVisible, () => {
      import('./useSettingsPersistence').then(({ scheduleSave }) => {
        scheduleSave('display.boundary_visible', JSON.stringify(boundaryVisible.value))
      })
    }, { immediate: false })

    watch(boundaryWidths, (val) => {
      import('./useSettingsPersistence').then(({ scheduleSave }) => {
        for (const [layer, width] of Object.entries(val)) {
          scheduleSave(`display.boundary_width.${layer}`, JSON.stringify(width))
        }
      })
    }, { deep: true, immediate: false })

    watch(boundaryColors, (val) => {
      import('./useSettingsPersistence').then(({ scheduleSave }) => {
        for (const [layer, color] of Object.entries(val)) {
          scheduleSave(`display.boundary_color.${layer}`, JSON.stringify(color))
        }
      })
    }, { deep: true, immediate: false })
  }

  function setBoundaryVisible(visible: boolean) {
    boundaryVisible.value = visible
  }

  function setBoundaryWidth(layer: BoundaryLayerKey, width: number) {
    boundaryWidths[layer] = Math.max(0.2, Math.min(5, Math.round(width * 10) / 10))
  }

  function setBoundaryColor(layer: BoundaryLayerKey, color: string) {
    boundaryColors[layer] = color
  }

  return {
    boundaryVisible,
    boundaryWidths,
    boundaryColors,
    setBoundaryVisible,
    setBoundaryWidth,
    setBoundaryColor,
  }
}
