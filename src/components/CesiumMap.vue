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
  const last = track.positions[track.positions.length - 1]
  const isSelected = track.id === props.selectedId

  let polyline: Cesium.Entity | undefined
  if (track.positions.length >= 2) {
    polyline = viewer.entities.add({
      id: `${track.id}::line`,
      polyline: {
        positions: track.positions.map((p) =>
          Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude, p.altitude),
        ),
        width: isSelected ? 4.0 : 1.5,
        material: isSelected
          ? new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.25, color })
          : color.withAlpha(0.7),
        clampToGround: false,
      },
    })
  }

  const label = [track.metadata.flightNumber, track.metadata.aircraftType]
    .filter(Boolean)
    .join(' | ')

  const billboard = viewer.entities.add({
    id: `${track.id}::dot`,
    position: Cesium.Cartesian3.fromDegrees(last.longitude, last.latitude, last.altitude),
    billboard: {
      image: icon,
      scale: isSelected ? 1.2 : 0.7,
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

  console.log('[CesiumMap] syncEntities START:', entityMap.size, 'old entities,', newTracks.length, 'new tracks')

  try {
    viewer.entities.suspendEvents()

    // Gather IDs first, then remove — avoids Map iteration + deletion issues
    const ids = Array.from(entityMap.keys())
    for (const id of ids) {
      removeTrackEntities(id)
    }

    for (const track of newTracks) {
      createTrackEntities(track)
    }
  } finally {
    viewer.entities.resumeEvents()
    viewer.scene.requestRender()
  }

  // Re-apply highlight if needed
  if (previousSelectedId && entityMap.has(previousSelectedId)) {
    applyHighlight(previousSelectedId)
  }
}

// Sync entities whenever displayTracks changes (filter, isolation, etc.)
watch(
  () => props.tracks,
  (newTracks) => {
    console.log('[CesiumMap] watch fired, syncing', newTracks.length, 'tracks, pos counts:', newTracks.map(t => t.id.slice(0,6) + ':' + t.positions.length).join(', '))
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
const highlightConfig = { width: 4.0, glowPower: 0.25 }
const normalConfig = { width: 1.5 }

function applyHighlight(trackId: string | null) {
  if (!viewer) return

  // Restore previous
  if (previousSelectedId && previousSelectedId !== trackId) {
    const prev = entityMap.get(previousSelectedId)
    if (prev?.polyline) {
      const color = getColor(prev.source as import('../types/track').DataSource)
      ;(prev.polyline.polyline as any).material = color.withAlpha(0.7)
      ;(prev.polyline.polyline as any).width = normalConfig.width
    }
    if (prev?.billboard) {
      ;(prev.billboard.billboard as any).scale = 0.7
    }
  }

  // Apply to new
  if (trackId) {
    const entry = entityMap.get(trackId)
    if (entry?.polyline) {
      const color = getColor(entry.source as import('../types/track').DataSource)
      ;(entry.polyline.polyline as any).material = new Cesium.PolylineGlowMaterialProperty({
        glowPower: highlightConfig.glowPower,
        color,
      })
      ;(entry.polyline.polyline as any).width = highlightConfig.width
    }
    if (entry?.billboard) {
      ;(entry.billboard.billboard as any).scale = 1.2
    }
  }

  previousSelectedId = trackId
  viewer.scene.requestRender()
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
