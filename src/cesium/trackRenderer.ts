/**
 * src/cesium/trackRenderer.ts — 航迹实体管理 + 回放渲染
 *
 * 负责：
 * 1. entityMap 生命周期（创建/更新/删除 Cesium Entity + Label + PointPrimitive）
 * 2. 回放逐帧位置更新（二分查找 + 线性插值 + 渐进轨迹线）
 * 3. 悬停高亮（hover overlay polyline）
 * 4. LabelCollection / PointPrimitiveCollection 周期性重建
 *
 * 使用方式：在 onMounted 中调用 init(ctx)，之后即可使用所有函数。
 */

import * as Cesium from 'cesium'
import type { Track, TrackPoint, DataSource } from '../types/track'
import { trackKey } from '../composables/useTracks'
import { getEffectiveAltitude } from '../composables/useTrackElevation'
import {
  FLAT_ALTITUDE,
  SELECTED_WIDTH,
  SELECTED_ALPHA,
  NORMAL_ALPHA,
  RAW_ALPHA,
  DOT_BASE,
  DOT_RAW,
  DOT_SELECTED,
  DOT_HOVER,
  POINT_PRIMITIVE_BASE,
  HOVER_WIDTH,
  LABEL_FONT_BASE,
  LABEL_FONT_LARGE,
  type CesiumContext,
  type TrackEntities,
} from './types'

// ═══════════════════════════════════════════
// 模块级状态
// ═══════════════════════════════════════════

let ctx: CesiumContext | null = null

/** trackKey → TrackEntities */
const entityMap = new Map<string, TrackEntities>()

/** 周期 LabelCollection 重建计数器 */
let labelRebuildCounter = 0
/** LabelCollection 重建阈值（帧数），增大以减少重建频率 */
const LABEL_REBUILD_INTERVAL = 500

/** 回放状态追踪 */
let wasReplaying = false

/** 悬停状态 */
let hoveredTrackId: string | null = null

/** hover 期间保存的原始线外观，用于 unhover 时恢复 */
interface HoverLineSave {
  entityMaterial: Cesium.MaterialProperty
  entityWidth: Cesium.Property | undefined
  trailColor: Cesium.Color | null
  trailWidth: number | null
}
let _hoverLineSave: HoverLineSave | null = null

/** 预解析的 HOVER_COLOR */
let HOVER_COLOR: Cesium.Color

// ═══════════════════════════════════════════
// 2D 视口裁剪
// ═══════════════════════════════════════════

/** 经纬度包围盒 */
interface TrackExtent {
  minLng: number
  maxLng: number
  minLat: number
  maxLat: number
}

/** trackKey → 包围盒（createTrackEntities / syncEntities 时维护） */
const trackExtents = new Map<string, TrackExtent>()

/** 当前视口可见范围（2D 模式有值，3D 模式 null = 不做裁剪） */
let currentViewportExtent: TrackExtent | null = null

// ═══════════════════════════════════════════
// 初始化
// ═══════════════════════════════════════════

export function init(context: CesiumContext) {
  ctx = context
  HOVER_COLOR = Cesium.Color.fromCssColorString('#ff3333')
}

export function reset() {
  clearAllEntities()
  entityMap.clear()
  trackExtents.clear()
  currentViewportExtent = null
  labelRebuildCounter = 0
  wasReplaying = false
  hoveredTrackId = null
  ctx = null
}

// ═══════════════════════════════════════════
// 公开访问器
// ═══════════════════════════════════════════

export function getEntityMap(): ReadonlyMap<string, TrackEntities> {
  return entityMap
}

export function getEntityMap_mutable(): Map<string, TrackEntities> {
  return entityMap
}

export function getHoveredTrackId(): string | null {
  return hoveredTrackId
}

export function setHoveredTrackId(id: string | null) {
  hoveredTrackId = id
}

export function getWasReplaying(): boolean {
  return wasReplaying
}

export function setWasReplaying(v: boolean) {
  wasReplaying = v
}

// ═══════════════════════════════════════════
// 纯工具函数
// ═══════════════════════════════════════════

export function isFinitePoint(p: TrackPoint): boolean {
  return Number.isFinite(p.longitude) &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.altitude) &&
    p.longitude >= -180 && p.longitude <= 180 &&
    p.latitude >= -90 && p.latitude <= 90
}

export function toCartesianArray(positions: TrackPoint[], trackKey?: string): Cesium.Cartesian3[] {
  const alt = trackKey ? getEffectiveAltitude(trackKey) : FLAT_ALTITUDE
  const flat: number[] = []
  let lastLng = 0, lastLat = 0
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]
    if (isFinitePoint(p)) {
      flat.push(p.longitude, p.latitude, alt)
      lastLng = p.longitude; lastLat = p.latitude
    } else {
      flat.push(lastLng, lastLat, alt)
    }
  }
  return Cesium.Cartesian3.fromDegreesArrayHeights(flat)
}

