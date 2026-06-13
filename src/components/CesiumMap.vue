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
import { Pencil, Trash2, Dot, Circle, FileText, ClipboardList } from '@lucide/vue'
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
  'view-status': [payload: { cameraHeightKm: number; longitude: number; latitude: number }]
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
/** P3: Custom WebGL point cloud renderer for track point dots — GPU shader with outlined circles */
let dotCloudGl: WebGLRenderingContext | null = null
let dotCloudProgram: WebGLProgram | null = null
/** Cached WebGL locations for performance */
let dotCloud_uMVP: WebGLUniformLocation | null = null
let dotCloud_uPSize: WebGLUniformLocation | null = null
let dotCloud_aPos = -1
let dotCloud_aCol = -1
let dotCloudPosBuf: WebGLBuffer | null = null
let dotCloudColorBuf: WebGLBuffer | null = null
let dotCloudVertexCount = 0
let dotCloudRemovePostRender: (() => void) | null = null
let currentImageryLayer: Cesium.ImageryLayer | null = null
let tileServerPort = 0
let clickHandler: Cesium.ScreenSpaceEventHandler | null = null
let dblClickHandler: Cesium.ScreenSpaceEventHandler | null = null
let rightClickHandler: Cesium.ScreenSpaceEventHandler | null = null
let moveHandler: Cesium.ScreenSpaceEventHandler | null = null
let pendingClearTimeout: ReturnType<typeof setTimeout> | null = null
let boundaryDataSources = new Map<BoundaryLayerKey, Cesium.GeoJsonDataSource>()
/** Cached flat arrays of polyline entities — avoids iterating dataSource.entities.values each time */
let boundaryPolylines = new Map<BoundaryLayerKey, Cesium.Entity[]>()
let cityPointCollection: Cesium.PointPrimitiveCollection | undefined
let cityLabelCollection: Cesium.LabelCollection | undefined
let cityFeatures: CityFeature[] = []
let cityPickMap = new Map<string, CityFeature>()
let cityHoverEntity: Cesium.Entity | undefined
let removeCityCameraChanged: (() => void) | null = null

// 右键上下文菜单 — 原生事件监听器引用（用于 onUnmounted 清理）
let ctxMenuFn: ((e: MouseEvent) => void) | null = null
let ctxClickOutsideFn: (() => void) | null = null
let ctxKeyFn: ((e: KeyboardEvent) => void) | null = null
let ctxCanvasEl: HTMLCanvasElement | null = null
let statusMouseLeaveFn: (() => void) | null = null
const { getEffectiveHex, lineColors } = useLineColor()

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
const { flags, addFlag, removeFlag, renameFlag, selectedPair } = useFlags()
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
/** Rendered point dot metadata, grouped by trackKey: [startIndex, count] in GPU buffers */
const pointDotEntityMap = new Map<string, { startIdx: number; count: number; ids: string[] }>()
/** Flat typed arrays for GPU buffers */
let dotCloudPositions = new Float32Array(0)
let dotCloudColors = new Float32Array(0)
/** Last visible point dot index during replay, per trackKey. Used to avoid redundant updates. */
const pointDotLastLo = new Map<string, number>()

/** Check whether point dots are currently rendered for a given trackKey */
function isTrackShowingDots(trackKey: string): boolean {
  return pointDotEntityMap.has(trackKey)
}

// ═══════════════════════════════════════════
// P3: Custom WebGL Point Cloud Renderer
// Renders outlined circles via GL_POINTS + custom GLSL shaders
// ═══════════════════════════════════════════

const DOT_CLOUD_VS = /* glsl */`
attribute vec3 a_position;
attribute vec3 a_color;
varying vec3 v_color;
uniform mat4 u_mvp;
uniform float u_pointSize;
void main() {
  gl_Position = u_mvp * vec4(a_position, 1.0);
  gl_PointSize = u_pointSize;
  v_color = a_color;
}`

const DOT_CLOUD_FS = /* glsl */`
precision mediump float;
varying vec3 v_color;
void main() {
  float dist = distance(gl_PointCoord, vec2(0.5));
  float radius = 0.5;
  float outlineWidth = 0.08;
  if (dist > radius) discard;
  if (dist > radius - outlineWidth) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.85);
  } else {
    gl_FragColor = vec4(v_color, 0.9);
  }
}`

