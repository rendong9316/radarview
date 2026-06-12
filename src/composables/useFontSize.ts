import { ref, watch } from 'vue'

/**
 * 应用全局字号大小（px）。
 * 模块级 ref 实现单例模式，跨组件共享。
 */
const fontSize = ref(14)

function applyFontSize(v: number) {
  // Set root font-size; CSS declarations use rem units to scale relative to this.
  if (isNaN(v) || v <= 0) return
  document.documentElement.style.fontSize = v + 'px'
}

export function useFontSize() {
  function setFontSize(v: number) {
    fontSize.value = Math.max(10, Math.min(20, v))
  }

  // Apply immediately and persist
  watch(fontSize, (v) => {
    applyFontSize(v)
    import('./useSettingsPersistence').then(({ scheduleSave }) => {
      scheduleSave('display.font_size', JSON.stringify(v))
    })
  }, { immediate: false })

  // Apply on first import (before any watcher fires)
  applyFontSize(fontSize.value)

  return { fontSize, setFontSize }
}
