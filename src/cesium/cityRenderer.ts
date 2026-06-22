/**
 * src/cesium/cityRenderer.ts — 城市标注层 PointPrimitive / Label 渲染
 *
 * 负责：
 * 1. 城市 GeoJSON 加载与解析
 * 2. LOD 多级渲染（双缓冲原子交换，无闪烁）
 * 3. 悬停标签管理
 *
 * 使用方式：在 onMounted 中调用 init(ctx)，之后即可使用所有函数。
 * 城市层状态来自 useCityLayer() composable。
 */

import * as Cesium from 'cesium'
import type { CityLevel } from '../composables/useCityLayer'
import { type CesiumContext, type CityFeature } from './types'

// ═══════════════════════════════════════════
// 模块级状态
// ═══════════════════════════════════════════

let ctx: CesiumContext | null = null

/** 当前活跃的城市 PointPrimitiveCollection */
let cityPointCollection: Cesium.PointPrimitiveCollection | undefined

/** 当前活跃的城市 LabelCollection */
let cityLabelCollection: Cesium.LabelCollection | undefined

/** 已解析的城市要素 */
let cityFeatures: CityFeature[] = []

/** pick ID → CityFeature 映射 */
const cityPickMap = new Map<string, CityFeature>()

/** 城市悬停标签 Entity */
let cityHoverEntity: Cesium.Entity | undefined

/** 延迟清理回调（双缓冲旧集合移除） */
let pendingCityCleanup: (() => void) | null = null
let pendingOldCityPoints: Cesium.PointPrimitiveCollection | null = null
let pendingOldCityLabels: Cesium.LabelCollection | null = null

/** 城市层 debounce 计时器 */
let cityLayerDebounce: ReturnType<typeof setTimeout> | null = null

/** 上次城市层渲染时的相机高度（LOD 阈值追踪） */
let lastCityRenderHeight = 0

// ═══════════════════════════════════════════
// 初始化
// ═══════════════════════════════════════════

export function init(context: CesiumContext) {
  ctx = context
}

export function reset() {
  clearCityLayer()
  cityHoverEntity = undefined
  cityFeatures = []
  cityPickMap.clear()
  if (cityLayerDebounce) {
    clearTimeout(cityLayerDebounce)
    cityLayerDebounce = null
  }
  lastCityRenderHeight = 0
  ctx = null
}

// ═══════════════════════════════════════════
// 公开访问器
// ═══════════════════════════════════════════

export function getCityFeatures(): readonly CityFeature[] {
  return cityFeatures
}

export function getCityPickMap(): ReadonlyMap<string, CityFeature> {
  return cityPickMap
}

export function getLastCityRenderHeight(): number {
  return lastCityRenderHeight
}

export function setLastCityRenderHeight(h: number) {
  lastCityRenderHeight = h
}

// ═══════════════════════════════════════════
// 城市层级工具（纯函数）
// ═══════════════════════════════════════════

export function normalizeCityLevel(level: unknown, featureCode: unknown, capital: boolean): CityLevel {
  if (level === 'capital' || level === 'regional' || level === 'prefecture' || level === 'major') {
    return level
  }
  if (capital || featureCode === 'PPLC') return 'capital'
  if (featureCode === 'PPLA') return 'regional'
  if (featureCode === 'PPLA2') return 'prefecture'
  return 'major'
}

export function cityLevelRank(level: CityLevel) {
  switch (level) {
    case 'capital': return 0
    case 'regional': return 1
    case 'prefecture': return 2
    case 'major': return 3
    default: return 9
  }
}

export function cityPointMaxHeight(level: CityLevel, lod: { pointMaxHeight: Record<string, number> }) {
  switch (level) {
    case 'capital': return Number.POSITIVE_INFINITY
    case 'regional': return lod.pointMaxHeight.regional
    case 'prefecture': return lod.pointMaxHeight.prefecture
    case 'major': return lod.pointMaxHeight.major
  }
}

export function cityLabelMaxHeight(level: CityLevel, lod: { labelMaxHeight: Record<string, number> }) {
  switch (level) {
    case 'capital': return Number.POSITIVE_INFINITY
    case 'regional': return lod.labelMaxHeight.regional
    case 'prefecture': return lod.labelMaxHeight.prefecture
    case 'major': return lod.labelMaxHeight.major
  }
}

export function maxCityLabelsForHeight(height: number) {
  if (height > 12_000_000) return 80
  if (height > 6_000_000) return 140
  if (height > 2_000_000) return 220
  if (height > 800_000) return 340
  return 520
}

