/**
 * src/composables/useFileLineColor.ts — 文件级线条颜色覆盖
 *
 * 取值逻辑：file 级 > source 级 > 主题默认。
 * 模块级单例，持久化到 SQLite。
 */

import { ref, watch } from 'vue'
import type { DataSource } from '../types/track'
import { useLineColor } from './useLineColor'

// "source::fileName" → hex color or null (null = use source default)
const fileColors = ref<Record<string, string | null>>({})
const SETTINGS_KEY = 'display.file_line_color'

/** 从持久化数据恢复（由 useSettingsPersistence 在启动时调用） */
export function loadFileColors(raw: Record<string, string>) {
  const rawVal = raw[SETTINGS_KEY]
  if (rawVal !== undefined) {
    try {
      const parsed = JSON.parse(rawVal)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        fileColors.value = parsed
      }
    } catch { /* keep default */ }
  }
}

export function useFileLineColor() {
  const { getEffectiveHex } = useLineColor()

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
    return fileColors.value[fk] != null
  }

  /** 设置 file 级颜色（null = 恢复跟随 source） */
  function setFileColor(source: DataSource, fileName: string, hex: string | null) {
    const fk = `${source}::${fileName}`
    fileColors.value = { ...fileColors.value, [fk]: hex }
    _persist()
  }

  /** 重置某文件颜色为跟随 source */
  function resetFileColor(source: DataSource, fileName: string) {
    setFileColor(source, fileName, null)
  }

  function _persist() {
    import('./useSettingsPersistence').then(({ scheduleSave }) => {
      scheduleSave(SETTINGS_KEY, JSON.stringify(fileColors.value))
    })
  }

  watch(fileColors, _persist, { deep: true, immediate: false })

  return { fileColors, getEffectiveFileColor, hasFileColor, setFileColor, resetFileColor }
}
