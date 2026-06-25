/**
 * src/composables/useTrackElevation.ts — 航迹抬升状态管理
 *
 * 维护每条航迹的渲染高度偏移量（米），在 FLAT_ALTITUDE 基础上叠加。
 * 模块级单例模式，跨组件共享。偏移量通过 useSettingsPersistence 持久化到 SQLite。
 *
 * 使用方式：
 *   import { getEffectiveAltitude, setElevationOffset, resetElevation } from '../composables/useTrackElevation'
 */

import { FLAT_ALTITUDE } from '../cesium/types'

// ═══════════════════════════════════════════
// 模块级状态
// ═══════════════════════════════════════════

/** trackKey → 高度偏移量（米），≥ 0。不存在的 key 视为偏移 0。 */
const elevationOffsets = new Map<string, number>()

/** 持久化 key */
const SETTINGS_KEY = 'elevation.offsets'

// ═══════════════════════════════════════════
// 持久化辅助
// ═══════════════════════════════════════════

function _persist() {
  import('./useSettingsPersistence').then(({ scheduleSave }) => {
    const entries = Array.from(elevationOffsets.entries())
    if (entries.length === 0) {
      scheduleSave(SETTINGS_KEY, JSON.stringify(null))
    } else {
      scheduleSave(SETTINGS_KEY, JSON.stringify(entries))
    }
  })
}

// ═══════════════════════════════════════════
// 公开 API
// ═══════════════════════════════════════════

/** 获取某条航迹的有效渲染高度（米）= FLAT_ALTITUDE + offset */
export function getEffectiveAltitude(trackKey: string): number {
  const offset = elevationOffsets.get(trackKey)
  if (offset !== undefined && offset > 0) {
    return FLAT_ALTITUDE + offset
  }
  return FLAT_ALTITUDE
}

/** 设置抬升偏移量（绝对偏移，单位米，自动 clamp ≥ 0） */
export function setElevationOffset(trackKey: string, offsetMeters: number): void {
  const clamped = Math.max(0, offsetMeters)
  if (clamped === 0) {
    elevationOffsets.delete(trackKey)
  } else {
    elevationOffsets.set(trackKey, clamped)
  }
  _persist()
}

/** 在当前偏移基础上增减（delta 可正可负，结果 clamp ≥ 0）。返回新的偏移量（米） */
export function adjustElevation(trackKey: string, deltaMeters: number): number {
  const current = elevationOffsets.get(trackKey) ?? 0
  const newOffset = Math.max(0, current + deltaMeters)
  setElevationOffset(trackKey, newOffset)
  return newOffset
}

/** 恢复默认高度（删除偏移记录） */
export function resetElevation(trackKey: string): void {
  elevationOffsets.delete(trackKey)
  _persist()
}

/** 查询当前偏移量（米），用于 UI 显示 */
export function getElevationOffset(trackKey: string): number {
  return elevationOffsets.get(trackKey) ?? 0
}

/** 是否有偏移（用于判断右键菜单显示哪些选项） */
export function hasElevationOffset(trackKey: string): boolean {
  return getElevationOffset(trackKey) > 0
}

/** 从持久化数据中恢复抬升偏移量（由 useSettingsPersistence 在启动时调用） */
export function loadElevationOffsets(raw: Record<string, string>) {
  const rawVal = raw[SETTINGS_KEY]
  if (rawVal === undefined) return
  try {
    const parsed = JSON.parse(rawVal)
    if (parsed === null) {
      elevationOffsets.clear()
      return
    }
    if (!Array.isArray(parsed)) return
    elevationOffsets.clear()
    for (const entry of parsed) {
      if (Array.isArray(entry) && entry.length === 2 &&
          typeof entry[0] === 'string' && typeof entry[1] === 'number') {
        elevationOffsets.set(entry[0], entry[1])
      }
    }
  } catch { /* keep empty map on parse error */ }
}