function initDotCloudRenderer(scene: Cesium.Scene) {
  const canvas = scene.canvas
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
  if (!gl) { console.error('[dotcloud] WebGL context unavailable'); return }
  dotCloudGl = gl as WebGLRenderingContext

  // Compile vertex shader
  const vs = dotCloudGl.createShader(dotCloudGl.VERTEX_SHADER)!
  dotCloudGl.shaderSource(vs, DOT_CLOUD_VS)
  dotCloudGl.compileShader(vs)
  if (!dotCloudGl.getShaderParameter(vs, dotCloudGl.COMPILE_STATUS)) {
    console.error('[dotcloud] VS error:', dotCloudGl.getShaderInfoLog(vs))
  }

  // Compile fragment shader
  const fs = dotCloudGl.createShader(dotCloudGl.FRAGMENT_SHADER)!
  dotCloudGl.shaderSource(fs, DOT_CLOUD_FS)
  dotCloudGl.compileShader(fs)
  if (!dotCloudGl.getShaderParameter(fs, dotCloudGl.COMPILE_STATUS)) {
    console.error('[dotcloud] FS error:', dotCloudGl.getShaderInfoLog(fs))
  }

  // Link program
  dotCloudProgram = dotCloudGl.createProgram()!
  dotCloudGl.attachShader(dotCloudProgram, vs)
  dotCloudGl.attachShader(dotCloudProgram, fs)
  dotCloudGl.linkProgram(dotCloudProgram)
  if (!dotCloudGl.getShaderParameter(dotCloudProgram, dotCloudGl.LINK_STATUS as number)) {
    console.error('[dotcloud] Link error:', dotCloudGl.getProgramInfoLog(dotCloudProgram))
  }

  // Create buffers
  dotCloudPosBuf = dotCloudGl.createBuffer()
  dotCloudColorBuf = dotCloudGl.createBuffer()

  // Cache attribute/uniform locations (unchanging after program link)
  dotCloud_uMVP = dotCloudGl.getUniformLocation(dotCloudProgram, 'u_mvp')
  dotCloud_uPSize = dotCloudGl.getUniformLocation(dotCloudProgram, 'u_pointSize')
  dotCloud_aPos = dotCloudGl.getAttribLocation(dotCloudProgram, 'a_position')
  dotCloud_aCol = dotCloudGl.getAttribLocation(dotCloudProgram, 'a_color')

  // Register postRender hook — draws after Cesium for correct depth occlusion
  dotCloudRemovePostRender = scene.postRender.addEventListener(() => {
    if (!dotCloudGl || !dotCloudProgram || !dotCloudPosBuf || !dotCloudColorBuf || dotCloudVertexCount === 0) return

    const gl = dotCloudGl
    gl.useProgram(dotCloudProgram)

    // MVP: Cesium camera matrices
    const camera = scene.camera
    const mvp = new Cesium.Matrix4()
    Cesium.Matrix4.multiply(camera.frustum.projectionMatrix, camera.viewMatrix, mvp)
    gl.uniformMatrix4fv(dotCloud_uMVP, false, new Float32Array([
      mvp[0], mvp[1], mvp[2], mvp[3],
      mvp[4], mvp[5], mvp[6], mvp[7],
      mvp[8], mvp[9], mvp[10], mvp[11],
      mvp[12], mvp[13], mvp[14], mvp[15],
    ]))
    gl.uniform1f(dotCloud_uPSize, dotCloudPointSize)

    // Bind position
    gl.bindBuffer(gl.ARRAY_BUFFER, dotCloudPosBuf)
    gl.enableVertexAttribArray(dotCloud_aPos)
    gl.vertexAttribPointer(dotCloud_aPos, 3, gl.FLOAT, false, 0, 0)

    // Bind color
    gl.bindBuffer(gl.ARRAY_BUFFER, dotCloudColorBuf)
    gl.enableVertexAttribArray(dotCloud_aCol)
    gl.vertexAttribPointer(dotCloud_aCol, 3, gl.FLOAT, false, 0, 0)

    // State
    gl.enable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    // Draw
    gl.drawArrays(gl.POINTS, 0, dotCloudVertexCount)
  })
}

function rebuildDotCloudBuffers() {
  const gl = dotCloudGl
  if (!gl || !dotCloudPosBuf || !dotCloudColorBuf) return

  dotCloudVertexCount = dotCloudPositions.length / 3

  gl.bindBuffer(gl.ARRAY_BUFFER, dotCloudPosBuf)
  gl.bufferData(gl.ARRAY_BUFFER, dotCloudPositions, gl.STATIC_DRAW)

  gl.bindBuffer(gl.ARRAY_BUFFER, dotCloudColorBuf)
  gl.bufferData(gl.ARRAY_BUFFER, dotCloudColors, gl.STATIC_DRAW)

  viewer?.scene.requestRender()
}

