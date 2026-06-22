/**
 * src/cesium/types.ts — 共享类型定义与渲染常量
 *
 * 所有 Cesium 渲染模块共享的类型、接口和常量集中在此文件。
 * 这些类型不依赖 Vue 响应式系统，纯数据描述。
 */

import type * as Cesium from 'cesium'
import type { BoundaryLayerKey } from '../composables/useBoundaryLayers'
import type { CityLevel } from '../composables/useCityLayer'

// ═══════════════════════════════════════════
// 城市要素
// ═══════════════════════════════════════════

export interface CityFeature {
  id: string
  nameZh: string
  nameEn: string
  country: string
  population: number
  rank: number
  level: CityLevel
  featureCode: string
  capital: boolean
  longitude: number
  latitude: number
}

// ═══════════════════════════════════════════
// 航迹渲染实体集合
// ═══════════════════════════════════════════

export interface TrackEntities {
  /** Entity API polyline — stored in viewer.entities for full picking/interaction support */
  entity: Cesium.Entity | undefined
  /** P2: PolylineCollection polyline for replay trail ONLY — hidden during non-replay */
  trailLine: Cesium.Polyline | undefined
  /** P1: Label in LabelCollection — GPU-instanced, one draw call for all labels */
  label: Cesium.Label | undefined
  /** P1: PointPrimitive for endpoint dot */
  pointPrimitive: Cesium.PointPrimitive | undefined
  source: string
  labelText: string
  /** Mutable holder for full track positions — used to restore after replay */
  trailRef: { positions: Cesium.Cartesian3[] }
  /** Current trail positions during replay (incrementally built) */
  trailPositions: Cesium.Cartesian3[]
  /** Last lo index from binary search — replay trail only updated when this advances */
  lastTrailLo: number
  /** 预转换的 Cartesian3 坐标缓存（仅在 syncEntities 时转换一次，回放时直接复用） */
  cachedPositions: Cesium.Cartesian3[]
}

// ═══════════════════════════════════════════
// 相机状态
// ═══════════════════════════════════════════

export interface CameraState {
  longitude: number
  latitude: number
  height: number
  heading: number
  pitch: number
  roll: number
}

// ═══════════════════════════════════════════
// Cesium 渲染上下文
// ═══════════════════════════════════════════

/**
 * 聚合所有 Cesium 渲染相关的核心对象。
 * 由 viewerCore 创建，各渲染模块通过此对象访问 Cesium 资源。
 */
export interface CesiumContext {
  viewer: Cesium.Viewer
  trackLines: Cesium.PolylineCollection
  hoverOverlayLines: Cesium.PolylineCollection
  activeOverlayLine: Cesium.Polyline | null
  pointPrimitives: Cesium.PointPrimitiveCollection
  trackLabels: Cesium.LabelCollection
  pointDotsCollection: Cesium.PointPrimitiveCollection
  currentImageryLayer: Cesium.ImageryLayer | null
  tileServerPort: number
  fpsSmoothed: number
}

// ═══════════════════════════════════════════
// 渲染常量
// ═══════════════════════════════════════════

/** 边界层海拔高度（米），略高于椭球面防 Z-fighting */
export const BOUNDARY_ALTITUDE = 50

/** Douglas-Peucker 简化容差（度），~0.01° ≈ 1km */
export const SIMPLIFY_TOLERANCE = 0.01

/** 所有航迹渲染的统一 WGS84 海拔高度（米）。
 *  真实数据中的高度仅用于标签/悬停提示，不影响渲染。 */
export const FLAT_ALTITUDE = 10000

/** 悬停高亮覆盖层高度 — 比所有航迹高 1500m，确保深度测试始终获胜 */
export const HOVER_OVERLAY_ALTITUDE = FLAT_ALTITUDE + 1500

// 端点圆点缩放系数（Billboard，基础画布 24px，圆半径 ≈ 10px）
export const DOT_BASE = 0.7
export const DOT_RAW = 0.4
export const DOT_SELECTED = 1.2
export const DOT_HOVER = 1.3

/** P1: PointPrimitive 像素大小基准值 */
export const POINT_PRIMITIVE_BASE = 12

// 航迹线透明度
export const NORMAL_ALPHA = 0.88
export const RAW_ALPHA = 0.75
export const SELECTED_WIDTH = 4.0
export const SELECTED_ALPHA = 1.0

// 悬停高亮
export const HOVER_WIDTH = 5.0

// 标签字体
export const LABEL_FONT_BASE = '12px sans-serif'
export const LABEL_FONT_LARGE = '18px sans-serif'

// ═══════════════════════════════════════════
// 边界层配置
// ═══════════════════════════════════════════

export interface BoundaryLayerConfig {
  key: BoundaryLayerKey
  url: string
  stroke: string
  alpha: number
}

export const BOUNDARY_LAYERS: readonly BoundaryLayerConfig[] = [
  {
    key: 'coastline',
    url: '/boundaries/coastline.geojson',
    stroke: '#000000',
    alpha: 0.7,
  },
  {
    key: 'admin1',
    url: '/boundaries/admin1.geojson',
    stroke: '#77808f',
    alpha: 0.55,
  },
  {
    key: 'admin0',
    url: '/boundaries/admin0.geojson',
    stroke: '#d8dee9',
    alpha: 0.85,
  },
] as const

// ═══════════════════════════════════════════
// 重导出常用外部类型
// ═══════════════════════════════════════════

export type { DataSource, TrackPoint } from '../types/track'
export type { BoundaryLayerKey } from '../composables/useBoundaryLayers'
export type { CityLevel } from '../composables/useCityLayer'
export type { Flag } from '../composables/useFlags'
