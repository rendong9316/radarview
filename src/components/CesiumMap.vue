<template>
  <div class="cesium-container" ref="containerRef"></div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import * as Cesium from 'cesium'
import { invoke } from '@tauri-apps/api/core'
import type { Track, TrackPoint } from '../types/track'
import { useTrackStyle } from '../composables/useTrackStyle'
import { useLayerVisibility } from '../composables/useLayerVisibility'
import { useLabelVisibility } from '../composables/useLabelVisibility'
import { useFlags } from '../composables/useFlags'
import type { Flag } from '../composables/useFlags'

const props = defineProps<{
  tracks: Track[]
  replayTime: number | null
  selectedId: string | null
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

let arcEntity: Cesium.Entity | undefined

const LABEL_FONT_BASE = '12px sans-serif'
const LABEL_FONT_LARGE = '18px sans-serif'

interface TrackEntities {
  polyline: Cesium.Entity | undefined
  billboard: Cesium.Entity
  source: string
  labelText: string
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
  const entity = viewer.entities.add({
    id: `flag-${flag.id}`,
    position: Cesium.Cartesian3.fromDegrees(flag.longitude, flag.latitude),
    billboard: {
      image: pinIconDataUrl,
      scale: 0.8,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
    },
    label: {
      text: flag.label,
      font: '12px sans-serif',
      fillColor: Cesium.Color.YELLOW,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.TOP,
      pixelOffset: new Cesium.Cartesian2(0, 8),
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

  viewer.entities.suspendEvents()

  for (const id of oldIds) {
    if (!newIds.has(id)) removeFlagEntity(id)
  }

  for (const flag of flags.value) {
    if (!flagEntityMap.has(flag.id)) createFlagEntity(flag)
  }

  viewer.entities.resumeEvents()
  viewer.scene.requestRender()
}

function findPositionAtTime(points: TrackPoint[], time: number): TrackPoint | null {
  if (points.length === 0) return null
  if (time <= points[0].timestamp) return points[0]
  if (time >= points[points.length - 1].timestamp) return points[points.length - 1]

  let lo = 0
  let hi = points.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (points[mid].timestamp <= time) lo = mid
    else hi = mid
  }

  const dt = points[hi].timestamp - points[lo].timestamp
  const t = dt > 0 ? (time - points[lo].timestamp) / dt : 0

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

function createTrackEntities(track: Track) {
  if (!viewer || track.positions.length === 0) return

  const color = getColor(track.source)
  const icon = getIcon(track.source)
  const isSelected = track.id === props.selectedId
  const isRaw = track.source === 'radar_raw'

  let polyline: Cesium.Entity | undefined
  if (track.positions.length >= 2) {
    const width = isSelected ? SELECTED_WIDTH : isRaw ? 1.0 : NORMAL_WIDTH
    const alpha = isSelected ? SELECTED_ALPHA : isRaw ? 0.6 : NORMAL_ALPHA
    polyline = viewer.entities.add({
      id: `${track.id}::line`,
      show: true,
      polyline: {
        positions: track.positions.map((p) =>
          Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude, p.altitude),
        ),
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
  const billboardScale = isSelected ? 1.2 : isRaw ? 0.4 : 0.7
  const billboard = viewer.entities.add({
    id: `${track.id}::dot`,
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

  entityMap.set(track.id, { polyline, billboard, source: track.source, labelText: label || track.id })
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

  try {
    viewer.entities.suspendEvents()

    const keepIds = new Set(newTracks.map((t) => t.id))
    const oldIds = Array.from(entityMap.keys())

    // Remove entities for tracks no longer in display list
    for (const id of oldIds) {
      if (!keepIds.has(id)) {
        removeTrackEntities(id)
      }
    }

    // Add or update entities
    for (const track of newTracks) {
      const existing = entityMap.get(track.id)
      if (!existing) {
        createTrackEntities(track)
        continue
      }

      // Update polyline for existing track when positions changed (e.g. time filter)
      const hasEnoughPoints = track.positions.length >= 2
      if (existing.polyline) {
        if (hasEnoughPoints) {
          ;(existing.polyline.polyline as any).positions = track.positions.map((p) =>
            Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude, p.altitude),
          )
          existing.polyline.show = true
        } else {
          existing.polyline.show = false
        }
      } else if (hasEnoughPoints) {
        // Polyline didn't exist before but now has enough points (e.g. filter cleared)
        const color = getColor(track.source)
        const isRaw = track.source === 'radar_raw'
        existing.polyline = viewer.entities.add({
          id: `${track.id}::line`,
          show: true,
          polyline: {
            positions: track.positions.map((p) =>
              Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude, p.altitude),
            ),
            width: track.id === props.selectedId ? SELECTED_WIDTH : isRaw ? 1.0 : NORMAL_WIDTH,
            material: color.withAlpha(track.id === props.selectedId ? SELECTED_ALPHA : isRaw ? 0.6 : NORMAL_ALPHA),
            clampToGround: false,
          },
        })
      }

      // Update billboard to last position
      const last = track.positions[track.positions.length - 1]
      existing.billboard.position = new Cesium.ConstantPositionProperty(
        Cesium.Cartesian3.fromDegrees(last.longitude, last.latitude, last.altitude),
      )
    }
  } finally {
    viewer.entities.resumeEvents()
    viewer.scene.requestRender()
  }
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
    const entities = entityMap.get(track.id)
    if (!entities) continue
    const point = findPositionAtTime(track.positions, time)
    if (!point) continue
    entities.billboard.position = new Cesium.ConstantPositionProperty(
      Cesium.Cartesian3.fromDegrees(point.longitude, point.latitude, point.altitude),
    )
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
      for (const track of props.tracks) {
        const entities = entityMap.get(track.id)
        if (!entities || track.positions.length === 0) continue
        const last = track.positions[track.positions.length - 1]
        entities.billboard.position = new Cesium.ConstantPositionProperty(
          Cesium.Cartesian3.fromDegrees(last.longitude, last.latitude, last.altitude),
        )
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

// Highlight selected track
let previousSelectedId: string | null = null

function applyHighlight(trackId: string | null) {
  if (!viewer) return

  // Restore previous
  if (previousSelectedId && previousSelectedId !== trackId) {
    const prev = entityMap.get(previousSelectedId)
    if (prev?.polyline) {
      const color = getColor(prev.source as import('../types/track').DataSource)
      ;(prev.polyline.polyline as any).material = color.withAlpha(baseAlpha(prev.source))
      ;(prev.polyline.polyline as any).width = baseWidth(prev.source)
    }
    if (prev?.billboard) {
      ;(prev.billboard.billboard as any).scale = prev.source === 'radar_raw' ? 0.4 : 0.7
    }
  }

  // Apply to new
  if (trackId) {
    const entry = entityMap.get(trackId)
    if (entry?.polyline) {
      const color = getColor(entry.source as import('../types/track').DataSource)
      ;(entry.polyline.polyline as any).material = color.withAlpha(SELECTED_ALPHA)
      ;(entry.polyline.polyline as any).width = SELECTED_WIDTH
    }
    if (entry?.billboard) {
      ;(entry.billboard.billboard as any).scale = 1.2
    }
  }

  previousSelectedId = trackId
  viewer.scene.requestRender()
}

// Hover highlight — bright red + thick, unmistakable
let hoveredTrackId: string | null = null
const HOVER_COLOR = Cesium.Color.fromCssColorString('#ff3333')
const HOVER_WIDTH = 5.0
const HOVER_BILLBOARD_SCALE = 1.3
const NORMAL_ALPHA = 0.88
const NORMAL_WIDTH = 2.0
const SELECTED_WIDTH = 4.0
const SELECTED_ALPHA = 1.0

function baseWidth(source: string): number {
  return source === 'radar_raw' ? 1.0 : NORMAL_WIDTH
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
    ;(entry.billboard.billboard as any).scale = HOVER_BILLBOARD_SCALE
  }
}

function removeHoverHighlight() {
  if (!hoveredTrackId) return
  const entry = entityMap.get(hoveredTrackId)
  if (entry) {
    const originalColor = getColor(entry.source as import('../types/track').DataSource)
    const isSelected = hoveredTrackId === previousSelectedId
    if (entry.polyline) {
      const p = entry.polyline
      ;(p.polyline as any).material = originalColor.withAlpha(isSelected ? SELECTED_ALPHA : baseAlpha(entry.source))
      ;(p.polyline as any).width = isSelected ? SELECTED_WIDTH : baseWidth(entry.source)
    }
    if (entry.billboard) {
      ;(entry.billboard.billboard as any).scale = isSelected ? 1.2 : entry.source === 'radar_raw' ? 0.4 : 0.7
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
