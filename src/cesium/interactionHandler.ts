/**
 * src/cesium/interactionHandler.ts — 鼠标事件、拾取、悬停高亮、右键菜单
 *
 * 负责：
 * 1. ScreenSpaceEventHandler 注册/销毁（LEFT_CLICK, MOUSE_MOVE, LEFT_DOUBLE_CLICK, RIGHT_CLICK）
 * 2. rAF 合并拾取（doPick → doPickWithPicked）
 * 3. 悬停/高亮/点迹穿透/城市悬停的分发逻辑
 *
 * 使用方式：在 onMounted 中调用 setupHandlers(ctx, ...)，返回清理函数。
 */

import * as Cesium from 'cesium'
import type { Track } from '../types/track'
import type { Flag } from '../composables/useFlags'
import { type CesiumContext, type CityFeature } from './types'

// ═══════════════════════════════════════════
// 模块级状态
// ═══════════════════════════════════════════

let ctx: CesiumContext | null = null

// rAF batched pick state
let pendingPickPos: Cesium.Cartesian2 | null = null
let lastMousePosition: Cesium.Cartesian2 | null = null
let pickScheduled = false

// 延迟清除隔离
let pendingClearTimeout: ReturnType<typeof setTimeout> | null = null

// 事件处理器
let clickHandler: Cesium.ScreenSpaceEventHandler | null = null
let dblClickHandler: Cesium.ScreenSpaceEventHandler | null = null
let rightClickHandler: Cesium.ScreenSpaceEventHandler | null = null
let moveHandler: Cesium.ScreenSpaceEventHandler | null = null

// 右键菜单 DOM 监听器引用
let ctxMenuFn: ((e: MouseEvent) => void) | null = null
let ctxClickOutsideFn: (() => void) | null = null
let ctxKeyFn: ((e: KeyboardEvent) => void) | null = null
let statusMouseLeaveFn: (() => void) | null = null

// ═══════════════════════════════════════════
// 初始化
// ═══════════════════════════════════════════

export function init(context: CesiumContext) {
  ctx = context
}

export function reset() {
  pendingPickPos = null
  lastMousePosition = null
  pickScheduled = false
  if (pendingClearTimeout) {
    clearTimeout(pendingClearTimeout)
    pendingClearTimeout = null
  }
  ctx = null
}

// ═══════════════════════════════════════════
// 公开访问器
// ═══════════════════════════════════════════

export function getLastMousePosition(): Cesium.Cartesian2 | null {
  return lastMousePosition
}

// ═══════════════════════════════════════════
// 回调接口
// ═══════════════════════════════════════════

export interface InteractionCallbacks {
  // emit 回调
  onTrackPick: (trackId: string | null) => void
  onShowTrackDetail: (icao: string, source: string) => void
  onDeleteTrack: (icao: string, source: string) => void
  onViewTrackPoints: (track: Track) => void
  onViewStatus: (status: { cameraHeightKm: number; longitude: number; latitude: number; fps: number } | null) => void

  // 旗标操作
  addFlag: (lat: number, lng: number) => void
  removeFlag: (id: string) => void

  // 悬停标签
  showCityHover: (city: CityFeature) => void
  hideCityHover: () => void
  showPointDotHover: (trackId: string, pointIndex: number) => void
  hidePointDotHover: () => void
  getHoveredPointDotId: () => string | null
  setHoveredPointDotId: (id: string | null) => void

  // 点迹命中检测
  checkPointDotHit: (trackId: string, mousePos: Cesium.Cartesian2) => { id: string; index: number } | null

  // 航迹高亮
  applyHoverHighlight: (trackId: string) => void
  removeHoverHighlight: () => void
  getHoveredTrackId: () => string | null
  setHoveredTrackId: (id: string | null) => void

  // entityMap 查询
  hasEntity: (trackKey: string) => boolean
  extractTrackKeyFromPolylineId: (id: string) => string | null

