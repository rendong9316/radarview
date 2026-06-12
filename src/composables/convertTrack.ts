import type { Track, TrackPoint, DataSource } from '../types/track'

interface BackendTrack {
  icao_address: string
  flight_no: string
  icao_flight_no: string
  aircraft_type: string
  registration: string
  airline: string
  origin: string
  destination: string
  source: string
  positions: BackendPosition[]
}

interface BackendPosition {
  latitude: number
  longitude: number
  altitude: number
  heading: number
  ground_speed: number
  vertical_rate: number
  timestamp: string
}

// ── Compact IPC DTO (from Rust TrackDto) ────────────────────────────────────

interface TrackDto {
  id: string
  src: string
  pts: number[][]   // each element is [ts, lat, lng, alt, hdg, gs, vr]
  min_ts: number
  max_ts: number
  cnt: number
  flt?: string
  icao?: string
  typ?: string
  reg?: string
  aln?: string
  org?: string
  dst?: string
}

/** Fast timestamp parser — charCode math. Input is local time from Python strftime. */
function parseTimestamp(raw: string): number {
  if (raw.length < 19) return 0
  const Y = (raw.charCodeAt(0) - 48) * 1000 + (raw.charCodeAt(1) - 48) * 100 + (raw.charCodeAt(2) - 48) * 10 + (raw.charCodeAt(3) - 48)
  const M = (raw.charCodeAt(5) - 48) * 10 + (raw.charCodeAt(6) - 48)
  const D = (raw.charCodeAt(8) - 48) * 10 + (raw.charCodeAt(9) - 48)
  const h = (raw.charCodeAt(11) - 48) * 10 + (raw.charCodeAt(12) - 48)
  const mi = (raw.charCodeAt(14) - 48) * 10 + (raw.charCodeAt(15) - 48)
  const s = (raw.charCodeAt(17) - 48) * 10 + (raw.charCodeAt(18) - 48)
  return new Date(Y, M - 1, D, h, mi, s).getTime()
}

function mapSource(backendSource: string): DataSource {
  if (backendSource === 'ADS-B') return 'adsb'
  if (backendSource === 'Radar') return 'radar'
  if (backendSource === 'RadarRaw') return 'radar_raw'
  return 'simulation'
}

/** Map compact DTO source code → DataSource */
function mapDtoSource(src: string): DataSource {
  if (src === 'ADS-B') return 'adsb'
  if (src === 'Radar') return 'radar'
  if (src === 'RadarRaw') return 'radar_raw'
  return 'simulation'
}

const FT_TO_M = 0.3048

/** Convert compact IPC DTO → Track. `pts` are JSON arrays [ts,lat,lng,alt,hdg,gs,vr]. */
export function fromTrackDto(td: TrackDto): Track {
  const len = td.pts.length
  const positions: TrackPoint[] = new Array(len)
  for (let i = 0; i < len; i++) {
    const a = td.pts[i]  // [ts, lat, lng, alt, hdg, gs, vr]
    positions[i] = {
      timestamp: a[0],      // already epoch ms
      latitude: a[1],
      longitude: a[2],
      altitude: a[3] * FT_TO_M,
      heading: a[4],
      groundSpeed: a[5],
      verticalRate: a[6],
    }
  }
  // Guard: sort by timestamp so polyline connects chronologically
  positions.sort((a, b) => a.timestamp - b.timestamp)

  return {
    id: td.id,
    source: mapDtoSource(td.src),
    positions,
    minTimestamp: td.min_ts,
    maxTimestamp: td.max_ts,
    pointCount: td.cnt,
    metadata: {
      flightNumber: td.flt || undefined,
      icaoFlightNumber: td.icao || undefined,
      registration: td.reg || undefined,
      aircraftType: td.typ || undefined,
      airline: td.aln || undefined,
      origin: td.org || undefined,
      destination: td.dst || undefined,
    },
  }
}

export function fromBackendTrack(bt: BackendTrack): Track {
  const len = bt.positions.length
  const positions: TrackPoint[] = new Array(len)
  for (let i = 0; i < len; i++) {
    const p = bt.positions[i]
    const ts = parseTimestamp(p.timestamp)
    positions[i] = {
      timestamp: ts,
      latitude: p.latitude,
      longitude: p.longitude,
      altitude: p.altitude * FT_TO_M,
      heading: p.heading,
      groundSpeed: p.ground_speed,
      verticalRate: p.vertical_rate,
    }
  }
  // Guard: sort by timestamp so polyline connects chronologically
  positions.sort((a, b) => a.timestamp - b.timestamp)

  const minTs = len > 0 ? positions[0].timestamp : 0
  const maxTs = len > 0 ? positions[len - 1].timestamp : 0

  return {
    id: bt.icao_address,
    source: mapSource(bt.source),
    positions,
    minTimestamp: len > 0 ? minTs : 0,
    maxTimestamp: len > 0 ? maxTs : 0,
    pointCount: len,
    metadata: {
      flightNumber: bt.flight_no || undefined,
      icaoFlightNumber: bt.icao_flight_no || undefined,
      registration: bt.registration || undefined,
      aircraftType: bt.aircraft_type || undefined,
      airline: bt.airline || undefined,
      origin: bt.origin || undefined,
      destination: bt.destination || undefined,
    },
  }
}

export function fromBackendTracks(bts: BackendTrack[]): Track[] {
  const len = bts.length
  const result: Track[] = new Array(len)
  for (let i = 0; i < len; i++) {
    result[i] = fromBackendTrack(bts[i])
  }
  return result
}