export function cityLabelGridSize(height: number) {
  if (height > 12_000_000) return { width: 120, height: 54 }
  if (height > 6_000_000) return { width: 104, height: 48 }
  if (height > 2_000_000) return { width: 92, height: 42 }
  if (height > 800_000) return { width: 82, height: 36 }
  return { width: 72, height: 32 }
}

export function shouldAvoidCityLabels(height: number) {
  return height > 800_000
}

export function cityPickId(city: CityFeature) {
  return `city::${city.id}`
}

export function cityPointSize(city: CityFeature, pointSize: number) {
  return city.level === 'capital'
    ? pointSize + 2
    : city.level === 'regional'
      ? pointSize + 1
      : pointSize
}

export function isAdministrativeCity(city: CityFeature) {
  return city.level === 'capital' || city.level === 'regional' || city.level === 'prefecture'
}

// ═══════════════════════════════════════════
// 相机工具
// ═══════════════════════════════════════════

export function currentCameraHeight() {
  if (!ctx?.viewer) return Number.POSITIVE_INFINITY
  return ctx.viewer.camera.positionCartographic.height
}

export function isFrontSidePosition(position: Cesium.Cartesian3) {
  if (!ctx?.viewer) return true
  const pointNormal = Cesium.Cartesian3.normalize(position, new Cesium.Cartesian3())
  const cameraNormal = Cesium.Cartesian3.normalize(ctx.viewer.camera.positionWC, new Cesium.Cartesian3())
  return Cesium.Cartesian3.dot(pointNormal, cameraNormal) > -0.04
}

export interface ViewStatus {
  cameraHeightKm: number
  longitude: number
  latitude: number
  fps: number
}

export function getViewStatus(screenPosition?: Cesium.Cartesian2 | null): ViewStatus | null {
  if (!ctx?.viewer || ctx.viewer.isDestroyed()) return null

  const cameraHeightKm = Math.max(0, ctx.viewer.camera.positionCartographic.height / 1000)
  let longitude = 0
  let latitude = 0

  if (screenPosition) {
    const cartesian = ctx.viewer.camera.pickEllipsoid(screenPosition, ctx.viewer.scene.globe.ellipsoid)
    if (Cesium.defined(cartesian)) {
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian)
      longitude = Cesium.Math.toDegrees(cartographic.longitude)
      latitude = Cesium.Math.toDegrees(cartographic.latitude)
    }
  }

  return { cameraHeightKm, longitude, latitude, fps: Math.round(ctx.fpsSmoothed) }
}

// ═══════════════════════════════════════════
// 城市数据加载
// ═══════════════════════════════════════════

export async function loadCityLayer() {
  if (!ctx?.viewer) return
  try {
    const response = await fetch('/cities/cities.geojson')
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const geojson = await response.json()
    const features = Array.isArray(geojson.features) ? geojson.features : []
    cityFeatures = features
      .map((feature: any): CityFeature | null => {
        const coords = feature?.geometry?.coordinates
        const props = feature?.properties ?? {}
        if (!Array.isArray(coords) || coords.length < 2) return null
        const longitude = Number(coords[0])
        const latitude = Number(coords[1])
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null
        return {
          id: String(props.id || props.geoname_id || `${longitude},${latitude},${props.name_en || props.name_zh || ''}`),
          nameZh: String(props.name_zh || props.name_en || ''),
          nameEn: String(props.name_en || props.name_zh || ''),
          country: String(props.country || ''),
          population: Number(props.population || 0),
          rank: Number(props.rank || 99),
          level: normalizeCityLevel(props.level, props.feature_code, Boolean(props.capital)),
          featureCode: String(props.feature_code || ''),
          capital: Boolean(props.capital),
          longitude,
          latitude,
        }
      })
      .filter((city: CityFeature | null): city is CityFeature => city !== null && city.nameZh.length > 0)

  } catch (e) {
    console.warn('[cities] failed to load city layer:', e)
  }
}

export function clearCityLayer() {
  // Cancel any pending deferred cleanup
  if (pendingCityCleanup && ctx?.viewer) {
    ctx.viewer.scene.preRender.removeEventListener(pendingCityCleanup)
    pendingCityCleanup = null
  }
  if (!ctx?.viewer) {
    cityPointCollection = undefined
    cityLabelCollection = undefined
    cityPickMap.clear()
    return
  }
  if (cityPointCollection) {
    ctx.viewer.scene.primitives.remove(cityPointCollection)
    if (!cityPointCollection.isDestroyed()) cityPointCollection.destroy()
    cityPointCollection = undefined
  }
  if (cityLabelCollection) {
    ctx.viewer.scene.primitives.remove(cityLabelCollection)
    if (!cityLabelCollection.isDestroyed()) cityLabelCollection.destroy()
    cityLabelCollection = undefined
  }
  cityPickMap.clear()
}

