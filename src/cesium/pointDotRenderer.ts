/**
 * src/cesium/pointDotRenderer.ts — 航迹点迹 PointPrimitive 渲染
 *
 * 管理 Cesium PointPrimitiveCollection 中所有航迹点迹的创建、删除、同步、
 * 颜色/大小刷新以及悬停标签。
 *
 * 使用方式：在 onMounted 中调用 init(ctx)，之后所有函数即可正常使用。
 */

import * as Cesium from 'cesium'
import type { Track, DataSource } from '../types/track'
import { trackKey } from '../composables/useTracks'
import { getEffectiveAltitude } from '../composables/useTrackElevation'
import type { CesiumContext } from './types'

// ═══════════════════════════════════════════
// 模块级状态
// ═══════════════════════════════════════════

let ctx: CesiumContext | null = null

/** Rendered point dots grouped by trackKey → array of PointPrimitive objects */
const pointDotEntityMap = new Map<string, Cesium.PointPrimitive[]>()

/** Last visible point dot index during replay, per trackKey */
const pointDotLastLo = new Map<string, number>()

/** Point dot hover label Entity */
let pointDotHoverEntity: Cesium.Entity | undefined

/** Currently hovered point dot ID */
let hoveredPointDotId: string | null = null

/** Pre-allocated scratch objects — reused to avoid GC pressure */
let _scratchCartesian: Cesium.Cartesian3
let _pointDotOutline: Cesium.Color

// ═══════════════════════════════════════════
// 初始化
// ═══════════════════════════════════════════

export function init(context: CesiumContext) {
  ctx = context
  _scratchCartesian = new Cesium.Cartesian3()
  _pointDotOutline = Cesium.Color.BLACK.withAlpha(0.85)
}

export function reset() {
  pointDotEntityMap.clear()
  pointDotLastLo.clear()
  pointDotHoverEntity = undefined
  hoveredPointDotId = null
  ctx = null
}

// ═══════════════════════════════════════════
// 公开访问器
// ═══════════════════════════════════════════

export function getEntityMap(): ReadonlyMap<string, Cesium.PointPrimitive[]> {
  return pointDotEntityMap
}

export function getLastLo(): ReadonlyMap<string, number> {
  return pointDotLastLo
}

export function getHoveredId(): string | null {
  return hoveredPointDotId
}

export function getEntityMap_mutable(): Map<string, Cesium.PointPrimitive[]> {
  return pointDotEntityMap
}

// ═══════════════════════════════════════════
// 核心操作
// ═══════════════════════════════════════════

/** Check whether point dots are currently rendered for a given trackKey */
export function isTrackShowingDots(trackKey: string): boolean {
  return pointDotEntityMap.has(trackKey)
}

/** Create PointPrimitive objects for a single track's positions */
export function rebuildPointDotsForTrack(
  trackId: string,
  tracks: Track[],
  getColor: (source: DataSource) => string,
  dotPixelSize: number,
) {
  if (!ctx || !ctx.pointDotsCollection || !ctx.viewer) return

  // Remove existing dots for this track
  removePointDotsForTrack(trackId)

  const track = tracks.find(t => trackKey(t.id, t.source, t.fileName) === trackId)
  if (!track || track.positions.length === 0) return

  const color = Cesium.Color.fromCssColorString(getColor(track.source))
  const primitives: Cesium.PointPrimitive[] = []

  for (let i = 0; i < track.positions.length; i++) {
    const pos = track.positions[i]
    const lon = Number(pos.longitude)
    const lat = Number(pos.latitude)
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue

    Cesium.Cartesian3.fromDegrees(lon, lat, getEffectiveAltitude(trackId), undefined, _scratchCartesian)
    const prim = ctx.pointDotsCollection.add({
      id: `pointdot::${trackId}::${i}`,
      position: _scratchCartesian,
      pixelSize: dotPixelSize,
      color,
      outlineColor: _pointDotOutline,
      outlineWidth: 1,
    })
    primitives.push(prim)
  }

  if (primitives.length > 0) {
    pointDotEntityMap.set(trackId, primitives)
  }
  ctx.viewer.scene.requestRender()
}

/** Remove PointPrimitive objects for a single track */
export function removePointDotsForTrack(trackId: string) {
  if (!ctx?.pointDotsCollection) return
  const primitives = pointDotEntityMap.get(trackId)
  if (primitives) {
    for (const prim of primitives) {
      ctx.pointDotsCollection.remove(prim)
    }
    pointDotEntityMap.delete(trackId)
  }
}

