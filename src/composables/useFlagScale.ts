import { ref, watch } from 'vue'

/**
 * 旗标图标和文字缩放系数。
 * 模块级 ref 实现单例模式，跨组件共享。
 */
const flagScale = ref(1.0)

export function useFlagScale() {
  function setFlagScale(v: number) {
    flagScale.value = Math.round(v * 10) / 10
  }

  // Persist
  watch(flagScale, () => {
    import('./useSettingsPersistence').then(({ scheduleSave }) => {
      scheduleSave('display.flag_scale', JSON.stringify(flagScale.value))
    })
  }, { immediate: false })

  return { flagScale, setFlagScale }
}
