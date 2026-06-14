import { reactive, watch } from 'vue'

export type CityLayerKey = 'cities'
export type CityLevel = 'capital' | 'regional' | 'prefecture' | 'major'
export type CityLodLevel = Exclude<CityLevel, 'capital'>

export const DEFAULT_CITY_LOD = {
  pointMaxHeight: {
    regional: 2_400_000,
    prefecture: 1_500_000,
    major: 1_300_000,
  } as Record<CityLodLevel, number>,
  labelMaxHeight: {
    regional: 2_400_000,
    prefecture: 1_000_000,
    major: 1_000_000,
  } as Record<CityLodLevel, number>,
}

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
  lod: {
    pointMaxHeight: { ...DEFAULT_CITY_LOD.pointMaxHeight },
    labelMaxHeight: { ...DEFAULT_CITY_LOD.labelMaxHeight },
  },
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

  function setCityPointMaxHeight(level: CityLodLevel, value: number) {
    cityLayer.lod.pointMaxHeight[level] = clampHeight(value)
  }

  function setCityLabelMaxHeight(level: CityLodLevel, value: number) {
    cityLayer.lod.labelMaxHeight[level] = clampHeight(value)
  }

  function resetCityLod() {
    Object.assign(cityLayer.lod.pointMaxHeight, DEFAULT_CITY_LOD.pointMaxHeight)
    Object.assign(cityLayer.lod.labelMaxHeight, DEFAULT_CITY_LOD.labelMaxHeight)
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
    setCityPointMaxHeight,
    setCityLabelMaxHeight,
    resetCityLod,
    setCityPointSize,
    setCityFontSize,
    setCityColor,
    setCityLabelColor,
  }
}

function clampHeight(value: number) {
  return Math.max(100_000, Math.min(40_000_000, Math.round(value)))
}
