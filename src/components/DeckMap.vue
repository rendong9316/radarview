<template>
  <div class="deck-container" ref="containerRef">
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
        ><Dot :size="13" /> 显示对应点迹</div>
        <div
          v-else
          class="context-menu-item"
          @click="handleContextHidePointDots"
        ><Circle :size="13" /> 隐藏对应点迹</div>
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
    <canvas ref="canvasRef" class="deck-canvas" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { Deck, MapView, WebMercatorViewport } from '@deck.gl/core'
import type { PickingInfo } from '@deck.gl/core'
import { BitmapLayer, GeoJsonLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { TileLayer } from '@deck.gl/geo-layers'
import { invoke } from '@tauri-apps/api/core'
import type { DataSource, Track, TrackPoint } from '../types/track'
import { useBoundaryLayers, type BoundaryLayerKey } from '../composables/useBoundaryLayers'
import { useCityLayer, type CityLevel } from '../composables/useCityLayer'
import { useFlags } from '../composables/useFlags'
import { useFlagScale } from '../composables/useFlagScale'
import { useLabelVisibility } from '../composables/useLabelVisibility'
import { useLayerVisibility } from '../composables/useLayerVisibility'
import { useLineColor } from '../composables/useLineColor'
import { useTheme } from '../composables/useTheme'
import { useTrackHighlight } from '../composables/useTrackHighlight'
import { useTrackPointDots } from '../composables/useTrackPointDots'
import { getRawSetting, scheduleSave, whenSettingsLoaded } from '../composables/useSettingsPersistence'
import { parseTrackKey, trackKey } from '../composables/useTracks'
import { Pencil, Trash2, Dot, Circle, FileText, ClipboardList } from '@lucide/vue'

type ViewState = {
  longitude: number
  latitude: number
  zoom: number
  pitch: number
  bearing: number
}

type Rgb = [number, number, number]
type Rgba = [number, number, number, number]

interface PathDatum {
  kind: 'track'
  id: string
  trackKey: string
  source: DataSource
  path: [number, number][]
  color: Rgba
  width: number
}

interface PointDatum {
  kind: 'track'
  id: string
  trackKey: string
  source: DataSource
  position: [number, number]
  color: Rgba
  size: number
}

interface LabelDatum {
  kind: 'track' | 'flag' | 'city'
  id: string
  position: [number, number]
  text: string
  color: Rgba
  trackKey?: string
  flagId?: string
  cityId?: string
}

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

interface CityPointDatum {
  kind: 'city'
  id: string
  position: [number, number]
  color: Rgba
  size: number
  cityId: string
  text: string
}

interface CityLabelDatum {
  kind: 'city'
  id: string
  position: [number, number]
  text: string
  color: Rgba
  cityId: string
}

interface FlagPointDatum {
  kind: 'flag'
  id: string
  flagId: string
  position: [number, number]
  color: Rgba
  size: number
}

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
const canvasRef = ref<HTMLCanvasElement>()
const DEFAULT_VIEW_STATE: ViewState = { longitude: 150, latitude: 5, zoom: 1.08, pitch: 0, bearing: 0 }
const FLAT_CAMERA_SETTING_KEY = 'camera.flat_state.v4'
const viewState = shallowRef<ViewState>({ ...DEFAULT_VIEW_STATE })
const boundaryData = shallowRef<Record<BoundaryLayerKey, any>>({ coastline: null, admin0: null, admin1: null })

let deck: Deck<any> | null = null
let resizeObserver: ResizeObserver | null = null
let tileServerPort = 0
let tileMaxZoom = 8
let saveCameraTimer: ReturnType<typeof setTimeout> | null = null
let lastPointer: { x: number; y: number } | null = null
let hoveredTrackId: string | null = null
let hoveredCityId: string | null = null
let contextMenuFn: ((e: MouseEvent) => void) | null = null
let doubleClickFn: ((e: MouseEvent) => void) | null = null
let clickOutsideFn: ((e: MouseEvent) => void) | null = null
let keyDownFn: ((e: KeyboardEvent) => void) | null = null
let mouseMoveFn: ((e: MouseEvent) => void) | null = null
let contextMenuOpenedAt = 0
let replayRafId: number | null = null
let pickScheduled = false
let viewChangeTimer: ReturnType<typeof setTimeout> | null = null
const shiftedGeoJsonCache = new WeakMap<object, Map<number, any>>()

const { getEffectiveHex, lineColors } = useLineColor()
const { visibility } = useLayerVisibility()
const { showLabels } = useLabelVisibility()
const { showAllPointDots, trackPointDotScale, pointDotColors, clearAllCounter } = useTrackPointDots()
const { flags, addFlag, removeFlag, renameFlag, toggleSelectFlag, selectedPair } = useFlags()
const { flagScale } = useFlagScale()
const { activeTheme, getThemeVar } = useTheme()
const { boundaryVisible, boundaryWidths, boundaryColors } = useBoundaryLayers()
const { cityLayer } = useCityLayer()
const { addHighlight } = useTrackHighlight()

const BOUNDARY_LAYERS = [
  { key: 'coastline', url: '/boundaries/coastline.geojson', alpha: 0.7 },
  { key: 'admin1', url: '/boundaries/admin1.geojson', alpha: 0.55 },
  { key: 'admin0', url: '/boundaries/admin0.geojson', alpha: 0.85 },
] as const satisfies ReadonlyArray<{ key: BoundaryLayerKey; url: string; alpha: number }>

const cityFeatures = shallowRef<CityFeature[]>([])
const manualPointDotsTrackIds = ref(new Set<string>())
const globalHiddenTrackKeys = ref(new Set<string>())
const contextMenu = ref<{
  visible: boolean
  x: number
  y: number
  type: 'flag' | 'track'
  flagId: string
  flagLabel: string
  trackId: string
}>({ visible: false, x: 0, y: 0, type: 'flag', flagId: '', flagLabel: '', trackId: '' })

const visibleTracks = computed(() =>
  props.tracks.filter(track => visibility.value[track.source] && track.positions.length > 0),
)

const trackPaths = computed<PathDatum[]>(() => {
  const result: PathDatum[] = []
  for (const track of visibleTracks.value) {
    const positions = replayPositions(track)
    if (positions.length < 2) continue
    const key = trackKey(track.id, track.source)
    const selected = props.selectedId === key
    const color = hexToRgba(getEffectiveHex(track.source), selected ? 255 : track.source === 'radar_raw' ? 190 : 224)
    const width = selected ? 4 : props.lineWidths[track.source] ?? 2
    splitDateLinePaths(positions.map(point => displayPosition(point.longitude, point.latitude)))
      .forEach((path, index) => {
        result.push({
          kind: 'track',
          id: `${key}::path::${index}`,
          trackKey: key,
          source: track.source,
          path,
          color,
          width,
        })
      })
  }
  return result
})

const hoverPaths = computed<PathDatum[]>(() => {
  const key = hoveredTrackId
  if (!key) return []
  const track = visibleTracks.value.find(item => trackKey(item.id, item.source) === key)
  if (!track || props.selectedId === key) return []
  const positions = replayPositions(track)
  if (positions.length < 2) return []
  return splitDateLinePaths(positions.map(point => displayPosition(point.longitude, point.latitude)))
    .map((path, index) => ({
      kind: 'track',
      id: `${key}::hover::${index}`,
      trackKey: key,
      source: track.source,
      path,
      color: [255, 51, 51, 255],
      width: 5,
    }))
})

const trackEndpoints = computed<PointDatum[]>(() => {
  const result: PointDatum[] = []
  for (const track of visibleTracks.value) {
    if (track.positions.length === 0) continue
    const key = trackKey(track.id, track.source)
    const selected = props.selectedId === key
    const hovered = hoveredTrackId === key
    const last = replayEndPosition(track)
    const baseSize = hovered ? 16 : selected ? 15 : track.source === 'radar_raw' ? 6 : 9
    result.push({
      kind: 'track',
      id: `${key}::endpoint`,
      trackKey: key,
      source: track.source,
      position: displayPosition(last.longitude, last.latitude),
      color: hovered ? [255, 51, 51, 255] : hexToRgba(getPointDotColor(track.source), 255),
      size: baseSize * (props.dotScale[track.source] ?? 1),
    })
  }
  return result
})

const trackPointDots = computed<PointDatum[]>(() => {
  const result: PointDatum[] = []
  for (const track of visibleTracks.value) {
    const key = trackKey(track.id, track.source)
    if (!isTrackShowingDots(key)) continue
    const color = hexToRgba(getPointDotColor(track.source), track.source === 'radar_raw' ? 170 : 210)
    const size = Math.max(2, 3.5 * trackPointDotScale.value * (props.dotScale[track.source] ?? 1))
    for (const point of replayPositions(track)) {
      result.push({
        kind: 'track',
        id: `${key}::point::${point.timestamp}`,
        trackKey: key,
        source: track.source,
        position: displayPosition(point.longitude, point.latitude),
        color,
        size,
      })
    }
  }
  return result
})

const trackLabels = computed<LabelDatum[]>(() => {
  if (!showLabels.value) return []
  return visibleTracks.value.flatMap((track) => {
    if (track.positions.length === 0) return []
    const last = replayEndPosition(track)
    const label = [track.metadata.flightNumber, track.metadata.aircraftType].filter(Boolean).join(' | ') || track.id
    return [{
      kind: 'track',
      id: `${trackKey(track.id, track.source)}::label`,
      position: displayPosition(last.longitude, last.latitude),
      text: label,
      color: hexToRgba(getEffectiveHex(track.source), 255),
      trackKey: trackKey(track.id, track.source),
    }]
  })
})

const cityPoints = computed<CityPointDatum[]>(() => {
  if (!cityLayer.visible) return []
  const height = zoomToApproxHeightKm(viewState.value.zoom) * 1000
  return enabledCities()
    .filter(city => height <= cityPointMaxHeight(city.level))
    .map(city => ({
    kind: 'city',
    id: `city::${city.id}`,
    position: displayPosition(city.longitude, city.latitude),
    color: hexToRgba(cityLayer.color, 240),
    size: city.level === 'capital' ? cityLayer.pointSize + 2 : city.level === 'regional' ? cityLayer.pointSize + 1 : cityLayer.pointSize,
    cityId: city.id,
    text: city.nameZh,
  }))
})

const cityLabels = computed<CityLabelDatum[]>(() => {
  if (!cityLayer.visible || !cityLayer.labels) return []
  const height = zoomToApproxHeightKm(viewState.value.zoom) * 1000
  const max = maxCityLabelsForHeight(height)
  const avoidCollision = height > 800_000
  const grid = avoidCollision ? cityLabelGridSize(height) : { width: 64, height: 28 }
  const cities = enabledCities()
    .filter(city => height <= cityLabelMaxHeight(city.level))
    .sort((a, b) => cityLevelRank(a.level) - cityLevelRank(b.level) || b.population - a.population)

  const occupied = new Set<string>()
  const result: CityLabelDatum[] = []

  for (const city of cities) {
    if (result.length >= max) break
    if (avoidCollision) {
      // Approximate screen position via unproject for grid dedup
      const screen = projectApprox(city.longitude, city.latitude)
      if (screen) {
        const key = `${Math.floor(screen.x / grid.width)}:${Math.floor(screen.y / grid.height)}`
        if (occupied.has(key)) continue
        occupied.add(key)
      }
    }
    result.push({
      kind: 'city',
      id: `city::label::${city.id}`,
      position: displayPosition(city.longitude, city.latitude),
      text: city.nameZh,
      color: hexToRgba(cityLayer.labelColor, 240),
      cityId: city.id,
    })
  }
  return result
})

const hoveredCityLabel = computed<CityLabelDatum[]>(() => {
  if (!cityLayer.visible || !hoveredCityId) return []
  const city = cityFeatures.value.find(item => item.id === hoveredCityId)
  if (!city) return []
  return [{
    kind: 'city',
    id: `city::hover::${city.id}`,
    position: displayPosition(city.longitude, city.latitude),
    text: city.nameZh,
    color: hexToRgba(cityLayer.labelColor, 255),
    cityId: city.id,
  }]
})

const flagPoints = computed<FlagPointDatum[]>(() =>
  flags.value.map(flag => ({
    kind: 'flag',
    id: `flag::${flag.id}`,
    flagId: flag.id,
    position: displayPosition(flag.longitude, flag.latitude),
    color: [245, 197, 66, 255],
    size: 9 * flagScale.value,
  })),
)

const flagLabels = computed<LabelDatum[]>(() =>
  flags.value.map(flag => ({
    kind: 'flag',
    id: `flag::label::${flag.id}`,
    position: displayPosition(flag.longitude, flag.latitude),
    text: flag.label,
    color: [245, 197, 66, 255],
    flagId: flag.id,
  })),
)

/** Great-circle arc between two selected flags */
const arcPath = computed<[number, number][]>(() => {
  const pair = selectedPair.value
  if (!pair) return []
  const [a, b] = pair
  const segments = 64
  const path: [number, number][] = []
  const lat1 = (a.latitude * Math.PI) / 180
  const lon1 = (a.longitude * Math.PI) / 180
  const lat2 = (b.latitude * Math.PI) / 180
  const lon2 = (b.longitude * Math.PI) / 180
  const cosDist = Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
  const dist = Math.acos(Math.max(-1, Math.min(1, cosDist)))
  for (let i = 0; i <= segments; i++) {
    const f = i / segments
    const aF = dist > 1e-10 ? Math.sin((1 - f) * dist) / Math.sin(dist) : (1 - f)
    const bF = dist > 1e-10 ? Math.sin(f * dist) / Math.sin(dist) : f
    const x = aF * Math.cos(lat1) * Math.cos(lon1) + bF * Math.cos(lat2) * Math.cos(lon2)
    const y = aF * Math.cos(lat1) * Math.sin(lon1) + bF * Math.cos(lat2) * Math.sin(lon2)
    const z = aF * Math.sin(lat1) + bF * Math.sin(lat2)
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y))
    const lon = Math.atan2(y, x)
    path.push(displayPosition((lon * 180) / Math.PI, (lat * 180) / Math.PI))
  }
  return path
})

