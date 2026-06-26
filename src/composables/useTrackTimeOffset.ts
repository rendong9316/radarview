/**
 * src/composables/useTrackTimeOffset.ts — 文件级时间偏移状态管理
 *
 * 每个文件（"source::fileName"）可以设置一个时间偏移量（毫秒），
 * 直接修改 tracks 中所有 positions[i].timestamp、minTimestamp、maxTimestamp。
 * 模块级单例模式，跨组件共享。偏移量通过 useSettingsPersistence 持久化到 SQLite。
 *
 * 使用方式：
 *   import { setFileTimeStart, resetFileTimeOffset, getFileTimeDelta } from '../composables/useTrackTimeOffset'
 */

import { reactive } from 'vue'
import type { DataSource, Track } from '../types/track'

// ═══════════════════════════════════════════
// 模块级状态
// ═══════════════════════════════════════════

/** "source::fileName" → 时间偏移量（毫秒）。不存在的 key 视为偏移 0。 */
export const fileTimeDeltas = reactive<Record<string, number>>({})

const SETTINGS_KEY = 'time.file_offsets'

// ═══════════════════════════════════════════
// 持久化辅助
// ═══════════════════════════════════════════

function _persist() {
  import('./useSettingsPersistence').then(({ scheduleSave }) => {
    const obj: Record<string, number> = {}
    for (const k of Object.keys(fileTimeDeltas)) {
      if (fileTimeDeltas[k] !== 0) obj[k] = fileTimeDeltas[k]
    }
    scheduleSave(SETTINGS_KEY, JSON.stringify(Object.keys(obj).length === 0 ? null : obj))
  })
}

// ═══════════════════════════════════════════
// 内部辅助
// ═══════════════════════════════════════════

function fileKey(source: DataSource, fileName: string): string {
  return `${source}::${fileName}`
}

/** 对匹配 source::fileName 的所有 track 的时间戳加 diff 毫秒（就地修改） */
function applyDeltaDiff(source: DataSource, fileName: string, diff: number, tracks: Track[]): void {
  if (diff === 0) return
  for (const t of tracks) {
    if (t.source === source && t.fileName === fileName) {
      applyDeltaToSingleTrack(t, diff)
    }
  }
}

// ═══════════════════════════════════════════
// 公开 API
// ═══════════════════════════════════════════

/** 获取文件当前时间偏移量（毫秒），默认 0 */
export function getFileTimeDelta(source: DataSource, fileName: string): number {
  return fileTimeDeltas[fileKey(source, fileName)] ?? 0
}

/** 是否有偏移 */
export function hasFileTimeOffset(source: DataSource, fileName: string): boolean {
  return getFileTimeDelta(source, fileName) !== 0
}

/** 获取文件原始（无偏移）时间范围。从 tracks 当前有效值反算：original = effective - delta */
export function getFileOriginalTimeRange(
  source: DataSource, fileName: string, tracks: Track[],
): { min: number; max: number } | null {
  const delta = getFileTimeDelta(source, fileName)
  let min = Infinity
  let max = -Infinity
  let found = false
  for (const t of tracks) {
    if (t.source === source && t.fileName === fileName) {
      if (t.minTimestamp < min) min = t.minTimestamp
      if (t.maxTimestamp > max) max = t.maxTimestamp
      found = true
    }
  }
  if (!found) return null
  return { min: min - delta, max: max - delta }
}

/** 获取文件当前有效时间范围（已含偏移） */
export function getFileEffectiveTimeRange(
  source: DataSource, fileName: string, tracks: Track[],
): { min: number; max: number } | null {
  let min = Infinity
  let max = -Infinity
  let found = false
  for (const t of tracks) {
    if (t.source === source && t.fileName === fileName) {
      if (t.minTimestamp < min) min = t.minTimestamp
      if (t.maxTimestamp > max) max = t.maxTimestamp
      found = true
    }
  }
  return found ? { min, max } : null
}

/**
 * 对单个 track 的所有时间戳加 delta 毫秒（就地修改）。
 * 用于新导入路径和启动加载路径。
 */
export function applyDeltaToSingleTrack(track: Track, delta: number): void {
  if (delta === 0) return
  for (let i = 0; i < track.positions.length; i++) {
    track.positions[i].timestamp += delta
  }
  track.minTimestamp += delta
  track.maxTimestamp += delta
}

/**
 * 用户修改文件起始时间。
 * @param userStartMs 用户设置的新的起始 epoch 毫秒（北京时间）
 */
export function setFileTimeStart(
  source: DataSource, fileName: string, userStartMs: number, tracks: Track[],
): void {
  const orig = getFileOriginalTimeRange(source, fileName, tracks)
  if (!orig) return
  const newDelta = userStartMs - orig.min
  const oldDelta = getFileTimeDelta(source, fileName)
  const diff = newDelta - oldDelta
  const key = fileKey(source, fileName)

  applyDeltaDiff(source, fileName, diff, tracks)

  if (newDelta === 0) {
    delete fileTimeDeltas[key]
  } else {
    fileTimeDeltas[key] = newDelta
  }
  _persist()
}

/**
 * 用户修改文件终止时间。
 * @param userEndMs 用户设置的新的终止 epoch 毫秒（北京时间）
 */
export function setFileTimeEnd(
  source: DataSource, fileName: string, userEndMs: number, tracks: Track[],
): void {
  const orig = getFileOriginalTimeRange(source, fileName, tracks)
  if (!orig) return
  const newDelta = userEndMs - orig.max
  const oldDelta = getFileTimeDelta(source, fileName)
  const diff = newDelta - oldDelta
  const key = fileKey(source, fileName)

  applyDeltaDiff(source, fileName, diff, tracks)

  if (newDelta === 0) {
    delete fileTimeDeltas[key]
  } else {
    fileTimeDeltas[key] = newDelta
  }
  _persist()
}

/** 重置偏移为 0 */
export function resetFileTimeOffset(
  source: DataSource, fileName: string, tracks: Track[],
): void {
  const oldDelta = getFileTimeDelta(source, fileName)
  if (oldDelta === 0) return
  applyDeltaDiff(source, fileName, -oldDelta, tracks)
  delete fileTimeDeltas[fileKey(source, fileName)]
  _persist()
}

/** 对已加载的 tracks 批量应用所有持久化的时间偏移（启动时调用） */
export function applyPersistedOffsets(tracks: Track[]): void {
  for (const key of Object.keys(fileTimeDeltas)) {
    const delta = fileTimeDeltas[key]
    if (delta === 0) continue
    const sep = key.indexOf('::')
    if (sep === -1) continue
    const source = key.substring(0, sep) as DataSource
    const fileName = key.substring(sep + 2)
    applyDeltaDiff(source, fileName, delta, tracks)
  }
}

/** 持久化加载器（由 useSettingsPersistence 在启动时调用） */
export function loadTimeOffsets(raw: Record<string, string>): void {
  const rawVal = raw[SETTINGS_KEY]
  if (rawVal !== undefined) {
    try {
      const parsed = JSON.parse(rawVal)
      for (const k of Object.keys(fileTimeDeltas)) delete fileTimeDeltas[k]
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, val] of Object.entries(parsed)) {
          if (typeof val === 'number' && val !== 0) {
            fileTimeDeltas[key] = val
          }
        }
      }
    } catch { /* keep empty on parse error */ }
  }
}