  // 点迹操作
  showManualPointDots: (trackId: string) => void
  hidePointDotsForTrack: (trackId: string) => void

  // 旗标查询
  getFlagById: (id: string) => Flag | undefined

  // 航迹查找
  findTrackByKey: (trackKey: string) => Track | undefined

  // 选中标识
  addHighlight: (trackKey: string) => void

  // 标尺模式
  isRulerActive?: () => boolean
  addRulerWaypoint?: (lat: number, lng: number) => void
  setRulerMouseGround?: (lat: number | null, lng: number | null) => void

  // 空间套索模式
  isLassoActive?: () => boolean
  addLassoVertex?: (lat: number, lng: number) => void
  closeLassoPolygon?: () => void
  setLassoMouseGround?: (lat: number | null, lng: number | null) => void

  // 右键菜单
  openContextMenu: (menu: {
    visible: boolean
    x: number
    y: number
    type: 'flag' | 'track'
    flagId: string
    flagLabel: string
    trackId: string
  }) => void
  closeContextMenu: () => void

  // 状态查询
  getViewStatus: (screenPos?: Cesium.Cartesian2 | null) => { cameraHeightKm: number; longitude: number; latitude: number; fps: number } | null
  pickedCity: (picked: any) => CityFeature | null
}

// ═══════════════════════════════════════════
// 核心拾取逻辑
// ═══════════════════════════════════════════

function doPick(endPosition: Cesium.Cartesian2, cb: InteractionCallbacks) {
  if (!ctx?.viewer) return
  const picked = ctx.viewer.scene.pick(endPosition)
  if (!Cesium.defined(picked) || !picked.id) {
    cb.hideCityHover()
    cb.hidePointDotHover()
    cb.removeHoverHighlight()
    ctx.viewer.scene.requestRender()
    return
  }

  // ── 点迹穿透：命中点迹时钻取找下方航迹 ──
  if (typeof picked.id === 'string' && picked.id.startsWith('pointdot::')) {
    const drill = ctx.viewer.scene.drillPick(endPosition, 5)

    for (let i = 1; i < drill.length; i++) {
      const hit = drill[i]
      if (!Cesium.defined(hit.id)) continue
      if (typeof hit.id === 'string' && hit.id.startsWith('pointdot::')) continue
      if (typeof hit.id === 'string' && hit.id === 'hover-overlay') continue

      let trackId: string | null = null
      if (typeof hit.id === 'string') {
        if (hit.id.startsWith('trail::')) {
          trackId = hit.id.slice('trail::'.length)
        } else if (cb.hasEntity(hit.id)) {
          trackId = hit.id
        }
      } else if (hit.id instanceof Cesium.Entity) {
        const entityId = (hit.id as Cesium.Entity).id
        if (typeof entityId === 'string' && cb.hasEntity(entityId)) {
          trackId = entityId
        }
      }

      if (trackId && cb.hasEntity(trackId)) {
        doPickWithPicked({ id: trackId }, endPosition, cb)
        return
      }
    }

    // 没有下方航迹：仅显示点迹信息
    const parts = (picked.id as string).split('::')
    if (parts.length === 3) {
      const trackId = parts[1]
      const index = parseInt(parts[2], 10)
      if (!isNaN(index) && cb.hasEntity(trackId)) {
        cb.removeHoverHighlight()
        cb.hideCityHover()
        cb.showPointDotHover(trackId, index)
        ctx.viewer.scene.requestRender()
      }
    }
    return
  }

  // ── hover-overlay 穿透 ──
  if (typeof picked.id === 'string' && picked.id === 'hover-overlay') {
    const drill = ctx.viewer.scene.drillPick(endPosition, 3)
    const realHit = drill.length > 1 ? drill[1] : null
    if (!realHit || !Cesium.defined(realHit.id)) {
      ctx.viewer.scene.requestRender()
      return
    }
    doPickWithPicked(realHit, endPosition, cb)
    return
  }

  // ── 正常处理 ──
  doPickWithPicked(picked, endPosition, cb)
}