/** O(log n) binary search: return slice of positions up to replayTime.
 *  Avoids O(n) .filter() per track per frame during replay. */
function replayPositions(track: Track): TrackPoint[] {
  const replayTime = props.replayTime
  if (replayTime === null) return track.positions
  const points = track.positions
  if (points.length === 0) return []
  if (replayTime >= points[points.length - 1].timestamp) return points
  if (replayTime <= points[0].timestamp) return [points[0]]

  let lo = 0, hi = points.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (points[mid].timestamp <= replayTime) lo = mid
    else hi = mid
  }
  return points.slice(0, lo + 1)
}

/** O(log n) binary search: return the END position at replayTime (interpolated). */
function replayEndPosition(track: Track): TrackPoint {
  const points = track.positions
  const replayTime = props.replayTime
  if (replayTime === null || points.length === 0) return points[points.length - 1]
  if (replayTime >= points[points.length - 1].timestamp) return points[points.length - 1]
  if (replayTime <= points[0].timestamp) return points[0]

  let lo = 0, hi = points.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (points[mid].timestamp <= replayTime) lo = mid
    else hi = mid
  }
  // Linear interpolation between lo and hi
  const dt = points[hi].timestamp - points[lo].timestamp
  const t = dt > 0 ? (replayTime - points[lo].timestamp) / dt : 0
  return {
    timestamp: points[lo].timestamp,
    latitude: points[lo].latitude + (points[hi].latitude - points[lo].latitude) * t,
    longitude: points[lo].longitude + (points[hi].longitude - points[lo].longitude) * t,
    altitude: points[lo].altitude + (points[hi].altitude - points[lo].altitude) * t,
    heading: points[lo].heading + (points[hi].heading - points[lo].heading) * t,
    groundSpeed: points[lo].groundSpeed + (points[hi].groundSpeed - points[lo].groundSpeed) * t,
    verticalRate: points[lo].verticalRate + (points[hi].verticalRate - points[lo].verticalRate) * t,
  }
}