/** Show point dots for a single track (right-click manual operation) */
export function showManualPointDots(
  trackId: string,
  tracks: Track[],
  getColor: (source: DataSource) => string,
  dotPixelSize: number,
  manualPointDotsTrackIds: { value: Set<string> },
  globalHiddenTrackKeys: { value: Set<string> },
) {
  const nextManual = new Set(manualPointDotsTrackIds.value)
  nextManual.add(trackId)
  manualPointDotsTrackIds.value = nextManual

  const nextHidden = new Set(globalHiddenTrackKeys.value)
  nextHidden.delete(trackId)
  globalHiddenTrackKeys.value = nextHidden

  rebuildPointDotsForTrack(trackId, tracks, getColor, dotPixelSize)
  ctx?.viewer?.scene.requestRender()
}

/** Hide point dots for a specific track (right-click manual operation) */
export function hidePointDotsForTrack(
  trackId: string,
  manualPointDotsTrackIds: { value: Set<string> },
  globalHiddenTrackKeys: { value: Set<string> },
  showAllPointDots: { value: boolean },
) {
  const nextManual = new Set(manualPointDotsTrackIds.value)
  nextManual.delete(trackId)
  manualPointDotsTrackIds.value = nextManual

  if (showAllPointDots.value) {
    const nextHidden = new Set(globalHiddenTrackKeys.value)
    nextHidden.add(trackId)
    globalHiddenTrackKeys.value = nextHidden
  }

  removePointDotsForTrack(trackId)
  ctx?.viewer?.scene.requestRender()
}

/** Sync global point dots: apply showAllPointDots + manual overrides + hidden list */
export function syncGlobalPointDots(
  tracks: Track[],
  getColor: (source: DataSource) => string,
  dotPixelSize: number,
  showAllPointDots: boolean,
  manualPointDotsTrackIds: Set<string>,
  globalHiddenTrackKeys: Set<string>,
) {
  if (!ctx?.viewer || !ctx.pointDotsCollection) return

  const activeTracks = new Map(tracks.map(t => [trackKey(t.id, t.source, t.fileName), t]))
  const currentKeys = new Set(pointDotEntityMap.keys())

  // Remove dots for tracks that no longer exist or should be hidden
  for (const tKey of currentKeys) {
    if (!activeTracks.has(tKey)) {
      removePointDotsForTrack(tKey)
      continue
    }
    const manual = manualPointDotsTrackIds.has(tKey)
    const global = showAllPointDots && !globalHiddenTrackKeys.has(tKey)
    if (!manual && !global) {
      removePointDotsForTrack(tKey)
    }
  }

  // Add dots for tracks that should be showing but aren't yet
  if (showAllPointDots) {
    for (const track of tracks) {
      const tKey = trackKey(track.id, track.source, track.fileName)
      if (globalHiddenTrackKeys.has(tKey)) continue
      if (pointDotEntityMap.has(tKey)) continue
      rebuildPointDotsForTrack(tKey, tracks, getColor, dotPixelSize)
    }
  }

  ctx.viewer.scene.requestRender()
}

/** Remove all rendered point dots */
export function clearAllPointDots(
  manualPointDotsTrackIds: { value: Set<string> },
  globalHiddenTrackKeys: { value: Set<string> },
) {
  if (ctx?.pointDotsCollection) {
    ctx.pointDotsCollection.removeAll()
  }
  pointDotEntityMap.clear()
  manualPointDotsTrackIds.value = new Set()
  globalHiddenTrackKeys.value = new Set()
  ctx?.viewer?.scene.requestRender()
}

/** Update color of all rendered point dots */
export function refreshPointDotColors(
  tracks: Track[],
  getColor: (source: DataSource) => string,
) {
  for (const [tKey, primitives] of pointDotEntityMap) {
    const track = tracks.find(t => trackKey(t.id, t.source, t.fileName) === tKey)
    if (!track) continue
    const color = Cesium.Color.fromCssColorString(getColor(track.source))
    for (const prim of primitives) {
      prim.color = color
    }
  }
  ctx?.viewer?.scene.requestRender()
}

/** Update pixel size of all rendered point dots */
export function refreshPointDotSizes(dotPixelSize: number) {
  for (const primitives of pointDotEntityMap.values()) {
    for (const prim of primitives) {
      prim.pixelSize = dotPixelSize
    }
  }
  ctx?.viewer?.scene.requestRender()
}

