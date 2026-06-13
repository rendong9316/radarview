<template>
  <div class="deck-container" ref="containerRef">
    <div v-if="contextMenu.visible" class="context-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @click.stop>
      <template v-if="contextMenu.type === 'flag'">
        <div class="context-menu-item" @click="handleContextRename"><Pencil :size="13" /> 重命名</div>
        <div class="context-menu-item context-menu-danger" @click="handleContextDelete"><Trash2 :size="13" /> 删除</div>
      </template>
      <template v-else-if="contextMenu.type === 'track'">
        <div v-if="!isTrackShowingDots(contextMenu.trackId)" class="context-menu-item" @click="handleContextShowPointDots"><Dot :size="13" /> 显示所有对应点迹</div>
        <div v-else class="context-menu-item" @click="handleContextHidePointDots"><Circle :size="13" /> 隐藏所有对应点迹</div>
        <div class="context-menu-item" @click="handleContextShowDetail"><FileText :size="13" /> 详细信息</div>
        <div class="context-menu-item" @click="handleContextViewPoints"><ClipboardList :size="13" /> 查看点迹数据</div>
        <div class="context-menu-item context-menu-danger" @click="handleContextDeleteTrack"><Trash2 :size="13" /> 删除该航迹</div>
      </template>
    </div>
    <canvas ref="deckCanvas" class="deck-canvas" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, shallowRef } from 'vue'
import { Deck, _GlobeView as GlobeView } from '@deck.gl/core'
import type { PickingInfo } from '@deck.gl/core'
import { GeoJsonLayer, PathLayer, ScatterplotLayer, TextLayer, BitmapLayer } from '@deck.gl/layers'
import { TileLayer } from '@deck.gl/geo-layers'
import { invoke } from '@tauri-apps/api/core'
import type { Track, DataSource } from '../types/track'
import { useLineColor } from '../composables/useLineColor'
import { useLayerVisibility } from '../composables/useLayerVisibility'
import { useLabelVisibility } from '../composables/useLabelVisibility'
import { useFlags } from '../composables/useFlags'
import { useFlagScale } from '../composables/useFlagScale'
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
const deckCanvas = ref<HTMLCanvasElement>()
let deckInstance: Deck | null = null
let tileServerPort = 0
let _cameraSaveTimer: ReturnType<typeof setTimeout> | null = null

const { getEffectiveHex, lineColors } = useLineColor()
const { visibility } = useLayerVisibility()
const { showLabels } = useLabelVisibility()
const { flags, removeFlag, addFlag } = useFlags()
const { flagScale } = useFlagScale()
const { activeTheme } = useTheme()
const { boundaryVisible, boundaryWidths, boundaryColors } = useBoundaryLayers()
const cityLayer = useCityLayer().cityLayer

const BOUNDARY_LAYERS: { key: BoundaryLayerKey; url: string; alpha: number }[] = [
  { key: 'coastline', url: '/boundaries/coastline.geojson', alpha: 0.7 },
  { key: 'admin1', url: '/boundaries/admin1.geojson', alpha: 0.55 },
  { key: 'admin0', url: '/boundaries/admin0.geojson', alpha: 0.85 },
]

let hoveredTrackId: string | null = null
const previousSelectedId = ref<string | null>(null)
const contextMenu = ref<{ visible: boolean; x: number; y: number; type: 'flag' | 'track'; flagId: string; flagLabel: string; trackId: string }>(
  { visible: false, x: 0, y: 0, type: 'flag', flagId: '', flagLabel: '', trackId: '' }
)
let ctxClickOutsideFn: (() => void) | null = null
let ctxKeyFn: ((e: KeyboardEvent) => void) | null = null
const pointDotEntityMap = new Map<string, any[]>()
function isTrackShowingDots(tk: string): boolean { return pointDotEntityMap.has(tk) }

interface CityFeature {
  id: string; nameZh: string; nameEn: string; country: string
  population: number; rank: number; level: CityLevel; featureCode: string
  capital: boolean; longitude: number; latitude: number
}
let cityFeatures: CityFeature[] = []

interface GlobeViewState { longitude: number; latitude: number; zoom: number; pitch: number; bearing: number }
const viewState = shallowRef<GlobeViewState>({ longitude: 116.4, latitude: 39.9, zoom: 5, pitch: 0, bearing: 0 })

const HOVER_COLOR: [number, number, number] = [255, 51, 51]
const HOVER_WIDTH = 5; const SELECTED_WIDTH = 4
const DOT_BASE = 0.7; const DOT_RAW = 0.4; const DOT_SELECTED = 1.2; const DOT_HOVER = 1.3
const POINT_PRIMITIVE_BASE = 12

