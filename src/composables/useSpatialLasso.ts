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

// ── Segment intersection (with bbox quick-reject) ──

function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  // Bbox quick-reject: if the two segments' bounding boxes don't overlap, they can't intersect
  const seg1MinX = ax < bx ? ax : bx
  const seg1MaxX = ax > bx ? ax : bx
  const seg1MinY = ay < by ? ay : by
  const seg1MaxY = ay > by ? ay : by
  const seg2MinX = cx < dx ? cx : dx
  const seg2MaxX = cx > dx ? cx : dx
  const seg2MinY = cy < dy ? cy : dy
  const seg2MaxY = cy > dy ? cy : dy
  if (seg1MaxX < seg2MinX || seg2MaxX < seg1MinX ||
      seg1MaxY < seg2MinY || seg2MaxY < seg1MinY) return false

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

// ── Douglas-Peucker polygon simplification ──

/**
 * Simplify polygon vertices using Douglas-Peucker algorithm.
 * Uses equirectangular approximation for perpendicular distance
 * (accurate enough for the typical lasso polygon scale).
 * @param vertices  polygon vertices
 * @param epsilonMeters  max perpendicular distance in meters (default 5m)
 */
function simplifyPolygon(vertices: LassoVertex[], epsilonMeters: number = 5): LassoVertex[] {
  if (vertices.length <= 3) return [...vertices]

  // Convert epsilon from meters to approximate degrees at the mean latitude
  const meanLat = vertices.reduce((s, v) => s + v.latitude, 0) / vertices.length
  const degPerMeter = 1 / (111_320 * Math.cos(meanLat * Math.PI / 180))
  const epsilonDeg = epsilonMeters * degPerMeter

  const simplified = douglasPeucker(vertices, epsilonDeg)

  // Ensure at least 3 vertices for a valid polygon
  if (simplified.length < 3) {
    const sorted = [...vertices].sort((a, b) =>
      (Math.abs(a.latitude - meanLat) + Math.abs(a.longitude - meanLat)) -
      (Math.abs(b.latitude - meanLat) + Math.abs(b.longitude - meanLat))
    )
    return sorted.slice(-3)
  }

  return simplified
}

function douglasPeucker(pts: LassoVertex[], epsilon: number): LassoVertex[] {
  if (pts.length <= 2) return [...pts]

  const first = pts[0]
  const last = pts[pts.length - 1]
  const dx = last.longitude - first.longitude
  const dy = last.latitude - first.latitude
  const lenSq = dx * dx + dy * dy

  let maxDistSq = 0
  let maxIdx = 0

  for (let i = 1; i < pts.length - 1; i++) {
    let distSq: number
    if (lenSq === 0) {
      const ddx = pts[i].longitude - first.longitude
      const ddy = pts[i].latitude - first.latitude
      distSq = ddx * ddx + ddy * ddy
    } else {
      const cross = ((pts[i].longitude - first.longitude) * dy -
                     (pts[i].latitude - first.latitude) * dx)
      distSq = (cross * cross) / lenSq
    }
    if (distSq > maxDistSq) {
      maxDistSq = distSq
      maxIdx = i
    }
  }

  if (maxDistSq > epsilon * epsilon) {
    const left = douglasPeucker(pts.slice(0, maxIdx + 1), epsilon)
    const right = douglasPeucker(pts.slice(maxIdx), epsilon)
    return [...left.slice(0, -1), ...right]
  }

  return [first, last]
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
   * Accepts TrackPoint-like objects with .latitude / .longitude to avoid .map() allocation.
   * Optimized with polygon bbox pre-filter, track bbox early-reject, and segment bbox.
   */
  function doesTrackIntersectPolygon(
    positions: Array<{ latitude: number; longitude: number }>,
    polygon: LassoVertex[],
  ): boolean {
    if (positions.length === 0 || polygon.length < 3) return false

    // ── Pre-compute polygon bbox (O(E) once) ──
    let polyMinLat = Infinity, polyMaxLat = -Infinity
    let polyMinLng = Infinity, polyMaxLng = -Infinity
    for (const v of polygon) {
      if (v.latitude < polyMinLat) polyMinLat = v.latitude
      if (v.latitude > polyMaxLat) polyMaxLat = v.latitude
      if (v.longitude < polyMinLng) polyMinLng = v.longitude
      if (v.longitude > polyMaxLng) polyMaxLng = v.longitude
    }

    // ── Pass 1: check point-in-polygon (with bbox pre-filter) + compute track bbox ──
    let trkMinLat = Infinity, trkMaxLat = -Infinity
    let trkMinLng = Infinity, trkMaxLng = -Infinity

    for (const pos of positions) {
      const lat = pos.latitude, lng = pos.longitude

      // Track bbox accumulation
      if (lat < trkMinLat) trkMinLat = lat
      if (lat > trkMaxLat) trkMaxLat = lat
      if (lng < trkMinLng) trkMinLng = lng
      if (lng > trkMaxLng) trkMaxLng = lng

      // Polygon bbox pre-filter: skip expensive pointInPolygon for positions outside bbox
      if (lat < polyMinLat || lat > polyMaxLat ||
          lng < polyMinLng || lng > polyMaxLng) continue

      if (pointInPolygon(lat, lng, polygon)) return true
    }

    // ── Track bbox early-reject: no overlap → skip segment check entirely ──
    if (trkMaxLat < polyMinLat || trkMinLat > polyMaxLat ||
        trkMaxLng < polyMinLng || trkMinLng > polyMaxLng) return false

    // ── Pass 2: segment intersection (each segment pair bbox-checked inside segmentsIntersect) ──
    const polyLen = polygon.length
    for (let i = 0; i < positions.length - 1; i++) {
      const a = positions[i]
      const b = positions[i + 1]
      const segMinLat = a.latitude < b.latitude ? a.latitude : b.latitude
      const segMaxLat = a.latitude > b.latitude ? a.latitude : b.latitude
      const segMinLng = a.longitude < b.longitude ? a.longitude : b.longitude
      const segMaxLng = a.longitude > b.longitude ? a.longitude : b.longitude

      // Track segment vs polygon bbox quick-reject
      if (segMaxLat < polyMinLat || segMinLat > polyMaxLat ||
          segMaxLng < polyMinLng || segMinLng > polyMaxLng) continue

      for (let j = 0; j < polyLen; j++) {
        const p1 = polygon[j]
        const p2 = polygon[(j + 1) % polyLen]
        if (segmentsIntersect(
          a.longitude, a.latitude, b.longitude, b.latitude,
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
    let verts = vertices.value
    if (verts.length < 3) return

    // Deduplicate: if last two vertices coincide (double-click artifact), drop the duplicate
    const last = verts[verts.length - 1]
    const prev = verts[verts.length - 2]
    const EPS = 1e-7 // ~1cm at the equator
    if (Math.abs(last.latitude - prev.latitude) < EPS &&
        Math.abs(last.longitude - prev.longitude) < EPS) {
      verts = verts.slice(0, -1)
      vertices.value = verts
      if (verts.length < 3) return
    }

    // Simplify freehand-drawn polygons (>30 vertices) to keep spatial filter fast
    if (verts.length > 30) {
      vertices.value = simplifyPolygon(verts, 5)
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
    trackPositions: Map<string, Array<{ latitude: number; longitude: number }>>,
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
