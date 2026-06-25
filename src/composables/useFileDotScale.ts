/**
 * src/composables/useFileDotScale.ts — 文件级端点大小覆盖
 *
 * 取值逻辑：file 级 > source 级 > 默认值。
 * 模块级单例，持久化到 SQLite。
 */

import { ref, watch } from 'vue'
import type { DataSource } from '../types/track'

// ═══════════════════════════════════════════
// 模块级状态（单例）
// ═══════════════════════════════════════════

/** "source::fileName" → scale (null = use source default) */
const fileScales = ref<Record<string, number | null>>({})
const SETTINGS_KEY = 'display.file_dot_scale'

// ═══════════════════════════════════════════
// 模块级持久化 watcher（仅创建一次）
// ═══════════════════════════════════════════

watch(fileScales, () => {
  import('./useSettingsPersistence').then(({ scheduleSave }) => {
    scheduleSave(SETTINGS_KEY, JSON.stringify(fileScales.value))
  })
}, { deep: true, immediate: false })

// ═══════════════════════════════════════════
// 持久化加载
// ═══════════════════════════════════════════

/** 从持久化数据恢复 */
export function loadFileScales(raw: Record<string, string>) {
  const rawVal = raw[SETTINGS_KEY]
  if (rawVal !== undefined) {
    try {
      const parsed = JSON.parse(rawVal)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const clean: Record<string, number> = {}
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'number') clean[k] = v
        }
        fileScales.value = clean
      }
    } catch { /* keep default */ }
  }
}

// ═══════════════════════════════════════════
// 公开 API（工厂函数，无副作用）
// ═══════════════════════════════════════════

export function useFileDotScale() {
  /** 获取有效缩放：file 覆盖 > source 默认 */
  function getEffectiveFileScale(source: DataSource, fileName: string, sourceScale: number): number {
    const fk = `${source}::${fileName}`
    const fs = fileScales.value[fk]
    if (fs != null) return fs
    return sourceScale
  }

  /** 是否有 file 级自定义缩放 */
  function hasFileScale(source: DataSource, fileName: string): boolean {
    return fileScales.value[`${source}::${fileName}`] != null
  }

  /** 设置 file 级缩放（null = 恢复跟随 source） */
  function setFileScale(source: DataSource, fileName: string, scale: number | null) {
    const fk = `${source}::${fileName}`
    if (scale != null) {
      fileScales.value = { ...fileScales.value, [fk]: scale }
    } else {
      const next = { ...fileScales.value }
      delete next[fk]
      fileScales.value = next
    }
  }

  /** 重置某文件缩放为跟随 source */
  function resetFileScale(source: DataSource, fileName: string) {
    setFileScale(source, fileName, null)
  }

  return { fileScales, getEffectiveFileScale, hasFileScale, setFileScale, resetFileScale }
}