function getLineColor(source: DataSource): [number, number, number] {
  const hex = getEffectiveHex(source)
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
}
function pointPrimSize(dotBase: number, source: string): number {
  return POINT_PRIMITIVE_BASE * (dotBase / DOT_BASE) * (props.dotScale[source as DataSource] ?? 1.0)
}
function baseWidth(source: DataSource): number { return props.lineWidths[source] ?? 2.0 }

interface PathData { id: string; path: [number, number][]; color: [number, number, number]; width: number; source: string; trackKey: string }
interface DotData { id: string; position: [number, number]; color: [number, number, number]; size: number; source: string; trackKey: string }
interface LabelData { id: string; position: [number, number]; text: string; color: [number, number, number]; source: string }
interface FlagData { id: string; position: [number, number]; label: string; size: number }

const pathData = shallowRef<PathData[]>([])
const dotData = shallowRef<DotData[]>([])
const labelData = shallowRef<LabelData[]>([])
const flagData = shallowRef<FlagData[]>([])
const boundaryData = shallowRef<Record<BoundaryLayerKey, any>>({ coastline: null, admin0: null, admin1: null })
const cityDotData = shallowRef<{ id: string; position: [number, number]; color: [number, number, number]; size: number }[]>([])
const cityLabelData = shallowRef<{ id: string; position: [number, number]; text: string; color: [number, number, number] }[]>([])
const hoverOverlayData = shallowRef<PathData[]>([])

function rebuildTrackLayerData() {
  const paths: PathData[] = []; const dots: DotData[] = []; const labels: LabelData[] = []; const hoverOverlay: PathData[] = []
  const replayTime = props.replayTime
  for (const track of props.tracks) {
    if (track.positions.length < 2) continue
    const tKey = trackKey(track.id, track.source); const color = getLineColor(track.source)
    const isSelected = tKey === props.selectedId; const isHovered = hoveredTrackId === tKey
    let visiblePositions = track.positions
    if (replayTime !== null) {
      visiblePositions = track.positions.filter(p => p.timestamp <= replayTime)
      if (visiblePositions.length < 2) continue
    }
    const pathCoords = visiblePositions.map(p => [p.longitude, p.latitude] as [number, number])
    paths.push({ id: `${tKey}::line`, path: pathCoords, color, width: isSelected ? SELECTED_WIDTH : baseWidth(track.source), source: track.source, trackKey: tKey })
    if (isHovered && !isSelected) hoverOverlay.push({ id: `hover::${tKey}`, path: pathCoords, color: HOVER_COLOR, width: HOVER_WIDTH, source: track.source, trackKey: tKey })
    const last = visiblePositions[visiblePositions.length - 1]
    const dotSizeBase = isHovered ? DOT_HOVER : isSelected ? DOT_SELECTED : track.source === 'radar_raw' ? DOT_RAW : DOT_BASE
    dots.push({ id: tKey, position: [last.longitude, last.latitude], color: isHovered ? HOVER_COLOR : color, size: pointPrimSize(dotSizeBase, track.source), source: track.source, trackKey: tKey })
    if (showLabels.value) {
      const label = [track.metadata.flightNumber, track.metadata.aircraftType].filter(Boolean).join(' | ')
      labels.push({ id: `${tKey}::label`, position: [last.longitude, last.latitude], text: label || track.id, color, source: track.source })
    }
  }
  pathData.value = paths; dotData.value = dots; labelData.value = labels; hoverOverlayData.value = hoverOverlay
}

function rebuildFlagLayerData() {
  flagData.value = flags.value.map(f => ({ id: f.id, position: [f.longitude, f.latitude] as [number, number], label: f.label, size: (flagScale as any).value ?? 1.0 }))
}

async function loadBoundaryLayers() {
  for (const layer of BOUNDARY_LAYERS) {
    try { const resp = await fetch(layer.url); boundaryData.value = { ...boundaryData.value, [layer.key]: await resp.json() } } catch { /* optional */ }
  }
}

async function loadCityLayer() {
  try {
    const features = await invoke('load_city_features') as CityFeature[]
    if (features?.length) { cityFeatures = features; updateCityLayers() }
  } catch { /* optional */ }
}