export function pointPrimSize(dotBase: number, source: string, dotScale: Record<string, number>, fileName?: string): number {
  const fk = fileName ? `${source}::${fileName}` : ''
  const scale = (fk && dotScale[fk] != null) ? dotScale[fk] : (dotScale[source] ?? 1.0)
  return POINT_PRIMITIVE_BASE * (dotBase / DOT_BASE) * scale
}

export function baseWidth(source: DataSource, lineWidths: Record<string, number>, fileName?: string): number {
  const fk = fileName ? `${source}::${fileName}` : ''
  return (fk && lineWidths[fk] != null) ? lineWidths[fk] : (lineWidths[source] ?? 2.0)
}

export function extractTrackKeyFromPolylineId(polylineId: string): string | null {
  if (entityMap.has(polylineId)) return polylineId
  if (polylineId.endsWith('::dot')) return polylineId.slice(0, polylineId.lastIndexOf('::'))
  if (polylineId.startsWith('trail::')) return polylineId.slice('trail::'.length)
  if (polylineId.startsWith('pointdot::')) {
    const parts = polylineId.split('::')
    // pointdot::trackKey::index — trackKey may be 2-part or 3-part
    return parts.length >= 4 ? parts.slice(1, -1).join('::') : null
  }
  return null
}

/** 计算一条航迹的经纬度包围盒（O(n)，仅在创建/更新时调用一次） */
export function computeTrackExtent(positions: TrackPoint[]): TrackExtent {
  let minLng = Infinity, maxLng = -Infinity
  let minLat = Infinity, maxLat = -Infinity
  for (const p of positions) {
    if (!isFinitePoint(p)) continue
    if (p.longitude < minLng) minLng = p.longitude
    if (p.longitude > maxLng) maxLng = p.longitude
    if (p.latitude < minLat) minLat = p.latitude
    if (p.latitude > maxLat) maxLat = p.latitude
  }
  return { minLng, maxLng, minLat, maxLat }
}

function isReplayTrackActive(entry: TrackEntities, replayTime: number | null): boolean {
  return replayTime === null || (replayTime >= entry.firstTimestamp && entry.replayPositionValid)
}

function setTrackPointLikeVisibility(entry: TrackEntities, visible: boolean) {
  if (entry.label) entry.label.show = visible
  if (entry.pointPrimitive) entry.pointPrimitive.show = visible
}

function hideReplayTrackBeforeStart(
  entry: TrackEntities,
  pointDots?: Cesium.PointPrimitive[],
  pointDotLastLo?: Map<string, number>,
  tKey?: string,
) {
  if (entry.entity) entry.entity.show = false
  if (entry.trailLine) {
    removeTrailLine(entry.trailLine)
    entry.trailLine = undefined
  }
  setTrackPointLikeVisibility(entry, false)
  entry.lastTrailLo = -1
  entry._trailCache = []
  entry.replayPositionValid = false
  if (pointDots) {
    for (const dot of pointDots) dot.show = false
  }
  if (pointDotLastLo && tKey) pointDotLastLo.set(tKey, -1)
}

/** 判断两个包围盒是否相交（正确处理反子午线跨越） */
function extentsOverlap(a: TrackExtent, b: TrackExtent): boolean {
  // 纬度：直接判断区间重叠
  if (a.maxLat < b.minLat || b.maxLat < a.minLat) return false
  // 经度：需处理 -180°/180° 边界跨越
  const aCross = a.minLng > a.maxLng // a 跨越反子午线
  const bCross = b.minLng > b.maxLng // b 跨越反子午线
  if (!aCross && !bCross) {
    return a.minLng <= b.maxLng && a.maxLng >= b.minLng
  }
  if (aCross && bCross) {
    // 两者都跨越 → 必然相交（全球覆盖）
    return true
  }
  // 一个跨越、一个不跨越
  const cross = aCross ? a : b
  const normal = aCross ? b : a
  return normal.minLng <= cross.maxLng || normal.maxLng >= cross.minLng
}

// ═══════════════════════════════════════════
// 航迹实体创建
// ═══════════════════════════════════════════

export interface TrackState {
  selectedId: string | null
  replayTime: number | null
  lineWidths: Record<string, number>
  dotScale: Record<string, number>
  visibility: Record<string, boolean>
  showLabels: boolean
  getLineColor: (source: DataSource, fileName?: string) => Cesium.Color
}

