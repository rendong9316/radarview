<template>
  <div class="cesium-container" ref="containerRef">
    <!-- 右键上下文菜单 -->
    <div
      v-if="contextMenu.visible"
      class="context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      @click.stop
    >
      <template v-if="contextMenu.type === 'flag'">
        <div class="context-menu-item" @click="handleContextRename"><Pencil :size="13" /> 重命名</div>
        <div class="context-menu-item context-menu-has-sub" @click.stop>
          <FlagIcon :size="13" /> 切换样式 <span class="submenu-arrow">▸</span>
          <div class="submenu-dropdown">
            <div class="submenu-item" :class="{ active: getFlagStyle(contextMenu.flagId) === 'flag-pin' }" @click="handleChangeFlagStyle('flag-pin')">图钉</div>
            <div class="submenu-item" :class="{ active: getFlagStyle(contextMenu.flagId) === 'flag-standard' }" @click="handleChangeFlagStyle('flag-standard')">标准旗</div>
            <div class="submenu-item" :class="{ active: getFlagStyle(contextMenu.flagId) === 'flag-triangle-right' }" @click="handleChangeFlagStyle('flag-triangle-right')">三角旗</div>
            <div class="submenu-item" :class="{ active: getFlagStyle(contextMenu.flagId) === 'square-flag' }" @click="handleChangeFlagStyle('square-flag')">方旗</div>
            <div class="submenu-item" :class="{ active: getFlagStyle(contextMenu.flagId) === 'diamond' }" @click="handleChangeFlagStyle('diamond')">菱形</div>
            <div class="submenu-item" :class="{ active: getFlagStyle(contextMenu.flagId) === 'circle' }" @click="handleChangeFlagStyle('circle')">圆形</div>
          </div>
        </div>
        <div class="context-menu-item context-menu-danger" @click="handleContextDelete"><Trash2 :size="13" /> 删除</div>
      </template>
      <template v-else-if="contextMenu.type === 'track'">
        <div
          v-if="!isTrackShowingDots(contextMenu.trackId)"
          class="context-menu-item"
          @click="handleContextShowPointDots"
        ><Dot :size="13" /> 显示所有对应点迹</div>
        <div
          v-else
          class="context-menu-item"
          @click="handleContextHidePointDots"
        ><Circle :size="13" /> 隐藏所有对应点迹</div>
        <div
          class="context-menu-item"
          @click="handleContextShowDetail"
        ><FileText :size="13" /> 详细信息</div>
        <div
          class="context-menu-item"
          @click="handleContextViewPoints"
        ><ClipboardList :size="13" /> 查看点迹数据</div>
        <div
          class="context-menu-item context-menu-danger"
          @click="handleContextDeleteTrack"
        ><Trash2 :size="13" /> 删除该航迹</div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import * as Cesium from 'cesium'
import { invoke } from '@tauri-apps/api/core'
import type { Track, TrackPoint, DataSource } from '../types/track'
import { useLineColor } from '../composables/useLineColor'
import { useLayerVisibility } from '../composables/useLayerVisibility'
import { useLabelVisibility } from '../composables/useLabelVisibility'
import { useFlags } from '../composables/useFlags'
import { useFlagScale } from '../composables/useFlagScale'
import { useTrackHighlight } from '../composables/useTrackHighlight'
import { useTrackPointDots } from '../composables/useTrackPointDots'
import { useTheme } from '../composables/useTheme'
import { useBoundaryLayers, type BoundaryLayerKey } from '../composables/useBoundaryLayers'
import { useCityLayer, type CityLevel } from '../composables/useCityLayer'
import { trackKey } from '../composables/useTracks'
import { scheduleSave, getRawSetting, whenSettingsLoaded } from '../composables/useSettingsPersistence'
import { Pencil, Trash2, Dot, Circle, FileText, ClipboardList, Flag as FlagIcon } from '@lucide/vue'
import type { Flag } from '../composables/useFlags'

const props = defineProps<{
  tracks: Track[]
  replayTime: number | null
  selectedId: string | null
  lineWidths: Record<DataSource, number>
  dotScale: Record<DataSource, number>
}>()

const emit = defineEmits<{
  'track-pick': [trackId: string | null]
  'show-track-detail': [payload: { icao: string; source: string }]
  'delete-track': [payload: { icao: string; source: string }]
  'view-track-points': [track: Track]
  'view-status': [payload: { cameraHeightKm: number; longitude: number; latitude: number; fps: number }]
}>()

const containerRef = ref<HTMLDivElement>()

let viewer: Cesium.Viewer | null = null
/** P1: PointPrimitiveCollection for fast endpoint dots — one draw call for all track dots */
let pointPrimitives: Cesium.PointPrimitiveCollection | null = null
/** P2: PolylineCollection for fast track lines — one draw call for all track polylines */
let trackLines: Cesium.PolylineCollection | null = null
/** P2: Separate collection for hover/select overlays — avoids MATERIAL_INDEX triggering full VBO rebuild */
let hoverOverlayLines: Cesium.PolylineCollection | null = null
/** Currently active overlay polyline (hover or select) */
let activeOverlayLine: Cesium.Polyline | null = null
/** P1: LabelCollection for track labels — one draw call, replaces Entity.label */
let trackLabels: Cesium.LabelCollection | null = null
/** P3: PointPrimitiveCollection for track point dots — GPU instanced, outlined circles via Cesium public API */
let pointDotsCollection: Cesium.PointPrimitiveCollection | null = null
let currentImageryLayer: Cesium.ImageryLayer | null = null
let tileServerPort = 0
let clickHandler: Cesium.ScreenSpaceEventHandler | null = null
let dblClickHandler: Cesium.ScreenSpaceEventHandler | null = null
let rightClickHandler: Cesium.ScreenSpaceEventHandler | null = null
let moveHandler: Cesium.ScreenSpaceEventHandler | null = null
let pendingClearTimeout: ReturnType<typeof setTimeout> | null = null
// FPS tracking — smoothed via scene.postRender counting
let fpsFrameCount = 0
let fpsLastSampleTime = 0 // 0 = uninitialized, set on first postRender
let fpsSmoothed = 0
// ── 边界层 Primitive（方案D：每层一个 Primitive，替代 PolylineCollection）──
const BOUNDARY_ALTITUDE = 50 // 米，略高于椭球面防 Z-fighting
const SIMPLIFY_TOLERANCE = 0.01 // Douglas-Peucker 简化容差（度），~0.01°≈1km
/** Per-layer Primitive references */
const boundaryPrimitives = new Map<BoundaryLayerKey, Cesium.Primitive>()
/** Per-layer merged ring coordinates [lon, lat][] — cached for rebuild on color/width change */
const boundaryRingCache = new Map<BoundaryLayerKey, number[][][]>()
let cityPointCollection: Cesium.PointPrimitiveCollection | undefined
let cityLabelCollection: Cesium.LabelCollection | undefined
let cityFeatures: CityFeature[] = []
let cityPickMap = new Map<string, CityFeature>()
let cityHoverEntity: Cesium.Entity | undefined
let pointDotHoverEntity: Cesium.Entity | undefined
let hoveredPointDotId: string | null = null
let pendingCityCleanup: (() => void) | null = null // deferred old-collection removal
let removeCityCameraChanged: (() => void) | null = null

// 右键上下文菜单 — 原生事件监听器引用（用于 onUnmounted 清理）
let ctxMenuFn: ((e: MouseEvent) => void) | null = null
let ctxClickOutsideFn: (() => void) | null = null
let ctxKeyFn: ((e: KeyboardEvent) => void) | null = null
let ctxCanvasEl: HTMLCanvasElement | null = null
let statusMouseLeaveFn: (() => void) | null = null
const { getEffectiveHex, lineColors } = useLineColor()

// Deferred promise — resolves when Cesium Viewer + boundary/city layers are fully initialized
let resolveMapReady!: () => void
const mapReadyPromise = new Promise<void>(r => { resolveMapReady = r })

// ── 右键上下文菜单状态 ──
const contextMenu = ref<{
  visible: boolean
  x: number
  y: number
  type: 'flag' | 'track'
  flagId: string
  flagLabel: string
  trackId: string
}>({ visible: false, x: 0, y: 0, type: 'flag', flagId: '', flagLabel: '', trackId: '' })

/** Resolve line/billboard color: custom override > theme default */
function getLineColor(source: DataSource): Cesium.Color {
  return Cesium.Color.fromCssColorString(getEffectiveHex(source))
}

/** Update Cesium scene background and globe base color to match current theme */
function updateCesiumBackground() {
  if (!viewer) return
  const bgHex = getThemeVar('--cesium-bg') || '#1a1a2e'
  const globeHex = getThemeVar('--cesium-globe-base') || '#1a1a2e'
  const bgColor = Cesium.Color.fromCssColorString(bgHex)
  const globeColor = Cesium.Color.fromCssColorString(globeHex)
  viewer.scene.backgroundColor = bgColor
  viewer.scene.globe.baseColor = globeColor
  viewer.scene.requestRender()
}
const { visibility } = useLayerVisibility()
const { showLabels } = useLabelVisibility()
const { flags, addFlag, removeFlag, renameFlag, setFlagStyle, selectedPair } = useFlags()
const { flagScale } = useFlagScale()
const { addHighlight } = useTrackHighlight()
const { trackPointDotScale, showAllPointDots, clearAllCounter, pointDotColors } = useTrackPointDots()
const { activeTheme, getThemeVar } = useTheme()
const { boundaryVisible, boundaryWidths, boundaryColors } = useBoundaryLayers()
const { cityLayer } = useCityLayer()

// ── Track point dots state ──
/** TrackKeys the user has manually chosen to show (multiple tracks supported) */
const manualPointDotsTrackIds = ref(new Set<string>())
/** TrackKeys the user has explicitly hidden in global mode */
const globalHiddenTrackKeys = ref(new Set<string>())
/** Rendered point dots grouped by trackKey → array of PointPrimitive objects */
const pointDotEntityMap = new Map<string, Cesium.PointPrimitive[]>()
/** Point dot pixel size, scaled by trackPointDotScale */
let pointDotPixelSize = 7.0
/** Last visible point dot index during replay, per trackKey. Avoids redundant show updates. */
const pointDotLastLo = new Map<string, number>()

/** Check whether point dots are currently rendered for a given trackKey */
function isTrackShowingDots(trackKey: string): boolean {
  return pointDotEntityMap.has(trackKey)
}

// ═══════════════════════════════════════════
// P3: Point Dot Rendering via Cesium PointPrimitiveCollection
// GPU-instanced, outlined circles, no private WebGL API
// ═══════════════════════════════════════════

/** Pre-allocated scratch Cartesian3 — reused to avoid GC pressure in rebuild loop */
const _scratchCartesian = new Cesium.Cartesian3()
/** Pre-allocated outline color — reused for all point dots */
const _pointDotOutline = Cesium.Color.BLACK.withAlpha(0.85)

/** Create PointPrimitive objects for a single track's positions */
function rebuildPointDotsForTrack(trackId: string) {
  if (!pointDotsCollection || !viewer) return

  // Remove existing dots for this track
  removePointDotsForTrack(trackId)

  const track = props.tracks.find(t => trackKey(t.id, t.source) === trackId)
  if (!track || track.positions.length === 0) return

  const color = Cesium.Color.fromCssColorString(getPointDotColor(track.source))
  const primitives: Cesium.PointPrimitive[] = []

  for (let i = 0; i < track.positions.length; i++) {
    const pos = track.positions[i]
    const lon = Number(pos.longitude)
    const lat = Number(pos.latitude)
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue

    Cesium.Cartesian3.fromDegrees(lon, lat, FLAT_ALTITUDE, undefined, _scratchCartesian)
    const prim = pointDotsCollection.add({
      id: `pointdot::${trackId}::${i}`,
      position: _scratchCartesian,
      pixelSize: pointDotPixelSize,
      color,
      outlineColor: _pointDotOutline,
      outlineWidth: 1,
    })
    primitives.push(prim)
  }

  if (primitives.length > 0) {
    pointDotEntityMap.set(trackId, primitives)
  }
  viewer.scene.requestRender()
}

/** Remove PointPrimitive objects for a single track */
function removePointDotsForTrack(trackId: string) {
  if (!pointDotsCollection) return
  const primitives = pointDotEntityMap.get(trackId)
  if (primitives) {
    for (const prim of primitives) {
      pointDotsCollection.remove(prim)
    }
    pointDotEntityMap.delete(trackId)
  }
}