function doPickWithPicked(picked: any, endPosition: Cesium.Cartesian2, cb: InteractionCallbacks) {
  if (!ctx?.viewer) return

  const city = cb.pickedCity(picked)
  if (city) {
    cb.removeHoverHighlight()
    cb.hidePointDotHover()
    cb.showCityHover(city)
    ctx.viewer.scene.requestRender()
    return
  }
  cb.hideCityHover()

  let trackId: string | null = null

  if (typeof picked.id === 'string') {
    // L1: Label pick — id is "{trackKey}::dot"
    if (picked.id.endsWith('::dot')) {
      const baseId = picked.id.slice(0, picked.id.lastIndexOf('::'))
      if (cb.hasEntity(baseId)) trackId = baseId
    }
    // L2: PointPrimitive / Entity ID (string) — direct trackKey match
    else if (cb.hasEntity(picked.id)) {
      trackId = picked.id
    }
    // L3: Trail line pick during replay (id is "trail::{trackKey}")
    else if (picked.id.startsWith('trail::')) {
      const baseId = picked.id.slice('trail::'.length)
      if (cb.hasEntity(baseId)) trackId = baseId
    }
    // L4: Point dot pick
    else if (picked.id.startsWith('pointdot::')) {
      const parts = picked.id.split('::')
      if (parts.length === 3 && cb.hasEntity(parts[1])) trackId = parts[1]
    }
  } else if (picked.id instanceof Cesium.Entity) {
    const entityId = (picked.id as Cesium.Entity).id
    if (typeof entityId === 'string' && !entityId.startsWith('flag-') && !entityId.startsWith('pointdot::')) {
      if (cb.hasEntity(entityId)) trackId = entityId
    }
  }

  if (!trackId || !cb.hasEntity(trackId)) {
    cb.removeHoverHighlight()
    cb.hidePointDotHover()
    ctx.viewer.scene.requestRender()
    return
  }

  const hoveredTrackId = cb.getHoveredTrackId()

  if (hoveredTrackId === trackId) {
    // Same track — check point dot proximity
    const dotHit = cb.checkPointDotHit(trackId, endPosition)
    if (dotHit !== null) {
      const hoveredDotId = cb.getHoveredPointDotId()
      if (hoveredDotId === dotHit.id) return
      cb.hidePointDotHover()
      cb.setHoveredPointDotId(dotHit.id)
      cb.showPointDotHover(trackId, dotHit.index)
      ctx.viewer.scene.requestRender()
    } else {
      cb.hidePointDotHover()
    }
    return
  }

  cb.removeHoverHighlight()
  cb.setHoveredTrackId(trackId)
  cb.applyHoverHighlight(trackId)

  const dotHit = cb.checkPointDotHit(trackId, endPosition)
  if (dotHit !== null) {
    cb.setHoveredPointDotId(dotHit.id)
    cb.showPointDotHover(trackId, dotHit.index)
  } else {
    cb.hidePointDotHover()
  }

  ctx.viewer.scene.requestRender()
}

// ═══════════════════════════════════════════
// MOUSE_MOVE（rAF 合并）
// ═══════════════════════════════════════════