export function createTrackEntities(track: Track, state: TrackState) {
  if (!ctx?.viewer || track.positions.length === 0) return
  if (!ctx.trackLabels) return

  const color = state.getLineColor(track.source, track.fileName)
  const tKey = trackKey(track.id, track.source, track.fileName)
  const isSelected = tKey === state.selectedId
  const isRaw = track.source === 'radar_raw'
  const replaying = state.replayTime !== null

  const trailRef = { positions: toCartesianArray(track.positions, tKey) }

  // Entity API: main polyline
  let entity: Cesium.Entity | undefined
  if (track.positions.length >= 2) {
    const width = isSelected ? SELECTED_WIDTH : baseWidth(track.source, state.lineWidths, track.fileName)
    const alpha = isSelected ? SELECTED_ALPHA : isRaw ? RAW_ALPHA : NORMAL_ALPHA
    entity = ctx.viewer.entities.add({
      id: tKey,
      show: !replaying && state.visibility[track.source] !== false && state.visibility[`${track.source}::${track.fileName}`] !== false,
      polyline: {
        positions: replaying ? [] : toCartesianArray(track.positions, tKey),
        width,
        material: color.withAlpha(alpha),
        clampToGround: false,
      },
    })
  }

  const label = [track.metadata.flightNumber, track.metadata.aircraftType]
    .filter(Boolean)
    .join(' | ')

  const last = track.positions[track.positions.length - 1]
  const lastPos = Cesium.Cartesian3.fromDegrees(last.longitude, last.latitude, getEffectiveAltitude(tKey))

  // P1: PointPrimitive for endpoint dot
  let pointPrimitive: Cesium.PointPrimitive | undefined
  if (ctx.pointPrimitives) {
    const base = isSelected ? DOT_SELECTED : isRaw ? DOT_RAW : DOT_BASE
    pointPrimitive = ctx.pointPrimitives.add({
      id: tKey,
      show: !replaying || state.replayTime! >= track.positions[0].timestamp,
      position: lastPos,
      color: color,
      pixelSize: pointPrimSize(base, track.source, state.dotScale, track.fileName),
    })
  }

  // Label in LabelCollection
  const lbl = ctx.trackLabels.add({
    id: `${tKey}::dot`,
    show: state.visibility[track.source] !== false &&
      state.visibility[`${track.source}::${track.fileName}`] !== false &&
      (!replaying || state.replayTime! >= track.positions[0].timestamp),
    position: lastPos,
    text: state.showLabels ? (label || track.id) : '',
    font: state.showLabels ? LABEL_FONT_LARGE : LABEL_FONT_BASE,
    fillColor: color,
    outlineColor: Cesium.Color.BLACK,
    outlineWidth: 2,
    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
    pixelOffset: new Cesium.Cartesian2(0, -20),
  })

  entityMap.set(tKey, {
    entity, trailLine: undefined, label: lbl, pointPrimitive,
    source: track.source, fileName: track.fileName, labelText: label || track.id, trailRef,
    firstTimestamp: track.positions[0].timestamp,
    replayPositionValid: false,
    trailPositions: [],
    lastTrailLo: track.positions.length - 1,
    cachedPositions: toCartesianArray(track.positions, tKey),
    _trailCache: [],
    positionsHash: track.positionsHash,
  })
  trackExtents.set(tKey, computeTrackExtent(track.positions))
}

// ═══════════════════════════════════════════
// 航迹实体删除
// ═══════════════════════════════════════════

export function removeTrailLine(trailLine: Cesium.Polyline | undefined) {
  if (!trailLine || !ctx?.trackLines) return
  const mat = (trailLine as any).material as Cesium.Material | undefined
  ctx.trackLines.remove(trailLine)
  if (mat && !mat.isDestroyed()) mat.destroy()
}

export function removeTrackEntities(id: string) {
  const entry = entityMap.get(id)
  if (entry && ctx?.viewer) {
    if (entry.entity) ctx.viewer.entities.remove(entry.entity)
    if (entry.trailLine) removeTrailLine(entry.trailLine)
    if (entry.label && ctx.trackLabels) ctx.trackLabels.remove(entry.label)
    if (entry.pointPrimitive) ctx.pointPrimitives?.remove(entry.pointPrimitive)
    entityMap.delete(id)
    trackExtents.delete(id)
  }
}

export function clearAllEntities() {
  if (!ctx?.viewer) return
  for (const [id] of entityMap) {
    removeTrackEntities(id)
  }
  // Remove any leftover hover overlay
  // (hoverOverlayLines was removed — hover now modifies entity polyline directly)
}

// ═══════════════════════════════════════════
// 可见性重新应用
// ═══════════════════════════════════════════

export function reapplyVisibility(
  visibility: Record<string, boolean>,
  replayTime: number | null,
) {
  const replaying = replayTime !== null
  const vpExt = currentViewportExtent // 2D 裁剪范围，3D 模式下为 null
  for (const [tKey, entities] of entityMap) {
    const fileKey = `${entities.source}::${entities.fileName}`
    const layerVis = visibility[entities.source] !== false && visibility[fileKey] !== false
    // 2D 模式下额外检查视口裁剪：包围盒与视口无交集 → 隐藏
    const inViewport = !vpExt || extentsOverlap(trackExtents.get(tKey) ?? { minLng: -180, maxLng: 180, minLat: -90, maxLat: 90 }, vpExt)
    const vis = layerVis && inViewport && isReplayTrackActive(entities, replayTime)
    if (entities.entity) entities.entity.show = replaying ? false : vis
    if (entities.trailLine) entities.trailLine.show = replaying ? vis : false
    setTrackPointLikeVisibility(entities, vis)
  }
}