/** Show point dots for a single track (right-click manual operation) */
function showManualPointDots(trackId: string) {
  const nextManual = new Set(manualPointDotsTrackIds.value)
  nextManual.add(trackId)
  manualPointDotsTrackIds.value = nextManual

  const nextHidden = new Set(globalHiddenTrackKeys.value)
  nextHidden.delete(trackId)
  globalHiddenTrackKeys.value = nextHidden

  rebuildPointDotsForTrack(trackId)
}

/** Hide point dots for a specific track (right-click manual operation) */
function hidePointDotsForTrack(trackId: string) {
  const nextManual = new Set(manualPointDotsTrackIds.value)
  nextManual.delete(trackId)
  manualPointDotsTrackIds.value = nextManual

  if (showAllPointDots.value) {
    const nextHidden = new Set(globalHiddenTrackKeys.value)
    nextHidden.add(trackId)
    globalHiddenTrackKeys.value = nextHidden
  }

  removePointDotsForTrack(trackId)
  viewer?.scene.requestRender()
}

/** Sync global point dots: apply showAllPointDots + manual overrides + hidden list */
function syncGlobalPointDots() {
  if (!viewer || !pointDotsCollection) return

  const activeTracks = new Map(props.tracks.map(t => [trackKey(t.id, t.source), t]))
  const currentKeys = new Set(pointDotEntityMap.keys())

  // Remove dots for tracks that no longer exist or should be hidden
  for (const tKey of currentKeys) {
    if (!activeTracks.has(tKey)) {
      removePointDotsForTrack(tKey)
      continue
    }
    const manual = manualPointDotsTrackIds.value.has(tKey)
    const global = showAllPointDots.value && !globalHiddenTrackKeys.value.has(tKey)
    if (!manual && !global) {
      removePointDotsForTrack(tKey)
    }
  }

  // Add dots for tracks that should be showing but aren't yet
  if (showAllPointDots.value) {
    for (const track of props.tracks) {
      const tKey = trackKey(track.id, track.source)
      if (globalHiddenTrackKeys.value.has(tKey)) continue
      if (pointDotEntityMap.has(tKey)) continue
      rebuildPointDotsForTrack(tKey)
    }
  }

  viewer.scene.requestRender()
}

/** Remove all rendered point dots */
function clearAllPointDots() {
  if (pointDotsCollection) {
    pointDotsCollection.removeAll()
  }
  pointDotEntityMap.clear()
  manualPointDotsTrackIds.value = new Set()
  globalHiddenTrackKeys.value = new Set()
  viewer?.scene.requestRender()
}

/** Update color of all rendered point dots (e.g., after theme/color change) */
function refreshPointDotColors() {
  for (const [tKey, primitives] of pointDotEntityMap) {
    const track = props.tracks.find(t => trackKey(t.id, t.source) === tKey)
    if (!track) continue
    const color = Cesium.Color.fromCssColorString(getPointDotColor(track.source))
    for (const prim of primitives) {
      prim.color = color
    }
  }
  viewer?.scene.requestRender()
}

/** Update pixel size of all rendered point dots */
function refreshPointDotSizes() {
  for (const primitives of pointDotEntityMap.values()) {
    for (const prim of primitives) {
      prim.pixelSize = pointDotPixelSize
    }
  }
  viewer?.scene.requestRender()
}

let arcEntity: Cesium.Entity | undefined

const LABEL_FONT_BASE = '12px sans-serif'
const LABEL_FONT_LARGE = '18px sans-serif'
const BOUNDARY_LAYERS = [
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
] as const satisfies ReadonlyArray<{
  key: BoundaryLayerKey
  url: string
  stroke: string
  alpha: number
}>

interface TrackEntities {
  line: Cesium.Polyline
  trailLine: Cesium.Polyline | undefined
  label: Cesium.Label | undefined
  pointPrimitive: Cesium.PointPrimitive | undefined
  source: string
  labelText: string
}

const entityMap = new Map<string, TrackEntities>()
const flagEntityMap = new Map<string, Cesium.Entity>()

interface CityFeature {
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

/** Extract all line coordinate rings from a GeoJSON geometry object */
function extractPolygonRings(geometry: any): number[][][] {
  const type = geometry?.type
  const coords = geometry?.coordinates
  if (!type || !coords) return []

  switch (type) {
    case 'LineString':
      return [coords]
    case 'MultiLineString':
      return coords
    case 'Polygon':
      return [coords[0]] // 只取外环，忽略岛洞
    case 'MultiPolygon':
      return coords.map((p: any) => p[0])
    default:
      return []
  }
}

/** Douglas-Peucker 折线简化算法（基于索引，零临时数组分配） */
function simplifyRing(ring: number[][], tolerance: number): number[][] {
  if (ring.length <= 2) return ring
  const result: number[][] = []
  result.push(ring[0])
  simplifyDp(ring, 0, ring.length - 1, tolerance, result)
  result.push(ring[ring.length - 1])
  return result
}

function simplifyDp(
  ring: number[][], lo: number, hi: number, tolerance: number, out: number[][],
) {
  if (hi - lo <= 1) return

  const first = ring[lo]
  const last = ring[hi]
  const dx = last[0] - first[0]
  const dy = last[1] - first[1]
  const lenSq = dx * dx + dy * dy

  let maxDist = 0
  let maxIdx = lo + 1

  for (let i = lo + 1; i < hi; i++) {
    let dist: number
    if (lenSq === 0) {
      const ddx = ring[i][0] - first[0]
      const ddy = ring[i][1] - first[1]
      dist = Math.sqrt(ddx * ddx + ddy * ddy)
    } else {
      const cross = Math.abs((ring[i][0] - first[0]) * dy - (ring[i][1] - first[1]) * dx)
      dist = cross / Math.sqrt(lenSq)
    }
    if (dist > maxDist) {
      maxDist = dist
      maxIdx = i
    }
  }

  if (maxDist <= tolerance) return // 中间所有点都可丢弃

  simplifyDp(ring, lo, maxIdx, tolerance, out)
  out.push(ring[maxIdx])
  simplifyDp(ring, maxIdx, hi, tolerance, out)
}

/** 合并端点相接的环，大幅减少 Polyline 对象数量 */
function mergeConnectedRings(rings: number[][][]): number[][][] {
  if (rings.length <= 1) return rings

  const key = (pt: number[]) => `${pt[0].toFixed(6)},${pt[1].toFixed(6)}`
  const startMap = new Map<string, number[]>()
  const endMap = new Map<string, number[]>()
  const used = new Set<number>()
  const closed: number[][][] = [] // 闭合环（首尾相接），单独保留

  for (let i = 0; i < rings.length; i++) {
    if (rings[i].length < 2) { used.add(i); continue }
    const sk = key(rings[i][0])
    const ek = key(rings[i][rings[i].length - 1])
    if (!startMap.has(sk)) startMap.set(sk, [])
    startMap.get(sk)!.push(i)
    if (!endMap.has(ek)) endMap.set(ek, [])
    endMap.get(ek)!.push(i)
    // 闭合环单独保留
    if (sk === ek) { used.add(i); closed.push(rings[i].slice()) }
  }

  const merged: number[][][] = [...closed]

  for (let i = 0; i < rings.length; i++) {
    if (used.has(i)) continue

    let chain = rings[i].slice()
    used.add(i)

    // 向前扩展
    let growing = true
    while (growing) {
      growing = false
      const headKey = key(chain[0])
      // 其他环尾 == 当前头
      for (const ci of endMap.get(headKey) || []) {
        if (!used.has(ci)) { chain = [...rings[ci].slice(0, -1), ...chain]; used.add(ci); growing = true; break }
      }
      if (growing) continue
      // 其他环头 == 当前头（需反转）
      for (const ci of startMap.get(headKey) || []) {
        if (!used.has(ci)) { chain = [...rings[ci].slice().reverse().slice(0, -1), ...chain]; used.add(ci); growing = true; break }
      }
    }

    // 向后扩展
    growing = true
    while (growing) {
      growing = false
      const tailKey = key(chain[chain.length - 1])
      // 其他环头 == 当前尾
      for (const ci of startMap.get(tailKey) || []) {
        if (!used.has(ci)) { chain = [...chain, ...rings[ci].slice(1)]; used.add(ci); growing = true; break }
      }
      if (growing) continue
      // 其他环尾 == 当前尾（需反转）
      for (const ci of endMap.get(tailKey) || []) {
        if (!used.has(ci)) { chain = [...chain, ...rings[ci].slice().reverse().slice(1)]; used.add(ci); growing = true; break }
      }
    }

    merged.push(chain)
  }

  return merged
}

function clearBoundaryLayers() {
  for (const [key] of boundaryPrimitives) {
    clearSingleBoundaryLayer(key)
  }
  boundaryRingCache.clear()
}

/** Build a Cesium Primitive from cached rings for one boundary layer */
function buildBoundaryPrimitive(layerKey: BoundaryLayerKey): Cesium.Primitive | null {
  const rings = boundaryRingCache.get(layerKey)
  if (!rings || rings.length === 0) return null

  const layerConfig = BOUNDARY_LAYERS.find(l => l.key === layerKey)
  const alpha = layerConfig?.alpha ?? 0.55
  const color = Cesium.Color.fromCssColorString(boundaryColors[layerKey]).withAlpha(alpha)
  const width = boundaryWidths[layerKey]

  const instances: Cesium.GeometryInstance[] = []
  for (let i = 0; i < rings.length; i++) {
    const positions = rings[i].map(pt =>
      Cesium.Cartesian3.fromDegrees(pt[0], pt[1], BOUNDARY_ALTITUDE),
    )
    instances.push(new Cesium.GeometryInstance({
      geometry: new Cesium.PolylineGeometry({
        positions,
        width,
        vertexFormat: Cesium.PolylineMaterialAppearance.VERTEX_FORMAT,
      }),
    }))
  }

  return new Cesium.Primitive({
    geometryInstances: instances,
    appearance: new Cesium.PolylineMaterialAppearance({
      material: Cesium.Material.fromType('Color', { color }),
    }),
    asynchronous: false,
  })
}

/** Toggle boundary layers — load on first show, unload on hide */
function applyBoundaryVisibility() {
  for (const layer of BOUNDARY_LAYERS) {
    if (boundaryVisible[layer.key]) {
      if (boundaryPrimitives.has(layer.key)) continue
      loadSingleBoundaryLayer(layer.key)
    } else {
      clearSingleBoundaryLayer(layer.key)
    }
  }
}

async function loadSingleBoundaryLayer(layerKey: BoundaryLayerKey) {
  if (!viewer) return
  if (boundaryPrimitives.has(layerKey)) return

  const layer = BOUNDARY_LAYERS.find(l => l.key === layerKey)
  if (!layer) return

  try {
    const response = await fetch(layer.url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const geojson = await response.json()
    const features = Array.isArray(geojson.features) ? geojson.features : []

    // 1. 收集 + 简化 + 合并
    const allRings: number[][][] = []
    for (const feature of features) {
      const rings = extractPolygonRings(feature.geometry)
      for (const ring of rings) {
        if (Array.isArray(ring) && ring.length >= 2) allRings.push(ring as number[][])
      }
    }
    const simplified = allRings.map(r => simplifyRing(r, SIMPLIFY_TOLERANCE))
    const merged = mergeConnectedRings(simplified)

    const totalRawVerts = allRings.reduce((s, r) => s + r.length, 0)
    const totalSimpleVerts = simplified.reduce((s, r) => s + r.length, 0)

    // 2. 缓存合并后的环（用于后续颜色/线宽变更重建）
    boundaryRingCache.set(layerKey, merged)

    // 3. 构建 Primitive 并加入场景
    const primitive = buildBoundaryPrimitive(layerKey)
    if (!primitive) return

    // fetch 期间用户可能关掉了可见性
    if (!boundaryVisible[layerKey]) return

    viewer.scene.primitives.add(primitive)
    boundaryPrimitives.set(layerKey, primitive)

    const ratio = totalRawVerts > 0 ? ((1 - totalSimpleVerts / totalRawVerts) * 100).toFixed(0) : '0'
    console.log(`[boundary] ${layerKey}: ${allRings.length}→${merged.length} rings, ${totalRawVerts}→${totalSimpleVerts} verts (-${ratio}%)`)
    viewer.scene.requestRender()
  } catch (e) {
    console.warn(`[boundary] failed to load ${layerKey}:`, e)
  }
}

function clearSingleBoundaryLayer(layerKey: BoundaryLayerKey) {
  const primitive = boundaryPrimitives.get(layerKey)
  if (primitive && viewer) {
    viewer.scene.primitives.remove(primitive)
    if (!primitive.isDestroyed()) primitive.destroy()
  }
  boundaryPrimitives.delete(layerKey)
  boundaryRingCache.delete(layerKey)
  viewer?.scene.requestRender()
}

/** Rebuild a boundary primitive with new width/color */
function rebuildBoundaryPrimitive(layerKey: BoundaryLayerKey) {
  if (!boundaryPrimitives.has(layerKey)) return // 未加载，无需重建
  // 销毁旧 Primitive
  const old = boundaryPrimitives.get(layerKey)!
  if (viewer) {
    viewer.scene.primitives.remove(old)
    if (!old.isDestroyed()) old.destroy()
  }
  boundaryPrimitives.delete(layerKey)
  // 重建
  const primitive = buildBoundaryPrimitive(layerKey)
  if (primitive && viewer) {
    viewer.scene.primitives.add(primitive)
    boundaryPrimitives.set(layerKey, primitive)
    viewer.scene.requestRender()
  }
}

/** Update stroke width for a single boundary layer */
function applyBoundaryWidth(layerKey: BoundaryLayerKey) {
  rebuildBoundaryPrimitive(layerKey)
}

/** Update stroke width for all boundary layers */
function applyAllBoundaryWidths() {
  for (const layer of BOUNDARY_LAYERS) {
    applyBoundaryWidth(layer.key)
  }
}

/** Update stroke color for a single boundary layer */
function applyBoundaryColor(layerKey: BoundaryLayerKey) {
  rebuildBoundaryPrimitive(layerKey)
}

/** Update stroke color for all boundary layers */
function applyAllBoundaryColors() {
  for (const layer of BOUNDARY_LAYERS) {
    applyBoundaryColor(layer.key)
  }
}

async function loadCityLayer() {
  if (!viewer) return
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

    renderCityLayer()
  } catch (e) {
    console.warn('[cities] failed to load city layer:', e)
  }
}

function normalizeCityLevel(level: unknown, featureCode: unknown, capital: boolean): CityLevel {
  if (level === 'capital' || level === 'regional' || level === 'prefecture' || level === 'major') {
    return level
  }
  if (capital || featureCode === 'PPLC') return 'capital'
  if (featureCode === 'PPLA') return 'regional'
  if (featureCode === 'PPLA2') return 'prefecture'
  return 'major'
}

function clearCityLayer() {
  // Cancel any pending deferred cleanup (old collections may already be gone)
  if (pendingCityCleanup && viewer) {
    viewer.scene.preRender.removeEventListener(pendingCityCleanup)
    pendingCityCleanup = null
  }
  if (!viewer) {
    cityPointCollection = undefined
    cityLabelCollection = undefined
    cityPickMap.clear()
    return
  }
  if (cityPointCollection) {
    viewer.scene.primitives.remove(cityPointCollection)
    cityPointCollection = undefined
  }
  if (cityLabelCollection) {
    viewer.scene.primitives.remove(cityLabelCollection)
    cityLabelCollection = undefined
  }
  cityPickMap.clear()
}

function enabledCities() {
  return cityFeatures.filter(city => {
    if (!cityLayer.levels[city.level]) return false
    return city.level !== 'major' || city.population >= cityLayer.minPopulation
  })
}

function cityLevelRank(level: CityLevel) {
  switch (level) {
    case 'capital': return 0
    case 'regional': return 1
    case 'prefecture': return 2
    case 'major': return 3
    default: return 9
  }
}

function currentCameraHeight() {
  if (!viewer) return Number.POSITIVE_INFINITY
  return viewer.camera.positionCartographic.height
}

function emitViewStatus(screenPosition?: Cesium.Cartesian2 | null) {
  if (!viewer || viewer.isDestroyed()) return

  const cameraHeightKm = Math.max(0, viewer.camera.positionCartographic.height / 1000)
  let longitude = 0
  let latitude = 0

  if (screenPosition) {
    const cartesian = viewer.camera.pickEllipsoid(screenPosition, viewer.scene.globe.ellipsoid)
    if (Cesium.defined(cartesian)) {
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian)
      longitude = Cesium.Math.toDegrees(cartographic.longitude)
      latitude = Cesium.Math.toDegrees(cartographic.latitude)
    }
  }

