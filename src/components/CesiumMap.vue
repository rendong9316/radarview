<template>
  <div class="cesium-container" ref="containerRef"></div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import * as Cesium from 'cesium'
import { invoke } from '@tauri-apps/api/core'
import type { Track, TrackPoint, DataSource } from '../types/track'
import { useTrackStyle } from '../composables/useTrackStyle'
import { useLayerVisibility } from '../composables/useLayerVisibility'
import { useLabelVisibility } from '../composables/useLabelVisibility'
import { useFlags } from '../composables/useFlags'
import { useFlagScale } from '../composables/useFlagScale'
import { trackKey } from '../composables/useTracks'
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
}>()

const containerRef = ref<HTMLDivElement>()

let viewer: Cesium.Viewer | null = null
let clickHandler: Cesium.ScreenSpaceEventHandler | null = null
let dblClickHandler: Cesium.ScreenSpaceEventHandler | null = null
let moveHandler: Cesium.ScreenSpaceEventHandler | null = null
let pendingClearTimeout: ReturnType<typeof setTimeout> | null = null
const { getColor, getIcon } = useTrackStyle()
const { visibility } = useLayerVisibility()
const { showLabels } = useLabelVisibility()
const { flags, addFlag, removeFlag, selectedPair } = useFlags()
const { flagScale } = useFlagScale()

let arcEntity: Cesium.Entity | undefined

const LABEL_FONT_BASE = '12px sans-serif'
const LABEL_FONT_LARGE = '18px sans-serif'

interface TrackEntities {
  polyline: Cesium.Entity | undefined
  billboard: Cesium.Entity
  source: string
  labelText: string
  /** Mutable holder for current polyline positions — updated each replay frame,
   *  read by a CallbackProperty so Cesium picks up changes without recreating entities. */
  trailRef: { positions: Cesium.Cartesian3[] }
  /** Last lo index from binary search — polyline only updated when this advances */
  lastTrailLo: number
}

const entityMap = new Map<string, TrackEntities>()
const flagEntityMap = new Map<string, Cesium.Entity>()

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
        entity.billboard.scale = new Cesium.ConstantProperty(0.8 * s)
      }
    }
  }

  viewer.entities.resumeEvents()
  viewer.scene.requestRender()
}

/** Batch-convert TrackPoint[] → Cartesian3[] using Cesium's SIMD-optimized API.
 *  Eliminates ~N individual fromDegrees() calls with one vectorized operation. */
