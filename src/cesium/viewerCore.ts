/**
 * src/cesium/viewerCore.ts — Cesium Viewer 生命周期与相机管理
 *
 * 负责：
 * 1. Viewer 创建/销毁
 * 2. 影像图层（离线 MBTiles 瓦片）
 * 3. Collection 初始化（PolylineCollection、LabelCollection、PointPrimitiveCollection）
 * 4. 无极缩放（Stepless Zoom）
 * 5. FPS 追踪
 * 6. 相机状态持久化
 * 7. 相机控制（flyToTrack、flyToFlag、resetView、switchTileLayer）
 *
 * 使用方式：在 onMounted 中调用 createViewer(container, port) 获取 CesiumContext。
 */

import * as Cesium from 'cesium'
import type { Track } from '../types/track'
import type { Flag } from '../composables/useFlags'
import { scheduleSave, getRawSetting } from '../composables/useSettingsPersistence'
import { FLAT_ALTITUDE, type CesiumContext, type CameraState } from './types'

// ═══════════════════════════════════════════
// 创建 Viewer
// ═══════════════════════════════════════════

export function createViewer(container: HTMLDivElement, port: number): CesiumContext {
  const viewer = new Cesium.Viewer(container, {
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    navigationHelpButton: false,
    navigationInstructionsInitiallyVisible: false,
    scene3DOnly: true,
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
    skyBox: false,
    skyAtmosphere: false,
    baseLayer: false,
  })
  viewer.scene.globe.depthTestAgainstTerrain = true

  // Add imagery layer
  const currentImageryLayer = viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: `http://127.0.0.1:${port}/tiles/{z}/{x}/{y}.png`,
      minimumLevel: 0,
      maximumLevel: 8,
      tileWidth: 256,
      tileHeight: 256,
    }),
  )

  // P1: PointPrimitiveCollection for fast endpoint dots
  const pointPrimitives = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection()) as Cesium.PointPrimitiveCollection
  viewer.scene.primitives.lowerToBottom(pointPrimitives as any)

  // P2: PolylineCollection for replay trail lines
  const trackLines = viewer.scene.primitives.add(new Cesium.PolylineCollection()) as unknown as Cesium.PolylineCollection
  viewer.scene.primitives.lowerToBottom(trackLines as any)

  // P2: Separate PolylineCollection for hover overlay
  const hoverOverlayLines = viewer.scene.primitives.add(new Cesium.PolylineCollection()) as unknown as Cesium.PolylineCollection

  // P1: LabelCollection for track labels
  const trackLabels = viewer.scene.primitives.add(new Cesium.LabelCollection())

  // P3: PointPrimitiveCollection for track point dots
  const pointDotsCollection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection())

  const ctx: CesiumContext = {
    viewer,
    trackLines,
    hoverOverlayLines,
    activeOverlayLine: null,
    pointPrimitives,
    trackLabels,
    pointDotsCollection,
    currentImageryLayer,
    tileServerPort: port,
    fpsSmoothed: 0,
  }

  return ctx
}

// ═══════════════════════════════════════════
// 销毁 Viewer
// ═══════════════════════════════════════════

export function destroyViewer(ctx: CesiumContext) {
  // Destroy collections in dependency order before viewer.destroy()
  if (ctx.hoverOverlayLines) {
    ctx.viewer.scene.primitives.remove(ctx.hoverOverlayLines)
    if (!ctx.hoverOverlayLines.isDestroyed()) ctx.hoverOverlayLines.destroy()
  }
  if (ctx.trackLines) {
    ctx.viewer.scene.primitives.remove(ctx.trackLines)
    if (!ctx.trackLines.isDestroyed()) ctx.trackLines.destroy()
  }
  if (ctx.trackLabels) {
    ctx.viewer.scene.primitives.remove(ctx.trackLabels)
    if (!ctx.trackLabels.isDestroyed()) ctx.trackLabels.destroy()
  }
  if (ctx.pointPrimitives) {
    ctx.viewer.scene.primitives.remove(ctx.pointPrimitives)
    if (!ctx.pointPrimitives.isDestroyed()) ctx.pointPrimitives.destroy()
  }
  if (ctx.pointDotsCollection) {
    ctx.pointDotsCollection.removeAll()
  }
  ctx.viewer.destroy()
}

// ═══════════════════════════════════════════
// FPS 追踪
// ═══════════════════════════════════════════

export function setupFpsTracking(ctx: CesiumContext): () => void {
  let fpsFrameCount = 0
  let fpsLastSampleTime = 0

  const listener = () => {
    const now = performance.now()
    if (fpsLastSampleTime === 0) {
      fpsLastSampleTime = now
      fpsFrameCount = 1
      return
    }
    fpsFrameCount++
    const elapsed = now - fpsLastSampleTime
    if (elapsed >= 500 && fpsFrameCount >= 5) {
      const instantFps = fpsFrameCount / (elapsed / 1000)
      ctx.fpsSmoothed = ctx.fpsSmoothed === 0 ? instantFps : ctx.fpsSmoothed * 0.5 + instantFps * 0.5
      fpsFrameCount = 0
      fpsLastSampleTime = now
    }
    if (elapsed > 1500) {
      ctx.fpsSmoothed = 0
      fpsFrameCount = 0
      fpsLastSampleTime = now
    }
  }

  ctx.viewer.scene.postRender.addEventListener(listener)
  return () => {
    ctx.viewer.scene.postRender.removeEventListener(listener)
  }
}

// ═══════════════════════════════════════════
// 无极缩放
// ═══════════════════════════════════════════

