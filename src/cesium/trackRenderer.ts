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
import {
  FLAT_ALTITUDE,
  HOVER_OVERLAY_ALTITUDE,
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

/** 回放状态追踪 */
let wasReplaying = false

/** 悬停状态 */
let hoveredTrackId: string | null = null

/** 预解析的 HOVER_COLOR */
let HOVER_COLOR: Cesium.Color

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

export function toCartesianArray(positions: TrackPoint[]): Cesium.Cartesian3[] {
  const flat: number[] = []
  let lastLng = 0, lastLat = 0
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]
    if (isFinitePoint(p)) {
      flat.push(p.longitude, p.latitude, FLAT_ALTITUDE)
      lastLng = p.longitude; lastLat = p.latitude
    } else {
      flat.push(lastLng, lastLat, FLAT_ALTITUDE)
    }
  }
  return Cesium.Cartesian3.fromDegreesArrayHeights(flat)
}

export function pointPrimSize(dotBase: number, source: string, dotScale: Record<DataSource, number>): number {
  return POINT_PRIMITIVE_BASE * (dotBase / DOT_BASE) * (dotScale[source as DataSource] ?? 1.0)
}

export function baseWidth(source: DataSource, lineWidths: Record<DataSource, number>): number {
  return lineWidths[source] ?? 2.0
}

export function extractTrackKeyFromPolylineId(polylineId: string): string | null {
  if (entityMap.has(polylineId)) return polylineId
  if (polylineId.endsWith('::dot')) return polylineId.slice(0, polylineId.lastIndexOf('::'))
  if (polylineId.startsWith('trail::')) return polylineId.slice('trail::'.length)
  if (polylineId.startsWith('pointdot::')) {
    const parts = polylineId.split('::')
    return parts.length === 3 ? parts[1] : null
  }
  return null
}

// ═══════════════════════════════════════════
// 航迹实体创建
// ═══════════════════════════════════════════

export interface TrackState {
  selectedId: string | null
  replayTime: number | null
  lineWidths: Record<DataSource, number>
  dotScale: Record<DataSource, number>
  visibility: Record<string, boolean>
  showLabels: boolean
  getLineColor: (source: DataSource) => Cesium.Color
}

