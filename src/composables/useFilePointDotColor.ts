/**
 * src/composables/useFilePointDotColor.ts — 文件级点迹颜色覆盖
 *
 * 取值逻辑：file 级 > source 级 > auto（线条对比色）。
 * 模块级单例，持久化到 SQLite。
 */

import { ref, watch } from 'vue'
import type { DataSource } from '../types/track'

// ═══════════════════════════════════════════
// 模块级状态（单例）
// ═══════════════════════════════════════════

/** "source::fileName" → hex color or null (null = use source/auto) */
const filePointDotColors = ref<Record<string, string | null>>({})
export { filePointDotColors }
const SETTINGS_KEY = 'display.file_point_dot_color'

// ═══════════════════════════════════════════
// 模块级持久化 watcher（仅创建一次）
// ═══════════════════════════════════════════

watch(filePointDotColors, () => {
  import('./useSettingsPersistence').then(({ scheduleSave }) => {
    scheduleSave(SETTINGS_KEY, JSON.stringify(filePointDotColors.value))
  })
}, { deep: true, immediate: false })

// ═══════════════════════════════════════════
// 持久化加载
// ═══════════════════════════════════════════

/** 从持久化数据恢复（由 useSettingsPersistence 在启动时调用） */
export function loadFilePointDotColors(raw: Record<string, string>) {
  const rawVal = raw[SETTINGS_KEY]
  if (rawVal !== undefined) {
    try {
      const parsed = JSON.parse(rawVal)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // Only keep truthy values to avoid stale null keys
        const clean: Record<string, string | null> = {}
        for (const [k, v] of Object.entries(parsed)) {
          if (v) clean[k] = v as string
        }
        filePointDotColors.value = clean
      }
    } catch { /* keep default */ }
  }
}

// ═══════════════════════════════════════════
// 公开 API（工厂函数，无副作用）
// ═══════════════════════════════════════════

export function useFilePointDotColor() {
  /** 获取有效颜色：file 覆盖 > source 覆盖 > auto */
  function getEffectiveFilePointDotColor(source: DataSource, fileName: string, sourceColor: string | null): string | null {
    const fk = `${source}::${fileName}`
    const fc = filePointDotColors.value[fk]
    if (fc) return fc
    return sourceColor
  }

  /** 是否有 file 级自定义颜色 */
  function hasFilePointDotColor(source: DataSource, fileName: string): boolean {
    const fk = `${source}::${fileName}`
    const fc = filePointDotColors.value[fk]
    return fc != null && fc !== ''
  }

  /** 设置 file 级颜色（null = 恢复跟随 source） */
  function setFilePointDotColor(source: DataSource, fileName: string, hex: string | null) {
    const fk = `${source}::${fileName}`
    if (hex) {
      filePointDotColors.value = { ...filePointDotColors.value, [fk]: hex }
    } else {
      // Remove key entirely instead of storing null
      const next = { ...filePointDotColors.value }
      delete next[fk]
      filePointDotColors.value = next
    }
  }

  /** 重置某文件颜色为跟随 source */
  function resetFilePointDotColor(source: DataSource, fileName: string) {
    setFilePointDotColor(source, fileName, null)
  }

  return { filePointDotColors, getEffectiveFilePointDotColor, hasFilePointDotColor, setFilePointDotColor, resetFilePointDotColor }
}