function updateCityLayers() {
  const dots: typeof cityDotData.value = []; const labels: typeof cityLabelData.value = []
  for (const f of cityFeatures) {
    const levelKey = f.level; const levelCfg = (cityLayer as any).levels?.[levelKey]
    if (!levelCfg?.visible) continue
    const hex = ((cityLayer as any)[levelKey]?.color || '#888888').replace('#', '')
    const r = parseInt(hex.slice(0, 2), 16); const g = parseInt(hex.slice(2, 4), 16); const b = parseInt(hex.slice(4, 6), 16)
    dots.push({ id: f.id, position: [f.longitude, f.latitude], color: [r, g, b], size: (cityLayer as any).pointSize ?? 4 })
    if ((cityLayer as any).labels && f.nameZh) labels.push({ id: `city::label::${f.id}`, position: [f.longitude, f.latitude], text: f.nameZh, color: [r, g, b] })
  }
  cityDotData.value = dots; cityLabelData.value = labels
}

function flyToTrack(track: Track) {
  if (track.positions.length === 0) return
  const mid = Math.floor(track.positions.length / 2)
  viewState.value = { ...viewState.value, longitude: track.positions[mid].longitude, latitude: track.positions[mid].latitude, zoom: 10 }
}
function flyToFlag(flag: Flag) { viewState.value = { ...viewState.value, longitude: flag.longitude, latitude: flag.latitude, zoom: 12 } }
function resetView() { viewState.value = { longitude: 116.4, latitude: 39.9, zoom: 5, pitch: 0, bearing: 0 } }
function switchTileLayer(_maxZoom?: number) { /* no-op */ }

function onHover(info: PickingInfo) {
  if (!info.object) { if (hoveredTrackId) { hoveredTrackId = null; rebuildTrackLayerData(); scheduleDeckUpdate() } return }
  const tk = (info.object as any).trackKey as string | undefined
  if (tk && hoveredTrackId !== tk) { hoveredTrackId = tk; rebuildTrackLayerData(); scheduleDeckUpdate() }
  else if (!tk && hoveredTrackId) { hoveredTrackId = null; rebuildTrackLayerData(); scheduleDeckUpdate() }
}

function onClick(info: PickingInfo) {
  const tk = (info.object as any)?.trackKey as string | undefined
  if (tk) { emit('track-pick', tk) }
}

function onRightClick(info: PickingInfo | null, event: MouseEvent) {
  if (info && (info.object as any)?.trackKey && hoveredTrackId === (info.object as any).trackKey) {
    contextMenu.value = { visible: true, x: event.clientX, y: event.clientY, type: 'track', flagId: '', flagLabel: '', trackId: (info.object as any).trackKey }
  } else { closeContextMenu() }
}

function closeContextMenu() { contextMenu.value = { visible: false, x: 0, y: 0, type: 'flag', flagId: '', flagLabel: '', trackId: '' } }
function handleContextRename() { closeContextMenu() }
function handleContextDelete() { const id = contextMenu.value.flagId; if (id) removeFlag(id); closeContextMenu() }
function handleContextShowPointDots() { closeContextMenu() }
function handleContextHidePointDots() { closeContextMenu() }
function handleContextShowDetail() {
  if (contextMenu.value.trackId) { const parts = contextMenu.value.trackId.split('::'); emit('show-track-detail', { icao: parts[0], source: parts.slice(1).join('::') }) }
  closeContextMenu()
}
function handleContextViewPoints() { closeContextMenu() }
function handleContextDeleteTrack() {
  if (contextMenu.value.trackId) { const parts = contextMenu.value.trackId.split('::'); emit('delete-track', { icao: parts[0], source: parts.slice(1).join('::') }) }
  closeContextMenu()
}

function persistCameraState() {
  const vs = viewState.value
  scheduleSave('camera.view', JSON.stringify({ longitude: vs.longitude, latitude: vs.latitude, zoom: vs.zoom, pitch: vs.pitch ?? 0, bearing: vs.bearing ?? 0 }))
}

async function restoreCameraState(): Promise<boolean> {
  const raw = getRawSetting('camera.view')
  if (!raw) return false
  try {
    const s = JSON.parse(raw)
    if (typeof s.longitude === 'number') { viewState.value = { ...viewState.value, longitude: s.longitude, latitude: s.latitude, zoom: s.zoom ?? 5, pitch: s.pitch ?? 0, bearing: s.bearing ?? 0 }; return true }
  } catch { /* keep default */ }
  return false
}

let _updateScheduled = false
function scheduleDeckUpdate() {
  if (_updateScheduled || !deckInstance) return
  _updateScheduled = true
  requestAnimationFrame(() => { _updateScheduled = false; if (deckInstance) deckInstance.setProps({ layers: buildLayers() }) })
}

