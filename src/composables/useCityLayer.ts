import { reactive, watch } from 'vue'

export type CityLayerKey = 'cities'
export type CityLevel = 'capital' | 'regional' | 'prefecture' | 'major'

const cityLayer = reactive({
  visible: true,
  labels: true,
  minPopulation: 250_000,
  levels: {
    capital: true,
    regional: true,
    prefecture: true,
    major: true,
  } as Record<CityLevel, boolean>,
  pointSize: 5,
  fontSize: 13,
  color: '#f5c542',
  labelColor: '#ffffff',
})

let persistenceWatchersStarted = false

export function useCityLayer() {
  if (!persistenceWatchersStarted) {
    persistenceWatchersStarted = true

    watch(cityLayer, (val) => {
      import('./useSettingsPersistence').then(({ scheduleSave }) => {
        scheduleSave('display.city_layer', JSON.stringify(val))
      })
    }, { deep: true, immediate: false })
  }

  function setCityVisible(visible: boolean) {
    cityLayer.visible = visible
  }

  function setCityLabels(visible: boolean) {
    cityLayer.labels = visible
  }

  function setCityMinPopulation(value: number) {
    cityLayer.minPopulation = Math.max(0, Math.min(20_000_000, Math.round(value)))
  }

  function setCityLevelVisible(level: CityLevel, visible: boolean) {
    cityLayer.levels[level] = visible
  }

  function setCityPointSize(value: number) {
    cityLayer.pointSize = Math.max(2, Math.min(12, Math.round(value)))
  }

  function setCityFontSize(value: number) {
    cityLayer.fontSize = Math.max(9, Math.min(24, Math.round(value)))
  }

  function setCityColor(color: string) {
    cityLayer.color = color
  }

  function setCityLabelColor(color: string) {
    cityLayer.labelColor = color
  }

  return {
    cityLayer,
    setCityVisible,
    setCityLabels,
    setCityMinPopulation,
    setCityLevelVisible,
    setCityPointSize,
    setCityFontSize,
    setCityColor,
    setCityLabelColor,
  }
}
