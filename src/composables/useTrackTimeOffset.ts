/**
 * src/composables/useTrackTimeOffset.ts — 数据源/文件级时间偏移状态管理
 *
 * 两层偏移模型：
 *   数据源级：同一数据源下所有文件共享的基础偏移
 *   文件级：  覆盖数据源级偏移（与 elevation 逻辑一致，不叠加）
 * 有效偏移 = fileTimeDeltas["source::fileName"] ?? sourceTimeDeltas[source] ?? 0
 *
 * 模块级单例模式，跨组件共享。偏移量通过 useSettingsPersistence 持久化到 SQLite。
 */

import { reactive } from 'vue'
import type { DataSource, Track } from '../types/track'

// ═══════════════════════════════════════════
// 模块级状态
// ═══════════════════════════════════════════

/** DataSource → 数据源级时间偏移量（毫秒）。不存在的 key 视为偏移 0。 */
const sourceTimeDeltas = reactive<Partial<Record<DataSource, number>>>({})

/** "source::fileName" → 文件级时间偏移量（毫秒）。覆盖数据源级偏移。不存在的 key 视为未设置。 */
export const fileTimeDeltas = reactive<Record<string, number>>({})

const SETTINGS_KEY = 'time.file_offsets'
const SOURCE_SETTINGS_KEY = 'time.source_offsets'

// ═══════════════════════════════════════════
// 持久化辅助
// ═══════════════════════════════════════════

function _persist() {
  import('./useSettingsPersistence').then(({ scheduleSave }) => {
    // 数据源级
    scheduleSave(SOURCE_SETTINGS_KEY, JSON.stringify(
      Object.keys(sourceTimeDeltas).length === 0 ? null : sourceTimeDeltas,
    ))
    // 文件级（仅保存非零值）
    const fileObj: Record<string, number> = {}
    for (const k of Object.keys(fileTimeDeltas)) {
      if (fileTimeDeltas[k] !== 0) fileObj[k] = fileTimeDeltas[k]
    }
    scheduleSave(SETTINGS_KEY, JSON.stringify(Object.keys(fileObj).length === 0 ? null : fileObj))
  })
}

// ═══════════════════════════════════════════
// 内部辅助
// ═══════════════════════════════════════════

function fileKey(source: DataSource, fileName: string): string {
  return `${source}::${fileName}`
}