export function onMouseMove(movement: Cesium.ScreenSpaceEventHandler.MotionEvent, cb: InteractionCallbacks) {
  pendingPickPos = movement.endPosition.clone()
  lastMousePosition = pendingPickPos.clone()

  const status = cb.getViewStatus(lastMousePosition)
  cb.onViewStatus(status)

  // ── Lasso preview: compute ground position for preview line ──
  if (cb.isLassoActive?.() && ctx?.viewer) {
    const cartesian = ctx.viewer.camera.pickEllipsoid(
      movement.endPosition, ctx.viewer.scene.globe.ellipsoid,
    )
    if (Cesium.defined(cartesian)) {
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian!)
      cb.setLassoMouseGround?.(
        Cesium.Math.toDegrees(cartographic.latitude),
        Cesium.Math.toDegrees(cartographic.longitude),
      )
    } else {
      cb.setLassoMouseGround?.(null, null)
    }
  }

  // ── Ruler preview: compute ground position for preview line ──
  if (cb.isRulerActive?.() && ctx?.viewer) {
    const cartesian = ctx.viewer.camera.pickEllipsoid(
      movement.endPosition, ctx.viewer.scene.globe.ellipsoid,
    )
    if (Cesium.defined(cartesian)) {
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian!)
      cb.setRulerMouseGround?.(
        Cesium.Math.toDegrees(cartographic.latitude),
        Cesium.Math.toDegrees(cartographic.longitude),
      )
    } else {
      cb.setRulerMouseGround?.(null, null)
    }
  }

  if (!pickScheduled) {
    pickScheduled = true
    requestAnimationFrame(() => {
      pickScheduled = false
      if (pendingPickPos && ctx?.viewer && !ctx.viewer.isDestroyed()) {
        doPick(pendingPickPos, cb)
        pendingPickPos = null
      }
    })
  }
}

// ═══════════════════════════════════════════
// 事件处理器安装
// ═══════════════════════════════════════════

export type CleanupFns = () => void