function destroyDotCloudRenderer() {
  if (dotCloudRemovePostRender) {
    dotCloudRemovePostRender()
    dotCloudRemovePostRender = null
  }
  const gl = dotCloudGl
  if (gl && dotCloudProgram) {
    gl.deleteProgram(dotCloudProgram)
    dotCloudProgram = null
    dotCloud_uMVP = null
    dotCloud_uPSize = null
    dotCloud_aPos = -1
    dotCloud_aCol = -1
  }
  if (gl && dotCloudPosBuf) {
    gl.deleteBuffer(dotCloudPosBuf)
    dotCloudPosBuf = null
  }
  if (gl && dotCloudColorBuf) {
    gl.deleteBuffer(dotCloudColorBuf)
    dotCloudColorBuf = null
  }
  dotCloudGl = null
  dotCloudVertexCount = 0
  dotCloudPositions = new Float32Array(0)
  dotCloudColors = new Float32Array(0)
}

/** Rebuild all GPU position/color arrays from track position data */
function packageDotCloudBuffers(tracks: Track[]) {
  const entries: { tKey: string; ids: string[] }[] = []
  for (const track of tracks) {
    const tKey = trackKey(track.id, track.source)
    const manual = manualPointDotsTrackIds.value.has(tKey)
    const global = showAllPointDots.value && !globalHiddenTrackKeys.value.has(tKey)
    if (!manual && !global) continue
    const ids = track.positions.map((_, i) => `pointdot::${tKey}::${i}`)
    entries.push({ tKey, ids })
  }

  const totalCount = entries.reduce((sum, e) => sum + e.ids.length, 0)
  const positions = new Float32Array(totalCount * 3)
  const colorsArr = new Float32Array(totalCount * 3)

  let offset = 0
  for (const { tKey, ids } of entries) {
    const track = tracks.find(t => trackKey(t.id, t.source) === tKey)
    if (!track) continue
    const color = getPointDotColor(track.source)
    const cr = parseInt(color.slice(1, 3), 16) / 255
    const cg = parseInt(color.slice(3, 5), 16) / 255
    const cb = parseInt(color.slice(5, 7), 16) / 255

    for (let i = 0; i < ids.length; i++) {
      const p = track.positions[i]
      const lon = Number(p.longitude)
      const lat = Number(p.latitude)
      const alt = Number(p.altitude)
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        const cart = Cesium.Cartesian3.fromDegrees(lon, lat, Number.isFinite(alt) ? alt : 0)
        const pi = (offset + i) * 3
        positions[pi] = cart.x
        positions[pi + 1] = cart.y
        positions[pi + 2] = cart.z
        colorsArr[pi] = cr
        colorsArr[pi + 1] = cg
        colorsArr[pi + 2] = cb
      }
    }

    pointDotEntityMap.set(tKey, { startIdx: offset, count: ids.length, ids })
    offset += ids.length
  }

  // Clean up pointDotEntityMap for tracks no longer showing dots
  for (const [tKey] of pointDotEntityMap) {
    if (!entries.find(e => e.tKey === tKey)) {
      pointDotEntityMap.delete(tKey)
    }
  }

  dotCloudPositions = positions
  dotCloudColors = colorsArr
  rebuildDotCloudBuffers()
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
  /** P2: Polyline in PolylineCollection — fast GPU-instanced rendering */
  line: Cesium.Polyline | undefined
  /** P1: Label in LabelCollection — GPU-instanced, one draw call for all labels */
  label: Cesium.Label | undefined
  /** P1: PointPrimitive for endpoint dot — replaces billboard image */
  pointPrimitive: Cesium.PointPrimitive | undefined
  source: string
  labelText: string
  /** Mutable holder for current polyline positions — updated each replay frame */
  trailRef: { positions: Cesium.Cartesian3[] }
  /** Last lo index from binary search — polyline only updated when this advances */
  lastTrailLo: number
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

async function loadBoundaryLayers() {
  if (!viewer) return

  const results = await Promise.allSettled(
    BOUNDARY_LAYERS.map(async (layer) => {
      const dataSource = await Cesium.GeoJsonDataSource.load(layer.url, {
        stroke: Cesium.Color.fromCssColorString(boundaryColors[layer.key]).withAlpha(layer.alpha),
        fill: Cesium.Color.TRANSPARENT,
        strokeWidth: boundaryWidths[layer.key],
        markerSize: 0,
        clampToGround: true,
      })
      await viewer?.dataSources.add(dataSource)
      dataSource.show = boundaryVisible[layer.key]
      boundaryDataSources.set(layer.key, dataSource)

      // Pre-cache polyline entities for fast width updates — avoids
      // iterating dataSource.entities.values on every slider tick.
      const polylines: Cesium.Entity[] = []
      for (const entity of dataSource.entities.values) {
        if (entity.polyline) polylines.push(entity)
      }
      boundaryPolylines.set(layer.key, polylines)
      console.log(`[boundary] ${layer.key}: cached ${polylines.length} polyline entities`)

      return dataSource
    }),
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('Failed to load Natural Earth boundary layer:', result.reason)
    }
  }

  viewer?.scene.requestRender()
}