// ═══════════════════════════════════════════
// 城市层配置接口
// ═══════════════════════════════════════════

/** cityLayer 响应式状态的子集（renderCityLayer 需要访问的字段） */
export interface CityLayerState {
  visible: boolean
  labels: boolean
  minPopulation: number
  levels: Record<CityLevel, boolean>
  lod: {
    pointMaxHeight: Record<string, number>
    labelMaxHeight: Record<string, number>
  }
  pointSize: number
  fontSize: number
  color: string
  labelColor: string
}

/** 过滤出符合条件的城市 */
export function enabledCities(state: CityLayerState) {
  return cityFeatures.filter(city => {
    if (!state.levels[city.level]) return false
    return city.level !== 'major' || city.population >= state.minPopulation
  })
}

// ═══════════════════════════════════════════
// 悬停标签
// ═══════════════════════════════════════════

export function showCityHover(city: CityFeature, state: CityLayerState) {
  if (!ctx?.viewer || !state.visible) return
  const position = Cesium.Cartesian3.fromDegrees(city.longitude, city.latitude, 1800)
  if (!cityHoverEntity) {
    cityHoverEntity = ctx.viewer.entities.add({
      id: 'city-hover-label',
      position,
      label: {
        text: city.nameZh,
        font: `${state.fontSize + 2}px sans-serif`,
        fillColor: Cesium.Color.fromCssColorString(state.labelColor).withAlpha(1),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.9),
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        pixelOffset: new Cesium.Cartesian2(state.pointSize + 10, 0),
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.58),
        backgroundPadding: new Cesium.Cartesian2(6, 4),
      },
    })
  } else {
    cityHoverEntity.show = true
    ;(cityHoverEntity.position as any) = position
    if (cityHoverEntity.label) {
      cityHoverEntity.label.text = new Cesium.ConstantProperty(city.nameZh)
      cityHoverEntity.label.font = new Cesium.ConstantProperty(`${state.fontSize + 2}px sans-serif`)
      cityHoverEntity.label.fillColor = new Cesium.ConstantProperty(Cesium.Color.fromCssColorString(state.labelColor).withAlpha(1))
      cityHoverEntity.label.pixelOffset = new Cesium.ConstantProperty(new Cesium.Cartesian2(state.pointSize + 10, 0))
    }
  }
}

export function hideCityHover() {
  if (cityHoverEntity) cityHoverEntity.show = false
}

export function removeCityHover() {
  if (ctx?.viewer && cityHoverEntity) {
    ctx.viewer.entities.remove(cityHoverEntity)
  }
  cityHoverEntity = undefined
}

export function pickedCity(picked: any): CityFeature | null {
  const id = typeof picked?.id === 'string'
    ? picked.id
    : picked?.id instanceof Cesium.Entity
      ? picked.id.id
      : undefined
  if (typeof id !== 'string' || !id.startsWith('city::')) return null
  return cityPickMap.get(id) ?? null
}

// ═══════════════════════════════════════════
// 调度
// ═══════════════════════════════════════════

/** 存储最近一次传入的 cityLayer 状态，供 debounced render 使用 */
let _lastCityState: CityLayerState | null = null

export function scheduleCityLayerRender(delay = 120, state?: CityLayerState) {
  if (state) _lastCityState = state
  if (cityLayerDebounce) clearTimeout(cityLayerDebounce)
  cityLayerDebounce = setTimeout(() => {
    cityLayerDebounce = null
    if (_lastCityState) renderCityLayer(_lastCityState)
  }, delay)
}

/** 暴露底层 debounce 引用供外部 cancel */
export function cancelCityLayerDebounce() {
  if (cityLayerDebounce) {
    clearTimeout(cityLayerDebounce)
    cityLayerDebounce = null
  }
}

// ═══════════════════════════════════════════
// 主渲染
// ═══════════════════════════════════════════