  emit('view-status', { cameraHeightKm, longitude, latitude, fps: Math.round(fpsSmoothed) })
}

function cityPointMaxHeight(level: CityLevel) {
  switch (level) {
    case 'capital': return Number.POSITIVE_INFINITY
    case 'regional': return cityLayer.lod.pointMaxHeight.regional
    case 'prefecture': return cityLayer.lod.pointMaxHeight.prefecture
    case 'major': return cityLayer.lod.pointMaxHeight.major
  }
}

function cityLabelMaxHeight(level: CityLevel) {
  switch (level) {
    case 'capital': return Number.POSITIVE_INFINITY
    case 'regional': return cityLayer.lod.labelMaxHeight.regional
    case 'prefecture': return cityLayer.lod.labelMaxHeight.prefecture
    case 'major': return cityLayer.lod.labelMaxHeight.major
  }
}

function maxCityLabelsForHeight(height: number) {
  if (height > 12_000_000) return 80
  if (height > 6_000_000) return 140
  if (height > 2_000_000) return 220
  if (height > 800_000) return 340
  return 520
}

function cityLabelGridSize(height: number) {
  if (height > 12_000_000) return { width: 120, height: 54 }
  if (height > 6_000_000) return { width: 104, height: 48 }
  if (height > 2_000_000) return { width: 92, height: 42 }
  if (height > 800_000) return { width: 82, height: 36 }
  return { width: 72, height: 32 }
}

function shouldAvoidCityLabels(height: number) {
  return height > 800_000
}

function isFrontSidePosition(position: Cesium.Cartesian3) {
  if (!viewer) return true
  const pointNormal = Cesium.Cartesian3.normalize(position, new Cesium.Cartesian3())
  const cameraNormal = Cesium.Cartesian3.normalize(viewer.camera.positionWC, new Cesium.Cartesian3())
  return Cesium.Cartesian3.dot(pointNormal, cameraNormal) > -0.04
}

function cityPickId(city: CityFeature) {
  return `city::${city.id}`
}

function cityPointSize(city: CityFeature) {
  return city.level === 'capital'
    ? cityLayer.pointSize + 2
    : city.level === 'regional'
      ? cityLayer.pointSize + 1
      : cityLayer.pointSize
}

function isAdministrativeCity(city: CityFeature) {
  return city.level === 'capital' || city.level === 'regional' || city.level === 'prefecture'
}

function showCityHover(city: CityFeature) {
  if (!viewer || !cityLayer.visible) return
  const position = Cesium.Cartesian3.fromDegrees(city.longitude, city.latitude, 1800)
  if (!cityHoverEntity) {
    cityHoverEntity = viewer.entities.add({
      id: 'city-hover-label',
      position,
      label: {
        text: city.nameZh,
        font: `${cityLayer.fontSize + 2}px sans-serif`,
        fillColor: Cesium.Color.fromCssColorString(cityLayer.labelColor).withAlpha(1),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.9),
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        pixelOffset: new Cesium.Cartesian2(cityLayer.pointSize + 10, 0),
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.58),
        backgroundPadding: new Cesium.Cartesian2(6, 4),
      },
    })
  } else {
    cityHoverEntity.show = true
    cityHoverEntity.position = position as any
    if (cityHoverEntity.label) {
      cityHoverEntity.label.text = new Cesium.ConstantProperty(city.nameZh)
      cityHoverEntity.label.font = new Cesium.ConstantProperty(`${cityLayer.fontSize + 2}px sans-serif`)
      cityHoverEntity.label.fillColor = new Cesium.ConstantProperty(Cesium.Color.fromCssColorString(cityLayer.labelColor).withAlpha(1))
      cityHoverEntity.label.pixelOffset = new Cesium.ConstantProperty(new Cesium.Cartesian2(cityLayer.pointSize + 10, 0))
    }
  }
}

function hideCityHover() {
  if (cityHoverEntity) cityHoverEntity.show = false
}