export function setupHandlers(cb: InteractionCallbacks): CleanupFns {
  if (!ctx?.viewer) return () => {}

  const viewer = ctx.viewer

  // LEFT_CLICK handler for track picking
  clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  clickHandler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    // ── Lasso mode: left-click adds a vertex ──
    if (cb.isLassoActive?.()) {
      const cartesian = viewer.camera.pickEllipsoid(
        movement.position, viewer.scene.globe.ellipsoid,
      )
      if (Cesium.defined(cartesian)) {
        const cartographic = Cesium.Cartographic.fromCartesian(cartesian!)
        const lat = Cesium.Math.toDegrees(cartographic.latitude)
        const lng = Cesium.Math.toDegrees(cartographic.longitude)
        cb.addLassoVertex?.(lat, lng)
      }
      return
    }

    // ── Ruler mode: left-click adds a waypoint instead of picking tracks ──
    if (cb.isRulerActive?.()) {
      const cartesian = viewer.camera.pickEllipsoid(
        movement.position, viewer.scene.globe.ellipsoid,
      )
      if (Cesium.defined(cartesian)) {
        const cartographic = Cesium.Cartographic.fromCartesian(cartesian!)
        const lat = Cesium.Math.toDegrees(cartographic.latitude)
        const lng = Cesium.Math.toDegrees(cartographic.longitude)
        cb.addRulerWaypoint?.(lat, lng)
      }
      return
    }

    const picked = viewer.scene.pick(movement.position)
    if (!Cesium.defined(picked) || !picked.id) {
      if (pendingClearTimeout) clearTimeout(pendingClearTimeout)
      pendingClearTimeout = setTimeout(() => {
        pendingClearTimeout = null
        cb.onTrackPick(null)
      }, 300)
      return
    }

    // Penetrate hover overlay
    let effectivePicked = picked
    if (typeof picked.id === 'string' && picked.id === 'hover-overlay') {
      const drill = viewer.scene.drillPick(movement.position, 3)
      if (drill.length > 1) effectivePicked = drill[1]
      else { cb.onTrackPick(null); return }
    }

    // PolylineCollection pick / Entity pick
    let polyTrackId: string | null = null
    if (typeof effectivePicked.id === 'string') {
      if (effectivePicked.id.startsWith('trail::')) {
        polyTrackId = effectivePicked.id.slice('trail::'.length)
      } else if (cb.hasEntity(effectivePicked.id)) {
        polyTrackId = effectivePicked.id
      } else {
        const resolved = cb.extractTrackKeyFromPolylineId(effectivePicked.id)
        if (resolved && cb.hasEntity(resolved)) polyTrackId = resolved
      }
    }
    if (polyTrackId && cb.hasEntity(polyTrackId)) {
      cb.onTrackPick(polyTrackId)
      return
    }

    // Entity API pick
    if (effectivePicked.id instanceof Cesium.Entity) {
      const entityId = (effectivePicked.id as Cesium.Entity).id
      if (typeof entityId === 'string' && !entityId.startsWith('flag-') && !entityId.startsWith('pointdot::')) {
        if (cb.hasEntity(entityId)) {
          cb.onTrackPick(entityId)
          return
        }
      }
    }

    if (pendingClearTimeout) clearTimeout(pendingClearTimeout)
    pendingClearTimeout = setTimeout(() => {
      pendingClearTimeout = null
      cb.onTrackPick(null)
    }, 300)
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

  // MOUSE_MOVE handler for hover
  moveHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  moveHandler.setInputAction(
    (movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => onMouseMove(movement, cb),
    Cesium.ScreenSpaceEventType.MOUSE_MOVE,
  )

  // LEFT_DOUBLE_CLICK handler for flag placement/removal
  viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(
    Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
  )
  dblClickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  dblClickHandler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    // ── Lasso mode: double-click closes the polygon ──
    if (cb.isLassoActive?.()) {
      cb.closeLassoPolygon?.()
      return
    }

    if (pendingClearTimeout) {
      clearTimeout(pendingClearTimeout)
      pendingClearTimeout = null
    }
    const picked = viewer.scene.pick(movement.position)
    if (Cesium.defined(picked) && picked.id instanceof Cesium.Entity) {
      const entityId = picked.id.id
      if (typeof entityId === 'string' && entityId.startsWith('flag-')) {
        const flagId = entityId.slice(5)
        cb.removeFlag(flagId)
        return
      }
    }
    // Place new flag
    const cartesian = viewer.camera.pickEllipsoid(movement.position, viewer.scene.globe.ellipsoid)
    if (!Cesium.defined(cartesian)) return
    const cartographic = Cesium.Cartographic.fromCartesian(cartesian)
    const lat = Cesium.Math.toDegrees(cartographic.latitude)
    const lng = Cesium.Math.toDegrees(cartographic.longitude)
    cb.addFlag(lat, lng)
  }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

  // RIGHT_CLICK handler for context menu
  const canvas = viewer.scene.canvas
  rightClickHandler = new Cesium.ScreenSpaceEventHandler(canvas)
  rightClickHandler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    // ── Ruler mode: suppress right-click context menu ──
    if (cb.isRulerActive?.()) {
      return
    }

    const picked = viewer.scene.pick(movement.position)
    if (Cesium.defined(picked) && picked.id) {
      let effectivePicked = picked
      if (typeof picked.id === 'string' && picked.id === 'hover-overlay') {
        const drill = viewer.scene.drillPick(movement.position, 3)
        if (drill.length > 1) effectivePicked = drill[1]
        else { cb.closeContextMenu(); return }
      }

      // PolylineCollection pick
      if (typeof effectivePicked.id === 'string') {
        let resolvedId: string | null = null
        if (effectivePicked.id.startsWith('trail::')) {
          resolvedId = effectivePicked.id.slice('trail::'.length)
        } else if (cb.hasEntity(effectivePicked.id)) {
          resolvedId = effectivePicked.id
        } else {
          const resolved = cb.extractTrackKeyFromPolylineId(effectivePicked.id)
          if (resolved && cb.hasEntity(resolved)) resolvedId = resolved
        }
        if (resolvedId && cb.hasEntity(resolvedId) && cb.getHoveredTrackId() === resolvedId) {
          cb.openContextMenu({
            visible: true, x: movement.position.x, y: movement.position.y,
            type: 'track', flagId: '', flagLabel: '', trackId: resolvedId,
          })
          return
        }
      }
      // Label pick
      if (typeof effectivePicked.id === 'string' && effectivePicked.id.endsWith('::dot')) {
        const trackId = effectivePicked.id.slice(0, effectivePicked.id.lastIndexOf('::'))
        if (cb.hasEntity(trackId) && cb.getHoveredTrackId() === trackId) {
          cb.openContextMenu({
            visible: true, x: movement.position.x, y: movement.position.y,
            type: 'track', flagId: '', flagLabel: '', trackId,
          })
          return
        }
      }

      if (effectivePicked.id instanceof Cesium.Entity) {
        const entityId = effectivePicked.id.id
        if (typeof entityId === 'string' && entityId.startsWith('flag-')) {
          const flagId = entityId.slice(5)
          const flag = cb.getFlagById(flagId)
          if (flag) {
            cb.openContextMenu({
              visible: true, x: movement.position.x, y: movement.position.y,
              type: 'flag', flagId: flag.id, flagLabel: flag.label, trackId: '',
            })
            return
          }
        }
        if (typeof entityId === 'string' && cb.hasEntity(entityId) && cb.getHoveredTrackId() === entityId) {
          cb.openContextMenu({
            visible: true, x: movement.position.x, y: movement.position.y,
            type: 'track', flagId: '', flagLabel: '', trackId: entityId,
          })
          return
        }
      }

      // point dot pick
      if (typeof effectivePicked.id === 'string' && effectivePicked.id.startsWith('pointdot::')) {
        const lastSep = (effectivePicked.id as string).lastIndexOf('::')
        if (lastSep > 'pointdot::'.length) {
          const trackId = (effectivePicked.id as string).slice('pointdot::'.length, lastSep)
          if (cb.hasEntity(trackId)) {
            cb.openContextMenu({
              visible: true, x: movement.position.x, y: movement.position.y,
              type: 'track', flagId: '', flagLabel: '', trackId,
            })
            return
          }
        }
      }
    }
    cb.closeContextMenu()
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)

  // Prevent browser default context menu
  ctxMenuFn = (e: MouseEvent) => e.preventDefault()
  canvas.addEventListener('contextmenu', ctxMenuFn)

  // Click outside to close context menu
  ctxClickOutsideFn = () => cb.closeContextMenu()
  document.addEventListener('click', ctxClickOutsideFn)

  // Esc to close context menu
  ctxKeyFn = (e: KeyboardEvent) => {
    if (e.key === 'Escape') cb.closeContextMenu()
  }
  document.addEventListener('keydown', ctxKeyFn)

  // Mouse leave canvas → clear mouse position
  statusMouseLeaveFn = () => {
    lastMousePosition = null
    cb.onViewStatus(null)
  }
  canvas.addEventListener('mouseleave', statusMouseLeaveFn)

  return () => {
    if (clickHandler) { clickHandler.destroy(); clickHandler = null }
    if (dblClickHandler) { dblClickHandler.destroy(); dblClickHandler = null }
    if (rightClickHandler) { rightClickHandler.destroy(); rightClickHandler = null }
    if (moveHandler) { moveHandler.destroy(); moveHandler = null }

    if (ctxMenuFn) { canvas.removeEventListener('contextmenu', ctxMenuFn); ctxMenuFn = null }
    if (statusMouseLeaveFn) { canvas.removeEventListener('mouseleave', statusMouseLeaveFn); statusMouseLeaveFn = null }
    if (ctxClickOutsideFn) { document.removeEventListener('click', ctxClickOutsideFn); ctxClickOutsideFn = null }
    if (ctxKeyFn) { document.removeEventListener('keydown', ctxKeyFn); ctxKeyFn = null }

    pendingPickPos = null
    lastMousePosition = null
    pickScheduled = false
    if (pendingClearTimeout) { clearTimeout(pendingClearTimeout); pendingClearTimeout = null }
  }
}
