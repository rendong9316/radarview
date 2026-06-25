/**
 * src/composables/useFileLineWidth.ts — 文件级线条宽度覆盖
 *
 * 取值逻辑：file 级 > source 级 > 默认 2.0。
 * 模块级单例，持久化到 SQLite。
 */

import { ref, watch } from 'vue'
import type { DataSource } from '../types/track'
import { useLineWidth } from './useLineWidth'

// ═══════════════════════════════════════════
// 模块级状态（单例）
// ═══════════════════════════════════════════

/** "source::fileName" → width (null = use source default) */
const fileWidths = ref<Record<string, number | null>>({})
const SETTINGS_KEY = 'display.file_line_width'

// ═══════════════════════════════════════════
// 模块级持久化 watcher（仅创建一次）
// ═══════════════════════════════════════════

watch(fileWidths, () => {
  import('./useSettingsPersistence').then(({ scheduleSave }) => {
    scheduleSave(SETTINGS_KEY, JSON.stringify(fileWidths.value))
  })
}, { deep: true, immediate: false })

// ═══════════════════════════════════════════
// 持久化加载
// ═══════════════════════════════════════════

/** 从持久化数据恢复 */
export function loadFileWidths(raw: Record<string, string>) {
  const rawVal = raw[SETTINGS_KEY]
  if (rawVal !== undefined) {
    try {
      const parsed = JSON.parse(rawVal)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // Only keep numeric values, strip null garbage
        const clean: Record<string, number> = {}
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'number') clean[k] = v
        }
        fileWidths.value = clean
      }
    } catch { /* keep default */ }
  }
}

// ═══════════════════════════════════════════
// 公开 API（工厂函数，无副作用）
// ═══════════════════════════════════════════

export function useFileLineWidth() {
  const { lineWidths } = useLineWidth()

  /** 获取有效宽度：file 覆盖 > source 默认 */
  function getEffectiveFileWidth(source: DataSource, fileName: string): number {
    const fk = `${source}::${fileName}`
    const fw = fileWidths.value[fk]
    if (fw != null) return fw
    return lineWidths[source]
  }

  /** 是否有 file 级自定义宽度 */
  function hasFileWidth(source: DataSource, fileName: string): boolean {
    return fileWidths.value[`${source}::${fileName}`] != null
  }

  /** 设置 file 级宽度（null = 恢复跟随 source） */
  function setFileWidth(source: DataSource, fileName: string, width: number | null) {
    const fk = `${source}::${fileName}`
    if (width != null) {
      fileWidths.value = { ...fileWidths.value, [fk]: width }
    } else {
      const next = { ...fileWidths.value }
      delete next[fk]
      fileWidths.value = next
    }
  }

  /** 重置某文件宽度为跟随 source */
  function resetFileWidth(source: DataSource, fileName: string) {
    setFileWidth(source, fileName, null)
  }

  return { fileWidths, getEffectiveFileWidth, hasFileWidth, setFileWidth, resetFileWidth }
}