function showPointDotHover(trackId: string, pointIndex: number) {
  if (!viewer) return
  const track = props.tracks.find(t => trackKey(t.id, t.source) === trackId)
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
  const position = Cesium.Cartesian3.fromDegrees(pt.longitude, pt.latitude, FLAT_ALTITUDE)

  if (!pointDotHoverEntity) {
    pointDotHoverEntity = viewer.entities.add({
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
        pixelOffset: new Cesium.Cartesian2(pointDotPixelSize + 10, 0),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
  } else {
    pointDotHoverEntity.show = true
    pointDotHoverEntity.position = position as any
    if (pointDotHoverEntity.label) {
      pointDotHoverEntity.label.text = new Cesium.ConstantProperty(text)
    }
  }
}

function hidePointDotHover() {
  if (pointDotHoverEntity) pointDotHoverEntity.show = false
  hoveredPointDotId = null
}

function removeCityHover() {
  if (viewer && cityHoverEntity) {
    viewer.entities.remove(cityHoverEntity)
  }
  cityHoverEntity = undefined
}

function removePointDotHover() {
  if (viewer && pointDotHoverEntity) {
    viewer.entities.remove(pointDotHoverEntity)
  }
  pointDotHoverEntity = undefined
  hoveredPointDotId = null
}

function pickedCity(picked: any): CityFeature | null {
  const id = typeof picked?.id === 'string'
    ? picked.id
    : picked?.id instanceof Cesium.Entity
      ? picked.id.id
      : undefined
  if (typeof id !== 'string' || !id.startsWith('city::')) return null
  return cityPickMap.get(id) ?? null
}

function scheduleCityLayerRender(delay = 120, _force = false) {
  if (cityLayerDebounce) clearTimeout(cityLayerDebounce)
  cityLayerDebounce = setTimeout(() => {
    cityLayerDebounce = null
    renderCityLayer()
  }, delay)
}

function renderCityLayer() {
  if (!viewer) return
  if (!cityLayer.visible || cityFeatures.length === 0) {
    clearCityLayer()
    hideCityHover()
    viewer.scene.requestRender()
    return
  }

  const pointColor = Cesium.Color.fromCssColorString(cityLayer.color).withAlpha(0.95)
  const labelColor = Cesium.Color.fromCssColorString(cityLayer.labelColor).withAlpha(0.95)
  const height = currentCameraHeight()
  const cities = enabledCities()
  const canvas = viewer.scene.canvas

  // Double-buffer: build new collections first, then swap in atomically
  // to avoid a "gap frame" that causes visible flickering during zoom
  const newPoints = new Cesium.PointPrimitiveCollection()
  const newLabels = new Cesium.LabelCollection()

  const labelCandidates: Array<{
    city: CityFeature
    position: Cesium.Cartesian3
    window: Cesium.Cartesian2
    pointSize: number
  }> = []

  for (const city of cities) {
    const showPoint = height <= cityPointMaxHeight(city.level)
    const showLabel = cityLayer.labels && height <= cityLabelMaxHeight(city.level)
    if (!showPoint && !showLabel) continue

    const position = Cesium.Cartesian3.fromDegrees(city.longitude, city.latitude, 1200)
    if (!isFrontSidePosition(position)) continue

    const pointSize = cityPointSize(city)
    const id = cityPickId(city)
    cityPickMap.set(id, city)

    if (showPoint) {
      newPoints.add({
        id,
        position,
        pixelSize: pointSize,
        color: pointColor,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.75),
        outlineWidth: 1,
      })
    }

    if (showLabel) {
      const window = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, position)
      if (
        window &&
        window.x >= -120 &&
        window.y >= -80 &&
        window.x <= canvas.clientWidth + 120 &&
        window.y <= canvas.clientHeight + 80
      ) {
        labelCandidates.push({ city, position, window, pointSize })
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
      font: `${isAdministrativeCity(item.city) ? cityLayer.fontSize + 1 : cityLayer.fontSize}px sans-serif`,
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
  viewer.scene.primitives.add(newPoints)
  viewer.scene.primitives.add(newLabels)
  cityPointCollection = newPoints
  cityLabelCollection = newLabels

  // Cancel any pending cleanup from a previous swap
  if (pendingCityCleanup) {
    viewer.scene.preRender.removeEventListener(pendingCityCleanup)
    pendingCityCleanup = null
  }

  // Delay removal of old collections by one preRender frame.
  // New LabelCollection needs one frame to upload glyph textures to the GPU
  // before the old labels disappear — otherwise we get a visible blank flicker.
  if (oldPoints || oldLabels) {
    const cleanup = () => {
      viewer!.scene.preRender.removeEventListener(cleanup)
      pendingCityCleanup = null
      if (oldPoints) viewer!.scene.primitives.remove(oldPoints)
      if (oldLabels) viewer!.scene.primitives.remove(oldLabels)
      viewer!.scene.requestRender()
    }
    pendingCityCleanup = cleanup
    viewer.scene.preRender.addEventListener(cleanup)
  }

  viewer.scene.requestRender()
}

// Generate flag icons in Lucide style via canvas
function createFlagIcons(): Map<string, string> {
  const map = new Map<string, string>()
  const size = 32

  function makeIcon(style: string, draw: (ctx: CanvasRenderingContext2D) => void): string {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    draw(ctx)
    const url = canvas.toDataURL()
    map.set(style, url)
    return url
  }

  // ── flag-standard: Lucide-style rectangular flag with notch ──
  makeIcon('flag-standard', (ctx) => {
    // pole
    ctx.fillStyle = '#555555'
    ctx.fillRect(8, 4, 2, 22)
    // flag body
    ctx.beginPath()
    ctx.moveTo(10, 5)
    ctx.lineTo(26, 7)
    ctx.lineTo(26, 15)
    ctx.lineTo(18, 11)
    ctx.lineTo(10, 13)
    ctx.closePath()
    ctx.fillStyle = '#ff4444'
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.stroke()
  })

  // ── flag-triangle-right: triangular pennant ──
  makeIcon('flag-triangle-right', (ctx) => {
    // pole
    ctx.fillStyle = '#555555'
    ctx.fillRect(8, 4, 2, 22)
    // triangular flag
    ctx.beginPath()
    ctx.moveTo(10, 6)
    ctx.lineTo(26, 12)
    ctx.lineTo(10, 18)
    ctx.closePath()
    ctx.fillStyle = '#ff4444'
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.stroke()
  })

  // ── flag-pin: classic pin (preserved) ──
  makeIcon('flag-pin', (ctx) => {
    // pin body
    ctx.beginPath()
    ctx.arc(size / 2, size / 2 - 4, 10, 0, Math.PI * 2)
    ctx.fillStyle = '#ff4444'
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.stroke()
    // pin point
    ctx.beginPath()
    ctx.moveTo(size / 2 - 5, size / 2 + 2)
    ctx.lineTo(size / 2, size - 4)
    ctx.lineTo(size / 2 + 5, size / 2 + 2)
    ctx.fillStyle = '#ff4444'
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.stroke()
    // white dot center
    ctx.beginPath()
    ctx.arc(size / 2, size / 2 - 4, 4, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
  })

  // ── diamond: diamond marker ──
  makeIcon('diamond', (ctx) => {
    ctx.beginPath()
    ctx.moveTo(16, 4)
    ctx.lineTo(27, 15)
    ctx.lineTo(16, 26)
    ctx.lineTo(5, 15)
    ctx.closePath()
    ctx.fillStyle = '#ff4444'
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.stroke()
    // inner highlight
    ctx.beginPath()
    ctx.arc(16, 15, 4, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
  })

  // ── circle: filled circle marker ──
  makeIcon('circle', (ctx) => {
    ctx.beginPath()
    ctx.arc(16, 16, 10, 0, Math.PI * 2)
    ctx.fillStyle = '#ff4444'
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.stroke()
    // inner ring
    ctx.beginPath()
    ctx.arc(16, 16, 5, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
  })

  // ── square-flag: simple rectangular flag without notch ──
  makeIcon('square-flag', (ctx) => {
    // pole
    ctx.fillStyle = '#555555'
    ctx.fillRect(8, 4, 2, 22)
    // rectangular flag body
    ctx.beginPath()
    ctx.rect(10, 5, 16, 11)
    ctx.fillStyle = '#ff4444'
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.stroke()
  })

  return map
}

const flagIconDataUrls = createFlagIcons()

function getFlagIconUrl(style?: string): string {
  if (style && flagIconDataUrls.has(style)) return flagIconDataUrls.get(style)!
  return flagIconDataUrls.get('flag-pin')!
}

function createFlagEntity(flag: Flag) {
  if (!viewer) return
  const s = flagScale.value
  const entity = viewer.entities.add({
    id: `flag-${flag.id}`,
    position: Cesium.Cartesian3.fromDegrees(flag.longitude, flag.latitude),
    billboard: {
      image: getFlagIconUrl(flag.style),
      scale: 0.8 * s,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
    },
    label: {
      text: flag.label,
      font: `${Math.round(12 * s)}px sans-serif`,
      fillColor: Cesium.Color.YELLOW,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.TOP,
      pixelOffset: new Cesium.Cartesian2(0, Math.round(8 * s)),
    },
  })
  flagEntityMap.set(flag.id, entity)
}

function removeFlagEntity(id: string) {
  const entity = flagEntityMap.get(id)
  if (entity && viewer) {
    viewer.entities.remove(entity)
    flagEntityMap.delete(id)
  }
}

function clearAllFlagEntities() {
  if (!viewer) return
  for (const entity of flagEntityMap.values()) {
    viewer.entities.remove(entity)
  }
  flagEntityMap.clear()
}

function syncFlagEntities() {
  if (!viewer) return
  const newIds = new Set(flags.value.map((f) => f.id))
  const oldIds = new Set(flagEntityMap.keys())
  const s = flagScale.value

  viewer.entities.suspendEvents()

  for (const id of oldIds) {
    if (!newIds.has(id)) removeFlagEntity(id)
  }

  for (const flag of flags.value) {
    if (!flagEntityMap.has(flag.id)) {
      createFlagEntity(flag)
    } else {
      const entity = flagEntityMap.get(flag.id)!
      if (entity.label) {
        entity.label.text = new Cesium.ConstantProperty(flag.label)
        entity.label.font = new Cesium.ConstantProperty(`${Math.round(12 * s)}px sans-serif`)
        entity.label.pixelOffset = new Cesium.ConstantProperty(new Cesium.Cartesian2(0, Math.round(8 * s)))
      }
      if (entity.billboard) {
        entity.billboard.image = new Cesium.ConstantProperty(getFlagIconUrl(flag.style))
        entity.billboard.scale = new Cesium.ConstantProperty(0.8 * s)
      }
    }
  }

  viewer.entities.resumeEvents()
  viewer.scene.requestRender()
}

/** Batch-convert TrackPoint[] → Cartesian3[] using Cesium's SIMD-optimized API.
 *  Eliminates ~N individual fromDegrees() calls with one vectorized operation. */
function isFinitePoint(p: TrackPoint): boolean {
  return Number.isFinite(p.longitude) &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.altitude) &&
    p.longitude >= -180 && p.longitude <= 180 &&
    p.latitude >= -90 && p.latitude <= 90
}

/** Convert track positions to a flat Cartesian3 array for polyline rendering */
function toCartesianArray(positions: TrackPoint[]): Cesium.Cartesian3[] {
  const flat: number[] = []
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]
    if (!isFinitePoint(p)) continue
    flat.push(p.longitude, p.latitude, FLAT_ALTITUDE)
  }
  return Cesium.Cartesian3.fromDegreesArrayHeights(flat)
}

function createTrackEntities(track: Track) {
  if (!viewer || track.positions.length === 0) return
  if (!trackLines) return  // P2 safety: PolylineCollection not yet initialized

  const color = getLineColor(track.source)
  const tKey = trackKey(track.id, track.source)
  const isSelected = tKey === props.selectedId
  const isRaw = track.source === 'radar_raw'
  const replaying = props.replayTime !== null
  const vis = visibility.value[track.source as keyof typeof visibility.value] !== false

  const flat = toCartesianArray(track.positions)
  const baseW = baseWidth(track.source)
  const normalAlpha = isSelected ? SELECTED_ALPHA : isRaw ? RAW_ALPHA : NORMAL_ALPHA

  // Single polyline with all positions (no segmentation)
  const line = trackLines.add({
    id: tKey,
    show: !replaying && vis,
    positions: flat,
    width: isSelected ? SELECTED_WIDTH : baseW,
    material: Cesium.Material.fromType('Color', {
      color: color.withAlpha(normalAlpha),
    }),
  })

  const label = [track.metadata.flightNumber, track.metadata.aircraftType]
    .filter(Boolean)
    .join(' | ')

  const last = track.positions[track.positions.length - 1]
  const lastPos = Cesium.Cartesian3.fromDegrees(last.longitude, last.latitude, FLAT_ALTITUDE)

  // P1: PointPrimitive for endpoint dot
  let pointPrimitive: Cesium.PointPrimitive | undefined
  if (pointPrimitives) {
    const base = isSelected ? DOT_SELECTED : isRaw ? DOT_RAW : DOT_BASE
    pointPrimitive = pointPrimitives.add({
      id: tKey,
      position: lastPos,
      color: color,
      pixelSize: pointPrimSize(base, track.source),
    })
  }

  // Label in LabelCollection
  let lbl: Cesium.Label | undefined
  if (trackLabels) {
    lbl = trackLabels.add({
      id: `${tKey}::dot`,
      show: vis,
      position: lastPos,
      text: showLabels.value ? (label || track.id) : '',
      font: showLabels.value ? LABEL_FONT_LARGE : LABEL_FONT_BASE,
      fillColor: color,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -20),
    })
  }

  entityMap.set(tKey, {
    line, trailLine: undefined, label: lbl, pointPrimitive,
    source: track.source, labelText: label || track.id,
  })
}

function removeTrackEntities(id: string) {
  const entry = entityMap.get(id)
  if (entry && viewer) {
    trackLines?.remove(entry.line)
    if (entry.trailLine) trackLines?.remove(entry.trailLine)
    if (entry.label) trackLabels?.remove(entry.label)
    if (entry.pointPrimitive) pointPrimitives?.remove(entry.pointPrimitive)
    entityMap.delete(id)
  }
}

/** Strip suffix from a polyline ID to get the entityMap key */
function extractTrackKeyFromPolylineId(polylineId: string): string | null {
  if (entityMap.has(polylineId)) return polylineId
  if (polylineId.endsWith('::dot')) return polylineId.slice(0, polylineId.lastIndexOf('::'))
  return null
}

function clearAllEntities() {
  if (!viewer) return
  for (const [id] of entityMap) {
    removeTrackEntities(id)
  }
}

/** Re-apply per-source layer visibility to all Cesium entities.
 *  Must be called after syncEntities / replay restore / any operation
 *  that may have overwritten entity.show without consulting visibility state. */
function reapplyVisibility() {
  for (const [, entities] of entityMap) {
    const vis = visibility.value[entities.source as keyof typeof visibility.value]
    entities.line.show = vis
    if (entities.label) entities.label.show = vis
    if (entities.pointPrimitive) entities.pointPrimitive.show = vis
  }
}

function syncEntities(newTracks: Track[]) {
  if (!viewer) return

  const t0 = performance.now()
  try {
    viewer.entities.suspendEvents()

    const keepIds = new Set(newTracks.map((t) => trackKey(t.id, t.source)))
    const oldIds = Array.from(entityMap.keys())

    // Remove entities for tracks no longer in display list
    for (const id of oldIds) {
      if (!keepIds.has(id)) {
        removeTrackEntities(id)
      }
    }

    // Add or update entities
    const replaying = props.replayTime !== null
    for (const track of newTracks) {
      const tKey = trackKey(track.id, track.source)
      const existing = entityMap.get(tKey)
      if (!existing) {
        createTrackEntities(track)
        continue
      }

      // Update line positions when changed (e.g. time filter)
      if (existing.line.positions.length !== track.positions.length) {
        existing.line.positions = toCartesianArray(track.positions)
        // Re-apply color in case selection state changed
        const color = getLineColor(track.source)
        const isSelected = tKey === props.selectedId
        const isRaw = track.source === 'radar_raw'
        const normalAlpha = isSelected ? SELECTED_ALPHA : isRaw ? RAW_ALPHA : NORMAL_ALPHA
        if (existing.line.material && existing.line.material.type === 'Color') {
          existing.line.material.uniforms.color = color.withAlpha(normalAlpha)
        }
        existing.line.width = isSelected ? SELECTED_WIDTH : baseWidth(track.source)
      } else if (!replaying) {
        existing.line.show = visibility.value[track.source as keyof typeof visibility.value] !== false
      }

      // Update label & PointPrimitive to last position
      const last = track.positions[track.positions.length - 1]
      const lastPos = Cesium.Cartesian3.fromDegrees(last.longitude, last.latitude, FLAT_ALTITUDE)
      if (existing.label) existing.label.position = lastPos
      if (existing.pointPrimitive) existing.pointPrimitive.position = lastPos
    }
  } finally {
    viewer.entities.resumeEvents()
    reapplyVisibility()
    viewer.scene.requestRender()
  }
  const t1 = performance.now()
  console.log(`[perf] Cesium syncEntities: ${(t1 - t0).toFixed(0)}ms  |  tracks=${newTracks.length}`)
}

// Sync Cesium entities when props.tracks changes — handles initial load, filter, isolation, clear
watch(
  () => props.tracks,
  (newTracks) => {
    syncEntities(newTracks)
  },
  { deep: false },
)

function updateReplayPositions(time: number) {
  if (!viewer) return
  const visCtx = visibility.value
  for (const track of props.tracks) {
    const tKey = trackKey(track.id, track.source)
    const entities = entityMap.get(tKey)
    if (!entities || track.positions.length === 0) continue

    const pts = track.positions
    const vis = visCtx[entities.source as keyof typeof visCtx] !== false

    // Binary search current time index
    let lo = 0, hi = pts.length - 1
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1
      if (pts[mid].timestamp <= time) lo = mid; else hi = mid
    }
    if (time < pts[0].timestamp) {
      entities.line.show = false
      if (entities.trailLine) { trackLines!.remove(entities.trailLine); entities.trailLine = undefined }
      continue
    }

    // Interpolate current position
    const dt = pts[hi].timestamp - pts[lo].timestamp
    const t = dt > 0 ? (time - pts[lo].timestamp) / dt : 0
    const cpLat = pts[lo].latitude + (pts[hi].latitude - pts[lo].latitude) * t
    const cpLng = pts[lo].longitude + (pts[hi].longitude - pts[lo].longitude) * t

    const cpPos = Cesium.Cartesian3.fromDegrees(cpLng, cpLat, FLAT_ALTITUDE)
    if (entities.label) entities.label.position = cpPos
    if (entities.pointPrimitive) entities.pointPrimitive.position = cpPos

    // Build progressive trail: points up to lo + interpolated current
    const trailPts: number[] = []
    for (let i = 0; i <= lo; i++) {
      trailPts.push(pts[i].longitude, pts[i].latitude, FLAT_ALTITUDE)
    }
    // Add interpolated point if different from last past point
    const lastPast = pts[lo]
    if (Math.abs(cpLat - lastPast.latitude) > 1e-7 || Math.abs(cpLng - lastPast.longitude) > 1e-7) {
      trailPts.push(cpLng, cpLat, FLAT_ALTITUDE)
    }
    const trailPositions = Cesium.Cartesian3.fromDegreesArrayHeights(trailPts)

    // Hide full line, show trail
    entities.line.show = false

    if (entities.trailLine) {
      entities.trailLine.positions = trailPositions
      entities.trailLine.show = trailPositions.length >= 2 && vis
    } else if (trailPositions.length >= 2) {
      const color = getLineColor(track.source)
      const isSel = tKey === props.selectedId
      const isRaw = track.source === 'radar_raw'
      entities.trailLine = trackLines!.add({
        id: tKey + '::trail',
        show: vis,
        positions: trailPositions,
        width: isSel ? SELECTED_WIDTH : baseWidth(track.source),
        material: Cesium.Material.fromType('Color', {
          color: color.withAlpha(isSel ? SELECTED_ALPHA : (isRaw ? RAW_ALPHA : NORMAL_ALPHA)),
        }),
      })
    }

    // Progressive point dots
    const dotPrimitives = pointDotEntityMap.get(tKey)
    if (dotPrimitives && dotPrimitives.length > 0) {
      const prevLo = pointDotLastLo.get(tKey) ?? -1
      if (lo !== prevLo) {
        pointDotLastLo.set(tKey, lo)
        for (let i = 0; i < dotPrimitives.length; i++) {
          dotPrimitives[i].show = i <= lo
        }
      }
    }
  }
  viewer.scene.requestRender()
}

let wasReplaying = false
watch(
  () => props.replayTime,
  (time) => {
    if (time !== null) {
      if (!wasReplaying) {
        // Hide full lines at replay start; trail lines show progressively
        for (const [, entities] of entityMap) {
          entities.line.show = false
          if (entities.trailLine) {
            trackLines?.remove(entities.trailLine)
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
      updateReplayPositions(time)
      wasReplaying = true
    } else if (wasReplaying) {
      wasReplaying = false
      // Remove trail lines, restore full lines
      for (const track of props.tracks) {
        const entities = entityMap.get(trackKey(track.id, track.source))
        if (!entities || track.positions.length === 0) continue
        if (entities.trailLine) {
          trackLines?.remove(entities.trailLine)
          entities.trailLine = undefined
        }
        entities.line.show = visibility.value[entities.source as keyof typeof visibility.value] !== false
        const last = track.positions[track.positions.length - 1]
        const lastPos = Cesium.Cartesian3.fromDegrees(last.longitude, last.latitude, FLAT_ALTITUDE)
        if (entities.label) entities.label.position = lastPos
        if (entities.pointPrimitive) entities.pointPrimitive.position = lastPos
      }
      pointDotLastLo.clear()
      for (const primitives of pointDotEntityMap.values()) {
        for (const p of primitives) p.show = true
      }
      syncGlobalPointDots()
      reapplyVisibility()
      if (previousSelectedId) applyHighlight(previousSelectedId)
      viewer?.scene.requestRender()
    }
  },
)

watch(
  visibility,
  () => {
    for (const [, entities] of entityMap) {
      const vis = visibility.value[entities.source as keyof typeof visibility.value]
      entities.line.show = vis
      if (entities.label) entities.label.show = vis
      if (entities.pointPrimitive) entities.pointPrimitive.show = vis
    }
    viewer?.scene.requestRender()
  },
  { deep: true },
)

// Boundary visibility toggle — fast path: only flips dataSource.show
watch(boundaryVisible, () => {
  applyBoundaryVisibility()
  viewer?.scene.requestRender()
})

// Boundary width change — debounced: during rapid slider drag the reactive value
// updates instantly (UI stays responsive), but the heavy per-entity width loop only
// runs once after the user pauses for 60ms, avoiding 9K+ entity updates at 60 Hz.
let boundaryWidthDebounce: ReturnType<typeof setTimeout> | null = null
watch(boundaryWidths, () => {
  if (boundaryWidthDebounce) clearTimeout(boundaryWidthDebounce)
  boundaryWidthDebounce = setTimeout(() => {
    boundaryWidthDebounce = null
    applyAllBoundaryWidths()
    viewer?.scene.requestRender()
  }, 60)
}, { deep: true })

// Boundary color change — same debounced pattern as widths
let boundaryColorDebounce: ReturnType<typeof setTimeout> | null = null
watch(boundaryColors, () => {
  if (boundaryColorDebounce) clearTimeout(boundaryColorDebounce)
  boundaryColorDebounce = setTimeout(() => {
    boundaryColorDebounce = null
    applyAllBoundaryColors()
    viewer?.scene.requestRender()
  }, 60)
}, { deep: true })

let cityLayerDebounce: ReturnType<typeof setTimeout> | null = null
watch(cityLayer, () => {
  scheduleCityLayerRender(80, true)
}, { deep: true })

// Reactive line width: update existing polylines when slider changes
watch(
  () => props.lineWidths,
  () => {
    for (const [tKey, entry] of entityMap) {
      if (tKey !== previousSelectedId) {
        const bw = baseWidth(entry.source as DataSource)
        entry.line.width = bw
      }
    }
    viewer?.scene.requestRender()
  },
  { deep: true },
)

// Reactive dot scale: update PointPrimitives when slider changes (P1)
watch(
  () => props.dotScale,
  () => {
    for (const [tKey, entry] of entityMap) {
      if (!entry.pointPrimitive) continue
      const isSelected = tKey === previousSelectedId
      const isHovered = hoveredTrackId === tKey
      const isRaw = entry.source === 'radar_raw'
      const base = isHovered ? DOT_HOVER
        : isSelected ? DOT_SELECTED
        : isRaw ? DOT_RAW
        : DOT_BASE
      entry.pointPrimitive.pixelSize = pointPrimSize(base, entry.source)
    }
    viewer?.scene.requestRender()
  },
  { deep: true },
)

// Reactive line color: update polylines & PointPrimitives when color changes (P1)
watch(lineColors, () => {
  for (const [tKey, entry] of entityMap) {
    const isSelected = tKey === previousSelectedId
    const isHovered = hoveredTrackId === tKey
    if (isSelected || isHovered) continue

    const color = getLineColor(entry.source as DataSource)
    const isRaw = entry.source === 'radar_raw'
    const newColor = color.withAlpha(isRaw ? RAW_ALPHA : NORMAL_ALPHA)
    if (entry.line.material && entry.line.material.type === 'Color') {
      entry.line.material.uniforms.color = newColor
    } else {
      entry.line.material = Cesium.Material.fromType('Color', { color: newColor })
    }
    if (entry.pointPrimitive) {
      entry.pointPrimitive.color = color
    }
  }
  viewer?.scene.requestRender()
}, { deep: true })

// Highlight selected track
let previousSelectedId: string | null = null

function applyHighlight(trackId: string | null) {
  if (!viewer) return

  // Restore previous
  if (previousSelectedId && previousSelectedId !== trackId) {
    const prev = entityMap.get(previousSelectedId)
    if (prev) {
      const color = getLineColor(prev.source as DataSource)
      if (prev.line.material && prev.line.material.type === 'Color') {
        prev.line.material.uniforms.color = color.withAlpha(baseAlpha(prev.source))
      } else {
        prev.line.material = Cesium.Material.fromType('Color', {
          color: color.withAlpha(baseAlpha(prev.source)),
        })
      }
      prev.line.width = baseWidth(prev.source as DataSource)
    }
    if (prev?.pointPrimitive) {
      prev.pointPrimitive.pixelSize = pointPrimSize(prev.source === 'radar_raw' ? DOT_RAW : DOT_BASE, prev.source)
      prev.pointPrimitive.color = getLineColor(prev.source as DataSource)
    }
  }

  // Apply to new
  if (trackId) {
    const entry = entityMap.get(trackId)
    if (entry) {
      const color = getLineColor(entry.source as DataSource)
      if (entry.line.material && entry.line.material.type === 'Color') {
        entry.line.material.uniforms.color = color.withAlpha(SELECTED_ALPHA)
      } else {
        entry.line.material = Cesium.Material.fromType('Color', {
          color: color.withAlpha(SELECTED_ALPHA),
        })
      }
      entry.line.width = SELECTED_WIDTH
    }
    if (entry?.pointPrimitive) {
      entry.pointPrimitive.pixelSize = pointPrimSize(DOT_SELECTED, entry.source)
      entry.pointPrimitive.color = getLineColor(entry.source as DataSource)
    }
  }

  previousSelectedId = trackId
  viewer.scene.requestRender()
}

// Hover highlight — bright red + thick, unmistakable
let hoveredTrackId: string | null = null
// rAF batched pick：避免每个 MOUSE_MOVE 都做 scene.pick()，每帧只 pick 一次
let pendingPickPos: Cesium.Cartesian2 | null = null
let lastMousePosition: Cesium.Cartesian2 | null = null
let pickScheduled = false
const HOVER_COLOR = Cesium.Color.fromCssColorString('#ff3333')
const HOVER_WIDTH = 5.0
const NORMAL_ALPHA = 0.88
const RAW_ALPHA = 0.75
const SELECTED_WIDTH = 4.0
const SELECTED_ALPHA = 1.0



/** All tracks render at this exact WGS84 altitude (meters).  Real altitude from
 *  the data is ignored for rendering — only used in labels / hover tooltips. */
const FLAT_ALTITUDE = 10000

/** Extra altitude (meters) for the hover overlay above FLAT_ALTITUDE.
 *  500 m provides wide depth-test margin without perceptible visual offset. */
const HOVER_ALT_MARGIN = 1500

// Dot (billboard) base scale values, multiplied by props.dotScale
const DOT_BASE = 0.7
const DOT_RAW = 0.4
const DOT_SELECTED = 1.2
const DOT_HOVER = 1.3

/** P1: PointPrimitive pixelSize from dot scale (billboard canvas 24px, circle r≈10) */
const POINT_PRIMITIVE_BASE = 12
function pointPrimSize(dotBase: number, source: string): number {
  return POINT_PRIMITIVE_BASE * (dotBase / DOT_BASE) * (props.dotScale[source as DataSource] ?? 1.0)
}

function baseWidth(source: DataSource): number {
  return props.lineWidths[source] ?? 2.0
}

function baseAlpha(source: string): number {
  return source === 'radar_raw' ? 0.6 : NORMAL_ALPHA
}

function applyHoverHighlight(trackId: string) {
  const entry = entityMap.get(trackId)
  if (!entry || !entry.line) return

  // Add overlay polyline — clone all positions at slightly higher altitude
  if (hoverOverlayLines) {
    if (activeOverlayLine) {
      hoverOverlayLines.remove(activeOverlayLine)
      activeOverlayLine = null
    }
    const allPos: Cesium.Cartesian3[] = []
    const HOVER_Z_BIAS = (6371000 + FLAT_ALTITUDE + HOVER_ALT_MARGIN) / (6371000 + FLAT_ALTITUDE)
    const positions = entry.line.positions
    for (let j = 0; j < positions.length; j++) {
      const clone = Cesium.Cartesian3.clone(positions[j])
      Cesium.Cartesian3.multiplyByScalar(clone, HOVER_Z_BIAS, clone)
      allPos.push(clone)
    }
    if (allPos.length >= 2) {
      activeOverlayLine = hoverOverlayLines.add({
        id: `hover::${trackId}`,
        positions: allPos,
        width: HOVER_WIDTH,
        material: Cesium.Material.fromType('Color', { color: HOVER_COLOR }),
        show: true,
      })
    }
  }
  if (entry.pointPrimitive) {
    entry.pointPrimitive.pixelSize = pointPrimSize(DOT_HOVER, entry.source)
    entry.pointPrimitive.color = HOVER_COLOR
  }
}

function removeHoverHighlight() {
  // P2: Remove hover overlay from separate collection — no MATERIAL_INDEX on trackLines
  if (activeOverlayLine && hoverOverlayLines) {
    const overlayId = (activeOverlayLine as any).id
    if (typeof overlayId === 'string' && overlayId.startsWith('hover::')) {
      hoverOverlayLines.remove(activeOverlayLine)
      activeOverlayLine = null
    }
  }
  if (!hoveredTrackId) return
  const entry = entityMap.get(hoveredTrackId)
  if (entry) {
    const originalColor = getLineColor(entry.source as DataSource)
    const isSelected = hoveredTrackId === previousSelectedId
    // P2: trackLines material was NEVER modified by hover — don't touch it
    if (entry.pointPrimitive) {
      entry.pointPrimitive.pixelSize = pointPrimSize(
        isSelected ? DOT_SELECTED : entry.source === 'radar_raw' ? DOT_RAW : DOT_BASE,
        entry.source,
      )
      entry.pointPrimitive.color = originalColor
    }
  }
  hoveredTrackId = null
}

function onMouseMove(movement: Cesium.ScreenSpaceEventHandler.MotionEvent) {
  // rAF 合并：只记录鼠标位置，每帧最多执行一次 pick
  pendingPickPos = movement.endPosition.clone()
  lastMousePosition = pendingPickPos.clone()
  emitViewStatus(lastMousePosition)
  if (!pickScheduled) {
    pickScheduled = true
    requestAnimationFrame(() => {
      pickScheduled = false
      if (pendingPickPos && viewer && !viewer.isDestroyed()) {
        doPick(pendingPickPos)
        pendingPickPos = null
      }
    })
  }
}

function doPick(endPosition: Cesium.Cartesian2) {
  const picked = viewer!.scene.pick(endPosition)
  if (!Cesium.defined(picked) || !picked.id) {
    hideCityHover()
    hidePointDotHover()
    removeHoverHighlight()
    viewer!.scene.requestRender()
    return
  }

  const city = pickedCity(picked)
  if (city) {
    removeHoverHighlight()
    hidePointDotHover()
    showCityHover(city)
    viewer!.scene.requestRender()
    return
  }
  hideCityHover()

  let trackId: string | null = null

  // P1: handle PointPrimitive pick (endpoint dot) or Polyline pick
  if (typeof picked.id === 'string') {
    // Handle point dot pick — pointDotsCollection renders on top, so
    // scene.pick() hits PointPrimitives before the underlying polylines.
    if (picked.id.startsWith('pointdot::')) {
      const parts = picked.id.split('::') // ["pointdot", trackKey, index]
      if (parts.length === 3 && entityMap.has(parts[1])) {
        trackId = parts[1]
      }
    } else if (picked.id.startsWith('hover::')) {
      // Handle hover overlay picking — Strip hover:: prefix to get the underlying trackKey.
      const underlyingId = picked.id.slice('hover::'.length)
      if (entityMap.has(underlyingId)) trackId = underlyingId
    } else if (entityMap.has(picked.id)) {
      // Direct trackKey match (PointPrimitive)
      trackId = picked.id
    } else if (picked.id.endsWith('::dot')) {
      // Label pick → strip ::dot suffix
      const baseId = picked.id.slice(0, picked.id.lastIndexOf('::'))
      if (entityMap.has(baseId)) trackId = baseId
    } else {
      // Try resolving segment/bridge/trail polyline ID to trackKey
      const resolved = extractTrackKeyFromPolylineId(picked.id)
      if (resolved && entityMap.has(resolved)) trackId = resolved
    }
  } else if (picked.id instanceof Cesium.Entity) {
    const entityId = (picked.id as Cesium.Entity).id
    if (!entityId || typeof entityId !== 'string' || entityId.startsWith('flag-') || entityId.startsWith('pointdot::')) {
      removeHoverHighlight()
      viewer!.scene.requestRender()
      return
    }
    trackId = entityId.endsWith('::dot')
      ? entityId.slice(0, entityId.lastIndexOf('::'))
      : entityId
  } else {
    removeHoverHighlight()
    viewer!.scene.requestRender()
    return
  }

  if (!trackId || !entityMap.has(trackId)) {
    // PointPrimitive pick may not expose its id as a plain string to scene.pick().
    // Fall back to drillPick to find a pointdot:: id underneath the cursor.
    const drillResults = viewer!.scene.drillPick(endPosition, 8)
    for (const dp of drillResults) {
      const dpId = typeof dp.id === 'string' ? dp.id : dp.id instanceof Cesium.Entity ? (dp.id as Cesium.Entity).id : undefined
      if (typeof dpId === 'string' && dpId.startsWith('pointdot::')) {
        const parts = dpId.split('::')
        if (parts.length === 3 && entityMap.has(parts[1])) {
          trackId = parts[1]
          break
        }
      }
    }
  }

  // ── Magnetic snap: wider area search when cursor is near but not on a track ──
  if (!trackId || !entityMap.has(trackId)) {
    const SNAP_RADIUS = 20 // px — cursor within this distance snaps to nearest track
    const snapResults = viewer!.scene.drillPick(endPosition, 30, SNAP_RADIUS * 2, SNAP_RADIUS * 2)
    for (const sp of snapResults) {
      const spId = typeof sp.id === 'string' ? sp.id : sp.id instanceof Cesium.Entity ? (sp.id as Cesium.Entity).id : undefined
      if (typeof spId !== 'string') continue

      let candidateId: string | null = null
      if (spId.startsWith('pointdot::')) {
        const parts = spId.split('::')
        if (parts.length === 3) candidateId = parts[1]
      } else if (spId.startsWith('hover::')) {
        candidateId = spId.slice('hover::'.length)
      } else if (entityMap.has(spId)) {
        candidateId = spId
      } else if (spId.endsWith('::dot')) {
        candidateId = spId.slice(0, spId.lastIndexOf('::'))
      } else {
        const resolved = extractTrackKeyFromPolylineId(spId)
        if (resolved && entityMap.has(resolved)) candidateId = resolved
      }

      if (candidateId && entityMap.has(candidateId)) {
        trackId = candidateId
        break
      }
    }
  }

  if (!trackId || !entityMap.has(trackId)) {
    removeHoverHighlight()
    viewer!.scene.requestRender()
    return
  }
  if (hoveredTrackId === trackId) {
    // Same track — check if hovering a specific point dot via screen-space proximity
    const dotHit = checkPointDotHit(trackId, endPosition)
    if (dotHit !== null) {
      if (hoveredPointDotId === dotHit.id) return
      hidePointDotHover()
      hoveredPointDotId = dotHit.id
      showPointDotHover(trackId, dotHit.index)
      viewer!.scene.requestRender()
    } else {
      hidePointDotHover()
    }
    return
  }

  removeHoverHighlight()
  hoveredTrackId = trackId
  applyHoverHighlight(trackId)

  // Check for point dot under cursor
  const dotHit = checkPointDotHit(trackId, endPosition)
  if (dotHit !== null) {
    hoveredPointDotId = dotHit.id
    showPointDotHover(trackId, dotHit.index)
  } else {
    hidePointDotHover()
  }

  viewer!.scene.requestRender()
}

/** Screen-space proximity check: find the closest visible point dot to the mouse cursor */
function checkPointDotHit(trackId: string, mousePos: Cesium.Cartesian2): { id: string; index: number } | null {
  if (!viewer || !pointDotsCollection) return null
  const primitives = pointDotEntityMap.get(trackId)
  if (!primitives || primitives.length === 0) return null

  const threshold = Math.max(pointDotPixelSize + 4, 10) // px radius
  const thresholdSq = threshold * threshold
  let bestIdx = -1
  let bestDistSq = Infinity
  const _scratch = new Cesium.Cartesian2()

  for (let i = 0; i < primitives.length; i++) {
    const prim = primitives[i]
    if (!prim.show) continue
    const screenPos = Cesium.SceneTransforms.worldToWindowCoordinates(
      viewer.scene,
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

watch(() => props.selectedId, (newId) => {
  applyHighlight(newId ?? null)
})

// Sync flag entities reactively
watch(flags, () => {
  syncFlagEntities()
}, { deep: false })

// Re-sync flag entities when flag scale changes
watch(flagScale, () => {
  syncFlagEntities()
})

// Draw great-circle arc between selected flags
watch(selectedPair, (pair) => {
  if (arcEntity && viewer) {
    viewer.entities.remove(arcEntity)
    arcEntity = undefined
  }
  if (pair && viewer) {
    const [a, b] = pair
    const positions: Cesium.Cartesian3[] = []
    const start = Cesium.Cartographic.fromDegrees(a.longitude, a.latitude)
    const end = Cesium.Cartographic.fromDegrees(b.longitude, b.latitude)
    const geodesic = new Cesium.EllipsoidGeodesic(start, end)
    const segments = 64
    for (let i = 0; i <= segments; i++) {
      const p = geodesic.interpolateUsingFraction(i / segments)
      positions.push(Cesium.Cartesian3.fromRadians(p.longitude, p.latitude, 0))
    }
    arcEntity = viewer.entities.add({
      polyline: {
        positions,
        width: 2,
        material: Cesium.Color.YELLOW.withAlpha(0.8),
        clampToGround: false,
      },
    })
  }
})

watch(showLabels, (val) => {
  for (const [, entities] of entityMap) {
    if (entities.label) {
      entities.label.text = val ? entities.labelText : ''
      entities.label.font = val ? LABEL_FONT_LARGE : LABEL_FONT_BASE
    }
  }
  viewer?.scene.requestRender()
})

// ── Track point dots watchers ──

// Update point dot pixel size when slider changes
watch(trackPointDotScale, (newScale) => {
  pointDotPixelSize = Math.max(2.0, 7.0 * newScale)
  refreshPointDotSizes()
})

// Update point dot colors when custom color or line color changes
watch([pointDotColors, lineColors], () => {
  refreshPointDotColors()
}, { deep: true })

// Sync global point dots when toggle changes
watch(showAllPointDots, (val) => {
  if (!val) {
    // Global turned off: clear the hidden list (only meaningful in global mode)
    globalHiddenTrackKeys.value = new Set()
  }
  syncGlobalPointDots()
})

// Clear all point dots when requested from settings
watch(clearAllCounter, () => {
  clearAllPointDots()
})

// Clean up point dots when tracks change (filtered out / removed)
watch(
  () => props.tracks,
  () => {
    syncGlobalPointDots()
  },
  { deep: false },
)

function resetView() {
  if (!viewer) return
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(110, 25, 12000000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    duration: 1.0,
  })
}

function flyToTrack(track: Track) {
  if (!viewer || track.positions.length === 0) return
  const last = track.positions[track.positions.length - 1]
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(last.longitude, last.latitude, FLAT_ALTITUDE + 8000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-45),
      roll: 0,
    },
    duration: 1.5,
  })
}

// ── 航迹点迹渲染 ──

/** Generate a high-contrast color from a hex line color.
 *  Uses HSL complementary (hue +180°) with boosted saturation and mid lightness
 *  so dots stand out against the track line and the dark map background. */
function contrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6
      : max === g ? ((b - r) / d + 2) / 6
      : ((r - g) / d + 4) / 6
  }
  // Rotate hue 180°, boost saturation, fix mid-bright lightness
  h = (h + 0.5) % 1
  s = Math.max(s, 0.75)
  const nl = 0.55
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = nl < 0.5 ? nl * (1 + s) : nl + s - nl * s
  const p = 2 * nl - q
  const nr = Math.round(hue2rgb(p, q, h + 1 / 3) * 255)
  const ng = Math.round(hue2rgb(p, q, h) * 255)
  const nb = Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`
}

/** Resolve the color for a track's point dots: custom override > auto contrast of line color */
function getPointDotColor(source: DataSource): string {
  const custom = pointDotColors[source]
  if (custom) return custom
  return contrastColor(getEffectiveHex(source))
}

// ── 右键上下文菜单动作 ──
function closeContextMenu() {
  contextMenu.value.visible = false
}

function handleContextRename() {
  const flag = flags.value.find((f) => f.id === contextMenu.value.flagId)
  if (!flag) return
  const newLabel = prompt('请输入新名称：', flag.label)
  if (newLabel && newLabel.trim()) {
    renameFlag(flag.id, newLabel.trim())
  }
  closeContextMenu()
}

function handleContextDelete() {
  const flag = flags.value.find((f) => f.id === contextMenu.value.flagId)
  if (!flag) return
  if (confirm(`确定要删除旗标「${flag.label}」吗？`)) {
    removeFlag(flag.id)
  }
  closeContextMenu()
}

function handleChangeFlagStyle(style: string) {
  const flagId = contextMenu.value.flagId
  if (!flagId) return
  setFlagStyle(flagId, style)
  closeContextMenu()
}

function getFlagStyle(flagId: string): string {
  const flag = flags.value.find((f) => f.id === flagId)
  return flag?.style || 'flag-pin'
}

function handleContextShowPointDots() {
  showManualPointDots(contextMenu.value.trackId)
  closeContextMenu()
}

function handleContextHidePointDots() {
  hidePointDotsForTrack(contextMenu.value.trackId)
  closeContextMenu()
}

function handleContextShowDetail() {
  const trackId = contextMenu.value.trackId
  // Extract ICAO and source from trackKey (format: "icao::source")
  const sepIdx = trackId.lastIndexOf('::')
  const icao = sepIdx > 0 ? trackId.substring(0, sepIdx) : trackId
  const source = sepIdx > 0 ? trackId.substring(sepIdx + 2) : ''
  addHighlight(icao)
  emit('show-track-detail', { icao, source })
  closeContextMenu()
}

function handleContextViewPoints() {
  const trackId = contextMenu.value.trackId
  const track = props.tracks.find(t => trackKey(t.id, t.source) === trackId)
  if (track) {
    emit('view-track-points', track)
  }
  closeContextMenu()
}

function handleContextDeleteTrack() {
  const trackId = contextMenu.value.trackId
  const sepIdx = trackId.lastIndexOf('::')
  const icao = sepIdx > 0 ? trackId.substring(0, sepIdx) : trackId
  const source = sepIdx > 0 ? trackId.substring(sepIdx + 2) : ''
  emit('delete-track', { icao, source })
  closeContextMenu()
}

// Watch theme changes to update Cesium background color
watch(activeTheme, () => {
  updateCesiumBackground()
})

// ── Camera state persistence ──

interface CameraState {
  longitude: number
  latitude: number
  height: number
  heading: number
  pitch: number
  roll: number
}

let _cameraSaveTimer: ReturnType<typeof setTimeout> | null = null

function persistCameraState() {
  if (!viewer) return
  const cam = viewer.camera
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

function restoreCameraState() {
  if (!viewer) return
  const raw = getRawSetting('camera.state')
  if (!raw) return false
  try {
    const s: CameraState = JSON.parse(raw)
    if (
      typeof s.longitude !== 'number' || typeof s.latitude !== 'number' ||
      typeof s.height !== 'number' || typeof s.heading !== 'number' ||
      typeof s.pitch !== 'number' || typeof s.roll !== 'number'
    ) return false
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(s.longitude, s.latitude, s.height),
      orientation: {
        heading: s.heading,
        pitch: s.pitch,
        roll: s.roll,
      },
    })
    return true
  } catch {
    return false
  }
}

onMounted(async () => {
  if (!containerRef.value) return

  const port: number = await invoke('get_tile_server_port')
  tileServerPort = port

  viewer = new Cesium.Viewer(containerRef.value, {
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
  // Keep globe-facing occlusion correct: back-side tracks, points, and labels
  // must not draw through the earth when the camera moves.
  viewer.scene.globe.depthTestAgainstTerrain = true
  // Track actual scene render FPS via postRender — fires only when requestRenderMode triggers a real draw
  viewer.scene.postRender.addEventListener(() => {
    const now = performance.now()
    // Start measurement window on first render, not at script load time
    if (fpsLastSampleTime === 0) {
      fpsLastSampleTime = now
      fpsFrameCount = 1
      return
    }
    fpsFrameCount++
    const elapsed = now - fpsLastSampleTime
    // Update FPS every ~500ms for faster response; require ≥5 frames to avoid idle-spike noise
    if (elapsed >= 500 && fpsFrameCount >= 5) {
      const instantFps = fpsFrameCount / (elapsed / 1000)
      // EMA α=0.5 — faster convergence than 0.3, still smooth
      fpsSmoothed = fpsSmoothed === 0 ? instantFps : fpsSmoothed * 0.5 + instantFps * 0.5
      fpsFrameCount = 0
      fpsLastSampleTime = now
    }
    // If no render for >1.5s, reset to 0 (will display as "--" in status bar)
    if (elapsed > 1500) {
      fpsSmoothed = 0
      fpsFrameCount = 0
      fpsLastSampleTime = now
    }
  })
  viewer.camera.percentageChanged = 0.03
  removeCityCameraChanged = viewer.camera.changed.addEventListener(() => {
    // City layer is NOT rebuilt on every camera change — that causes flicker.
    // Instead, we rebuild once on moveEnd after the camera settles.
    emitViewStatus(lastMousePosition)
  })

  currentImageryLayer = viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: `http://127.0.0.1:${port}/tiles/{z}/{x}/{y}.png`,
      minimumLevel: 0,
      maximumLevel: 8,
      tileWidth: 256,
      tileHeight: 256,
    }),
  )
  // P1: PointPrimitiveCollection for fast endpoint dots (one draw call for all tracks)
  pointPrimitives = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection()) as Cesium.PointPrimitiveCollection
  // P2: PolylineCollection for fast track lines (one draw call for all tracks)
  trackLines = viewer.scene.primitives.add(new Cesium.PolylineCollection()) as unknown as Cesium.PolylineCollection
  // Lower endpoint dots and track lines to the bottom so everything renders above them
  viewer.scene.primitives.lowerToBottom(pointPrimitives as any)
  viewer.scene.primitives.lowerToBottom(trackLines as any)
  // P2: Separate collection for hover/select overlay — added AFTER trackLines so renders on top.
  // Using a separate collection avoids MATERIAL_INDEX triggering full VBO rebuild on 3000+ tracks.
  hoverOverlayLines = viewer.scene.primitives.add(new Cesium.PolylineCollection()) as unknown as Cesium.PolylineCollection
  // P1: LabelCollection for track labels — GPU-instanced, one draw call for all labels
  trackLabels = viewer.scene.primitives.add(new Cesium.LabelCollection())
  // P3: PointPrimitiveCollection for track point dots — GPU-instanced, outlined circles
  pointDotsCollection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection())
  // ── 边界层延迟加载：等设置恢复后按可见性加载 ──
  await whenSettingsLoaded()
  applyBoundaryVisibility()
  await loadCityLayer()

  // Raise hover overlay to the top-most layer.  With the 1.002 ECEF bias
  // (~22.7 km altitude) it wins the depth test against all track lines and
  // endpoint dots.  Only the point-dot hover entity (disableDepthTestDistance=∞)
  // renders above it.
  viewer.scene.primitives.raiseToTop(hoverOverlayLines as any)

  // Restore saved camera state, or use default view
  if (!restoreCameraState()) {
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(110, 25, 12000000),
    })
  }

  // Apply theme-aware background color
  updateCesiumBackground()

  // ===== 无极缩放（Stepless Zoom）=====
  // 禁用 Cesium 内置的步进式滚轮缩放
  viewer.scene.screenSpaceCameraController.zoomEventTypes = []

  // 注册原生 wheel 事件，按 deltaY 比例调整相机距离
  const zoomCanvas = viewer.scene.canvas
  const onWheel = (event: WheelEvent) => {
    event.preventDefault()

    // 归一化 delta：deltaMode 0=像素 1=行 2=页
    // 鼠标滚轮一档 ≈ 100px，触摸板连续产生小数值
    let deltaPx = event.deltaY
    if (event.deltaMode === 1) {
      deltaPx = event.deltaY * 33 // 行模式 → 像素
    } else if (event.deltaMode === 2) {
      deltaPx = event.deltaY * 800 // 页模式 → 像素
    }

    // 缩放系数：每 100px 滚轮 ≈ 5% 距离变化（deltaY>0=缩小 deltaY<0=放大）
    const sensitivity = 0.0005
    const zoomFactor = 1 + deltaPx * sensitivity

    const cam = viewer!.camera
    const { globe } = viewer!.scene
    const { width, height } = zoomCanvas

    // 取屏幕中心点，计算到椭球面的投影
    const center = cam.pickEllipsoid(
      new Cesium.Cartesian2(width / 2, height / 2),
      globe.ellipsoid,
    )

    if (Cesium.defined(center)) {
      const direction = Cesium.Cartesian3.subtract(
        cam.position,
        center!,
        new Cesium.Cartesian3(),
      )
      const distance = Cesium.Cartesian3.magnitude(direction)
      const newDistance = Cesium.Math.clamp(
        distance * zoomFactor,
        100,        // 最低 ≈ 100m
        20000000,   // 最高 ≈ 20000km
      )

      const normalized = Cesium.Cartesian3.normalize(direction, new Cesium.Cartesian3())
      const offset = Cesium.Cartesian3.multiplyByScalar(normalized, newDistance, new Cesium.Cartesian3())
      const newPosition = Cesium.Cartesian3.add(center!, offset, new Cesium.Cartesian3())

      cam.position = newPosition
      viewer!.scene.requestRender()
    }
  }
  zoomCanvas.addEventListener('wheel', onWheel, { passive: false })

  // Persist camera state on move end (debounced 500ms)
  viewer.camera.moveEnd.addEventListener(() => {
    if (_cameraSaveTimer) clearTimeout(_cameraSaveTimer)
    _cameraSaveTimer = setTimeout(persistCameraState, 500)
    // Force city layer rebuild after camera stops — correct LOD for final view
    scheduleCityLayerRender(100, true)
  })

  syncEntities(props.tracks)
  syncFlagEntities()

  // LEFT_CLICK handler for track picking (skip flags)
  clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  clickHandler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    const picked = viewer!.scene.pick(movement.position)
    if (!Cesium.defined(picked) || !picked.id) {
      // Delay clearing isolation to allow double-click to cancel it
      if (pendingClearTimeout) clearTimeout(pendingClearTimeout)
      pendingClearTimeout = setTimeout(() => {
        pendingClearTimeout = null
        emit('track-pick', null)
      }, 300)
      return
    }

    // Handle hover overlay pick — the hover overlay (id "hover::{trackKey}")
    // in the separate hoverOverlayLines collection sits on top and gets picked first
    if (typeof picked.id === 'string' && picked.id.startsWith('hover::')) {
      const underlyingId = picked.id.slice('hover::'.length)
      if (entityMap.has(underlyingId)) {
        emit('track-pick', underlyingId)
        return
      }
    }

    // P2: track line pick via PolylineCollection (picked.id may have ::segN suffix)
    let polyTrackId: string | null = null
    if (typeof picked.id === 'string') {
      if (entityMap.has(picked.id)) {
        polyTrackId = picked.id
      } else {
        const resolved = extractTrackKeyFromPolylineId(picked.id)
        if (resolved && entityMap.has(resolved)) polyTrackId = resolved
      }
    }
    if (polyTrackId) {
      emit('track-pick', polyTrackId)
      return
    }
    // P1: Label pick — label id is "{trackKey}::dot"
    if (typeof picked.id === 'string' && picked.id.endsWith('::dot')) {
      const trackId = picked.id.slice(0, picked.id.lastIndexOf('::'))
      if (entityMap.has(trackId)) {
        emit('track-pick', trackId)
        return
      }
    }

    if (!(picked.id instanceof Cesium.Entity)) {
      if (pendingClearTimeout) clearTimeout(pendingClearTimeout)
      pendingClearTimeout = setTimeout(() => {
        pendingClearTimeout = null
        emit('track-pick', null)
      }, 300)
      return
    }
    const entityId = (picked.id as Cesium.Entity).id
    if (entityId && typeof entityId === 'string') {
      // Skip flag entities and point dot entities
      if (entityId.startsWith('flag-') || entityId.startsWith('pointdot::')) {
        return
      }
      const trackId = entityId.endsWith('::dot')
        ? entityId.slice(0, entityId.lastIndexOf('::'))
        : entityId
      if (entityMap.has(trackId)) {
        emit('track-pick', trackId)
        return
      }
    }
    // For clicks on unknown entities, also delay
    if (pendingClearTimeout) clearTimeout(pendingClearTimeout)
    pendingClearTimeout = setTimeout(() => {
      pendingClearTimeout = null
      emit('track-pick', null)
    }, 300)
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

  // MOUSE_MOVE handler for hover highlight
  moveHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  moveHandler.setInputAction(onMouseMove, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

  // Disable default double-click zoom and use for flag placement/removal
  viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(
    Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
  )
  dblClickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  dblClickHandler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    // Cancel any pending clear-isolation from the clicks of this double-click
    if (pendingClearTimeout) {
      clearTimeout(pendingClearTimeout)
      pendingClearTimeout = null
    }
    const picked = viewer!.scene.pick(movement.position)
    if (Cesium.defined(picked) && picked.id instanceof Cesium.Entity) {
      const entityId = picked.id.id
      if (typeof entityId === 'string' && entityId.startsWith('flag-')) {
        const flagId = entityId.slice(5) // remove 'flag-' prefix
        removeFlag(flagId)
        return
      }
    }
    // Place new flag at clicked location
    const cartesian = viewer!.camera.pickEllipsoid(
      movement.position,
      viewer!.scene.globe.ellipsoid,
    )
    if (!Cesium.defined(cartesian)) return
    const cartographic = Cesium.Cartographic.fromCartesian(cartesian)
    const lat = Cesium.Math.toDegrees(cartographic.latitude)
    const lng = Cesium.Math.toDegrees(cartographic.longitude)
    addFlag(lat, lng)
  }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

  // ── 右键旗标上下文菜单 ──
  ctxCanvasEl = viewer.scene.canvas
  statusMouseLeaveFn = () => {
    lastMousePosition = null
    emitViewStatus(null)
  }
  ctxCanvasEl.addEventListener('mouseleave', statusMouseLeaveFn)

  // 方案：用 Cesium 自己的 ScreenSpaceEventHandler（RIGHT_CLICK 必定触发）
  rightClickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  rightClickHandler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    const picked = viewer!.scene.pick(movement.position)
    if (Cesium.defined(picked) && picked.id) {
      // P2: track line pick via PolylineCollection (id may have ::segN / ::bridgeN suffix)
      if (typeof picked.id === 'string') {
        let resolvedId: string | null = null
        if (entityMap.has(picked.id)) {
          resolvedId = picked.id
        } else {
          const resolved = extractTrackKeyFromPolylineId(picked.id)
          if (resolved && entityMap.has(resolved)) resolvedId = resolved
        }
        if (resolvedId && hoveredTrackId === resolvedId) {
          contextMenu.value = {
            visible: true,
            x: movement.position.x,
            y: movement.position.y,
            type: 'track',
            flagId: '',
            flagLabel: '',
            trackId: resolvedId,
          }
          return
        }
      }
      // P2-overlay: hover overlay polyline id is "hover::{trackKey}" — strip prefix
      if (typeof picked.id === 'string' && picked.id.startsWith('hover::')) {
        const trackId = picked.id.slice('hover::'.length)
        if (entityMap.has(trackId) && hoveredTrackId === trackId) {
          contextMenu.value = {
            visible: true,
            x: movement.position.x,
            y: movement.position.y,
            type: 'track',
            flagId: '',
            flagLabel: '',
            trackId,
          }
          return
        }
      }
      // P1: Label pick — label id is "{trackKey}::dot"
      if (typeof picked.id === 'string' && picked.id.endsWith('::dot')) {
        const trackId = picked.id.slice(0, picked.id.lastIndexOf('::'))
        if (entityMap.has(trackId) && hoveredTrackId === trackId) {
          contextMenu.value = {
            visible: true,
            x: movement.position.x,
            y: movement.position.y,
            type: 'track',
            flagId: '',
            flagLabel: '',
            trackId,
          }
          return
        }
      }
      // P0: point dot billboard pick — id is "pointdot::{trackKey}::{index}"
      if (typeof picked.id === 'string' && picked.id.startsWith('pointdot::')) {
        const lastSep = (picked.id as string).lastIndexOf('::')
        if (lastSep > 'pointdot::'.length) {
          const trackId = (picked.id as string).slice('pointdot::'.length, lastSep)
          if (entityMap.has(trackId)) {
            contextMenu.value = {
              visible: true,
              x: movement.position.x,
              y: movement.position.y,
              type: 'track',
              flagId: '',
              flagLabel: '',
              trackId,
            }
            return
          }
        }
      }

      if (picked.id instanceof Cesium.Entity) {
        const entityId = picked.id.id
        if (typeof entityId === 'string' && entityId.startsWith('flag-')) {
          const flagId = entityId.slice(5)
          const flag = flags.value.find((f) => f.id === flagId)
          if (flag) {
            contextMenu.value = {
              visible: true,
              x: movement.position.x,
              y: movement.position.y,
              type: 'flag',
              flagId: flag.id,
              flagLabel: flag.label,
              trackId: '',
            }
            return
          }
        }

        // 航迹右键菜单（仅在高亮状态下弹出）
        const entityIdStr = entityId as string
        let trackId: string | null = null
        if (entityIdStr.startsWith('pointdot::')) {
          // pointdot::{trackKey}::{index} → extract trackKey
          const lastSep = entityIdStr.lastIndexOf('::')
          if (lastSep > 'pointdot::'.length) {
            trackId = entityIdStr.slice('pointdot::'.length, lastSep)
          }
        } else if (entityIdStr.endsWith('::dot')) {
          trackId = entityIdStr.slice(0, entityIdStr.lastIndexOf('::'))
        } else if (entityMap.has(entityIdStr)) {
          trackId = entityIdStr
        } else {
          // Try resolving segment/bridge/trail polyline ID
          const resolved = extractTrackKeyFromPolylineId(entityIdStr)
          if (resolved && entityMap.has(resolved)) trackId = resolved
        }
        if (trackId && entityMap.has(trackId) && hoveredTrackId === trackId) {
          contextMenu.value = {
            visible: true,
            x: movement.position.x,
            y: movement.position.y,
            type: 'track',
            flagId: '',
            flagLabel: '',
            trackId,
          }
          return
        }
      }
    }
    // 右键空地/非旗标实体 → 关闭菜单
    closeContextMenu()
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)

  // 阻止浏览器默认右键菜单
  ctxMenuFn = (e: MouseEvent) => e.preventDefault()
  ctxCanvasEl.addEventListener('contextmenu', ctxMenuFn)

  // 点击菜单外部关闭
  ctxClickOutsideFn = () => closeContextMenu()
  document.addEventListener('click', ctxClickOutsideFn)

  // Esc 关闭菜单
  ctxKeyFn = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeContextMenu()
  }
  document.addEventListener('keydown', ctxKeyFn)

  emitViewStatus(null)

  // Signal that Cesium map is fully initialized
  resolveMapReady()
})

