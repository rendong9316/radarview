import { ref, watch } from 'vue'

/** 中位数倍数：threshold = median × multiplier */
export const segMultiplier = ref(10)

/** 绝对下限（分钟）：短于此值不算断点 */
export const segMinThresholdMin = ref(5)

/** 桥接线宽度比例（相对于数据线宽） */
export const bridgeWidthRatio = ref(0.3)

/** 桥接线透明度 */
export const bridgeAlpha = ref(0.15)

// ── 持久化 watch ──

watch(segMultiplier, () => {
  import('./useSettingsPersistence').then(({ scheduleSave }) => {
    scheduleSave('segmentation.multiplier', JSON.stringify(segMultiplier.value))
  })
})

watch(segMinThresholdMin, () => {
  import('./useSettingsPersistence').then(({ scheduleSave }) => {
    scheduleSave('segmentation.min_threshold_min', JSON.stringify(segMinThresholdMin.value))
  })
})

watch(bridgeWidthRatio, () => {
  import('./useSettingsPersistence').then(({ scheduleSave }) => {
    scheduleSave('segmentation.bridge_width_ratio', JSON.stringify(bridgeWidthRatio.value))
  })
})

watch(bridgeAlpha, () => {
  import('./useSettingsPersistence').then(({ scheduleSave }) => {
    scheduleSave('segmentation.bridge_alpha', JSON.stringify(bridgeAlpha.value))
  })
})

export function useSegmentationSettings() {
  function setSegMultiplier(v: number) {
    if (isNaN(v) || v < 2) { segMultiplier.value = 2; return }
    if (v > 20) { segMultiplier.value = 20; return }
    segMultiplier.value = Math.round(v)
  }

  function setSegMinThresholdMin(v: number) {
    if (isNaN(v) || v < 1) { segMinThresholdMin.value = 1; return }
    if (v > 30) { segMinThresholdMin.value = 30; return }
    segMinThresholdMin.value = Math.round(v)
  }

  function setBridgeWidthRatio(v: number) {
    if (isNaN(v) || v < 0.05) { bridgeWidthRatio.value = 0.05; return }
    if (v > 1.0) { bridgeWidthRatio.value = 1.0; return }
    bridgeWidthRatio.value = Math.round(v * 100) / 100
  }

  function setBridgeAlpha(v: number) {
    if (isNaN(v) || v < 0.05) { bridgeAlpha.value = 0.05; return }
    if (v > 0.5) { bridgeAlpha.value = 0.5; return }
    bridgeAlpha.value = Math.round(v * 100) / 100
  }

  function resetAll() {
    segMultiplier.value = 10
    segMinThresholdMin.value = 5
    bridgeWidthRatio.value = 0.3
    bridgeAlpha.value = 0.15
  }

  return {
    segMultiplier,
    segMinThresholdMin,
    bridgeWidthRatio,
    bridgeAlpha,
    setSegMultiplier,
    setSegMinThresholdMin,
    setBridgeWidthRatio,
    setBridgeAlpha,
    resetAll,
  }
}