/**
 * 2D 视口裁剪：计算当前相机可见地理范围，隐藏视口外实体。
 * 3D 模式下直接清空裁剪范围（Cesium 内置 frustum + horizon culling 足够）。
 *
 * 调用时机：camera.moveEnd（防抖 ~50ms）、初始同步后、模式切换后。
 */
export function updateViewportCulling2D(
  viewer: Cesium.Viewer,
  visibility: Record<string, boolean>,
  replayTime: number | null,
) {
  if (viewer.scene.mode !== Cesium.SceneMode.SCENE2D) {
    // 3D 模式：交给 Cesium 原生裁剪，不做额外隐藏
    if (currentViewportExtent !== null) {
      currentViewportExtent = null
      reapplyVisibility(visibility, replayTime)
      viewer.scene.requestRender()
    }
    return
  }

  // 2D 模式：用 computeViewRectangle 获取当前视野的地理范围
  const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid)
  let extent: TrackExtent

  if (!rect) {
    // 视野覆盖全球（缩放层级很低时 rect 返回 undefined）→ 全部可见
    extent = { minLng: -180, maxLng: 180, minLat: -90, maxLat: 90 }
  } else {
    const west = Cesium.Math.toDegrees(rect.west)
    const south = Cesium.Math.toDegrees(rect.south)
    const east = Cesium.Math.toDegrees(rect.east)
    const north = Cesium.Math.toDegrees(rect.north)
    // 加 15% 边距防止边缘实体反复 pop-in/out
    const lngMargin = (east - west) * 0.15
    const latMargin = (north - south) * 0.15
    extent = {
      minLng: west - lngMargin,
      maxLng: east + lngMargin,
      minLat: Math.max(-90, south - latMargin),
      maxLat: Math.min(90, north + latMargin),
    }
  }

  // 仅在范围真正变化时才更新（避免无意义的全量遍历）
  const prev = currentViewportExtent
  if (
    prev &&
    Math.abs(prev.minLng - extent.minLng) < 0.01 &&
    Math.abs(prev.maxLng - extent.maxLng) < 0.01 &&
    Math.abs(prev.minLat - extent.minLat) < 0.01 &&
    Math.abs(prev.maxLat - extent.maxLat) < 0.01
  ) {
    return // 视口几乎没变，跳过
  }

  currentViewportExtent = extent
  reapplyVisibility(visibility, replayTime)
  viewer.scene.requestRender()
}

