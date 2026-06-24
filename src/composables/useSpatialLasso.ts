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

export interface EdgeLength {
  fromIdx: number
  toIdx: number
  fromLabel: string
  toLabel: string
  meters: number
}

// ── Geodesic math ──

const EARTH_RADIUS_M = 6_371_000

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = Math.PI / 180
  const dLat = (lat2 - lat1) * toRad
  const dLng = (lng2 - lng1) * toRad
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_M * c
}

/**
 * Spherical polygon area via Green's theorem on the unit sphere.
 * A = R² × |Σ λ_i (sin φ_{i+1} − sin φ_{i−1})| / 2
 * Returns area in square meters.
 */
function sphericalPolygonArea(vertices: LassoVertex[]): number {
  const n = vertices.length
  if (n < 3) return 0
  const toRad = Math.PI / 180
  let sum = 0
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n]
    const next = vertices[(i + 1) % n]
    const lng = vertices[i].longitude * toRad
    const sinPrev = Math.sin(prev.latitude * toRad)
    const sinNext = Math.sin(next.latitude * toRad)
    sum += lng * (sinNext - sinPrev)
  }
  return Math.abs(sum) * EARTH_RADIUS_M * EARTH_RADIUS_M / 2
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

/** Lasso mode: vertex = click-to-place, freehand = hold-and-draw */
const lassoMode = ref<'vertex' | 'freehand'>('vertex')
/** Currently dragging a vertex id (null = not dragging) */
const draggingVertexId = ref<string | null>(null)
/** Whether a freehand draw stroke is in progress */
const freehandDrawing = ref(false)