let _basemapLayer: any = null
function getBasemapLayer(): any {
  if (!_basemapLayer && tileServerPort > 0) {
    _basemapLayer = new TileLayer({
      id: 'basemap',
      data: `http://127.0.0.1:${tileServerPort}/tiles/{z}/{x}/{y}.png`,
      minZoom: 0, maxZoom: 8, tileSize: 256,
      renderSubLayers: (props: any) => {
        const { data, tile, ...rest } = props
        if (!data) return null
        return new BitmapLayer(rest, {
          image: data,
          bounds: tile?.bbox
            ? [tile.bbox.west, tile.bbox.south, tile.bbox.east, tile.bbox.north]
            : undefined,
        })
      },
    })
  }
  return _basemapLayer
}

function buildLayers(): any[] {
  const layers: any[] = []

  // Cached basemap — created once, reused across updates
  const bm = getBasemapLayer()
  if (bm) layers.push(bm)

  for (const layer of BOUNDARY_LAYERS) {
    const geojson = (boundaryData.value as any)[layer.key]
    if (!geojson || !(boundaryVisible as any)[layer.key]) continue
    layers.push(new GeoJsonLayer({
      id: `boundary-${layer.key}`, data: geojson, stroked: true, filled: false,
      getLineColor: () => hexToRgb((boundaryColors as any)[layer.key] || '#888888'),
      lineWidthMinPixels: (boundaryWidths as any)[layer.key] ?? 1, opacity: layer.alpha, pickable: false,
    }))
  }

  if (pathData.value.length > 0) {
    layers.push(new PathLayer({ id: 'track-lines', data: pathData.value, getPath: (d: any) => d.path, getColor: (d: any) => d.color, getWidth: (d: any) => d.width, widthMinPixels: 1, opacity: 0.85, pickable: true } as any))
  }
  if (hoverOverlayData.value.length > 0) {
    layers.push(new PathLayer({ id: 'hover-overlay', data: hoverOverlayData.value, getPath: (d: any) => d.path, getColor: (d: any) => d.color, getWidth: (d: any) => d.width, widthMinPixels: 1, opacity: 1.0, pickable: false } as any))
  }
  if (dotData.value.length > 0) {
    layers.push(new ScatterplotLayer({ id: 'track-dots', data: dotData.value, getPosition: (d: any) => d.position, getFillColor: (d: any) => d.color, getRadius: (d: any) => d.size, radiusMinPixels: 3, pickable: true } as any))
  }
  if (labelData.value.length > 0) {
    layers.push(new TextLayer({ id: 'track-labels', data: labelData.value, getPosition: (d: any) => d.position, getText: (d: any) => d.text, getColor: (d: any) => d.color, fontSize: 12, getPixelOffset: () => [0, -15] as [number, number], pickable: false } as any))
  }
  if (flagData.value.length > 0) {
    layers.push(new ScatterplotLayer({ id: 'flags', data: flagData.value, getPosition: (d: any) => d.position, getFillColor: () => [255, 255, 0] as [number, number, number], getRadius: (_d: any) => 10, radiusMinPixels: 5, pickable: true } as any))
  }
  if (cityDotData.value.length > 0) {
    layers.push(new ScatterplotLayer({ id: 'city-dots', data: cityDotData.value, getPosition: (d: any) => d.position, getFillColor: (d: any) => d.color, getRadius: (d: any) => d.size, radiusMinPixels: 2, pickable: false } as any))
  }
  if (cityLabelData.value.length > 0) {
    layers.push(new TextLayer({ id: 'city-labels', data: cityLabelData.value, getPosition: (d: any) => d.position, getText: (d: any) => d.text, getColor: (d: any) => d.color, fontSize: 10, pickable: false } as any))
  }
  return layers
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

onMounted(async () => {
  if (!containerRef.value) return
  tileServerPort = await invoke('get_tile_server_port') as number
  await loadBoundaryLayers()
  await loadCityLayer()
  const canvas = deckCanvas.value; if (!canvas) return

  deckInstance = new Deck({
    canvas,
    views: new GlobeView({ id: 'globe', controller: true }),
    initialViewState: { longitude: viewState.value.longitude, latitude: viewState.value.latitude, zoom: viewState.value.zoom, pitch: viewState.value.pitch, bearing: viewState.value.bearing },
    controller: { maxZoom: 8, minZoom: 0, inertia: true },
    layers: [],
    onViewStateChange: ({ viewState: vs }: { viewState: any }) => {
      viewState.value = { longitude: vs.longitude, latitude: vs.latitude, zoom: vs.zoom, pitch: vs.pitch ?? 0, bearing: vs.bearing ?? 0 }
      if (_cameraSaveTimer) clearTimeout(_cameraSaveTimer)
      _cameraSaveTimer = setTimeout(persistCameraState, 500)
      if (vs.zoom !== undefined) {
        const heightKm = Math.pow(2, 20 - vs.zoom) * 0.04
        emit('view-status', { cameraHeightKm: heightKm, longitude: vs.longitude, latitude: vs.latitude })
      }
    },
    onHover: (info: PickingInfo) => onHover(info),
    onClick: (info: PickingInfo) => onClick(info),
    onDblClick: (info: PickingInfo) => {
      if (info.coordinate) { addFlag(info.coordinate[1], info.coordinate[0]) }
    },
  } as any)

  const cvs = canvas
  cvs.addEventListener('contextmenu', (e: MouseEvent) => { e.preventDefault(); if (deckInstance) onRightClick(deckInstance.pickObject({ x: e.clientX, y: e.clientY }), e) })
  ctxClickOutsideFn = () => closeContextMenu(); document.addEventListener('click', ctxClickOutsideFn)
  ctxKeyFn = (e: KeyboardEvent) => { if (e.key === 'Escape') closeContextMenu() }; document.addEventListener('keydown', ctxKeyFn)

  await whenSettingsLoaded(); restoreCameraState()
  rebuildTrackLayerData(); rebuildFlagLayerData(); scheduleDeckUpdate()
})

watch(() => props.tracks, () => { rebuildTrackLayerData(); scheduleDeckUpdate() }, { deep: false })
watch(() => props.replayTime, () => { rebuildTrackLayerData(); scheduleDeckUpdate() })
watch(() => props.selectedId, (newId) => { previousSelectedId.value = newId ?? null; rebuildTrackLayerData(); scheduleDeckUpdate() })
watch(() => props.lineWidths, () => { rebuildTrackLayerData(); scheduleDeckUpdate() }, { deep: true })
watch(() => props.dotScale, () => { rebuildTrackLayerData(); scheduleDeckUpdate() }, { deep: true })
watch(lineColors, () => { rebuildTrackLayerData(); scheduleDeckUpdate() }, { deep: true })
watch(showLabels, () => { rebuildTrackLayerData(); scheduleDeckUpdate() })
watch(visibility, () => { rebuildTrackLayerData(); scheduleDeckUpdate() }, { deep: true })
watch(flags, () => { rebuildFlagLayerData(); scheduleDeckUpdate() }, { deep: true })
watch(flagScale, () => { rebuildFlagLayerData(); scheduleDeckUpdate() })
watch(cityLayer, () => { updateCityLayers(); scheduleDeckUpdate() }, { deep: true })
watch(boundaryVisible, () => scheduleDeckUpdate(), { deep: true })
watch(boundaryWidths, () => scheduleDeckUpdate(), { deep: true })
watch(boundaryColors, () => scheduleDeckUpdate(), { deep: true })
watch(activeTheme, () => scheduleDeckUpdate())

onUnmounted(() => {
  if (_cameraSaveTimer) { clearTimeout(_cameraSaveTimer); _cameraSaveTimer = null }
  persistCameraState()
  if (deckInstance) { deckInstance.finalize(); deckInstance = null }
  if (ctxClickOutsideFn) document.removeEventListener('click', ctxClickOutsideFn)
  if (ctxKeyFn) document.removeEventListener('keydown', ctxKeyFn)
})

defineExpose({ flyToTrack, flyToFlag, resetView, switchTileLayer })
</script>

<style scoped>
.deck-container { position: absolute; inset: 0; width: 100%; height: 100%; overflow: hidden; background: #1a1a2e; }
.deck-canvas { width: 100%; height: 100%; display: block; }
.context-menu { position: fixed; background: #2d2d3f; border: 1px solid #555; border-radius: 6px; min-width: 160px; z-index: 1000; box-shadow: 0 4px 16px rgba(0,0,0,0.5); padding: 4px 0; }
.context-menu-item { padding: 7px 16px; font-size: 13px; cursor: pointer; color: #ddd; display: flex; align-items: center; gap: 8px; }
.context-menu-item:hover { background: #3d3d55; }
.context-menu-danger { color: #f87171; }
.context-menu-danger:hover { background: #4d2020; }
</style>
