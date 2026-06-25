/**
 * src/composables/useFileLineWidth.ts — 文件级线条宽度覆盖
 *
 * 取值逻辑：file 级 > source 级 > 默认 2.0。
 * 模块级单例，持久化到 SQLite。
 */

import { ref, watch } from 'vue'
import type { DataSource } from '../types/track'
import { useLineWidth } from './useLineWidth'

// "source::fileName" → width (null = use source default)
const fileWidths = ref<Record<string, number | null>>({})
const SETTINGS_KEY = 'display.file_line_width'

export function loadFileWidths(raw: Record<string, string>) {
  const rawVal = raw[SETTINGS_KEY]
  if (rawVal !== undefined) {
    try {
      const parsed = JSON.parse(rawVal)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        fileWidths.value = parsed
      }
    } catch { /* keep default */ }
  }
}

export function useFileLineWidth() {
  const { lineWidths } = useLineWidth()

  function getEffectiveFileWidth(source: DataSource, fileName: string): number {
    const fk = `${source}::${fileName}`
    const fw = fileWidths.value[fk]
    if (fw != null) return fw
    return lineWidths[source]
  }

  function hasFileWidth(source: DataSource, fileName: string): boolean {
    return fileWidths.value[`${source}::${fileName}`] != null
  }

  function setFileWidth(source: DataSource, fileName: string, width: number | null) {
    const fk = `${source}::${fileName}`
    fileWidths.value = { ...fileWidths.value, [fk]: width }
    _persist()
  }

  function resetFileWidth(source: DataSource, fileName: string) {
    setFileWidth(source, fileName, null)
  }

  function _persist() {
    import('./useSettingsPersistence').then(({ scheduleSave }) => {
      scheduleSave(SETTINGS_KEY, JSON.stringify(fileWidths.value))
    })
  }

  watch(fileWidths, _persist, { deep: true, immediate: false })

  return { fileWidths, getEffectiveFileWidth, hasFileWidth, setFileWidth, resetFileWidth }
}