function splitDateLinePaths(path: [number, number][]) {
  if (path.length < 2) return []
  const result: [number, number][][] = []
  let current: [number, number][] = [path[0]]
  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1]
    const next = path[i]
    if (Math.abs(next[0] - prev[0]) > 180) {
      if (current.length >= 2) result.push(current)
      current = [next]
    } else {
      current.push(next)
    }
  }
  if (current.length >= 2) result.push(current)
  return result
}

function enabledCities() {
  return cityFeatures.value.filter(city => {
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

function cityPointMaxHeight(level: CityLevel) {
  switch (level) {
    case 'capital': return Number.POSITIVE_INFINITY
    case 'regional': return cityLayer.lod.pointMaxHeight.regional
    case 'prefecture': return cityLayer.lod.pointMaxHeight.prefecture
    case 'major': return cityLayer.lod.pointMaxHeight.major
    default: return 0
  }
}

function cityLabelMaxHeight(level: CityLevel) {
  switch (level) {
    case 'capital': return Number.POSITIVE_INFINITY
    case 'regional': return cityLayer.lod.labelMaxHeight.regional
    case 'prefecture': return cityLayer.lod.labelMaxHeight.prefecture
    case 'major': return cityLayer.lod.labelMaxHeight.major
    default: return 0
  }
}

function maxCityLabelsForHeight(height: number) {
  if (height <= 900_000) return 1800
  if (height <= 1_600_000) return 1100
  if (height <= 3_200_000) return 620
  if (height <= 7_000_000) return 260
  if (height <= 12_000_000) return 120
  return 70
}

function cityLabelGridSize(height: number) {
  if (height > 12_000_000) return { width: 120, height: 54 }
  if (height > 6_000_000) return { width: 104, height: 48 }
  if (height > 2_000_000) return { width: 92, height: 42 }
  return { width: 82, height: 36 }
}

/** Approximate screen coordinates for a lon/lat pair (used for label grid dedup only) */
function projectApprox(lon: number, lat: number): { x: number; y: number } | null {
  if (!containerRef.value) return null
  const vs = viewState.value
  const lambda = ((lon + 180) % 360) - 180
  const phi = Math.max(-85.051129, Math.min(85.051129, lat))
  const sinPhi = Math.sin((phi * Math.PI) / 180)
  const scale = (containerRef.value.clientWidth * Math.pow(2, vs.zoom)) / (2 * Math.PI)
  const centerWorldY = 0.5 * Math.log((1 + Math.sin(vs.latitude * Math.PI / 180)) / (1 - Math.sin(vs.latitude * Math.PI / 180)))
  const worldY = 0.5 * Math.log((1 + sinPhi) / (1 - sinPhi))
  const px = containerRef.value.clientWidth / 2 + (lambda - vs.longitude) * (Math.PI / 180) * scale / (2 * Math.PI) * 360
  const py = containerRef.value.clientHeight / 2 - (worldY - centerWorldY) * scale / (2 * Math.PI) * 360
  // Guard against NaN from log of negative/zero
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null
  return { x: px, y: py }
}

function isTrackShowingDots(key: string) {
  return manualPointDotsTrackIds.value.has(key) || (showAllPointDots.value && !globalHiddenTrackKeys.value.has(key))
}

function showManualPointDots(key: string) {
  if (!key) return
  const manual = new Set(manualPointDotsTrackIds.value)
  manual.add(key)
  manualPointDotsTrackIds.value = manual
  const hidden = new Set(globalHiddenTrackKeys.value)
  hidden.delete(key)
  globalHiddenTrackKeys.value = hidden
  setDeckProps()
}

function hidePointDotsForTrack(key: string) {
  if (!key) return
  const manual = new Set(manualPointDotsTrackIds.value)
  manual.delete(key)
  manualPointDotsTrackIds.value = manual
  if (showAllPointDots.value) {
    const hidden = new Set(globalHiddenTrackKeys.value)
    hidden.add(key)
    globalHiddenTrackKeys.value = hidden
  }
  setDeckProps()
}

function getPointDotColor(source: DataSource) {
  return pointDotColors[source] ?? getEffectiveHex(source)
}

function hexToRgba(hex: string, alpha = 255): Rgba {
  const h = normalizeHex(hex)
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    alpha,
  ]
}

function hexToRgb(hex: string): Rgb {
  const [r, g, b] = hexToRgba(hex)
  return [r, g, b]
}

function normalizeHex(hex: string) {
  const raw = hex.trim().replace('#', '')
  if (raw.length === 3) return raw.split('').map(c => `${c}${c}`).join('')
  return raw.padEnd(6, '0').slice(0, 6)
}

function normalizeLongitude(longitude: number) {
  return ((((longitude + 180) % 360) + 360) % 360) - 180
}

function wrapLongitudeToCenter(longitude: number, center = viewState.value.longitude) {
  let result = longitude
  while (result - center > 180) result -= 360
  while (result - center < -180) result += 360
  return result
}

function displayPosition(longitude: number, latitude: number): [number, number] {
  return [wrapLongitudeToCenter(longitude), latitude]
}

function unwrapLongitudes(longitudes: number[]) {
  if (longitudes.length === 0) return []
  const result = [longitudes[0]]
  for (let index = 1; index < longitudes.length; index++) {
    let longitude = longitudes[index]
    const previous = result[index - 1]
    while (longitude - previous > 180) longitude -= 360
    while (longitude - previous < -180) longitude += 360
    result.push(longitude)
  }
  return result
}

function worldOffsets() {
  const center = viewState.value.longitude
  const base = Math.round(center / 360) * 360
  return [base - 360, base, base + 360]
}

function shiftedGeoJson(data: any, offset: number): any {
  if (!data || offset === 0 || typeof data !== 'object') return data
  let offsetMap = shiftedGeoJsonCache.get(data)
  if (!offsetMap) {
    offsetMap = new Map<number, any>()
    shiftedGeoJsonCache.set(data, offsetMap)
  }
  const cached = offsetMap.get(offset)
  if (cached) return cached
  const shifted = shiftGeoJsonLongitudes(data, offset)
  offsetMap.set(offset, shifted)
  return shifted
}

function shiftGeoJsonLongitudes(data: any, offset: number): any {
  if (!data) return data
  if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
    return {
      ...data,
      features: data.features.map((feature: any) => shiftGeoJsonLongitudes(feature, offset)),
    }
  }
  if (data.type === 'Feature') {
    return {
      ...data,
      geometry: shiftGeoJsonGeometry(data.geometry, offset),
    }
  }
  if (data.type && Array.isArray(data.coordinates)) return shiftGeoJsonGeometry(data, offset)
  return data
}

function shiftGeoJsonGeometry(geometry: any, offset: number): any {
  if (!geometry) return geometry
  if (geometry.type === 'GeometryCollection' && Array.isArray(geometry.geometries)) {
    return {
      ...geometry,
      geometries: geometry.geometries.map((item: any) => shiftGeoJsonGeometry(item, offset)),
    }
  }
  if (!Array.isArray(geometry.coordinates)) return geometry
  return {
    ...geometry,
    coordinates: shiftCoordinateArray(geometry.coordinates, offset),
  }
}

function shiftCoordinateArray(value: any, offset: number): any {
  if (!Array.isArray(value)) return value
  if (typeof value[0] === 'number' && typeof value[1] === 'number') {
    return [value[0] + offset, value[1], ...value.slice(2)]
  }
  return value.map(item => shiftCoordinateArray(item, offset))
}

function textLayerProps() {
  return {
    characterSet: 'auto',
    fontFamily: 'Microsoft YaHei, Segoe UI, Arial, sans-serif',
    fontSettings: { sdf: true },
    sizeUnits: 'pixels' as const,
    outlineWidth: 2,
    outlineColor: [0, 0, 0, 220] as Rgba,
  }
}

function buildLayers() {
  const layers: any[] = []
  const backgroundColor = hexToRgb(getThemeVar('--cesium-bg') || '#1a1a2e')
  const offsets = worldOffsets()

  if (tileServerPort > 0) {
    layers.push(new TileLayer({
      id: `basemap-${tileServerPort}-${tileMaxZoom}`,
      data: null,
      minZoom: 0,
      maxZoom: tileMaxZoom,
      tileSize: 256,
      refinementStrategy: 'best-available',
      getTileData: ({ index }: { index: { x: number; y: number; z: number } }) => {
        const { x, y, z } = index
        const dimension = 2 ** z
        if (y < 0 || y >= dimension) return null
        const wrappedX = ((x % dimension) + dimension) % dimension
        return `http://127.0.0.1:${tileServerPort}/tiles/${z}/${wrappedX}/${y}.png`
      },
      renderSubLayers: (props: any) => {
        const { bbox } = props.tile
        return offsets.map(offset => new BitmapLayer(props, {
          id: `${props.id}-world-${offset}`,
          data: undefined,
          image: props.data,
          bounds: [bbox.west + offset, bbox.south, bbox.east + offset, bbox.north],
        }))
      },
    }))
  }

  for (const boundary of BOUNDARY_LAYERS) {
    const data = boundaryData.value[boundary.key]
    if (!data || !boundaryVisible[boundary.key]) continue
    for (const offset of offsets) {
      layers.push(new GeoJsonLayer({
        id: `boundary-${boundary.key}-world-${offset}`,
        data: shiftedGeoJson(data, offset),
        stroked: true,
        filled: false,
        getLineColor: [...hexToRgb(boundaryColors[boundary.key]), Math.round(255 * boundary.alpha)],
        lineWidthMinPixels: boundaryWidths[boundary.key],
        pickable: false,
      }))
    }
  }

  if (trackPaths.value.length > 0) {
    layers.push(new PathLayer({
      id: 'track-lines',
      data: trackPaths.value,
      getPath: (d: PathDatum) => d.path,
      getColor: (d: PathDatum) => d.color,
      getWidth: (d: PathDatum) => d.width,
      widthUnits: 'pixels',
      pickable: true,
      autoHighlight: false,
    }))
  }

  if (hoverPaths.value.length > 0) {
    layers.push(new PathLayer({
      id: 'track-hover-lines',
      data: hoverPaths.value,
      getPath: (d: PathDatum) => d.path,
      getColor: (d: PathDatum) => d.color,
      getWidth: (d: PathDatum) => d.width,
      widthUnits: 'pixels',
      pickable: false,
    }))
  }

  if (trackPointDots.value.length > 0) {
    layers.push(new ScatterplotLayer({
      id: 'track-point-dots',
      data: trackPointDots.value,
      getPosition: (d: PointDatum) => d.position,
      getFillColor: (d: PointDatum) => d.color,
      getRadius: (d: PointDatum) => d.size,
      radiusUnits: 'pixels',
      pickable: true,
    }))
  }

  if (trackEndpoints.value.length > 0) {
    layers.push(new ScatterplotLayer({
      id: 'track-endpoints',
      data: trackEndpoints.value,
      getPosition: (d: PointDatum) => d.position,
      getFillColor: (d: PointDatum) => d.color,
      getLineColor: [0, 0, 0, 190],
      getLineWidth: 1,
      getRadius: (d: PointDatum) => d.size,
      radiusUnits: 'pixels',
      stroked: true,
      pickable: true,
    }))
  }

  if (cityPoints.value.length > 0) {
    layers.push(new ScatterplotLayer({
      id: 'city-points',
      data: cityPoints.value,
      getPosition: (d: CityPointDatum) => d.position,
      getFillColor: (d: CityPointDatum) => d.color,
      getLineColor: [0, 0, 0, 190],
      getLineWidth: 1,
      getRadius: (d: CityPointDatum) => d.size,
      radiusUnits: 'pixels',
      stroked: true,
      pickable: true,
    }))
  }

  if (cityLabels.value.length > 0) {
    layers.push(new TextLayer({
      id: 'city-labels',
      ...textLayerProps(),
      data: cityLabels.value,
      getPosition: (d: CityLabelDatum) => d.position,
      getText: (d: CityLabelDatum) => d.text,
      getColor: (d: CityLabelDatum) => d.color,
      getSize: cityLayer.fontSize,
      getPixelOffset: [cityLayer.pointSize + 8, 0],
      getTextAnchor: 'start',
      getAlignmentBaseline: 'center',
      background: false,
      pickable: true,
    }))
  }

  if (hoveredCityLabel.value.length > 0) {
    layers.push(new TextLayer({
      id: 'city-hover-label',
      ...textLayerProps(),
      data: hoveredCityLabel.value,
      getPosition: (d: CityLabelDatum) => d.position,
      getText: (d: CityLabelDatum) => d.text,
      getColor: (d: CityLabelDatum) => d.color,
      getSize: cityLayer.fontSize + 2,
      getPixelOffset: [cityLayer.pointSize + 12, 0],
      getTextAnchor: 'start',
      getAlignmentBaseline: 'center',
      background: true,
      getBackgroundColor: [0, 0, 0, 150],
      backgroundPadding: [6, 4],
      pickable: false,
    }))
  }

  if (flagPoints.value.length > 0) {
    layers.push(new ScatterplotLayer({
      id: 'flag-points',
      data: flagPoints.value,
      getPosition: (d: FlagPointDatum) => d.position,
      getFillColor: (d: FlagPointDatum) => d.color,
      getLineColor: [0, 0, 0, 220],
      getLineWidth: 1,
      getRadius: (d: FlagPointDatum) => d.size,
      radiusUnits: 'pixels',
      stroked: true,
      pickable: true,
    }))
  }

  if (flagLabels.value.length > 0) {
    layers.push(new TextLayer({
      id: 'flag-labels',
      ...textLayerProps(),
      data: flagLabels.value,
      getPosition: (d: LabelDatum) => d.position,
      getText: (d: LabelDatum) => d.text,
      getColor: (d: LabelDatum) => d.color,
      getSize: Math.round(12 * flagScale.value),
      getPixelOffset: [Math.round(12 * flagScale.value), 0],
      getTextAnchor: 'start',
      getAlignmentBaseline: 'center',
      background: true,
      getBackgroundColor: [backgroundColor[0], backgroundColor[1], backgroundColor[2], 150],
      backgroundPadding: [4, 2],
      pickable: true,
    }))
  }

  if (arcPath.value.length >= 2) {
    layers.push(new PathLayer({
      id: 'flag-arc',
      data: [{ path: arcPath.value }],
      getPath: (d: { path: [number, number][] }) => d.path,
      getColor: [245, 197, 66, 200],
      getWidth: 2,
      widthUnits: 'pixels',
      pickable: false,
    }))
  }

  if (trackLabels.value.length > 0) {
    layers.push(new TextLayer({
      id: 'track-labels',
      ...textLayerProps(),
      data: trackLabels.value,
      getPosition: (d: LabelDatum) => d.position,
      getText: (d: LabelDatum) => d.text,
      getColor: (d: LabelDatum) => d.color,
      getSize: 14,
      getPixelOffset: [13, -13],
      getTextAnchor: 'start',
      getAlignmentBaseline: 'center',
      background: true,
      getBackgroundColor: [backgroundColor[0], backgroundColor[1], backgroundColor[2], 160],
      backgroundPadding: [4, 2],
      pickable: true,
    }))
  }

  return layers
}

function setDeckProps() {
  if (!deck) return
  deck.setProps({
    viewState: viewState.value,
    layers: buildLayers(),
  })
}

function emitViewStatus(pointer = lastPointer) {
  const longitudeLatitude = pointer ? unproject(pointer.x, pointer.y) : null
  emit('view-status', {
    cameraHeightKm: zoomToApproxHeightKm(viewState.value.zoom),
    longitude: longitudeLatitude ? normalizeLongitude(longitudeLatitude[0]) : 0,
    latitude: longitudeLatitude?.[1] ?? 0,
  })
}

function unproject(x: number, y: number): [number, number] | null {
  if (!containerRef.value) return null
  const { clientWidth, clientHeight } = containerRef.value
  if (x < 0 || y < 0 || x > clientWidth || y > clientHeight) return null
  try {
    const viewport = new WebMercatorViewport({
      width: clientWidth,
      height: clientHeight,
      longitude: viewState.value.longitude,
      latitude: viewState.value.latitude,
      zoom: viewState.value.zoom,
      pitch: viewState.value.pitch,
      bearing: viewState.value.bearing,
    })
    const result = viewport.unproject([x, y])
    if (!Number.isFinite(result[0]) || !Number.isFinite(result[1])) return null
    if (Math.abs(result[1]) > 85.051129) return null
    return [result[0], result[1]]
  } catch {
    return null
  }
}

function zoomToApproxHeightKm(zoom: number) {
  return 40_075 / Math.pow(2, zoom)
}

function pickedTrackKey(object: unknown): string | null {
  const picked = object as Partial<PathDatum | PointDatum | LabelDatum> | undefined
  if (picked?.kind === 'track' && typeof picked.trackKey === 'string' && picked.trackKey) return picked.trackKey
  return null
}

function pickedFlagId(object: unknown): string | null {
  const picked = object as Partial<FlagPointDatum | LabelDatum> | undefined
  if (picked?.kind === 'flag' && typeof picked.flagId === 'string' && picked.flagId) return picked.flagId
  return null
}

function pickedCityId(object: unknown): string | null {
  const picked = object as Partial<CityPointDatum | CityLabelDatum> | undefined
  if (picked?.kind === 'city' && typeof picked.cityId === 'string' && picked.cityId) return picked.cityId
  return null
}

function findTrackByKey(key: string) {
  return props.tracks.find(track => trackKey(track.id, track.source) === key) ?? null
}

function containerPointFromClient(clientX: number, clientY: number) {
  const rect = containerRef.value?.getBoundingClientRect()
  if (!rect) return { x: clientX, y: clientY }
  return { x: clientX - rect.left, y: clientY - rect.top }
}

function closeContextMenu() {
  contextMenu.value.visible = false
}

function handleContextRename() {
  const flag = flags.value.find(item => item.id === contextMenu.value.flagId)
  if (!flag) return
  const nextLabel = prompt('请输入新名称：', flag.label)
  if (nextLabel && nextLabel.trim()) renameFlag(flag.id, nextLabel.trim())
  closeContextMenu()
}

function handleContextDelete() {
  const flag = flags.value.find(item => item.id === contextMenu.value.flagId)
  if (!flag) return
  if (confirm(`确定要删除旗标「${flag.label}」吗？`)) removeFlag(flag.id)
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
  if (!trackId) return
  const { id, source } = parseTrackKey(trackId)
  addHighlight(id)
  emit('show-track-detail', { icao: id, source })
  closeContextMenu()
}

function handleContextViewPoints() {
  const track = findTrackByKey(contextMenu.value.trackId)
  if (track) emit('view-track-points', track)
  closeContextMenu()
}

function handleContextDeleteTrack() {
  const trackId = contextMenu.value.trackId
  if (!trackId) return
  const { id, source } = parseTrackKey(trackId)
  emit('delete-track', { icao: id, source })
  closeContextMenu()
}

/** rAF-batched pick for hover: exactly mirrors CesiumMap's onMouseMove → rAF → scene.pick pattern */
function doPick(x: number, y: number) {
  if (!deck || !canvasRef.value) return
  const info = deck.pickObject({ x, y, radius: 10 }) as PickingInfo | null
  const obj = info?.object
  const key = pickedTrackKey(obj)
  const cityId = pickedCityId(obj)
  if (key !== hoveredTrackId || cityId !== hoveredCityId) {
    hoveredTrackId = key
    hoveredCityId = cityId
    setDeckProps()
  }
}

function onClick(info: PickingInfo) {
  closeContextMenu()
  const flagId = pickedFlagId(info.object)
  if (flagId) {
    toggleSelectFlag(flagId)
    return
  }
  const key = pickedTrackKey(info.object)
  emit('track-pick', key)
}

function handleDoubleClick(event: MouseEvent) {
  event.preventDefault()
  closeContextMenu()
  if (!deck || !canvasRef.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  const info = deck.pickObject({ x, y, radius: 10 }) as PickingInfo | null
  const flagId = pickedFlagId(info?.object)
  if (flagId) {
    removeFlag(flagId)
    return
  }

  const coordinate = unproject(x, y)
  if (!coordinate) return
  const [longitude, latitude] = coordinate
  addFlag(latitude, normalizeLongitude(longitude))
}

function onContextMenu(event: MouseEvent) {
  event.preventDefault()
  if (!deck || !canvasRef.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top

  // Use generous radius (matching Cesium's scene.pick tolerance) for reliable hit detection
  const info = deck.pickObject({ x, y, radius: 15 }) as PickingInfo | null
  const object = info?.object
  const flagId = pickedFlagId(object)
  if (flagId) {
    const flag = flags.value.find(item => item.id === flagId)
    if (flag) {
      contextMenuOpenedAt = Date.now()
      hoveredTrackId = pickedTrackKey(object) // may also be hovering a track underneath
      contextMenu.value = {
        visible: true,
        ...containerPointFromClient(event.clientX, event.clientY),
        type: 'flag',
        flagId: flag.id,
        flagLabel: flag.label,
        trackId: '',
      }
      return
    }
  }

  const key = pickedTrackKey(object)
  if (key && findTrackByKey(key)) {
    hoveredTrackId = key
    contextMenuOpenedAt = Date.now()
    contextMenu.value = {
      visible: true,
      ...containerPointFromClient(event.clientX, event.clientY),
      type: 'track',
      flagId: '',
      flagLabel: '',
      trackId: key,
    }
    setDeckProps()
    return
  }

  closeContextMenu()
}

function onMouseLeave() {
  lastPointer = null
  hoveredTrackId = null
  hoveredCityId = null
  emitViewStatus(null)
  setDeckProps()
}

async function loadBoundaryData() {
  const loaded: Record<BoundaryLayerKey, any> = { coastline: null, admin0: null, admin1: null }
  await Promise.all(BOUNDARY_LAYERS.map(async (boundary) => {
    try {
      const response = await fetch(boundary.url)
      if (response.ok) loaded[boundary.key] = await response.json()
    } catch (error) {
      console.warn(`[deck] failed to load boundary ${boundary.key}:`, error)
    }
  }))
  boundaryData.value = loaded
}

async function loadCityData() {
  try {
    const response = await fetch('/cities/cities.geojson')
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const geojson = await response.json()
    const features = Array.isArray(geojson.features) ? geojson.features : []
    cityFeatures.value = features
      .map((feature: any): CityFeature | null => {
        const coordinates = feature?.geometry?.coordinates
        const properties = feature?.properties ?? {}
        if (!Array.isArray(coordinates) || coordinates.length < 2) return null
        const longitude = Number(coordinates[0])
        const latitude = Number(coordinates[1])
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null
        return {
          id: String(properties.id || properties.geoname_id || `${longitude},${latitude}`),
          nameZh: String(properties.name_zh || properties.name_en || ''),
          nameEn: String(properties.name_en || properties.name_zh || ''),
          country: String(properties.country || ''),
          population: Number(properties.population || 0),
          rank: Number(properties.rank || 99),
          level: normalizeCityLevel(properties.level, properties.feature_code, Boolean(properties.capital)),
          featureCode: String(properties.feature_code || ''),
          capital: Boolean(properties.capital),
          longitude,
          latitude,
        }
      })
      .filter((city: CityFeature | null): city is CityFeature => city !== null && city.nameZh.length > 0)
  } catch (error) {
    console.warn('[deck] failed to load cities:', error)
  }
}

function normalizeCityLevel(level: unknown, featureCode: unknown, capital: boolean): CityLevel {
  if (level === 'capital' || level === 'regional' || level === 'prefecture' || level === 'major') return level
  if (capital || featureCode === 'PPLC') return 'capital'
  if (featureCode === 'PPLA') return 'regional'
  if (featureCode === 'PPLA2') return 'prefecture'
  return 'major'
}

function persistCameraState() {
  scheduleSave(FLAT_CAMERA_SETTING_KEY, JSON.stringify(viewState.value))
}

function restoreCameraState() {
  const raw = getRawSetting(FLAT_CAMERA_SETTING_KEY)
  if (!raw) return false
  try {
    const state = JSON.parse(raw)
    if (
      typeof state.longitude !== 'number' ||
      typeof state.latitude !== 'number' ||
      typeof state.zoom !== 'number'
    ) return false
    viewState.value = {
      longitude: state.longitude,
      latitude: state.latitude,
      zoom: state.zoom,
      pitch: typeof state.pitch === 'number' ? state.pitch : 0,
      bearing: typeof state.bearing === 'number' ? state.bearing : 0,
    }
    return true
  } catch {
    return false
  }
}

function flyToTrack(track: Track) {
  const positions = track.positions
  if (positions.length === 0) return
  const longitudes = positions.map(point => point.longitude)
  const normalizedLongitudes = unwrapLongitudes(longitudes)
  let minLon = Number.POSITIVE_INFINITY
  let maxLon = Number.NEGATIVE_INFINITY
  let minLat = Number.POSITIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY
  for (let index = 0; index < positions.length; index++) {
    const point = positions[index]
    const longitude = normalizedLongitudes[index]
    minLon = Math.min(minLon, longitude)
    maxLon = Math.max(maxLon, longitude)
    minLat = Math.min(minLat, point.latitude)
    maxLat = Math.max(maxLat, point.latitude)
  }
  viewState.value = {
    ...viewState.value,
    longitude: normalizeLongitude((minLon + maxLon) / 2),
    latitude: (minLat + maxLat) / 2,
    zoom: Math.max(4, Math.min(10, viewState.value.zoom + 2)),
  }
  setDeckProps()
}

function flyToFlag(flag: { longitude: number; latitude: number }) {
  viewState.value = { ...viewState.value, longitude: normalizeLongitude(flag.longitude), latitude: flag.latitude, zoom: 10 }
  setDeckProps()
}

function resetView() {
  viewState.value = { ...DEFAULT_VIEW_STATE }
  setDeckProps()
  emitViewStatus(null)
}

function switchTileLayer(maxZoom?: number) {
  tileMaxZoom = maxZoom ?? 8
  setDeckProps()
}

onMounted(async () => {
  if (!containerRef.value || !canvasRef.value) return
  tileServerPort = await invoke('get_tile_server_port') as number
  await Promise.all([loadBoundaryData(), loadCityData(), whenSettingsLoaded()])
  restoreCameraState()

  deck = new Deck<any>({
    canvas: canvasRef.value,
    views: new MapView({ id: 'flat', controller: true }),
    viewState: viewState.value,
    controller: { dragRotate: false, touchRotate: false, scrollZoom: { speed: 0.01, smooth: true } },
    pickingRadius: 5,
    layers: buildLayers(),
    useDevicePixels: true,
    getCursor: () => 'crosshair',
    onViewStateChange: ({ viewState: nextViewState }: { viewState: any }) => {
      viewState.value = {
        longitude: normalizeLongitude(nextViewState.longitude),
        latitude: nextViewState.latitude,
        zoom: nextViewState.zoom,
        pitch: 0,
        bearing: nextViewState.bearing ?? 0,
      }
      // deck.gl auto-renders existing layers at the new view state — no need
      // to rebuild layers (expensive: boundary world-wrapping, city LOD, etc.)
      // on every drag tick. Debounce to 200ms after the user stops dragging.
      emitViewStatus()
      if (viewChangeTimer) clearTimeout(viewChangeTimer)
      viewChangeTimer = setTimeout(() => {
        viewChangeTimer = null
        setDeckProps()
      }, 200)
      if (saveCameraTimer) clearTimeout(saveCameraTimer)
      saveCameraTimer = setTimeout(persistCameraState, 400)
    },
    onClick,
  })

  canvasRef.value.addEventListener('mouseleave', onMouseLeave)
  // Native mousemove → rAF-batched pick (mirrors CesiumMap's onMouseMove → rAF → scene.pick)
  mouseMoveFn = (e: MouseEvent) => {
    const rect = canvasRef.value!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    lastPointer = { x, y }
    emitViewStatus(lastPointer)
    if (!pickScheduled) {
      pickScheduled = true
      requestAnimationFrame(() => {
        pickScheduled = false
        doPick(x, y)
      })
    }
  }
  canvasRef.value.addEventListener('mousemove', mouseMoveFn)
  contextMenuFn = onContextMenu
  canvasRef.value.addEventListener('contextmenu', contextMenuFn)
  doubleClickFn = handleDoubleClick
  canvasRef.value.addEventListener('dblclick', doubleClickFn)
  clickOutsideFn = (_e: MouseEvent) => {
    // Ignore clicks within 200ms of opening the context menu — the contextmenu
    // event is often followed by a click event from the same mouse button release
    if (Date.now() - contextMenuOpenedAt < 200) return
    closeContextMenu()
  }
  document.addEventListener('click', clickOutsideFn)
  keyDownFn = (event: KeyboardEvent) => {
    if (event.key === 'Escape') closeContextMenu()
  }
  document.addEventListener('keydown', keyDownFn)
  resizeObserver = new ResizeObserver(() => {
    deck?.setProps({
      width: containerRef.value?.clientWidth,
      height: containerRef.value?.clientHeight,
    })
    emitViewStatus()
  })
  resizeObserver.observe(containerRef.value)
  emitViewStatus(null)
})

// Main watch: everything EXCEPT replayTime (which updates at 60fps during playback)
watch(
  [
    () => props.tracks,
    () => props.selectedId,
    () => props.lineWidths,
    () => props.dotScale,
    visibility,
    showLabels,
    showAllPointDots,
    trackPointDotScale,
    lineColors,
    pointDotColors,
    flags,
    flagScale,
    cityLayer,
    boundaryVisible,
    boundaryWidths,
    boundaryColors,
    activeTheme,
    cityFeatures,
    boundaryData,
    manualPointDotsTrackIds,
    globalHiddenTrackKeys,
    selectedPair,
  ],
  () => setDeckProps(),
  { deep: true },
)

// Replay: rAF-throttled update during playback; restore full tracks on stop
let wasReplaying = false
watch(
  () => props.replayTime,
  (time) => {
    if (time !== null) {
      wasReplaying = true
      if (replayRafId !== null) return // already scheduled for this frame
      replayRafId = requestAnimationFrame(() => {
        replayRafId = null
        setDeckProps()
      })
    } else if (wasReplaying) {
      wasReplaying = false
      setDeckProps() // restore full tracks
    }
  },
)

watch(clearAllCounter, () => {
  manualPointDotsTrackIds.value = new Set()
  globalHiddenTrackKeys.value = new Set()
  setDeckProps()
})

onUnmounted(() => {
  if (saveCameraTimer) {
    clearTimeout(saveCameraTimer)
    saveCameraTimer = null
  }
  if (viewChangeTimer) {
    clearTimeout(viewChangeTimer)
    viewChangeTimer = null
  }
  if (replayRafId !== null) {
    cancelAnimationFrame(replayRafId)
    replayRafId = null
  }
  persistCameraState()
  canvasRef.value?.removeEventListener('mouseleave', onMouseLeave)
  if (mouseMoveFn) {
    canvasRef.value?.removeEventListener('mousemove', mouseMoveFn)
    mouseMoveFn = null
  }
  if (contextMenuFn) {
    canvasRef.value?.removeEventListener('contextmenu', contextMenuFn)
    contextMenuFn = null
  }
  if (doubleClickFn) {
    canvasRef.value?.removeEventListener('dblclick', doubleClickFn)
    doubleClickFn = null
  }
  if (clickOutsideFn) {
    document.removeEventListener('click', clickOutsideFn)
    clickOutsideFn = null
  }
  if (keyDownFn) {
    document.removeEventListener('keydown', keyDownFn)
    keyDownFn = null
  }
  resizeObserver?.disconnect()
  resizeObserver = null
  deck?.finalize()
  deck = null
})

defineExpose({ flyToTrack, flyToFlag, resetView, switchTileLayer })
</script>

<style scoped>
.deck-container {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--cesium-bg);
}

.deck-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  cursor: crosshair;
}

.context-menu {
  position: absolute;
  z-index: 1000;
  min-width: 132px;
  background: var(--bg-panel, #1e1e2e);
  border: 1px solid var(--border-color, #3a3a5c);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  padding: 4px 0;
  font-size: 13px;
  user-select: none;
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  cursor: pointer;
  color: var(--text-primary, #cdd6f4);
  white-space: nowrap;
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