/** Refresh positions of all existing point dots to reflect current elevation offsets */
export function refreshPointDotPositions(tracks: Track[]) {
  for (const [trackId, primitives] of pointDotEntityMap) {
    const track = tracks.find(t => trackKey(t.id, t.source, t.fileName) === trackId)
    if (!track) continue
    const alt = getEffectiveAltitude(trackId)
    for (let i = 0; i < primitives.length && i < track.positions.length; i++) {
      const p = track.positions[i]
      primitives[i].position = Cesium.Cartesian3.fromDegrees(
        Number(p.longitude), Number(p.latitude), alt,
      )
    }
  }
  ctx?.viewer?.scene.requestRender()
}

// ═══════════════════════════════════════════
// 点迹悬停标签
// ═══════════════════════════════════════════

export function showPointDotHover(
  trackId: string,
  pointIndex: number,
  tracks: Track[],
  dotPixelSize: number,
) {
  if (!ctx?.viewer) return
  const track = tracks.find(t => trackKey(t.id, t.source, t.fileName) === trackId)
  if (!track || pointIndex >= track.positions.length) return

  const pt = track.positions[pointIndex]
  const alt = Number(pt.altitude)
  const gs = Number(pt.groundSpeed)
  const hdg = Number(pt.heading)

  // Line 1: 标识 + 高度 + 地速 + 航向
  const label = track.metadata.flightNumber || track.metadata.registration || track.id
  const line1 = `${label}  ·  ${alt.toFixed(0)}m  ·  ${gs.toFixed(0)}kt  ·  ${hdg.toFixed(0)}°`

  // Line 2: 北京时间
  const d = new Date(pt.timestamp + 8 * 3600 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const line2 = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`

  const text = `${line1}\n${line2}`
  const position = Cesium.Cartesian3.fromDegrees(pt.longitude, pt.latitude, getEffectiveAltitude(trackId))

  if (!pointDotHoverEntity) {
    pointDotHoverEntity = ctx.viewer.entities.add({
      id: 'pointdot-hover-label',
      position,
      label: {
        text,
        font: '14px -apple-system, "Microsoft YaHei", "PingFang SC", sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.9),
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK,
        backgroundPadding: new Cesium.Cartesian2(8, 6),
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        pixelOffset: new Cesium.Cartesian2(dotPixelSize + 10, 0),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
  } else {
    pointDotHoverEntity.show = true
    ;(pointDotHoverEntity.position as any) = position
    if (pointDotHoverEntity.label) {
      ;(pointDotHoverEntity.label.text as any) = new Cesium.ConstantProperty(text)
    }
  }
}

export function hidePointDotHover() {
  if (pointDotHoverEntity) pointDotHoverEntity.show = false
  hoveredPointDotId = null
}

export function removePointDotHover() {
  if (ctx?.viewer && pointDotHoverEntity) {
    ctx.viewer.entities.remove(pointDotHoverEntity)
  }
  pointDotHoverEntity = undefined
  hoveredPointDotId = null
}

export function setHoveredPointDotId(id: string | null) {
  hoveredPointDotId = id
}

// ═══════════════════════════════════════════
// 屏幕空间命中检测
// ═══════════════════════════════════════════

/** Screen-space proximity check: find the closest visible point dot to the mouse cursor */
export function checkPointDotHit(
  trackId: string,
  mousePos: Cesium.Cartesian2,
  dotPixelSize: number,
): { id: string; index: number } | null {
  if (!ctx?.viewer || !ctx.pointDotsCollection) return null
  const primitives = pointDotEntityMap.get(trackId)
  if (!primitives || primitives.length === 0) return null

  const threshold = Math.max(dotPixelSize + 30, 60) // px radius
  const thresholdSq = threshold * threshold
  let bestIdx = -1
  let bestDistSq = Infinity
  const _scratch = new Cesium.Cartesian2()

  for (let i = 0; i < primitives.length; i++) {
    const prim = primitives[i]
    if (!prim.show) continue
    const screenPos = Cesium.SceneTransforms.worldToWindowCoordinates(
      ctx.viewer.scene,
      (prim as any).position as Cesium.Cartesian3,
      _scratch,
    )
    if (!Cesium.defined(screenPos)) continue
    const dx = screenPos.x - mousePos.x
    const dy = screenPos.y - mousePos.y
    const distSq = dx * dx + dy * dy
    if (distSq < thresholdSq && distSq < bestDistSq) {
      bestDistSq = distSq
      bestIdx = i
    }
  }

  if (bestIdx < 0) return null
  return { id: `pointdot::${trackId}::${bestIdx}`, index: bestIdx }
}
