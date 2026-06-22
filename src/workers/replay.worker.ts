// ============================================================
// replay.worker.ts - 回放计算 Web Worker
// ============================================================

import type { SerializedTrack, TrackResult, WorkerMessage } from './types/worker-messages'

// ── Worker 状态 ──
let cachedTracks: SerializedTrack[] = []
let cachedKeys: string[] = []

// ── 二分查找（O(log n)） ──
function binarySearch(timestamps: Float64Array, time: number): number {
  const len = timestamps.length
  if (len === 0) return 0
  if (time <= timestamps[0]) return 0
  if (time >= timestamps[len - 1]) return len - 1

  let lo = 0, hi = len - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (timestamps[mid] <= time) lo = mid
    else hi = mid
  }
  return lo
}

// ── 线性插值 ──
function interpolate(
  lo: number,
  time: number,
  timestamps: Float64Array,
  lats: Float64Array,
  lngs: Float64Array,
  altitudes?: Float64Array
): { lat: number; lng: number; altitude?: number } {
  const dt = timestamps[lo + 1] - timestamps[lo]
  if (dt === 0) {
    return {
      lat: lats[lo],
      lng: lngs[lo],
      altitude: altitudes?.[lo]
    }
  }

  const t = (time - timestamps[lo]) / dt
  const clampedT = Math.min(Math.max(t, 0), 1)

  return {
    lat: lats[lo] + (lats[lo + 1] - lats[lo]) * clampedT,
    lng: lngs[lo] + (lngs[lo + 1] - lngs[lo]) * clampedT,
    altitude: altitudes
      ? altitudes[lo] + (altitudes[lo + 1] - altitudes[lo]) * clampedT
      : undefined
  }
}

// ── 批量计算所有航迹 ──
function computeAll(time: number): TrackResult[] {
  const results: TrackResult[] = []
  const totalTracks = cachedTracks.length

  for (let i = 0; i < totalTracks; i++) {
    const track = cachedTracks[i]
    const key = cachedKeys[i]
    const { timestamps, lats, lngs, altitudes } = track

    // 空航迹跳过
    if (timestamps.length === 0) continue

    // 二分查找
    const lo = binarySearch(timestamps, time)

    // 如果时间早于第一个点，航迹尚未开始
    if (time < timestamps[0]) {
      results.push({
        key,
        lo: 0,
        lat: lats[0],
        lng: lngs[0],
        altitude: altitudes?.[0],
        progress: 0
      })
      continue
    }

    // 如果时间晚于最后一个点，航迹已结束
    if (time >= timestamps[timestamps.length - 1]) {
      const lastIdx = timestamps.length - 1
      results.push({
        key,
        lo: lastIdx,
        lat: lats[lastIdx],
        lng: lngs[lastIdx],
        altitude: altitudes?.[lastIdx],
        progress: 1
      })
      continue
    }

    // 插值计算
    const pos = interpolate(lo, time, timestamps, lats, lngs, altitudes)

    results.push({
      key,
      lo,
      lat: pos.lat,
      lng: pos.lng,
      altitude: pos.altitude,
      progress: lo / timestamps.length
    })
  }

  return results
}

// ── 监听主线程消息 ──
self.addEventListener('message', (e: MessageEvent<WorkerMessage>) => {
  const data = e.data

  if (data.type === 'init') {
    // 初始化：缓存航迹数据
    cachedTracks = data.tracks
    cachedKeys = data.trackKeys
    console.log(`[Worker] 初始化完成，缓存 ${cachedTracks.length} 条航迹`)
    return
  }

  if (data.type === 'compute') {
    const startTime = performance.now()
    const results = computeAll(data.time)
    const elapsed = performance.now() - startTime

    // 只在耗时超过阈值时输出日志（避免刷屏）
    if (elapsed > 10) {
      console.log(`[Worker] 计算 ${results.length} 条航迹，耗时 ${elapsed.toFixed(1)}ms`)
    }

    // 发送结果回主线程
    self.postMessage({
      type: 'result',
      results,
      timestamp: data.time
    })
  }
})

// 导出空类型（使 TS 识别为模块）
export type {}