export function syncEntities(newTracks: Track[], state: TrackState) {
  if (!ctx?.viewer) return

  const t0 = performance.now()
  try {
    ctx.viewer.entities.suspendEvents()

    const keepIds = new Set(newTracks.map((t) => trackKey(t.id, t.source, t.fileName)))
    const oldIds = Array.from(entityMap.keys())

    // Remove entities for tracks no longer in display list
    for (const id of oldIds) {
      if (!keepIds.has(id)) {
        removeTrackEntities(id)
      }
    }

    // Add or update entities
    for (const track of newTracks) {
      const tKey = trackKey(track.id, track.source, track.fileName)
      const existing = entityMap.get(tKey)
      if (!existing) {
        createTrackEntities(track, state)
        continue
      }
      const nextFirstTimestamp = track.positions[0]?.timestamp ?? existing.firstTimestamp
      const replayPositionMayChange = nextFirstTimestamp !== existing.firstTimestamp || existing.positionsHash !== track.positionsHash
      existing.firstTimestamp = nextFirstTimestamp

      const hasEnoughPoints = track.positions.length >= 2
      const isRaw = track.source === 'radar_raw'
      const tSel = tKey === state.selectedId
      const replaying = state.replayTime !== null
      if (replaying && replayPositionMayChange) existing.replayPositionValid = false
      if (!replaying) {
        existing.lastTrailLo = track.positions.length - 1
      }
      const vis = state.visibility[track.source] !== false && state.visibility[`${track.source}::${track.fileName}`] !== false

      if (existing.entity) {
        if (hasEnoughPoints) {
          if (!replaying) {
            // Only rebuild Cartesian3 arrays when positions actually changed
            if (existing.positionsHash !== track.positionsHash) {
              const newPositions = toCartesianArray(track.positions, tKey)
              existing.trailRef.positions = newPositions
              existing.cachedPositions = newPositions
              if (existing.entity.polyline) {
                ;(existing.entity.polyline as any).positions = newPositions
              }
              existing.positionsHash = track.positionsHash
            }
            existing.entity.show = vis
          }
          if (existing.entity.polyline) {
            (existing.entity.polyline as any).width = tSel ? SELECTED_WIDTH : baseWidth(track.source, state.lineWidths, track.fileName)
            const color = state.getLineColor(track.source, track.fileName)
            existing.entity.polyline.material = color.withAlpha(tSel ? SELECTED_ALPHA : isRaw ? RAW_ALPHA : NORMAL_ALPHA) as any
          }
        } else {
          existing.entity.show = false
        }
      } else if (hasEnoughPoints) {
        const color = state.getLineColor(track.source, track.fileName)
        if (!replaying) {
          const pos = toCartesianArray(track.positions, tKey)
          existing.trailRef.positions = pos
          existing.cachedPositions = pos
          existing.positionsHash = track.positionsHash
        }
        existing.entity = ctx.viewer.entities.add({
          id: tKey,
          show: vis,
          polyline: {
            positions: existing.trailRef.positions,
            width: tSel ? SELECTED_WIDTH : baseWidth(track.source, state.lineWidths, track.fileName),
            material: color.withAlpha(tSel ? SELECTED_ALPHA : isRaw ? RAW_ALPHA : NORMAL_ALPHA),
            clampToGround: false,
          },
        })
      }

      // Update label & PointPrimitive to last position
      const last = track.positions[track.positions.length - 1]
      const lastPos = Cesium.Cartesian3.fromDegrees(last.longitude, last.latitude, getEffectiveAltitude(tKey))
      if (existing.label) existing.label.position = lastPos
      if (existing.pointPrimitive) {
        existing.pointPrimitive.position = lastPos
        // Update pixelSize to reflect file-level dot scale overrides
        const isRaw = track.source === 'radar_raw'
        const base = isRaw ? 0.4 : 0.7
        existing.pointPrimitive.pixelSize = pointPrimSize(base, track.source, state.dotScale, track.fileName)
      }

      // 2D 裁剪：航迹位置更新后刷新包围盒
      if (!replaying) {
        trackExtents.set(tKey, computeTrackExtent(track.positions))
      }
    }
  } finally {
    ctx.viewer.entities.resumeEvents()
    reapplyVisibility(state.visibility, state.replayTime)
    ctx.viewer.scene.requestRender()
  }
  const t1 = performance.now()
  console.log(`[perf] Cesium syncEntities: ${(t1 - t0).toFixed(0)}ms  |  tracks=${newTracks.length}`)

  // Periodic LabelCollection rebuild to prevent glyph atlas bloat
  labelRebuildCounter = (labelRebuildCounter || 0) + 1
  if (labelRebuildCounter >= LABEL_REBUILD_INTERVAL && ctx.trackLabels && ctx.viewer) {
    labelRebuildCounter = 0
    ctx.viewer.scene.primitives.remove(ctx.trackLabels)
    if (!ctx.trackLabels.isDestroyed()) ctx.trackLabels.destroy()
    const newLabels = ctx.viewer.scene.primitives.add(new Cesium.LabelCollection())
    ctx.trackLabels = newLabels
    for (const [tKey, entry] of entityMap) {
      if (!entry.label) continue
      entry.label = newLabels.add({
        id: `${tKey}::dot`,
        show: entry.label.show,
        position: entry.label.position,
        text: entry.label.text,
        font: entry.label.font,
        fillColor: entry.label.fillColor,
        outlineColor: entry.label.outlineColor,
        outlineWidth: entry.label.outlineWidth,
        style: entry.label.style,
        verticalOrigin: entry.label.verticalOrigin,
        pixelOffset: entry.label.pixelOffset,
      })
    }
    console.log('[perf] LabelCollection rebuilt to shrink glyph atlas')
  }
}

// ═══════════════════════════════════════════
// 集合重建（回放结束后释放膨胀的 GPU 缓存）
// ═══════════════════════════════════════════

export function rebuildLabelAndPointCollections() {
  if (!ctx?.viewer) return

  // ── LabelCollection 重建 ──
  if (ctx.trackLabels && ctx.viewer.scene.primitives.contains(ctx.trackLabels)) {
    const oldLabels = ctx.trackLabels
    const newLabels = ctx.viewer.scene.primitives.add(new Cesium.LabelCollection())
    ctx.trackLabels = newLabels
    for (const [, entry] of entityMap) {
      if (!entry.label) continue
      const o = entry.label
      entry.label = newLabels.add({
        id: o.id, show: o.show, position: o.position, text: o.text,
        font: o.font, fillColor: o.fillColor, outlineColor: o.outlineColor,
        outlineWidth: o.outlineWidth, style: o.style,
        verticalOrigin: o.verticalOrigin, pixelOffset: o.pixelOffset,
      })
    }
    ctx.viewer.scene.primitives.remove(oldLabels)
    if (!oldLabels.isDestroyed()) oldLabels.destroy()
  }

  // ── PointPrimitiveCollection 重建 ──
  if (ctx.pointPrimitives && ctx.viewer.scene.primitives.contains(ctx.pointPrimitives)) {
    const oldPts = ctx.pointPrimitives
    const newPts = ctx.viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection())
    ctx.pointPrimitives = newPts
    for (const [, entry] of entityMap) {
      if (!entry.pointPrimitive) continue
      const o = entry.pointPrimitive
      entry.pointPrimitive = newPts.add({
        id: o.id, show: o.show, position: o.position,
        color: o.color, pixelSize: o.pixelSize,
      })
    }
    ctx.viewer.scene.primitives.remove(oldPts)
    if (!oldPts.isDestroyed()) oldPts.destroy()
  }
}