function clearBoundaryLayers() {
  if (!viewer) {
    boundaryDataSources.clear()
    boundaryPolylines.clear()
    return
  }
  for (const dataSource of boundaryDataSources.values()) {
    viewer.dataSources.remove(dataSource, true)
  }
  boundaryDataSources.clear()
  boundaryPolylines.clear()
}

/** Toggle boundary visibility — only flips dataSource.show per layer, does NOT iterate entities */
function applyBoundaryVisibility() {
  for (const layer of BOUNDARY_LAYERS) {
    const dataSource = boundaryDataSources.get(layer.key)
    if (!dataSource) continue
    dataSource.show = boundaryVisible[layer.key]
  }
}

/** Update stroke width for a single boundary layer (uses cached polyline array) */
function applyBoundaryWidth(layerKey: BoundaryLayerKey) {
  const polylines = boundaryPolylines.get(layerKey)
  if (!polylines || polylines.length === 0) return
  const width = boundaryWidths[layerKey]
  const ds = boundaryDataSources.get(layerKey)
  ds?.entities.suspendEvents()
  for (const entity of polylines) {
    ;(entity.polyline as any).width = width
  }
  ds?.entities.resumeEvents()
}

/** Update stroke width for all boundary layers */
function applyAllBoundaryWidths() {
  for (const layer of BOUNDARY_LAYERS) {
    applyBoundaryWidth(layer.key)
  }
}

