/**
 * src/composables/useTrackElevation.ts — 航迹抬升状态管理
 *
 * 维护每条航迹的渲染高度偏移量（米），在 FLAT_ALTITUDE 基础上叠加。
 * 模块级单例模式，跨组件共享。偏移量通过 useSettingsPersistence 持久化到 SQLite。
 *
 * 使用方式：
 *   import { getEffectiveAltitude, setElevationOffset, resetElevation } from '../composables/useTrackElevation'
 */

import { reactive } from 'vue'
import { FLAT_ALTITUDE } from '../cesium/types'
import type { DataSource, Track } from '../types/track'
import { trackKey } from './useTracks'

// ═══════════════════════════════════════════
// 模块级状态
// ═══════════════════════════════════════════

/** trackKey → 高度偏移量（米），≥ 0。不存在的 key 视为偏移 0。 */
const elevationOffsets = new Map<string, number>()

/** DataSource → 数据源级期望偏移量（米），用于 UI 显示和批量应用。reactive 以保证 Vue computed 能追踪变化。 */
const sourceElevationOffsets = reactive<Partial<Record<DataSource, number>>>({})

/** 持久化 key */
const SETTINGS_KEY = 'elevation.offsets'
const SOURCE_SETTINGS_KEY = 'elevation.source_offsets'

// ═══════════════════════════════════════════
// 持久化辅助
// ═══════════════════════════════════════════

function _persist() {
  import('./useSettingsPersistence').then(({ scheduleSave }) => {
    const entries = Array.from(elevationOffsets.entries())
    scheduleSave(SETTINGS_KEY, JSON.stringify(entries.length === 0 ? null : entries))
    scheduleSave(SOURCE_SETTINGS_KEY, JSON.stringify(
      Object.keys(sourceElevationOffsets).length === 0 ? null : sourceElevationOffsets,
    ))
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

/** 查询数据源级期望偏移量（km），用于 UI 展示 */
export function getSourceElevationKm(source: DataSource): number {
  const m = sourceElevationOffsets[source]
  return m !== undefined ? m / 1000 : 0
}

/** 批量设置某数据源所有航迹的偏移量（km）。传入 tracks 数组以定位当前航迹。 */
export function setSourceElevation(source: DataSource, offsetKm: number, tracks: Track[]): void {
  const offsetMeters = Math.max(0, offsetKm * 1000)
  if (offsetMeters === 0) {
    delete sourceElevationOffsets[source]
  } else {
    sourceElevationOffsets[source] = offsetMeters
  }
  for (const t of tracks) {
    if (t.source === source) {
      setElevationOffset_internal(trackKey(t.id, t.source), offsetMeters)
    }
  }
  _persist()
}

/** 重置某数据源所有航迹的偏移量为 0 */
export function resetSourceElevation(source: DataSource, tracks: Track[]): void {
  delete sourceElevationOffsets[source]
  for (const t of tracks) {
    if (t.source === source) {
      resetElevation_internal(trackKey(t.id, t.source))
    }
  }
  _persist()
}

/** 对新导入的航迹自动应用其数据源的偏移量 */
export function applySourceOffsetToTrack(track: Track): void {
  const offsetMeters = sourceElevationOffsets[track.source]
  if (offsetMeters !== undefined && offsetMeters > 0) {
    setElevationOffset_internal(trackKey(track.id, track.source), offsetMeters)
    _persist()
  }
}

// ═══════════════════════════════════════════
// 内部方法（不触发独立持久化，由调用方统一 _persist）
// ═══════════════════════════════════════════

function setElevationOffset_internal(trackKey: string, offsetMeters: number): void {
  const clamped = Math.max(0, offsetMeters)
  if (clamped === 0) {
    elevationOffsets.delete(trackKey)
  } else {
    elevationOffsets.set(trackKey, clamped)
  }
}

function resetElevation_internal(trackKey: string): void {
  elevationOffsets.delete(trackKey)
}

/** 从持久化数据中恢复抬升偏移量（由 useSettingsPersistence 在启动时调用） */
export function loadElevationOffsets(raw: Record<string, string>) {
  // 恢复逐航迹偏移
  const rawVal = raw[SETTINGS_KEY]
  if (rawVal !== undefined) {
    try {
      const parsed = JSON.parse(rawVal)
      if (parsed === null) {
        elevationOffsets.clear()
      } else if (Array.isArray(parsed)) {
        elevationOffsets.clear()
        for (const entry of parsed) {
          if (Array.isArray(entry) && entry.length === 2 &&
              typeof entry[0] === 'string' && typeof entry[1] === 'number') {
            elevationOffsets.set(entry[0], entry[1])
          }
        }
      }
    } catch { /* keep empty map on parse error */ }
  }
  // 恢复数据源级偏移
  const srcRaw = raw[SOURCE_SETTINGS_KEY]
  if (srcRaw !== undefined) {
    try {
      const parsed = JSON.parse(srcRaw)
      if (parsed === null) {
        for (const k of Object.keys(sourceElevationOffsets)) delete sourceElevationOffsets[k as DataSource]
      } else if (typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const k of Object.keys(sourceElevationOffsets)) delete sourceElevationOffsets[k as DataSource]
        for (const [key, val] of Object.entries(parsed)) {
          if (typeof val === 'number' && val > 0) {
            sourceElevationOffsets[key as DataSource] = val
          }
        }
      }
    } catch { /* keep empty map on parse error */ }
  }
}