// ═══════════════════════════════════════════
// 回放逐帧更新
// ═══════════════════════════════════════════

export function updateReplayPositions(
  time: number,
  tracks: Track[],
  state: Pick<TrackState, 'selectedId' | 'lineWidths' | 'visibility' | 'getLineColor'>,
  pointDotEntityMap: Map<string, Cesium.PointPrimitive[]>,
  pointDotLastLo: Map<string, number>,
) {
  if (!ctx?.viewer) return

  const tStart = performance.now()

  let diagTrailUpdated = 0
  let diagTrailReused = 0
  let diagTrailSkipped = 0
  let diagTrailNoCache = 0

  for (const track of tracks) {
    const tKey = trackKey(track.id, track.source, track.fileName)
    const entities = entityMap.get(tKey)
    if (!entities || track.positions.length === 0) continue

    const pts = track.positions
    const cache = entities.cachedPositions

    if (!cache || cache.length === 0) {
      diagTrailNoCache++
      hideReplayTrackBeforeStart(entities, pointDotEntityMap.get(tKey), pointDotLastLo, tKey)
      continue
    }

    // Inline binary search
    let lo: number, hi: number
    if (time <= pts[0].timestamp) {
      lo = 0; hi = 1
    } else if (time >= pts[pts.length - 1].timestamp) {
      lo = pts.length - 1; hi = pts.length - 1
    } else {
      lo = 0; hi = pts.length - 1
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1
        if (pts[mid].timestamp <= time) lo = mid; else hi = mid
      }
    }

    if (time < pts[0].timestamp) {
      hideReplayTrackBeforeStart(entities, pointDotEntityMap.get(tKey), pointDotLastLo, tKey)
      continue
    }

    const vis = state.visibility[entities.source] !== false && state.visibility[`${entities.source}::${entities.fileName}`] !== false

    // Interpolate current position
    const dt = pts[hi].timestamp - pts[lo].timestamp
    const t = dt > 0 ? (time - pts[lo].timestamp) / dt : 0
    const cpLat = pts[lo].latitude + (pts[hi].latitude - pts[lo].latitude) * t
    const cpLng = pts[lo].longitude + (pts[hi].longitude - pts[lo].longitude) * t

    const cpPos = Cesium.Cartesian3.fromDegrees(cpLng, cpLat, getEffectiveAltitude(tKey))
    entities.replayPositionValid = true
    if (entities.label) {
      entities.label.position = cpPos
      entities.label.show = vis
    }
    if (entities.pointPrimitive) {
      entities.pointPrimitive.position = cpPos
      entities.pointPrimitive.show = vis
    }

    // Hide full entity line, show trail in PolylineCollection
    if (entities.entity) entities.entity.show = false

    // ── Trail geometry: 增量追加 ──
    // 原来每帧 0→lo 全量重建（O(lo) 迭代 + fromDegreesArrayHeights + VBO 上传），
    // lo 随回放推进从 0 涨到 1000+，是帧率持续下降的根因。
    // 改进：lo 前进时只追加新点（prevLo+1 → lo），复用缓存数组，O(Δlo) ≈ O(1)。
    const prevLo = entities.lastTrailLo
    const MAX_TRAIL = 300 // 滑动窗口上限，超出后丢弃旧点

    if (lo !== prevLo) {
      // 处理跳帧（seek 后 lo 可能跳跃很大）：跳过全量重建，从头开始
      let cache = entities._trailCache
      if (lo < prevLo || !cache) {
        cache = []
        entities._trailCache = cache
        entities.lastTrailLo = -1
      }

      // 追加新数据点（prevLo+1 → lo），lastTrailLo 已在上面可能是 -1
      const start = entities.lastTrailLo + 1
      for (let i = start; i <= lo; i++) {
        cache.push(Cesium.Cartesian3.fromDegrees(pts[i].longitude, pts[i].latitude, getEffectiveAltitude(tKey)))
      }
      // 追加插值尾点
      const lastPast = pts[lo]
      if (Math.abs(cpLat - lastPast.latitude) > 1e-7 || Math.abs(cpLng - lastPast.longitude) > 1e-7) {
        cache.push(cpPos)
      }
      // 滑动窗口：超出上限则丢弃头部
      if (cache.length > MAX_TRAIL) {
        cache.splice(0, cache.length - MAX_TRAIL)
      }

      entities.lastTrailLo = lo

      if (entities.trailLine) {
        entities.trailLine.positions = cache
        entities.trailLine.show = cache.length >= 2 && vis
        diagTrailUpdated++
      } else if (cache.length >= 2) {
        const color = state.getLineColor(track.source, track.fileName)
        const isSel = tKey === state.selectedId
        const isRaw = track.source === 'radar_raw'
        entities.trailLine = ctx.trackLines!.add({
          id: `trail::${tKey}`,
          show: vis,
          positions: cache,
          width: isSel ? SELECTED_WIDTH : baseWidth(track.source, state.lineWidths, track.fileName),
          material: Cesium.Material.fromType('Color', {
            color: color.withAlpha(isSel ? SELECTED_ALPHA : (isRaw ? RAW_ALPHA : NORMAL_ALPHA)),
          }),
        })
        diagTrailUpdated++
      } else {
        diagTrailSkipped++
      }
    } else {
      diagTrailReused++
      if (entities.trailLine && !entities.trailLine.show) {
        entities.trailLine.show = vis
      }
    }

    // Progressive point dots
    const dotPrimitives = pointDotEntityMap.get(tKey)
    if (dotPrimitives && dotPrimitives.length > 0) {
      const prevDotLo = pointDotLastLo.get(tKey) ?? -1
      if (lo !== prevDotLo) {
        pointDotLastLo.set(tKey, lo)
        for (let i = 0; i < dotPrimitives.length; i++) {
          dotPrimitives[i].show = vis && i <= lo
        }
      }
    }
  }

  // Diagnostic output every 60 frames
  if ((window as any).__diagFrameCount === undefined) (window as any).__diagFrameCount = 0
  ;(window as any).__diagFrameCount++
  const diagFc = (window as any).__diagFrameCount
  if (diagFc % 60 === 0) {
    const tMs = (performance.now() - tStart).toFixed(1)
    console.log(
      `[REPLAY-DIAG] frame#${diagFc} ${tMs}ms | tracks=${tracks.length} ` +
      `trails=${diagTrailUpdated} reused=${diagTrailReused} skipped=${diagTrailSkipped} noCache=${diagTrailNoCache}`
    )
  }

  ctx.viewer.scene.requestRender()
}

