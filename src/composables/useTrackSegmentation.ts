import type { TrackPoint } from '../types/track'
import { segMultiplier, segMinThresholdMin } from './useSegmentationSettings'

export interface TrackSegment {
  /** The contiguous sub-array of positions (reference into original array) */
  positions: TrackPoint[]
  /** Index of first position in the original track.positions array */
  startIdx: number
  /** Index of last position in the original track.positions array (inclusive) */
  endIdx: number
}

/**
 * Split a track's positions into contiguous segments at large temporal gaps.
 *
 * Uses a dynamic threshold: max(median × multiplier, minThresholdMinutes × 60s).
 * The median is computed from this track's own consecutive time deltas,
 * so different tracks with different reporting rates get different thresholds.
 *
 * Returns at least 1 segment. A single segment (no gaps exceeding threshold)
 * is the common case.
 */
export function segmentTrack(positions: TrackPoint[]): TrackSegment[] {
  const n = positions.length
  if (n <= 2) {
    return [{ positions, startIdx: 0, endIdx: n - 1 }]
  }

  // 1. Compute consecutive time gaps (in epoch ms)
  const gaps: number[] = new Array(n - 1)
  for (let i = 1; i < n; i++) {
    gaps[i - 1] = positions[i].timestamp - positions[i - 1].timestamp
  }

  // 2. Median of gaps
  const sorted = [...gaps].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]

  // 3. Dynamic threshold
  const floorMs = segMinThresholdMin.value * 60 * 1000
  const threshold = Math.max(median * segMultiplier.value, floorMs)

  // 4. Walk positions and split at gaps > threshold
  const segments: TrackSegment[] = []
  let segStart = 0

  for (let i = 1; i < n; i++) {
    const gap = positions[i].timestamp - positions[i - 1].timestamp
    if (gap > threshold) {
      segments.push({
        positions: positions.slice(segStart, i),
        startIdx: segStart,
        endIdx: i - 1,
      })
      segStart = i
    }
  }

  // Last segment
  segments.push({
    positions: positions.slice(segStart, n),
    startIdx: segStart,
    endIdx: n - 1,
  })

  // ── Diagnostic: log when a track is split ──
  if (segments.length > 1) {
    const minGap = Math.min(...gaps)
    const maxGap = Math.max(...gaps)
    const totalSec = (positions[n - 1].timestamp - positions[0].timestamp) / 1000
    console.log(
      `[segmentTrack] SPLIT track: ${n} pts, ${(totalSec / 60).toFixed(0)}min span, ` +
      `${segments.length} segments`,
      `\n  gaps: min=${(minGap / 1000).toFixed(1)}s, median=${(median / 1000).toFixed(1)}s, max=${(maxGap / 60 / 1000).toFixed(1)}min, threshold=${(threshold / 60 / 1000).toFixed(1)}min`,
      `\n  segments:`, segments.map((s, i) => {
        const d = (s.positions[s.positions.length - 1].timestamp - s.positions[0].timestamp) / 1000
        return `[${i}] ${s.positions.length} pts, ${d.toFixed(0)}s`
      }).join(', '),
      `\n  first pt ts: ${positions[0].timestamp}, last pt ts: ${positions[n-1].timestamp}`
    )
  }

  return segments
}