export function createTrackEntities(track: Track, state: TrackState) {
  if (!ctx?.viewer || track.positions.length === 0) return
  if (!ctx.trackLabels) return

  const color = state.getLineColor(track.source)
  const tKey = trackKey(track.id, track.source)
  const isSelected = tKey === state.selectedId
  const isRaw = track.source === 'radar_raw'
  const replaying = state.replayTime !== null

  const trailRef = { positions: toCartesianArray(track.positions) }

  // Entity API: main polyline
  let entity: Cesium.Entity | undefined
  if (track.positions.length >= 2) {
    const width = isSelected ? SELECTED_WIDTH : baseWidth(track.source, state.lineWidths)
    const alpha = isSelected ? SELECTED_ALPHA : isRaw ? RAW_ALPHA : NORMAL_ALPHA
    entity = ctx.viewer.entities.add({
      id: tKey,
      show: !replaying && state.visibility[track.source] !== false,
      polyline: {
        positions: replaying ? [] : toCartesianArray(track.positions),
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
  const lastPos = Cesium.Cartesian3.fromDegrees(last.longitude, last.latitude, FLAT_ALTITUDE)

  // P1: PointPrimitive for endpoint dot
  let pointPrimitive: Cesium.PointPrimitive | undefined
  if (ctx.pointPrimitives) {
    const base = isSelected ? DOT_SELECTED : isRaw ? DOT_RAW : DOT_BASE
    pointPrimitive = ctx.pointPrimitives.add({
      id: tKey,
      position: lastPos,
      color: color,
      pixelSize: pointPrimSize(base, track.source, state.dotScale),
    })
  }

  // Label in LabelCollection
  const lbl = ctx.trackLabels.add({
    id: `${tKey}::dot`,
    show: state.visibility[track.source] !== false,
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
    source: track.source, labelText: label || track.id, trailRef,
    trailPositions: [],
    lastTrailLo: track.positions.length - 1,
    cachedPositions: toCartesianArray(track.positions),
  })
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
  }
}

export function clearAllEntities() {
  if (!ctx?.viewer) return
  for (const [id] of entityMap) {
    removeTrackEntities(id)
  }
  // Remove any leftover hover overlay
  if (ctx.activeOverlayLine && ctx.hoverOverlayLines) {
    ctx.hoverOverlayLines.remove(ctx.activeOverlayLine)
    ctx.activeOverlayLine = null
  }
}

// ═══════════════════════════════════════════
// 可见性重新应用
// ═══════════════════════════════════════════

export function reapplyVisibility(
  visibility: Record<string, boolean>,
  replayTime: number | null,
) {
  const replaying = replayTime !== null
  for (const [, entities] of entityMap) {
    const vis = visibility[entities.source]
    if (entities.entity) entities.entity.show = replaying ? false : vis
    if (entities.trailLine) entities.trailLine.show = vis
    if (entities.label) entities.label.show = vis
    if (entities.pointPrimitive) entities.pointPrimitive.show = vis
  }
}

// ═══════════════════════════════════════════
// 全量同步
// ═══════════════════════════════════════════

export function syncEntities(newTracks: Track[], state: TrackState) {
  if (!ctx?.viewer) return

  const t0 = performance.now()
  try {
    ctx.viewer.entities.suspendEvents()

    const keepIds = new Set(newTracks.map((t) => trackKey(t.id, t.source)))
    const oldIds = Array.from(entityMap.keys())

    // Remove entities for tracks no longer in display list
    for (const id of oldIds) {
      if (!keepIds.has(id)) {
        removeTrackEntities(id)
      }
    }

    // Add or update entities
    for (const track of newTracks) {
      const existing = entityMap.get(trackKey(track.id, track.source))
      if (!existing) {
        createTrackEntities(track, state)
        continue
      }

      const hasEnoughPoints = track.positions.length >= 2
      const isRaw = track.source === 'radar_raw'
      const tSel = trackKey(track.id, track.source) === state.selectedId
      const replaying = state.replayTime !== null
      if (!replaying) {
        existing.lastTrailLo = track.positions.length - 1
      }
      const vis = state.visibility[track.source] !== false

      if (existing.entity) {
        if (hasEnoughPoints) {
          if (!replaying) {
            const newPositions = toCartesianArray(track.positions)
            existing.trailRef.positions = newPositions
            existing.cachedPositions = newPositions
            if (existing.entity.polyline) {
              ;(existing.entity.polyline as any).positions = newPositions
            }
            existing.entity.show = vis
          }
          if (existing.entity.polyline) {
            (existing.entity.polyline as any).width = tSel ? SELECTED_WIDTH : baseWidth(track.source, state.lineWidths)
            const color = state.getLineColor(track.source)
            existing.entity.polyline.material = color.withAlpha(tSel ? SELECTED_ALPHA : isRaw ? RAW_ALPHA : NORMAL_ALPHA) as any
          }
        } else {
          existing.entity.show = false
        }
      } else if (hasEnoughPoints) {
        const color = state.getLineColor(track.source)
        const tKey = trackKey(track.id, track.source)
        if (!replaying) {
          const pos = toCartesianArray(track.positions)
          existing.trailRef.positions = pos
          existing.cachedPositions = pos
        }
        existing.entity = ctx.viewer.entities.add({
          id: tKey,
          show: vis,
          polyline: {
            positions: existing.trailRef.positions,
            width: tSel ? SELECTED_WIDTH : baseWidth(track.source, state.lineWidths),
            material: color.withAlpha(tSel ? SELECTED_ALPHA : isRaw ? RAW_ALPHA : NORMAL_ALPHA),
            clampToGround: false,
          },
        })
      }

      // Update label & PointPrimitive to last position
      const last = track.positions[track.positions.length - 1]
      const lastPos = Cesium.Cartesian3.fromDegrees(last.longitude, last.latitude, FLAT_ALTITUDE)
      if (existing.label) existing.label.position = lastPos
      if (existing.pointPrimitive) existing.pointPrimitive.position = lastPos
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
  if (labelRebuildCounter > 50 && ctx.trackLabels && ctx.viewer) {
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
  let diagTrailSkipped = 0
  let diagTrailNoCache = 0

  for (const track of tracks) {
    const tKey = trackKey(track.id, track.source)
    const entities = entityMap.get(tKey)
    if (!entities || track.positions.length === 0) continue

    const pts = track.positions
    const cache = entities.cachedPositions

    if (!cache || cache.length === 0) {
      diagTrailNoCache++
      if (entities.label) entities.label.position = undefined as any
      if (entities.pointPrimitive) entities.pointPrimitive.position = undefined as any
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
      if (entities.entity) entities.entity.show = false
      if (entities.trailLine) { removeTrailLine(entities.trailLine); entities.trailLine = undefined }
      continue
    }

    const vis = state.visibility[entities.source] !== false

    // Interpolate current position
    const dt = pts[hi].timestamp - pts[lo].timestamp
    const t = dt > 0 ? (time - pts[lo].timestamp) / dt : 0
    const cpLat = pts[lo].latitude + (pts[hi].latitude - pts[lo].latitude) * t
    const cpLng = pts[lo].longitude + (pts[hi].longitude - pts[lo].longitude) * t

    const cpPos = Cesium.Cartesian3.fromDegrees(cpLng, cpLat, FLAT_ALTITUDE)
    if (entities.label) entities.label.position = cpPos
    if (entities.pointPrimitive) entities.pointPrimitive.position = cpPos

    // Build progressive trail
    const trailPts: number[] = []
    for (let i = 0; i <= lo; i++) {
      trailPts.push(pts[i].longitude, pts[i].latitude, FLAT_ALTITUDE)
    }
    const lastPast = pts[lo]
    if (Math.abs(cpLat - lastPast.latitude) > 1e-7 || Math.abs(cpLng - lastPast.longitude) > 1e-7) {
      trailPts.push(cpLng, cpLat, FLAT_ALTITUDE)
    }
    const trailPositions = Cesium.Cartesian3.fromDegreesArrayHeights(trailPts)

    // Hide full entity line, show trail in PolylineCollection
    if (entities.entity) entities.entity.show = false

    if (entities.trailLine) {
      entities.trailLine.positions = trailPositions
      entities.trailLine.show = trailPositions.length >= 2 && vis
      diagTrailUpdated++
    } else if (trailPositions.length >= 2) {
      const color = state.getLineColor(track.source)
      const isSel = tKey === state.selectedId
      const isRaw = track.source === 'radar_raw'
      entities.trailLine = ctx.trackLines!.add({
        id: `trail::${tKey}`,
        show: vis,
        positions: trailPositions,
        width: isSel ? SELECTED_WIDTH : baseWidth(track.source, state.lineWidths),
        material: Cesium.Material.fromType('Color', {
          color: color.withAlpha(isSel ? SELECTED_ALPHA : (isRaw ? RAW_ALPHA : NORMAL_ALPHA)),
        }),
      })
      diagTrailUpdated++
    } else {
      diagTrailSkipped++
    }

    // Progressive point dots
    const dotPrimitives = pointDotEntityMap.get(tKey)
    if (dotPrimitives && dotPrimitives.length > 0) {
      const prevDotLo = pointDotLastLo.get(tKey) ?? -1
      if (lo !== prevDotLo) {
        pointDotLastLo.set(tKey, lo)
        for (let i = 0; i < dotPrimitives.length; i++) {
          dotPrimitives[i].show = i <= lo
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
      `trails=${diagTrailUpdated} skipped=${diagTrailSkipped} noCache=${diagTrailNoCache} | ` +
      `total=${diagTrailUpdated + diagTrailSkipped + diagTrailNoCache}`
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
  if (!entry || !entry.entity?.polyline) return

  const srcPositions = (entry.entity.polyline as any).positions?.getValue?.()
    ?? (entry.entity.polyline as any).positions
  if (!srcPositions || !Array.isArray(srcPositions) || srcPositions.length < 2) return

  const elevatedPositions = srcPositions.map((p: Cesium.Cartesian3) => {
    const cartographic = Cesium.Cartographic.fromCartesian(p)
    return Cesium.Cartesian3.fromDegrees(
      Cesium.Math.toDegrees(cartographic.longitude),
      Cesium.Math.toDegrees(cartographic.latitude),
      HOVER_OVERLAY_ALTITUDE,
    )
  })

  if (!ctx.activeOverlayLine) {
    ctx.activeOverlayLine = ctx.hoverOverlayLines!.add({
      id: 'hover-overlay',
      positions: elevatedPositions,
      width: HOVER_WIDTH,
      material: Cesium.Material.fromType('Color', { color: HOVER_COLOR }),
    })
  } else {
    ctx.activeOverlayLine.positions = elevatedPositions
    ctx.activeOverlayLine.show = true
    if ((ctx.activeOverlayLine.material as any)?.uniforms) {
      ;(ctx.activeOverlayLine.material as any).uniforms.color = HOVER_COLOR
    }
  }

  if (entry.pointPrimitive) {
    entry.pointPrimitive.pixelSize = pointPrimSize(DOT_HOVER, entry.source, state.dotScale)
    entry.pointPrimitive.color = HOVER_COLOR
  }
}

export function removeHoverHighlight(
  previousSelectedId: string | null,
  getLineColor: (source: DataSource) => Cesium.Color,
  state: { dotScale: Record<DataSource, number> },
) {
  if (ctx?.activeOverlayLine) {
    ctx.activeOverlayLine.show = false
  }
  if (!hoveredTrackId) return
  const entry = entityMap.get(hoveredTrackId)
  if (entry?.pointPrimitive) {
    const isSelected = hoveredTrackId === previousSelectedId
    entry.pointPrimitive.pixelSize = pointPrimSize(
      isSelected ? DOT_SELECTED : entry.source === 'radar_raw' ? DOT_RAW : DOT_BASE,
      entry.source,
      state.dotScale,
    )
    entry.pointPrimitive.color = getLineColor(entry.source as DataSource)
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
    const entities = entityMap.get(trackKey(track.id, track.source))
    if (!entities || track.positions.length === 0) continue
    if (entities.entity) entities.entity.show = false
    if (entities.trailLine) {
      removeTrailLine(entities.trailLine)
      entities.trailLine = undefined
    }
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
    const entities = entityMap.get(trackKey(track.id, track.source))
    if (!entities || track.positions.length === 0) continue
    if (entities.trailLine) {
      removeTrailLine(entities.trailLine)
      entities.trailLine = undefined
    }
    if (entities.entity) {
      entities.entity.show = state.visibility[entities.source] !== false
    }
    // Label & dot to last position
    const last = track.positions[track.positions.length - 1]
    const lastPos = Cesium.Cartesian3.fromDegrees(last.longitude, last.latitude, FLAT_ALTITUDE)
    if (entities.label) entities.label.position = lastPos
    if (entities.pointPrimitive) entities.pointPrimitive.position = lastPos
  }
  pointDotLastLo.clear()
  for (const primitives of pointDotEntityMap.values()) {
    for (const p of primitives) p.show = true
  }
}
