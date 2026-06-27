/**
 * src/cesium/cityRenderer.ts — 城市标注层 PointPrimitive / Label 渲染
 *
 * 负责：
 * 1. 城市 GeoJSON 加载与解析
 * 2. LOD 增量渲染（持久化集合 + diff 增删，无闪烁）
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

/** 持久化的城市 PointPrimitiveCollection（点每次全量重建，集合引用保持） */
let cityPointCollection: Cesium.PointPrimitiveCollection | undefined

/** 持久化的城市 LabelCollection（标签增量更新，复用集合） */
let cityLabelCollection: Cesium.LabelCollection | undefined

/** 已解析的城市要素 */
let cityFeatures: CityFeature[] = []

/** pick ID → CityFeature 映射（点/标签每次渲染重建） */
const cityPickMap = new Map<string, CityFeature>()

/** 活跃标签追踪：cityId → { label, city }，用于增量更新 */
interface ActiveLabelEntry {
  label: Cesium.Label
  city: CityFeature
}
const activeLabels = new Map<string, ActiveLabelEntry>()

/** 城市悬停标签 Entity */
let cityHoverEntity: Cesium.Entity | undefined

/** 城市层 debounce 计时器 */
let cityLayerDebounce: ReturnType<typeof setTimeout> | null = null

/** 存储最近一次传入的 cityLayer 状态，供 debounced render 使用 */
let _lastCityState: CityLayerState | null = null


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
  _lastCityState = null
  _cached2DHeight = 0
  _cached2DHeightValid = false
  _cacheInitDone = false
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

// ── 2D computeViewRectangle 缓存（该调用很昂贵，鼠标移动/城市渲染高频触发） ──
let _cached2DHeight = 0
let _cached2DHeightValid = false
let _cacheInitDone = false

/** 在 init 时注册 postRender 钩子，每帧开始时使缓存失效 */
function ensure2DCacheListener() {
  if (_cacheInitDone || !ctx?.viewer) return
  _cacheInitDone = true
  ctx.viewer.scene.postRender.addEventListener(() => {
    _cached2DHeightValid = false
  })
}

