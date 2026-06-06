use serde::{Deserialize, Serialize};

/// Map frontend DataSource values to DB source column values.
pub fn source_to_db(frontend_source: &str) -> &str {
    match frontend_source {
        "adsb" => "ADS-B",
        "radar" => "Radar",
        "radar_raw" => "RadarRaw",
        "simulation" => "Simulation",
        other => other,
    }
}

/// Map DB source column values to frontend DataSource values.
pub fn source_from_db(db_source: &str) -> &str {
    match db_source {
        "ADS-B" => "adsb",
        "Radar" => "radar",
        "RadarRaw" => "radar_raw",
        "Simulation" => "simulation",
        other => other,
    }
}

/// Filter parameters for querying track metadata.
/// `source` is optional — when None, all sources are included.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackMetaFilter {
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub search_text: Option<String>,
    #[serde(default)]
    pub batch_id: Option<i64>,
    #[serde(default)]
    pub airline: Option<String>,
    #[serde(default)]
    pub aircraft_type: Option<String>,
    #[serde(default)]
    pub min_points: Option<i64>,
    #[serde(default)]
    pub max_points: Option<i64>,
    #[serde(default)]
    pub min_time_ms: Option<i64>,
    #[serde(default)]
    pub max_time_ms: Option<i64>,
    #[serde(default = "default_sort_by")]
    pub sort_by: String,
    #[serde(default)]
    pub sort_desc: bool,
}

fn default_sort_by() -> String {
    "batch_imported_at".to_string()
}

/// Lightweight metadata row for the management table (no position data).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackMetaInfo {
    pub icao_address: String,
    pub batch_id: i64,
    pub source: String,
    pub flight_number: String,
    pub icao_flight_number: String,
    pub registration: String,
    pub aircraft_type: String,
    pub airline: String,
    pub origin: String,
    pub destination: String,
    pub min_timestamp: String,
    pub max_timestamp: String,
    pub point_count: i64,
    pub batch_file_name: String,
    pub batch_imported_at: String,
}

/// Aggregated statistics across all tracks.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackStats {
    pub total_tracks: i64,
    pub total_batches: i64,
    pub by_source: std::collections::HashMap<String, i64>,
    pub unique_icao: i64,
    pub unique_airlines: Vec<String>,
    pub unique_aircraft_types: Vec<String>,
    pub time_min_ms: Option<i64>,
    pub time_max_ms: Option<i64>,
}

/// Distinct values for filter dropdowns.
/// When `source` is None, returns values across all sources.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistinctOptions {
    pub airlines: Vec<String>,
    pub aircraft_types: Vec<String>,
    /// (batch_id, file_name) pairs
    pub batch_names: Vec<(i64, String)>,
}

/// Wrapper for the paginated query response sent to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackMetadataResponse {
    pub rows: Vec<TrackMetaInfo>,
    pub total_count: i64,
}