export function renderCityLayer(state: CityLayerState) {
  if (!ctx?.viewer) return
  if (!state.visible || cityFeatures.length === 0) {
    clearCityLayer()
    hideCityHover()
    ctx.viewer.scene.requestRender()
    return
  }

  const pointColor = Cesium.Color.fromCssColorString(state.color).withAlpha(0.95)
  const labelColor = Cesium.Color.fromCssColorString(state.labelColor).withAlpha(0.95)
  const height = currentCameraHeight()
  const cities = enabledCities(state)
  const canvas = ctx.viewer.scene.canvas

  // Double-buffer: build new collections first, then swap in atomically
  const newPoints = new Cesium.PointPrimitiveCollection()
  const newLabels = new Cesium.LabelCollection()

  const labelCandidates: Array<{
    city: CityFeature
    position: Cesium.Cartesian3
    window: Cesium.Cartesian2
    pointSize: number
  }> = []

  for (const city of cities) {
    const showPoint = height <= cityPointMaxHeight(city.level, state.lod)
    const showLabel = state.labels && height <= cityLabelMaxHeight(city.level, state.lod)
    if (!showPoint && !showLabel) continue

    const position = Cesium.Cartesian3.fromDegrees(city.longitude, city.latitude, 1200)
    if (!isFrontSidePosition(position)) continue

    const pSize = cityPointSize(city, state.pointSize)
    const id = cityPickId(city)
    cityPickMap.set(id, city)

    if (showPoint) {
      newPoints.add({
        id,
        position,
        pixelSize: pSize,
        color: pointColor,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.75),
        outlineWidth: 1,
      })
    }

    if (showLabel) {
      const window = Cesium.SceneTransforms.worldToWindowCoordinates(ctx.viewer.scene, position)
      if (
        window &&
        window.x >= -120 &&
        window.y >= -80 &&
        window.x <= canvas.clientWidth + 120 &&
        window.y <= canvas.clientHeight + 80
      ) {
        labelCandidates.push({ city, position, window, pointSize: pSize })
      }
    }
  }

  labelCandidates.sort((a, b) =>
    cityLevelRank(a.city.level) - cityLevelRank(b.city.level) ||
    b.city.population - a.city.population ||
    a.city.nameEn.localeCompare(b.city.nameEn),
  )

  const avoidLabels = shouldAvoidCityLabels(height)
  const grid = cityLabelGridSize(height)
  const occupied = new Set<string>()
  const maxLabels = avoidLabels ? maxCityLabelsForHeight(height) : Number.POSITIVE_INFINITY
  let labelCount = 0

  for (const item of labelCandidates) {
    if (labelCount >= maxLabels) break
    if (avoidLabels) {
      const key = `${Math.floor(item.window.x / grid.width)}:${Math.floor(item.window.y / grid.height)}`
      if (occupied.has(key)) continue
      occupied.add(key)
    }
    labelCount++

    const id = cityPickId(item.city)
    cityPickMap.set(id, item.city)
    newLabels.add({
      id,
      position: item.position,
      text: item.city.nameZh,
      font: `${isAdministrativeCity(item.city) ? state.fontSize + 1 : state.fontSize}px sans-serif`,
      fillColor: labelColor,
      outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      pixelOffset: new Cesium.Cartesian2(item.pointSize + 4, 0),
    })
  }

  // Atomically swap: add new collections first
  const oldPoints = cityPointCollection
  const oldLabels = cityLabelCollection
  ctx.viewer.scene.primitives.add(newPoints)
  ctx.viewer.scene.primitives.add(newLabels)
  cityPointCollection = newPoints
  cityLabelCollection = newLabels

  // Cancel any pending cleanup from a previous swap
  if (pendingCityCleanup) {
    ctx.viewer.scene.preRender.removeEventListener(pendingCityCleanup)
    pendingCityCleanup = null
    if (pendingOldCityPoints) {
      ctx.viewer.scene.primitives.remove(pendingOldCityPoints)
      if (!pendingOldCityPoints.isDestroyed()) pendingOldCityPoints.destroy()
      pendingOldCityPoints = null
    }
    if (pendingOldCityLabels) {
      ctx.viewer.scene.primitives.remove(pendingOldCityLabels)
      if (!pendingOldCityLabels.isDestroyed()) pendingOldCityLabels.destroy()
      pendingOldCityLabels = null
    }
  }

  // Delay removal of old collections by one preRender frame
  if (oldPoints || oldLabels) {
    pendingOldCityPoints = oldPoints ?? null
    pendingOldCityLabels = oldLabels ?? null
    const cleanup = () => {
      ctx!.viewer.scene.preRender.removeEventListener(cleanup)
      pendingCityCleanup = null
      if (oldPoints) {
        ctx!.viewer.scene.primitives.remove(oldPoints)
        if (!oldPoints.isDestroyed()) oldPoints.destroy()
      }
      if (oldLabels) {
        ctx!.viewer.scene.primitives.remove(oldLabels)
        if (!oldLabels.isDestroyed()) oldLabels.destroy()
      }
      pendingOldCityPoints = null
      pendingOldCityLabels = null
      ctx!.viewer.scene.requestRender()
    }
    pendingCityCleanup = cleanup
    ctx.viewer.scene.preRender.addEventListener(cleanup)
  }

  ctx.viewer.scene.requestRender()
}