export function currentCameraHeight() {
  if (!ctx?.viewer) return Number.POSITIVE_INFINITY
  const h = ctx.viewer.camera.positionCartographic.height
  // 2D 正交投影的相机高度数值远小于 3D 等效视野高度，导致城市 LOD 阈值全部失效（所有城市被渲染）。
  // 通过可视矩形对角线长度估算 3D 等效高度，恢复正确的 LOD 行为。
  // computeViewRectangle 是昂贵调用 → 同一帧内复用缓存，每帧开始时自动失效。
  if (ctx.viewer.scene.mode === Cesium.SceneMode.SCENE2D) {
    ensure2DCacheListener()
    if (_cached2DHeightValid && _cached2DHeight > 0) {
      return _cached2DHeight
    }
    const rect = ctx.viewer.camera.computeViewRectangle(ctx.viewer.scene.globe.ellipsoid)
    if (rect) {
      const centerLat = (Cesium.Math.toDegrees(rect.north) + Cesium.Math.toDegrees(rect.south)) / 2
      const dLon = (Cesium.Math.toDegrees(rect.east) - Cesium.Math.toDegrees(rect.west)) * 111_320 * Math.cos(centerLat * Math.PI / 180)
      const dLat = (Cesium.Math.toDegrees(rect.north) - Cesium.Math.toDegrees(rect.south)) * 111_320
      _cached2DHeight = Math.sqrt(dLon * dLon + dLat * dLat)
      _cached2DHeightValid = true
      return _cached2DHeight
    }
  }
  return h
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

  const cameraHeightKm = Math.max(0, currentCameraHeight() / 1000)
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
  if (!ctx?.viewer) {
    cityPointCollection = undefined
    cityLabelCollection = undefined
    cityPickMap.clear()
    activeLabels.clear()
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
  activeLabels.clear()
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

export function scheduleCityLayerRender(delay = 120, state?: CityLayerState) {
  if (state) _lastCityState = state
  if (cityLayerDebounce) clearTimeout(cityLayerDebounce)
  cityLayerDebounce = setTimeout(() => {
    cityLayerDebounce = null
    if (_lastCityState) renderCityLayer(_lastCityState)
  }, delay)
}

export function cancelCityLayerDebounce() {
  if (cityLayerDebounce) {
    clearTimeout(cityLayerDebounce)
    cityLayerDebounce = null
  }
}

// ═══════════════════════════════════════════
// 主渲染（增量 diff）
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

  // ═══════════════════════════════════════
  // POINTS — 全量重建（PointPrimitiveCollection 不支持可靠的单体 remove）
  // ═══════════════════════════════════════

  const newPoints = new Cesium.PointPrimitiveCollection()

  for (const city of cities) {
    if (height > cityPointMaxHeight(city.level, state.lod)) continue

    const position = Cesium.Cartesian3.fromDegrees(city.longitude, city.latitude, 1200)
    if (!isFrontSidePosition(position)) continue

    const id = cityPickId(city)
    const pSize = cityPointSize(city, state.pointSize)
    cityPickMap.set(id, city)

    newPoints.add({
      id,
      position,
      pixelSize: pSize,
      color: pointColor,
      outlineColor: Cesium.Color.BLACK.withAlpha(0.75),
      outlineWidth: 1,
    })
  }

  // 原子替换：先移除旧的再添加新的
  const oldPoints = cityPointCollection
  if (oldPoints) ctx.viewer.scene.primitives.remove(oldPoints)
  ctx.viewer.scene.primitives.add(newPoints)
  cityPointCollection = newPoints
  // 延迟一帧销毁旧集合
  if (oldPoints) {
    const cleanup = () => {
      ctx!.viewer.scene.preRender.removeEventListener(cleanup)
      if (!oldPoints.isDestroyed()) oldPoints.destroy()
    }
    ctx.viewer.scene.preRender.addEventListener(cleanup)
  }

  // ═══════════════════════════════════════
  // LABELS — 增量更新（LabelCollection.remove 可正常工作）
  // ═══════════════════════════════════════

  if (!cityLabelCollection) {
    cityLabelCollection = new Cesium.LabelCollection()
    ctx.viewer.scene.primitives.add(cityLabelCollection)
  }

  const shouldHaveLabel = new Set<string>()

  for (const city of cities) {
    if (!state.labels || height > cityLabelMaxHeight(city.level, state.lod)) continue

    const position = Cesium.Cartesian3.fromDegrees(city.longitude, city.latitude, 1200)
    if (!isFrontSidePosition(position)) continue

    const window = Cesium.SceneTransforms.worldToWindowCoordinates(ctx.viewer.scene, position)
    if (
      !window ||
      window.x < -120 || window.y < -80 ||
      window.x > canvas.clientWidth + 120 || window.y > canvas.clientHeight + 80
    ) continue

    const id = cityPickId(city)
    shouldHaveLabel.add(id)
    cityPickMap.set(id, city)

    const existing = activeLabels.get(id)
    const pSize = cityPointSize(city, state.pointSize)

    if (existing) {
      // 已有 → 更新外观
      existing.label.position = position
      existing.label.text = city.nameZh
      existing.label.font = `${isAdministrativeCity(city) ? state.fontSize + 1 : state.fontSize}px sans-serif`
      existing.label.fillColor = labelColor
      existing.label.outlineColor = Cesium.Color.BLACK.withAlpha(0.85)
      existing.label.pixelOffset = new Cesium.Cartesian2(pSize + 4, 0)
    } else {
      // 新增
      const label = cityLabelCollection.add({
        id,
        position,
        text: city.nameZh,
        font: `${isAdministrativeCity(city) ? state.fontSize + 1 : state.fontSize}px sans-serif`,
        fillColor: labelColor,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        pixelOffset: new Cesium.Cartesian2(pSize + 4, 0),
      })
      activeLabels.set(id, { label, city })
    }
  }

  // 移除不再需要的标签
  for (const [id, entry] of activeLabels) {
    if (!shouldHaveLabel.has(id)) {
      cityLabelCollection.remove(entry.label)
      activeLabels.delete(id)
    }
  }

  ctx.viewer.scene.requestRender()
}