function toCartesianArray(positions: TrackPoint[]): Cesium.Cartesian3[] {
  const flat = new Array(positions.length * 3)
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]
    flat[i * 3]     = p.longitude
    flat[i * 3 + 1] = p.latitude
    flat[i * 3 + 2] = p.altitude
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

  const color = getColor(track.source)
  const icon = getIcon(track.source)
  const tKey = trackKey(track.id, track.source)
  const isSelected = tKey === props.selectedId
  const isRaw = track.source === 'radar_raw'
  const replaying = props.replayTime !== null

  // Mutable holder for polyline positions; CallbackProperty reads from this
  // so we can update the trail every frame without recreating entities.
  // During active replay, start empty — updateReplayPositions will fill the correct partial trail.
  const trailRef = { positions: replaying ? [] : toCartesianArray(track.positions) }

  let polyline: Cesium.Entity | undefined
  if (track.positions.length >= 2) {
    const width = isSelected ? SELECTED_WIDTH : baseWidth(track.source)
    const alpha = isSelected ? SELECTED_ALPHA : isRaw ? RAW_ALPHA : NORMAL_ALPHA
    polyline = viewer.entities.add({
      id: `${tKey}::line`,
      show: !replaying, // hide until updateReplayPositions sets correct partial trail
      polyline: {
        positions: new Cesium.CallbackProperty(() => trailRef.positions, false),
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
  const billboardScale = dotSize(isSelected ? DOT_SELECTED : isRaw ? DOT_RAW : DOT_BASE, track.source)
  const billboard = viewer.entities.add({
    id: `${tKey}::dot`,
    show: true,
    position: Cesium.Cartesian3.fromDegrees(last.longitude, last.latitude, last.altitude),
    billboard: {
      image: icon,
      scale: billboardScale,
    },
    label: {
      text: showLabels.value ? (label || track.id) : '',
      font: showLabels.value ? LABEL_FONT_LARGE : LABEL_FONT_BASE,
      fillColor: color,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -20),
    },
  })

  entityMap.set(tKey, { polyline, billboard, source: track.source, labelText: label || track.id, trailRef, lastTrailLo: track.positions.length - 1 })
}

function removeTrackEntities(id: string) {
  const entry = entityMap.get(id)
  if (entry && viewer) {
    if (entry.polyline) viewer.entities.remove(entry.polyline)
    viewer.entities.remove(entry.billboard)
    entityMap.delete(id)
  }
}

function clearAllEntities() {
  if (!viewer) return
  for (const [id] of entityMap) {
    removeTrackEntities(id)
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
      if (existing.polyline) {
        if (hasEnoughPoints) {
          // During active replay, let updateReplayPositions own trailRef — avoid ghost full-track polyline
          if (!replaying) {
            existing.trailRef.positions = toCartesianArray(track.positions)
          }
          existing.polyline.show = true
        } else {
          existing.polyline.show = false
        }
      } else if (hasEnoughPoints) {
        // Polyline didn't exist before but now has enough points (e.g. filter cleared)
        const color = getColor(track.source)
        const tKey = trackKey(track.id, track.source)
        if (!replaying) {
          existing.trailRef.positions = toCartesianArray(track.positions)
        }
        existing.polyline = viewer.entities.add({
          id: `${tKey}::line`,
          show: true,
          polyline: {
            positions: new Cesium.CallbackProperty(() => existing.trailRef.positions, false),
            width: tSel ? SELECTED_WIDTH : baseWidth(track.source),
            material: color.withAlpha(tSel ? SELECTED_ALPHA : isRaw ? 0.6 : NORMAL_ALPHA),
            clampToGround: false,
          },
        })
      }

      // Update billboard to last position
      const last = track.positions[track.positions.length - 1]
      existing.billboard.position = Cesium.Cartesian3.fromDegrees(last.longitude, last.latitude, last.altitude) as any
    }
  } finally {
    viewer.entities.resumeEvents()
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

    // --- Billboard: always update (cheap, just one position) ---
    entities.billboard.position = Cesium.Cartesian3.fromDegrees(
      trail.currentPoint.longitude,
      trail.currentPoint.latitude,
      trail.currentPoint.altitude,
    ) as any

    // --- Polyline: only rebuild when new data points enter the visible window ---
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

      // Update trailRef — CallbackProperty on the polyline reads this array reference
      entities.trailRef.positions = toCartesianArray(allVisible)

      if (entities.polyline) {
        entities.polyline.show = allVisible.length >= 2
      } else if (allVisible.length >= 2) {
        const color = getColor(track.source)
        const tKey = trackKey(track.id, track.source)
        const isSel = tKey === props.selectedId
        const isRaw = track.source === 'radar_raw'
        entities.polyline = viewer.entities.add({
          id: `${tKey}::line`,
          show: true,
          polyline: {
            positions: new Cesium.CallbackProperty(() => entities.trailRef.positions, false),
            width: isSel ? SELECTED_WIDTH : baseWidth(track.source),
            material: color.withAlpha(isSel ? SELECTED_ALPHA : isRaw ? RAW_ALPHA : NORMAL_ALPHA),
            clampToGround: false,
          },
        })
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
      updateReplayPositions(time)
      wasReplaying = true
    } else if (wasReplaying) {
      wasReplaying = false
      // Restore full polylines + billboards to last position
      for (const track of props.tracks) {
        const entities = entityMap.get(trackKey(track.id, track.source))
        if (!entities || track.positions.length === 0) continue
        const last = track.positions[track.positions.length - 1]
        // Restore trailRef to full track positions — CallbackProperty picks it up
        entities.trailRef.positions = toCartesianArray(track.positions)
        entities.lastTrailLo = track.positions.length - 1
        if (entities.polyline) {
          entities.polyline.show = track.positions.length >= 2
        }
        // Restore billboard to last position
        entities.billboard.position = Cesium.Cartesian3.fromDegrees(last.longitude, last.latitude, last.altitude) as any
      }
      viewer?.scene.requestRender()
    }
  },
)

watch(
  visibility,
  () => {
    for (const [, entities] of entityMap) {
      const vis = visibility.value[entities.source as keyof typeof visibility.value]
      if (entities.polyline) entities.polyline.show = vis
      entities.billboard.show = vis
    }
    viewer?.scene.requestRender()
  },
  { deep: true },
)

// Reactive line width: update existing polylines when slider changes
watch(
  () => props.lineWidths,
  () => {
    for (const [tKey, entry] of entityMap) {
      if (entry.polyline && tKey !== previousSelectedId) {
        ;(entry.polyline.polyline as any).width = baseWidth(entry.source as DataSource)
      }
    }
    viewer?.scene.requestRender()
  },
  { deep: true },
)

// Reactive dot scale: update existing billboards when slider changes
watch(
  () => props.dotScale,
  () => {
    for (const [tKey, entry] of entityMap) {
      if (!entry.billboard) continue
      const isSelected = tKey === previousSelectedId
      // Hover only applies when NOT selected (applyHoverHighlight skips selected tracks)
      const isHovered = hoveredTrackId === tKey && !isSelected
      const isRaw = entry.source === 'radar_raw'
      const base = isHovered ? DOT_HOVER
        : isSelected ? DOT_SELECTED
        : isRaw ? DOT_RAW
        : DOT_BASE
      ;(entry.billboard.billboard as any).scale = dotSize(base, entry.source)
    }
    viewer?.scene.requestRender()
  },
  { deep: true },
)

// Highlight selected track
let previousSelectedId: string | null = null

function applyHighlight(trackId: string | null) {
  if (!viewer) return

  // Restore previous
  if (previousSelectedId && previousSelectedId !== trackId) {
    const prev = entityMap.get(previousSelectedId)
    if (prev?.polyline) {
      const color = getColor(prev.source as DataSource)
      ;(prev.polyline.polyline as any).material = color.withAlpha(baseAlpha(prev.source))
      ;(prev.polyline.polyline as any).width = baseWidth(prev.source as DataSource)
    }
    if (prev?.billboard) {
      ;(prev.billboard.billboard as any).scale = dotSize(prev.source === 'radar_raw' ? DOT_RAW : DOT_BASE, prev.source)
    }
  }

  // Apply to new
  if (trackId) {
    const entry = entityMap.get(trackId)
    if (entry?.polyline) {
      const color = getColor(entry.source as DataSource)
      ;(entry.polyline.polyline as any).material = color.withAlpha(SELECTED_ALPHA)
      ;(entry.polyline.polyline as any).width = SELECTED_WIDTH
    }
    if (entry?.billboard) {
      ;(entry.billboard.billboard as any).scale = dotSize(DOT_SELECTED, entry.source)
    }
  }

  previousSelectedId = trackId
  viewer.scene.requestRender()
}

// Hover highlight — bright red + thick, unmistakable
let hoveredTrackId: string | null = null
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

/** Compute billboard scale with per-source dot-scale slider applied */
function dotSize(base: number, source: string): number {
  return base * (props.dotScale[source as DataSource] ?? 1.0)
}

function baseWidth(source: DataSource): number {
  return props.lineWidths[source] ?? 2.0
}

function baseAlpha(source: string): number {
  return source === 'radar_raw' ? 0.6 : NORMAL_ALPHA
}

function applyHoverHighlight(trackId: string) {
  const entry = entityMap.get(trackId)
  if (!entry) return

  // If this track is already click-selected, don't override with red
  if (previousSelectedId === trackId) return

  if (entry.polyline) {
    const p = entry.polyline
    ;(p.polyline as any).material = HOVER_COLOR
    ;(p.polyline as any).width = HOVER_WIDTH
  }
  if (entry.billboard) {
    ;(entry.billboard.billboard as any).scale = dotSize(DOT_HOVER, entry.source)
  }
}

function removeHoverHighlight() {
  if (!hoveredTrackId) return
  const entry = entityMap.get(hoveredTrackId)
  if (entry) {
    const originalColor = getColor(entry.source as DataSource)
    const isSelected = hoveredTrackId === previousSelectedId
    if (entry.polyline) {
      const p = entry.polyline
      ;(p.polyline as any).material = originalColor.withAlpha(isSelected ? SELECTED_ALPHA : baseAlpha(entry.source))
      ;(p.polyline as any).width = isSelected ? SELECTED_WIDTH : baseWidth(entry.source as DataSource)
    }
    if (entry.billboard) {
      ;(entry.billboard.billboard as any).scale = dotSize(isSelected ? DOT_SELECTED : entry.source === 'radar_raw' ? DOT_RAW : DOT_BASE, entry.source)
    }
  }
  hoveredTrackId = null
}

function onMouseMove(movement: Cesium.ScreenSpaceEventHandler.MotionEvent) {
  const picked = viewer!.scene.pick(movement.endPosition)
  if (!Cesium.defined(picked) || !picked.id || !(picked.id instanceof Cesium.Entity)) {
    removeHoverHighlight()
    viewer!.scene.requestRender()
    return
  }
  const entityId = (picked.id as Cesium.Entity).id
  if (!entityId || typeof entityId !== 'string' || entityId.startsWith('flag-')) {
    removeHoverHighlight()
    viewer!.scene.requestRender()
    return
  }
  const trackId = entityId.endsWith('::dot') || entityId.endsWith('::line')
    ? entityId.slice(0, entityId.lastIndexOf('::'))
    : entityId
  if (!entityMap.has(trackId)) {
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
    if (entities.billboard.label) {
      const lbl = entities.billboard.label as any
      lbl.text = val ? entities.labelText : ''
      lbl.font = val ? LABEL_FONT_LARGE : LABEL_FONT_BASE
    }
  }
  viewer?.scene.requestRender()
})

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

