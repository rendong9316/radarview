import { ref, computed, watch, type Ref } from 'vue'
import type { Track, TrackPoint } from '../types/track'

export interface ReplayPosition {
  point: TrackPoint | null
  /** Index of the point at or just before currentTime */
  index: number
  /** 0-1 interpolation factor to next point */
  t: number
}

const SPEED_OPTIONS = [100, 300, 500, 2000] as const

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

export function useReplay(tracks: Ref<Track[]>) {
  const isPlaying = ref(false)
  const currentTime = ref(0)
  const speed = ref(500)
  const speedOptions = SPEED_OPTIONS

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

  function formatTime(ms: number): string {
    const d = new Date(ms)
    const Y = d.getUTCFullYear()
    const M = (d.getUTCMonth() + 1).toString().padStart(2, '0')
    const D = d.getUTCDate().toString().padStart(2, '0')
    const h = d.getUTCHours().toString().padStart(2, '0')
    const mi = d.getUTCMinutes().toString().padStart(2, '0')
    const s = d.getUTCSeconds().toString().padStart(2, '0')
    return `${Y} ${M} ${D} ${h}:${mi}:${s}`
  }

  const currentTimeFormatted = computed(() => formatTime(currentTime.value))
  const durationFormatted = computed(() => timeRange.value ? formatTime(timeRange.value.end) : '--')

  let animFrameId: number | null = null
  let lastWallTime = 0

  function tick() {
    if (!isPlaying.value) return

    const now = performance.now()
    const wallDelta = now - lastWallTime
    lastWallTime = now

    // Advance replay time: wall clock ms × speed
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

  function play() {
    if (!hasData.value) return
    if (timeRange.value && currentTime.value >= timeRange.value.end) {
      currentTime.value = timeRange.value.start
    }
    isPlaying.value = true
    lastWallTime = performance.now()
    animFrameId = requestAnimationFrame(tick)
  }

  function pause() {
    isPlaying.value = false
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
    speed.value = s
  }

  // Reset when tracks change
  watch(
    () => tracks.value,
    () => {
      pause()
      if (timeRange.value) {
        currentTime.value = timeRange.value.start
      }
    },
    { deep: false },
  )

  /** Get the interpolated position for every track at currentTime */
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

  return {
    isPlaying,
    currentTime,
    speed,
    speedOptions,
    timeRange,
    duration,
    progress,
    hasData,
    currentTimeFormatted,
    durationFormatted,
    play,
    pause,
    seek,
    setSpeed,
    getCurrentPositions,
  }
}