onUnmounted(() => {
  // Final camera state save + cleanup
  if (_cameraSaveTimer) {
    clearTimeout(_cameraSaveTimer)
    _cameraSaveTimer = null
  }
  persistCameraState()

  clearAllPointDots()
  clearAllEntities()
  clearAllFlagEntities()
  clearBoundaryLayers()
  clearCityLayer()
  removeCityHover()
  removePointDotHover()
  if (cityLayerDebounce) {
    clearTimeout(cityLayerDebounce)
    cityLayerDebounce = null
  }
  if (removeCityCameraChanged) {
    removeCityCameraChanged()
    removeCityCameraChanged = null
  }
  if (arcEntity && viewer) {
    viewer.entities.remove(arcEntity)
    arcEntity = undefined
  }
  if (dblClickHandler) {
    dblClickHandler.destroy()
    dblClickHandler = null
  }
  if (rightClickHandler) {
    rightClickHandler.destroy()
    rightClickHandler = null
  }
  if (clickHandler) {
    clickHandler.destroy()
    clickHandler = null
  }
  if (moveHandler) {
    moveHandler.destroy()
    moveHandler = null
  }
  // rAF 合并 pick 状态清理
  pendingPickPos = null
  lastMousePosition = null
  pickScheduled = false
  // 清理右键上下文菜单事件监听
  if (ctxCanvasEl && ctxMenuFn) {
    ctxCanvasEl.removeEventListener('contextmenu', ctxMenuFn)
  }
  if (ctxCanvasEl && statusMouseLeaveFn) {
    ctxCanvasEl.removeEventListener('mouseleave', statusMouseLeaveFn)
  }
  if (ctxClickOutsideFn) {
    document.removeEventListener('click', ctxClickOutsideFn)
  }
  if (ctxKeyFn) {
    document.removeEventListener('keydown', ctxKeyFn)
  }
  ctxMenuFn = null
  ctxClickOutsideFn = null
  ctxKeyFn = null
  statusMouseLeaveFn = null
  ctxCanvasEl = null
  if (viewer) {
    pointPrimitives = null
    trackLines = null
    hoverOverlayLines = null
    activeOverlayLine = null
    trackLabels = null
    pointDotEntityMap.clear()
    if (pointDotsCollection) {
      pointDotsCollection.removeAll()
    }
    pointDotsCollection = null
    viewer.destroy()
    viewer = null
  }
})