// ═══════════════════════════════════════════
// 悬停高亮
// ═══════════════════════════════════════════

export function applyHoverHighlight(
  trackId: string,
  state: { dotScale: Record<DataSource, number>; lineWidths: Record<DataSource, number> },
) {
  if (!ctx?.viewer) return
  const entry = entityMap.get(trackId)
  if (!entry) return

  // ── 直接修改 entity polyline 外观（PolylineGraphics.material/width） ──
  // 不创建独立 overlay polyline，从根本上消除 2D/3D 深度竞争问题。
  if (entry.entity?.polyline) {
    const pg = entry.entity.polyline
    // 保存原始状态用于后续恢复（总是覆盖，因为 syncEntities 或 remove 之后状态已过时）
    _hoverLineSave = {
      entityMaterial: pg.material,
      entityWidth: pg.width,
      trailColor: null,
      trailWidth: null,
    }
    pg.material = new Cesium.ColorMaterialProperty(HOVER_COLOR)
    pg.width = new Cesium.ConstantProperty(HOVER_WIDTH)
  }

  // ── 回放期间也要修改 trailLine（PolylineCollection 中的线） ──
  if (entry.trailLine?.show && _hoverLineSave) {
    const mat = entry.trailLine.material as Cesium.Material
    if (mat?.uniforms?.color) {
      _hoverLineSave.trailColor = Cesium.Color.clone(mat.uniforms.color)
    }
    _hoverLineSave.trailWidth = entry.trailLine.width
    entry.trailLine.material = Cesium.Material.fromType('Color', { color: HOVER_COLOR })
    entry.trailLine.width = HOVER_WIDTH
  }

  // ── 端点高亮（PointPrimitive） ──
  if (entry.pointPrimitive) {
    entry.pointPrimitive.pixelSize = pointPrimSize(DOT_HOVER, entry.source, state.dotScale, entry.fileName)
    entry.pointPrimitive.color = HOVER_COLOR
  }

  // 兼容：隐藏旧的 overlay line（hover 已改为直接修改 entity polyline，此处为防御性代码）
  // ctx.activeOverlayLine 始终为 null，hoverOverlayLines 已被移除

  ctx.viewer.scene.requestRender()
}

export function removeHoverHighlight(
  previousSelectedId: string | null,
  getLineColor: (source: DataSource, fileName?: string) => Cesium.Color,
  state: { dotScale: Record<DataSource, number> },
) {
  // ── 恢复 entity polyline / trailLine 到 hover 前的原始外观 ──
  if (_hoverLineSave && hoveredTrackId) {
    const entry = entityMap.get(hoveredTrackId)
    if (entry?.entity?.polyline) {
      entry.entity.polyline.material = _hoverLineSave.entityMaterial
      entry.entity.polyline.width = _hoverLineSave.entityWidth
    }
    if (entry?.trailLine) {
      if (_hoverLineSave.trailColor) {
        const mat = entry.trailLine.material as Cesium.Material
        if (mat?.uniforms?.color) {
          mat.uniforms.color = _hoverLineSave.trailColor
        }
      }
      if (_hoverLineSave.trailWidth !== null) {
        entry.trailLine.width = _hoverLineSave.trailWidth
      }
    }
    _hoverLineSave = null
  }

  // 兼容：隐藏旧的 overlay line（hover 已改为直接修改 entity polyline，此处为防御性代码）
  // ctx.activeOverlayLine 始终为 null，hoverOverlayLines 已被移除

  if (!hoveredTrackId) return
  const entry = entityMap.get(hoveredTrackId)
  if (entry?.pointPrimitive) {
    const isSelected = hoveredTrackId === previousSelectedId
    entry.pointPrimitive.pixelSize = pointPrimSize(
      isSelected ? DOT_SELECTED : entry.source === 'radar_raw' ? DOT_RAW : DOT_BASE,
      entry.source,
      state.dotScale,
      entry.fileName,
    )
    entry.pointPrimitive.color = getLineColor(entry.source as DataSource, entry.fileName)
  }
  hoveredTrackId = null
}

