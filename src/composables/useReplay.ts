// ============================================================
// useReplay.ts - 集成 Web Worker 版本
// ============================================================

import { ref, computed, watch, type Ref, onUnmounted } from 'vue'
import type { Track, TrackPoint } from '../types/track'

export interface ReplayPosition {
  point: TrackPoint | null
  /** Index of the point at or just before currentTime */
  index: number
  /** 0-1 interpolation factor to next point */
  t: number
}

const SPEED_OPTIONS = [100, 300, 500, 2000] as const

// ============================================================
// 保留原有的同步计算函数（作为降级方案）
// ============================================================

function binarySearch(points: TrackPoint[], targetTime: number): ReplayPosition {
  if (points.length === 0) return { point: null, index: -1, t: 0 }
  if (targetTime <= points[0].timestamp) return { point: points[0], index: 0, t: 0 }
  if (targetTime >= points[points.length - 1].timestamp) {
    return { point: points[points.length - 1], index: points.length - 1, t: 0 }
  }

  let lo = 0
  let hi = points.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (points[mid].timestamp <= targetTime) lo = mid
    else hi = mid
  }

  const dt = points[hi].timestamp - points[lo].timestamp
  const t = dt > 0 ? (targetTime - points[lo].timestamp) / dt : 0

  return { point: points[lo], index: lo, t }
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function interpolatePosition(pos: ReplayPosition, points: TrackPoint[]): TrackPoint | null {
  if (!pos.point || pos.index < 0) return null
  if (pos.t <= 0 || pos.index >= points.length - 1) return { ...pos.point }

  const next = points[pos.index + 1]
  return {
    timestamp: pos.point.timestamp,
    latitude: lerp(pos.point.latitude, next.latitude, pos.t),
    longitude: lerp(pos.point.longitude, next.longitude, pos.t),
    altitude: lerp(pos.point.altitude, next.altitude, pos.t),
    heading: lerp(pos.point.heading, next.heading, pos.t),
    groundSpeed: lerp(pos.point.groundSpeed, next.groundSpeed, pos.t),
    verticalRate: lerp(pos.point.verticalRate, next.verticalRate, pos.t),
  }
}

// ============================================================
// Worker 相关类型
// ============================================================

interface WorkerResult {
  key: string
  lo: number
  lat: number
  lng: number
  altitude: number
  progress: number
}

// ============================================================
// useReplay 主函数（支持 Worker 模式）
// ============================================================

