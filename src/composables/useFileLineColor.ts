/**
 * src/composables/useFileLineColor.ts — 文件级线条颜色覆盖
 *
 * 取值逻辑：file 级 > source 级 > 主题默认。
 * 模块级单例，持久化到 SQLite。
 */

import { ref, watch } from 'vue'
import type { DataSource } from '../types/track'
import { getEffectiveHex } from './useLineColor'

// ═══════════════════════════════════════════
// 模块级状态（单例）
// ═══════════════════════════════════════════

/** "source::fileName" → hex color or null (null = use source default) */
const fileColors = ref<Record<string, string | null>>({})
const SETTINGS_KEY = 'display.file_line_color'

// ═══════════════════════════════════════════
// 模块级持久化 watcher（仅创建一次）
// ═══════════════════════════════════════════

watch(fileColors, () => {
  import('./useSettingsPersistence').then(({ scheduleSave }) => {
    scheduleSave(SETTINGS_KEY, JSON.stringify(fileColors.value))
  })
}, { deep: true, immediate: false })

// ═══════════════════════════════════════════
// 持久化加载
// ═══════════════════════════════════════════

/** 从持久化数据恢复（由 useSettingsPersistence 在启动时调用） */
export function loadFileColors(raw: Record<string, string>) {
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
        fileColors.value = clean
      }
    } catch { /* keep default */ }
  }
}

// ═══════════════════════════════════════════
// 公开 API（工厂函数，无副作用）
// ═══════════════════════════════════════════

export function useFileLineColor() {
  /** 获取有效颜色：file 覆盖 > source 覆盖 > 主题默认 */
  function getEffectiveFileColor(source: DataSource, fileName: string): string {
    const fk = `${source}::${fileName}`
    const fc = fileColors.value[fk]
    if (fc) return fc
    return getEffectiveHex(source)
  }

  /** 是否有 file 级自定义颜色 */
  function hasFileColor(source: DataSource, fileName: string): boolean {
    const fk = `${source}::${fileName}`
    const fc = fileColors.value[fk]
    return fc != null && fc !== ''
  }

  /** 设置 file 级颜色（null = 恢复跟随 source） */
  function setFileColor(source: DataSource, fileName: string, hex: string | null) {
    const fk = `${source}::${fileName}`
    if (hex) {
      fileColors.value = { ...fileColors.value, [fk]: hex }
    } else {
      // Remove key entirely instead of storing null
      const next = { ...fileColors.value }
      delete next[fk]
      fileColors.value = next
    }
  }

  /** 重置某文件颜色为跟随 source */
  function resetFileColor(source: DataSource, fileName: string) {
    setFileColor(source, fileName, null)
  }

  return { fileColors, getEffectiveFileColor, hasFileColor, setFileColor, resetFileColor }
}