/** Update stroke color for a single boundary layer (uses cached polyline array) */
function applyBoundaryColor(layerKey: BoundaryLayerKey) {
  const polylines = boundaryPolylines.get(layerKey)
  if (!polylines || polylines.length === 0) return
  const color = boundaryColors[layerKey]
  const layerConfig = BOUNDARY_LAYERS.find(l => l.key === layerKey)
  const alpha = layerConfig?.alpha ?? 0.55
  const ds = boundaryDataSources.get(layerKey)
  ds?.entities.suspendEvents()
  for (const entity of polylines) {
    ;(entity.polyline as any).material = Cesium.Color.fromCssColorString(color).withAlpha(alpha)
  }
  ds?.entities.resumeEvents()
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

  emit('view-status', { cameraHeightKm, longitude, latitude })
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

function removeCityHover() {
  if (viewer && cityHoverEntity) {
    viewer.entities.remove(cityHoverEntity)
  }
  cityHoverEntity = undefined
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

function scheduleCityLayerRender(delay = 120) {
  if (cityLayerDebounce) clearTimeout(cityLayerDebounce)
  cityLayerDebounce = setTimeout(() => {
    cityLayerDebounce = null
    renderCityLayer()
  }, delay)
}

function renderCityLayer() {
  if (!viewer) return
  clearCityLayer()
  if (!cityLayer.visible || cityFeatures.length === 0) {
    hideCityHover()
    viewer.scene.requestRender()
    return
  }

  const pointColor = Cesium.Color.fromCssColorString(cityLayer.color).withAlpha(0.95)
  const labelColor = Cesium.Color.fromCssColorString(cityLayer.labelColor).withAlpha(0.95)
  const height = currentCameraHeight()
  const cities = enabledCities()
  const canvas = viewer.scene.canvas

  const points = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection())
  const labels = viewer.scene.primitives.add(new Cesium.LabelCollection())
  cityPointCollection = points
  cityLabelCollection = labels

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
      points.add({
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
    labels.add({
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

  viewer.scene.requestRender()
}

// Generate pin icon via canvas
function createPinIcon(): string {
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  // Pin body
  ctx.beginPath()
  ctx.arc(size / 2, size / 2 - 4, 10, 0, Math.PI * 2)
  ctx.fillStyle = '#ff4444'
  ctx.fill()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.stroke()
  // Pin point
  ctx.beginPath()
  ctx.moveTo(size / 2 - 5, size / 2 + 2)
  ctx.lineTo(size / 2, size - 4)
  ctx.lineTo(size / 2 + 5, size / 2 + 2)
  ctx.fillStyle = '#ff4444'
  ctx.fill()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.5
  ctx.stroke()
  // White dot center
  ctx.beginPath()
  ctx.arc(size / 2, size / 2 - 4, 4, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  return canvas.toDataURL()
}

let pinIconDataUrl = ''

function createFlagEntity(flag: Flag) {
  if (!viewer) return
  const s = flagScale.value
  const entity = viewer.entities.add({
    id: `flag-${flag.id}`,
    position: Cesium.Cartesian3.fromDegrees(flag.longitude, flag.latitude),
    billboard: {
      image: pinIconDataUrl,
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
        entity.billboard.image = new Cesium.ConstantProperty(pinIconDataUrl)
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

/** Batch-convert TrackPoint[] → Cartesian3[] for polyline rendering.
 *  Consecutive near-duplicate vertices are removed only for the line mesh;
 *  point-dot rendering still shows the original observations. Cesium's wide
 *  polyline triangulation can draw long spurious triangles when fed
 *  zero-length/near-zero-length segments. */
function toCartesianArray(positions: TrackPoint[]): Cesium.Cartesian3[] {
  const flat: number[] = []
  let lastLng = Number.NaN
  let lastLat = Number.NaN
  let lastAlt = Number.NaN

  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]
    if (!isFinitePoint(p)) continue

    const sameAsLast =
      Math.abs(p.longitude - lastLng) < 1e-7 &&
      Math.abs(p.latitude - lastLat) < 1e-7 &&
      Math.abs(p.altitude - lastAlt) < 0.1
    if (sameAsLast) continue

    flat.push(p.longitude, p.latitude, p.altitude)
    lastLng = p.longitude
    lastLat = p.latitude
    lastAlt = p.altitude
  }
  return Cesium.Cartesian3.fromDegreesArrayHeights(flat)
}

/** For replay trail: return all points up to `time` plus the interpolated current position.
 *  pastPoints — points with timestamp <= time (the "already flown" portion)
 *  currentPoint — interpolated position at exact `time` (where the dot sits) */
function getTrailData(points: TrackPoint[], time: number): {
  pastPoints: TrackPoint[]
  currentPoint: TrackPoint
  /** Index of the last data point at or before `time` */
  lo: number
} | null {
  if (points.length === 0) return null

  if (time <= points[0].timestamp) {
    return { pastPoints: [points[0]], currentPoint: points[0], lo: 0 }
  }

  if (time >= points[points.length - 1].timestamp) {
    return {
      pastPoints: [...points],
      currentPoint: points[points.length - 1],
      lo: points.length - 1,
    }
  }

  let lo = 0
  let hi = points.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (points[mid].timestamp <= time) lo = mid
    else hi = mid
  }

  const dt = points[hi].timestamp - points[lo].timestamp
  const t = dt > 0 ? (time - points[lo].timestamp) / dt : 0

  const currentPoint: TrackPoint = {
    timestamp: points[lo].timestamp,
    latitude: points[lo].latitude + (points[hi].latitude - points[lo].latitude) * t,
    longitude: points[lo].longitude + (points[hi].longitude - points[lo].longitude) * t,
    altitude: points[lo].altitude + (points[hi].altitude - points[lo].altitude) * t,
    heading: points[lo].heading + (points[hi].heading - points[lo].heading) * t,
    groundSpeed: points[lo].groundSpeed + (points[hi].groundSpeed - points[lo].groundSpeed) * t,
    verticalRate: points[lo].verticalRate + (points[hi].verticalRate - points[lo].verticalRate) * t,
  }

  const pastPoints = points.slice(0, lo + 1)

  return { pastPoints, currentPoint, lo }
}

function createTrackEntities(track: Track) {
  if (!viewer || track.positions.length === 0) return
  if (!trackLines) return  // P2 safety: PolylineCollection not yet initialized

  const color = getLineColor(track.source)
  const tKey = trackKey(track.id, track.source)
  const isSelected = tKey === props.selectedId
  const isRaw = track.source === 'radar_raw'
  const replaying = props.replayTime !== null

  // Mutable holder for polyline positions — during active replay, starts empty;
  // updateReplayPositions will fill the correct partial trail.
  const trailRef = { positions: replaying ? [] : toCartesianArray(track.positions) }

  // P2: PolylineCollection line — GPU-instanced, one draw call for all tracks
  let line: Cesium.Polyline | undefined
  if (track.positions.length >= 2) {
    const width = isSelected ? SELECTED_WIDTH : baseWidth(track.source)
    const alpha = isSelected ? SELECTED_ALPHA : isRaw ? RAW_ALPHA : NORMAL_ALPHA
    line = trackLines.add({
      id: tKey,
      show: !replaying && visibility.value[track.source as keyof typeof visibility.value] !== false,
      positions: trailRef.positions,
      width,
      material: Cesium.Material.fromType('Color', {
        color: color.withAlpha(alpha),
      }),
    })
  }

  const label = [track.metadata.flightNumber, track.metadata.aircraftType]
    .filter(Boolean)
    .join(' | ')

  const last = track.positions[track.positions.length - 1]
  const lastPos = Cesium.Cartesian3.fromDegrees(last.longitude, last.latitude, last.altitude)

  // P1: PointPrimitive for endpoint dot (one draw call for all tracks, no texture sampling)
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

  // Label-only label in LabelCollection (P1: GPU-instanced, replaced Entity.label)
  let lbl: Cesium.Label | undefined
  if (trackLabels) {
    lbl = trackLabels.add({
      id: `${tKey}::dot`,
      show: visibility.value[track.source as keyof typeof visibility.value] !== false,
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

  entityMap.set(tKey, { line, label: lbl, pointPrimitive, source: track.source, labelText: label || track.id, trailRef, lastTrailLo: track.positions.length - 1 })
}

function removeTrackEntities(id: string) {
  const entry = entityMap.get(id)
  if (entry && viewer) {
    if (entry.line && trackLines) trackLines.remove(entry.line)
    if (entry.label) trackLabels?.remove(entry.label)
    if (entry.pointPrimitive) pointPrimitives?.remove(entry.pointPrimitive)
    entityMap.delete(id)
  }
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
    if (entities.line) entities.line.show = vis
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
    for (const track of newTracks) {
      const existing = entityMap.get(trackKey(track.id, track.source))
      if (!existing) {
        createTrackEntities(track)
        continue
      }

      // Update polyline for existing track when positions changed (e.g. time filter)
      const hasEnoughPoints = track.positions.length >= 2
      const isRaw = track.source === 'radar_raw'
      const tSel = trackKey(track.id, track.source) === props.selectedId
      const replaying = props.replayTime !== null
      existing.lastTrailLo = track.positions.length - 1

      if (existing.line) {
        if (hasEnoughPoints) {
          // P2: During replay, let updateReplayPositions own the trail — avoid ghost full-track polyline
          if (!replaying) {
            const newPositions = toCartesianArray(track.positions)
            existing.trailRef.positions = newPositions
            existing.line.positions = newPositions
          }
          existing.line.show = visibility.value[track.source as keyof typeof visibility.value] !== false
          existing.line.width = tSel ? SELECTED_WIDTH : baseWidth(track.source)
          const color = getLineColor(track.source)
          existing.line.material = Cesium.Material.fromType('Color', {
            color: color.withAlpha(tSel ? SELECTED_ALPHA : isRaw ? 0.6 : NORMAL_ALPHA),
          })
        } else {
          existing.line.show = false
        }
      } else if (hasEnoughPoints) {
        // Line didn't exist before but now has enough points (e.g. filter cleared)
        const color = getLineColor(track.source)
        const tKey = trackKey(track.id, track.source)
        if (!replaying) {
          existing.trailRef.positions = toCartesianArray(track.positions)
        }
        existing.line = trackLines!.add({
          id: tKey,
          show: visibility.value[track.source as keyof typeof visibility.value] !== false,
          positions: existing.trailRef.positions,
          width: tSel ? SELECTED_WIDTH : baseWidth(track.source),
          material: Cesium.Material.fromType('Color', {
            color: color.withAlpha(tSel ? SELECTED_ALPHA : isRaw ? 0.6 : NORMAL_ALPHA),
          }),
        })
      }

      // Update label & PointPrimitive to last position
      const last = track.positions[track.positions.length - 1]
      const lastPos = Cesium.Cartesian3.fromDegrees(last.longitude, last.latitude, last.altitude)
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
  for (const track of props.tracks) {
    const entities = entityMap.get(trackKey(track.id, track.source))
    if (!entities) continue

    const trail = getTrailData(track.positions, time)
    if (!trail) continue

    // --- Label & PointPrimitive: always update (cheap, just one position) ---
    const cpPos = Cesium.Cartesian3.fromDegrees(
      trail.currentPoint.longitude,
      trail.currentPoint.latitude,
      trail.currentPoint.altitude,
    )
    if (entities.label) entities.label.position = cpPos
    if (entities.pointPrimitive) entities.pointPrimitive.position = cpPos

    // --- P2: Polyline — directly update positions on PolylineCollection item ---
    if (trail.lo !== entities.lastTrailLo) {
      entities.lastTrailLo = trail.lo

      // Build visible polyline vertices
      const lastPast = trail.pastPoints[trail.pastPoints.length - 1]
      const allVisible = [...trail.pastPoints]
      if (
        trail.currentPoint.latitude !== lastPast.latitude ||
        trail.currentPoint.longitude !== lastPast.longitude
      ) {
        allVisible.push(trail.currentPoint)
      }

      const newPositions = toCartesianArray(allVisible)
      entities.trailRef.positions = newPositions

      if (entities.line) {
        entities.line.show = allVisible.length >= 2 && visibility.value[entities.source as keyof typeof visibility.value] !== false
        entities.line.positions = newPositions
      } else if (allVisible.length >= 2) {
        const color = getLineColor(track.source)
        const tKey = trackKey(track.id, track.source)
        const isSel = tKey === props.selectedId
        const isRaw = track.source === 'radar_raw'
        entities.line = trackLines!.add({
          id: tKey,
          show: visibility.value[track.source as keyof typeof visibility.value] !== false,
          positions: newPositions,
          width: isSel ? SELECTED_WIDTH : baseWidth(track.source),
          material: Cesium.Material.fromType('Color', {
            color: color.withAlpha(isSel ? SELECTED_ALPHA : isRaw ? RAW_ALPHA : NORMAL_ALPHA),
          }),
        })
      }
    }

    // --- Point dots: during replay, hide all — trail polylines already show the path ---
  }
  viewer.scene.requestRender()
}

let wasReplaying = false
watch(
  () => props.replayTime,
  (time) => {
    if (time !== null) {
      if (!wasReplaying) {
        // P2: On replay start, hide all track lines — updateReplayPositions will show only visible ones
        for (const [, entities] of entityMap) {
          entities.trailRef.positions = []
          if (entities.line) entities.line.show = false
        }
        // P3: Clear dot cloud during replay — trail polylines show the path
        if (dotCloudVertexCount > 0) {
          dotCloudVertexCount = 0
          rebuildDotCloudBuffers()
        }
      }
      updateReplayPositions(time)
      wasReplaying = true
    } else if (wasReplaying) {
      wasReplaying = false
      // P2: Restore full polylines + billboards to last position.
      for (const track of props.tracks) {
        const entities = entityMap.get(trackKey(track.id, track.source))
        if (!entities || track.positions.length === 0) continue
        const last = track.positions[track.positions.length - 1]
        // Restore trailRef to full track positions
        const staticPositions = toCartesianArray(track.positions)
        entities.trailRef.positions = staticPositions
        entities.lastTrailLo = track.positions.length - 1
        if (entities.line) {
          entities.line.positions = staticPositions
          entities.line.show = track.positions.length >= 2 && visibility.value[entities.source as keyof typeof visibility.value] !== false
        }
        // Restore label & PointPrimitive to last position
        const lastPos = Cesium.Cartesian3.fromDegrees(last.longitude, last.latitude, last.altitude)
        if (entities.label) entities.label.position = lastPos
        if (entities.pointPrimitive) entities.pointPrimitive.position = lastPos
      }
      // P3: Restore point dot cloud
      if (pointDotEntityMap.size > 0) {
        packageDotCloudBuffers(props.tracks)
      }
      pointDotLastLo.clear()
      reapplyVisibility()
      viewer?.scene.requestRender()
    }
  },
)

watch(
  visibility,
  () => {
    for (const [, entities] of entityMap) {
      const vis = visibility.value[entities.source as keyof typeof visibility.value]
      if (entities.line) entities.line.show = vis
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
  scheduleCityLayerRender(80)
}, { deep: true })

// Reactive line width: update existing polylines when slider changes
watch(
  () => props.lineWidths,
  () => {
    for (const [tKey, entry] of entityMap) {
      if (entry.line && tKey !== previousSelectedId) {
        entry.line.width = baseWidth(entry.source as DataSource)
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
      const isHovered = hoveredTrackId === tKey && !isSelected
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
    if (entry.line) {
      entry.line.material = Cesium.Material.fromType('Color', {
        color: color.withAlpha(isRaw ? RAW_ALPHA : NORMAL_ALPHA),
      })
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
    if (prev?.line) {
      const color = getLineColor(prev.source as DataSource)
      prev.line.material = Cesium.Material.fromType('Color', {
        color: color.withAlpha(baseAlpha(prev.source)),
      })
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
    if (entry?.line) {
      const color = getLineColor(entry.source as DataSource)
      entry.line.material = Cesium.Material.fromType('Color', {
        color: color.withAlpha(SELECTED_ALPHA),
      })
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

  // If this track is already click-selected, don't override with red
  if (previousSelectedId === trackId) return

  // P2: Add overlay polyline in a SEPARATE PolylineCollection instead of
  // modifying entry.line.material. Changing material on any polyline in a
  // PolylineCollection triggers MATERIAL_INDEX → createVertexArrays() which
  // rebuilds ALL vertex buffers (O(3000) + 40MB alloc per hover event).
  if (hoverOverlayLines) {
    // Remove any previous overlay (hover or select)
    if (activeOverlayLine) {
      hoverOverlayLines.remove(activeOverlayLine)
      activeOverlayLine = null
    }
    activeOverlayLine = hoverOverlayLines.add({
      id: `hover::${trackId}`,
      positions: entry.line.positions,
      width: HOVER_WIDTH,
      material: Cesium.Material.fromType('Color', { color: HOVER_COLOR }),
      show: true,
    })
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
    removeHoverHighlight()
    viewer!.scene.requestRender()
    return
  }

  const city = pickedCity(picked)
  if (city) {
    removeHoverHighlight()
    showCityHover(city)
    viewer!.scene.requestRender()
    return
  }
  hideCityHover()

  let trackId: string | null = null

  // P1: handle PointPrimitive pick (endpoint dot) or Polyline pick
  if (typeof picked.id === 'string') {
    if (entityMap.has(picked.id)) {
      // Direct trackKey match (PointPrimitive or Polyline)
      trackId = picked.id
    } else if (picked.id.endsWith('::dot')) {
      // Label pick → strip ::dot suffix
      const baseId = picked.id.slice(0, picked.id.lastIndexOf('::'))
      if (entityMap.has(baseId)) trackId = baseId
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
    removeHoverHighlight()
    viewer!.scene.requestRender()
    return
  }
  if (hoveredTrackId === trackId) return

  removeHoverHighlight()
  hoveredTrackId = trackId
  applyHoverHighlight(trackId)
  viewer!.scene.requestRender()
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

// Update point dot size uniform when slider changes
let dotCloudPointSize = 7.0
watch(trackPointDotScale, (newScale) => {
  dotCloudPointSize = Math.max(2.0, 7.0 * newScale)
  viewer?.scene.requestRender()
})

// Rebuild point dot GPU buffers when custom color or line color changes
watch([pointDotColors, lineColors], () => {
  if (pointDotEntityMap.size > 0) {
    packageDotCloudBuffers(props.tracks)
  }
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
    destination: Cesium.Cartesian3.fromDegrees(last.longitude, last.latitude, last.altitude + 8000),
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

/** Show point dots for a single track (right-click manual operation) */
function showManualPointDots(trackId: string) {
  const nextManual = new Set(manualPointDotsTrackIds.value)
  nextManual.add(trackId)
  manualPointDotsTrackIds.value = nextManual

  const nextHidden = new Set(globalHiddenTrackKeys.value)
  nextHidden.delete(trackId)
  globalHiddenTrackKeys.value = nextHidden

  packageDotCloudBuffers(props.tracks)
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

  packageDotCloudBuffers(props.tracks)
}

/** Sync global point dots: apply showAllPointDots + manual overrides + hidden list */
function syncGlobalPointDots() {
  if (!viewer || !dotCloudGl) return
  try {
    packageDotCloudBuffers(props.tracks)
  } catch (e) {
    console.error('[syncGlobalPointDots] error:', e)
  }
}

/** Clean up all point dot data */
function clearAllPointDots() {
  pointDotEntityMap.clear()
  manualPointDotsTrackIds.value = new Set()
  globalHiddenTrackKeys.value = new Set()
  dotCloudPositions = new Float32Array(0)
  dotCloudColors = new Float32Array(0)
  rebuildDotCloudBuffers()
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
  viewer.camera.percentageChanged = 0.03
  removeCityCameraChanged = viewer.camera.changed.addEventListener(() => {
    scheduleCityLayerRender(120)
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
  // Lower track lines to the bottom so Entity overlays (labels, billboards) render on top
  viewer.scene.primitives.lowerToBottom(trackLines as any)
  // P2: Separate collection for hover/select overlay — added AFTER trackLines so renders on top.
  // Using a separate collection avoids MATERIAL_INDEX triggering full VBO rebuild on 3000+ tracks.
  hoverOverlayLines = viewer.scene.primitives.add(new Cesium.PolylineCollection()) as unknown as Cesium.PolylineCollection
  // P1: LabelCollection for track labels — GPU-instanced, one draw call for all labels
  trackLabels = viewer.scene.primitives.add(new Cesium.LabelCollection())
  // P3: Init custom WebGL point cloud renderer (postRender injection)
  initDotCloudRenderer(viewer.scene)
  await loadBoundaryLayers()
  await loadCityLayer()

  // Must create pin icon before awaiting settings — flag restoration during
  // applySettings() can trigger syncFlagEntities(), which needs pinIconDataUrl.
  pinIconDataUrl = createPinIcon()

  // Restore saved camera state, or use default view
  await whenSettingsLoaded()
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

    // P2: track line pick via PolylineCollection (picked.id is the string trackKey)
    if (typeof picked.id === 'string' && entityMap.has(picked.id)) {
      emit('track-pick', picked.id)
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
      // P2: track line pick via PolylineCollection (picked.id is string trackKey)
      if (typeof picked.id === 'string' && entityMap.has(picked.id) && hoveredTrackId === picked.id) {
        contextMenu.value = {
          visible: true,
          x: movement.position.x,
          y: movement.position.y,
          type: 'track',
          flagId: '',
          flagLabel: '',
          trackId: picked.id,
        }
        return
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
    destroyDotCloudRenderer()
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

defineExpose({ getViewer: () => viewer, flyToTrack, flyToFlag, resetView, switchTileLayer })
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
</style>
