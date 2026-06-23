import { ref, computed } from 'vue'
import { vincentyKm, initialBearing, bearingToCardinal } from './useGeoCalc'

// ── Types ──

export interface RulerWaypoint {
  id: string
  latitude: number
  longitude: number
}

export interface RulerSegment {
  index: number
  from: RulerWaypoint
  to: RulerWaypoint
  distanceKm: number
  bearingDeg: number
  cardinal: string
}

// ── Module-level singleton ──

let _nextId = 0

const active = ref(false)
const waypoints = ref<RulerWaypoint[]>([])
/** Last known mouse position on globe (lat/lng), used for preview line */
const mouseLat = ref<number | null>(null)
const mouseLng = ref<number | null>(null)

// ── Composable ──

export function useRuler() {
  /** Segments between consecutive waypoints, auto-computed */
  const segments = computed<RulerSegment[]>(() => {
    const result: RulerSegment[] = []
    for (let i = 0; i < waypoints.value.length - 1; i++) {
      const from = waypoints.value[i]
      const to = waypoints.value[i + 1]
      const distanceKm = vincentyKm(from.latitude, from.longitude, to.latitude, to.longitude)
      const bearingDeg = initialBearing(from.latitude, from.longitude, to.latitude, to.longitude)
      result.push({
        index: i,
        from,
        to,
        distanceKm,
        bearingDeg,
        cardinal: bearingToCardinal(bearingDeg),
      })
    }
    return result
  })

  /** Total cumulative distance along the path */
  const totalDistance = computed(() =>
    segments.value.reduce((sum, s) => sum + s.distanceKm, 0),
  )

  /** Straight-line bearing from first to last waypoint */
  const directBearing = computed(() => {
    if (waypoints.value.length < 2) return null
    const first = waypoints.value[0]
    const last = waypoints.value[waypoints.value.length - 1]
    const deg = initialBearing(first.latitude, first.longitude, last.latitude, last.longitude)
    return { deg, cardinal: bearingToCardinal(deg) }
  })

  /** Distance and bearing from last waypoint to current mouse position (preview) */
  const previewSegment = computed(() => {
    if (waypoints.value.length === 0) return null
    if (mouseLat.value === null || mouseLng.value === null) return null
    const last = waypoints.value[waypoints.value.length - 1]
    const dist = vincentyKm(last.latitude, last.longitude, mouseLat.value, mouseLng.value)
    const bearing = initialBearing(last.latitude, last.longitude, mouseLat.value, mouseLng.value)
    return {
      from: last,
      toLat: mouseLat.value,
      toLng: mouseLng.value,
      distanceKm: dist,
      bearingDeg: bearing,
      cardinal: bearingToCardinal(bearing),
    }
  })

  // ── Actions ──

  function addWaypoint(lat: number, lng: number) {
    waypoints.value = [
      ...waypoints.value,
      { id: `ruler-${_nextId++}`, latitude: lat, longitude: lng },
    ]
  }

  function removeWaypoint(id: string) {
    waypoints.value = waypoints.value.filter(w => w.id !== id)
  }

  function undo() {
    waypoints.value = waypoints.value.slice(0, -1)
  }

  function clearAll() {
    waypoints.value = []
  }

  function setMouseGround(lat: number | null, lng: number | null) {
    mouseLat.value = lat
    mouseLng.value = lng
  }

  function activate() {
    active.value = true
    clearAll()
  }

  function deactivate() {
    active.value = false
    clearAll()
    mouseLat.value = null
    mouseLng.value = null
  }

  function toggle() {
    if (active.value) {
      deactivate()
    } else {
      activate()
    }
  }

  return {
    active,
    waypoints,
    segments,
    totalDistance,
    directBearing,
    previewSegment,
    addWaypoint,
    removeWaypoint,
    undo,
    clearAll,
    setMouseGround,
    activate,
    deactivate,
    toggle,
  }
}