// ═══════════════════════════════════════════
// PolylineCollection 重建后清理
// ═══════════════════════════════════════════

/**
 * 在 PolylineCollection 重建后调用，清空所有 entity 中指向旧 Collection 的
 * trailLine 引用。旧 Polyline 对象已随旧 Collection 一同销毁，若不清空引用
 * 会在下次回放时访问 dangling pointer。
 */
export function clearTrailLineRefs() {
  for (const [, entry] of entityMap) {
    entry.trailLine = undefined
    entry._trailCache = []
  }
}

// ═══════════════════════════════════════════
// 回放停止后：复现"筛选→切回全量"的完整重建效果
// ═══════════════════════════════════════════

/**
 * 回放结束后调用。通过 "先同步空列表再同步全量" 两次 syncEntities 调用，
 * 精确复现"筛选航迹再切回全量"时的完整重建流程：
 *
 *   1. syncEntities([])   → 移除所有 entity/label/pointPrimitive（释放所有 GPU 资源）
 *   2. syncEntities(tracks) → 为每条航迹重建 entity/label/pointPrimitive（全新 GPU 资源）
 *
 * 这与用户在 TimeFilterPanel 中先设一个极窄时间窗口（过滤掉大量航迹）
 * 再清除过滤（恢复全量）的效果完全一致。
 */
export function forceRebuildAll(tracks: Track[], state: TrackState) {
  if (!ctx?.viewer) return
  syncEntities([], state)
  syncEntities(tracks, state)
}

// ═══════════════════════════════════════════
// 回放开始/停止辅助
// ═══════════════════════════════════════════

export function onReplayStart(
  tracks: Track[],
  pointDotEntityMap: Map<string, Cesium.PointPrimitive[]>,
  pointDotLastLo: Map<string, number>,
) {
  for (const track of tracks) {
    const entities = entityMap.get(trackKey(track.id, track.source, track.fileName))
    if (!entities || track.positions.length === 0) continue
    if (entities.entity) entities.entity.show = false
    if (entities.trailLine) {
      removeTrailLine(entities.trailLine)
      entities.trailLine = undefined
    }
    entities._trailCache = []
    entities.lastTrailLo = -1
    entities.replayPositionValid = false

    // Reposition ball & label to track start (first position)
    const first = track.positions[0]
    const firstPos = Cesium.Cartesian3.fromDegrees(first.longitude, first.latitude, getEffectiveAltitude(trackKey(track.id, track.source, track.fileName)))
    if (entities.label) entities.label.position = firstPos
    if (entities.pointPrimitive) entities.pointPrimitive.position = firstPos
    setTrackPointLikeVisibility(entities, false)
  }
  if (pointDotEntityMap.size > 0) {
    pointDotLastLo.clear()
    for (const primitives of pointDotEntityMap.values()) {
      for (const p of primitives) p.show = false
    }
  }
}

export function onReplayStop(
  tracks: Track[],
  state: { visibility: Record<string, boolean>; selectedId: string | null },
  pointDotEntityMap: Map<string, Cesium.PointPrimitive[]>,
  pointDotLastLo: Map<string, number>,
) {
  for (const track of tracks) {
    const entities = entityMap.get(trackKey(track.id, track.source, track.fileName))
    if (!entities || track.positions.length === 0) continue
    if (entities.trailLine) {
      removeTrailLine(entities.trailLine)
      entities.trailLine = undefined
    }
    if (entities.entity) {
      entities.entity.show = state.visibility[entities.source] !== false && state.visibility[`${entities.source}::${entities.fileName}`] !== false
    }
    // Label & dot to last position
    const last = track.positions[track.positions.length - 1]
    const lastPos = Cesium.Cartesian3.fromDegrees(last.longitude, last.latitude, getEffectiveAltitude(trackKey(track.id, track.source, track.fileName)))
    if (entities.label) entities.label.position = lastPos
    if (entities.pointPrimitive) entities.pointPrimitive.position = lastPos
  }
  pointDotLastLo.clear()
  for (const primitives of pointDotEntityMap.values()) {
    for (const p of primitives) p.show = true
  }
}
