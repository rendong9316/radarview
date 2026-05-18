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

/** Fast timestamp parser — charCode math. Input is local time from Python strftime. */
function parseTimestamp(raw: string): number {
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

const FT_TO_M = 0.3048

export function fromBackendTrack(bt: BackendTrack): Track {
  const len = bt.positions.length
  const positions: TrackPoint[] = new Array(len)
  for (let i = 0; i < len; i++) {
    const p = bt.positions[i]
    positions[i] = {
      timestamp: parseTimestamp(p.timestamp),
      latitude: p.latitude,
      longitude: p.longitude,
      altitude: p.altitude * FT_TO_M,
      heading: p.heading,
      groundSpeed: p.ground_speed,
      verticalRate: p.vertical_rate,
    }
  }

  return {
    id: bt.icao_address,
    source: mapSource(bt.source),
    positions,
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