export function useReplay(tracks: Ref<Track[]>, initialSpeed?: number) {
  // ── 响应式状态 ──
  const isPlaying = ref(false)
  const isReplayActive = ref(false)
  const currentTime = ref(0)
  const speed = ref(initialSpeed ?? 500)
  const speedOptions = SPEED_OPTIONS

  // ── Worker 相关 ──
  let worker: Worker | null = null
  let isWorkerReady = false
  let pendingResults: WorkerResult[] | null = null
  let resultCallbacks: ((results: WorkerResult[]) => void)[] = []
  let workerInitPromise: Promise<void> | null = null
  let lastComputedTime = -1

  // ── 时间范围计算 ──
  const timeRange = computed(() => {
    let start = Infinity
    let end = -Infinity
    for (const t of tracks.value) {
      if (t.positions.length === 0) continue
      const first = t.positions[0].timestamp
      const last = t.positions[t.positions.length - 1].timestamp
      if (first < start) start = first
      if (last > end) end = last
    }
    return start < end ? { start, end } : null
  })

  const duration = computed(() => {
    if (!timeRange.value) return 0
    return timeRange.value.end - timeRange.value.start
  })

  const progress = computed(() => {
    if (!timeRange.value || duration.value <= 0) return 0
    return (currentTime.value - timeRange.value.start) / duration.value
  })

  const hasData = computed(() => duration.value > 0)

  // ── 时间格式化 ──
  function formatTime(ms: number): string {
    const d = new Date(ms)
    const Y = d.getFullYear()
    const M = (d.getMonth() + 1).toString().padStart(2, '0')
    const D = d.getDate().toString().padStart(2, '0')
    const h = d.getHours().toString().padStart(2, '0')
    const mi = d.getMinutes().toString().padStart(2, '0')
    const s = d.getSeconds().toString().padStart(2, '0')
    return `${Y} ${M} ${D} ${h}:${mi}:${s}`
  }

  const currentTimeFormatted = computed(() => formatTime(currentTime.value))
  const durationFormatted = computed(() => timeRange.value ? formatTime(timeRange.value.end) : '--')

  // ── 动画循环 ──
  let animFrameId: number | null = null
  let lastWallTime = 0

  function tick() {
    if (!isPlaying.value) return

    const now = performance.now()
    const wallDelta = now - lastWallTime
    lastWallTime = now

    const dataDelta = wallDelta * speed.value
    let next = currentTime.value + dataDelta

    if (timeRange.value) {
      if (next >= timeRange.value.end) {
        next = timeRange.value.end
        pause()
      }
    }

    currentTime.value = next
    animFrameId = requestAnimationFrame(tick)
  }

  // ── Worker 初始化 ──
  function initWorker(): Promise<void> {
    if (worker && isWorkerReady) return Promise.resolve()
    if (workerInitPromise) return workerInitPromise

    workerInitPromise = new Promise((resolve, reject) => {
      try {
        // 使用 Vite 的 Worker 导入
        worker = new Worker(
          new URL('../workers/replay.worker.ts', import.meta.url),
          { type: 'module' }
        )

        // 监听 Worker 消息
        worker.onmessage = (e) => {
          const data = e.data
          if (data.type === 'result') {
            // 只处理最新的结果（丢弃旧结果）
            if (data.timestamp >= lastComputedTime) {
              pendingResults = data.results
              // 通知所有订阅者
              for (const cb of resultCallbacks) {
                if (pendingResults) cb(pendingResults)
              }
            }
          }
        }

        worker.onerror = (e) => {
          console.error('[Worker] 错误:', e)
          // Worker 出错时降级到同步模式
          isWorkerReady = false
          reject(e)
        }

        // 发送初始化数据
        const serializedTracks = tracks.value.map(track => ({
          timestamps: new Float64Array(track.positions.map(p => p.timestamp)),
          lats: new Float64Array(track.positions.map(p => p.latitude)),
          lngs: new Float64Array(track.positions.map(p => p.longitude)),
          altitudes: new Float64Array(track.positions.map(p => p.altitude || 0))
        }))

        worker.postMessage({
          type: 'init',
          tracks: serializedTracks,
          trackKeys: tracks.value.map(t => `${t.id}::${t.source}`),
          flatAltitude: 10000
        })

        isWorkerReady = true
        resolve()
      } catch (err) {
        console.warn('[Worker] 初始化失败，降级到同步模式:', err)
        isWorkerReady = false
        reject(err)
      }
    })

    return workerInitPromise
  }

  // ── 使用 Worker 异步计算 ──
  function computeWithWorker(time: number): Promise<WorkerResult[] | null> {
    if (!worker || !isWorkerReady) {
      // Worker 不可用，降级到同步计算
      return Promise.resolve(computeSync(time))
    }

    return new Promise((resolve) => {
      lastComputedTime = time

      // 注册一次性回调
      const handler = (results: WorkerResult[]) => {
        const idx = resultCallbacks.indexOf(handler)
        if (idx > -1) resultCallbacks.splice(idx, 1)
        resolve(results)
      }
      resultCallbacks.push(handler)

      // 发送计算请求
      worker?.postMessage({
        type: 'compute',
        time
      })

      // 超时保护（3秒后降级）
      setTimeout(() => {
        const idx = resultCallbacks.indexOf(handler)
        if (idx > -1) {
          resultCallbacks.splice(idx, 1)
          console.warn('[Worker] 计算超时，降级到同步模式')
          resolve(computeSync(time))
        }
      }, 3000)
    })
  }

  // ── 同步计算（降级方案） ──
  function computeSync(time: number): WorkerResult[] | null {
    const results: WorkerResult[] = []
    for (const track of tracks.value) {
      if (track.positions.length === 0) continue
      const pos = binarySearch(track.positions, time)
      const point = interpolatePosition(pos, track.positions)
      if (point) {
        results.push({
          key: `${track.id}::${track.source}`,
          lo: pos.index,
          lat: point.latitude,
          lng: point.longitude,
          altitude: point.altitude,
          progress: pos.index / track.positions.length
        })
      }
    }
    return results
  }

  // ── 获取当前位置（兼容旧 API） ──
  function getCurrentPositions(): Map<string, { point: TrackPoint; track: Track }> {
    const result = new Map<string, { point: TrackPoint; track: Track }>()
    const ct = currentTime.value

    for (const track of tracks.value) {
      if (track.positions.length === 0) continue
      const pos = binarySearch(track.positions, ct)
      const point = interpolatePosition(pos, track.positions)
      if (point) {
        result.set(track.id, { point, track })
      }
    }
    return result
  }

  // ── 异步获取位置（使用 Worker） ──
  async function getCurrentPositionsAsync(): Promise<Map<string, { point: TrackPoint; track: Track }>> {
    const result = new Map<string, { point: TrackPoint; track: Track }>()
    const ct = currentTime.value

    // 尝试使用 Worker
    let workerResults: WorkerResult[] | null = null
    try {
      await initWorker()
      workerResults = await computeWithWorker(ct)
    } catch {
      // 降级到同步
      workerResults = computeSync(ct)
    }

    if (!workerResults) return result

    // 将 Worker 结果转换为 TrackPoint
    const trackMap = new Map<string, Track>()
    for (const track of tracks.value) {
      trackMap.set(`${track.id}::${track.source}`, track)
    }

    for (const wr of workerResults) {
      const track = trackMap.get(wr.key)
      if (!track) continue

      const point: TrackPoint = {
        timestamp: ct,
        latitude: wr.lat,
        longitude: wr.lng,
        altitude: wr.altitude,
        heading: 0,
        groundSpeed: 0,
        verticalRate: 0
      }
      result.set(track.id, { point, track })
    }

    return result
  }

  // ── 播放控制 ──
  function play() {
    if (!hasData.value) return
    if (timeRange.value && currentTime.value >= timeRange.value.end) {
      currentTime.value = timeRange.value.start
    }
    isReplayActive.value = true
    isPlaying.value = true
    lastWallTime = performance.now()
    animFrameId = requestAnimationFrame(tick)
  }

  function pause() {
    isPlaying.value = false
    isReplayActive.value = false
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId)
      animFrameId = null
    }
  }

  function seek(progressValue: number) {
    pause()
    if (!timeRange.value) return
    const clamped = Math.max(0, Math.min(1, progressValue))
    currentTime.value = timeRange.value.start + clamped * duration.value
  }

  function setSpeed(s: number) {
    if (!isFinite(s) || s <= 0) return
    speed.value = s
  }

  // ── 销毁 Worker ──
  function destroyWorker() {
    if (worker) {
      worker.terminate()
      worker = null
    }
    isWorkerReady = false
    workerInitPromise = null
    pendingResults = null
    resultCallbacks = []
  }

  // ── 监听 tracks 变化 ──
  watch(
    () => tracks.value,
    () => {
      pause()
      isReplayActive.value = false
      if (timeRange.value) {
        currentTime.value = timeRange.value.start
      }
      // 重置 Worker（航迹数据变了）
      destroyWorker()
      isWorkerReady = false
      workerInitPromise = null
    },
    { deep: false }
  )

  // ── 持久化速度 ──
  watch(speed, (v) => {
    import('./useSettingsPersistence').then(({ scheduleSave }) => {
      scheduleSave('replay.speed', JSON.stringify(v))
    })
  }, { immediate: false })

  // ── 组件卸载时清理 ──
  onUnmounted(() => {
    pause()
    destroyWorker()
  })

  return {
    // 响应式状态
    isPlaying,
    isReplayActive,
    currentTime,
    speed,
    speedOptions,
    timeRange,
    duration,
    progress,
    hasData,
    currentTimeFormatted,
    durationFormatted,

    // 控制方法
    play,
    pause,
    seek,
    setSpeed,

    // 位置计算（同步，兼容旧 API）
    getCurrentPositions,

    // 位置计算（异步，使用 Worker）
    getCurrentPositionsAsync,

    // Worker 状态
    isWorkerReady: computed(() => isWorkerReady),
    initWorker,
    destroyWorker,
  }
}