onMounted(async () => {
  if (!containerRef.value) return

  const port: number = await invoke('get_tile_server_port')

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

  viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: `http://127.0.0.1:${port}/tiles/{z}/{x}/{y}.png`,
      minimumLevel: 0,
      maximumLevel: 8,
      tileWidth: 256,
      tileHeight: 256,
    }),
  )

  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(110, 25, 12000000),
  })

  syncEntities(props.tracks)
  pinIconDataUrl = createPinIcon()
  syncFlagEntities()

  // LEFT_CLICK handler for track picking (skip flags)
  clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  clickHandler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    const picked = viewer!.scene.pick(movement.position)
    if (!Cesium.defined(picked) || !picked.id || !(picked.id instanceof Cesium.Entity)) {
      // Delay clearing isolation to allow double-click to cancel it
      if (pendingClearTimeout) clearTimeout(pendingClearTimeout)
      pendingClearTimeout = setTimeout(() => {
        pendingClearTimeout = null
        emit('track-pick', null)
      }, 300)
      return
    }
    const entityId = (picked.id as Cesium.Entity).id
    if (entityId && typeof entityId === 'string') {
      // Skip flag entities
      if (entityId.startsWith('flag-')) {
        return
      }
      const trackId = entityId.endsWith('::dot') || entityId.endsWith('::line')
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
})

onUnmounted(() => {
  clearAllEntities()
  clearAllFlagEntities()
  if (arcEntity && viewer) {
    viewer.entities.remove(arcEntity)
    arcEntity = undefined
  }
  if (dblClickHandler) {
    dblClickHandler.destroy()
    dblClickHandler = null
  }
  if (clickHandler) {
    clickHandler.destroy()
    clickHandler = null
  }
  if (moveHandler) {
    moveHandler.destroy()
    moveHandler = null
  }
  if (viewer) {
    viewer.destroy()
    viewer = null
  }
})

function flyToFlag(flag: Flag) {
  if (!viewer) return
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(flag.longitude, flag.latitude, 50000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    duration: 1.0,
  })
}

defineExpose({ getViewer: () => viewer, flyToTrack, flyToFlag, resetView })
</script>

<style scoped>
.cesium-container {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
</style>