function switchTileLayer(maxZoom?: number) {
  if (!viewer || tileServerPort === 0) return
  const maxLevel = maxZoom ?? 8
  if (currentImageryLayer) {
    viewer.imageryLayers.remove(currentImageryLayer, true)
    currentImageryLayer = null
  }
  currentImageryLayer = viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: `http://127.0.0.1:${tileServerPort}/tiles/{z}/{x}/{y}.png`,
      minimumLevel: 0,
      maximumLevel: maxLevel,
      tileWidth: 256,
      tileHeight: 256,
    }),
  )
  viewer.scene.requestRender()
}

function flyToFlag(flag: Flag) {
  if (!viewer) return
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(flag.longitude, flag.latitude, 50000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    duration: 1.0,
  })
}

defineExpose({ getViewer: () => viewer, flyToTrack, flyToFlag, resetView, switchTileLayer, whenMapReady: () => mapReadyPromise })
</script>

<style scoped>
.cesium-container {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

/* 隐藏 Cesium ion logo */
.cesium-container :deep(.cesium-widget-credits) {
  display: none !important;
}

/* ── 右键上下文菜单 ── */
.context-menu {
  position: absolute;
  z-index: 1000;
  min-width: 120px;
  background: var(--bg-panel, #1e1e2e);
  border: 1px solid var(--border-color, #3a3a5c);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  padding: 4px 0;
  font-size: 13px;
  user-select: none;
}

.context-menu-item {
  padding: 8px 16px;
  cursor: pointer;
  color: var(--text-primary, #cdd6f4);
  transition: background 0.15s;
}

.context-menu-item:hover {
  background: var(--accent-primary, #3b82f6);
  color: #fff;
}

.context-menu-danger:hover {
  background: #ef4444;
  color: #fff;
}

.context-menu-has-sub {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
}

.submenu-arrow {
  margin-left: auto;
  font-size: 10px;
  opacity: 0.6;
}

.submenu-dropdown {
  display: none;
  position: absolute;
  left: 100%;
  top: 0;
  min-width: 100px;
  background: var(--bg-panel, #1e1e2e);
  border: 1px solid var(--border-color, #3a3a5c);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  padding: 4px 0;
}

.context-menu-has-sub:hover .submenu-dropdown {
  display: block;
}

.submenu-item {
  padding: 8px 16px;
  cursor: pointer;
  color: var(--text-primary, #cdd6f4);
  transition: background 0.15s;
  white-space: nowrap;
}

.submenu-item:hover {
  background: var(--accent-primary, #3b82f6);
  color: #fff;
}

.submenu-item.active {
  color: var(--accent-primary, #3b82f6);
  font-weight: 600;
}

.submenu-item.active::before {
  content: '✓ ';
}
</style>