/** Snapshot of the polygon vertices when spatial filter is applied */
const filterPolygon = ref<LassoVertex[] | null>(null)
/** Whether a spatial filter is currently active */
const hasSpatialFilter = ref(false)

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

  /** Geodesic edge lengths (computed once polygon is closed) */
  const edgeLengths = computed<EdgeLength[]>(() => {
    const verts = vertices.value
    if (verts.length < 2 || !isClosed.value) return []
    const edges: EdgeLength[] = []
    const n = verts.length
    for (let i = 0; i < n; i++) {
      const from = verts[i]
      const to = verts[(i + 1) % n]
      edges.push({
        fromIdx: i,
        toIdx: (i + 1) % n,
        fromLabel: `V${i + 1}`,
        toLabel: `V${((i + 1) % n) + 1}`,
        meters: haversineDistance(from.latitude, from.longitude, to.latitude, to.longitude),
      })
    }
    return edges
  })

  /** Polygon area in km² (computed once polygon is closed) */
  const polygonAreaSqKm = computed<number | null>(() => {
    if (vertices.value.length < 3 || !isClosed.value) return null
    return sphericalPolygonArea(vertices.value) / 1_000_000
  })

  /**
   * Check whether a single track's positions intersect a polygon.
   * Used by displayTracks to re-evaluate on every filter change with current positions.
   */
  function doesTrackIntersectPolygon(
    positions: Array<{ lat: number; lng: number }>,
    polygon: LassoVertex[],
  ): boolean {
    if (positions.length === 0 || polygon.length < 3) return false

    // Check point-in-polygon
    for (const pos of positions) {
      if (pointInPolygon(pos.lat, pos.lng, polygon)) return true
    }

    // Check segment intersections
    for (let i = 0; i < positions.length - 1; i++) {
      const a = positions[i]
      const b = positions[i + 1]
      for (let j = 0; j < polygon.length; j++) {
        const p1 = polygon[j]
        const p2 = polygon[(j + 1) % polygon.length]
        if (segmentsIntersect(
          a.lng, a.lat, b.lng, b.lat,
          p1.longitude, p1.latitude, p2.longitude, p2.latitude,
        )) return true
      }
    }

    return false
  }

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
    const verts = vertices.value
    if (verts.length < 3) return

    // Deduplicate: if last two vertices coincide (double-click artifact), drop the duplicate
    const last = verts[verts.length - 1]
    const prev = verts[verts.length - 2]
    const EPS = 1e-7 // ~1cm at the equator
    if (Math.abs(last.latitude - prev.latitude) < EPS &&
        Math.abs(last.longitude - prev.longitude) < EPS) {
      vertices.value = verts.slice(0, -1)
      if (vertices.value.length < 3) return
    }

    isClosed.value = true
    // Auto-deactivate — drawing is done, restore normal interactions
    active.value = false
  }

  function clearAll() {
    active.value = false
    vertices.value = []
    isClosed.value = false
    results.value = []
    selectedResultKeys.value.clear()
    filterPolygon.value = null
    hasSpatialFilter.value = false
    draggingVertexId.value = null
    freehandDrawing.value = false
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
    clearAll()
    active.value = true
  }

  function deactivate() {
    active.value = false
    lastMouseLat.value = null
    lastMouseLng.value = null
  }

  function toggle() {
    if (active.value) { deactivate() } else { activate() }
  }

  /** Snapshot the current polygon as the active spatial filter */
  function applyFilter() {
    if (vertices.value.length < 3 || !isClosed.value) return
    filterPolygon.value = vertices.value.map(v => ({ ...v }))
    hasSpatialFilter.value = true
  }

  /**
   * Legacy batch filter: given position arrays per track, return matching keys.
   * Pure function — does NOT store state. Use applyFilter() + doesTrackIntersectPolygon()
   * for the displayTracks pipeline.
   */
  function applySpatialFilter(
    trackPositions: Map<string, Array<{ lat: number; lng: number }>>,
  ): string[] {
    if (vertices.value.length < 3 || !isClosed.value) return []
    const poly = vertices.value

    const matching: string[] = []
    for (const [key, positions] of trackPositions) {
      if (doesTrackIntersectPolygon(positions, poly)) {
        matching.push(key)
      }
    }
    return matching
  }

  // ── Mode / Drag / Freehand ──

  function setMode(mode: 'vertex' | 'freehand') {
    if (lassoMode.value !== mode && !isClosed.value) {
      lassoMode.value = mode
      vertices.value = []
    } else {
      lassoMode.value = mode
    }
  }

  /** Move an existing vertex to a new position */
  function moveVertex(id: string, lat: number, lng: number) {
    const idx = vertices.value.findIndex(v => v.id === id)
    if (idx === -1) return
    const updated = [...vertices.value]
    updated[idx] = { ...updated[idx], latitude: lat, longitude: lng }
    vertices.value = updated
  }

  function startVertexDrag(id: string) {
    draggingVertexId.value = id
  }

  function endVertexDrag() {
    draggingVertexId.value = null
  }

  /** Begin a freehand draw stroke — clears any existing vertices */
  function beginFreehand(lat: number, lng: number) {
    clearAll()
    active.value = true
    freehandDrawing.value = true
    vertices.value = [{ id: `lasso-${_nextId++}`, latitude: lat, longitude: lng }]
  }

  /** Add a point during freehand drawing (skips if too close to last point) */
  function addFreehandPoint(lat: number, lng: number) {
    if (!freehandDrawing.value) return
    const last = vertices.value[vertices.value.length - 1]
    if (last) {
      // Skip if very close to last point (~10m threshold)
      const d = haversineDistance(last.latitude, last.longitude, lat, lng)
      if (d < 10) return
    }
    vertices.value = [
      ...vertices.value,
      { id: `lasso-${_nextId++}`, latitude: lat, longitude: lng },
    ]
  }

  /** End freehand draw stroke — close the polygon if enough vertices */
  function endFreehand() {
    freehandDrawing.value = false
    if (vertices.value.length >= 3) {
      closePolygon()
    } else {
      // Not enough points — discard
      clearAll()
    }
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
    filterPolygon,
    hasSpatialFilter,
    lassoMode,
    draggingVertexId,
    freehandDrawing,
    edgeLengths,
    polygonAreaSqKm,
    previewSegment,
    previewClose,
    bounds,
    addVertex,
    removeVertex,
    closePolygon,
    clearAll,
    setMode,
    moveVertex,
    startVertexDrag,
    endVertexDrag,
    beginFreehand,
    addFreehandPoint,
    endFreehand,
    setMouseGround,
    activate,
    deactivate,
    toggle,
    applyFilter,
    applySpatialFilter,
    doesTrackIntersectPolygon,
    pointInPolygon,
  }
}
