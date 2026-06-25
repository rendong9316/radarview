/**
 * src/composables/useFileDotScale.ts — 文件级端点大小覆盖
 *
 * 取值逻辑：file 级 > source 级 > 默认值。
 * 模块级单例，持久化到 SQLite。
 */

import { ref, watch } from 'vue'
import type { DataSource } from '../types/track'

// "source::fileName" → scale (null = use source default)
const fileScales = ref<Record<string, number | null>>({})
const SETTINGS_KEY = 'display.file_dot_scale'

export function loadFileScales(raw: Record<string, string>) {
  const rawVal = raw[SETTINGS_KEY]
  if (rawVal !== undefined) {
    try {
      const parsed = JSON.parse(rawVal)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        fileScales.value = parsed
      }
    } catch { /* keep default */ }
  }
}

export function useFileDotScale() {
  function getEffectiveFileScale(source: DataSource, fileName: string, sourceScale: number): number {
    const fk = `${source}::${fileName}`
    const fs = fileScales.value[fk]
    if (fs != null) return fs
    return sourceScale
  }

  function hasFileScale(source: DataSource, fileName: string): boolean {
    return fileScales.value[`${source}::${fileName}`] != null
  }

  function setFileScale(source: DataSource, fileName: string, scale: number | null) {
    const fk = `${source}::${fileName}`
    fileScales.value = { ...fileScales.value, [fk]: scale }
    _persist()
  }

  function resetFileScale(source: DataSource, fileName: string) {
    setFileScale(source, fileName, null)
  }

  function _persist() {
    import('./useSettingsPersistence').then(({ scheduleSave }) => {
      scheduleSave(SETTINGS_KEY, JSON.stringify(fileScales.value))
    })
  }

  watch(fileScales, _persist, { deep: true, immediate: false })

  return { fileScales, getEffectiveFileScale, hasFileScale, setFileScale, resetFileScale }
}