export function setupSteplessZoom(ctx: CesiumContext): () => void {
  ctx.viewer.scene.screenSpaceCameraController.zoomEventTypes = []

  const zoomCanvas = ctx.viewer.scene.canvas
  const onWheel = (event: WheelEvent) => {
    event.preventDefault()

    let deltaPx = event.deltaY
    if (event.deltaMode === 1) {
      deltaPx = event.deltaY * 33
    } else if (event.deltaMode === 2) {
      deltaPx = event.deltaY * 800
    }

    const sensitivity = 0.0005
    const zoomFactor = 1 + deltaPx * sensitivity

    const cam = ctx.viewer.camera
    const { globe } = ctx.viewer.scene
    const { width, height } = zoomCanvas

    const center = cam.pickEllipsoid(
      new Cesium.Cartesian2(width / 2, height / 2),
      globe.ellipsoid,
    )

    if (Cesium.defined(center)) {
      const direction = Cesium.Cartesian3.subtract(cam.position, center!, new Cesium.Cartesian3())
      const distance = Cesium.Cartesian3.magnitude(direction)
      const newDistance = Cesium.Math.clamp(distance * zoomFactor, 100, 20000000)
      const normalized = Cesium.Cartesian3.normalize(direction, new Cesium.Cartesian3())
      const offset = Cesium.Cartesian3.multiplyByScalar(normalized, newDistance, new Cesium.Cartesian3())
      cam.position = Cesium.Cartesian3.add(center!, offset, new Cesium.Cartesian3())
      ctx.viewer.scene.requestRender()
    }
  }

  zoomCanvas.addEventListener('wheel', onWheel, { passive: false })
  return () => {
    zoomCanvas.removeEventListener('wheel', onWheel)
  }
}

// ═══════════════════════════════════════════
// 相机状态持久化
// ═══════════════════════════════════════════

let _cameraSaveTimer: ReturnType<typeof setTimeout> | null = null

export function persistCameraState(ctx: CesiumContext) {
  const cam = ctx.viewer.camera
  const cartographic = Cesium.Cartographic.fromCartesian(cam.position)
  const state: CameraState = {
    longitude: Cesium.Math.toDegrees(cartographic.longitude),
    latitude: Cesium.Math.toDegrees(cartographic.latitude),
    height: cartographic.height,
    heading: cam.heading,
    pitch: cam.pitch,
    roll: cam.roll,
  }
  scheduleSave('camera.state', JSON.stringify(state))
}

export function restoreCameraState(ctx: CesiumContext): boolean {
  const raw = getRawSetting('camera.state')
  if (!raw) return false
  try {
    const s: CameraState = JSON.parse(raw)
    if (
      typeof s.longitude !== 'number' || typeof s.latitude !== 'number' ||
      typeof s.height !== 'number' || typeof s.heading !== 'number' ||
      typeof s.pitch !== 'number' || typeof s.roll !== 'number'
    ) return false
    ctx.viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(s.longitude, s.latitude, s.height),
      orientation: { heading: s.heading, pitch: s.pitch, roll: s.roll },
    })
    return true
  } catch {
    return false
  }
}

export function scheduleCameraSave(ctx: CesiumContext) {
  if (_cameraSaveTimer) clearTimeout(_cameraSaveTimer)
  _cameraSaveTimer = setTimeout(() => persistCameraState(ctx), 500)
}

export function flushCameraSave(ctx: CesiumContext) {
  if (_cameraSaveTimer) {
    clearTimeout(_cameraSaveTimer)
    _cameraSaveTimer = null
  }
  persistCameraState(ctx)
}

// ═══════════════════════════════════════════
// 主题背景
// ═══════════════════════════════════════════

export function updateCesiumBackground(ctx: CesiumContext, getThemeVar: (name: string) => string | undefined) {
  const bgHex = getThemeVar('--cesium-bg') || '#1a1a2e'
  const globeHex = getThemeVar('--cesium-globe-base') || '#1a1a2e'
  ctx.viewer.scene.backgroundColor = Cesium.Color.fromCssColorString(bgHex)
  ctx.viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString(globeHex)
  ctx.viewer.scene.requestRender()
}

// ═══════════════════════════════════════════
// 相机控制
// ═══════════════════════════════════════════

export function resetView(ctx: CesiumContext) {
  ctx.viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(110, 25, 12000000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    duration: 1.0,
  })
}

export function flyToTrack(ctx: CesiumContext, track: Track) {
  if (track.positions.length === 0) return
  const last = track.positions[track.positions.length - 1]
  ctx.viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(last.longitude, last.latitude, FLAT_ALTITUDE + 8000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
    duration: 1.5,
  })
}

export function flyToFlag(ctx: CesiumContext, flag: Flag) {
  ctx.viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(flag.longitude, flag.latitude, 50000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    duration: 1.0,
  })
}

// ═══════════════════════════════════════════
// 瓦片图层切换
// ═══════════════════════════════════════════

export function switchTileLayer(ctx: CesiumContext, maxZoom?: number) {
  const maxLevel = maxZoom ?? 8
  if (ctx.currentImageryLayer) {
    ctx.viewer.imageryLayers.remove(ctx.currentImageryLayer, true)
    ctx.currentImageryLayer = null
  }
  ctx.currentImageryLayer = ctx.viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: `http://127.0.0.1:${ctx.tileServerPort}/tiles/{z}/{x}/{y}.png`,
      minimumLevel: 0,
      maximumLevel: maxLevel,
      tileWidth: 256,
      tileHeight: 256,
    }),
  )
  ctx.viewer.scene.requestRender()
}

// ═══════════════════════════════════════════
// 相机高度查询
// ═══════════════════════════════════════════

export function currentCameraHeight(ctx: CesiumContext) {
  return ctx.viewer.camera.positionCartographic.height
}

export {
  type CameraState,
}