/** 获取某个文件当前生效的时间偏移量（文件级覆盖数据源级，绝不叠加） */
function getEffectiveDelta(source: DataSource, fileName: string): number {
  const fk = fileKey(source, fileName)
  if (fk in fileTimeDeltas) return fileTimeDeltas[fk]
  return sourceTimeDeltas[source] ?? 0
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

/** 遍历数据源下所有文件名 */
function* eachFileUnderSource(source: DataSource, tracks: Track[]): Generator<string> {
  const seen = new Set<string>()
  for (const t of tracks) {
    if (t.source !== source) continue
    const fn = t.fileName || ''
    if (!seen.has(fn)) {
      seen.add(fn)
      yield fn
    }
  }
}

// ═══════════════════════════════════════════
// 公开 API — 数据源级
// ═══════════════════════════════════════════

export function getSourceTimeDelta(source: DataSource): number {
  return sourceTimeDeltas[source] ?? 0
}

export function hasSourceTimeOffset(source: DataSource): boolean {
  return getSourceTimeDelta(source) !== 0
}

/** 获取数据源下所有文件的原始（无偏移）全局时间范围 */
export function getSourceOriginalTimeRange(
  source: DataSource, tracks: Track[],
): { min: number; max: number } | null {
  let gMin = Infinity
  let gMax = -Infinity
  let found = false
  for (const fn of eachFileUnderSource(source, tracks)) {
    const delta = getEffectiveDelta(source, fn)
    for (const t of tracks) {
      if (t.source === source && t.fileName === fn) {
        if (t.minTimestamp - delta < gMin) gMin = t.minTimestamp - delta
        if (t.maxTimestamp - delta > gMax) gMax = t.maxTimestamp - delta
        found = true
      }
    }
  }
  return found ? { min: gMin, max: gMax } : null
}

/** 获取数据源下所有文件的当前有效时间范围 */
export function getSourceEffectiveTimeRange(
  source: DataSource, tracks: Track[],
): { min: number; max: number } | null {
  let gMin = Infinity
  let gMax = -Infinity
  let found = false
  for (const t of tracks) {
    if (t.source !== source) continue
    if (t.minTimestamp < gMin) gMin = t.minTimestamp
    if (t.maxTimestamp > gMax) gMax = t.maxTimestamp
    found = true
  }
  return found ? { min: gMin, max: gMax } : null
}

export function setSourceTimeStart(
  source: DataSource, userStartMs: number, tracks: Track[],
): void {
  const orig = getSourceOriginalTimeRange(source, tracks)
  if (!orig) return
  const newDelta = userStartMs - orig.min
  const oldDelta = sourceTimeDeltas[source] ?? 0
  const diff = newDelta - oldDelta

  // 仅对没有文件级覆盖的子文件应用偏移
  for (const fn of eachFileUnderSource(source, tracks)) {
    const fk = fileKey(source, fn)
    if (fk in fileTimeDeltas) continue // 文件有自己的偏移，不受数据源级影响
    applyDeltaDiff(source, fn, diff, tracks)
  }

  if (newDelta === 0) {
    delete sourceTimeDeltas[source]
  } else {
    sourceTimeDeltas[source] = newDelta
  }
  _persist()
}

export function setSourceTimeEnd(
  source: DataSource, userEndMs: number, tracks: Track[],
): void {
  const orig = getSourceOriginalTimeRange(source, tracks)
  if (!orig) return
  const newDelta = userEndMs - orig.max
  const oldDelta = sourceTimeDeltas[source] ?? 0
  const diff = newDelta - oldDelta

  for (const fn of eachFileUnderSource(source, tracks)) {
    const fk = fileKey(source, fn)
    if (fk in fileTimeDeltas) continue
    applyDeltaDiff(source, fn, diff, tracks)
  }

  if (newDelta === 0) {
    delete sourceTimeDeltas[source]
  } else {
    sourceTimeDeltas[source] = newDelta
  }
  _persist()
}

export function resetSourceTimeOffset(source: DataSource, tracks: Track[]): void {
  const oldDelta = sourceTimeDeltas[source] ?? 0
  if (oldDelta === 0) return

  for (const fn of eachFileUnderSource(source, tracks)) {
    const fk = fileKey(source, fn)
    if (fk in fileTimeDeltas) continue
    applyDeltaDiff(source, fn, -oldDelta, tracks)
  }

  delete sourceTimeDeltas[source]
  _persist()
}

// ═══════════════════════════════════════════
// 公开 API — 文件级
// ═══════════════════════════════════════════

export function getFileTimeDelta(source: DataSource, fileName: string): number {
  return getEffectiveDelta(source, fileName)
}

export function hasFileTimeOffset(source: DataSource, fileName: string): boolean {
  return getFileTimeDelta(source, fileName) !== 0
}

/** 获取文件原始（无偏移）时间范围 */
export function getFileOriginalTimeRange(
  source: DataSource, fileName: string, tracks: Track[],
): { min: number; max: number } | null {
  const delta = getEffectiveDelta(source, fileName)
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

export function applyDeltaToSingleTrack(track: Track, delta: number): void {
  if (delta === 0) return
  for (let i = 0; i < track.positions.length; i++) {
    track.positions[i].timestamp += delta
  }
  track.minTimestamp += delta
  track.maxTimestamp += delta
}

export function setFileTimeStart(
  source: DataSource, fileName: string, userStartMs: number, tracks: Track[],
): void {
  const orig = getFileOriginalTimeRange(source, fileName, tracks)
  if (!orig) return
  const newFileDelta = userStartMs - orig.min
  const oldEffectiveDelta = getEffectiveDelta(source, fileName)
  const diff = newFileDelta - oldEffectiveDelta
  const key = fileKey(source, fileName)

  applyDeltaDiff(source, fileName, diff, tracks)

  if (newFileDelta === 0) {
    delete fileTimeDeltas[key]
  } else {
    fileTimeDeltas[key] = newFileDelta
  }
  _persist()
}

export function setFileTimeEnd(
  source: DataSource, fileName: string, userEndMs: number, tracks: Track[],
): void {
  const orig = getFileOriginalTimeRange(source, fileName, tracks)
  if (!orig) return
  const newFileDelta = userEndMs - orig.max
  const oldEffectiveDelta = getEffectiveDelta(source, fileName)
  const diff = newFileDelta - oldEffectiveDelta
  const key = fileKey(source, fileName)

  applyDeltaDiff(source, fileName, diff, tracks)

  if (newFileDelta === 0) {
    delete fileTimeDeltas[key]
  } else {
    fileTimeDeltas[key] = newFileDelta
  }
  _persist()
}

export function resetFileTimeOffset(
  source: DataSource, fileName: string, tracks: Track[],
): void {
  const oldEffectiveDelta = getEffectiveDelta(source, fileName)
  if (oldEffectiveDelta === 0) return
  // 回退到数据源级偏移（可能是 0）
  const fallbackDelta = sourceTimeDeltas[source] ?? 0
  const diff = fallbackDelta - oldEffectiveDelta
  applyDeltaDiff(source, fileName, diff, tracks)
  delete fileTimeDeltas[fileKey(source, fileName)]
  _persist()
}

// ═══════════════════════════════════════════
// 启动 / 持久化
// ═══════════════════════════════════════════

/** 对已加载的 tracks 批量应用所有持久化的时间偏移（启动时调用） */
export function applyPersistedOffsets(tracks: Track[]): void {
  // 先应用数据源级偏移
  for (const src of Object.keys(sourceTimeDeltas) as DataSource[]) {
    const sDelta = sourceTimeDeltas[src] ?? 0
    if (sDelta === 0) continue
    for (const fn of eachFileUnderSource(src, tracks)) {
      const fk = fileKey(src, fn)
      if (fk in fileTimeDeltas) continue
      applyDeltaDiff(src, fn, sDelta, tracks)
    }
  }
  // 再应用文件级偏移
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

export function loadTimeOffsets(raw: Record<string, string>): void {
  // 恢复数据源级偏移
  const srcRaw = raw[SOURCE_SETTINGS_KEY]
  if (srcRaw !== undefined) {
    try {
      const parsed = JSON.parse(srcRaw)
      for (const k of Object.keys(sourceTimeDeltas)) delete sourceTimeDeltas[k as DataSource]
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, val] of Object.entries(parsed)) {
          if (typeof val === 'number' && val !== 0) {
            sourceTimeDeltas[key as DataSource] = val
          }
        }
      }
    } catch { /* keep empty */ }
  }
  // 恢复文件级偏移
  const fileRaw = raw[SETTINGS_KEY]
  if (fileRaw !== undefined) {
    try {
      const parsed = JSON.parse(fileRaw)
      for (const k of Object.keys(fileTimeDeltas)) delete fileTimeDeltas[k]
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, val] of Object.entries(parsed)) {
          if (typeof val === 'number' && val !== 0) {
            fileTimeDeltas[key] = val
          }
        }
      }
    } catch { /* keep empty */ }
  }
}
