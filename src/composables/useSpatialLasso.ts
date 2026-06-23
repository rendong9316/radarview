import { ref, computed } from 'vue'

// ── Types ──

export interface LassoVertex {
  id: string
  latitude: number
  longitude: number
}

export interface LassoResult {
  icao: string
  source: string
  flightNumber: string | null
  aircraftType: string | null
  airline: string | null
  origin: string | null
  destination: string | null
  pointCount: number
  minTime: number
  maxTime: number
}

// ── Module-level singleton ──

let _nextId = 0

const active = ref(false)
const vertices = ref<LassoVertex[]>([])
const isClosed = ref(false)
const results = ref<LassoResult[]>([])
const loading = ref(false)
const lastMouseLat = ref<number | null>(null)
const lastMouseLng = ref<number | null>(null)
/** Set of selected result track keys for batch operations */
const selectedResultKeys = ref(new Set<string>())

// ── Ray casting: point in polygon ──

function pointInPolygon(lat: number, lng: number, polygon: LassoVertex[]): boolean {
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = polygon[i].latitude
    const yj = polygon[j].latitude
    const xi = polygon[i].longitude
    const xj = polygon[j].longitude
    if ((yi > lat) !== (yj > lat)) {
      const intersectX = xi + ((lat - yi) / (yj - yi)) * (xj - xi)
      if (lng < intersectX) inside = !inside
    }
  }
  return inside
}

// ── Segment intersection ──

function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  function cross(ox: number, oy: number, ax2: number, ay2: number, bx2: number, by2: number): number {
    return (ax2 - ox) * (by2 - oy) - (ay2 - oy) * (bx2 - ox)
  }
  const d1 = cross(cx, cy, dx, dy, ax, ay)
  const d2 = cross(cx, cy, dx, dy, bx, by)
  const d3 = cross(ax, ay, bx, by, cx, cy)
  const d4 = cross(ax, ay, bx, by, dx, dy)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true
  }
  // collinear cases
  if (d1 === 0 && cx >= Math.min(ax, bx) && cx <= Math.max(ax, bx) &&
      cy >= Math.min(ay, by) && cy <= Math.max(ay, by)) return true
  if (d2 === 0 && dx >= Math.min(ax, bx) && dx <= Math.max(ax, bx) &&
      dy >= Math.min(ay, by) && dy <= Math.max(ay, by)) return true
  if (d3 === 0 && ax >= Math.min(cx, dx) && ax <= Math.max(cx, dx) &&
      ay >= Math.min(cy, dy) && ay <= Math.max(cy, dy)) return true
  if (d4 === 0 && bx >= Math.min(cx, dx) && bx <= Math.max(cx, dx) &&
      by >= Math.min(cy, dy) && by <= Math.max(cy, dy)) return true
  return false
}

// ── Composable ──

export function useSpatialLasso() {
  /** Preview line: last vertex → mouse */
  const previewSegment = computed(() => {
    if (vertices.value.length === 0) return null
    if (lastMouseLat.value === null || lastMouseLng.value === null) return null
    const last = vertices.value[vertices.value.length - 1]
    return {
      fromLat: last.latitude,
      fromLng: last.longitude,
      toLat: lastMouseLat.value,
      toLng: lastMouseLng.value,
    }
  })

  /** Preview close line: mouse → first vertex (when 2+ vertices) */
  const previewClose = computed(() => {
    if (vertices.value.length < 2) return null
    if (lastMouseLat.value === null || lastMouseLng.value === null) return null
    const first = vertices.value[0]
    return {
      fromLat: lastMouseLat.value,
      fromLng: lastMouseLng.value,
      toLat: first.latitude,
      toLng: first.longitude,
    }
  })

  // ── Actions ──

  function addVertex(lat: number, lng: number) {
    if (isClosed.value) return
    vertices.value = [
      ...vertices.value,
      { id: `lasso-${_nextId++}`, latitude: lat, longitude: lng },
    ]
  }

  function removeVertex(id: string) {
    if (isClosed.value) return
    vertices.value = vertices.value.filter(v => v.id !== id)
  }

  function closePolygon() {
    if (vertices.value.length < 3) return
    isClosed.value = true
  }

  function clearAll() {
    vertices.value = []
    isClosed.value = false
    results.value = []
    selectedResultKeys.value.clear()
  }

  function setMouseGround(lat: number | null, lng: number | null) {
    lastMouseLat.value = lat
    lastMouseLng.value = lng
    if (lat === null || lng === null) {
      lastMouseLat.value = null
      lastMouseLng.value = null
    }
  }

  function activate() {
    active.value = true
    clearAll()
  }

  function deactivate() {
    active.value = false
    clearAll()
    lastMouseLat.value = null
    lastMouseLng.value = null
  }

  function toggle() {
    if (active.value) { deactivate() } else { activate() }
  }

  /**
   * Frontend spatial filter: given position arrays per track, determine
   * which tracks intersect the polygon.
   * Each position is [ts, lat, lng, ...].
   */
  function applySpatialFilter(
    trackPositions: Map<string, Array<{ lat: number; lng: number }>>,
  ): string[] {
    if (vertices.value.length < 3 || !isClosed.value) return []
    const poly = vertices.value

    const matching: string[] = []
    for (const [key, positions] of trackPositions) {
      if (positions.length === 0) continue
      let matched = false

      // Check each position point
      for (const pos of positions) {
        if (pointInPolygon(pos.lat, pos.lng, poly)) {
          matched = true
          break
        }
      }
      if (matched) { matching.push(key); continue }

      // Check line segments between consecutive positions
      for (let i = 0; i < positions.length - 1; i++) {
        const a = positions[i]
        const b = positions[i + 1]
        let segIntersects = false
        for (let j = 0; j < poly.length; j++) {
          const p1 = poly[j]
          const p2 = poly[(j + 1) % poly.length]
          if (segmentsIntersect(
            a.lng, a.lat, b.lng, b.lat,
            p1.longitude, p1.latitude, p2.longitude, p2.latitude,
          )) {
            segIntersects = true
            break
          }
        }
        if (segIntersects) {
          matched = true
          break
        }
      }
      if (matched) matching.push(key)
    }
    return matching
  }

  // ── Polygon bounds ──

  const bounds = computed(() => {
    if (vertices.value.length === 0) return null
    let minLat = Infinity, maxLat = -Infinity
    let minLng = Infinity, maxLng = -Infinity
    for (const v of vertices.value) {
      if (v.latitude < minLat) minLat = v.latitude
      if (v.latitude > maxLat) maxLat = v.latitude
      if (v.longitude < minLng) minLng = v.longitude
      if (v.longitude > maxLng) maxLng = v.longitude
    }
    return { minLat, maxLat, minLng, maxLng }
  })

  return {
    active,
    vertices,
    isClosed,
    results,
    loading,
    selectedResultKeys,
    previewSegment,
    previewClose,
    bounds,
    addVertex,
    removeVertex,
    closePolygon,
    clearAll,
    setMouseGround,
    activate,
    deactivate,
    toggle,
    applySpatialFilter,
    pointInPolygon,
  }
}
