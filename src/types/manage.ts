import type { DataSource } from './track'

/** Filter parameters for querying track metadata.
 *  All fields optional — empty/undefined = show all. */
export interface TrackMetaFilter {
  source?: DataSource
  searchText?: string
  batchId?: number
  airline?: string
  aircraftType?: string
  minPoints?: number
  maxPoints?: number
  minTimeMs?: number
  maxTimeMs?: number
  sortBy?: string
  sortDesc?: boolean
}

/** Lightweight track metadata row (matches Rust TrackMetaInfo) */
export interface TrackMetaInfo {
  icao_address: string
  batch_id: number
  source: string
  flight_number: string
  icao_flight_number: string
  registration: string
  aircraft_type: string
  airline: string
  origin: string
  destination: string
  min_timestamp: string
  max_timestamp: string
  point_count: number
  batch_file_name: string
  batch_imported_at: string
}

/** Aggregated statistics */
export interface TrackStats {
  total_tracks: number
  total_batches: number
  by_source: Record<string, number>
  unique_icao: number
  unique_airlines: string[]
  unique_aircraft_types: string[]
  time_min_ms: number | null
  time_max_ms: number | null
}

/** Distinct values for filter dropdowns */
export interface DistinctOptions {
  airlines: string[]
  aircraft_types: string[]
  batch_names: [number, string][]
}

/** Paginated response */
export interface TrackMetadataResponse {
  rows: TrackMetaInfo[]
  total_count: number
}

/** Sort state */
export interface SortConfig {
  column: string
  desc: boolean
}

/** Default filter — all empty = show everything */
export function defaultFilter(): TrackMetaFilter {
  return { sortBy: 'batch_imported_at', sortDesc: true }
}

export const DEFAULT_SORT: SortConfig = { column: 'batch_imported_at', desc: true }

/** Source dropdown options */
export const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: 'adsb', label: 'ADS-B' },
  { value: 'radar', label: '雷达' },
  { value: 'radar_raw', label: '雷达原始' },
]
