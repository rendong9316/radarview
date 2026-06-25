/**
 * src/composables/useFileVisibility.ts — 文件级可见性管理
 *
 * 配合 useLayerVisibility（数据源级），提供 source+file 两级可见性。
 * 有效可见性 = sourceVisible && fileVisible。
 * 模块级单例，所有组件共享。持久化到 SQLite。
 */

import { ref } from 'vue'
import type { DataSource } from '../types/track'

// ═══════════════════════════════════════════
// 模块级状态
// ═══════════════════════════════════════════

/** key = "source::fileName", value = visible (default true) */
const fileVisibility = ref<Record<string, boolean>>({})

/** 持久化 key */
const SETTINGS_KEY = 'display.file_visible'

/** 从持久化数据恢复（由 useSettingsPersistence 在启动时调用） */
export function loadFileVisibility(raw: Record<string, string>) {
  const rawVal = raw[SETTINGS_KEY]
  if (rawVal !== undefined) {
    try {
      const parsed = JSON.parse(rawVal)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        fileVisibility.value = parsed
      }
    } catch { /* keep default */ }
  }
}

// ═══════════════════════════════════════════
// 公开 API
// ═══════════════════════════════════════════

export function useFileVisibility() {
  /** 检查某个文件是否可见（不存在记录时默认 true） */
  function isFileVisible(source: DataSource, fileName: string): boolean {
    const key = `${source}::${fileName}`
    return fileVisibility.value[key] !== false
  }

  /** 设置文件可见性 */
  function setFileVisible(source: DataSource, fileName: string, visible: boolean) {
    const key = `${source}::${fileName}`
    fileVisibility.value = { ...fileVisibility.value, [key]: visible }
    _persist()
  }

  /** 获取某数据源下所有文件及其可见性 */
  function getFilesForSource(source: DataSource, fileNames: string[]): { fileName: string; visible: boolean }[] {
    return fileNames.map(fn => ({
      fileName: fn,
      visible: isFileVisible(source, fn),
    }))
  }

  /** 获取原始可见性 Map（供渲染器使用） */
  function getVisibilityMap(): Record<string, boolean> {
    return { ...fileVisibility.value }
  }

  // ═══════════════════════════════════════════
  // 持久化
  // ═══════════════════════════════════════════

  function _persist() {
    import('./useSettingsPersistence').then(({ scheduleSave }) => {
      scheduleSave(SETTINGS_KEY, JSON.stringify(fileVisibility.value))
    })
  }

  return { fileVisibility, isFileVisible, setFileVisible, getFilesForSource, getVisibilityMap }
}
